/**
 * Tab 3 — pulse-wave charts.
 *
 * Five Chart.js line charts drawn from a BpPlusMeasurement. Chart.js is a
 * global (loaded as a classic script by index.html) because it ships as UMD
 * and this project has no bundler.
 *
 * Waveform arrays are read through the measurement's scoped accessor rather
 * than from the XML document directly, so an AOBP result cannot pick up a
 * per-reading element by mistake.
 */

// ── Plugin: beat-start vertical lines ────────────────────────────────────────
Chart.register({
    id: 'bpBeatMarker',
    afterDatasetsDraw(chart) {
        const opts = chart.options.plugins.bpBeatMarker;
        if (!opts || !opts.indexes || !opts.indexes.length) return;

        const ctx = chart.ctx;
        const xa  = chart.scales.x;
        const ya  = chart.scales.y;

        ctx.save();
        ctx.strokeStyle = 'rgba(211, 47, 47, 0.55)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 3]);

        for (const i of opts.indexes) {
            const px = xa.getPixelForValue(i);
            ctx.beginPath();
            ctx.moveTo(px, ya.top);
            ctx.lineTo(px, ya.bottom);
            ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.restore();
    }
});

// ── Plugin: feature-point filled dots ────────────────────────────────────────
Chart.register({
    id: 'bpFeatureDots',
    afterDatasetsDraw(chart) {
        const opts = chart.options.plugins.bpFeatureDots;
        if (!opts || !opts.indexes || !opts.indexes.length) return;

        const ctx  = chart.ctx;
        const meta = chart.getDatasetMeta(0);

        ctx.save();
        for (const i of opts.indexes) {
            const pt = meta.data[i];
            if (!pt) continue;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle   = '#e65100';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth   = 1.5;
            ctx.stroke();
        }
        ctx.restore();
    }
});

// ── Plugin: dashed horizontal reference lines with a label ───────────────────
Chart.register({
    id: 'bpReferenceLines',
    afterDatasetsDraw(chart) {
        const opts = chart.options.plugins.bpReferenceLines;
        if (!opts || !opts.lines || !opts.lines.length) return;

        const ctx = chart.ctx;
        const xa  = chart.scales.x;
        const ya  = chart.scales.y;

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.2;
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'bottom';

        for (const line of opts.lines) {
            const py = ya.getPixelForValue(line.value);
            if (py < ya.top || py > ya.bottom) continue;

            ctx.strokeStyle = line.color;
            ctx.beginPath();
            ctx.moveTo(xa.left, py);
            ctx.lineTo(xa.right, py);
            ctx.stroke();

            ctx.fillStyle = line.color;
            ctx.fillText(line.label + ' ' + Math.round(line.value), xa.left + 4, py - 2);
        }

        ctx.setLineDash([]);
        ctx.restore();
    }
});

// ── Chart instance cache ──────────────────────────────────────────────────────
const _wfCharts = {};

// ── Helpers ───────────────────────────────────────────────────────────────────


/**
 * Create (or recreate) one Chart.js line chart.
 *
 * @param {string}   canvasId    - id of the <canvas> element
 * @param {string}   label       - human-readable signal name
 * @param {string}   color       - CSS colour for the waveform line
 * @param {number[]} data        - y-values (index = sample number)
 * @param {number[]} beatIndexes - sample indexes for beat-start markers (may be null/[])
 * @param {number[]} dotIndexes  - sample indexes for feature dots      (may be null/[])
 */
function _renderChart(canvasId, label, color, data, beatIndexes, dotIndexes) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Destroy previous instance so canvas can be reused cleanly
    if (_wfCharts[canvasId]) {
        _wfCharts[canvasId].destroy();
        delete _wfCharts[canvasId];
    }

    // Use {x, y} objects so the linear x-axis maps sample index correctly
    const xyData = data.map((y, i) => ({ x: i, y }));

    _wfCharts[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
            datasets: [{
                label:       label,
                data:        xyData,
                borderColor: color,
                borderWidth: 1.2,
                pointRadius: 0,       // no per-point markers on the main line
                tension:     0,
                fill:        false,
            }]
        },
        options: {
            animation:           false,    // essential for 2000+ point arrays
            responsive:          true,
            maintainAspectRatio: false,

            plugins: {
                legend:        { display: false },
                tooltip:       { enabled: false },
                bpBeatMarker:  { indexes: beatIndexes || [] },
                bpFeatureDots: { indexes: dotIndexes  || [] },
            },

            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        maxTicksLimit: 6,
                        font: { size: 9 },
                        color: '#888',
                    },
                    grid: { color: 'rgba(0,0,0,0.07)' },
                },
                y: {
                    ticks: {
                        maxTicksLimit: 4,
                        font: { size: 9 },
                        color: '#888',
                    },
                    grid: { color: 'rgba(0,0,0,0.07)' },
                },
            },
        }
    });
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Draw all five charts from a measurement.
 * @param {import('../sdk/index.js').BpPlusMeasurement} measurement
 */
