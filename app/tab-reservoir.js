/**
 * Tab 6 — reservoir analysis.
 *
 * Runs analysis/ on each new measurement, or on a saved BP+ XML file, and shows
 * all 89 values bpp_Res2.m writes and the four figures it draws. Where the BP+
 * reports its own result for the same quantity, that is shown alongside in the
 * device's units, not converted.
 *
 * Off by default, behind a switch in Settings. These are a research analysis of
 * the recording, not results of the device.
 *
 * Chart.js is the global the waveform tab also uses. The one plugin registered
 * here draws the reference lines and labelled markers over these charts.
 */

import {
  analyseReservoir, reservoirInput, deviceValues, COLUMNS, GROUPS, formatValue, resultsCsv,
} from '../analysis/index.js';
import { BpPlusMeasurement } from '../sdk/index.js';
import { settings } from './settings.js';

const $ = id => document.getElementById(id);

// Series colours, checked as a set for colour-vision separation. Pressure is
// the app's brachial green wherever it appears, so it reads the same on every
// chart. Region washes are labelled in the legend as well as tinted.
const PRESSURE = '#2e7d32';
const RESERVOIR = '#1565c0';
const EXCESS = '#c62828';
const MARKER = '#37474f';
const TEXT = '#444';
const MUTED = '#888';
const GRID = 'rgba(0,0,0,0.07)';

const WASH = {
  systole: 'rgba(21, 101, 192, 0.16)',
  between: 'rgba(106, 27, 154, 0.14)',
  diastole: 'rgba(198, 40, 40, 0.13)',
};

const DEVICE_TAGS = [...new Set(COLUMNS.flatMap(c => (c.device || []).map(d => d.tag)))];

const CHART_IDS = ['res-chart-pulses', 'res-chart-aortic', 'res-chart-sevr', 'res-chart-wi'];
const charts = {};

let log = () => {};
let pending = null;   // {measurement, file}: waiting for the tab to be switched on
let current = null;   // {result, device, file} or {failure}

// ── Plugin: reference lines, region labels and labelled markers ─────────────
Chart.register({
  id: 'bpReservoirMarks',
  afterDatasetsDraw(chart) {
    const marks = chart.options.plugins.bpReservoirMarks;
    if (!marks) return;

    const { ctx, chartArea: area } = chart;
    const xa = chart.scales.x;
    const ya = chart.scales.y;

    ctx.save();
    ctx.font = '10px sans-serif';

    // Labels of lines close together would overwrite each other, so each one
    // that would overlap the previous label drops a line below it.
    let previous = null;
    for (const line of marks.lines || []) {
      const px = xa.getPixelForValue(line.x);
      if (px < area.left || px > area.right) continue;
      const top = Number.isFinite(line.y) ? ya.getPixelForValue(line.y) : area.top;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, area.bottom);
      ctx.lineTo(px, top);
      ctx.stroke();
      if (line.label) {
        let y = Math.max(area.top + 10, top - 3);
        if (previous && px - previous.px < previous.width + 6 && Math.abs(y - previous.y) < 12) {
          y = previous.y + 12;
        }
        ctx.fillStyle = TEXT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(line.label, px + 3, y);
        previous = { px, y, width: ctx.measureText(line.label).width };
      }
    }

    for (const text of marks.texts || []) {
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text.label, xa.getPixelForValue(text.x), ya.getPixelForValue(text.y));
    }

    for (const point of marks.points || []) {
      const px = xa.getPixelForValue(point.x);
      const py = ya.getPixelForValue(point.y);
      ctx.fillStyle = point.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (point.shape === 'square') ctx.rect(px - 4.5, py - 4.5, 9, 9);
      else ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (point.label) {
        ctx.fillStyle = TEXT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(point.label, px + 8, py);
      }
    }

    ctx.restore();
  },
});

// ── Public API ───────────────────────────────────────────────────────────────

/** @param {{log?: function}} [options] */
export function initReservoirTab(options = {}) {
  if (options.log) log = options.log;

  const toggle = $('bpreservoir');
  if (toggle) {
    toggle.value = settings.reservoirTabEnabled ? 'on' : 'off';
    toggle.addEventListener('change', event => {
      settings.reservoirTabEnabled = event.target.value === 'on';
      applyVisibility();
      if (settings.reservoirTabEnabled && pending) run();
    });
  }

  $('res-open')?.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    // Cleared so that choosing the same file again still fires.
    event.target.value = '';
    if (file) openFile(file);
  });

  $('res-export')?.addEventListener('click', exportCsv);

  applyVisibility();
  render();
}

