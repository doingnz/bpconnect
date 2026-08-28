/**
 * Tab 4 — settings, provisioning and diagnostics.
 *
 * Connection type, flow control and tracing, plus what the browser can
 * actually do — the three Web APIs the transports need are not available
 * everywhere, and a page that offers a transport the browser cannot provide
 * wastes the operator's time.
 *
 * It also carries the one place this application writes a setting TO the BP+.
 * That is deliberately here and not on the measurement screen: an accepted
 * write always restarts the device, and a clinical user should not meet it on
 * the way to a measurement. It is off by default.
 */

import {
  SimulatorTransport,
  WebSerialTransport,
  UsbSerialTransport,
  recommendedTransport,
  WebBluetoothTransport,
  DeviceState,
  FeatureOption,
  SELECTABLE_MEASURE_MODES,
  describeMeasureMode,
} from '../sdk/index.js';

import { settings, ConnectionType, CONNECTION_LABELS } from './settings.js';
import { log } from './ui-log.js';

const $ = id => document.getElementById(id);

const SUPPORT = {
  [ConnectionType.simulator]: () => SimulatorTransport.isSupported,
  [ConnectionType.bluetooth]: () => WebBluetoothTransport.isSupported,
  [ConnectionType.serial]:    () => WebSerialTransport.isSupported,
  [ConnectionType.usbSerial]: () => UsbSerialTransport.isSupported,
  // Auto always resolves to something, even if only the simulator.
  [ConnectionType.auto]:      () => true,
};

let device = null;
let confirmWrite = null;
let onProvisioned = null;

/**
 * @param {object} options
 * @param {import('../sdk/index.js').BpPlusDevice} options.device
 * @param {(message: string) => Promise<boolean>} options.confirm
 *        Shown before a write, because it restarts the device.
 * @param {() => void} [options.onProvisioned]  called after a successful write
 */
export function initSettingsTab(options) {
  device        = options.device;
  confirmWrite  = options.confirm;
  onProvisioned = options.onProvisioned || (() => {});

  initConnectionControls();
  initProvisioning();

  reportBrowserSupport();
  updateBanner();

  device.on('state', () => refreshProvisioning());
}

// ── Connection, flow control, tracing ────────────────────────────────────────

function initConnectionControls() {
  const connection  = $('connection');
  const flowControl = $('bpflowcontrol');
  const tracing     = $('bptrace');

  if (connection) {
    connection.value = settings.connection;
    markUnsupportedOptions(connection);
    connection.addEventListener('change', () => {
      settings.connection = connection.value;
      log(`Connection set to ${CONNECTION_LABELS[connection.value] || connection.value}. ` +
          'Reload the page to use it.');
      showReloadNotice();
    });
  }

  if (flowControl) {
    flowControl.value = settings.hardwareFlowControl ? 'hardware' : 'none';
    flowControl.addEventListener('change', () => {
      settings.hardwareFlowControl = flowControl.value !== 'none';
      showReloadNotice();
    });
  }

  if (tracing) {
    // Takes effect immediately — nothing is cached from it.
    tracing.value = settings.traceEnabled ? 'on' : 'off';
    tracing.addEventListener('change', () => {
      settings.traceEnabled = tracing.value === 'on';
      log(`Serial tracing ${settings.traceEnabled ? 'on' : 'off'}.`);
      updateBanner();
    });
  }
}

/**
 * Label the options this browser cannot provide, rather than letting someone
 * pick one and meet the failure at connect time.
 */
function markUnsupportedOptions(select) {
  for (const option of select.options) {
    const supported = SUPPORT[option.value];
    if (supported && !supported()) {
      option.disabled = true;
      option.textContent += ' — not available in this browser';
    }
  }
}

// ── Provisioning ─────────────────────────────────────────────────────────────

function initProvisioning() {
  const toggle = $('bpprovisioning');
  const modes  = $('provision-measure-mode');
  const apply  = $('provision-apply');

  if (modes) {
    modes.innerHTML = SELECTABLE_MEASURE_MODES
      .map(mode => `<option value="${mode}">${describeMeasureMode(mode).label}</option>`)
      .join('');
  }

  if (toggle) {
    toggle.value = settings.provisioningEnabled ? 'on' : 'off';
    toggle.addEventListener('change', () => {
      settings.provisioningEnabled = toggle.value === 'on';
      refreshProvisioning();
    });
  }

  apply?.addEventListener('click', () => applyMeasureMode());
  $('features-read')?.addEventListener('click', () => readFeatures());

  refreshProvisioning();
}

function refreshProvisioning() {
  const panel = $('provisioning-panel');
  if (!panel) return;

  panel.style.display = settings.provisioningEnabled ? '' : 'none';
  if (!settings.provisioningEnabled) return;

  const features  = device.features;
  const connected = device.state === DeviceState.connected;
  const strip     = $('provisioning-device');
  const apply     = $('provision-apply');
  const modes     = $('provision-measure-mode');

  if (apply) apply.disabled = !connected || !features || !features.deviceId;

  // Reading is safe in any mode, so it only needs a connection.
  const read = $('features-read');
  if (read) read.disabled = !connected;

  if (strip) {
    if (!connected) {
      strip.style.display = '';
      strip.className = 'inline-notice inline-notice-warn';
      strip.textContent = device.state === DeviceState.measuring
        ? 'A measurement is running. Settings can only be written while the device is idle.'
        : 'Connect to a BP+ first. A write is addressed to one device by its ID.';
      return;
    }
    if (!features) {
      strip.style.display = '';
      strip.className = 'inline-notice inline-notice-warn';
      strip.textContent = 'This device did not return a feature list, so its ID is ' +
                          'unknown and nothing can be addressed to it.';
      return;
    }
    strip.style.display = '';
    strip.className = 'inline-notice inline-notice-ok';
    strip.innerHTML = `<b>${escapeHtml(features.deviceId)}</b> ` +
      `currently ${escapeHtml(features.measureModeInfo.label)}`;
  }

  if (modes && features && features.measureMode !== null && !modes.dataset.touched) {
    modes.value = String(features.measureMode);
  }
  modes?.addEventListener('change', () => { modes.dataset.touched = '1'; }, { once: true });
}

