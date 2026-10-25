"""Line Watcher report: lead, evidence, cause line, KPI table, updates, data analysis, triangulation.

All numbers come from code. Each KPI in the text is a "fact" with an id ({{f1}}). Every fact is
computed twice, by two different code paths (prefix sums and a plain loop). The number check
passes only if both paths agree and the final text shows exactly the facts' values.
"""
import re

from . import kpis
from .db import ws
from .fmt import hhmm, jround, num, pct
from .rca import HYP, PLAYBOOK


def slow_kv(st, key, l, t):
    """Brute-force recompute of a KPI (second code path for the number check)."""
    L, ideal = st.L[l], st.ideal[l]
    if key == 'stop':
        return sum(1 for i in range(t - 59, t + 1) if L.st[i] == 1)
    if key == 'oee':
        pl = sum(1 for i in range(t - 59, t + 1) if L.st[i] == 2)
        good = sum(L.prod[i] - L.rej[i] for i in range(t - 59, t + 1))
        return good / (ideal * (60 - pl)) if 60 - pl >= 40 else None
    if key == 'speed':
        run = sum(1 for i in range(t - 14, t + 1) if L.st[i] == 0)
        prd = sum(L.prod[i] for i in range(t - 14, t + 1))
        return None if run < 12 else prd / (ideal * run)
    if key == 'rej':
        r = sum(L.rej[i] for i in range(t - 29, t + 1))
        p = sum(L.prod[i] for i in range(t - 29, t + 1))
        return None if p < ideal * 20 else r / p
    if key == 'cover':
        run = sum(1 for i in range(t - 29, t + 1) if L.st[i] == 0)
        p = sum(L.prod[i] for i in range(t - 29, t + 1))
        return L.stock[t] / (max(20, p / run) if run >= 5 else ideal * 0.85)
    return None


def lim_text(S, key):
    lim = S[kpis.SPEC[key][4]]
    from .fmt import jstr
    return jstr(lim) + (' min' if key in ('cover', 'stop') else '%')


def report_for(eng, inc, cap):
    st, S = eng.st, eng.S
    first = inc['alerts'][0]
    l, ta, key = inc['line'], first['ta'], first['key']
    r = eng.rca_incident(inc)
    facts = []

    def fact(k, t):
        v, w = eng.kv(k, l, t), slow_kv(st, k, l, t)
        fid = 'f%d' % (len(facts) + 1)
        facts.append({'id': fid, 'key': k, 't': t, 'line': l, 'value': v, 'shown': kpis.fmt(k, v), 'check': w,
                      'ok': v is not None and w is not None and abs(v - w) < 1e-9,
                      'label': st.names[l] + ' · ' + kpis.SPEC[k][1] + ' · ' + hhmm(t)})
        return '{{' + fid + '}}'
    LN, lim = st.names[l], lim_text(S, key)
    leads = {
        'cover': lambda: LN + ' has preforms for ' + fact('cover', ta) + ' at the current pace. The warning level is ' + lim + '.',
        'stop': lambda: LN + ' lost ' + fact('stop', ta) + ' to stops in the last hour. The warning level is ' + lim + '.',
        'oee': lambda: LN + ' overall score is ' + fact('oee', ta) + ' for the last hour. The warning level is ' + lim + '.',
        'speed': lambda: LN + ' runs at ' + fact('speed', ta) + ' of ideal speed over the last 15 min. The warning level is ' + lim + '.',
        'rej': lambda: LN + ' rejected ' + fact('rej', ta) + ' of bottles in the last 30 min. The warning level is ' + lim + '.',
    }
    lead = leads[key]()
    ev = [c['detail'] for c in r['top']['checks'] if c['ok']][:4 if S['reportLen'] else 2] if r['top'] else []
    n = len(r['tested'])
    cause_line = ('Most likely cause: ' + HYP[r['cause']] + ' (' + str(r['top']['passed']) + ' of ' + str(r['top']['total']) + ' checks passed).') if r['cause'] else \
        ('The cause is not clear from the data. I tested ' + str(n) + ' idea' + ('s' if n > 1 else '') + '. None passed enough checks.')
    table = []
    for k in kpis.KPIS:
        v, nm = eng.kv(k[0], l, ta), eng.normal_at(k[0], l, ta)
        table.append({'key': k[0], 'name': k[1], 'shown': kpis.fmt(k[0], v), 'limit': lim_text(S, k[0]), 'breach': kpis.is_breach(S, k[0], v),
                      'normal': kpis.fmt(k[0], nm['mean']) if nm else None, 'dir': k[3]})
    updates = []
    for a in inc['alerts'][1:]:
        if a['ta'] <= cap and a['key'] != key:
            updates.append({'t': a['ta'], 'text': kpis.PLAIN[a['key']] + ': ' + fact(a['key'], a['ta']) + ' (warning level ' + lim_text(S, a['key']) + ').'})
    if key == 'cover':
        z = -1
        for t in range(ta + 1, min(cap, ta + 240) + 1):
            if st.L[l].stock[t] <= 0:
                z = t
                break
        if z > 0:
            updates.append({'t': z, 'text': LN + ' ran out of preforms. The line is stopped.'})
    if inc['end'] <= cap - 5:
        updates.append({'t': inc['end'], 'text': 'The last warning level cleared.'})
    updates.sort(key=lambda u: u['t'])
    lens = eng.lenses(l, r['on'], ta, ta)
    return {'id': inc['id'], 'line': l, 'key': key, 'title': LN + ' · ' + kpis.PLAIN[key], 'ta': ta, 'on': r['on'], 'lead': lead, 'evidence': ev,
            'causeLine': cause_line, 'cause': r['cause'], 'causeName': HYP[r['cause']] if r['cause'] else None, 'rca': r, 'lens': lens,
            'kpis': table, 'updates': updates, 'playbook': PLAYBOOK[r['cause'] or 'none'], 'facts': facts, 'full': bool(S['reportLen'])}


