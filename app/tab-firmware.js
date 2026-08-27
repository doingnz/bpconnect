/**
 * Tab 5 — firmware update.
 *
 * Hidden unless switched on in Settings. Firmware update is a service action,
 * not something a clinical user should meet on the way to a measurement.
 *
 * The protocol lives entirely in sdk/device/firmware-update.js. This file
 * chooses a file, shows the state of the device, drives the two buttons and
 * reports what happened — and spends most of its length on the copy, because
 * the difficult parts of this operation are things an operator has to be told
 * rather than things the software can do for them:
 *
 *   - There is no command that puts a BP+ into its Service Menu. Somebody has
 *     to walk there with the buttons.
 *   - Interrupting is safe, and an operator who does not know that will sit
 *     watching a stalled bar rather than doing the thing that fixes it.
 *   - After any failure the device must be RESTARTED before another attempt.
 *     Retrying without restarting is what hangs it.
 */

import {
  DeviceMode,
  DeviceState,
  FirmwareUpdateState,
  FirmwareUpdateLimits,
} from '../sdk/index.js';

import { settings, ConnectionType } from './settings.js';
import { log } from './ui-log.js';

const $ = id => document.getElementById(id);

let device = null;
let confirmAction = null;

let image = null;         // Uint8Array of the chosen .nmf
let fileName = '';
let job = null;

/**
 * What screen the device is on.
 *
 * Kept from the M nn notifications, not polled. The device writes M nn on
 * every mode change, so walking to the Service Menu announces itself as M 12
 * without being asked.
 *
 * The one thing notifications cannot supply is the state at the moment we
 * connect, because nothing has changed yet. That is what syncMode() is for,
 * and it runs once.
 */
let deviceMode = null;

/** Set after any failed or cancelled attempt: the BP+ must restart first. */
let restartRequired = false;

export function initFirmwareTab(options) {
  device = options.device;
  confirmAction = options.confirm;

  $('bpfirmware')?.addEventListener('change', event => {
    settings.firmwareTabEnabled = event.target.value === 'on';
    applyVisibility();
  });

  $('fw-browse')?.addEventListener('change', event => chooseFile(event.target.files[0]));
  $('fw-filename')?.addEventListener('input', () => { fileName = $('fw-filename').value; });
  $('fw-apply')?.addEventListener('click', () => startUpdate());
  $('fw-cancel')?.addEventListener('click', () => {
    if (job) job.requestCancel();
    $('fw-cancel').disabled = true;
  });

  $('fw-restart')?.addEventListener('click', () => restartDevice());

  const toggle = $('bpfirmware');
  if (toggle) toggle.value = settings.firmwareTabEnabled ? 'on' : 'off';

  device.on('state', state => {
    if (state === DeviceState.disconnected) deviceMode = null;
    else syncMode();
    refresh();
  });

  device.on('mode', mode => {
    deviceMode = mode;

    // A failed or cancelled transfer keeps hold of the device's update storage
    // until it reboots, so another attempt is refused until it has. M 00 is the
    // device saying it has restarted — better evidence than asking the operator
    // whether they did.
    if (mode.code === DeviceMode.initial && restartRequired) {
      restartRequired = false;
      appendLog('The device restarted — another update can be sent.');
    }

    refresh();
  });

  applyVisibility();
  refresh();
}

/** Called when the tab is shown, to pick up a mode we may have connected into. */
export function onFirmwareTabShown(shown) {
  if (!shown || !settings.firmwareTabEnabled) return;
  syncMode();
  refresh();
}

function applyVisibility() {
  const link = $('tab-link-firmware');
  if (link) link.style.display = settings.firmwareTabEnabled ? '' : 'none';
}

/**
 * Establish what screen the device is on, once.
 *
 * Every change after this arrives as an M nn notification, so this is only
 * needed to learn the state we connected into — nothing has changed yet, so
 * nothing has been announced. Skipped when the device has already told us.
 */
async function syncMode() {
  if (device.state !== DeviceState.connected || job) return;
  if (deviceMode) return;

  try {
    deviceMode = await device.readMode();
  } catch {
    deviceMode = null;
  }
  refresh();
}

// ── Choosing a file ──────────────────────────────────────────────────────────