/**
 * Read the feature list and show it.
 *
 * Safe in any device mode and changes nothing, which is why it sits above the
 * write controls rather than among them: it is the thing to reach for first
 * when a device is not behaving, and it costs nothing to press.
 */
async function readFeatures() {
  const button = $('features-read');
  const output = $('features-output');
  if (!button || !output) return;

  button.disabled = true;
  output.style.display = '';
  output.textContent = 'Reading…';

  try {
    const features = await device.readFeatures();
    output.innerHTML = renderFeatures(features);
    log(`Feature list read from ${features.deviceId}.`);
    onProvisioned();
  } catch (error) {
    output.innerHTML = '<b>The device did not return a feature list.</b><br>' +
                       escapeHtml(error.message);
    log(`Could not read the feature list: ${error.message}`, 'error');
  } finally {
    refreshProvisioning();
  }
}

function renderFeatures(features) {
  const range = features.bpRange;
  const rows = [
    ['Device ID',         features.deviceId],
    ['Software',          features.softwareVersion],
    ['Firmware',          features.firmwareVersion],
    ['Hardware',          features.hardware],
    ['Measurement mode',  features.measureMode === null
                            ? 'not reported'
                            : `${features.measureModeInfo.label} (${features.measureMode})`],
    ['NIBP module',       features.nibpType],
    ['NIBP version',      features.nibpVersion],
    ['NIBP serial',       features.nibpId],
    ['PCB',               features.pcbId],
    ['Theme',             features.themeId],
    ['File prefix',       features.filePrefix],
    ['File counter',      features.filePrefixCount],
    ['Feature list',      `version ${features.version}`],
    ['SYS range',         range && range.sys ? `${range.sys.min}–${range.sys.max} mmHg` : null],
    ['DIA range',         range && range.dia ? `${range.dia.min}–${range.dia.max} mmHg` : null],
    ['MAP range',         range && range.map ? `${range.map.min}–${range.map.max} mmHg` : null],
    ['Pulse range',       range && range.hr  ? `${range.hr.min}–${range.hr.max} bpm` : null],
  ];

  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) =>
      `<tr><td>${label}</td><td>${escapeHtml(String(value).trim())}</td></tr>`)
    .join('');

  const repaired = features.wasRepaired
    ? '<p class="setup-help">This device’s feature list needed its closing tags ' +
      'repaired before it would parse.</p>'
    : '';

  return `<table>${body}</table>${repaired}`;
}

async function applyMeasureMode() {
  const modes = $('provision-measure-mode');
  const apply = $('provision-apply');
  if (!modes || !device.features) return;

  const requested = Number(modes.value);
  const current   = device.features.measureMode;
  const label     = describeMeasureMode(requested).label;

  const sameValue = current === requested;
  const ok = await confirmWrite(
    `Set this BP+ to ${label}?\n\n` +
    (sameValue
      ? 'It is already in that mode. The device restarts on any accepted write, ' +
        'even when nothing changes.'
      : 'The device will restart to apply it.')
  );
  if (!ok) return;

  apply.disabled = true;
  try {
    log(`Writing MEASUREMODE ${requested} (${label}) to ${device.features.deviceId}…`);
    const features = await device.writeFeatures([[FeatureOption.measureMode, requested]]);
    log(`Device restarted. Measurement mode is now ${features.measureModeInfo.label}.`);
    onProvisioned();
  } catch (error) {
    log(`The write was refused: ${error.message}`, 'error');
  } finally {
    refreshProvisioning();
  }
}

// ── Browser capability and banner ────────────────────────────────────────────

function reportBrowserSupport() {
  setText('serial-status-text', WebSerialTransport.isSupported ? 'yes' : 'no');
  setText('bt-status-text',     WebBluetoothTransport.isSupported ? 'yes' : 'no');
  setText('usb-status-text',    UsbSerialTransport.isSupported ? 'yes' : 'no');

  // What auto-detect would pick here, so the reason is visible before it is
  // needed rather than only in the log after a failed connection.
  const pick = recommendedTransport();
  setText('auto-status-text', pick.kind
    ? `${CONNECTION_LABELS[pick.kind] || pick.kind}`
    : 'nothing available');
  setText('secure-status-text',
    typeof isSecureContext === 'boolean' && isSecureContext ? 'yes' : 'no');
}

function showReloadNotice() {
  const notice = $('settings-reload-notice');
  if (notice) notice.style.display = '';
}

function updateBanner() {
  setText('banner-connection', CONNECTION_LABELS[settings.connection] || settings.connection);
  setText('banner-fc', settings.hardwareFlowControl ? 'HW FC' : 'No FC');
  setText('banner-trace', settings.traceEnabled ? 'Trace ●' : 'Trace ○');
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
