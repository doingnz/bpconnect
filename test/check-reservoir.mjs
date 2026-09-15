/**
 * Checks on the reservoir analysis in analysis/. No dependencies, no browser.
 *
 *   node test/check-reservoir.mjs [measurement.xml ...]
 *
 * 1. The MATLAB functions it ports give known answers — values that follow
 *    from the mathematics, not values this implementation happened to compute.
 *
 * 2. The simulator's recorded measurement analyses completely, and every file
 *    named on the command line (or found in BPPLUS_RESERVOIR_FIXTURES) is run
 *    too.
 *
 * 3. Where test/reservoir/reference/<name>.json exists for a measurement, all
 *    89 results agree with it. See test/reservoir/README.md for where those
 *    files come from, and which ones came from MATLAB.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyseReservoir, reservoirInput, COLUMNS } from '../analysis/index.js';
import {
  sgolayFirstDerivative, spline, fzero, fminsearch, findpeaks, round,
} from '../analysis/matlab.js';
import { MEASUREMENT_XML } from '../sdk/transports/simulator-data.js';
import { xmlSource } from './reservoir/xml-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = path.join(here, 'reservoir', 'reference');

let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function close(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

// ── 1. Known answers ─────────────────────────────────────────────────────────

{
  // The published 9-point cubic first-derivative Savitzky-Golay filter.
  const expected = [86, -142, -193, -126, 0, 126, 193, 142, -86].map(v => v / 1188);
  const g = sgolayFirstDerivative(3, 9);
  check('sgolay(3,9) first derivative', g.every((v, i) => close(v, expected[i], 1e-12)));
}

{
  // A not-a-knot cubic spline reproduces any cubic exactly, at any spacing.
  const f = x => 0.5 * x ** 3 - 2 * x ** 2 + x - 7;
  const x = [1, 2, 3, 10, 11, 12, 15, 16];
  const q = [4, 5.5, 7, 9, 13.2, 0, 17];
  const got = spline(x, x.map(f), q);
  check('spline is exact on a cubic', got.every((v, i) => close(v, f(q[i]), 1e-9)));
}

{
  const root = fzero(x => Math.cos(x) - x, 1, 1e-16);
  check('fzero finds cos(x) = x', close(root, 0.7390851332151607, 1e-14), String(root));
}

{
  const found = fminsearch(x => (x - 3) ** 2 + 1, 1, 1e-6);
  check('fminsearch finds a quadratic minimum', close(found.x, 3, 1e-5) && found.exitflag === 1, String(found.x));
}

{
  // Half-prominence width of a triangle is half its base.
  const y = [0, 0, 1, 2, 3, 4, 3, 2, 1, 0, 0];
  const p = findpeaks(y);
  check('findpeaks locates a triangle', p.locs.length === 1 && p.locs[0] === 6);
  check('findpeaks half-prominence width', close(p.widths[0], 4, 1e-12), String(p.widths[0]));

  // A plateau is one peak, at its first sample; the ends are never peaks.
  const flat = findpeaks([5, 1, 3, 3, 3, 1, 2, 0, 9]);
  check('findpeaks plateau and ends', flat.locs.join() === '3,7', flat.locs.join());

  const descending = findpeaks([0, 2, 0, 5, 0, 3, 0], { nPeaks: 1, sortStr: 'descend' });
  check('findpeaks SortStr descend', descending.locs[0] === 4);

  const tall = findpeaks([0, 2, 0, 5, 0, 3, 0], { minPeakHeight: 2 });
  check('findpeaks MinPeakHeight is strict', tall.locs.join() === '4,6', tall.locs.join());
}

check('round sends halves away from zero', round(2.5) === 3 && round(-2.5) === -3);

// ── 2 and 3. Measurements ────────────────────────────────────────────────────

const measurements = [{ name: 'simulator', xml: MEASUREMENT_XML, requireComplete: true }];

const fixtureDir = process.env.BPPLUS_RESERVOIR_FIXTURES;
if (fixtureDir && fs.existsSync(fixtureDir)) {
  for (const file of fs.readdirSync(fixtureDir).filter(f => f.endsWith('.xml')).sort()) {
    measurements.push({ name: path.basename(file, '.xml'), xml: fs.readFileSync(path.join(fixtureDir, file), 'utf8') });
  }
}
for (const file of process.argv.slice(2)) {
  measurements.push({ name: path.basename(file, '.xml'), xml: fs.readFileSync(file, 'utf8') });
}

for (const m of measurements) {
  const source = xmlSource(m.xml);
  if (!source) {
    console.log(`skip  ${m.name}: not a BPplus result`);
    continue;
  }

  const input = reservoirInput(source, { file: `${m.name}.xml` });
  const result = analyseReservoir(input);
  // The reference values are beta7's, so they are compared with beta7's behaviour.
  const asBeta7 = analyseReservoir(input, { compatibility: 'beta7' });

  if (m.requireComplete) {
    check(`${m.name}: analysed`, result.processed, result.reason || '');
    check(`${m.name}: every section computed`, result.errors.length === 0,
      result.errors.map(e => `${e.section}: ${e.message}`).join('; '));

    const v = result.values;
    check(`${m.name}: diastolic duration is the beat less the ejection duration`,
      close(v.re_aodd, 60 / v.re_hr - v.re_ao_ed, 1e-12), String(v.re_aodd));
  } else {
    const note = !result.processed
      ? result.reason
      : result.errors.map(e => `${e.section}: ${e.message}`).join('; ');
    console.log(`info  ${m.name}: ${result.processed ? 'analysed' : 'not analysed'}${note ? ' — ' + note : ''}`);
  }

  const referenceFile = path.join(referenceDir, `${m.name}.json`);
  if (!fs.existsSync(referenceFile)) continue;

  const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
  const mismatches = [];
  for (const column of COLUMNS) {
    if (!(column.header in reference.values) || column.header === 're_file') continue;
    const want = reference.values[column.header];
    const got = asBeta7.values[column.header];
    if (!agrees(got, want, reference.tolerance ?? 1e-6)) {
      mismatches.push(`${column.header}: got ${got}, reference ${want}`);
    }
  }
  check(`${m.name}: agrees with ${reference.source}`, mismatches.length === 0, mismatches.join('\n        '));
}

function agrees(got, want, tolerance) {
  const missing = v => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
  if (missing(want)) return missing(got);
  if (typeof want === 'string') return String(got) === want;
  return typeof got === 'number' && close(got, want, tolerance);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll reservoir checks passed.');
process.exit(failures ? 1 : 0);
