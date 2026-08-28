/**
 * The debug and trace pane in the Settings tab.
 *
 * Fed entirely by device events — `log` for every line on the wire, `warning`
 * for anything non-fatal. The SDK never writes here, or anywhere else in the
 * DOM; it emits and this decides what to show.
 */

import { settings } from './settings.js';

const MAX_ROWS = 600;

let container = null;

// Anything logged before the pane exists. The transport is chosen at module
// scope — before any DOM is ready — so the reason auto-detect picked what it
// did would otherwise be written to a container that is still null and lost.
const pending = [];

export function initLog() {
  container = document.getElementById('debug');
  const clear = document.getElementById('debug-clear');
  if (clear) clear.addEventListener('click', () => clearLog());

  while (pending.length) {
    const row = pending.shift();
    emit(row.text, row.kind, row.note);
  }
}

export function clearLog() {
  if (container) container.textContent = '';
}

/** A plain message — connection changes, errors, anything not a wire line. */
export function log(message, kind = 'info') {
  emit(message, kind);
  if (kind === 'error') console.error('[BP+]', message);
  else console.log('[BP+]', message);
}

/**
 * One line of the wire trace. Only rendered when tracing is on, because a
 * measurement is thousands of pressure notifications and an XML block.
 *
 * @param {{dir: 'tx'|'rx', text: string, at: number, note?: string}} entry
 */
export function trace(entry) {
  if (!settings.traceEnabled) return;

  const stamp = new Date(entry.at).toISOString().slice(11, 23);
  const arrow = entry.dir === 'tx' ? '>' : '<';
  emit(`${stamp} ${arrow} ${entry.text}`, entry.dir === 'tx' ? 'tx' : 'rx', entry.note);
}

function emit(text, kind, note) {
  if (!container) {
    // Bounded: a fault that logged in a loop before init must not grow without
    // limit while nothing can display it.
    if (pending.length < MAX_ROWS) pending.push({ text, kind, note });
    return;
  }

  const row = document.createElement('div');
  row.className = `log-row log-${kind}` + (note ? ` log-note-${note}` : '');
  row.textContent = text;
  container.appendChild(row);

  while (container.childElementCount > MAX_ROWS) {
    container.removeChild(container.firstElementChild);
  }

  // Only follow the tail when the reader is already at it, so scrolling back
  // to read something is not undone by the next line.
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}