def fill_text(txt, facts):
    by = {f['id']: f['shown'] for f in facts}
    return re.sub(r'\{\{(f\d+)\}\}', lambda m: by.get(m.group(1), m.group(0)), txt)


# ---------------- data analysis (RCA sheet) ----------------
ROLES = {
    'late_supply': ['cross', 'time', 'history', 'cross'], 'startup_after_cip': ['time', 'cross', 'history', 'cross'],
    'after_changeover': ['time', 'cross', 'history', 'cross'], 'capper_drift': ['cross', 'time', 'cross', 'cross'],
    'shift_handover': ['time', 'cross', 'history', 'cross'], 'setpoint_lowered': ['time', 'cross', 'cross', 'cross'],
    'plant_wide': ['cross', 'cross', 'cross', 'history'], 'normal_noise': ['history', 'history'],
}


def win_stats(st, l, a, b):
    """Plain loop over minute rows (a second path, separate from the prefix sums)."""
    L, ideal_rate = st.L[l], st.ideal[l]
    prod = rej = prod_run = run = flt = pln = slow = 0
    by_f, by_p, by_d = {}, {}, [0] * len(st.defect_names)
    for i in range(a, b + 1):
        prod += L.prod[i]
        rej += L.rej[i]
        s = L.st[i]
        if s == 0:
            run += 1
            prod_run += L.prod[i]
            if L.sp[i] < 0.75:
                slow += 1
        elif s == 1:
            flt += 1
            nm = st.fault_names[L.rid[i] - 1] if 1 <= L.rid[i] <= len(st.fault_names) else 'Other'
            by_f[nm] = by_f.get(nm, 0) + 1
        else:
            pln += 1
            nm = st.planned_names[L.rid[i] - 11] if 11 <= L.rid[i] < 11 + len(st.planned_names) else 'Planned stop'
            by_p[nm] = by_p.get(nm, 0) + 1
        for j in range(len(by_d)):
            by_d[j] += L.dc[j][i]
    n = b - a + 1
    ideal = ideal_rate * (n - pln)
    return {'n': n, 'prod': prod, 'rej': rej, 'run': run, 'flt': flt, 'pln': pln, 'slow': slow, 'ideal': ideal, 'prodRun': prod_run,
            'byF': by_f, 'byP': by_p, 'byD': by_d, 'out': prod / ideal if ideal > 0 else None,
            'rejPct': rej / prod if prod > 0 else None, 'speed': prod_run / (ideal_rate * run) if run > 0 else None}


