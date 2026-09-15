/**
 * Reservoir pressure from a single averaged beat.
 *
 * Ports of kreservoir_v15.m (K. H. Parker, with additions by A. D. Hughes) and
 * BPfitres_v1.m (A. D. Hughes) from BPplus-Reservoir. See analysis/NOTICE.md.
 *
 * Diastole is fitted with P = a·exp(-b·t) + P∞ by the method of moments, the
 * rate constant relating reservoir pressure to inflow is then found by
 * minimising the diastolic misfit, and the reservoir pressure over the whole
 * beat follows from integrating the model.
 *
 *   Hughes AD, Parker KH. Proc Inst Mech Eng H 2020;234(11):1288-99.
 *   Parker KH, Hughes AD. arXiv:2404.10806 (2024).
 */

import {
  EPS, filterFir, min, diff, cumtrapz, corrcoef, polyfit1, round, fzero, fminsearch,
} from './matlab.js';
import { SG7_DERIVATIVE } from './ai-v2.js';

/** fsg721: the 7-point derivative, its ends padded with the nearest valid value. */
export function fsg721(x) {
  const s = x.length;
  if (s < 7) throw new Error('A waveform needs at least seven samples to differentiate.');
  const dx = filterFir(SG7_DERIVATIVE, x);
  const first = dx[6], last = dx[s - 1];
  return [first, first, first, ...dx.slice(6), last, last, last];
}

/**
 * BPfitres_v1: the reservoir fit for one average beat.
 *
 * The beat is cut after its last falling sample, so an upturn at the end of
 * diastole cannot pull the exponential fit.
 *
 * @param {number[]} pAv         average beat, mmHg, starting at the foot
 * @param {number}   sampleRate  Hz
 * @returns {{Tn: number, Pinf: number, P: number[], Pr: number[], Pn: number,
 *            fita: number, fitb: number, rsq: number, fitConverged: boolean,
 *            notch: number}}  notch is the 1-based sample of max -dP/dt
 */
export function bpFitReservoir(pAv, sampleRate) {
  const T = pAv.length / sampleRate;

  const d = diff(pAv);
  let cut = -1;
  for (let i = d.length - 1; i >= 0; i--) if (d[i] < 0) { cut = i + 1; break; }
  if (cut < 0) throw new Error('The average beat never falls, so diastole cannot be fitted.');
  const P = pAv.slice(0, cut);

  const fit = kreservoir(P, T, sampleRate);

  // R² of the diastolic fit, when there are more than ten samples to judge it by.
  const xn = round(fit.Tn * sampleRate);
  let rsq = 0;
  if (P.length - xn > 10) {
    if (xn < 1) throw new Error('The end of systole falls before the first sample.');
    const r = corrcoef(P.slice(xn - 1), fit.Pr.slice(xn - 1));
    rsq = r * r;
  }

  return {
    Tn: fit.Tn, Pinf: fit.Pinf, P, Pr: fit.Pr, Pn: fit.Pn,
    fita: fit.A, fitb: fit.B, rsq, fitConverged: fit.fitConverged, notch: fit.notch,
  };
}

/**
 * kreservoir_v15.
 *
 * @param {number[]} P             pressure, starting at diastolic
 * @param {number}   Tb            duration of the beat, s
 * @param {number}   samplingRate  Hz — used only by the log-slope fallback
 */
