"""Cause tests (RCA), the three look-around lenses and similar past situations.

Port of the approved preview's engine. Every number comes from code. The tests compare this
module's output with the preview, word for word. All functions read data up to `ta` / `cap` only.
Lines are indexes here: 0 = Line 1, 1 = Line 2.
"""
import math
import re

from . import kpis
from .db import ws
from .fmt import fixed, hhmm, dlabel, jround, num, pct

HYP = {
    'late_supply': 'Late preform delivery', 'startup_after_cip': 'Start-up after a clean', 'after_changeover': 'Changeover to a new product',
    'capper_drift': 'Capper torque drifting', 'shift_handover': 'Shift handover', 'setpoint_lowered': 'Line speed set lower',
    'plant_wide': 'Both lines stopped together', 'normal_noise': 'Normal ups and downs',
}
ORDER = {
    'cover': ['late_supply', 'plant_wide', 'startup_after_cip', 'setpoint_lowered', 'shift_handover', 'after_changeover', 'capper_drift', 'normal_noise'],
    'stop': ['startup_after_cip', 'late_supply', 'plant_wide', 'shift_handover', 'capper_drift', 'after_changeover', 'setpoint_lowered', 'normal_noise'],
    'speed': ['setpoint_lowered', 'shift_handover', 'plant_wide', 'startup_after_cip', 'late_supply', 'capper_drift', 'after_changeover', 'normal_noise'],
    'rej': ['after_changeover', 'capper_drift', 'startup_after_cip', 'setpoint_lowered', 'shift_handover', 'plant_wide', 'late_supply', 'normal_noise'],
    'oee': ['late_supply', 'startup_after_cip', 'plant_wide', 'setpoint_lowered', 'shift_handover', 'after_changeover', 'capper_drift', 'normal_noise'],
}
PLAYBOOK = {
    'late_supply': 'Ask the supplier when the truck arrives. Plan the stop. Check if the other line can lend preforms.',
    'startup_after_cip': 'After a clean, check the filler valves and bottle guides for water or residue. Start slower after each clean.',
    'after_changeover': 'Check label position, fill level and neck guides against the recipe of the new product.',
    'capper_drift': 'Check capper torque and retorque the heads. Hold the last bottles and test their cap torque.',
    'shift_handover': 'Ask the new crew to check line settings and guides at each handover.',
    'setpoint_lowered': 'Ask the operator why the speed is lower. Read the note. Set the speed back when the cause is fixed.',
    'plant_wide': 'Check site power and air. Tell maintenance that both lines stopped together.',
    'none': 'No cause is proven. Ask the operator. Watch the next 60 minutes.',
}
SHIFTS = ['A', 'B', 'C']


def C(ok, text, detail, **kw):
    d = {'ok': bool(ok), 'text': text, 'detail': detail}
    d.update(kw)
    return d