def win_normal(eng, l, a, b):
    st, S = eng.st, eng.S
    days = []
    for k in range(1, jround(S['baseDays']) + 1):
        x, y = a - k * 1440, b - k * 1440
        if x < 0:
            break
        days.append(win_stats(st, l, x, y))
    if not days:
        return None

    def mean(f):
        v = [f(d) for d in days]
        v = [x for x in v if x is not None]
        return sum(v) / len(v) if v else None
    by_f = {nm: sum(d['byF'].get(nm, 0) for d in days) / len(days) for nm in st.fault_names}
    by_d = [sum(d['byD'][j] for d in days) / len(days) for j in range(len(st.defect_names))]
    return {'n': len(days), 'prod': mean(lambda d: d['prod']), 'out': mean(lambda d: d['out']), 'flt': mean(lambda d: d['flt']),
            'rejPct': mean(lambda d: d['rejPct']), 'speed': mean(lambda d: d['speed']), 'slow': mean(lambda d: d['slow']),
            'pln': mean(lambda d: d['pln']), 'byF': by_f, 'byD': by_d}


def ev_faults(st, l, a, b):
    r = {}
    for e in st.evL[l]:
        if e['planned']:
            continue
        x, y = max(e['start'], a), min(e['end'] - 1, b)
        if y >= x:
            r[e['reason']] = r.get(e['reason'], 0) + y - x + 1
    return r


def _mn(v):
    if v is None:
        return '–'
    from .fmt import jstr
    return jstr(jround(v * 10) / 10) + ' min'


