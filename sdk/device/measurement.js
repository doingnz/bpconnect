/**
 * A BP+ measurement result.
 *
 * Wraps the XML the device returns at detail level 4 and exposes it as typed
 * values, while keeping the raw text so an integrator who wants something this
 * class does not surface can go and get it.
 *
 * Element lookup is SCOPED, which matters more than it looks. In AOBP and
 * BP+ [3] the document carries a <NibpBloodPressures> block with one
 * <NibpBloodPressure> per reading, and each of those has its own <Sys>, <Dia>,
 * <Map> and <Pr>. A document-wide getElementsByTagName('Sys')[0] returns the
 * averaged value only because the average happens to be serialised first — it
 * is right by element ordering alone, and a future firmware that reordered
 * them would silently swap an average for a single reading.
 *
 * So:
 *   brachial values  direct children of <MeasDataLogger>
 *   analysis values  children of <Results><Result>
 *   per reading      children of each <NibpBloodPressure>
 *
 * The two sets do not overlap: Result has no Sys/Dia/Map/Pr, and
 * MeasDataLogger has no cSys/SNR/sAI.
 */

import { receiveError } from '../core/errors.js';

export class BpPlusMeasurement {

  /**
   * @param {string}  xml
   * @param {object} [meta]
   * @param {boolean} [meta.crcOk]     false when the block checksum did not match
   * @param {number}  [meta.sizeBytes]
   */
  constructor(xml, meta = {}) {
    this.xml       = xml;
    this.crcOk     = meta.crcOk !== false;
    this.sizeBytes = meta.sizeBytes ?? null;
    this.receivedAt = new Date();

    const parsed = new DOMParser().parseFromString(xml, 'text/xml');
    const failure = parsed.getElementsByTagName('parsererror')[0];
    if (failure) {
      throw receiveError(
        'The measurement XML could not be parsed: ' +
        (failure.textContent || '').trim().split('\n')[0]
      );
    }

    this.document = parsed;
    this._root    = parsed.documentElement;
    this._logger  = firstChildNamed(this._root, 'MeasDataLogger');
    this._result  = this._findResult();

    if (!this._logger) {
      throw receiveError('The measurement XML has no MeasDataLogger element.');
    }
  }

  _findResult() {
    const results = firstChildNamed(this._root, 'Results');
    return results ? firstChildNamed(results, 'Result') : null;
  }

  // ── Identity and provenance ───────────────────────────────────────────────

  /** The document version: 6.0 for a single reading, 7.0 for AOBP and BP+ [3]. */
  get version() { return this._root.getAttribute('version'); }

  get rootName() { return this._root.nodeName; }   // 'BPplus', or 'CardioScope'

  get patientId() {
    const el = firstChildNamed(this._root, 'PatientID');
    return el ? text(el) : '';
  }

  /** Every attribute of <MeasDataLogger>, as a plain object. */
  get info() {
    const out = {};
    for (const attr of this._logger.attributes) out[attr.name] = attr.value;
    return out;
  }

  get guid()      { return this._logger.getAttribute('guid'); }
  get deviceId()  { return this._logger.getAttribute('device_id'); }
  get timestamp() { return this._logger.getAttribute('datetime'); }

  // ── Values ────────────────────────────────────────────────────────────────

  /** Brachial pressures, from the direct children of <MeasDataLogger>. */
  get brachial() {
    return {
      sys: this.number('Sys'),
      dia: this.number('Dia'),
      map: this.number('Map'),
      pr:  this.number('Pr'),
    };
  }

  /** Central pressures and the pulse-wave indices, from <Result>. */
  get central() {
    return {
      cSys: this.number('cSys'),
      cDia: this.number('cDia'),
      cMap: this.number('cMap'),
    };
  }

