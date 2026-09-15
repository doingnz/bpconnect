"""
An independent reference for analysis/, built on numpy and scipy.

    python test/reservoir/reference.py OUT_DIR file.xml [file.xml ...]

Writes OUT_DIR/<name>.json with the 89 resdata.xls values for each file.

This is NOT MATLAB, and results from it are labelled "scipy reference" rather
than "MATLAB beta7". It exists because the numerical parts of bpp_Res2.m are
MATLAB built-ins whose exact behaviour the JavaScript port has to reproduce,
and scipy implements the same algorithms independently:

    findpeaks + widths    scipy.signal.find_peaks, peak_widths(rel_height=0.5)
    sgolay                scipy.signal.savgol_coeffs
    fillmissing 'spline'  scipy.interpolate.CubicSpline(bc_type='not-a-knot')
    fzero                 scipy.optimize.brentq, after MATLAB's bracket search
    fminsearch            scipy.optimize.fmin, which follows fminsearch
    filter                scipy.signal.lfilter

So agreement here checks those ports. It does not check that bpp_Res2.m was
read correctly: the script logic is transcribed twice by the same reader.
Only MATLAB can check that — see export_reference.m.

Requires numpy and scipy.
"""

import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy.integrate import cumulative_trapezoid
from scipy.interpolate import CubicSpline
from scipy.optimize import brentq, fmin
from scipy.signal import find_peaks, lfilter, peak_widths, savgol_coeffs

MMHG_PA = 133.322

C = [0.107143, 0.071429, 0.035714]
SG7 = np.array([C[0], C[1], C[2], 0.0, -C[2], -C[1], -C[0]])


def mround(x):
    """MATLAB round: halves away from zero."""
    return int(math.copysign(math.floor(abs(x) + 0.5), x))


# ── reading ──────────────────────────────────────────────────────────────────

def read(path):
    root = ET.parse(path).getroot()
    if root.tag != 'BPplus':
        return None
    logger = root.find('MeasDataLogger')
    result = root.find('Results/Result')

    def num(tag):
        el = result.find(tag) if result is not None else None
        if el is None:
            el = logger.find(tag)
        if el is None or el.text is None or not el.text.strip():
            return float('nan')
        return float(el.text)

    def arr(tag):
        el = result.find(tag) if result is not None else None
        if el is None or el.text is None or not el.text.strip():
            return np.array([])
        return np.array([float(v) if v.strip() else float('nan') for v in el.text.split(',')])

    return {
        'file': Path(path).name,
        'datetime': logger.get('datetime', ''),
        'softwareVersion': logger.get('version', ''),
        'algorithmRevision': result.get('algorithm_revision', '') if result is not None else '',
        'fs': num('SampleRate'), 'snr': num('SNR'),
        'sys': num('Sys'), 'dia': num('Dia'), 'map': num('Map'), 'pr': num('Pr'),
        'cSys': num('cSys'), 'cDia': num('cDia'), 'cMap': num('cMap'),
        'sPRV': num('sPRV'), 'sAI': num('sAI'), 'sPPV': num('sPPV'),
        'sRWTTFoot': num('sRWTTFoot'), 'sRWTTPeak': num('sRWTTPeak'), 'sSEP': num('sSEP'),
        'sAveragePulse': arr('sAveragePulse'), 'cAveragePulse': arr('cAveragePulse'),
    }


# ── ai_v2 ────────────────────────────────────────────────────────────────────

def fsg71(x):
    dx = lfilter(SG7, [1.0], x)
    return np.concatenate(([0, 0, 0], dx[6:], [0, 0, 0]))


def ai_v2(p, fs):
    d4 = fsg71(fsg71(fsg71(fsg71(p))))
    m4 = np.nanmax(d4)
    nd4 = 1e-6 + np.trunc(10 * (d4 / m4))
    crossings = []
    for i in range(len(nd4) - 1):
        a, b = nd4[i], nd4[i + 1]
        if (a < 0 < b) or (a > 0 > b):
            crossings.append((i + 1) + (0 - a) / (b - a))   # 1-based sample number
    zc = [mround(v) for v in crossings]
    tmax = int(np.argmax(p)) + 1
    pmax = p[tmax - 1]
    tfoot, ti = zc[0], zc[2]
    if tmax - ti < 5:
        ti = zc[3]
    pfoot, Pi = p[tfoot - 1], p[ti - 1]
    ai = mround((pmax - Pi) / (pmax - pfoot) * 100)
    if tmax < ti:
        ai = -ai
    typ = ('Type A' if ai > 12 else 'Type B') if tmax >= ti else 'Type C'
    return ai, Pi, tfoot / fs, ti / fs, tmax / fs, typ


# ── kreservoir_v15 / BPfitres_v1 ─────────────────────────────────────────────