export function kreservoir(P, Tb, samplingRate) {
  const p = P;
  const Nb = p.length;
  const n = Nb - 1;
  const step = Tb / n;

  // t = 0:dt:Tb. MATLAB fills a colon from both ends so the last element is Tb.
  const t = new Array(Nb);
  for (let k = 0; k <= n; k++) t[k] = k <= Math.floor(n / 2) ? k * step : Tb - (n - k) * step;

  // The minimum dP marks the start of diastole.
  const dp = fsg721(p);
  const nn = min(dp).index;               // 0-based
  const tn = t[nn];

  const pd = p.slice(nn);
  const td = t.slice(nn).map(v => v - tn);
  const Td = Tb - tn;
  if (td.length < 2) throw new Error('Diastole contains fewer than two samples.');
  const dt = td[1] - td[0];

  const N = pd.length - 1;

  // Moments of diastolic pressure by Simpson's rule, with kreservoir's
  // correction for an odd number of intervals.
  const simpson = values => {
    let evens = 0, odds = 0;
    for (let i = 1; i <= N - 1; i += 2) evens += values[i];
    for (let i = 2; i <= N - 1; i += 2) odds += values[i];
    return values[0] + 4 * evens + 2 * odds + values[N];
  };

  let E0 = simpson(pd) * dt / (3 * Td);
  if (N % 2) E0 = E0 + (pd[N - 1] + pd[N]) * dt / (6 * Td);

  const pde1 = pd.map((v, i) => (v - E0) * Math.exp(td[i] / Td));
  let E1 = simpson(pde1) * dt / 3;
  if (N % 2) E1 = E1 + (pde1[N - 1] + pde1[N]) * dt / 6;

  const pde2 = pd.map((v, i) => (v - E0) * Math.exp(2 * td[i] / Td));
  let E2 = simpson(pde2) * dt / 3;
  if (N % 2) E2 = E2 + (pde2[N - 1] + pde2[N]) * dt / 6;

  const r = E2 / E1;

  // Invert R(bTd) = r.
  const y = fzero(v => ratio21(v) - r, 1, 1e-16);
  let BTd;
  if (y > 0) {
    BTd = y;
  } else {
    // Fall back on the slope of log pressure through diastole.
    const tail = P.slice(nn);
    if (tail.some(v => v <= 0)) {
      throw new Error('Cannot estimate the diastolic decay from non-positive pressure.');
    }
    const Y = tail.map(Math.log);
    const X = Y.map((_, i) => i / samplingRate);
    BTd = -polyfit1(X, Y)[0] * Td;
  }

  // Given b, a from E1.
  const e1 = Math.exp(1);
  const denom = BTd === 1
    ? 3 - e1 - 1 / e1
    : (1 - e1 * Math.exp(-BTd)) / (BTd - 1) - (e1 - 1) * (1 - Math.exp(-BTd)) / BTd;
  const a = E1 / (Td * denom);

  // Given a and b, c from E0.
  const c = E0 - ((a / BTd) * (1 - Math.exp(-BTd)));

  const b = BTd / Td;
  const pinf = c;
  const prd = td.map(v => a * Math.exp(-b * v) + c);

  // Fit the inflow rate constant to the diastolic model.
  const diasFit = aa => {
    const model = beatIntegral(p, t, aa, b, pinf, true);
    let s = 0;
    for (let i = 0; i < prd.length; i++) {
      const e = prd[i] - model[nn + i];
      s += e * e;
    }
    return s;
  };
  const search = fminsearch(diasFit, b, 1e-6);
  const aa = search.x;

  let pr = beatIntegral(p, t, aa, b, pinf, false);
  if (!search.exitflag) pr = new Array(p.length).fill(min(p).value);

  // Where the integrated reservoir pressure first crosses the diastolic model,
  // hand over to the model for the rest of the beat.
  const Nd = pd.length;
  let k = -1;
  for (let j = 0; j < Nd; j++) {
    const jn = j < Nd - 1 ? j + 1 : Nd - 1;
    if ((pr[nn + j] - prd[j]) * (pr[nn + jn] - prd[jn]) <= 0) { k = j; break; }
  }
  const prr = pr.slice();
  if (k >= 0) for (let m = k + 1; m < Nd; m++) prr[nn + m] = prd[m];

  return {
    Pr: prr, A: aa, B: b, Pinf: pinf, Tn: t[nn], Pn: p[nn],
    fitConverged: search.exitflag === 1, notch: nn + 1,
  };
}

/** R(bTd) = E2/E1 for the exponential model. */
export function ratio21(y) {
  const e = Math.exp;
  if (y === 1) return ((e(1) - 1) - (1 - e(-1)) * (e(2) - 1) / 2) / (1 - (1 - e(-1)) * (e(1) - 1));
  if (y === 2) return (1 - (1 - e(-2)) * (e(2) - 1) / 4) / (-(e(-1) - 1) - (1 - e(-2)) * (e(1) - 1) / 2);
  if (y === 0) return 1 / (3 - e(1));
  return ((e(2 - y) - 1) / (2 - y) - (1 - e(-y)) * (e(2) - 1) / (2 * y)) /
         ((e(1 - y) - 1) / (1 - y) - (1 - e(-y)) * (e(1) - 1) / y);
}

/**
 * dias_int and beat_int: the reservoir model integrated over the whole beat by
 * the trapezoidal rule. dias_int guards a + b against zero; beat_int does not.
 */
function beatIntegral(Ps, Ts, a, b, Pinf, guard) {
  if (guard && Math.abs(a + b) < EPS) a = a + EPS;
  const dt = Ts[1] - Ts[0];
  const k = a + b;
  const pse = cumtrapz(Ps.map((v, i) => v * Math.exp(k * Ts[i]))).map(v => v * dt);
  const offset = b * Pinf / k;
  return Ts.map((ts, i) => Math.exp(-k * ts) * (a * pse[i] + Ps[0] - offset) + offset);
}
