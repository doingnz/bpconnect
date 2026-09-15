/**
 * ai_v2 — augmentation index by the Kelly method, and the Murgo waveform type.
 *
 * Port of ai_v2.m (A. D. Hughes, with a fix suggested by R. Scott) from
 * BPplus-Reservoir. See analysis/NOTICE.md.
 *
 * The first shoulder is where the fourth derivative crosses zero; the fourth
 * derivative is quantised to tenths of its maximum first, so that crossings
 * smaller than 10% are ignored.
 *
 *   Kelly R, Hayward C, Avolio A, O'Rourke M. Circulation 1989;80(6):1652-9.
 *   Murgo JP, Westerhof N, Giolma JP, Altobelli SA. Circulation 1980;62(1):105-16.
 */

import { filterFir, max, round, fix } from './matlab.js';

/** The 7-point, 2nd-order Savitzky-Golay first derivative, as ai_v2.m writes it. */
const C = [0.107143, 0.071429, 0.035714];
export const SG7_DERIVATIVE = [C[0], C[1], C[2], 0, -C[2], -C[1], -C[0]];

/** fsg71: the derivative, shifted back by three samples, zero at both ends. */
export function fsg71(x) {
  if (x.length < 7) throw new Error('A waveform needs at least seven samples to differentiate.');
  const dx = filterFir(SG7_DERIVATIVE, x);
  return [0, 0, 0, ...dx.slice(6), 0, 0, 0];
}

/**
 * @param {number[]} p           aortic average pulse, mmHg
 * @param {number}   sampleRate  Hz
 * @returns {{ai: number, Pi: number, Tfoot: number, Ti: number, Tmax: number,
 *            type: 'Type A'|'Type B'|'Type C',
 *            foot: number, inflection: number, peak: number}}
 *          times in s; foot, inflection and peak are 1-based sample numbers
 */
export function aiV2(p, sampleRate) {
  const d4p = fsg71(fsg71(fsg71(fsg71(p))));

  const m4 = max(d4p).value;
  if (m4 === 0) throw new Error('The fourth derivative of the aortic pulse is zero everywhere.');

  // Filters out minor crossings (<10%).
  const nd4p = d4p.map(v => 1e-6 + fix(10 * (v / m4)));
  const zcross = zeroCrossings(nd4p).map(round);

  if (zcross.length < 3) {
    throw new Error('Fewer than three fourth-derivative zero crossings were found in the aortic pulse.');
  }

  const peakInfo = max(p);
  const pmax = peakInfo.value;
  const tmax = peakInfo.index + 1;
  const tfoot = zcross[0];
  let ti = zcross[2];

  // Allow for type B and C, otherwise Pi may equal Ps. Five samples is arbitrary.
  if (tmax - ti < 5) {
    if (zcross.length < 4) {
      throw new Error('A fourth zero crossing was needed for the aortic inflection point but not found.');
    }
    ti = zcross[3];
  }

  const pfoot = p[tfoot - 1];
  const Pi = p[ti - 1];
  const PsPd = pmax - pfoot;
  const PsPi = pmax - Pi;
  if (PsPd === 0) throw new Error('The aortic pulse pressure is zero.');

  let ai = round(PsPi / PsPd * 100);
  if (tmax < ti) ai = -ai;

  let type;
  if (tmax >= ti) type = ai > 12 ? 'Type A' : 'Type B';
  else type = 'Type C';

  return {
    ai, Pi,
    Tfoot: tfoot / sampleRate,
    Ti: ti / sampleRate,
    Tmax: tmax / sampleRate,
    type,
    foot: tfoot, inflection: ti, peak: tmax,
  };
}

/**
 * The x of every zero crossing of a signal sampled at x = 1..n, linearly
 * interpolated: mminterp([1:n; y]', 2, 0) from ai_v2.m, first column.
 *
 * Samples exactly equal to zero are crossings in their own right. When the
 * signal never goes both above and below zero, only those are returned.
 */
export function zeroCrossings(y) {
  const n = y.length;
  const above = y.map(v => v > 0);
  const below = y.map(v => v < 0);
  const equalIdx = [];
  for (let i = 0; i < n; i++) if (y[i] === 0) equalIdx.push(i + 1);

  if (!above.some(Boolean) || !below.some(Boolean)) return equalIdx;

  // 1-based, as in MATLAB.
  const ib = [], ia = [];
  for (let i = 1; i < n; i++) {
    if (below[i - 1] && above[i]) { ib.push(i); ia.push(i + 1); }      // rising
    if (below[i] && above[i - 1]) { ib.push(i + 1); ia.push(i); }      // falling
  }
  ib.sort((a, b) => a - b);
  ia.sort((a, b) => a - b);

  const rows = ib.map((b, k) => {
    const a = ia[k];
    const alpha = (0 - y[b - 1]) / (y[a - 1] - y[b - 1]);
    return { order: b, x: alpha * a + (1 - alpha) * b };
  });
  for (const e of equalIdx) rows.push({ order: e, x: e });
  rows.sort((r, s) => r.order - s.order);
  return rows.map(r => r.x);
}
