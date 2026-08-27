/**
 * BP+ Connect — the reference application.
 *
 * This file and its siblings in app/ are a *consumer* of the SDK in sdk/.
 * Everything that speaks the protocol lives there; everything here is
 * Framework7, DOM and settings. Delete app/ and the SDK still works — that is
 * the boundary, and it is the point.
 *
 * A worked example of each SDK feature is in the file that uses it:
 *   measure-setup.js  building measurement options, and confirming the mode
 *   tab-measure.js    live notifications during a measurement
 *   tab-results.js    reading values out of a result
 *   tab-waveform.js   the waveform arrays
 *   tab-settings.js   choosing a transport, and writing a setting to the device
 */

import {
  BpPlusDevice,
  DeviceState,
  SimulatorTransport,
  WebSerialTransport,
  WebUsbPl2303Transport,
  WebBluetoothTransport,
  AobpDefaults,
} from '../sdk/index.js';

import { settings, ConnectionType, CONNECTION_LABELS } from './settings.js';
import { initLog, log, trace } from './ui-log.js';
import {
  initMeasure, clearMeasure, beginMeasure, showMeasureResults,
  showPressure, showMode, showProgress, showError, setStatus,
  setExpectedReadings,
} from './tab-measure.js';
import {
  initMeasureSetup, applyDeviceFeatures, clearDeviceFeatures,
  measurementOptions, expectedRestSeconds, setSetupEnabled,
} from './measure-setup.js';
import { initResults, showResults, showSummary, clearResults } from './tab-results.js';
import { drawWaveforms, clearWaveforms } from './tab-waveform.js';
import { initSettingsTab } from './tab-settings.js';
import { initFirmwareTab, onFirmwareTabShown } from './tab-firmware.js';

const $ = id => document.getElementById(id);

// ── Framework7 ───────────────────────────────────────────────────────────────

// eslint-disable-next-line no-undef
const app = new Framework7({
  root: '#app',
  name: 'BP+ Connect',
  id:   'au.com.uscom.bpconnect',
  panel: { swipe: 'left' },
});

app.views.create('.view-main');

app.on('tabShow', tab => {
  // The action button belongs to the measurement tab only.
  const button = $('button-action');
  if (button) button.style.display = tab.id === 'tab1' ? '' : 'none';

  // The firmware tab tracks the device's current screen from its M nn
  // notifications; this only tells it to pick up a mode we may have connected
  // into, which nothing would have announced.
  onFirmwareTabShown(tab.id === 'tab5');
});

// ── The device ───────────────────────────────────────────────────────────────

/**
 * One transport per connection type. Constructed explicitly, from settings
 * this application owns — the SDK reads no configuration of its own.
 */
function createTransport(type) {
  switch (type) {
    case ConnectionType.bluetooth:
      return new WebBluetoothTransport({
        hardwareFlowControl: settings.hardwareFlowControl,
      });
    case ConnectionType.serial:
      return new WebSerialTransport({
        baudRate: settings.baudRate,
        flowControl: settings.hardwareFlowControl ? 'hardware' : 'none',
      });
    case ConnectionType.webserial:
      return new WebUsbPl2303Transport({ baudRate: settings.baudRate });
    case ConnectionType.simulator:
    default:
      return new SimulatorTransport();
  }
}

const device = new BpPlusDevice(createTransport(settings.connection));

device.on('log',      trace);
device.on('pressure', showPressure);
device.on('mode',     showMode);
device.on('progress', showProgress);
device.on('state',    updateActionButton);
device.on('warning',  warning => log(warning.message, 'warn'));
device.on('error',    error => log(error.message, 'error'));

// Exposed for the browser console — an integrator poking at a real device is
// the fastest way to understand the API, and this is a reference site.
window.bpplus = device;

// ── The action button ────────────────────────────────────────────────────────
//
// disconnected → connect → connected → measure → measuring → cancel

let busy = false;

async function onActionButton() {
  if (busy) return;
  busy = true;
  try {
    if (device.state === DeviceState.disconnected)   await doConnect();
    else if (device.state === DeviceState.connected) await doMeasure();
    else                                             await doCancel();
  } finally {
    busy = false;
    updateActionButton();
  }
}

async function doConnect() {
  setBusyIndicator(true);
  setStatus('Connecting', describeTransport());
  try {
    await device.connect();
    log(`Connected over ${device.transport.description}`);
    setStatus('Connected', '');
    await readDeviceIdentity();
  } catch (error) {
    // A cancelled device picker is a choice, not a fault.
    if (error.cause && error.cause.name === 'NotFoundError') {
      setStatus('', '');
      log('No device was chosen.');
    } else {
      setStatus('Not connected', error.message);
      log(error.message, 'error');
    }
  } finally {
    setBusyIndicator(false);
  }
}

/**
 * Ask the device what it is.
 *
 * Not required to take a measurement, and deliberately not fatal if it fails:
 * an older device may not answer `f`, and that is worth knowing rather than
 * worth refusing to work. When it does fail, the setup form is told so it can
 * say the mode is unknown instead of implying the page and the device agree.
 *
 * @returns {Promise<boolean>} whether the feature list was read
 */
