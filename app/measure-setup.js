/**
 * The measurement setup form on tab 1: measurement mode, patient ID, and the
 * AOBP protocol parameters.
 *
 * Separate from tab-measure.js on purpose. That file shows what the device is
 * doing; this one collects what to ask it for. They share nothing but the tab
 * they sit on.
 *
 * Two ideas run through it:
 *
 *   The page's mode selection is an INTENTION, not a fact. The measurement
 *   mode is a Service Menu setting on the device and an operator can change it
 *   between measurements, so what the page is set to and what the device is
 *   configured for are read separately and compared. Neither warning blocks a
 *   measurement — the operator is told, and decides.
 *
 *   Ranges are checked here as well as in the SDK because the DEVICE rejects
 *   rather than clamps: an out-of-range AOBP parameter answers F 14 without
 *   saying which one was wrong. Catching it in the form is the difference
 *   between a useful message and a shrug.
 */

import {
  MeasureMode,
  SELECTABLE_MEASURE_MODES,
  AobpLimits,
  AobpDefaults,
  describeMeasureMode,
  PATIENT_ID_MAX_LENGTH,
} from '../sdk/index.js';

import { settings } from './settings.js';

const $ = id => document.getElementById(id);

/** Only letters, digits and hyphen — see commands.validatePatientId. */
const PATIENT_ID_ALLOWED = /[^A-Za-z0-9-]/g;

let elements = {};

/** The measurement mode the device last reported, or null if it did not say. */
let deviceMeasureMode = null;
let deviceReported = false;

export function initMeasureSetup() {
  elements = {
    mode:        $('measure-mode'),
    modeWarning: $('measure-mode-warning'),
    patientId:   $('patient-id'),
    aobpGroup:   $('aobp-group'),
    aobpNotice:  $('aobp-notice'),
    aobpError:   $('aobp-error'),
    bodyPosition:  $('aobp-body-position'),
    initialDelay:  $('aobp-initial-delay'),
    repeatDelay:   $('aobp-repeat-delay'),
    repeats:       $('aobp-repeats'),
  };

  buildModeOptions();
  restore();
  attachHandlers();
  refresh();
}

function buildModeOptions() {
  if (!elements.mode) return;
  elements.mode.innerHTML = SELECTABLE_MEASURE_MODES
    .map(mode => `<option value="${mode}">${describeMeasureMode(mode).label}</option>`)
    .join('');
}

function restore() {
  if (elements.mode) elements.mode.value = String(settings.measureMode);

  const aobp = settings.aobp;
  setValue(elements.bodyPosition, aobp.bodyPosition);
  setValue(elements.initialDelay, aobp.initialDelaySeconds);
  setValue(elements.repeatDelay,  aobp.repeatDelaySeconds);
  setValue(elements.repeats,      aobp.repeats);
}

function attachHandlers() {
  elements.mode?.addEventListener('change', () => {
    settings.measureMode = Number(elements.mode.value);
    refresh();
  });

  // Filter as the operator types rather than rejecting on submit. The device
  // stores whatever it is sent, verbatim, straight into <PatientID> — a comma
  // shifts every following parameter and an angle bracket makes the result
  // file unparseable, so nothing invalid should ever reach the field.
  elements.patientId?.addEventListener('input', () => {
    const field = elements.patientId;
    const cleaned = field.value.replace(PATIENT_ID_ALLOWED, '').slice(0, PATIENT_ID_MAX_LENGTH);
    if (cleaned === field.value) return;

    const caret = field.selectionStart - (field.value.length - cleaned.length);
    field.value = cleaned;
    field.setSelectionRange(caret, caret);
  });

  for (const field of ['bodyPosition', 'initialDelay', 'repeatDelay', 'repeats']) {
    elements[field]?.addEventListener('change', () => {
      settings.aobp = {
        bodyPosition:        value(elements.bodyPosition),
        initialDelaySeconds: value(elements.initialDelay),
        repeatDelaySeconds:  value(elements.repeatDelay),
        repeats:             value(elements.repeats),
      };
      refresh();
    });
  }
}

// ── What the device says ─────────────────────────────────────────────────────

/**
 * Record what the device reported, and re-evaluate the warnings.
 *
 * @param {import('../sdk/index.js').BpPlusFeatures|null} features
 *        null when the device could not be asked at all.
 */
export function applyDeviceFeatures(features) {
  deviceReported   = features !== null;
  deviceMeasureMode = features ? features.measureMode : null;
  refresh();
}

/** Forget what the device said — on disconnect. */
export function clearDeviceFeatures() {
  deviceReported = false;
  deviceMeasureMode = null;
  refresh();
}

// ── Reading the form ─────────────────────────────────────────────────────────

export function selectedMeasureMode() {
  return elements.mode ? Number(elements.mode.value) : settings.measureMode;
}

export function patientId() {
  return elements.patientId ? elements.patientId.value.trim() : '';
}

/**
 * Options for BpPlusDevice.measure(), or throw with a message the operator can
 * act on.
 *
 * AOBP parameters are included only when the page is set to AOBP AND the
 * device reports it is in AOBP. Any other combination would send a command the
 * firmware answers F 14 to, because the body position is refused outright when
 * DeviceMeasurementMode is not BPplusAOBP.
 */
export function measurementOptions() {
  const options = { patientId: patientId() };

  if (!aobpControlsActive()) return options;

  const aobp = readAobpFields();
  if (!aobp) return options;             // nothing filled in — device defaults
  options.aobp = aobp;
  return options;
}