class Engine:
    def __init__(self, store, S, scan_result=None):
        from .alerts import scan
        self.st, self.S, self.N = store, S, store.N
        self.scan = scan_result or scan(store, S)
        self._fc = {}

    # ---------- helpers ----------
    def kv(self, key, l, t):
        return kpis.value(self.st.L[l], self.N, key, t)

    def fk(self, key, v):
        return kpis.fmt(key, v)

    def name(self, l):
        return self.st.names[l]

    def normal_at(self, key, l, t):
        v = []
        for k in range(1, jround(self.S['baseDays']) + 1):
            x = t - k * 1440
            if x < 60:
                break
            y = self.kv(key, l, x)
            if y is not None:
                v.append(y)
        if not v:
            return None
        mean = sum(v) / len(v)
        sd = math.sqrt(sum((y - mean) ** 2 for y in v) / len(v))
        return {'mean': mean, 'sd': sd, 'n': len(v), 'v': v}

    def onset(self, l, key, t0):
        L = self.st.L[l]
        span = {'oee': 59, 'stop': 59, 'speed': 14, 'rej': 29, 'cover': 0}[key]
        a = max(0, t0 - span)
        if key == 'cover':
            return t0
        if key == 'rej':
            for m in range(a, t0 + 1):
                r = p = 0
                for j in range(max(a, m - 4), m + 1):
                    r += L.rej[j]
                    p += L.prod[j]
                if p > 0 and r / p > 0.025:
                    for j in range(max(a, m - 4), m + 1):
                        if L.prod[j] > 0:
                            return j
                    return m
            return t0
        if key == 'speed':
            for m in range(a, t0 + 1):
                if L.st[m] == 0 and L.sp[m] < 0.7:
                    return m
            return t0

        def slow5(j):
            if j < 4:
                return False
            s = 0
            for i in range(j - 4, j + 1):
                if L.st[i] != 0:
                    return False
                s += L.sp[i]
            return s / 5 < 0.75

        def bad(j):
            return L.st[j] == 1 or slow5(j)
        m = t0
        while m >= a and not bad(m):
            m -= 1
        if m < a:
            return t0
        start, gap = m, 0
        for j in range(m, a - 1, -1):
            if bad(j):
                start, gap = j, 0
            elif L.st[j] != 2:
                gap += 1
                if gap > 20:
                    break
        return start

    # ---------- cause tests ----------
    def rca_core(self, l, key, t0, ta, S=None):
        S = S or self.S
        st, o = self.st, 1 - l
        L, P, Po = st.L[l], st.L[l].P, st.L[o].P
        ev, evo = st.evL[l], st.evL[o]
        on = min(self.onset(l, key, t0), ta)
        LN, LO = self.name(l), self.name(o)

        def done(e):
            return e['end'] - 1 <= ta

        def clip(lst, a, b):
            r = {}
            for e in lst:
                if e['planned']:
                    continue
                x, y = max(e['start'], a), min(e['end'] - 1, b, ta)
                if y >= x:
                    r[e['reason']] = r.get(e['reason'], 0) + y - x + 1
            return r

        def tot(r):
            return sum(r.values())

        def lost(lst, a, b):
            return tot(clip(lst, a, b))

        def rate(PP, a, b):
            a = max(0, a)
            p = ws(PP['prd'], a, b)
            return ws(PP['rj'], a, b) / p if p > 0 else None

        def mean_tor(PP, a, b):
            a0 = max(0, a)
            return (PP['tor'][b + 1] - PP['tor'][a0]) / (b - a0 + 1)

        H = {}

        def late_supply():
            mc = 1e9
            for t in range(max(60, ta - 60), ta + 1, 5):
                mc = min(mc, self.kv('cover', l, t))
            c1 = C(mc < 90, 'Preform cover is under 90 min', 'Lowest cover in the last hour: ' + self.fk('cover', mc) + '. Stock now ' + num(L.stock[ta]) + ' preforms.')
            dues = sorted([x for x in st.sched if x['line'] == l and x['due'] <= ta], key=lambda x: -x['due'])
            due = dues[0] if dues else None
            if not due:
                c2 = C(False, 'A delivery is late', 'No delivery was due yet.')
            else:
                arrived = due['arr'] <= ta
                late = (due['arr'] if arrived else ta) - due['due']
                c2 = C(late > 30, 'A delivery is late', due['po'] + ' was due ' + hhmm(due['due']) + '. ' +
                       ('It came ' + str(late) + ' min late.' if arrived else 'It had not arrived by ' + hhmm(ta) + ' (' + str(late) + ' min late).'))
            prev = [x for x in st.sched if x['line'] == l and x['due'] <= ta and (not due or x['po'] != due['po']) and x['arr'] <= ta]
            on_time = len([x for x in prev if x['arr'] - x['due'] <= 30])
            c3 = C(len(prev) >= 5 and on_time / len(prev) >= 0.8, 'Late deliveries are rare',
                   str(on_time) + ' of ' + str(len(prev)) + ' earlier deliveries came within 30 min of the due time.')
            mo = self.kv('cover', o, ta)
            return [c1, c2, c3, C(mo > 90, LO + ' has enough preforms', LO + ' has ' + self.fk('cover', mo) + ' of preforms.')]
        H['late_supply'] = late_supply

        def startup_after_cip():
            cips = [e for e in st.cipL[l] if done(e)]
            last = cips[-1] if cips else None
            gap = on - last['end'] if last else None
            c1 = C(bool(last) and -2 <= gap <= 90, 'A clean ended shortly before the trouble began',
                   ('The last clean ended ' + hhmm(last['end']) + ', ' + (str(gap) + ' min before' if gap >= 0 else 'at the start of') + ' the trouble (' + hhmm(on) + ').') if last else 'No clean has run yet.')
            br = clip(ev, on, ta)
            tt, fj = tot(br), br.get('Filler jam', 0)
            c2 = C(tt >= 5 and fj / tt >= 0.6, 'Filler jams are most of the lost time', str(fj) + ' of ' + str(tt) + ' lost minutes were filler jams.')
            c3 = C(False, 'Jams were also more frequent after earlier cleans', 'Skipped: no clean before the trouble.')
            if c1['ok']:
                prev = [e for e in cips if e is not last and e['end'] + 60 <= on - 30]
                jm = 0
                for e in prev:
                    jm += clip(ev, e['end'], e['end'] + 59).get('Filler jam', 0)
                all_j = sum(e['minutes'] for e in ev if not e['planned'] and e['reason'] == 'Filler jam' and e['end'] - 1 < on - 60)
                normal = all_j / max(1, (on - 60) / 60)
                after = jm / len(prev) if prev else 0
                c3 = C(len(prev) >= 2 and normal > 0 and after / normal >= 1.5, 'Jams were also more frequent after earlier cleans',
                       'In the hour after ' + str(len(prev)) + ' earlier cleans, filler jams averaged ' + fixed(after, 1) + ' min. In a normal hour: ' + fixed(normal, 1) + ' min.')
            fo = lost(evo, on, ta)
            return [c1, c2, c3, C(fo * 2 <= tt, LO + ' was calm', LO + ' lost ' + str(fo) + ' min in the same period. ' + LN + ' lost ' + str(tt) + ' min.')]
        H['startup_after_cip'] = startup_after_cip

        def after_changeover():
            ch = [e for e in st.chgL[l] if done(e)]
            last = ch[-1] if ch else None
            gap = on - last['end'] if last else None
            info = next((c for c in st.changeovers if c['line'] == l and c['start'] == last['start']), None) if last else None
            c1 = C(bool(last) and -2 <= gap <= 60, 'A changeover ended shortly before rejects rose',
                   ('The last changeover (' + info['from'] + ' to ' + info['to'] + ') ended ' + hhmm(last['end']) + ', ' + (str(gap) + ' min before' if gap >= 0 else 'at the start of') + ' the trouble.') if last else 'No changeover has run yet.')
            base = rate(P, 0, max(0, on - 1))
            now = rate(P, max(on, last['end']), ta) if last else None
            c2 = C(now is not None and base is not None and now >= max(0.025, 2 * base), 'Rejects are far above normal',
                   'No bottles made since then.' if now is None else 'Rejects: ' + pct(now, 1) + ' since the changeover. Normal: ' + pct(base or 0, 1) + '.')
            c3 = C(False, 'Rejects were also higher after earlier changeovers', 'Skipped: no changeover before the trouble.')
            if c1['ok']:
                prev = [e for e in ch if e is not last and e['end'] + 60 <= on - 60]
                r = p = 0
                for e in prev:
                    r += ws(P['rj'], e['end'], e['end'] + 39)
                    p += ws(P['prd'], e['end'], e['end'] + 39)
                rr = r / p if p else 0
                c3 = C(len(prev) >= 2 and bool(base) and base > 0 and rr / base >= 1.3, 'Rejects were also higher after earlier changeovers',
                       'In the 40 min after ' + str(len(prev)) + ' earlier changeovers, rejects averaged ' + pct(rr, 1) + '. Normal: ' + pct(base or 0, 1) + '.')
            ro = rate(Po, ta - 29, ta)
            return [c1, c2, c3, C(ro is not None and ro < 0.02, LO + ' rejects are normal', LO + ' rejects: ' + ('–' if ro is None else pct(ro, 1)) + ' in the last 30 min.')]
        H['after_changeover'] = after_changeover

        def capper_drift():
            norm = mean_tor(P, 0, on - 240) if on > 500 else 2.5
            now = mean_tor(P, ta - 19, ta)
            c1 = C(now < norm - 0.15, 'Cap torque is well below normal', 'Cap torque averaged ' + fixed(now, 2) + ' Nm in the last 20 min. Normal: ' + fixed(norm, 2) + ' Nm.')
            before = mean_tor(P, ta - 119, ta - 100) if ta >= 120 else now
            c2 = C(before - now >= 0.12, 'Cap torque slid down over time', 'Cap torque fell by ' + fixed(before - now, 2) + ' Nm in 2 hours.')
            rj = sum(L.rej[ta - 29:ta + 1])
            cd = sum(L.dc[2][ta - 29:ta + 1])
            c3 = C(rj >= 10 and cd / rj >= 0.5, '"Cap torque out of spec" is the main reject type', str(cd) + ' of ' + str(rj) + ' rejects in the last 30 min were cap torque.')
            no = mean_tor(Po, ta - 19, ta)
            return [c1, c2, c3, C(abs(no - 2.5) <= 0.1, LO + ' cap torque is normal', LO + ' cap torque: ' + fixed(no, 2) + ' Nm.')]
        H['capper_drift'] = capper_drift

        def shift_handover():
            b = (on // 480) * 480
            since = on - b
            c1 = C(since <= 30, 'The trouble began just after a shift change', 'The trouble began ' + str(since) + ' min after the ' + hhmm(b) + ' shift change.')
            mic, long_stop = int(ws(P['mc'], on, ta)), lost(ev, on, ta)
            c2 = C(mic >= 4 and long_stop <= 3, 'Many short slowdowns, no long stops', str(mic) + ' slow minutes. ' + str(long_stop) + ' min of long stops.')
            c3 = C(False, 'Earlier shift changes were also slower', 'Skipped: the trouble did not start at a shift change.')
            if c1['ok']:
                hist = []
                k = 1
                while b - k * 1440 >= 0:
                    hist.append(ws(P['mc'], b - k * 1440, b - k * 1440 + 59))
                    k += 1
                allr = ws(P['mc'], 0, max(0, b - 1)) / max(1, b / 60)
                avg = sum(hist) / len(hist) if hist else 0
                c3 = C(len(hist) >= 3 and allr > 0 and avg / allr >= 1.5, 'Earlier shift changes were also slower',
                       'In the hour after ' + str(len(hist)) + ' earlier ' + hhmm(b) + ' shift changes: ' + fixed(avg, 1) + ' slow min. In a normal hour: ' + fixed(allr, 1) + '.')
            run = ws(Po['run'], on, ta)
            so = ws(Po['prd'], on, ta) / (st.ideal[o] * run) if run >= 5 else None
            return [c1, c2, c3, C(so is not None and so >= 0.85, LO + ' kept its speed', LO + ' speed: ' + ('–' if so is None else pct(so)) + ' in the same period.')]
        H['shift_handover'] = shift_handover

        def setpoint_lowered():
            cand = sorted([x for x in st.setpoints if x['line'] == l and ta - 240 <= x['ts'] <= ta and x['to'] <= x['from'] - 10], key=lambda x: -x['ts'])
            ch = cand[0] if cand else None
            c1 = C(bool(ch), 'Someone set the line speed lower',
                   ('Set speed went from ' + str(ch['from']) + '% to ' + str(ch['to']) + '% at ' + hhmm(ch['ts']) + '.') if ch else 'No speed-setting change in the last 4 hours.')
            if not ch:
                return [c1] + [C(False, t, 'Skipped: no setting change found.') for t in ['The line ran at its new setting', 'No long stops explain the loss', 'An operator note explains the change']]
            run = ws(P['run'], ch['ts'], ta)
            ratio = ws(P['prd'], ch['ts'], ta) / (st.ideal[l] * run) if run else 0
            lf = lost(ev, ch['ts'], ta)
            return [c1, C(ratio >= 0.85 * ch['to'] / 100, 'The line ran at its new setting', 'The line ran at ' + pct(ratio) + ' of ideal against a ' + str(ch['to']) + '% setting.'),
                    C(lf <= 5, 'No long stops explain the loss', 'Long stops since then: ' + str(lf) + ' min.'),
                    C(bool(ch['note']), 'An operator note explains the change', ('Operator note: "' + ch['note'] + '".') if ch['note'] else 'No note.')]
        H['setpoint_lowered'] = setpoint_lowered

        def plant_wide():
            mine = next((e for e in ev if not e['planned'] and e['minutes'] >= 3 and e['start'] <= ta and on - 5 <= e['start'] <= on + 10), None)

            def near(e, f):
                return not f['planned'] and f['minutes'] >= 3 and abs(f['start'] - e['start']) <= 3
            other = next((f for f in evo if f['start'] <= ta and near(mine, f)), None) if mine else None
            c1 = C(bool(other), LO + ' also stopped at the same time',
                   (LO + ' stopped at ' + hhmm(other['start']) + '. ' + LN + ' stopped at ' + hhmm(mine['start']) + '.') if other else 'No stop on ' + LO + ' within 3 min.')
            if not other:
                return [c1] + [C(False, t, 'Skipped: only one line stopped.') for t in ['Same stop reason on both lines', 'A note names a site problem', 'Both lines stopped together before']]
            n1, n2 = mine['comment'] or '', other['comment'] or ''
            hit = next((x for x in [(l, n1), (o, n2)] if re.search(r'power|air|water|grid|utilit', x[1], re.I)), None)
            earlier = [e for e in ev if not e['planned'] and e['minutes'] >= 3 and e['end'] - 1 < on - 60 and any(near(e, f) and f['end'] - 1 < on - 60 for f in evo)]
            return [c1, C(mine['reason'] == other['reason'], 'Same stop reason on both lines', 'Both lines: "' + mine['reason'] + '".'),
                    C(bool(hit), 'A note names a site problem',
                      ('Note on ' + self.name(hit[0]) + ': "' + hit[1] + '".') if hit else 'Notes: ' + LN + ' "' + (n1 or '–') + '", ' + LO + ' "' + (n2 or '–') + '".'),
                    C(len(earlier) >= 1, 'Both lines stopped together before',
                      (str(len(earlier)) + ' earlier time(s): ' + '; '.join(dlabel(e['start']) + ' ' + hhmm(e['start']) + ', ' + str(e['minutes']) + ' min' for e in earlier) + '.') if earlier else 'Never before.')]
        H['plant_wide'] = plant_wide

        def normal_noise():
            v, nm = self.kv(key, l, ta), self.normal_at(key, l, ta)
            spec = kpis.SPEC[key]
            if not nm or nm['n'] < 3:
                return [C(False, 'The value is in its usual range', 'Not enough earlier days to tell.'), C(False, 'It was this bad before', 'Not enough earlier days to tell.')]
            z = abs(v - nm['mean']) / nm['sd'] if nm['sd'] > 0 else (0 if v == nm['mean'] else 9)
            worse = len([x for x in nm['v'] if (x <= v if spec[3] == 'below' else x >= v)])
            return [C(z < 2, 'The value is in its usual range', spec[1] + ' is ' + self.fk(key, v) + '. Same time on ' + str(nm['n']) + ' earlier days: ' + self.fk(key, nm['mean']) + ' on average.'),
                    C(worse >= 2, 'It was this bad before', str(worse) + ' of ' + str(nm['n']) + ' earlier days were as bad at this time.')]
        H['normal_noise'] = normal_noise

        ordr = ORDER.get(key, ORDER['oee'])
        n = max(1, min(8, jround(S['nCauses'])))
        tested = []
        for i, k in enumerate(ordr[:n]):
            checks = H[k]()
            if k != 'normal_noise' and not checks[0]['ok']:
                for c in checks[1:]:
                    c['ok'] = False
                    c['skipped'] = True
            passed = len([c for c in checks if c['ok']])
            tested.append({'key': k, 'name': HYP[k], 'checks': checks, 'passed': passed, 'total': len(checks), 'share': passed / len(checks), 'rank0': i})
        tested.sort(key=lambda x: (-x['share'], -x['passed'], x['rank0']))
        thr = S['sure'] / 100
        top = tested[0] if tested else None
        sec = tested[1] if len(tested) > 1 else None
        cause = top['key'] if (top and top['key'] != 'normal_noise' and top['share'] >= thr and (not sec or top['share'] - sec['share'] >= 0.25)) else None
        return {'key': key, 't0': t0, 'on': on, 'ta': ta, 'line': l, 'tested': tested, 'cause': cause, 'top': top, 'thr': thr,
                'notTested': [HYP[k] for k in ordr[n:]]}

    def rca_incident(self, inc):
        a = inc['alerts'][0]
        S = dict(self.S, sure=75)
        return self.rca_core(inc['line'], a['key'], a['t0'], a['ta'], S)

    # ---------- similar past ----------
    def feat(self, l, t):
        idk = (l, t)
        if idk in self._fc:
            return self._fc[idk]

        def v(k, d):
            x = self.kv(k, l, t)
            return d if x is None else x

        def last_end(lst):
            e = -1
            for x in lst:
                if x['end'] - 1 <= t:
                    e = x['end']
                else:
                    break
            return e
        cip, chg = last_end(self.st.cipL[l]), last_end(self.st.chgL[l])
        f = [v('oee', 0.85) / 0.2, v('stop', 0) / 12, v('speed', 0.93) / 0.12, v('rej', 0.009) / 0.015, min(360, v('cover', 360)) / 100,
             min(240, 240 if cip < 0 else t - cip) / 60, min(240, 240 if chg < 0 else t - chg) / 60, min(120, t % 480) / 60]
        self._fc[idk] = f
        return f

    def similar_past(self, l, t, cap):
        f0 = self.feat(l, t)
        cut = 0.3 + 0.45 * self.S['simCut'] / 100
        k = jround(self.S['simK'])
        lim = min(cap, t - 180)
        c = []
        for o in (0, 1):
            for u in range(120, lim + 1, 30):
                f = self.feat(o, u)
                d = sum((f[i] - f0[i]) ** 2 for i in range(8))
                c.append({'line': o, 't': u, 'sim': 1 / (1 + math.sqrt(d / 8))})
        c.sort(key=lambda x: -x['sim'])  # stable, like Array.prototype.sort
        pick = []
        for x in c:
            if len(pick) >= max(k, 1):
                break
            if any(p['line'] == x['line'] and abs(p['t'] - x['t']) < 120 for p in pick):
                continue
            pick.append(x)
        inc = self.scan['incidents']
        for p in pick:
            p['kpis'] = {kk: self.kv(kk, p['line'], p['t']) for kk in kpis.KEYS}
            m = next((i for i in inc if i['line'] == p['line'] and p['t'] - 30 <= i['start'] <= p['t'] + 90 and i['start'] <= cap), None)
            p['alert'] = m['id'] if m else None
            p['weak'] = p['sim'] < cut
            P2 = self.st.L[p['line']].P
            q = ws(P2['prd'], p['t'] + 1, p['t'] + 90)
            p['next'] = {'stop': ws(P2['flt'], p['t'] + 1, p['t'] + 90), 'rej': ws(P2['rj'], p['t'] + 1, p['t'] + 90) / q if q else None}
        return {'strong': [p for p in pick if not p['weak']], 'closest': pick[0] if pick else None, 'cut': cut, 'pool': len(c)}

    def past_text(self, sp):
        if not sp or not sp['closest']:
            return ['No similar past situation is in the data yet.']

        def f(p):
            return (self.name(p['line']) + ' on ' + dlabel(p['t']) + ' ' + hhmm(p['t']) + ' (' + str(jround(p['sim'] * 100)) + '% alike): score ' + self.fk('oee', p['kpis']['oee']) +
                    ', stopped ' + self.fk('stop', p['kpis']['stop']) + '. In the next 90 min: ' + str(int(p['next']['stop'])) + ' min stopped, rejects ' +
                    ('–' if p['next']['rej'] is None else pct(p['next']['rej'], 1)) + (', alert ' + str(p['alert']) + ' followed' if p['alert'] else ', no alert followed') + '.')
        if sp['strong']:
            return [f(p) for p in sp['strong']]
        return ['No past situation is close enough (needs ' + str(jround(sp['cut'] * 100)) + '% alike). Closest: ' + f(sp['closest'])]

    # ---------- lenses ----------
    def lenses(self, l, on, ta, cap):
        st, o = self.st, 1 - l
        ar = jround(self.S['around'])
        a, b = max(0, on - ar), min(cap, ta + ar)
        items = []
        for e in st.evL[l]:
            if e['end'] - 1 < a or e['start'] > b:
                continue
            ongoing = e['end'] - 1 > cap
            end = cap + 1 if ongoing else e['end']
            items.append({'t': e['start'], 'kind': 'planned' if e['planned'] else 'stop',
                          'text': hhmm(e['start']) + '–' + ('now' if ongoing else hhmm(end)) + ' ' + (e['reason'] if e['planned'] else 'Stop: ' + e['reason']) +
                          ' (' + str(end - e['start']) + ' min' + (', still on' if ongoing else '') + ')' + (', note "' + e['comment'] + '"' if e['comment'] else '')})
        for c in st.setpoints:
            if c['line'] == l and a <= c['ts'] <= b:
                items.append({'t': c['ts'], 'kind': 'setting', 'text': hhmm(c['ts']) + ' Set speed ' + str(c['from']) + '% to ' + str(c['to']) + '% – note "' + c['note'] + '"'})
        for d in st.deliveries:
            if d['line'] == l and a <= d['arr'] <= b:
                items.append({'t': d['arr'], 'kind': 'delivery', 'text': hhmm(d['arr']) + ' ' + d['po'] + ' arrived (due ' + hhmm(d['due']) + ', ' + num(d['qty']) + ' preforms)'})
        for d in st.sched:
            if d['line'] == l and a <= d['due'] <= b and d['arr'] > cap:
                items.append({'t': d['due'], 'kind': 'delivery', 'text': hhmm(d['due']) + ' ' + d['po'] + ' due – not arrived yet'})
        m = -(-a // 480) * 480
        while m <= b:
            items.append({'t': m, 'kind': 'shift', 'text': hhmm(m) + ' Shift ' + SHIFTS[(m % 1440) // 480] + ' starts'})
            m += 480
        items.sort(key=lambda x: x['t'])
        for x in items:
            x['phase'] = 'before' if x['t'] < on else ('during' if x['t'] <= ta else 'after')
        keep = [x for x in items if abs(x['t'] - on) <= ar / 2 or x['phase'] != 'before'][-16:] if len(items) > 16 else items
        at = min(ta, cap)

        def mean_tor(PP, x, y):
            return (PP['tor'][y + 1] - PP['tor'][x]) / (y - x + 1)
        same = [{'label': self.name(o) + ' ' + k[1].lower(), 'value': self.fk(k[0], self.kv(k[0], o, at)), 'line': o, 'key': k[0]} for k in kpis.KPIS]
        same += [{'label': self.name(l) + ' cap torque', 'value': fixed(mean_tor(st.L[l].P, at - 19, at), 2) + ' Nm'},
                 {'label': self.name(l) + ' set speed', 'value': str(jround(st.L[l].setp[at] * 100)) + '%'},
                 {'label': self.name(l) + ' preform stock', 'value': num(st.L[l].stock[at]) + ' (' + self.fk('cover', self.kv('cover', l, at)) + ')'}]
        return {'before': keep, 'same': same, 'past': self.similar_past(l, ta, cap), 'window': [a, b]}
