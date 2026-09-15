/**
 * The MATLAB functions the reservoir analysis depends on, ported so that the
 * numbers agree with the MATLAB original rather than merely resembling it.
 *
 * A textbook implementation is not enough here. The analysis picks peaks by
 * height and width, fits by Nelder-Mead and inverts a ratio by root finding,
 * and each of those has MATLAB-specific behaviour that moves the answer: which
 * of two equal samples is the maximum, how fminsearch builds its first simplex
 * and when it stops, what findpeaks measures a width against. Where MATLAB's
 * choice is arbitrary it is copied, not improved.
 *
 * Conventions:
 *   - arrays are plain 0-based JavaScript arrays;
 *   - an index RETURNED to a caller that MATLAB would use arithmetically (a
 *     peak location divided by the sample rate, say) is returned 1-based, and
 *     the function says so. The analysis code converts at the point of use.
 */

/** MATLAB's eps: 2^-52. */
export const EPS = 2 ** -52;

const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

/** eps(x): the distance from |x| to the next larger double. */
export function epsOf(x) {
  _f64[0] = Math.abs(x);
  const exponent = (_u32[1] >>> 20) & 0x7ff;
  if (exponent === 0) return 2 ** -1074;
  if (exponent === 0x7ff) return NaN;
  return 2 ** (exponent - 1075);
}

/** round(): halves away from zero. Math.round sends -2.5 to -2. */
export function round(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** fix(): towards zero. */
export const fix = Math.trunc;

/**
 * [value, index] = max(x). NaN is ignored; the FIRST maximum wins.
 * @returns {{value: number, index: number}} index is 0-based, -1 if all NaN
 */
export function max(x) {
  let value = NaN, index = -1;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (Number.isNaN(v)) continue;
    if (index < 0 || v > value) { value = v; index = i; }
  }
  return { value, index };
}

/** [value, index] = min(x). NaN is ignored; the FIRST minimum wins. */
export function min(x) {
  let value = NaN, index = -1;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (Number.isNaN(v)) continue;
    if (index < 0 || v < value) { value = v; index = i; }
  }
  return { value, index };
}

export function sum(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s;
}

export function diff(x) {
  const out = new Array(Math.max(0, x.length - 1));
  for (let i = 0; i < out.length; i++) out[i] = x[i + 1] - x[i];
  return out;
}

/** trapz(y), unit spacing. */
export function trapz(y) {
  let s = 0;
  for (let i = 0; i + 1 < y.length; i++) s += y[i] + y[i + 1];
  return s / 2;
}

/** cumtrapz(y), unit spacing. */
export function cumtrapz(y) {
  const out = new Array(y.length);
  if (y.length === 0) return out;
  out[0] = 0;
  for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + (y[i - 1] + y[i]) / 2;
  return out;
}

/**
 * filter(b, 1, x) for an FIR filter.
 *
 * Evaluated in MATLAB's transposed direct form II order, so the rounding of
 * each output sample matches rather than being the same sum added up in a
 * different order.
 */
export function filterFir(b, x) {
  const nb = b.length;
  const y = new Array(x.length);
  if (nb === 1) {
    for (let i = 0; i < x.length; i++) y[i] = b[0] * x[i];
    return y;
  }
  const z = new Array(nb - 1).fill(0);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    y[i] = b[0] * xi + z[0];
    for (let k = 1; k < nb - 1; k++) z[k - 1] = b[k] * xi + z[k];
    z[nb - 2] = b[nb - 1] * xi;
  }
  return y;
}

/** p = polyfit(x, y, 1). @returns {[number, number]} [slope, intercept] */
export function polyfit1(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    sxy += dx * (y[i] - my);
    sxx += dx * dx;
  }
  const slope = sxy / sxx;
  return [slope, my - slope * mx];
}

