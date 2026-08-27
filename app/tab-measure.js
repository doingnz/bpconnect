/**
 * Tab 1 — live readings.
 *
 * The headline numbers, the cuff pressure while a measurement runs, and the
 * status line. Everything it shows comes from device events; it asks the
 * device for nothing.
 */

import { DeviceMode } from '../sdk/index.js';

const BLANK = '---';

let elements = {};

/**
 * The AOBP rest period.
 *
 * The device sends M 22 once and then nothing until the first reading, which
 * can be fifteen minutes later. Without a countdown that is indistinguishable
 * from a device that has hung, and the natural response is to power-cycle it.
 *
 * The length is not guessed: it is either the value the host asked for or the
 * protocol default for the body position, from the same constants the firmware
 * uses. It stops when M 03 arrives, whatever the clock says.
 */
let restCountdown = null;

/**
 * True while the status line is showing something worth keeping — a result or
 * a failure. M 02 arrives after both, and must not wipe them.
 */
let statusHeld = false;

export function initMeasure() {
  elements = {
    bSys:     document.getElementById('bSys'),
    bDia:     document.getElementById('bDia'),
    cSys:     document.getElementById('cSys'),
    cDia:     document.getElementById('cDia'),
    pressure: document.getElementById('status-pressure'),
    status:   document.getElementById('status-measure'),
    detail:   document.getElementById('status-detail'),
    measureBlock: document.querySelector('.block-measure'),
    statusBlock:  document.querySelector('.block-status'),
  };
  clearMeasure();
}

/** Show the numbers; hide the live-pressure block. */
export function showMeasureResults(measurement) {
  const brachial = measurement.brachial ?? {};
  const central  = measurement.central  ?? {};

  setText(elements.bSys, format(brachial.sys));
  setText(elements.bDia, format(brachial.dia));
  setText(elements.cSys, format(central.cSys));
  setText(elements.cDia, format(central.cDia));

  showBlock('measure');
  statusHeld = true;

  const readings = measurement.readings || [];
  if (readings.length > 1) {
    const protocol = measurement.protocol || {};
    const position = protocol.bodyPosition ? `, ${protocol.bodyPosition}` : '';
    setStatus('Ready', `Mean of ${readings.length} readings${position}`);
  } else {
    setStatus('Ready', measurement.crcOk === false
      ? 'Checksum mismatch — the result may be incomplete'
      : '');
  }
}

export function clearMeasure() {
  stopRestCountdown();
  statusHeld = false;
  setText(elements.bSys, BLANK);
  setText(elements.bDia, BLANK);
  setText(elements.cSys, BLANK);
  setText(elements.cDia, BLANK);
  setText(elements.pressure, BLANK);
  setStatus('', '');
  showBlock('measure');
}

/**
 * Called when a measurement starts: swap to the live-pressure view.
 * @param {number|null} [restSeconds] the AOBP rest period, if this is one
 */
export function beginMeasure(restSeconds = null) {
  stopRestCountdown();
  statusHeld = false;
  setText(elements.pressure, BLANK);
  showBlock('status');
  setStatus('Starting', '');
  pendingRestSeconds = restSeconds;
}

let pendingRestSeconds = null;

/** A cuff pressure notification. */
export function showPressure(mmHg) {
  setText(elements.pressure, String(mmHg).padStart(3, '0'));
}

/**
 * A mode notification. The device drives the status line — a host that
 * narrates its own idea of the sequence gets out of step the moment the
 * device does something it did not expect.
 */
export function showMode(mode) {
  if (mode.code !== DeviceMode.countDownAobp) stopRestCountdown();

  // A result or a failure message on the status line is worth more than a
  // running commentary on the device's lifecycle, so a held line is left
  // alone by anything that is not the device actually doing something.
  //
  // Without this, rebooting while a result is on screen replaces "Mean of 2
  // readings, standing" with "Starting up" and leaves it there — the numbers
  // still correct above a caption describing something else entirely.
  if (statusHeld && !isActivity(mode.code) && mode.code !== DeviceMode.offline) {
    return;
  }
  statusHeld = false;

  switch (mode.code) {
    case DeviceMode.countDownAobp:
      startRestCountdown(pendingRestSeconds);
      break;
    case DeviceMode.selectAobpMode:
      setStatus('Waiting', 'Select a position on the device');
      break;
    case DeviceMode.measuringBp:
      setStatus(mode.text, readingLabel());
      break;
    case DeviceMode.processData:
      setText(elements.pressure, BLANK);
      setStatus(mode.text, '');
      break;
    case DeviceMode.ready:
      setStatus('Ready', '');
      break;
    case DeviceMode.offline:
      setStatus('Offline', 'The device failed its self-test');
      break;
    default:
      setStatus(mode.text, '');
      break;
  }
}

/**
 * Modes in which the device is measuring, or about to. These take over the
 * status line even when a result is showing, because they mean a new one is
 * on its way — including one an operator started at the device rather than
 * from this page.
 */
function isActivity(code) {
  return (code >= DeviceMode.measuringBp && code <= DeviceMode.processData) ||
         code === DeviceMode.countDownAobp ||
         code === DeviceMode.selectAobpMode;
}

/**
 * In a multi-reading protocol the device sends M 03 once per reading, with no
 * index. Counting them is the only way to say which one is running, and
 * "reading 2 of 3" is what an operator standing next to the cuff wants.
 */
let readingCount = 0;
let expectedReadings = 0;

export function setExpectedReadings(count) {
  expectedReadings = count || 0;
  readingCount = 0;
}

function readingLabel() {
  if (expectedReadings <= 1) return '';
  readingCount += 1;
  return `Reading ${Math.min(readingCount, expectedReadings)} of ${expectedReadings}`;
}

function startRestCountdown(seconds) {
  stopRestCountdown();

  if (!seconds || seconds <= 0) {
    setStatus('Rest period', 'Waiting before the first reading');
    return;
  }

  const endsAt = Date.now() + seconds * 1000;

  const tick = () => {
    const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    setStatus('Rest period',
      left > 0
        ? `${formatDuration(left)} before the first reading — do not disconnect`
        : 'Starting the first reading');
    if (left === 0) stopRestCountdown();
  };

  tick();
  restCountdown = setInterval(tick, 1000);
}

function stopRestCountdown() {
  if (restCountdown === null) return;
  clearInterval(restCountdown);
  restCountdown = null;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Show the XML block arriving, which on a slow link takes a visible while. */
export function showProgress(progress) {
  if (progress.phase !== 'receiving') return;
  const percent = progress.bytesTotal
    ? Math.round((progress.bytesReceived / progress.bytesTotal) * 100)
    : 0;
  setStatus('Receiving', `${percent}% of ${Math.round(progress.bytesTotal / 1024)} KB`);
}

export function showError(error) {
  stopRestCountdown();
  statusHeld = true;
  showBlock('measure');
  setStatus('Not measured', error.message);
}

export function setStatus(text, detail = '') {
  setText(elements.status, text || ' ');
  setText(elements.detail, detail);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function showBlock(which) {
  if (elements.measureBlock) {
    elements.measureBlock.style.display = which === 'measure' ? '' : 'none';
  }
  if (elements.statusBlock) {
    elements.statusBlock.style.display = which === 'status' ? '' : 'none';
  }
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function format(value) {
  return value === null || value === undefined ? BLANK : String(value);
}
