/**
 * The reservoir analysis input, from a measurement.
 *
 * Takes anything that answers `value(tag)` — a BpPlusMeasurement does, scoping
 * each lookup to <Result> and then the direct children of <MeasDataLogger>, so
 * the headline Sys/Dia/Map/Pr of an AOBP result are the mean rather than one
 * reading. The analysis itself never sees XML.
 *
 * Numbers are parsed the way MATLAB's str2double parses them: an empty or
 * unreadable value is NaN, not zero.
 */

/**
 * @param {{value(tag: string): string|null, info?: object, document?: Document}} measurement
 * @param {{file?: string}} [options]
 * @returns {import('./reservoir.js').ReservoirInput}
 */
export function reservoirInput(measurement, { file } = {}) {
  const number = tag => parseNumber(measurement.value(tag));
  const array = tag => parseArray(measurement.value(tag));
  const info = measurement.info || {};

  return {
    file: file ?? defaultFileName(info),
    datetime: info.datetime ?? '',
    softwareVersion: info.version ?? '',
    algorithmRevision: resultAttribute(measurement, 'algorithm_revision'),

    sampleRate: number('SampleRate'),
    snr: number('SNR'),

    sys: number('Sys'),
    dia: number('Dia'),
    map: number('Map'),
    pr: number('Pr'),

    cSys: number('cSys'),
    cDia: number('cDia'),
    cMap: number('cMap'),

    sPRV: number('sPRV'),
    sAI: number('sAI'),
    sPPV: number('sPPV'),
    sRWTTFoot: number('sRWTTFoot'),
    sRWTTPeak: number('sRWTTPeak'),
    sSEP: number('sSEP'),

    sAveragePulse: array('sAveragePulse'),
    cAveragePulse: array('cAveragePulse'),
    baEstimate: array('baEstimate'),
    sPulseStartIndexes: array('sPulseStartIndexes'),
    sSelectedPulseIndexes: array('sSelectedPulseIndexes'),
  };
}

/**
 * The BP+'s own values for the quantities columns.js pairs with a device tag,
 * as {tag: number}. Absent tags are left out.
 */
export function deviceValues(measurement, tags) {
  const out = {};
  for (const tag of tags) {
    const n = parseNumber(measurement.value(tag));
    if (Number.isFinite(n)) out[tag] = n;
  }
  return out;
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  const text = String(raw).trim();
  return text === '' ? NaN : Number(text);
}

function parseArray(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return [];
  return String(raw).split(',').map(parseNumber);
}

function resultAttribute(measurement, name) {
  const doc = measurement.document;
  if (!doc || typeof doc.getElementsByTagName !== 'function') return '';
  const result = doc.getElementsByTagName('Result')[0];
  return result ? (result.getAttribute(name) || '') : '';
}

function defaultFileName(info) {
  if (info.guid) return `BPplus_${info.guid}.xml`;
  return 'BPplus measurement';
}
