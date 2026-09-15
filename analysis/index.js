/**
 * Reservoir analysis of a BP+ measurement — a port of BPplus-Reservoir.
 *
 * UI-free: no DOM, no framework, no localStorage, no dependencies. See
 * NOTICE.md for the authors, references and licensing of the original.
 */

/** This port's version. package.json must agree; test/run.mjs checks. */
export const RESERVOIR_JS_VERSION = '0.2.0';

export {
  analyseReservoir, averageBeats, qualityFromSnr, ANALYSIS_VERSION, KRESERVOIR_VERSION, MIN_SNR,
  CORRECTIONS, CORRECTED_VERSION, BRACHIAL_SOURCES, BRACHIAL_BEAT_COLUMNS,
} from './reservoir.js';
export { reservoirInput, deviceValues } from './input.js';
export { COLUMNS, GROUPS, formatValue, resultsCsv } from './columns.js';
