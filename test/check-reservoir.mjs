/**
 * Checks on the reservoir analysis in analysis/. No dependencies, no browser.
 *
 *   node test/check-reservoir.mjs
 *
 * analysis/ is a copy of doingnz/bpplus-js-reservoir, recorded in
 * analysis/RESERVOIR-VERSION.json and replaced with tools/sync-reservoir.mjs.
 * The port's own tests live in that repository; these check the copy here.
 *
 * 1. analysis/ is still the copy RESERVOIR-VERSION.json says it is. An edit
 *    made here is lost at the next sync and invisible until then.
 *
 * 2. Every analysis file the app loads is in the service worker's PRECACHE,
 *    or the reservoir tab does not load offline.
 *
 * 3. The simulator's recorded measurement analyses completely: it is what the
 *    tab shows on every page that has never been near a device.
 *
 * 4. The copy agrees with MATLAB, in all 89 columns, on every vector of the
 *    bpplus-reservoir-vectors tag its release was checked against. CI checks
 *    that tag out into vectors/. Locally, clone it there:
 *
 *      git clone --branch <vectors.ref> https://github.com/doingnz/bpplus-reservoir-vectors vectors
 *
 *    or point BPPLUS_RESERVOIR_VECTORS at a checkout. Without vectors the run
 *    fails, because a check that compared nothing is not a pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyseReservoir, reservoirInput, COLUMNS } from '../analysis/index.js';
import { round } from '../analysis/matlab.js';
import { MEASUREMENT_XML } from '../sdk/transports/simulator-data.js';
import { xmlSource } from './reservoir/xml-source.mjs';
import { folderHash, jsFiles } from './reservoir/folder-hash.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const analysisDir = path.join(root, 'analysis');
const record = JSON.parse(fs.readFileSync(path.join(analysisDir, 'RESERVOIR-VERSION.json'), 'utf8'));

let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function close(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

// ── 1. The copy ──────────────────────────────────────────────────────────────

{
  const actual = folderHash(analysisDir);
  console.log(`analysis/ is bpplus-js-reservoir ${record.version} (${record.source.ref}, ${record.source.commit.slice(0, 7)})`);
  check('analysis/ has not been edited in place', actual === record.vendored?.treeSha256,
    `recorded ${record.vendored?.treeSha256}, actual ${actual}\n` +
    '        Change it in doingnz/bpplus-js-reservoir and run tools/sync-reservoir.mjs, not here.');
}

// ── 2. Precached ─────────────────────────────────────────────────────────────

{
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/analysis\/([^']+)'/g)].map(m => m[1]));
  const files = jsFiles(analysisDir);
  const missing = files.filter(f => !listed.has(f));
  const stale = [...listed].filter(f => !files.includes(f));
  check(`all ${files.length} analysis files are precached`, missing.length === 0,
    'missing from PRECACHE in sw.js: ' + missing.map(f => 'analysis/' + f).join(', '));
  check('no precached analysis file has gone', stale.length === 0,
    'listed in sw.js but not in analysis/: ' + stale.map(f => 'analysis/' + f).join(', '));
}

// ── 3. The simulator ─────────────────────────────────────────────────────────

{
  const input = reservoirInput(xmlSource(MEASUREMENT_XML), { file: 'simulator.xml' });
  const result = analyseReservoir(input);
  check('simulator: analysed', result.processed, result.reason || '');
  check('simulator: every section computed', result.errors.length === 0,
    result.errors.map(e => `${e.section}: ${e.message}`).join('; '));
  if (result.processed) {
    const v = result.values;
    check('simulator: diastolic duration is the beat less the ejection duration',
      close(v.re_aodd, 60 / v.re_hr - v.re_ao_ed, 1e-12));
    check('simulator: SEVR figure ends systole where SEVR does',
      result.series.sevr?.systoleEnd === round(v.re_ao_ed * v.re_sam_rate));
    check('simulator: pulse traces are the selected pulses',
      result.series.pulses?.numbers.join() === input.sSelectedPulseIndexes.map(p => p + 1).join());
  }
}

// ── 4. The vectors ───────────────────────────────────────────────────────────

{
  const vectorsDir = process.env.BPPLUS_RESERVOIR_VECTORS || path.join(root, 'vectors');
  const manifestFile = path.join(vectorsDir, 'manifest.json');

  if (!fs.existsSync(manifestFile)) {
    check(`test vectors ${record.vectors.ref} are present`, false,
      `no manifest.json in ${vectorsDir}\n        git clone --branch ${record.vectors.ref} ${record.vectors.repository} vectors`);
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    console.log(`\n${manifest.vectors.length} vectors from ${vectorsDir} (expected ${record.vectors.ref})`);

    let compared = 0;
    for (const vector of manifest.vectors) {
      const source = xmlSource(fs.readFileSync(path.join(vectorsDir, vector.xml), 'utf8'));
      if (!source) {
        console.log(`skip  ${vector.name}: ${vector.format} XML; the analysis reads BP+ XML only`);
        continue;
      }
      const expected = JSON.parse(fs.readFileSync(path.join(vectorsDir, vector.expected.beta7), 'utf8'));
      const result = analyseReservoir(reservoirInput(source, { file: path.basename(vector.xml) }),
        { compatibility: 'beta7' });

      const mismatches = [];
      for (const column of COLUMNS) {
        if (column.header === 're_file') continue;
        if (!(column.header in expected.values)) {
          mismatches.push(`${column.header}: missing from the expected values`);
          continue;
        }
        const want = expected.values[column.header];
        const got = result.values[column.header];
        if (!agrees(got, want, expected.tolerance ?? 1e-6)) mismatches.push(`${column.header}: got ${got}, expected ${want}`);
      }
      compared++;
      check(`${vector.name}: agrees with ${expected.source}`, mismatches.length === 0, mismatches.join('\n        '));
    }
    check('at least one vector was compared', compared > 0);
  }
}

function agrees(got, want, tolerance) {
  const missing = v => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
  if (missing(want)) return missing(got);
  if (typeof want === 'string') return String(got) === want;
  return typeof got === 'number' && close(got, want, tolerance);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll reservoir checks passed.');
process.exit(failures ? 1 : 0);
