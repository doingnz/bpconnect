/**
 * Pulse wave, reservoir and wave intensity analysis of one BP+ measurement.
 *
 * Port of bpp_Res2.m beta7 (A. D. Hughes, from original code by K. H. Parker)
 * and of the parts of read_BPplus.m that prepare its input, from
 * BPplus-Reservoir. See analysis/NOTICE.md for the authors and references.
 *
 * The MATLAB script stops at the first thing it cannot compute. Here each
 * section fails on its own: a wave intensity peak that cannot be found costs
 * the wave intensity values, not the reservoir fit. A section that fails
 * records why, and every value it would have produced is null.
 *
 * Nothing here touches the DOM. The input is plain numbers and arrays — see
 * reservoirInput() in input.js for building one from a BpPlusMeasurement.
 */

import {
  max, min, diff, sum, trapz, round, fix, findpeaks, fillmissingSpline,
  sgolayFirstDerivative,
} from './matlab.js';
import { aiV2 } from './ai-v2.js';
import { bpFitReservoir } from './kreservoir.js';
import { COLUMNS } from './columns.js';

/** Version of bpp_Res2 this ports, and of kreservoir. Written to the results. */
export const ANALYSIS_VERSION = 'beta7';
export const KRESERVOIR_VERSION = 'v15';

const MMHG_PA = 133.322;     // pressure conversion for wave intensity
const UCONST = 1;            // normalised velocity to m/s
const NPOLY = 3;             // Savitzky-Golay order for dI
const FRAME = 9;             // and window (Rivolo et al., IEEE EMBC 2014)

/** Below this SNR (dB) the MATLAB analysis does not process a recording. */
export const MIN_SNR = 6;

/**
 * Where this analysis departs from bpp_Res2.m beta7 on purpose.
 *
 * Each is a defect in beta7 rather than a choice, and each is switched off by
 * `{ compatibility: 'beta7' }`, which reproduces the MATLAB exactly — that is
 * how the port is checked against MATLAB output. `column` names the result a
 * correction changes, when it changes one.
 */
export const CORRECTIONS = [
  {
    id: 'diastolic-duration',
    column: 're_aodd',
    text: 'Diastolic duration is 60/HR less the ejection duration. beta7 subtracts ' +
          'the end-systolic pressure divided by 1000 instead.',
  },
  {
    id: 'sevr-figure-systole',
    column: null,
    text: 'The SEVR figure ends systole where the SEVR value does, at the ejection ' +
          'duration. beta7 draws it at the steepest fall found for wave intensity, ' +
          'which can be a sample or more away, so the shading did not match the number.',
  },
];

/** Written to re_resvers when the corrections apply, so a CSV row says which. */
export const CORRECTED_VERSION = `${ANALYSIS_VERSION}-bpconnect`;

/**
 * Quality from SNR, as read_BPplus.m names it.
 * @returns {'Excellent'|'Good'|'Acceptable'|'Poor'|'Unacceptable'}
 */
export function qualityFromSnr(snr) {
  if (snr >= 12) return 'Excellent';
  if (snr >= 9) return 'Good';
  if (snr >= 6) return 'Acceptable';
  if (snr > 0) return 'Poor';
  return 'Unacceptable';
}

/**
 * @typedef {object} ReservoirInput
 * @property {string} file
 * @property {string} datetime
 * @property {string} softwareVersion     MeasDataLogger version attribute
 * @property {string} algorithmRevision   Result algorithm_revision attribute
 * @property {number} sampleRate
 * @property {number} snr
 * @property {number} sys  @property {number} dia  @property {number} map  @property {number} pr
 * @property {number} cSys @property {number} cDia @property {number} cMap
 * @property {number} sPRV @property {number} sAI  @property {number} sPPV
 * @property {number} sRWTTFoot @property {number} sRWTTPeak
 * @property {number} sSEP                ms
 * @property {number[]} sAveragePulse     suprasystolic average beat, not in mmHg
 * @property {number[]} cAveragePulse     aortic average beat, mmHg
 * @property {number[]} baEstimate        brachial estimate, mmHg
 * @property {number[]} sPulseStartIndexes     0-based, as the XML carries them
 * @property {number[]} sSelectedPulseIndexes  0-based
 */