/** The off-diagonal of corrcoef(x, y): Pearson's r. NaN if either is constant. */
export function corrcoef(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

// ── Savitzky-Golay ───────────────────────────────────────────────────────────

/**
 * The first-derivative filter of [b, g] = sgolay(order, frame) — g(:,2).
 *
 * G = S * inv(S'S), where S is the Vandermonde matrix of the frame's sample
 * offsets. Applied as dot(g, window) it gives the slope per sample.
 */
export function sgolayFirstDerivative(order, frame) {
  const half = (frame - 1) / 2;
  const cols = order + 1;
  const S = [];
  for (let i = 0; i < frame; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) row.push((i - half) ** j);
    S.push(row);
  }
  const StS = [];
  for (let a = 0; a < cols; a++) {
    StS.push([]);
    for (let b = 0; b < cols; b++) {
      let s = 0;
      for (let i = 0; i < frame; i++) s += S[i][a] * S[i][b];
      StS[a].push(s);
    }
  }
  const inv = invert(StS);
  const g = [];
  for (let i = 0; i < frame; i++) {
    let s = 0;
    for (let k = 0; k < cols; k++) s += S[i][k] * inv[k][1];
    g.push(s);
  }
  return g;
}

/** Gauss-Jordan inverse with partial pivoting, for the small normal matrix above. */
function invert(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const p = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= p;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map(row => row.slice(n));
}

// ── findpeaks ────────────────────────────────────────────────────────────────

/**
 * [pks, locs, w] = findpeaks(y, 'MinPeakHeight', h, 'NPeaks', n, 'SortStr', s)
 *
 * What the analysis uses and no more: local maxima strictly above a height,
 * in signal order or by descending height, the first n kept, each with its
 * width at half prominence.
 *
 * MATLAB's local maxima: a plateau counts once, at its first sample, and
 * neither end of the signal can be a peak. Prominence: from the peak, extend
 * left and right until a peak at least as high or the end of the signal; the
 * higher of the two minima in those intervals is the base. Width: between the
 * linear-interpolated crossings of the level half-way between peak and base.
 *
 * @param {number[]} y
 * @param {{minPeakHeight?: number, nPeaks?: number, sortStr?: 'none'|'descend'}} [options]
 * @returns {{pks: number[], locs: number[], widths: number[]}} locs are 1-BASED,
 *          as MATLAB returns them
 */
export function findpeaks(y, options = {}) {
  const minH = options.minPeakHeight ?? -Infinity;
  const nPeaks = options.nPeaks ?? Infinity;
  const sortStr = options.sortStr ?? 'none';

  const all = localMaxima(y);
  let candidates = all.filter(i => y[i] > minH);

  if (sortStr === 'descend') {
    // Stable: equal heights keep signal order, as MATLAB's sort does.
    candidates = candidates
      .map((index, order) => ({ index, order }))
      .sort((a, b) => (y[b.index] - y[a.index]) || (a.order - b.order))
      .map(c => c.index);
  }
  candidates = candidates.slice(0, Math.min(candidates.length, nPeaks));

  const pks = [], locs = [], widths = [];
  for (const i of candidates) {
    pks.push(y[i]);
    locs.push(i + 1);
    widths.push(halfProminenceWidth(y, i, all));
  }
  return { pks, locs, widths };
}

/** MATLAB's findLocalMaxima, 0-based. */
function localMaxima(y) {
  // Bookend with NaN; keep only the first of each run of equal values.
  const yt = [NaN, ...y, NaN];
  const keep = [0];
  for (let i = 0; i + 1 < yt.length; i++) {
    const differ = yt[i] !== yt[i + 1] && !(Number.isNaN(yt[i]) && Number.isNaN(yt[i + 1]));
    if (differ && (!Number.isNaN(yt[i]) || !Number.isNaN(yt[i + 1]))) keep.push(i + 1);
  }
  const s = [];
  for (let k = 0; k + 1 < keep.length; k++) s.push(Math.sign(yt[keep[k + 1]] - yt[keep[k]]));
  const peaks = [];
  for (let k = 0; k + 1 < s.length; k++) {
    if (s[k + 1] - s[k] < 0) peaks.push(keep[k + 1] - 1);
  }
  return peaks;
}