async function readDeviceIdentity({ quiet = false } = {}) {
  if (!quiet) {
    try {
      log(`Terminal API ${await device.readApiVersion()}`);
    } catch (error) {
      log(`The device did not report its API version: ${error.message}`, 'warn');
    }
  }

  try {
    const features = await device.readFeatures();
    applyDeviceFeatures(features);

    if (!quiet) {
      log(`Device ${features.deviceId}, firmware ${features.softwareVersion}, ` +
          `measurement mode ${features.measureModeInfo.label}`);
    }
    if (features.measureMode === null) {
      log('This device did not report a measurement mode, so the page cannot ' +
          'confirm it.', 'warn');
    }
    if (features.wasRepaired) {
      log('The device feature list needed its closing tags repaired ' +
          '(firmware below 5.3.0.0).', 'warn');
    }
    return true;
  } catch (error) {
    applyDeviceFeatures(null);
    log(`The device did not report a feature list: ${error.message}`, 'warn');
    return false;
  }
}

async function doMeasure() {
  // Read the form BEFORE anything is cleared, so a rejected combination
  // leaves the previous result on screen rather than a blank one.
  let options;
  try {
    options = measurementOptions();
  } catch (error) {
    setStatus('Not started', error.message);
    log(error.message, 'error');
    return;
  }

  // Re-read the feature list immediately before starting. The measurement mode
  // is a Service Menu setting and an operator can change it at the device
  // between measurements — a page that only checked at connect would go on
  // showing a stale answer.
  await readDeviceIdentity({ quiet: true });

  // The mode may have moved out of AOBP since the form was last refreshed,
  // in which case the AOBP parameters would now be refused. Rebuild.
  try {
    options = measurementOptions();
  } catch (error) {
    setStatus('Not started', error.message);
    log(error.message, 'error');
    return;
  }

  clearMeasure();
  clearResults();
  clearWaveforms();
  setSetupEnabled(false);
  setExpectedReadings(expectedReadingCount(options));
  beginMeasure(expectedRestSeconds());

  log(`Starting: ${describeRequest(options)}`);

  try {
    const result = await device.measure(options);

    if (result.isSummary) {
      showSummary(result);
      setStatus('Ready', 'Summary line only — detail level 0');
      return;
    }

    showMeasureResults(result);
    showResults(result);
    drawWaveforms(result);
    log(`Measurement complete: ${result.summary}`);

    if (!result.crcOk) {
      log('The measurement checksum did not match. The values are shown ' +
          'but may be incomplete.', 'warn');
    }
  } catch (error) {
    showError(error);
    log(`Measurement failed (F ${String(error.code).padStart(2, '0')} ` +
        `${error.codeName}): ${error.message}`, 'error');
  } finally {
    setSetupEnabled(true);
  }
}

/** How many BP readings to expect, so the status line can count them. */
function expectedReadingCount(options) {
  if (!options.aobp) return 1;
  if (options.aobp.repeats) return options.aobp.repeats;
  const defaults = AobpDefaults[options.aobp.bodyPosition] || AobpDefaults.seated;
  return defaults.repeats;
}

function describeRequest(options) {
  const parts = [];
  parts.push(options.patientId ? `patient ${options.patientId}` : 'no patient ID');
  if (options.aobp) {
    const { bodyPosition, initialDelaySeconds, repeatDelaySeconds, repeats } = options.aobp;
    parts.push(`AOBP ${bodyPosition}`);
    if (repeats !== undefined) parts.push(`${repeats} readings`);
    if (initialDelaySeconds !== undefined) parts.push(`${initialDelaySeconds} s rest`);
    if (repeatDelaySeconds !== undefined) parts.push(`${repeatDelaySeconds} s apart`);
  }
  return parts.join(', ');
}

async function doCancel() {
  setStatus('Cancelling', '');
  try {
    await device.cancel();
  } catch (error) {
    log(error.message, 'error');
  }
}

function updateActionButton() {
  const image = $('button-action-image');
  if (!image) return;

  switch (device.state) {
    case DeviceState.disconnected:
      image.src = 'assets/button-connect.svg';
      image.alt = 'Connect';
      clearDeviceFeatures();
      break;
    case DeviceState.connected:
      image.src = 'assets/button-start.svg';
      image.alt = 'Start a measurement';
      break;
    case DeviceState.measuring:
      image.src = 'assets/button-stop.svg';
      image.alt = 'Cancel the measurement';
      break;
    default:
      break;
  }
}

function setBusyIndicator(visible) {
  const preloader = document.querySelector('.preloader-hide');
  if (preloader) preloader.style.display = visible ? '' : 'none';
}

function describeTransport() {
  return CONNECTION_LABELS[settings.connection] || settings.connection;
}

/**
 * A Framework7 dialog, not window.confirm — a native modal blocks the page and
 * would stall the device link behind it.
 */
function confirmAction(message) {
  return new Promise(resolve => {
    app.dialog.confirm(
      message.replace(/\n/g, '<br>'),
      'BP+ Connect',
      () => resolve(true),
      () => resolve(false)
    );
  });
}

// ── Start ────────────────────────────────────────────────────────────────────

initLog();
initMeasure();
initMeasureSetup();
initResults();
initSettingsTab({
  device,
  confirm: confirmAction,
  // A write restarts the device, so what the setup form believes about its
  // measurement mode is stale the moment one succeeds.
  onProvisioned: () => applyDeviceFeatures(device.features),
});
initFirmwareTab({ device, confirm: confirmAction });

$('button-action')?.addEventListener('click', event => {
  event.preventDefault();
  onActionButton();
});

updateActionButton();
setBusyIndicator(false);

// The loading overlay covers the moment before Framework7 has laid the page
// out. Everything above has run, so it can go.
const overlay = $('loading-overlay');
if (overlay) {
  overlay.style.transition = 'opacity 0.25s';
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.display = 'none'; }, 260);
}

log(`BP+ Connect ready — ${describeTransport()}`);

export { device, app };