/**
 * Run the analysis.
 *
 * @param {ReservoirInput} input
 * @param {{compatibility?: 'beta7'}} [options]  'beta7' reproduces bpp_Res2.m
 *        beta7 exactly, without CORRECTIONS
 * @returns {{
 *   processed: boolean, reason: string|null, quality: string,
 *   values: Object<string, number|string|null>,
 *   errors: Array<{section: string, message: string}>,
 *   series: object,
 *   corrections: Array<{id: string, column: string|null, text: string}>,
 * }}
 *   `values` is keyed by the resdata.xls column header (see columns.js).
 */
export function analyseReservoir(input, { compatibility = null } = {}) {
  const beta7 = compatibility === 'beta7';
  const values = Object.fromEntries(COLUMNS.map(c => [c.header, null]));
  const errors = [];
  const series = {};
  const fs = input.sampleRate;
  const quality = qualityFromSnr(input.snr);

  values.re_file = input.file ?? '';
  values.re_date = input.datetime ?? '';
  values.re_bppvers = input.softwareVersion ?? '';
  values.re_bppalgo = input.algorithmRevision ?? '';
  values.re_resvers = beta7 ? ANALYSIS_VERSION : CORRECTED_VERSION;
  values.re_kres = KRESERVOIR_VERSION;
  values.re_snr = finite(input.snr);

  const result = {
    processed: false, reason: null, quality, values, errors, series,
    corrections: beta7 ? [] : CORRECTIONS,
  };

  if (!(input.snr >= MIN_SNR)) {
    result.reason = `Not analysed: the signal-to-noise ratio is ${Number.isFinite(input.snr) ? input.snr + ' dB' : 'unknown'}, ` +
      `and the reservoir analysis needs at least ${MIN_SNR} dB.`;
    return result;
  }
  if (!(fs > 0)) {
    result.reason = 'Not analysed: the measurement has no sample rate.';
    return result;
  }
  if (!input.cAveragePulse?.length || !input.sAveragePulse?.length) {
    result.reason = 'Not analysed: the measurement has no average pulse. A BP-only measurement carries no pulse wave.';
    return result;
  }

  result.processed = true;

  // A section that throws records its message and leaves its values null.
  const section = (name, body) => {
    try {
      return body();
    } catch (error) {
      errors.push({ section: name, message: error.message });
      return null;
    }
  };

  // ── Inputs, as read_BPplus.m prepares them ────────────────────────────────

  const ba = { sbp: input.sys, dbp: input.dia, map: input.map, hr: input.pr };
  ba.pp = ba.sbp - ba.dbp;
  const ao = { sbp: input.cSys, dbp: input.cDia, map: input.cMap };
  ao.pp = ao.sbp - ao.dbp;
  const sep = input.sSEP / 1000;

  values.re_sam_rate = fs;
  values.re_basbp = finite(ba.sbp);
  values.re_ba_dbp = finite(ba.dbp);
  values.re_hr = finite(ba.hr);
  values.re_ba_map = finite(ba.map);
  values.re_bapp = finite(ba.pp);
  values.re_aosbp = finite(ao.sbp);
  values.re_aodbp = finite(ao.dbp);
  values.re_aopp = finite(ao.pp);
  values.re_rmssd = finite(input.sPRV);
  values.re_sAI = finite(input.sAI);
  values.re_ppv = finite(input.sPPV);
  values.re_rwttf = finite(input.sRWTTFoot);
  values.re_rwttp = finite(input.sRWTTPeak);
  values.re_sep = finite(sep);
  // bpp_Res2 writes its own lower-case quality, for processed files only.
  values.re_quality = quality.toLowerCase();

  // Individual pulses from the brachial estimate, for the pulse traces plot.
  section('Pulse traces', () => {
    const pAll = (input.baEstimate || []).slice();
    const len = pAll.length;
    for (let i = 0; i < Math.min(200, len); i++) if (pAll[i] < ba.dbp) pAll[i] = NaN;
    for (let i = Math.max(1, len - 200) - 1; i < len; i++) if (pAll[i] > ba.sbp) pAll[i] = NaN;

    const starts = (input.sPulseStartIndexes || []).map(v => round(v + 1));
    const numGood = (input.sSelectedPulseIndexes || []).length - 1;
    if (starts.length < 2) throw new Error('At least two pulse start indexes are required.');

    const traces = [];
    for (let i = 0; i < numGood; i++) {
      const from = starts[i], to = starts[i + 1];
      if (to === undefined || to > len || from < 1) {
        throw new Error('A pulse start index lies outside the brachial estimate.');
      }
      traces.push(pAll.slice(from - 1, to).map(v => (v === 0 ? NaN : v)));
    }
    series.pulses = { sampleRate: fs, traces };
  });

  // The brachial average beat is the suprasystolic average pulse, scaled to
  // the cuff's systolic and diastolic pressure.
  const baP = section('Brachial average beat', () => {
    const s = input.sAveragePulse;
    const span = max(s).value - min(s).value;
    if (span === 0) throw new Error('The suprasystolic average pulse has zero amplitude.');
    const cal = ba.pp / span;
    return s.map(v => ba.dbp + (v * cal));
  });

  const aoPav = input.cAveragePulse;

  // ── Aortic waveform features, including AIx ───────────────────────────────

  const pwa = section('Aortic pulse wave analysis', () => {
    const r = aiV2(aoPav, fs);
    const Tr = r.Ti - r.Tfoot;
    const [t1, t2] = r.type === 'Type A' ? [r.Ti, r.Tmax] : [r.Tmax, r.Ti];
    const p1 = aoPav[round(t1 * fs) - 1];
    const p2 = aoPav[round(t2 * fs) - 1];
    return { ...r, Tr, p1, p2, ap: p2 - p1 };
  });

  if (pwa) {
    values.re_ao_p1 = pwa.p1;
    values.re_ao_p2 = pwa.p2;
    values.re_aotr = pwa.Tr;
    values.re_aitype = pwa.type;
    values.re_ao_ap = pwa.ap;
    values.re_ao_ai = pwa.ai;
    values.re_aoti = pwa.Ti;
  }

  values.re_ao_dpdt = max(diff(aoPav)).value * fs;

  // ── Reservoir fits ────────────────────────────────────────────────────────

  const aoRes = section('Aortic reservoir', () => bpFitReservoir(aoPav, fs));
  const aoPxs = aoRes ? aoRes.P.map((v, i) => v - aoRes.Pr[i]) : null;

  const baRes = baP ? section('Brachial reservoir', () => bpFitReservoir(baP, fs)) : null;
  const baPxs = baRes ? baRes.P.map((v, i) => v - baRes.Pr[i]) : null;

  if (aoRes) {
    values.re_ao_ed = aoRes.Tn;
    values.re_ao_esp = aoRes.Pn;
    values.re_aopinf = aoRes.Pinf;
    values.re_aofita = aoRes.fita;
    values.re_aofitb = aoRes.fitb;
    values.re_aorsq = aoRes.rsq;

    const prMax = max(aoRes.Pr), xsMax = max(aoPxs);
    values.re_intaopr = sum(aoRes.Pr) / fs;
    values.re_maxaopr = prMax.value;
    values.re_tmaxaopr = (prMax.index + 1) / fs;
    values.re_intaoprlessdbp = sum(aoRes.Pr.map(v => v - ba.dbp)) / fs;
    values.re_intaoxsp = sum(aoPxs) / fs;
    values.re_maxaoxsp = xsMax.value;
    values.re_tmaxaoxsp = (xsMax.index + 1) / fs;

    // Aortic fit quality control: 1 passes, 0 fails a check.
    values.re_qcaofit =
      (aoRes.Pinf >= ba.dbp || aoRes.Pinf < -12 || aoRes.fita <= 0 || aoRes.fitb <= 0 || aoRes.rsq < 0.9)
        ? 0 : 1;
  }

  if (baRes) {
    values.re_ba_esp = baRes.Pn;
    values.re_bapinf = baRes.Pinf;
    values.re_bafita = baRes.fita;
    values.re_bafitb = baRes.fitb;
    values.re_barsq = baRes.rsq;

    const prMax = max(baRes.Pr), xsMax = max(baPxs);
    values.re_intbapr = sum(baRes.Pr) / fs;
    values.re_maxbapr = prMax.value;
    values.re_tmaxbapr = (prMax.index + 1) / fs;
    values.re_intbaxsp = sum(baPxs) / fs;
    values.re_maxbaxsp = xsMax.value;
    values.re_tmaxbap = (xsMax.index + 1) / fs;

    // Peripheral augmentation index and fiducial points on the brachial beat.
    values.re_ba_dpdt = max(diff(baRes.P)).value * fs;
    values.re_tbasbp = (max(baRes.P).index + 1) / fs;

    section('Brachial pulse wave analysis', () => {
      const peaks = findpeaks(diff(baRes.P), { nPeaks: 3 }).locs;
      if (peaks.length < 2) throw new Error('Fewer than two peaks in the brachial dP/dt.');
      values.re_ba_p1 = baRes.P[peaks[0] - 1];
      values.re_ba_t1 = peaks[0] / fs;
      values.re_ba_p2 = baRes.P[peaks[1] - 1];
      values.re_ba_t2 = peaks[1] / fs;
      // Munir S et al. Hypertension 2008;51(1):112-8.
      values.re_pai = 100 * (values.re_ba_p2 - ba.dbp) / (ba.sbp - ba.dbp);
    });
  }

  // ── SEVR ──────────────────────────────────────────────────────────────────
  // The aortic ejection duration marks the end of systole, since the aortic
  // rather than the brachial pressure is the cardiac load.

  let lsysSevr = null;
  if (aoRes) {
    section('Aortic SEVR', () => {
      const lsys = round(aoRes.Tn * fs);
      if (lsys < 1 || lsys >= aoPav.length) throw new Error('The end of systole lies outside the aortic beat.');
      const spti = trapz(aoPav.slice(0, lsys));
      const dpti = trapz(aoPav.slice(lsys));
      values.re_ao_tti = spti;
      values.re_ao_dti = dpti;
      values.re_aosevr = dpti / spti;
      values.re_pmsys = spti / lsys;
      values.re_pmdia = dpti / (aoPav.length - lsys);
      lsysSevr = lsys;
    });

    // Forward and backward pressure, assuming Pb = (Pres - min P)/2.
    const pMin = min(aoRes.P).value;
    const pb = aoRes.Pr.map(v => (v - pMin) / 2);
    const pf = aoRes.P.map((v, i) => v - pb[i] - pMin);
    const pbMax = max(pb), pfMax = max(pf);
    values.re_pb = pbMax.value;
    values.re_pb_t = (pbMax.index + 1) / fs;
    values.re_pf = pfMax.value;
    values.re_pf_t = (pfMax.index + 1) / fs;
    values.re_PbPf = pbMax.value / pfMax.value;
    values.re_ri = pbMax.value / (pfMax.value + pbMax.value);

    series.aortic = {
      sampleRate: fs,
      pressure: aoRes.P.map(v => v - pMin),
      reservoir: aoRes.Pr.map(v => v - pMin),
      excess: aoPxs,
    };
  }

  // ── Wave intensity (central pressure only) ────────────────────────────────

  let lsysWave = null;
  if (aoRes) {
    section('Wave intensity', () => {
      const N = aoRes.P.length;
      if (N < FRAME * 2) throw new Error('The aortic beat is too short for wave intensity analysis.');

      // Excess pressure stands in for flow velocity, peak velocity 1 m/s
      // (Lindroos M et al. J Am Coll Cardiol 1993;21:1220-5), delayed eight
      // samples with the gap filled by a spline.
      const pxsMax = max(aoPxs).value;
      const cu = aoPxs.map(v => UCONST * (v / pxsMax));
      const u = cu.slice();
      for (let k = 8; k < N; k++) u[k] = cu[k - 8];
      for (let k = 0; k < 3; k++) u[k] = 0;
      for (let k = 3; k < 9; k++) u[k] = NaN;
      const uFilled = fillmissingSpline(u);

      const g = sgolayFirstDerivative(NPOLY, FRAME);
      const half = (FRAME + 1) / 2 - 1;
      const dp = new Array(N).fill(0);
      const du = new Array(N).fill(0);
      for (let n1 = (FRAME + 1) / 2; n1 <= N - (FRAME + 1) / 2; n1++) {
        const c = n1 - 1;
        let sp = 0, su = 0;
        for (let j = 0; j < FRAME; j++) {
          sp += g[j] * aoRes.P[c - half + j];
          su += g[j] * uFilled[c - half + j];
        }
        dp[c] = sp;
        du[c] = su;
      }

      // W/m² per cycle².
      const di = dp.map((v, i) => (v * du[i]) * MMHG_PA * N ** 2);
      series.waveIntensity = { sampleRate: fs, di };

      // Restrict the search to systole.
      const lsys = min(dp).index + 1;
      lsysWave = lsys;

      // Wf1: the first peak within 90% of the largest.
      if (lsys + 10 > N) throw new Error('Systole ends too close to the end of the beat to find Wf1.');
      const wf1 = findpeaks(di.slice(0, lsys + 10), { nPeaks: 1, minPeakHeight: max(di).value * 0.9 });
      if (!wf1.pks.length) throw new Error('No first forward wave (Wf1) was found in systole.');

      // Wb: the largest backward wave in systole.
      const negative = di.map(v => -v);
      const wb = findpeaks(negative.slice(0, lsys), { nPeaks: 1, minPeakHeight: 0.7 * max(negative).value });
      const wbPk = wb.pks.length ? wb.pks[0] : 0;
      const wbLoc = wb.pks.length ? wb.locs[0] : 0;
      const wbW = wb.pks.length ? wb.widths[0] : 0;

      const wf1Area = 1.06447 * wf1.pks[0] * wf1.widths[0];
      const wbArea = 1.06447 * wbPk * wbW;

      values.re_wf1i = wf1.pks[0];
      values.re_wf1t = wf1.locs[0] / fs;
      values.re_wf1a = wf1Area;
      values.re_wbi = wbPk;
      values.re_wbt = wbLoc / fs;
      values.re_wba = wbArea;
      values.re_wri = wbArea / wf1Area;
      values.re_rhoc = pxsMax * MMHG_PA / 1000;

      series.waveIntensity.wf1 = { t: wf1.locs[0] / fs, value: wf1.pks[0] };
      series.waveIntensity.wb = { t: wbLoc / fs, value: -wbPk };

      // Wf2: the largest peak within 20 samples of the end of systole.
      if (lsys - 20 < 1 || lsys + 20 > N) {
        throw new Error('Systole ends too close to either end of the beat to find Wf2.');
      }
      const wf2 = findpeaks(di.slice(lsys - 21, lsys + 20), { nPeaks: 1, sortStr: 'descend' });
      if (!wf2.pks.length) throw new Error('No second forward wave (Wf2) was found at the end of systole.');
      const wf2Loc = wf2.locs[0] + (lsys - 20);

      values.re_wf2i = wf2.pks[0];
      values.re_wf2t = wf2Loc / fs;
      values.re_wf2a = 1.06447 * wf2.pks[0] * wf2.widths[0];
      series.waveIntensity.wf2 = { t: wf2Loc / fs, value: wf2.pks[0] };
    });
  }

  // ── SEVR plot ─────────────────────────────────────────────────────────────
  // bpp_Res2 draws this after the wave intensity section, which reuses lsys for
  // the minimum dP — so beta7's figure ends systole there, not where the SEVR
  // value it illustrates does.

  const systoleEnd = beta7 ? lsysWave : lsysSevr;
  if (aoRes && systoleEnd !== null) {
    const notch = fix(sep * fs);
    series.sevr = {
      pressure: aoPav.slice(),
      base: min(aoPav).value,
      systoleEnd,
      notch: notch >= 1 && notch <= aoPav.length ? notch : null,
      inflection: pwa ? round(pwa.Ti * fs) : null,
    };
  }

  // ── Derived values ────────────────────────────────────────────────────────

  values.re_ppar = ba.pp / ao.pp;
  if (pwa) values.re_ai75 = pwa.ai + 0.481 * ba.hr - 36.1;
  if (aoRes) {
    // The beat less the ejection duration. beta7 subtracts the end-systolic
    // pressure over 1000, which lands in a plausible range and so goes unseen.
    values.re_aodd = beta7 ? 60 / ba.hr - aoRes.Pn / 1000 : 60 / ba.hr - aoRes.Tn;
  }
  if (aoRes && pwa) {
    // Nichols WW. Am J Hypertens 2005;18(1 Pt 2):3S-10S.
    values.re_ao_ew = Math.PI / 2 * (aoRes.Tn - pwa.Tr) * (ao.sbp - pwa.Pi) * MMHG_PA;
  }

  return result;
}

function finite(v) {
  return Number.isFinite(v) ? v : null;
}