function halfProminenceWidth(y, i, peaks) {
  const p = y[i];

  // Left interval: back to the nearest peak at least as high, or the start.
  let left = 0;
  for (let k = peaks.length - 1; k >= 0; k--) {
    if (peaks[k] < i && y[peaks[k]] >= p) { left = peaks[k]; break; }
  }
  let right = y.length - 1;
  for (let k = 0; k < peaks.length; k++) {
    if (peaks[k] > i && y[peaks[k]] >= p) { right = peaks[k]; break; }
  }

  let iLB = i, iRB = i;
  for (let j = i; j >= left; j--) {
    if (Number.isNaN(y[j])) break;
    if (y[j] < y[iLB]) iLB = j;
  }
  for (let j = i; j <= right; j++) {
    if (Number.isNaN(y[j])) break;
    if (y[j] < y[iRB]) iRB = j;
  }

  const base = Math.max(y[iLB], y[iRB]);
  const ref = 0.5 * (p + base);

  // x is the 1-based sample number, as in MATLAB.
  let idx = i;
  while (idx >= iLB && y[idx] > ref) idx--;
  const xLeft = idx < iLB
    ? iLB + 1
    : linterp(idx + 1, idx + 2, y[idx], y[idx + 1], p, base);

  idx = i;
  while (idx <= iRB && y[idx] > ref) idx++;
  const xRight = idx > iRB
    ? iRB + 1
    : linterp(idx + 1, idx, y[idx], y[idx - 1], p, base);

  return xRight - xLeft;
}

function linterp(xa, xb, ya, yb, yc, bc) {
  return xa + (xb - xa) * (0.5 * (yc + bc) - ya) / (yb - ya);
}

// ── Interpolation ────────────────────────────────────────────────────────────

/**
 * fillmissing(u, 'spline'): each NaN replaced by a not-a-knot cubic spline
 * through every sample that is not NaN.
 */
export function fillmissingSpline(u) {
  const xs = [], ys = [], missing = [];
  for (let i = 0; i < u.length; i++) {
    if (Number.isNaN(u[i])) missing.push(i);
    else { xs.push(i + 1); ys.push(u[i]); }
  }
  if (missing.length === 0) return u.slice();
  const values = spline(xs, ys, missing.map(i => i + 1));
  const out = u.slice();
  missing.forEach((i, k) => { out[i] = values[k]; });
  return out;
}

/**
 * spline(x, y, xq) — MATLAB's not-a-knot cubic spline.
 *
 * Solves for the slope at each knot, then evaluates the cubic Hermite piece
 * the query falls in; a query outside the knots extrapolates the end piece.
 */
export function spline(x, y, xq) {
  const n = x.length;
  if (n < 4) throw new Error('spline needs at least four points here');

  const dx = diff(x);
  const d = dx.map((h, i) => (y[i + 1] - y[i]) / h);

  // Tridiagonal system for the slopes s, rows as in MATLAB's spline.m.
  const lower = new Array(n).fill(0);
  const diag = new Array(n).fill(0);
  const upper = new Array(n).fill(0);
  const rhs = new Array(n).fill(0);

  const x31 = x[2] - x[0];
  const xn = x[n - 1] - x[n - 3];

  diag[0] = dx[1];
  upper[0] = x31;
  rhs[0] = ((dx[0] + 2 * x31) * dx[1] * d[0] + dx[0] * dx[0] * d[1]) / x31;

  for (let i = 1; i < n - 1; i++) {
    lower[i] = dx[i];
    diag[i] = 2 * (dx[i] + dx[i - 1]);
    upper[i] = dx[i - 1];
    rhs[i] = 3 * (dx[i] * d[i - 1] + dx[i - 1] * d[i]);
  }

  lower[n - 1] = xn;
  diag[n - 1] = dx[n - 3];
  rhs[n - 1] = (dx[n - 2] * dx[n - 2] * d[n - 3] + (2 * xn + dx[n - 2]) * dx[n - 3] * d[n - 2]) / xn;

  const s = solveTridiagonal(lower, diag, upper, rhs);

  return xq.map(q => {
    let k = 0;
    if (q >= x[n - 1]) k = n - 2;
    else if (q > x[0]) { while (k < n - 2 && q >= x[k + 1]) k++; }
    const h = dx[k];
    const t = q - x[k];
    const c2 = (3 * d[k] - 2 * s[k] - s[k + 1]) / h;
    const c1 = (s[k] + s[k + 1] - 2 * d[k]) / (h * h);
    return ((c1 * t + c2) * t + s[k]) * t + y[k];
  });
}