async function chooseFile(file) {
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    image = new Uint8Array(buffer);
  } catch (error) {
    image = null;
    setNotice('fw-summary', 'error', `The file could not be read: ${error.message}`);
    refresh();
    return;
  }

  fileName = file.name;
  $('fw-filename').value = fileName;

  if (image.length > FirmwareUpdateLimits.imageBytesMax) {
    setNotice('fw-summary', 'error',
      `That file is ${formatBytes(image.length)}. The device accepts at most 4 MB.`);
    image = null;
    refresh();
    return;
  }

  // Built only to read back the numbers — nothing is sent.
  const preview = device.prepareFirmwareUpdate(image);
  const packets = preview.packetCount;

  setNotice('fw-summary', 'ok',
    `${escapeHtml(fileName)} — ${formatBytes(image.length)}, ${packets} packets ` +
    `of ${preview.packetSize}. Update ID ${preview.updateId}.`);

  showTransportWarning(packets, image.length);
  restartRequired = false;
  hide('fw-outcome');
  refresh();
}

/**
 * Over Bluetooth the same image is a great deal slower and a failure costs a
 * power cycle and a fresh start, so say so before the first packet rather than
 * after twenty minutes.
 */
function showTransportWarning(packets, bytes) {
  const strip = $('fw-transport-warning');
  if (!strip) return;

  if (settings.connection !== ConnectionType.bluetooth) {
    strip.style.display = 'none';
    return;
  }

  // Base64 is four characters per three bytes, plus the "k <index>," framing.
  const onTheWire = Math.round(bytes * 4 / 3) + packets * 12;

  strip.style.display = '';
  strip.className = 'inline-notice inline-notice-warn';
  strip.innerHTML =
    `<b>This is a Bluetooth connection.</b> ${packets} packets, about ` +
    `${formatBytes(onTheWire)} on the link, and Bluetooth bridges are far slower ` +
    'than a cable. The transfer is safe to interrupt, but if it fails the BP+ ' +
    'has to be restarted before another attempt — a serial connection is worth ' +
    'the trouble for a firmware update.';
}

// ── Running the update ───────────────────────────────────────────────────────

async function startUpdate() {
  if (!image || !device || job) return;

  const ok = await confirmAction(
    `Send ${escapeHtml(fileName || 'this firmware')} to the BP+?\n\n` +
    'The device will restart onto the new firmware when the transfer finishes. ' +
    'It keeps its current firmware until then, so this is safe to cancel.'
  );
  if (!ok) return;

  clearLog();
  hide('fw-outcome');
  $('fw-progress-wrap').style.display = '';

  job = device.prepareFirmwareUpdate(image);

  job.on('log', message => appendLog(message));
  job.on('state', state => {
    appendLog(`— ${state}`);
    refresh();
  });
  job.on('progress', progress => showProgress(progress));

  refresh();
  log(`Firmware update started: ${fileName} (${formatBytes(image.length)}).`);

  try {
    const outcome = await job.run();

    if (outcome === 'cancelled') {
      restartRequired = true;
      setNotice('fw-outcome', 'warn',
        '<b>Transfer cancelled.</b> Nothing was installed and the BP+ still has ' +
        'its current firmware. Use <b>Restart the BP+</b> below, then return the ' +
        'device to the Service Menu before sending another update.');
      log('Firmware update cancelled.', 'warn');
    } else {
      restartRequired = false;
      setNotice('fw-outcome', 'ok',
        '<b>Firmware installed.</b> The BP+ restarted onto the new version. ' +
        'Check the version on the device, or reconnect and read its feature list.');
      log('Firmware update complete.');
      setProgressText('Complete.');
    }
  } catch (error) {
    // Every failure leaves the device on its old firmware. The thing an
    // operator must not do next is try again without restarting.
    restartRequired = true;
    setNotice('fw-outcome', 'error',
      `<b>The update did not happen.</b> ${escapeHtml(error.message)}`);
    appendLog(`FAILED: ${error.message}`);
    log(`Firmware update failed (F ${String(error.code).padStart(2, '0')} ` +
        `${error.codeName}): ${error.message}`, 'error');
  } finally {
    job = null;

    // A successful install reboots the device, and its M 00 / M 02 arrive as
    // notifications like any other. A failure leaves it where it was and says
    // nothing further, so ask once rather than showing a stale screen name.
    if (!deviceMode) syncMode();
    refresh();
  }
}

/**
 * Restart the device with `q`.
 *
 * A cancelled or failed transfer holds the update storage until the device
 * reboots, and without this the operator has to pull the power. The device is
 * responsive after a cancel, so the soft restart works — it is only a device
 * that has actually stopped answering that needs the plug, and that is a
 * different situation with its own message.
 */
