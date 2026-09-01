/**
 * Two checks on the vendored SDK. No dependencies, no browser.
 *
 *   node test/check-sdk.mjs
 *
 * 1. sdk/ is still the copy sdk/SDK-VERSION.json says it is.
 *
 *    sdk/ is a copy of Uscom/bpplus-js-sdk. An edit made here and nowhere else
 *    is lost the next time the folder is replaced, and invisible until then --
 *    which is not hypothetical: this copy and the one in the UTas REDCap module
 *    drifted apart across seven files while both reported SDK_VERSION 1.0.0, and
 *    nothing showed until they were diffed.
 *
 *    The algorithm matches Get-SdkHash in bpplus-redcap's tools/sync-sdk.ps1,
 *    which is what writes the file: every .js under sdk/ sorted by path with an
 *    ordinal comparison, each hashed as UTF-8 with CRLF normalised to LF, joined
 *    as "path hash" lines separated by LF, and the whole hashed again. Line
 *    endings are normalised because this repository has no .gitattributes and
 *    checks out CRLF, which would otherwise make the hash disagree with itself.
 *
 * 2. Every SDK file the app can reach is in the service worker's PRECACHE.
 *
 *    This is the one that bites. PRECACHE is an explicit list, so an SDK release
 *    that adds a file leaves it out: online nobody notices, because the network
 *    serves it. Offline, the service worker hands back a cached index.js that
 *    imports a file the cache does not have, and the app does not start at all.
 *
 *    SDK 1.1.0 added core/advice.js, which index.js imports, and this is exactly
 *    what would have happened.
 *
 *    selftest.js is excluded deliberately: nothing in app/ imports it, it is
 *    only ever loaded on demand from a bench page, and it is large.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

let failures = 0;

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '\n        ' + detail : ''}`);
}

const sdkDir = new URL('../sdk/', import.meta.url);

/** Every .js under sdk/, as paths relative to sdk/. */
function sdkFiles(dir = sdkDir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? sdkFiles(new URL(entry.name + '/', dir), prefix + entry.name + '/')
      : (entry.name.endsWith('.js') ? [prefix + entry.name] : []));
}

// -- 1. Is this the copy it claims to be? -------------------------------------

console.log('\nvendored SDK');

{
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');

  const lines = sdkFiles()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(name => {
      const text = fs.readFileSync(new URL(name, sdkDir), 'utf8').replace(/\r\n/g, '\n');
      return name + ' ' + sha(Buffer.from(text, 'utf8')) + '\n';
    })
    .join('');

  const actual = sha(Buffer.from(lines, 'utf8'));
  const file = new URL('../sdk/SDK-VERSION.json', import.meta.url);

  if (!fs.existsSync(file)) {
    check('sdk/SDK-VERSION.json is present', false,
      'the copy cannot be traced to an upstream release');
  } else {
    const declared = JSON.parse(fs.readFileSync(file, 'utf8'));
    const index = fs.readFileSync(new URL('index.js', sdkDir), 'utf8');
    const stated = /SDK_VERSION\s*=\s*'([^']+)'/.exec(index);

    check('SDK-VERSION.json matches the SDK it describes',
      stated !== null && declared.sdkVersion === stated[1],
      `declared ${declared.sdkVersion}, code says ${stated ? stated[1] : 'nothing'}`);

    check('sdk/ has not been edited in place',
      actual === declared.vendored?.treeSha256,
      `recorded ${declared.vendored?.treeSha256}, actual ${actual}\n` +
      '        Change it upstream in Uscom/bpplus-js-sdk and re-vendor, not here.');

    console.log(`        SDK ${declared.sdkVersion} at ${declared.source?.ref}`);
  }
}

// -- 2. Can the app still start offline? --------------------------------------

console.log('\nservice worker precache');

{
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

  // Only what the app can actually reach. See the note at the top for why
  // selftest.js is not one of them.
  const NOT_LOADED_BY_THE_APP = ['selftest.js'];

  const required = sdkFiles().filter(name => !NOT_LOADED_BY_THE_APP.includes(name));
  const missing = required.filter(name => !sw.includes(`'./sdk/${name}'`));

  check(`all ${required.length} SDK files the app loads are precached`,
    missing.length === 0,
    'missing from PRECACHE in sw.js:\n        ' + missing.map(n => 'sdk/' + n).join('\n        '));

  // The other direction: a file dropped upstream but still listed makes the
  // service worker's install step fail outright, and then nothing is cached.
  const listed = [...sw.matchAll(/'\.\/sdk\/([^']+)'/g)].map(m => m[1]);
  const stale = listed.filter(name => !fs.existsSync(new URL(name, sdkDir)));

  check('no precached SDK file has gone from upstream',
    stale.length === 0,
    'listed in sw.js but not in sdk/:\n        ' + stale.map(n => 'sdk/' + n).join('\n        '));
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