def fsg721(x):
    dx = lfilter(SG7, [1.0], x)
    s = len(x)
    return np.concatenate(([dx[6]] * 3, dx[6:], [dx[s - 1]] * 3))


def ratio21(y):
    e = math.exp
    if y == 1:
        return ((e(1) - 1) - (1 - e(-1)) * (e(2) - 1) / 2) / (1 - (1 - e(-1)) * (e(1) - 1))
    if y == 2:
        return (1 - (1 - e(-2)) * (e(2) - 1) / 4) / (-(e(-1) - 1) - (1 - e(-2)) * (e(1) - 1) / 2)
    if y == 0:
        return 1 / (3 - e(1))
    return (((e(2 - y) - 1) / (2 - y) - (1 - e(-y)) * (e(2) - 1) / (2 * y)) /
            ((e(1 - y) - 1) / (1 - y) - (1 - e(-y)) * (e(1) - 1) / y))


def fzero_bracket_then_brent(f, x0):
    fx = f(x0)
    if fx == 0:
        return x0
    dx = x0 / 50 if x0 != 0 else 1 / 50
    a = b = x0
    fa = fb = fx
    with np.errstate(all='ignore'):
        while (fa > 0) == (fb > 0):
            dx *= math.sqrt(2)
            a = x0 - dx
            fa = f(a)
            if not math.isfinite(fa):
                return float('nan')
            if (fa > 0) != (fb > 0):
                break
            b = x0 + dx
            fb = f(b)
            if not math.isfinite(fb):
                return float('nan')
    lo, hi = min(a, b), max(a, b)
    return brentq(f, lo, hi, xtol=1e-300, rtol=4 * np.finfo(float).eps, maxiter=500)


def kreservoir(P, Tb, fs):
    p = np.asarray(P, dtype=float)
    Nb = len(p)
    t = np.linspace(0, Tb, Nb)
    dp = fsg721(p)
    nn = int(np.argmin(dp))
    tn = t[nn]
    pd = p[nn:]
    td = t[nn:] - tn
    Td = Tb - tn
    dt = td[1] - td[0]
    N = len(pd) - 1

    def simpson(v):
        return v[0] + 4 * np.sum(v[1:N:2]) + 2 * np.sum(v[2:N:2]) + v[N]

    E0 = simpson(pd) * dt / (3 * Td)
    if N % 2:
        E0 += (pd[N - 1] + pd[N]) * dt / (6 * Td)
    pde1 = (pd - E0) * np.exp(td / Td)
    E1 = simpson(pde1) * dt / 3
    if N % 2:
        E1 += (pde1[N - 1] + pde1[N]) * dt / 6
    pde2 = (pd - E0) * np.exp(2 * td / Td)
    E2 = simpson(pde2) * dt / 3
    if N % 2:
        E2 += (pde2[N - 1] + pde2[N]) * dt / 6
    r = E2 / E1

    y = fzero_bracket_then_brent(lambda v: ratio21(v) - r, 1.0)
    if y > 0:
        BTd = y
    else:
        Y = np.log(p[nn:])
        X = np.arange(len(Y)) / fs
        BTd = -np.polyfit(X, Y, 1)[0] * Td

    e1 = math.exp(1)
    denom = (3 - e1 - 1 / e1) if BTd == 1 else \
        (1 - e1 * math.exp(-BTd)) / (BTd - 1) - (e1 - 1) * (1 - math.exp(-BTd)) / BTd
    a = E1 / (Td * denom)
    c = E0 - (a / BTd) * (1 - math.exp(-BTd))
    b = BTd / Td
    pinf = c
    prd = a * np.exp(-b * td) + c

    def integral(aa, guard):
        if guard and abs(aa + b) < np.finfo(float).eps:
            aa = aa + np.finfo(float).eps
        k = aa + b
        pse = cumulative_trapezoid(p * np.exp(k * t), initial=0) * (t[1] - t[0])
        return np.exp(-k * t) * (aa * pse + p[0] - b * pinf / k) + b * pinf / k

    def dias_fit(x):
        return float(np.sum((prd - integral(float(np.atleast_1d(x)[0]), True)[nn:]) ** 2))

    xopt, _, _, _, warnflag = fmin(dias_fit, b, xtol=1e-6, ftol=1e-4, maxiter=200, maxfun=200,
                                   full_output=True, disp=False)
    aa = float(xopt[0])
    pr = integral(aa, False)
    if warnflag:
        pr = np.full(len(p), np.min(p))

    Nd = len(pd)
    prend = pr[nn:]
    nxt = np.append(np.arange(1, Nd), Nd - 1)
    hits = np.nonzero((prend - prd) * (prend[nxt] - prd[nxt]) <= 0)[0]
    prr = pr.copy()
    if len(hits):
        k = hits[0]
        prr[nn + k + 1:] = prd[k + 1:]
    return prr, aa, b, pinf, t[nn], p[nn]


