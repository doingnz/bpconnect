/**
 * Tab 2 — the full results table.
 *
 * Rows are declared once and filled from a BpPlusMeasurement, which resolves
 * each name through its own scoped lookup. Nothing here reaches into the XML
 * document, so the AOBP per-reading elements cannot be picked up by mistake.
 */

const MEASURES = [
  { key: 'Sys',        label: 'SYS',       unit: 'mmHg' },
  { key: 'Dia',        label: 'DIA',       unit: 'mmHg' },
  { key: 'Map',        label: 'MAP',       unit: 'mmHg' },
  { key: 'Pr',         label: 'PR',        unit: 'bpm' },
  { key: 'cSys',       label: 'cSYS',      unit: 'mmHg' },
  { key: 'cDia',       label: 'cDIA',      unit: 'mmHg' },
  { key: 'cMap',       label: 'cMAP',      unit: 'mmHg' },
  { key: 'SNR',        label: 'SNR',       unit: 'dB' },
  { key: 'sPR',        label: 'sPR',       unit: 'bpm' },
  { key: 'sPRV',       label: 'sPRV',      unit: 'ms' },
  { key: 'sAI',        label: 'sAI',       unit: '%' },
  { key: 'sDpDtMax',   label: 'sDpDtMax',  unit: 'mmHg/s' },
  { key: 'sPP',        label: 'sPP',       unit: 'mmHg' },
  { key: 'sPPV',       label: 'sPPV',      unit: '%' },
  { key: 'sRWTTFoot',  label: 'sRWTTFoot', unit: 'ms' },
  { key: 'sRWTTPeak',  label: 'sRWTTPeak', unit: 'ms' },
  { key: 'sSEP',       label: 'sSEP',      unit: 'ms' },
];

/** MeasDataLogger attributes worth showing, in the order they are shown. */
const INFO_FIELDS = [
  { key: 'datetime',         label: 'Time' },
  { key: 'guid',             label: 'GUID' },
  { key: 'device_id',        label: 'Device' },
  { key: 'software_version', label: 'Software' },
  { key: 'firmware_version', label: 'Firmware' },
  { key: 'nibp',             label: 'NIBP' },
  { key: 'nibpversion',      label: 'NIBP version' },
  { key: 'nibp_id',          label: 'NIBP serial' },
  { key: 'version',          label: 'XML version' },
  { key: 'protocolType',     label: 'Protocol' },
  { key: 'bodyPosition',     label: 'Body position' },
  { key: 'calculationType',  label: 'Calculation' },
];

let values = {};
let info   = {};
let readings = [];

export function initResults() {
  render();
}

/** @param {import('../sdk/index.js').BpPlusMeasurement} measurement */
export function showResults(measurement) {
  values = {};
  for (const row of MEASURES) {
    const value = measurement.value(row.key);
    values[row.key] = value === null ? '' : value.trim();
  }

  info = measurement.info;
  info.patientId = measurement.patientId;
  readings = measurement.readings;

  render();
}

/** Show the values from an S line, at detail level 0. */
export function showSummary(summary) {
  values = {
    Sys: str(summary.brachial.sys), Dia: str(summary.brachial.dia),
    Map: str(summary.brachial.map), Pr: str(summary.brachial.pr),
    cSys: str(summary.central.cSys), cDia: str(summary.central.cDia),
    cMap: str(summary.central.cMap), SNR: str(summary.snr),
    sPR: str(summary.indices.sPR), sPRV: str(summary.indices.sPRV),
    sAI: str(summary.indices.sAI), sPPV: str(summary.indices.sPPV),
    sSEP: str(summary.indices.sSEP), sRWTTFoot: str(summary.indices.sRWTTFoot),
    sRWTTPeak: str(summary.indices.sRWTTPeak), sDpDtMax: str(summary.indices.sDpDtMax),
  };
  info = {};
  readings = [];
  render();
}

export function clearResults() {
  values = {};
  info = {};
  readings = [];
  render();
}

function render() {
  const body = document.querySelector('#results-table tbody');
  if (body) {
    body.innerHTML = MEASURES.map(row => `
      <tr>
        <td class="label-cell">${row.label}</td>
        <td>${row.unit}</td>
        <td class="numeric-cell">${escapeHtml(values[row.key] ?? '')}</td>
      </tr>`).join('');
  }

  renderReadings();
  renderInfo();
}

/**
 * The individual readings of an AOBP or BP+ [3] measurement.
 *
 * Shown because the headline numbers in those modes are a mean, and a table
 * that presents a mean as though it were a reading is the kind of thing that
 * goes unnoticed until someone tries to reconcile it with the device screen.
 */
function renderReadings() {
  const section = document.getElementById('readings-section');
  if (!section) return;

  if (readings.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const body = section.querySelector('tbody');
  if (!body) return;

  body.innerHTML = readings.map((r, i) => `
    <tr>
      <td class="label-cell">${escapeHtml(r.id || `#${i + 1}`)}</td>
      <td class="numeric-cell">${blank(r.sys)}/${blank(r.dia)}</td>
      <td class="numeric-cell">${blank(r.map)}</td>
      <td class="numeric-cell">${blank(r.pr)}</td>
      <td class="numeric-cell">${r.actualDelaySeconds === null ? '' : `${r.actualDelaySeconds} s`}</td>
    </tr>`).join('');
}

function renderInfo() {
  const target = document.querySelector('.results-info');
  if (!target) return;

  const rows = [];
  if (info.patientId) {
    rows.push(`<p><span>Patient ID</span><b>${escapeHtml(info.patientId)}</b></p>`);
  }
  for (const field of INFO_FIELDS) {
    const value = info[field.key];
    if (value === undefined || value === null || value === '') continue;
    rows.push(`<p><span>${field.label}</span><b>${escapeHtml(String(value).trim())}</b></p>`);
  }

  target.innerHTML = rows.length ? rows.join('') : '<p><span>No measurement yet</span></p>';
}

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function blank(value) {
  return value === null || value === undefined ? '—' : String(value);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
