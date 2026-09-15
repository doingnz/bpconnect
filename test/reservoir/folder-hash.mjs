/**
 * The hash a vendored folder is pinned by: every .js under it, sorted by path
 * with an ordinal comparison, each hashed as UTF-8 with CRLF normalised to LF,
 * joined as "path hash" lines, and the whole hashed again.
 *
 * The same algorithm test/check-sdk.mjs applies to sdk/, so the two copies are
 * pinned the same way. Line endings are normalised because this repository
 * has no .gitattributes and checks out CRLF on Windows.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function folderHash(dir) {
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');
  const lines = jsFiles(dir)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(name => {
      const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      return name + ' ' + sha(Buffer.from(text, 'utf8')) + '\n';
    })
    .join('');
  return sha(Buffer.from(lines, 'utf8'));
}

/** Every .js under dir, as forward-slash paths relative to it. */
export function jsFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? jsFiles(path.join(dir, entry.name), prefix + entry.name + '/')
      : entry.name.endsWith('.js') ? [prefix + entry.name] : []);
}