/**
 * Analyse a completed measurement. Deferred until the tab is switched on, so a
 * page that never shows it never runs it.
 *
 * @param {BpPlusMeasurement} measurement
 * @param {{file?: string}} [options]
 */
export function analyseMeasurement(measurement, { file } = {}) {
  pending = { measurement, file };
  if (settings.reservoirTabEnabled) run();
}

/** Forget the last analysis: a new measurement is starting. */
export function clearReservoir() {
  pending = null;
  current = null;
  render();
}

// ── Running ──────────────────────────────────────────────────────────────────

function run() {
  const { measurement, file } = pending;
  pending = null;

  try {
    const input = reservoirInput(measurement, { file });
    const result = analyseReservoir(input);
    current = { result, device: deviceValues(measurement, DEVICE_TAGS), file: input.file };

    if (!result.processed) log(`Reservoir analysis: ${result.reason}`, 'warn');
    for (const e of result.errors) log(`Reservoir analysis — ${e.section}: ${e.message}`, 'warn');
  } catch (error) {
    current = { failure: `The reservoir analysis failed: ${error.message}` };
    log(current.failure, 'error');
  }

  render();
}

async function openFile(file) {
  let measurement;
  try {
    measurement = new BpPlusMeasurement(await file.text());
  } catch (error) {
    current = { failure: `${file.name} could not be read as a BP+ measurement. ${error.message}` };
    render();
    return;
  }

  if (measurement.rootName !== 'BPplus') {
    current = {
      failure: `${file.name} is a ${measurement.rootName} file. Only BP+ measurements can be analysed here.`,
    };
    render();
    return;
  }

  pending = { measurement, file: file.name };
  run();
}