def bpfitres(p_av, fs):
    T = len(p_av) / fs
    cut = np.nonzero(np.diff(p_av) < 0)[0][-1] + 1
    P = p_av[:cut]
    Pr, A, B, Pinf, Tn, Pn = kreservoir(P, T, fs)
    xn = mround(Tn * fs)
    if len(P) - xn > 10:
        rsq = np.corrcoef(P[xn - 1:], Pr[xn - 1:])[0, 1] ** 2
    else:
        rsq = 0.0
    return Tn, Pinf, P, Pr, Pn, A, B, rsq


# ── findpeaks ────────────────────────────────────────────────────────────────

def peaks(y, min_height=-np.inf, n=None, descend=False):
    idx, _ = find_peaks(y)
    idx = np.array([i for i in idx if y[i] > min_height], dtype=int)
    if descend and len(idx):
        idx = idx[np.argsort(-y[idx], kind='stable')]
    if n is not None:
        idx = idx[:n]
    widths = peak_widths(y, idx, rel_height=0.5)[0] if len(idx) else np.array([])
    return y[idx], idx + 1, widths


# ── bpp_Res2 ─────────────────────────────────────────────────────────────────

def analyse(m):
    fs = m['fs']
    v = {}
    v['re_date'] = m['datetime']
    v['re_bppvers'] = m['softwareVersion']
    v['re_bppalgo'] = m['algorithmRevision']
    v['re_resvers'] = 'beta7'
    v['re_kres'] = 'v15'
    v['re_snr'] = m['snr']
    if not m['snr'] >= 6:
        return v

    sbp, dbp, hr = m['sys'], m['dia'], m['pr']
    bapp = sbp - dbp
    aopp = m['cSys'] - m['cDia']
    snr = m['snr']
    v.update({
        're_sam_rate': fs, 're_basbp': sbp, 're_ba_dbp': dbp, 're_hr': hr, 're_ba_map': m['map'],
        're_bapp': bapp, 're_aosbp': m['cSys'], 're_aodbp': m['cDia'], 're_aopp': aopp,
        're_rmssd': m['sPRV'], 're_sAI': m['sAI'], 're_ppv': m['sPPV'], 're_rwttf': m['sRWTTFoot'],
        're_rwttp': m['sRWTTPeak'], 're_sep': m['sSEP'] / 1000,
        're_quality': 'excellent' if snr >= 12 else ('good' if snr >= 9 else 'acceptable'),
    })

    s = m['sAveragePulse']
    ba_p_av = dbp + s * (bapp / (np.max(s) - np.min(s)))
    ao = m['cAveragePulse']

    ai, Pi, Tfoot, Ti, Tmax, typ = ai_v2(ao, fs)
    Tr = Ti - Tfoot
    t1, t2 = (Ti, Tmax) if typ == 'Type A' else (Tmax, Ti)
    p1, p2 = ao[mround(t1 * fs) - 1], ao[mround(t2 * fs) - 1]
    v.update({'re_ao_p1': p1, 're_ao_p2': p2, 're_aotr': Tr, 're_aitype': typ,
              're_ao_ap': p2 - p1, 're_ao_ai': ai, 're_aoti': Ti})
    v['re_ao_dpdt'] = np.max(np.diff(ao)) * fs

    aoTn, aoPinf, aoP, aoPr, aoPn, aoa, aob, aorsq = bpfitres(ao, fs)
    aoPxs = aoP - aoPr
    baTn, baPinf, baP, baPr, baPn, baa, bab, barsq = bpfitres(ba_p_av, fs)
    baPxs = baP - baPr

    _, locs, _ = peaks(np.diff(baP), n=3)
    v.update({'re_ba_p1': baP[locs[0] - 1], 're_ba_t1': locs[0] / fs,
              're_ba_p2': baP[locs[1] - 1], 're_ba_t2': locs[1] / fs})
    v['re_pai'] = 100 * (v['re_ba_p2'] - dbp) / (sbp - dbp)
    v['re_ba_dpdt'] = np.max(np.diff(baP)) * fs
    v['re_tbasbp'] = (int(np.argmax(baP)) + 1) / fs

    lsys = mround(aoTn * fs)
    spti = np.trapezoid(ao[:lsys])
    dpti = np.trapezoid(ao[lsys:])
    v.update({'re_ao_tti': spti, 're_ao_dti': dpti, 're_aosevr': dpti / spti,
              're_pmsys': spti / lsys, 're_pmdia': dpti / (len(ao) - lsys)})

    pmin = np.min(aoP)
    pb = (aoPr - pmin) / 2
    pf = aoP - pb - pmin
    v.update({'re_pb': np.max(pb), 're_pb_t': (int(np.argmax(pb)) + 1) / fs,
              're_pf': np.max(pf), 're_pf_t': (int(np.argmax(pf)) + 1) / fs})
    v['re_PbPf'] = v['re_pb'] / v['re_pf']
    v['re_ri'] = v['re_pb'] / (v['re_pf'] + v['re_pb'])

    # Wave intensity
    N = len(aoP)
    cu = aoPxs / np.max(aoPxs)
    u = cu.copy()
    u[8:] = cu[:-8]
    u[:3] = 0
    u[3:9] = np.nan
    known = ~np.isnan(u)
    xs = np.arange(1, N + 1)
    u[~known] = CubicSpline(xs[known], u[known], bc_type='not-a-knot')(xs[~known])
    g = savgol_coeffs(9, 3, deriv=1, use='dot')
    dp = np.zeros(N)
    du = np.zeros(N)
    for c in range(4, N - 5):
        dp[c] = np.dot(g, aoP[c - 4:c + 5])
        du[c] = np.dot(g, u[c - 4:c + 5])
    di = dp * du * MMHG_PA * N ** 2
    lsw = int(np.argmin(dp)) + 1

    pk1, loc1, w1 = peaks(di[:lsw + 10], min_height=np.max(di) * 0.9, n=1)
    pkb, locb, wb = peaks(-di[:lsw], min_height=0.7 * np.max(-di), n=1)
    if len(pkb) == 0:
        pkb, locb, wb = [0.0], [0], [0.0]
    pk2, loc2, w2 = peaks(di[lsw - 21:lsw + 20], n=1, descend=True)
    loc2 = loc2[0] + (lsw - 20)
    a1 = 1.06447 * pk1[0] * w1[0]
    ab = 1.06447 * pkb[0] * wb[0]
    v.update({'re_wf1i': pk1[0], 're_wf1t': loc1[0] / fs, 're_wf1a': a1,
              're_wbi': pkb[0], 're_wbt': locb[0] / fs, 're_wba': ab,
              're_wf2i': pk2[0], 're_wf2t': loc2 / fs, 're_wf2a': 1.06447 * pk2[0] * w2[0],
              're_wri': ab / a1, 're_rhoc': np.max(aoPxs) * MMHG_PA / 1000})

    v['re_qcaofit'] = 0 if (aoPinf >= dbp or aoPinf < -12 or aoa <= 0 or aob <= 0 or aorsq < 0.9) else 1
    v['re_ppar'] = bapp / aopp
    v.update({
        're_ao_ed': aoTn, 're_ao_esp': aoPn, 're_ba_esp': baPn,
        're_intaopr': np.sum(aoPr) / fs, 're_maxaopr': np.max(aoPr),
        're_tmaxaopr': (int(np.argmax(aoPr)) + 1) / fs,
        're_intaoprlessdbp': np.sum(aoPr - dbp) / fs,
        're_intaoxsp': np.sum(aoPxs) / fs, 're_maxaoxsp': np.max(aoPxs),
        're_tmaxaoxsp': (int(np.argmax(aoPxs)) + 1) / fs,
        're_aopinf': aoPinf, 're_aofita': aoa, 're_aofitb': aob, 're_aorsq': aorsq,
        're_intbapr': np.sum(baPr) / fs, 're_maxbapr': np.max(baPr),
        're_tmaxbapr': (int(np.argmax(baPr)) + 1) / fs,
        're_intbaxsp': np.sum(baPxs) / fs, 're_maxbaxsp': np.max(baPxs),
        're_tmaxbap': (int(np.argmax(baPxs)) + 1) / fs,
        're_bafita': baa, 're_bafitb': bab, 're_barsq': barsq, 're_bapinf': baPinf,
        're_ai75': ai + 0.481 * hr - 36.1,
        're_aodd': 60 / hr - aoPn / 1000,
        're_ao_ew': math.pi / 2 * (aoTn - Tr) * (m['cSys'] - Pi) * MMHG_PA,
    })
    return v


def plain(value):
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    return value


def main():
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in sys.argv[2:]:
        m = read(path)
        if m is None:
            print(f'skip {path}: not a BPplus result')
            continue
        try:
            values = analyse(m)
        except Exception as error:   # noqa: BLE001 — report and continue
            print(f'FAIL {path}: {error!r}')
            continue
        name = Path(path).stem
        doc = {
            'source': 'scipy reference (test/reservoir/reference.py)',
            'tolerance': 1e-6,
            'values': {k: plain(val) for k, val in values.items()},
        }
        (out_dir / f'{name}.json').write_text(json.dumps(doc, indent=2) + '\n', encoding='utf-8')
        print(f'wrote {name}.json')


if __name__ == '__main__':
    main()
