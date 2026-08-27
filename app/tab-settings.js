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
  WebUsbPl2303Transport,
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
  [ConnectionType.webserial]: () => WebUsbPl2303Transport.isSupported,
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
  setText('usb-status-text',    WebUsbPl2303Transport.isSupported ? 'yes' : 'no');
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
