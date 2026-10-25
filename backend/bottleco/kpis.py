"""The 5 KPIs. Code computes every number. Each value uses data up to minute t only (no future peek)."""
from .db import ws

KPIS = [
    # key, plain name, what it measures, warn direction, slider, display scale, unit
    ('oee', 'Overall score', 'Share of ideal output you got, last 60 min', 'below', 'oeeLim', 100, '%'),
    ('stop', 'Stopped time', 'Minutes stopped by faults, last 60 min', 'above', 'stopLim', 1, ' min'),
    ('speed', 'Speed', 'Running speed against ideal, last 15 min', 'below', 'speedLim', 100, '%'),
    ('rej', 'Rejects', 'Share of bottles rejected, last 30 min', 'above', 'rejLim', 100, '%'),
    ('cover', 'Preforms left', 'Minutes of preforms left at the current pace', 'below', 'coverLim', 1, ' min'),
]
KEYS = [k[0] for k in KPIS]
SPEC = {k[0]: k for k in KPIS}
PLAIN = {'oee': 'Overall score low', 'stop': 'Long stops', 'speed': 'Running slow', 'rej': 'Many rejects', 'cover': 'Preforms running low'}


def range_stats(L, N, a, b):
    """Totals and ratios over minutes a..b inclusive."""
    P = L.P
    a, b = max(0, a), min(N - 1, b)
    n = b - a + 1
    run, flt, pln = ws(P['run'], a, b), ws(P['flt'], a, b), ws(P['pln'], a, b)
    prd, rj = ws(P['prd'], a, b), ws(P['rj'], a, b)
    den = L.ideal * (n - pln)
    return {
        'minutes': n, 'run': run, 'fault': flt, 'planned': pln, 'produced': prd, 'rejected': rj, 'good': prd - rj,
        'oee': (prd - rj) / den if n - pln >= 15 else None,
        'availability': run / (n - pln) if n - pln > 0 else None,
        'performance': prd / (L.ideal * run) if run > 0 else None,
        'quality': (prd - rj) / prd if prd > 0 else None,
        'reject_rate': rj / prd if prd > 0 else None,
    }


def pace30(L, t):
    P = L.P
    a = max(0, t - 29)
    run = ws(P['run'], a, t)
    return max(20, ws(P['prd'], a, t) / run) if run >= 5 else L.ideal * 0.85


def value(L, N, key, t):
    """KPI value at minute t, or None when there is too little data to judge."""
    P = L.P
    if key == 'oee':
        if t < 59:
            return None
        r = range_stats(L, N, t - 59, t)
        return r['oee'] if 60 - r['planned'] >= 40 else None
    if key == 'stop':
        return None if t < 59 else ws(P['flt'], t - 59, t)
    if key == 'speed':
        if t < 14:
            return None
        run = ws(P['run'], t - 14, t)
        return None if run < 12 else ws(P['prd'], t - 14, t) / (L.ideal * run)
    if key == 'rej':
        if t < 29:
            return None
        p = ws(P['prd'], t - 29, t)
        return None if p < L.ideal * 20 else ws(P['rj'], t - 29, t) / p
    if key == 'cover':
        return L.stock[t] / pace30(L, t)
    raise KeyError(key)


def is_breach(S, key, v):
    if v is None:
        return False
    _, _, _, direction, lim, scale, _ = SPEC[key]
    limit = S[lim] / scale
    return v < limit if direction == 'below' else v > limit


def fmt(key, v):
    if v is None:
        return '–'
    if key == 'cover':
        if v >= 360:
            return '6 h+'
        if v >= 60:
            return '%d h %02d min' % (v // 60, round(v % 60))
        return '%d min' % round(v)
    if key == 'rej':
        return '%.1f%%' % (v * 100)
    _, _, _, _, _, scale, unit = SPEC[key]
    return '%d%s' % (round(v * scale), unit)