export function drawWaveforms(measurement) {
    const placeholder = document.getElementById('waveform-placeholder');
    const container   = document.getElementById('waveform-charts');

    const sBaseLined = measurement.array('sBaseLined');
    if (sBaseLined.length === 0) {
        // BP-only measurements carry no suprasystolic waveform.
        if (placeholder) {
            placeholder.textContent =
                'This measurement has no pulse-wave data to draw.';
            placeholder.style.display = '';
        }
        if (container) container.style.display = 'none';
        return;
    }

    const baEstimate = measurement.array('baEstimate');
    const cEstimate  = measurement.array('cEstimate');
    const sAvgPulse  = measurement.array('sAveragePulse');
    const cAvgPulse  = measurement.array('cAveragePulse');

    const sPulseStarts = measurement.array('sPulseStartIndexes');
    const cPulseStarts = measurement.array('cPulseStartIndexes');
    const sAvgPtIdxs   = measurement.array('sAveragePulsePointsIndexes');
    const cAvgPtIdxs   = measurement.array('cAveragePulsePointsIndexes');

    if (placeholder) placeholder.style.display = 'none';
    if (container)   container.style.display   = 'block';

    //   Full waveforms — beat-start markers (dashed red verticals)
    _renderChart('chart-sBaseLined', 'Suprasystolic Rhythm', '#1565c0', sBaseLined, sPulseStarts, null);
    _renderChart('chart-baEstimate', 'Brachial',             '#2e7d32', baEstimate, sPulseStarts, null);
    _renderChart('chart-cEstimate',  'Central',              '#b71c1c', cEstimate,  cPulseStarts, null);

    //   Averaged single pulses — feature dots (filled orange circles)
    _renderChart('chart-sAveragePulse', 'Suprasystolic Average Pulse', '#1565c0', sAvgPulse, null, sAvgPtIdxs);
    _renderChart('chart-cAveragePulse', 'Central Average Pulse',       '#b71c1c', cAvgPulse, null, cAvgPtIdxs);

    //   Raw recordings — the cuff ramps, then the suprasystolic channel
    _renderRawRecordings(measurement);
}

/**
 * The raw pressure recordings: one cuff trace per BP determination, then the
 * suprasystolic channel.
 *
 * The cuff plots carry dashed reference lines at that reading's SYS, MAP and
 * DIA, which is what makes them readable — the ramp on its own is just a
 * curve, but with the three pressures marked you can see where on the sweep
 * each of them was decided.
 *
 * A cuff recording is only kept when the device has been configured to keep
 * it. When it has not, the section says so rather than showing nothing.
 */
