/**
 * Replace analysis/ with reservoir/ from a tag of bpplus-js-reservoir, and
 * record what was copied in analysis/RESERVOIR-VERSION.json.
 *
 *   node tools/sync-reservoir.mjs v0.1.0
 *
 * analysis/ is changed in that repository and copied here, never edited here —
 * the same arrangement as sdk/ and the BP+ JavaScript SDK. The record names the
 * commit the tag pointed at, the hash of the copied .js files, and the
 * bpplus-reservoir-vectors tag that release was checked against, which CI then
 * checks this copy against as well.
 *
 * Needs git on the PATH. Afterwards: node test/check-reservoir.mjs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { folderHash } from '../test/reservoir/folder-hash.mjs';

const REPOSITORY = 'https://github.com/doingnz/bpplus-js-reservoir.git';

const ref = process.argv[2];
if (!ref) {
  console.error('usage: node tools/sync-reservoir.mjs <tag>');
  process.exit(2);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, 'analysis');
const recordFile = path.join(target, 'RESERVOIR-VERSION.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpplus-js-reservoir-'));

try {
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, REPOSITORY, tmp], { stdio: 'inherit' });
  const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
  const vectors = JSON.parse(fs.readFileSync(path.join(tmp, 'VECTORS.json'), 'utf8'));

  for (const entry of fs.readdirSync(target)) {
    if (entry !== 'RESERVOIR-VERSION.json') fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
  fs.cpSync(path.join(tmp, 'reservoir'), target, { recursive: true });

  const record = {
    $comment: [
      'Provenance for the copy of bpplus-js-reservoir in this folder.',
      '',
      'analysis/ is a COPY of reservoir/ at the tag below. It is changed in that',
      'repository and copied here with tools/sync-reservoir.mjs, never edited here:',
      'test/check-reservoir.mjs fails when the folder no longer hashes to',
      'vendored.treeSha256.',
      '',
      'vectors is the bpplus-reservoir-vectors tag that release was checked against;',
      'CI checks this copy against the same tag.',
    ],
    version: pkg.version,
    source: { repository: REPOSITORY, path: 'reservoir/', ref, commit },
    vectors: { repository: vectors.repository, ref: vectors.ref },
    vendored: { on: new Date().toISOString().slice(0, 10), treeSha256: folderHash(target) },
  };
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 4) + '\n');

  console.log(`analysis/ is bpplus-js-reservoir ${pkg.version} (${ref}, ${commit.slice(0, 7)}), checked against vectors ${vectors.ref}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
