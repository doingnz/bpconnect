/**
 * Everything this application stores between visits.
 *
 * The only place in the app that touches localStorage. Nothing in sdk/ reads
 * or writes it at all — a device is constructed with an explicit transport,
 * and an integrator's own settings mechanism replaces this file wholesale.
 */

const KEYS = {
  connection:  'bpconnection',
  flowControl: 'bpflowcontrol',
  trace:       'bptrace',
  baudRate:    'bpconnrate',
  measureMode: 'bpmeasuremode',
  aobp:        'bpaobp',
  provisioning:'bpprovisioning',
  firmwareTab: 'bpfirmware',
  reservoirTab:'bpreservoir',
  reservoirBrachial: 'bpresbrachial',
  reservoirNormalise: 'bpresnormalise',
};

export const ConnectionType = Object.freeze({
  auto:      'auto',        // pick what this browser can do — see sdk/transports/detect.js
  simulator: 'simulator',
  bluetooth: 'bluetooth',
  serial:    'serial',      // Web Serial: desktop Chrome and Edge
  usbSerial: 'usb-serial',  // WebUSB + a chip driver: the only cable path on Android
});

export const CONNECTION_LABELS = Object.freeze({
  auto:         'Auto-detect',
  simulator:    'Simulator',
  bluetooth:    'Bluetooth',
  serial:       'Serial',
  'usb-serial': 'USB Serial (Prolific PL2303)',
});

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    // Private browsing, or storage disabled. Defaults still work.
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing useful to do — the setting simply will not persist.
  }
}

export const settings = {

  get connection() {
    // 'bluetooth-nus' is a legacy value; one transport now handles every
    // bridge profile, so it maps onto plain 'bluetooth'.
    const stored = read(KEYS.connection, ConnectionType.simulator);
    // Two renames since this key was introduced, so a setting stored by an
    // older build still resolves rather than falling back to the simulator.
    if (stored === 'bluetooth-nus') return ConnectionType.bluetooth;
    if (stored === 'webserial')     return ConnectionType.usbSerial;
    return stored;
  },
  set connection(value) { write(KEYS.connection, value); },

  /**
   * Hardware flow control. Applies to the uConnect S2B5232I adapter, which
   * takes it as a configuration byte; the BP+ must have it enabled to match.
   * Recommended on Android, where the BLE link cannot keep up with 115200 baud
   * during an XML transfer and data is otherwise lost.
   */
  get hardwareFlowControl() { return read(KEYS.flowControl, 'hardware') !== 'none'; },
  set hardwareFlowControl(enabled) {
    write(KEYS.flowControl, enabled ? 'hardware' : 'none');
  },

  get traceEnabled() { return read(KEYS.trace, 'off') === 'on'; },
  set traceEnabled(enabled) { write(KEYS.trace, enabled ? 'on' : 'off'); },

  get baudRate() { return Number(read(KEYS.baudRate, '115200')) || 115200; },
  set baudRate(rate) { write(KEYS.baudRate, String(rate)); },

  /**
   * The measurement mode this page is set up for.
   *
   * This is what the host INTENDS. What the device is actually configured for
   * comes from `f`, and the two are compared rather than assumed equal —
   * the mode is a Service Menu setting and an operator can change it at the
   * device between measurements.
   */
  get measureMode() { return Number(read(KEYS.measureMode, '0')); },
  set measureMode(mode) { write(KEYS.measureMode, String(mode)); },

  /**
   * The AOBP protocol parameters, each blank by default so the device applies
   * its own. Persisted because a study runs the same protocol every time; the
   * patient ID deliberately is not, because it does not.
   *
   * @returns {{bodyPosition: string, initialDelaySeconds: string,
   *            repeatDelaySeconds: string, repeats: string}}
   */
  get aobp() {
    const blank = {
      bodyPosition: '',
      initialDelaySeconds: '',
      repeatDelaySeconds: '',
      repeats: '',
    };
    try {
      return { ...blank, ...JSON.parse(read(KEYS.aobp, '{}')) };
    } catch {
      return blank;
    }
  },
  set aobp(values) { write(KEYS.aobp, JSON.stringify(values)); },

  /**
   * Whether the Settings tab offers to write settings to the device.
   *
   * Off by default. An accepted write always reboots the BP+, so it is kept
   * away from the measurement screen and behind a switch an engineer turns on
   * deliberately.
   */
  get provisioningEnabled() { return read(KEYS.provisioning, 'off') === 'on'; },
  set provisioningEnabled(enabled) { write(KEYS.provisioning, enabled ? 'on' : 'off'); },

  /**
   * Whether the firmware-update tab is shown. Off by default: it is a service
   * action, and a clinical user should not meet it on the way to a
   * measurement.
   */
  get firmwareTabEnabled() { return read(KEYS.firmwareTab, 'off') === 'on'; },
  set firmwareTabEnabled(enabled) { write(KEYS.firmwareTab, enabled ? 'on' : 'off'); },

  /**
   * Whether the reservoir analysis tab is shown. Off by default: its values
   * are a research analysis of the recording, not results of the device, and
   * should not sit next to the ones that are unless someone asked for them.
   */
  get reservoirTabEnabled() { return read(KEYS.reservoirTab, 'off') === 'on'; },
  set reservoirTabEnabled(enabled) { write(KEYS.reservoirTab, enabled ? 'on' : 'off'); },

  /**
   * Where the reservoir tab takes the brachial beat and the pulse traces from:
   * 'sBaseLined' (sAveragePulse scaled to the cuff pressures, and sBaseLined
   * scaled the same way) or 'baEstimate'. See BRACHIAL_SOURCES in analysis/.
   */
  get reservoirBrachial() {
    return read(KEYS.reservoirBrachial, 'sBaseLined') === 'baEstimate' ? 'baEstimate' : 'sBaseLined';
  },
  set reservoirBrachial(source) {
    write(KEYS.reservoirBrachial, source === 'baEstimate' ? 'baEstimate' : 'sBaseLined');
  },

  /** Whether sAveragePulse is normalised to 0–1 before it is scaled. Off, as in beta7. */
  get reservoirNormalise() { return read(KEYS.reservoirNormalise, 'off') === 'on'; },
  set reservoirNormalise(enabled) { write(KEYS.reservoirNormalise, enabled ? 'on' : 'off'); },
};

export { KEYS as SETTING_KEYS };
