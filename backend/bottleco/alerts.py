"""Alert engine. Plain rules in code, not a language model.

A KPI must breach its limit for `hold` minutes (checked every `every` minutes) before it warns.
After a warning the same KPI stays quiet for `cool` minutes. Alerts on one line that start
within 90 minutes of each other join into one incident (one RCA pill).
"""
import math
from .kpis import KEYS, value, is_breach


def _round_half_up(x):
    return math.floor(x + 0.5)  # same rounding as the preview (JavaScript Math.round)


def scan(store, S, upto=None):
    """All alerts and incidents from the start of the data up to minute `upto` (inclusive)."""
    N = store.N
    end = N if upto is None else min(N, upto + 1)
    iv = max(1, _round_half_up(S['every']))
    need = max(1, math.ceil(S['hold'] / iv))
    alerts = []
    for line_id, L in store.lines.items():
        for key in KEYS:
            t0, n, last, fired = -1, 0, -1e9, False
            cur = None
            t = 60
            while t < end:
                v = value(L, N, key, t)
                if v is not None:
                    if is_breach(S, key, v):
                        if t0 < 0:
                            t0, n = t, 0
                        n += 1
                        if not fired and n >= need and t >= last + S['cool']:
                            fired, last = True, t
                            cur = {'line_id': line_id, 'key': key, 't0': t0, 'ta': t, 't_end': t, 'value': v}
                            alerts.append(cur)
                    elif t0 >= 0:
                        if fired:
                            cur['t_end'] = t - iv
                        t0, n, fired = -1, 0, False
                t += iv
            if t0 >= 0 and fired:
                cur['t_end'] = end - 1
                cur['ongoing'] = upto is not None and end - 1 < N - 1
    lid = {k: i for i, k in enumerate(store.lines)}
    alerts.sort(key=lambda a: (a['ta'], lid[a['line_id']]))
    incidents = []
    for a in alerts:
        o = next((x for x in incidents if x['line_id'] == a['line_id'] and a['t0'] <= x['end'] + 90), None)
        if o:
            o['alerts'].append(a)
            o['end'] = max(o['end'], a['t_end'])
            o['t0'] = min(o['t0'], a['t0'])
        else:
            incidents.append({'line_id': a['line_id'], 'alerts': [a], 'start': a['ta'], 't0': a['t0'], 'end': a['t_end']})
    incidents.sort(key=lambda x: x['start'])
    for i, x in enumerate(incidents):
        x['id'] = i + 1
        x['keys'] = list(dict.fromkeys(a['key'] for a in x['alerts']))
        x['first'] = x['alerts'][0]['key']
    return {'alerts': alerts, 'incidents': incidents}