def analysis_for(eng, rep):
    st, S = eng.st, eng.S
    l, o, ta, key = rep['line'], 1 - rep['line'], rep['ta'], rep['key']
    span = 60 if key == 'cover' else 30
    b, a = ta, max(0, min(rep['on'], ta - span + 1))
    w, wo = win_stats(st, l, a, b), win_stats(st, o, a, b)
    nm, nmo = win_normal(eng, l, a, b), win_normal(eng, o, a, b)
    checks = []

    def chk(label, x, y):
        checks.append({'label': label, 'a': x, 'b': y, 'ok': x == y})
    P = st.L[l].P
    chk('Bottles made', w['prod'], int(ws(P['prd'], a, b)))
    chk('Rejects', w['rej'], int(ws(P['rj'], a, b)))
    ef = ev_faults(st, l, a, b)
    chk('Minutes lost to faults', w['flt'], sum(ef.values()))
    for k in w['byF']:
        chk('Minutes: ' + k, w['byF'][k], ef.get(k, 0))
    chk('Reject types add up', sum(w['byD']), w['rej'])

    def pc(v):
        return '–' if v is None else pct(v, 0)

    def pc1(v):
        return '–' if v is None else pct(v, 1)

    def low(v, n):
        return n is not None and v is not None and v < n * 0.85

    def hi(v, n, d):
        return n is not None and v is not None and v > n + d

    def rej_bad(x, n):
        if not n:
            return None  # same as the preview: no earlier days -> no verdict
        return bool(n and n['rejPct'] is not None and x['rejPct'] is not None and x['rejPct'] > n['rejPct'] * 1.5 and x['rejPct'] - n['rejPct'] > 0.005)
    g = lambda d, k: d[k] if d else None  # noqa: E731
    rows = [
        {'label': 'Bottles made', 'now': num(w['prod']), 'normal': num(nm['prod']) if nm else '–', 'bad': low(w['prod'], g(nm, 'prod'))},
        {'label': 'Output against ideal', 'now': pc(w['out']), 'normal': pc(nm['out']) if nm else '–', 'bad': low(w['out'], g(nm, 'out'))},
        {'label': 'Running speed', 'now': pc(w['speed']), 'normal': pc(nm['speed']) if nm else '–', 'bad': low(w['speed'], g(nm, 'speed'))},
        {'label': 'Minutes lost to faults', 'now': str(w['flt']) + ' min', 'normal': _mn(nm['flt']) if nm else '–', 'bad': hi(w['flt'], g(nm, 'flt'), 3)},
        {'label': 'Slow minutes', 'now': str(w['slow']) + ' min', 'normal': _mn(nm['slow']) if nm else '–', 'bad': hi(w['slow'], g(nm, 'slow'), 3)},
        {'label': 'Rejects', 'now': pc1(w['rejPct']), 'normal': pc1(nm['rejPct']) if nm else '–', 'bad': rej_bad(w, nm)},
        {'label': 'Planned stops', 'now': str(w['pln']) + ' min', 'normal': _mn(nm['pln']) if nm else '–', 'bad': False},
    ]
    reasons = [{'name': k, 'now': w['byF'].get(k, 0), 'normal': nm['byF'][k] if nm else None} for k in st.fault_names]
    reasons = [x for x in reasons if x['now'] > 0 or (x['normal'] or 0) >= 1]
    reasons.sort(key=lambda x: -x['now'])
    reasons = reasons[:6]
    for x in reasons:
        x['bad'] = x['now'] > (x['normal'] or 0) + 3
    planned = [k + ' ' + str(v) + ' min' for k, v in w['byP'].items()]
    defects = [{'name': k, 'now': w['byD'][j], 'normal': nm['byD'][j] if nm else None} for j, k in enumerate(st.defect_names)]
    defects = [x for x in defects if x['now'] > 0 or (x['normal'] or 0) >= 1]
    defects.sort(key=lambda x: -x['now'])
    for x in defects:
        x['bad'] = x['normal'] is not None and x['now'] > x['normal'] * 1.8 and x['now'] - x['normal'] >= 5
    other = [
        {'label': 'Output against ideal', 'now': pc(wo['out']), 'normal': pc(nmo['out']) if nmo else '–', 'bad': low(wo['out'], g(nmo, 'out'))},
        {'label': 'Minutes lost to faults', 'now': str(wo['flt']) + ' min', 'normal': _mn(nmo['flt']) if nmo else '–', 'bad': hi(wo['flt'], g(nmo, 'flt'), 3)},
        {'label': 'Rejects', 'now': pc1(wo['rejPct']), 'normal': pc1(nmo['rejPct']) if nmo else '–', 'bad': rej_bad(wo, nmo)},
    ]
    LN, LO = st.names[l], st.names[o]
    read = [LN + ' made ' + num(w['prod']) + ' bottles from ' + hhmm(a) + ' to ' + hhmm(b) + ' (' + str(w['n']) + ' min). Ideal output for that time is ' + num(w['ideal']) +
            '. That is ' + pc(w['out']) + ' of ideal' + (('. At the same time on ' + str(nm['n']) + ' earlier day' + ('s' if nm['n'] > 1 else '') + ' it was ' + pc(nm['out']) + '.') if nm and nm['out'] is not None else '.')]
    if reasons and reasons[0]['now'] > 0:
        t = reasons[0]
        read.append('Faults cost ' + str(w['flt']) + ' min. The biggest part is "' + t['name'] + '": ' + str(t['now']) + ' min (' + str(jround(t['now'] / w['flt'] * 100)) + '% of the lost time).')
    else:
        read.append('No fault stops in this window.')
    if w['rej'] > 0:
        t = defects[0] if defects else None
        read.append('Rejects were ' + pc1(w['rejPct']) + ' (' + num(w['rej']) + ' bottles)' + (('. The most common type is "' + t['name'] + '" with ' + str(t['now']) + '.') if t else '.'))
    read.append(LO + ' ran at ' + pc(wo['out']) + ' of ideal in the same window' + ('. It was not hit.' if wo['out'] is not None and wo['out'] >= 0.8 else '. It was hit too.'))
    supply = supply_text = None
    if key == 'cover':
        L = st.L[l]
        st0, st1 = L.stock[a], L.stock[b]
        use = (st0 - st1) / w['n']
        nstock = []
        for k in range(1, jround(S['baseDays']) + 1):
            if b - k * 1440 < 0:
                break
            nstock.append(L.stock[b - k * 1440])
        dues = sorted([x for x in st.sched if x['line'] == l and x['due'] <= ta], key=lambda x: -x['due'])
        due = dues[0] if dues else None
        arrived = bool(due) and due['arr'] <= ta
        cov = eng.kv('cover', l, b)
        nmean = sum(nstock) / len(nstock) if nstock else None
        supply = [
            {'label': 'Preforms in stock', 'now': num(st1), 'normal': num(nmean) if nstock else '–', 'bad': bool(nstock) and st1 < nmean * 0.5},
            {'label': 'Stock ' + str(w['n']) + ' min earlier', 'now': num(st0), 'normal': '–', 'bad': False},
            {'label': 'Use per minute', 'now': num(use), 'normal': '–', 'bad': False},
            {'label': 'Minutes of cover', 'now': kpis.fmt('cover', cov), 'normal': '–', 'bad': cov < S['coverLim']},
            {'label': 'Last delivery due', 'now': due['po'] + ' at ' + hhmm(due['due']), 'normal': '–', 'bad': False} if due else {'label': 'Last delivery due', 'now': 'none yet', 'normal': '–', 'bad': False},
            ({'label': 'Delivery status', 'now': ('Came ' + hhmm(due['arr']) + ' (' + str(due['arr'] - due['due']) + ' min late)') if arrived else ('Not here yet (' + str(ta - due['due']) + ' min late)'),
              'normal': '–', 'bad': (not arrived) or due['arr'] - due['due'] > 30} if due else {'label': 'Delivery status', 'now': '–', 'normal': '–', 'bad': False}),
        ]
        supply_text = (LN + ' preform stock fell from ' + num(st0) + ' to ' + num(st1) + ' in ' + str(w['n']) + ' min (' + num(use) + ' a minute). That is ' + kpis.fmt('cover', cov) + ' of cover.' +
                       ((' Delivery ' + due['po'] + ' was due ' + hhmm(due['due']) + (' and came ' + hhmm(due['arr']) + '.' if arrived else ' and had not arrived by ' + hhmm(ta) + ' (' + str(ta - due['due']) + ' min late).')) if due else ''))
    if supply_text:
        read.insert(1, supply_text)
    return {'a': a, 'b': b, 'n': w['n'], 'rows': rows, 'supply': supply, 'reasons': reasons, 'planned': planned, 'defects': defects, 'other': other,
            'read': read, 'hasNormal': bool(nm), 'normalDays': nm['n'] if nm else 0,
            'checks': {'ok': len([c for c in checks if c['ok']]), 'total': len(checks), 'bad': [c for c in checks if not c['ok']]}}