/**
 * The AOBP fields as the SDK wants them, or null when the group is empty.
 * Throws a plain Error with an operator-facing message when the combination
 * cannot work.
 */
function readAobpFields() {
  const bodyPosition        = value(elements.bodyPosition);
  const initialDelaySeconds = value(elements.initialDelay);
  const repeatDelaySeconds  = value(elements.repeatDelay);
  const repeats             = value(elements.repeats);

  const hasQualifier = initialDelaySeconds !== '' ||
                       repeatDelaySeconds  !== '' ||
                       repeats             !== '';

  if (bodyPosition === '') {
    if (!hasQualifier) return null;
    // The 6th to 8th parameters of `s` are only valid with the 5th; supplied
    // on their own the device answers F 14 rather than ignoring them.
    throw new Error(
      'Choose a body position, or clear the delay and repeat boxes. ' +
      'Those settings only apply to an AOBP run.'
    );
  }

  const number = (raw, limits, label) => {
    if (raw === '') return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < limits.min || parsed > limits.max) {
      throw new Error(`${label} must be a whole number between ${limits.min} and ${limits.max}.`);
    }
    return parsed;
  };

  return {
    bodyPosition,
    initialDelaySeconds: number(initialDelaySeconds, AobpLimits.initialDelaySeconds, 'The initial rest period'),
    repeatDelaySeconds:  number(repeatDelaySeconds,  AobpLimits.repeatDelaySeconds,  'The delay between measurements'),
    repeats:             number(repeats,             AobpLimits.repeats,             'The number of measurements'),
  };
}

/**
 * How long the device will rest before the first reading, for the countdown.
 * @returns {number|null} seconds, or null when this is not an AOBP run
 */
export function expectedRestSeconds() {
  if (!aobpControlsActive()) return null;

  const position = value(elements.bodyPosition);
  if (position === '') return null;

  const override = value(elements.initialDelay);
  if (override !== '') return Number(override);

  return (AobpDefaults[position] || AobpDefaults.seated).initialDelaySeconds;
}

/** Lock the form while a measurement runs. */
export function setSetupEnabled(enabled) {
  for (const key of ['mode', 'patientId', 'bodyPosition', 'initialDelay', 'repeatDelay', 'repeats']) {
    if (elements[key]) elements[key].disabled = !enabled;
  }
  if (!enabled) return;
  refresh();   // re-apply the AOBP group's own enablement
}

// ── Warnings and enablement ──────────────────────────────────────────────────

function aobpControlsActive() {
  return selectedMeasureMode() === MeasureMode.bpPlusAobp &&
         deviceMeasureMode === MeasureMode.bpPlusAobp;
}

function refresh() {
  renderModeWarning();
  renderAobpGroup();
  renderAobpError();
}

function renderModeWarning() {
  const strip = elements.modeWarning;
  if (!strip) return;

  // Nothing to compare against until the device has been asked.
  if (!deviceReported) {
    strip.style.display = 'none';
    return;
  }

  if (deviceMeasureMode === null) {
    // The device answered `f` but reported no <measureMode>. Firmware below
    // the feature list that carries it does this, and so does a device whose
    // feature XML would not parse.
    show(strip, 'warn', 'Measure Mode is unknown',
      'This device did not report a measurement mode, so the setting above ' +
      'cannot be confirmed. The measurement will use whatever the device is ' +
      'configured for.');
    return;
  }

  const selected = selectedMeasureMode();
  if (deviceMeasureMode === selected) {
    show(strip, 'ok', `Device confirmed: ${describeMeasureMode(selected).label}`, '');
    return;
  }

  show(strip, 'warn',
    `Device is in ${describeMeasureMode(deviceMeasureMode).label}`,
    `This page is set to ${describeMeasureMode(selected).label}. The ` +
    'measurement will follow the device, not this page. The mode is a Service ' +
    'Menu setting on the BP+.');
}

function renderAobpGroup() {
  const group = elements.aobpGroup;
  if (!group) return;

  const wantsAobp = selectedMeasureMode() === MeasureMode.bpPlusAobp;
  group.style.display = wantsAobp ? '' : 'none';
  if (!wantsAobp) return;

  const active = aobpControlsActive();
  for (const key of ['bodyPosition', 'initialDelay', 'repeatDelay', 'repeats']) {
    if (elements[key]) elements[key].disabled = !active;
  }

  const notice = elements.aobpNotice;
  if (!notice) return;

  if (active) {
    notice.style.display = 'none';
    return;
  }

  notice.style.display = '';
  notice.textContent = deviceReported
    ? 'These settings need the device itself to be configured for BP+ AOBP. ' +
      'It is not, so they are unavailable — the device would refuse them.'
    : 'Connect to a BP+ to use these settings.';
}

function renderAobpError() {
  const strip = elements.aobpError;
  if (!strip) return;

  if (!aobpControlsActive()) {
    strip.style.display = 'none';
    return;
  }

  try {
    readAobpFields();
    strip.style.display = 'none';
  } catch (error) {
    strip.style.display = '';
    strip.textContent = error.message;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function show(strip, kind, title, detail) {
  strip.style.display = '';
  strip.className = `inline-notice inline-notice-${kind}`;
  strip.innerHTML = detail
    ? `<b>${escapeHtml(title)}</b> ${escapeHtml(detail)}`
    : `<b>${escapeHtml(title)}</b>`;
}

function value(element) {
  return element ? element.value.trim() : '';
}

function setValue(element, raw) {
  if (element) element.value = raw ?? '';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