function _renderRawRecordings(measurement) {
    const host = document.getElementById('wf-cuff-plots');
    const note = document.getElementById('wf-raw-note');
    if (host) host.innerHTML = '';

    const messages = [];
    const readings = measurement.readings;
    const count = Math.max(1, readings.length);

    for (let i = 0; i < count; i++) {
        const recording = measurement.cuffRecording(i);
        if (!recording.found) {
            if (i === 0) messages.push(recording.reason);
            continue;
        }

        const reading = readings[i] || measurement.brachial;
        const label = readings.length > 1
            ? 'Raw Cuff Pressure — reading ' + (i + 1) + ' of ' + readings.length
            : 'Raw Cuff Pressure';

        const canvasId = 'chart-rawCuff-' + i;
        host.insertAdjacentHTML('beforeend',
            '<div class="wf-section">' +
              '<div class="wf-title">' +
                '<span class="wf-title-dot" style="background:#2e7d32;"></span>' +
                escapeHtml(label) +
                '&nbsp;<span class="wf-legend-ref">| SYS / MAP / DIA</span>' +
              '</div>' +
              '<div class="wf-canvas-wrap wf-tall"><canvas id="' + canvasId + '"></canvas></div>' +
            '</div>');

        _renderPressureChart(canvasId, recording, '#2e7d32', [
            { value: reading.sys, label: 'SYS', color: '#b71c1c' },
            { value: reading.map, label: 'MAP', color: '#e65100' },
            { value: reading.dia, label: 'DIA', color: '#1565c0' },
        ]);
    }

    const supra = measurement.suprasystolicRecording;
    const supraSection = document.getElementById('wf-suprasystolic-section');

    if (supra.found) {
        if (supraSection) supraSection.style.display = '';
        _renderPressureChart('chart-rawSuprasystolic', supra, '#1565c0', []);
    } else {
        if (supraSection) supraSection.style.display = 'none';
        messages.push(supra.reason);
    }

    if (note) {
        note.style.display = messages.length ? '' : 'none';
        note.textContent = messages.join('  ');
    }
}

/**
 * A pressure trace against time in seconds, with optional dashed reference
 * lines.
 *
 * Time rather than sample index: these recordings run for tens of seconds and
 * how long the ramp took is part of what you are looking at.
 */
function _renderPressureChart(canvasId, recording, color, references) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (_wfCharts[canvasId]) {
        _wfCharts[canvasId].destroy();
        delete _wfCharts[canvasId];
    }

    // Thousands of samples at 200 Hz. Chart.js copes, but there is nothing to
    // be gained from drawing more points than the canvas has pixels.
    const step = Math.max(1, Math.floor(recording.mmHg.length / 2000));
    const points = [];
    for (let i = 0; i < recording.mmHg.length; i += step) {
        points.push({ x: i / recording.sampleRate, y: recording.mmHg[i] });
    }

    _wfCharts[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
            datasets: [{
                data: points,
                borderColor: color,
                borderWidth: 1.2,
                pointRadius: 0,
                tension: 0,
                fill: false,
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
                bpReferenceLines: {
                    lines: references.filter(r => Number.isFinite(r.value)),
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Time (s)', font: { size: 9 }, color: '#888' },
                    ticks: { maxTicksLimit: 8, font: { size: 9 }, color: '#888' },
                    grid: { color: 'rgba(0,0,0,0.07)' },
                },
                y: {
                    title: { display: true, text: 'Pressure (mmHg)', font: { size: 9 }, color: '#888' },
                    ticks: { maxTicksLimit: 6, font: { size: 9 }, color: '#888' },
                    grid: { color: 'rgba(0,0,0,0.07)' },
                },
            },
        },
    });
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Destroy every chart and show the placeholder again. */
export function clearWaveforms() {
    for (const id of Object.keys(_wfCharts)) {
        _wfCharts[id].destroy();
        delete _wfCharts[id];
    }
    const placeholder = document.getElementById('waveform-placeholder');
    const container   = document.getElementById('waveform-charts');
    if (placeholder) {
        placeholder.textContent = 'Run a measurement to see the pulse waves.';
        placeholder.style.display = '';
    }
    if (container) container.style.display = 'none';
}
