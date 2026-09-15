/**
 * The scoped lookup BpPlusMeasurement performs, without a DOMParser, so the
 * reservoir checks run under plain Node.
 *
 * A tag is looked for among the children of <Result>, then among the direct
 * children of <MeasDataLogger> with the per-reading and recording blocks
 * removed — so an AOBP result's headline Sys is the mean, as in the SDK.
 *
 * @param {string} xml
 * @returns {{info: object, value(tag: string): string|null, document: object}|null}
 *          null when the document is not a BPplus result
 */
export function xmlSource(xml) {
  if (!/<BPplus[\s>]/.test(xml)) return null;

  const logger = block('MeasDataLogger', xml);
  const result = block('Result', xml);
  if (!logger) return null;

  const loggerBody = logger.body
    .replace(/<NibpBloodPressures[\s\S]*?<\/NibpBloodPressures>/g, '')
    .replace(/<PressureWaves[\s\S]*?<\/PressureWaves>/g, '');

  return {
    info: logger.attributes,
    value: tag => (result && leaf(tag, result.body)) ?? leaf(tag, loggerBody),
    document: {
      getElementsByTagName: tag => (tag === 'Result' && result
        ? [{ getAttribute: name => result.attributes[name] ?? null }]
        : []),
    },
  };
}

function block(tag, text) {
  const m = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(text);
  return m ? { attributes: attributesOf(m[1] || ''), body: m[2] } : null;
}

function leaf(tag, text) {
  const m = new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`).exec(text);
  return m ? m[2] : null;
}

function attributesOf(text) {
  const out = {};
  for (const m of text.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
