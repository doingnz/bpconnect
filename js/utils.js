
function sleep(ms) {
    // add ms millisecond timeout before promise resolution
    return new Promise(resolve => setTimeout(resolve, ms))
}

function debuglog(...args) {
    console.log.apply(this, args);

    const el = document.getElementById('debug');
    if (el) {
        const p = document.createElement('p');
        p.textContent = args.join(' ');
        el.appendChild(p);
    }
}

// ── Serial debug tracing ─────────────────────────────────────────────────────

function isTraceEnabled() {
    return localStorage.getItem('bptrace') === 'on';
}

/**
 * Log a BLE serial trace line to the debug div (and console) when tracing is on.
 *
 * @param {'TX'|'RX'|'CFG'} direction - TX = browser→device, RX = device→browser, CFG = config write
 * @param {string|Uint8Array|DataView} data - raw bytes or string
 */
function tracelog(direction, data) {
    if (!isTraceEnabled()) return;

    // Normalise to Uint8Array
    let bytes;
    if (typeof data === 'string') {
        bytes = new TextEncoder().encode(data);
    } else if (data instanceof DataView) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof Uint8Array) {
        bytes = data;
    } else {
        bytes = new Uint8Array(data);
    }

    // Build hex and printable-ASCII columns
    let hex   = '';
    let ascii = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        hex   += (b < 0x10 ? '0' : '') + b.toString(16).toUpperCase() + ' ';
        ascii += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.';
    }

    // Relative timestamp in ms since page load
    const ts = Math.round(performance.now());

    const line = '[' + ts + 'ms] ' + direction + '  ' + hex.trimEnd() + '  |' + ascii + '|';

    console.log(line);
    const el = document.getElementById('debug');
    if (el) {
        const p = document.createElement('p');
        p.style.fontFamily = 'monospace';
        p.style.fontSize   = '11px';
        p.style.margin     = '1px 0';
        p.style.color      = direction === 'TX' ? '#005f87'
                           : direction === 'RX' ? '#006400'
                           : '#8b4513';   // CFG = brown
        p.textContent = line;
        el.appendChild(p);
        // Auto-scroll
        el.scrollTop = el.scrollHeight;
    }
}