function exportCsv() {
  if (!current || !current.result) return;

  const blob = new Blob([resultsCsv([current.result.values])], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `resdata_${String(current.file || 'measurement')
    .replace(/\.xml$/i, '')
    .replace(/[^\w.-]+/g, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyVisibility() {
  const link = $('tab-link-reservoir');
  if (link) link.style.display = settings.reservoirTabEnabled ? '' : 'none';
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  destroyCharts();

  const placeholder = $('res-placeholder');
  const content = $('res-content');
  const exportButton = $('res-export');
  if (!placeholder || !content) return;

  if (exportButton) exportButton.disabled = !(current && current.result);

  if (!current || current.failure) {
    placeholder.textContent = current
      ? current.failure
      : 'Run a measurement, or open a saved BP+ XML file, to see the reservoir analysis.';
    placeholder.style.display = '';
    content.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  content.style.display = '';

  renderStatus(current.result, current.file);
  renderCharts(current.result);
  renderTables(current.result, current.device);
  renderCorrections(current.result);
}

/** Where these numbers depart from bpp_Res2.m beta7, so a comparison with it can be made. */
function renderCorrections(result) {
  const host = $('res-corrections');
  if (!host) return;
  host.innerHTML = result.corrections.length
    ? '<strong>Where this differs from bpp_Res2.m beta7</strong><ul>' +
      result.corrections.map(c => `<li>${escapeHtml(c.text)}</li>`).join('') +
      `</ul>Exported rows say so: their <code>re_resvers</code> is ${escapeHtml(result.values.re_resvers)}.`
    : '';
}

function renderStatus(result, file) {
  const source = $('res-source');
  if (source) source.textContent = [file, result.values.re_date].filter(Boolean).join(' · ');

  const notices = [];
  const v = result.values;

  if (!result.processed) {
    notices.push(['warn', escapeHtml(result.reason)]);
  } else {
    const parts = [`Signal <b>${escapeHtml(result.quality)}</b> (SNR ${escapeHtml(String(v.re_snr))} dB)`];
    if (v.re_aitype) parts.push(`Murgo <b>${escapeHtml(v.re_aitype)}</b>`);
    if (v.re_qcaofit === 1) parts.push('aortic reservoir fit <b>passed</b> its checks');
    notices.push([v.re_qcaofit === 0 ? 'warn' : 'ok', parts.join(' · ')]);

    if (v.re_qcaofit === 0) {
      notices.push(['warn',
        '<b>The aortic reservoir fit failed a quality check</b>: P∞ at or above diastolic, ' +
        'P∞ below −12 mmHg, a rate constant that is not positive, or R² below 0.9. ' +
        'Treat the aortic reservoir values with caution.']);
    }
    for (const e of result.errors) {
      notices.push(['error', `<b>${escapeHtml(e.section)}</b> could not be computed. ${escapeHtml(e.message)}`]);
    }
  }

  const host = $('res-status');
  if (host) {
    host.innerHTML = notices
      .map(([kind, html]) => `<div class="inline-notice inline-notice-${kind}">${html}</div>`)
      .join('');
  }
}

function renderCharts(result) {
  const s = result.series;
  const fs = result.values.re_sam_rate;

  showSection('res-sec-pulses', s.pulses && s.pulses.traces.length);
  if (s.pulses && s.pulses.traces.length) drawPulses(s.pulses);

  showSection('res-sec-aortic', s.aortic);
  if (s.aortic) drawAortic(s.aortic);

  showSection('res-sec-sevr', s.sevr);
  if (s.sevr) drawSevr(s.sevr, fs);

  showSection('res-sec-wi', s.waveIntensity);
  if (s.waveIntensity) drawWaveIntensity(s.waveIntensity);
}

function drawPulses({ sampleRate, traces }) {
  makeChart('res-chart-pulses', traces.map((trace, k) => ({
    label: `Pulse ${k + 1}`,
    data: trace.map((y, i) => ({ x: (i + 1) / sampleRate, y: Number.isFinite(y) ? y : null })),
    borderColor: 'rgba(46, 125, 50, 0.45)',
    borderWidth: 1.5,
  })), {
    xTitle: 'Time (s)',
    yTitle: 'BP (mmHg)',
    interaction: { mode: 'nearest', intersect: false },
  });
}

function drawAortic({ sampleRate, pressure, reservoir, excess }) {
  const at = values => values.map((y, i) => ({ x: (i + 1) / sampleRate, y }));
  makeChart('res-chart-aortic', [
    { label: 'Pressure − min', data: at(pressure), borderColor: PRESSURE },
    { label: 'Reservoir − min', data: at(reservoir), borderColor: RESERVOIR },
    { label: 'Excess pressure', data: at(excess), borderColor: EXCESS },
  ], { xTitle: 'Time (s)', yTitle: 'mmHg', legend: true });
}

/**
 * The aortic beat split into systole and diastole, as the SEVR figure shows it.
 * Which of the end of systole and the notch comes first decides the middle
 * region, exactly as bpp_Res2.m decides it.
 */
function drawSevr({ pressure, base, systoleEnd, notch, inflection }, sampleRate) {
  const n = pressure.length;
  const x = sample => sample / sampleRate;       // 1-based sample number to s

  let regions;
  if (notch === null) {
    regions = [[1, systoleEnd, WASH.systole, 'Systole'], [systoleEnd, n, WASH.diastole, 'Diastole']];
  } else if (systoleEnd <= notch) {
    regions = [
      [1, systoleEnd, WASH.systole, 'Systole'],
      [systoleEnd, notch, WASH.between, 'End of systole to notch'],
      [notch, n, WASH.diastole, 'Diastole'],
    ];
  } else {
    regions = [
      [1, notch, WASH.systole, 'Systole'],
      [notch, systoleEnd, WASH.between, 'Notch to end of systole'],
      [systoleEnd, n, WASH.diastole, 'Diastole'],
    ];
  }

  const datasets = [{
    label: 'Aortic pressure',
    data: pressure.map((y, i) => ({ x: x(i + 1), y })),
    borderColor: PRESSURE,
    order: 0,
  }];
  for (const [from, to, colour, label] of regions) {
    datasets.push({
      label,
      data: pressure.map((y, i) => ({ x: x(i + 1), y: i + 1 >= from && i + 1 <= to ? y : null })),
      borderWidth: 0,
      borderColor: colour,
      backgroundColor: colour,
      fill: { value: base },
      order: 1,
      hideFromTooltip: true,
    });
  }

  const lines = [{
    x: x(systoleEnd),
    y: pressure[systoleEnd - 1],
    color: MUTED,
    label: systoleEnd === notch ? 'max −dP/dt, notch' : 'max −dP/dt',
  }];
  if (notch !== null && notch !== systoleEnd) {
    lines.push({ x: x(notch), y: pressure[notch - 1], color: MUTED, label: 'notch' });
  }

  const points = inflection
    ? [{ x: x(inflection), y: pressure[inflection - 1], color: MARKER, label: 'T1' }]
    : [];

  makeChart('res-chart-sevr', datasets, {
    xTitle: 'Time (s)',
    yTitle: 'BP (mmHg)',
    legend: true,
    marks: {
      lines,
      points,
      texts: [
        { x: x(systoleEnd / 2), y: base + 10, label: 'SPTI' },
        { x: x(systoleEnd * 1.5), y: base + 10, label: 'DPTI' },
      ],
    },
  });
}

function drawWaveIntensity({ sampleRate, di, wf1, wb, wf2 }) {
  const points = [];
  if (wf1) points.push({ x: wf1.t, y: wf1.value, color: MARKER, label: 'Wf1' });
  if (wb && wb.t > 0) points.push({ x: wb.t, y: wb.value, color: EXCESS, label: 'Wb' });
  if (wf2) points.push({ x: wf2.t, y: wf2.value, color: MARKER, shape: 'square', label: 'Wf2' });

  makeChart('res-chart-wi', [{
    label: 'dI',
    data: di.map((y, i) => ({ x: (i + 1) / sampleRate, y })),
    borderColor: RESERVOIR,
  }], {
    xTitle: 'Time (s)',
    yTitle: 'dI (W/m²/cycle²)',
    compactY: true,
    marks: { points },
  });
}

function makeChart(id, datasets, options) {
  const canvas = $(id);
  if (!canvas) return;

  const {
    xTitle, yTitle, legend = false, marks = null, compactY = false,
    interaction = { mode: 'index', intersect: false },
  } = options;

  const yTicks = { maxTicksLimit: 6, font: { size: 9 }, color: MUTED };
  if (compactY) yTicks.callback = value => compact(value);

  charts[id] = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: datasets.map(d => ({
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0,
        fill: false,
        spanGaps: false,
        ...d,
      })),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction,
      plugins: {
        legend: {
          display: legend,
          position: 'top',
          align: 'start',
          labels: { boxWidth: 14, boxHeight: 8, font: { size: 10 }, color: TEXT },
        },
        tooltip: {
          filter: item => !item.dataset.hideFromTooltip,
          callbacks: {
            title: items => (items.length ? `${items[0].parsed.x.toFixed(3)} s` : ''),
            label: item => `${item.dataset.label}: ${compact(item.parsed.y)}`,
          },
        },
        bpReservoirMarks: marks,
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: xTitle, font: { size: 9 }, color: MUTED },
          ticks: { maxTicksLimit: 8, font: { size: 9 }, color: MUTED },
          grid: { color: GRID },
        },
        y: {
          title: { display: true, text: yTitle, font: { size: 9 }, color: MUTED },
          ticks: yTicks,
          grid: { color: GRID },
        },
      },
    },
  });
}

function destroyCharts() {
  for (const id of CHART_IDS) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }
}

function showSection(id, visible) {
  const el = $(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function renderTables(result, device) {
  const host = $('res-tables');
  if (!host) return;

  host.innerHTML = GROUPS.map(group => {
    const columns = COLUMNS.filter(c => c.group === group);
    const withDevice = columns.some(c => (c.device || []).some(d => d.tag in device));
    const corrected = new Set(result.corrections.map(k => k.column).filter(Boolean));

    const rows = columns.map(c => {
      const shown = formatValue(result.values[c.header], c);
      const deviceCell = withDevice
        ? `<td class="numeric-cell res-device">${(c.device || [])
            .filter(d => d.tag in device)
            .map(d => `${escapeHtml(String(device[d.tag]))} ${escapeHtml(d.unit)} <span class="res-tag">${escapeHtml(d.tag)}</span>`)
            .join('<br>')}</td>`
        : '';

      return `
        <tr>
          <td class="label-cell">${escapeHtml(c.label)}${corrected.has(c.header)
            ? ' <span class="res-corrected">differs from beta7</span>' : ''}<span class="res-header">${escapeHtml(c.header)}</span></td>
          <td class="numeric-cell">${shown === '' ? '<span class="res-missing">—</span>' : escapeHtml(shown)}</td>
          <td class="res-unit">${escapeHtml(c.unit)}</td>
          ${deviceCell}
        </tr>`;
    }).join('');

    return `
      <div class="data-table card res-card">
        <div class="card-header"><div class="data-table-title">${escapeHtml(group)}</div></div>
        <div class="card-content">
          <table>
            <thead>
              <tr>
                <th class="label-cell">Measure</th>
                <th class="numeric-cell">Value</th>
                <th>Unit</th>
                ${withDevice ? '<th class="numeric-cell">BP+</th>' : ''}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

function compact(value) {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 10000) return value.toLocaleString('en', { notation: 'compact', maximumSignificantDigits: 3 });
  return Number(value.toPrecision(4)).toLocaleString('en', { maximumFractionDigits: 3 });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