/**
 * Tridiagonal solve with partial pivoting. The not-a-knot end rows are not
 * diagonally dominant, so plain Thomas elimination is not guaranteed.
 */
function solveTridiagonal(lower, diag, upper, rhs) {
  const n = diag.length;
  // Rows carry up to two entries right of the diagonal once pivoting swaps.
  const a = diag.slice(), b = upper.slice(), c = new Array(n).fill(0), r = rhs.slice();
  const l = lower.slice();

  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(l[i + 1]) > Math.abs(a[i])) {
      // Swap row i and row i+1 (columns i, i+1, i+2).
      [a[i], l[i + 1]] = [l[i + 1], a[i]];
      [b[i], a[i + 1]] = [a[i + 1], b[i]];
      [c[i], b[i + 1]] = [b[i + 1], c[i]];
      [r[i], r[i + 1]] = [r[i + 1], r[i]];
    }
    const f = l[i + 1] / a[i];
    a[i + 1] -= f * b[i];
    b[i + 1] -= f * c[i];
    r[i + 1] -= f * r[i];
    l[i + 1] = 0;
  }

  const s = new Array(n);
  s[n - 1] = r[n - 1] / a[n - 1];
  if (n > 1) s[n - 2] = (r[n - 2] - b[n - 2] * s[n - 1]) / a[n - 2];
  for (let i = n - 3; i >= 0; i--) s[i] = (r[i] - b[i] * s[i + 1] - c[i] * s[i + 2]) / a[i];
  return s;
}

// ── Root finding and minimisation ────────────────────────────────────────────

/**
 * x = fzero(fun, x0) with TolX, for a scalar start.
 *
 * First the search MATLAB makes for a sign change, widening an interval about
 * x0 by sqrt(2) each step and testing the left end before the right; then
 * Brent's method on the bracket. A non-finite value during the search ends it
 * with NaN, as MATLAB's exitflag -3 does.
 *
 * @returns {number} NaN when no bracket could be found
 */
export function fzero(fun, x0, tolX = EPS) {
  const fx = fun(x0);
  if (fx === 0) return x0;
  if (!Number.isFinite(fx)) throw new Error('fzero: the value at the initial guess is not finite');

  let dx = x0 !== 0 ? x0 / 50 : 1 / 50;
  const twosqrt = Math.sqrt(2);
  let a = x0, fa = fx, b = x0, fb = fx;

  while ((fa > 0) === (fb > 0)) {
    dx = twosqrt * dx;
    a = x0 - dx;
    fa = fun(a);
    if (!Number.isFinite(fa) || !Number.isFinite(a)) return NaN;
    if ((fa > 0) !== (fb > 0)) break;
    b = x0 + dx;
    fb = fun(b);
    if (!Number.isFinite(fb) || !Number.isFinite(b)) return NaN;
  }

  let fc = fb, c = b, d = 0, e = 0;

  while (fb !== 0 && a !== b) {
    if ((fb > 0) === (fc > 0)) {
      c = a; fc = fa;
      d = b - a; e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a;
      fa = fb; fb = fc; fc = fa;
    }

    const m = 0.5 * (c - b);
    const toler = 2.0 * tolX * Math.max(Math.abs(b), 1.0);
    if (Math.abs(m) <= toler || fb === 0) break;

    if (Math.abs(e) < toler || Math.abs(fa) <= Math.abs(fb)) {
      d = m; e = m;
    } else {
      let s = fb / fa, p, q;
      if (a === c) {
        p = 2.0 * m * s;
        q = 1.0 - s;
      } else {
        q = fa / fc;
        const r = fb / fc;
        p = s * (2.0 * m * q * (q - r) - (b - a) * (r - 1.0));
        q = (q - 1.0) * (r - 1.0) * (s - 1.0);
      }
      if (p > 0) q = -q; else p = -p;
      if (2.0 * p < 3.0 * m * q - Math.abs(toler * q) && p < Math.abs(0.5 * e * q)) {
        e = d; d = p / q;
      } else {
        d = m; e = m;
      }
    }

    a = b; fa = fb;
    if (Math.abs(d) > toler) b = b + d;
    else if (b > c) b = b - toler;
    else b = b + toler;
    fb = fun(b);
  }
  return b;
}