async function restartDevice() {
  if (!device || job) return;

  const ok = await confirmAction(
    'Restart the BP+?\n\n' +
    'It will run its self-test and come back at the Ready screen, so it has to ' +
    'be walked back to the Service Menu before another update.'
  );
  if (!ok) return;

  $('fw-restart').disabled = true;
  appendLog('Restarting the device…');

  try {
    await device.reboot();
    appendLog('The device restarted.');
    log('BP+ restarted.');
    // restartRequired is cleared by the boot notification, not from here:
    // the device saying it restarted is better evidence than this call
    // returning.
  } catch (error) {
    appendLog(`The restart did not complete: ${error.message}`);
    log(`Restart failed: ${error.message}`, 'error');
  } finally {
    refresh();
  }
}

function showProgress(progress) {
  const percent = progress.percent ?? 0;
  const fill = $('fw-bar-fill');
  if (fill) fill.style.width = `${percent}%`;

  const rate = progress.bytesPerSecond
    ? `${formatBytes(progress.bytesPerSecond)}/s`
    : '';
  const left = progress.secondsRemaining !== null && progress.secondsRemaining > 0
    ? `, about ${formatDuration(progress.secondsRemaining)} left`
    : '';

  setProgressText(
    `Packet ${progress.packetIndex + 1} of ${progress.packets} — ${percent}%` +
    (rate ? ` at ${rate}${left}` : '')
  );
}

function setProgressText(text) {
  const element = $('fw-progress-text');
  if (element) element.textContent = text;
}

// ── State ────────────────────────────────────────────────────────────────────

function refresh() {
  const running = job !== null;
  const connected = device && device.state === DeviceState.connected;
  const inServiceMenu = deviceMode && deviceMode.code === DeviceMode.serviceMenu;

  // Cancel is enabled only while a transfer is actually in progress.
  const cancellable = running &&
    (job.state === FirmwareUpdateState.transferring ||
     job.state === FirmwareUpdateState.opening);
  const cancel = $('fw-cancel');
  if (cancel) cancel.disabled = !cancellable || job.isCancelRequested;

  const apply = $('fw-apply');
  if (apply) apply.disabled = running || !image || !connected || !inServiceMenu || restartRequired;

  const browse = $('fw-browse');
  if (browse) browse.disabled = running;

  // Restarting is what clears a restart-required lockout, so it stays
  // available whenever the device is connected and nothing is in flight.
  const restart = $('fw-restart');
  if (restart) restart.disabled = running || !connected;

  renderDeviceStrip({ connected, inServiceMenu, running });
}

function renderDeviceStrip({ connected, inServiceMenu, running }) {
  const strip = $('fw-device');
  if (!strip) return;

  strip.style.display = '';

  if (!connected) {
    strip.className = 'inline-notice inline-notice-warn';
    strip.textContent = device && device.state === DeviceState.measuring
      ? 'A measurement is running. Firmware can only be sent to an idle device.'
      : 'Connect to a BP+ first — the button at the top of the Measure tab.';
    return;
  }

  if (restartRequired && !running) {
    strip.className = 'inline-notice inline-notice-error';
    strip.innerHTML =
      '<b>Restart the BP+ before trying again.</b> An abandoned transfer keeps ' +
      'hold of the update storage until the device reboots, and repeating the ' +
      'attempt without restarting can stop it responding altogether. Use ' +
      '<b>Restart the BP+</b> below, then walk the device back to the Service ' +
      'Menu — this page will notice when it restarts.';
    return;
  }

  if (!deviceMode) {
    strip.className = 'inline-notice';
    strip.textContent = 'Asking the device what screen it is on…';
    return;
  }

  if (!inServiceMenu) {
    strip.className = 'inline-notice inline-notice-warn';
    strip.innerHTML =
      `<b>The BP+ is on "${escapeHtml(deviceMode.text)}".</b> Firmware can only be ` +
      'sent from the Service Menu, and there is no command that gets there — ' +
      'navigate to it on the device itself using its buttons. This page will ' +
      'notice when you arrive.';
    return;
  }

  strip.className = 'inline-notice inline-notice-ok';
  strip.innerHTML = '<b>Service Menu.</b> The device is ready to receive firmware.';
}

// ── The progress log ─────────────────────────────────────────────────────────

function appendLog(message) {
  const pane = $('fw-log');
  if (!pane) return;
  const row = document.createElement('div');
  row.textContent = `${new Date().toISOString().slice(11, 19)}  ${message}`;
  pane.appendChild(row);
  pane.scrollTop = pane.scrollHeight;
}

function clearLog() {
  const pane = $('fw-log');
  if (pane) pane.textContent = '';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setNotice(id, kind, html) {
  const strip = $(id);
  if (!strip) return;
  strip.style.display = '';
  strip.className = `inline-notice inline-notice-${kind}`;
  strip.innerHTML = html;
}

function hide(id) {
  const element = $(id);
  if (element) element.style.display = 'none';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