  get indices() {
    return {
      snr:        this.number('SNR'),
      sPR:        this.number('sPR'),
      sPRV:       this.number('sPRV'),
      sAI:        this.number('sAI'),
      sPP:        this.number('sPP'),
      sPPV:       this.number('sPPV'),
      sSEP:       this.number('sSEP'),
      sRWTTFoot:  this.number('sRWTTFoot'),
      sRWTTPeak:  this.number('sRWTTPeak'),
      sDpDtMax:   this.number('sDpDtMax'),
    };
  }

  get alert() {
    const el = firstChildNamed(this._logger, 'Alert');
    return el ? text(el) : '';
  }

  /**
   * One named value, looked up in <Result> first and then among the direct
   * children of <MeasDataLogger> — never inside a per-reading block.
   *
   * @returns {string|null}
   */
  value(tag) {
    if (this._result) {
      const fromResult = firstChildNamed(this._result, tag);
      if (fromResult) return text(fromResult);
    }
    const fromLogger = firstChildNamed(this._logger, tag);
    return fromLogger ? text(fromLogger) : null;
  }

  /** @returns {number|null} */
  number(tag) {
    const raw = this.value(tag);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** A comma-separated waveform or index array. @returns {number[]} */
  array(tag) {
    const raw = this.value(tag);
    if (!raw) return [];
    return raw.split(',').map(Number);
  }

  // ── Multi-reading protocols: AOBP and BP+ [3] ─────────────────────────────

  /** True when the result carries individual BP readings. */
  get isMultiReading() { return this.readings.length > 0; }

  /**
   * The individual BP readings, in the order the device recorded them.
   * Empty for a single-reading measurement.
   */
  get readings() {
    if (this._readings) return this._readings;

    const block = firstChildNamed(this._logger, 'NibpBloodPressures');
    this._readings = block
      ? childrenNamed(block, 'NibpBloodPressure').map(el => ({
          id:       el.getAttribute('id'),
          sys:      childNumber(el, 'Sys'),
          dia:      childNumber(el, 'Dia'),
          map:      childNumber(el, 'Map'),
          pr:       childNumber(el, 'Pr'),
          dateTime: childText(el, 'DateTime'),
          alert:    childText(el, 'Alert'),
          irregularHeartBeat: childText(el, 'IrregularHeartBeat'),
          motionDetected:     childText(el, 'MotionDetected'),
          // Present only for AOBP and BP+ [3]: the delay asked for, and the
          // delay actually taken before this reading.
          requestedDelaySeconds: childNumber(el, 'AobpRequestedDelay'),
          actualDelaySeconds:    childNumber(el, 'AobpDelay'),
        }))
      : [];

    return this._readings;
  }

  /**
   * The protocol this measurement was recorded under.
   * `type` is null for an ordinary BP+ measurement.
   */
  get protocol() {
    const included = this._logger.getAttribute('includedMeasurements');
    return {
      type:            this._logger.getAttribute('protocolType'),
      bodyPosition:    this._logger.getAttribute('bodyPosition'),
      calculationType: this._logger.getAttribute('calculationType'),
      includedMeasurements: included ? included.split(',') : [],
    };
  }

  /** A one-line summary, for logs and for the reference UI's status line. */
  get summary() {
    const b = this.brachial;
    const c = this.central;
    const count = this.readings.length;
    const suffix = count > 1 ? ` (mean of ${count})` : '';
    return `${b.sys}/${b.dia} mmHg, central ${c.cSys}/${c.cDia} mmHg${suffix}`;
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
// Scoped to direct children on purpose — see the note at the top of the file.

function firstChildNamed(parent, tag) {
  if (!parent) return null;
  for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
    if (node.nodeName === tag) return node;
  }
  return null;
}

function childrenNamed(parent, tag) {
  const out = [];
  if (!parent) return out;
  for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
    if (node.nodeName === tag) out.push(node);
  }
  return out;
}

function text(el) {
  return el.textContent === null ? '' : el.textContent;
}

function childText(parent, tag) {
  const el = firstChildNamed(parent, tag);
  return el ? text(el) : null;
}

function childNumber(parent, tag) {
  const raw = childText(parent, tag);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