/**
 * [x, fval, exitflag] = fminsearch(fun, x0, optimset('TolX', tolX)) for one
 * variable.
 *
 * MATLAB's Nelder-Mead exactly: the 5% (or 0.00025 from zero) first simplex,
 * reflection 1, expansion 2, contraction 0.5, shrink 0.5, TolFun 1e-4, and at
 * most 200 iterations and 200 function evaluations. exitflag is 0 when a limit
 * stopped it, which the reservoir fit treats as a failed fit.
 */
export function fminsearch(fun, x0, tolX = 1e-4) {
  const tolF = 1e-4;
  const maxFun = 200, maxIter = 200;

  let v = [x0, x0 !== 0 ? 1.05 * x0 : 0.00025];
  let fv = [fun(v[0]), fun(v[1])];
  let funcEvals = 2;
  let iter = 1;
  [v, fv] = sortSimplex(v, fv);

  while (funcEvals < maxFun && iter < maxIter) {
    if (Math.abs(fv[0] - fv[1]) <= Math.max(tolF, 10 * epsOf(fv[0])) &&
        Math.abs(v[1] - v[0]) <= Math.max(tolX, 10 * epsOf(v[0]))) {
      break;
    }

    const xbar = v[0];
    const xr = 2 * xbar - v[1];
    const fxr = fun(xr);
    funcEvals++;

    let shrink = false;
    if (fxr < fv[0]) {
      const xe = 3 * xbar - 2 * v[1];
      const fxe = fun(xe);
      funcEvals++;
      if (fxe < fxr) { v[1] = xe; fv[1] = fxe; }
      else { v[1] = xr; fv[1] = fxr; }
    } else if (fxr < fv[0]) {
      // fv(:,n) is fv(1) for one variable, so this branch cannot be taken.
      v[1] = xr; fv[1] = fxr;
    } else if (fxr < fv[1]) {
      const xc = 1.5 * xbar - 0.5 * v[1];
      const fxc = fun(xc);
      funcEvals++;
      if (fxc <= fxr) { v[1] = xc; fv[1] = fxc; }
      else shrink = true;
    } else {
      const xcc = 0.5 * xbar + 0.5 * v[1];
      const fxcc = fun(xcc);
      funcEvals++;
      if (fxcc < fv[1]) { v[1] = xcc; fv[1] = fxcc; }
      else shrink = true;
    }

    if (shrink) {
      v[1] = v[0] + 0.5 * (v[1] - v[0]);
      fv[1] = fun(v[1]);
      funcEvals++;
    }

    [v, fv] = sortSimplex(v, fv);
    iter++;
  }

  const exitflag = funcEvals >= maxFun || iter >= maxIter ? 0 : 1;
  return { x: v[0], fval: fv[0], exitflag };
}

/** MATLAB's sort on the function values: stable, NaN last. */
function sortSimplex(v, fv) {
  const second = Number.isNaN(fv[0]) ? !Number.isNaN(fv[1]) : fv[1] < fv[0];
  return second ? [[v[1], v[0]], [fv[1], fv[0]]] : [v, fv];
}
