/**
 * Waveform charts for BP+ Connect.
 *
 * Renders five Chart.js charts in Tab 3 from the BP+ XML result document.
 * Two canvas-drawing plugins are registered globally:
 *   bpBeatMarker  — dashed vertical lines at beat-start sample indexes
 *   bpFeatureDots — filled circles at feature-point sample indexes
 *
 * Public API:
 *   waveformDraw(xmlDoc)  — call after each successful XML parse
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

// ── Chart instance cache ──────────────────────────────────────────────────────
const _wfCharts = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract a comma-separated float array from the XML document. */
function _xmlFloats(xmlDoc, tag) {
    const el = xmlDoc.getElementsByTagName(tag)[0];
    if (!el || !el.firstChild) return [];
    return el.firstChild.nodeValue.split(',').map(Number);
}

/** Extract a comma-separated integer array from the XML document. */
function _xmlInts(xmlDoc, tag) {
    const el = xmlDoc.getElementsByTagName(tag)[0];
    if (!el || !el.firstChild) return [];
    return el.firstChild.nodeValue.split(',').map(Number);
}

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse waveform arrays from the BP+ XML result and render all five charts.
 * Must be called after DOMParser has produced a valid xmlDoc.
 *
 * @param {Document} xmlDoc
 */
function waveformDraw(xmlDoc) {
    // ── Waveform arrays ───────────────────────────────────────────────────────
    const sBaseLined = _xmlFloats(xmlDoc, 'sBaseLined');
    const baEstimate = _xmlFloats(xmlDoc, 'baEstimate');
    const cEstimate  = _xmlFloats(xmlDoc, 'cEstimate');
    const sAvgPulse  = _xmlFloats(xmlDoc, 'sAveragePulse');
    const cAvgPulse  = _xmlFloats(xmlDoc, 'cAveragePulse');

    // ── Index arrays ──────────────────────────────────────────────────────────
    const sPulseStarts = _xmlInts(xmlDoc, 'sPulseStartIndexes');
    const cPulseStarts = _xmlInts(xmlDoc, 'cPulseStartIndexes');
    const sAvgPtIdxs   = _xmlInts(xmlDoc, 'sAveragePulsePointsIndexes');
    const cAvgPtIdxs   = _xmlInts(xmlDoc, 'cAveragePulsePointsIndexes');

    // ── Show charts, hide placeholder ─────────────────────────────────────────
    const placeholder = document.getElementById('waveform-placeholder');
    const container   = document.getElementById('waveform-charts');
    if (placeholder) placeholder.style.display = 'none';
    if (container)   container.style.display   = 'block';

    // ── Render ────────────────────────────────────────────────────────────────
    //   Full waveforms — beat-start markers (dashed red verticals)
    _renderChart('chart-sBaseLined',    'Suprasystolic Rhythm',      '#1565c0', sBaseLined, sPulseStarts, null);
    _renderChart('chart-baEstimate',    'Brachial',                  '#2e7d32', baEstimate, sPulseStarts, null);
    _renderChart('chart-cEstimate',     'Central',                   '#b71c1c', cEstimate,  cPulseStarts, null);

    //   Averaged single pulses — feature dots (filled orange circles)
    _renderChart('chart-sAveragePulse', 'Brachial Average Pulse',   '#1565c0', sAvgPulse,  null, sAvgPtIdxs);
    _renderChart('chart-cAveragePulse', 'Central Average Pulse',    '#b71c1c', cAvgPulse,  null, cAvgPtIdxs);
}