def triangulate(eng, rep):
    r = rep['rca']
    top, run = r['tested'][0], (r['tested'][1] if len(r['tested']) > 1 else None)
    roles = ROLES.get(top['key'], [])
    ANG = [('time', 'Before and after', 'What happened just before and just after it began?'),
           ('cross', 'Same time, other signals', 'What do other signals and the other line show at the same time?'),
           ('history', 'Similar past situations', 'Did the same thing happen before?')]
    angles = []
    for k, name, ask in ANG:
        checks = [c for i, c in enumerate(top['checks']) if i < len(roles) and roles[i] == k]
        passed, total = len([c for c in checks if c['ok']]), len(checks)
        share = passed / total if total else None
        angles.append({'key': k, 'name': name, 'ask': ask, 'checks': checks, 'passed': passed, 'total': total,
                       'verdict': 'none' if not total else ('supports' if share >= 0.75 else 'partly' if share >= 0.5 else 'against')})
    L = rep['lens']
    bf = [x for x in L['before'] if x['phase'] == 'before'][-3:]
    du = [x for x in L['before'] if x['phase'] == 'during'][:3]
    af = [x for x in L['before'] if x['phase'] == 'after'][:3]
    angles[0]['context'] = [{'phase': x['phase'], 'text': x['text']} for x in bf + du + af]
    angles[1]['context'] = [{'text': x['label'] + ': ' + x['value']} for x in L['same'][:8]]
    angles[2]['context'] = [{'text': t} for t in eng.past_text(L['past'])[:4]]
    voted = [a for a in angles if a['total'] > 0]
    sup = len([a for a in voted if a['verdict'] == 'supports'])
    proven = bool(rep['cause'])
    level = 'strong' if proven and len(voted) >= 2 and sup == len(voted) else ('medium' if proven else 'weak')
    if proven:
        head = (('Both angles agree: ' if len(voted) == 2 else 'All 3 angles agree: ') + top['name'] + '.') if sup == len(voted) and len(voted) >= 2 else \
            (str(sup) + ' of ' + str(len(voted)) + ' angles support ' + top['name'] + '.')
        summary = head + ' ' + str(top['passed']) + ' of ' + str(top['total']) + ' checks pass, so I name it.'
    else:
        summary = 'No cause is proven. The best idea is "' + top['name'] + '": ' + str(top['passed']) + ' of ' + str(top['total']) + ' checks pass, and ' + str(sup) + ' of ' + str(len(voted)) + ' angles support it. That is not enough.'
    return {'idea': top['name'], 'key': top['key'], 'proven': proven, 'level': level, 'summary': summary, 'angles': angles,
            'runner': {'name': run['name'], 'passed': run['passed'], 'total': run['total']} if run else None, 'thr': r['thr'], 'sup': sup, 'voted': len(voted)}
