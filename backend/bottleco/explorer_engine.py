"""Data Explorer engine: question plan -> answer with facts, data queried, raw rows, trend and 3 lenses.

Port of the approved preview's answer engine (word for word, tested). Two ways to make a plan:
- rule_plan(): the preview's rule reader (no model, used as fallback and in tests)
- the LangGraph Explorer asks Claude to fill the same plan (see explorer.py). Code then checks the plan.
The model never computes numbers. Everything below reads data only up to `now`.
"""
import re

from . import kpis
from .aggregate import Aggregator, rule_agg, wants_aggregate
from .db import ts as iso_ts, ws
from .fmt import START, dlabel, fixed, full, hhmm, jround, jstr, num, pct
from .rca import HYP
from .report import fill_text, lim_text, slow_kv

SAMPLE_Q = ['Why did Line 1 overall score drop on 10 Sep?', 'Which stop reason cost the most minutes on Line 2?', 'How many bottles were rejected yesterday?',
            'Compare shift A, B and C on both lines', 'What happened at 13:20 on 11 Sep?']
SHIFTS = ['A', 'B', 'C']
# Words that show a question is about the plant. A question with none of these, and no line, date or time, is off topic.
PLANT_RX = (r'\b(lines?|l[12]|oee|score|efficien\w*|stops?|stopped|stoppages?|down ?time|faults?|jams?|breakdowns?|rejects?|rejected|defects?|scrap|'
            r'quality|speed|slow\w*|pace|output|produc\w*|bottles?|volume|preforms?|stock|cover|material|shifts?|changeovers?|cip|clean\w*|'
            r'deliver\w*|late|capper|cap|torque|filler|labell?er|labels?|conveyor|setpoint|plant|machines?|events?|happen\w*|running|ran|'
            r'alerts?|warnings?|kpis?|minutes?|hours?|yesterday|today|week|underfill|particle|damaged|misfeed|blockage|micro)\b')
OFF_TOPIC = 'That is not about Line 1 or Line 2, so it is not in the data. Ask about overall score, stops, speed, rejects, bottles made or preforms.'
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


def T(day, h, m=0):
    return (day - 1) * 1440 + h * 60 + m - 360


def _dt(m):
    from datetime import timedelta
    return START + timedelta(minutes=int(m))


def cal_day(m):
    return _dt(m).day


class Explorer:
    def __init__(self, eng):
        self.eng, self.st, self.S, self.N = eng, eng.st, eng.S, eng.st.N
        self.DATA_END = self.N - 1

    # ------------------------------------------------------------ plan (rule reader)
    def day_range(self, d):
        a = T(d, 0, 0)
        return [max(0, a), min(self.N - 1, a + 1439)]

    def rule_plan(self, raw, now, hist=None):
        S, st = self.S, self.st
        q = ' ' + re.sub(r'[?!]', ' ', raw.lower()) + ' '
        P = {'raw': raw, 'q': q, 'lines': [], 'measure': None, 'range': None, 'at': None, 'notes': [], 'abstain': None}
        lm = [int(m.group(1) or m.group(2)) for m in re.finditer(r'\bline\s*(\d)\b|\bl(\d)\b', q)]
        badl = next((x for x in lm if x > 2 or x < 1), None)
        if badl is not None:
            P['abstain'] = {'why': 'unknown', 'text': 'Line ' + str(badl) + ' is not in the data. The data has Line 1 and Line 2.'}
            return P
        P['lines'] = list(dict.fromkeys(x - 1 for x in lm))
        if re.search(r'\bboth\b|\ball lines\b|\beach line\b|\bplant\b', q):
            P['lines'] = [0, 1]
        P['explicitLine'] = len(P['lines']) > 0
        M = [('oee', r'\boee\b|overall score|overall equipment|efficiency'), ('cover', r'preform|stock|cover|material'), ('rej', r'reject|defect|scrap|quality|bad bottles'),
             ('stop', r'stop|down ?time|fault|breakdown'), ('speed', r'speed|slow|pace'), ('output', r'output|produced|production|bottles|volume')]
        for k, rx in M:
            if re.search(rx, q):
                P['measure'] = k
                break

        def rkey(r):
            lo = r.lower()
            return 'preform' if lo.split(' ')[0] == 'material' else lo.split(' (')[0].split(' - ')[0]
        P['reason'] = next((r for r in st.fault_names if rkey(r) in q), None)
        if re.search(r'labeler|label', q) and not re.search(r'misaligned', q):
            P['reason'] = P['reason'] or 'Labeler misfeed'
        P['defect'] = next((r for r in st.defect_names if r.lower().split(' ')[0] in q), None)
        sh = re.search(r'\bshift\s*([abc])\b', q)
        P['shift'] = sh.group(1).upper() if sh else None
        if re.search(r'\b(will|forecast|predict|predicted|tomorrow|next (week|shift|day|month|hour)|going to|expect|projected|upcoming)\b', q):
            P['abstain'] = {'why': 'future', 'text': 'A forecast is not in the data. I read only what already happened, up to ' + full(now) + '.'}
            return P
        miss = re.search(r'\b(costs? (of|per)|how much did .* cost|price|pricing|profit|revenue|money|dollars?|sgd|usd|energy|kwh|electric\w*|water use|power use|temperature|headcount|employees?|salary|customers?|sales|weather|co2|emissions?|supplier name|operator name|who)\b', q)
        if miss:
            P['abstain'] = {'why': 'missing', 'text': '"' + miss.group(1) + '" is not in the data.'}
            return P
        if re.search(r'\b(should|opinion|do you think|feel|blame|recommend)\b', q):
            P['abstain'] = {'why': 'opinion', 'text': 'That is a judgment, not a fact in the data. I can show the numbers behind it.'}
            return P
        day = mon = None
        for m in re.finditer(r'\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s*)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6})\b|\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6})\s*(\d{1,2})\b', q):  # month names only
            d = int(m.group(1)) if m.group(1) else int(m.group(4))
            mm = (m.group(2) or m.group(3) or '')[:3]
            if mm in MONTHS:
                day, mon = d, mm
                break
        cm = re.search(r'\b(\d{1,2})[:.](\d{2})\b', q) or re.search(r'\b(?:at|around)\s+(\d{1,2})\s*(am|pm)\b', q)
        clock = None
        if cm:
            h = int(cm.group(1))
            g2 = cm.group(2)
            mi = 0 if g2 in ('am', 'pm') else int(g2)
            if g2 == 'pm' and h < 12:
                h += 12
            if g2 == 'am' and h == 12:
                h = 0
            clock = [h, mi]
        if mon and mon != 'sep':
            P['abstain'] = {'why': 'outside', 'text': str(day) + ' ' + mon + ' is outside the data.'}
            return P
        if day is not None and (day < 1 or day > 15):
            P['abstain'] = {'why': 'outside', 'text': str(day) + ' Sep is outside the data.'}
            return P
        if day is not None and clock:
            P['at'] = T(day, clock[0], clock[1])
            P['range'] = [P['at'], P['at']]
            P['label'] = full(P['at'])
        elif day is not None:
            P['range'] = self.day_range(day)
            P['label'] = str(day) + ' Sep'
            P['day'] = day
        elif clock and re.search(r'\b(at|around)\b', q):
            cur = _dt(now)
            P['at'] = T(cur.day - (1 if clock[0] * 60 + clock[1] > cur.hour * 60 + cur.minute else 0), clock[0], clock[1])
            P['range'] = [P['at'], P['at']]
            P['label'] = full(P['at'])
        elif re.search(r'\byesterday\b', q):
            d = cal_day(now) - 1
            P['range'] = self.day_range(d)
            P['label'] = 'yesterday (' + str(d) + ' Sep)'
            P['day'] = d
        elif re.search(r'\btoday\b|this day', q):
            r = self.day_range(cal_day(now))
            P['range'] = [r[0], now]
            P['label'] = 'today so far (since 00:00 on ' + str(cal_day(now)) + ' Sep)'
        elif re.search(r'last hour|past hour|last 60', q):
            P['range'] = [now - 59, now]
            P['label'] = 'the last hour'
        elif re.search(r'last 24|past 24|last day', q):
            P['range'] = [now - 1439, now]
            P['label'] = 'the last 24 hours'
        elif re.search(r'last 7 days|last week|past week|this week', q):
            P['range'] = [now - 10079, now]
            P['label'] = 'the last 7 days'
        elif re.search(r'this shift|current shift', q):
            s0 = (now // 480) * 480
            P['range'] = [s0, now]
            P['label'] = 'this shift (since ' + hhmm(s0) + ')'
        elif re.search(r'\bnow\b|right now|currently|at the moment|\bcurrent\b', q):
            P['at'] = now
            P['range'] = [max(0, now - 59), now]
            P['label'] = 'the last hour to ' + full(now)
            P['isNow'] = True
        if not self.on_topic(P, hist):
            P['abstain'] = {'why': 'off_topic', 'text': OFF_TOPIC}
            return P
        return self.finish_plan(P, now, hist)

    @staticmethod
    def on_topic(P, hist=None):
        """True if the question names a plant word, a line, a date or a time, or is a short follow-up in a chat."""
        q = P['q']
        if re.search(PLANT_RX, q):
            return True
        if P.get('explicitLine') or P.get('measure') or P.get('range') or P.get('at') is not None or P.get('shift'):
            return True   # (reason / defect names match parts of words, e.g. "cap" in "capital", so they do not count here)
        return bool(hist) and len(P['raw'].split()) <= 4 and bool(re.search(r'\b(why|how|and|what about|how about|then|same|more|again)\b', q))

    def finish_plan(self, P, now, hist=None):
        """Checks shared by the rule reader and the model planner: no future, clip to now, chat memory."""
        S = self.S
        if P.get('range') and P['range'][0] > now:
            P['abstain'] = {'why': 'after', 'text': P['label'] + ' is after the current time (' + full(now) + '). I read data only up to now. Move the time bar forward, or ask about an earlier time.'}
            return P
        if P.get('range') and P['range'][1] > now:
            P['range'] = [P['range'][0], now]
            P['label'] += ' (up to now)'
        if P.get('range'):
            P['range'][0] = max(0, P['range'][0])
        q, raw = P['q'], P['raw']
        own = P.get('explicitLine') or P.get('measure') or P.get('range') or P.get('at') is not None or P.get('shift') or P.get('reason') or P.get('defect')
        follow = bool(re.search(r'\b(and|what about|how about|same|that|then|it|those|there|also)\b', q))
        short = len(raw.strip().split()) <= 6 and bool(own or follow)
        if hist:
            mem = list(reversed(hist[-max(1, jround(S['memory'] / 2)):]))
            for h in mem:
                if not P.get('explicitLine') and h.get('lines') and short:
                    P['lines'] = list(h['lines'])
                    P['inherited'] = True
                if not P.get('measure') and h.get('measure') and short:
                    P['measure'] = h['measure']
                    P['inherited'] = True
                if not P.get('range') and h.get('range') and short:
                    P['range'] = list(h['range'])
                    P['label'] = h.get('label')
                    P['day'] = h.get('day')
                    P['inherited'] = True
                if P['lines'] and P.get('measure') and P.get('range'):
                    break
        return P

    @staticmethod
    def rule_intent(P):
        q = P['q']
        if re.search(r'\bwhy\b|what caused|root cause|\bcause of\b|explain|how come|reason for the|reason behind', q):
            return 'why'
        if re.search(r"what happened|what went on|what.s going on|what is going on|anything (odd|unusual)|\bevents?\b", q):
            return 'happened'
        if re.search(r'\bshifts\b|\bby shift\b|\beach shift\b|\bcompare\b.*\bshift\b', q):  # 'this shift' is a time
            return 'shifts'
        if wants_aggregate(q):
            return 'aggregate'
        if re.search(r'\b(reason|reasons|type|types|kind|kinds|defect|defects|fault|faults)\b', q) and re.search(r'\b(most|top|biggest|largest|worst|main|highest|cost|which|what)\b', q) \
                and P.get('measure') not in ('oee', 'speed'):
            return 'top'
        if P.get('measure') or P.get('range') or P.get('at') is not None:
            return 'value'
        return 'none'

    # ------------------------------------------------------------ helpers
    def kv(self, key, l, t):
        return self.eng.kv(key, l, t)

    def brute(self, l, a, b):
        L = self.st.L[l]
        run = flt = pln = prd = rj = 0
        for i in range(a, b + 1):
            s = L.st[i]
            if s == 0:
                run += 1
            elif s == 1:
                flt += 1
            else:
                pln += 1
            prd += L.prod[i]
            rj += L.rej[i]
        return {'run': run, 'flt': flt, 'pln': pln, 'prd': prd, 'rj': rj, 'len': b - a + 1}

    def rs(self, l, a, b):
        return kpis.range_stats(self.st.L[l], self.N, a, b)

    def hourly(self, l, a, b):
        rows = []
        h = a - (0 if a % 60 == 0 else a % 60)
        while h <= b:
            x, y = max(h, a), min(h + 59, b)
            r = self.rs(l, x, y)
            rows.append([iso_ts(x), self.st.ids[l], int(r['produced']), int(r['rejected']), int(r['fault']), int(r['planned']),
                         None if r['oee'] is None else float(fixed(r['oee'] * 100, 1))])
            h += 60
        return rows

    def row_cap(self, rows):
        cap = jround(self.S['rows'])
        return {'rows': rows[:cap], 'total': len(rows), 'cut': True} if len(rows) > cap else {'rows': rows, 'total': len(rows), 'cut': False}

    def bucket_trend(self, lines, a, b, fn):
        span = b - a + 1
        step = 1440 if span > 72 * 60 else (60 if span > 12 * 60 else 15)
        series = []
        for l in lines:
            pts = []
            x = a
            while x <= b:
                y = min(b, x + step - 1)
                if y - x + 1 >= min(step, 15):
                    pts.append([x, fn(l, x, y)])
                x += step
            series.append({'name': self.st.names[l], 'line': l, 'pts': pts})
        return {'series': series, 'step': step}

    def meas_f(self, key):
        P = lambda l: self.st.L[l].P  # noqa: E731
        if key == 'oee':
            return lambda l, x, y: None if self.rs(l, x, y)['oee'] is None else self.rs(l, x, y)['oee'] * 100
        if key == 'stop':
            return lambda l, x, y: ws(P(l)['flt'], x, y)
        if key == 'speed':
            return lambda l, x, y: None if self.rs(l, x, y)['performance'] is None else self.rs(l, x, y)['performance'] * 100
        if key == 'rej':
            return lambda l, x, y: None if self.rs(l, x, y)['reject_rate'] is None else self.rs(l, x, y)['reject_rate'] * 100
        return lambda l, x, y: ws(P(l)['prd'], x, y)

    MEAS_NAME = {'oee': ('Overall score', '%'), 'stop': ('Stopped time', ' min'), 'speed': ('Speed', '%'), 'rej': ('Rejects', '%'), 'output': ('Bottles made', '')}

    class Facts:
        def __init__(self):
            self.facts = []

        def add(self, label, value, shown, check):
            fid = 'f%d' % (len(self.facts) + 1)
            self.facts.append({'id': fid, 'label': label, 'value': value, 'shown': shown, 'check': check,
                               'ok': check is not None and abs(value - check) < 1e-6})
            return '{{' + fid + '}}'

    def lens_simple(self, l, a, b, value_of, fmtf):
        n = b - a + 1
        out = {'before': [], 'same': [], 'past': []}
        pa, pb = a - n, a - 1
        if pa >= 0:
            v0, v1 = value_of(l, pa, pb), value_of(l, a, b)
            out['before'].append('Period before (' + dlabel(pa) + ' ' + hhmm(pa) + ' to ' + dlabel(pb) + ' ' + hhmm(pb) + '): ' + fmtf(v0) + ' against ' + fmtf(v1) + ' now.')
        else:
            out['before'].append('No earlier period of the same length is in the data.')
        o = 1 - l
        out['same'].append(self.st.names[o] + ' in the same period: ' + fmtf(value_of(o, a, b)) + '.')
        days = []
        for d in range(14):
            x, y = d * 1440, d * 1440 + 1439
            if y > b + 1440 or (x >= a and y <= b) or y > self.DATA_END:
                continue
            if x > b:
                continue
            v = value_of(l, x, y)
            if v is not None:
                days.append([d, v])
        cur = value_of(l, a, b)
        if cur is not None and days:
            days.sort(key=lambda p: abs(p[1] - cur))
            out['past'] = [self.st.names[l] + ' on ' + dlabel(d * 1440) + ': ' + fmtf(v) for d, v in days[:jround(self.S['simK'])]]
        if not out['past']:
            out['past'].append('No other full day is in the data yet.')
        return out

    def lens_text(self, L):
        return {'before': L['before'], 'same': [x['label'] + ': ' + x['value'] for x in L['same']], 'past': self.eng.past_text(L['past'])}

    @staticmethod
    def disp(key, v):
        return (None if v is None else v * 100) if key in ('oee', 'speed', 'rej') else v

    def abstain(self, text, now):
        return {'kind': 'abstain', 'intent': 'abstain', 'text': text, 'facts': [], 'queried': [], 'raw': None, 'trend': None, 'lens': None,
                'dataRange': 'The data runs from ' + full(0) + ' to ' + full(now) + '.', 'suggestions': SAMPLE_Q}

    # ------------------------------------------------------------ answers
    def ans_value(self, P, now):
        st = self.st
        lines = P['lines'] or [0, 1]
        meas = P['measure'] or 'oee'
        a, b = P['range'] or [0, now]
        F = self.Facts()
        if meas == 'cover':
            at = P['at'] if P.get('at') is not None else now
            parts = [st.names[l] + ' has preforms for ' + F.add(st.names[l] + ' preforms left', self.kv('cover', l, at), kpis.fmt('cover', self.kv('cover', l, at)), slow_kv(st, 'cover', l, at)) +
                     ' (stock ' + num(st.L[l].stock[at]) + ')' for l in lines]
            rows = [[iso_ts(at), st.ids[l], st.L[l].stock[at], st.L[l].prod[at], jround(kpis.pace30(st.L[l], at) * 10) / 10] for l in lines]
            return {'kind': 'answer', 'intent': 'value', 'text': '. '.join(parts) + ' at ' + full(at) + '.', 'facts': F.facts,
                    'queried': [{'table': 'minute_readings', 'filter': 'preform_stock at ' + full(at) + ', ' + ' + '.join(st.ids[l] for l in lines), 'rows': len(lines)},
                                {'table': 'minute_readings', 'filter': 'last 30 min, bottles per running minute (pace)', 'rows': len(lines) * 30}],
                    'raw': {'table': 'minute_readings', 'cols': ['ts', 'line', 'preform_stock', 'produced', 'pace_per_min'], 'rows': rows, 'total': len(rows), 'cut': False},
                    'trend': self.bucket_trend(lines, max(0, at - 720), at, lambda l, x, y: st.L[l].stock[y]),
                    'trendInfo': {'name': 'Preform stock', 'unit': '', 'note': 'Stock over the last 12 hours.'},
                    'lens': {'before': ['Stock moves up when a delivery arrives and down while the line runs.'],
                             'same': [st.names[l] + ' pace: ' + jstr(jround(kpis.pace30(st.L[l], at) * 10) / 10) + ' bottles per running minute.' for l in lines], 'past': []}}
        if meas not in self.MEAS_NAME:
            meas = 'oee'
        name, unit = self.MEAS_NAME[meas]
        label = P.get('label') or 'all data up to now (' + full(now) + ')'
        f = self.meas_f(meas)

        def fmtv(v):
            if v is None:
                return '–'
            return (num(v) if meas == 'output' else fixed(v, 1 if meas == 'rej' else 0)) + unit
        bl = []
        for l in lines:
            v, br = f(l, a, b), self.brute(l, a, b)
            chk = None
            if meas == 'oee':
                chk = (br['prd'] - br['rj']) / (st.ideal[l] * (br['len'] - br['pln'])) * 100 if br['len'] - br['pln'] >= 15 else None
            if meas == 'stop':
                chk = br['flt']
            if meas == 'speed':
                chk = br['prd'] / (st.ideal[l] * br['run']) * 100 if br['run'] else None
            if meas == 'rej':
                chk = br['rj'] / br['prd'] * 100 if br['prd'] else None
            if meas == 'output':
                chk = br['prd']
            sh = F.add(st.names[l] + ' ' + name.lower(), 0 if v is None else v, fmtv(v), 0 if chk is None else chk)
            extra = ''
            if meas == 'rej':
                Pl = st.L[l].P
                extra = ' (' + F.add(st.names[l] + ' rejected bottles', br['rj'], num(br['rj']), ws(Pl['rj'], a, b)) + ' of ' + F.add(st.names[l] + ' bottles made', br['prd'], num(br['prd']), ws(Pl['prd'], a, b)) + ')'
            if meas == 'stop':
                extra = ' out of ' + num(br['len']) + ' min'
            bl.append(st.names[l] + ': ' + sh + extra)
        rows_all = []
        for l in lines:
            rows_all += self.hourly(l, a, b)
        rc = self.row_cap(rows_all)
        tr = self.bucket_trend(lines, a, b, f)
        lens = self.lens_simple(lines[0], a, b, f, fmtv)
        noun = {'oee': 'overall score', 'stop': 'stopped time (faults only)', 'speed': 'speed against ideal while running', 'rej': 'rejects', 'output': 'bottles made'}[meas]
        step = 'day' if tr['step'] == 1440 else ('hour' if tr['step'] == 60 else '15 min')
        return {'kind': 'answer', 'intent': 'value', 'text': 'For ' + label + ', ' + noun + ' was - ' + '; '.join(bl) + '.', 'facts': F.facts,
                'queried': [{'table': 'minute_readings', 'filter': ' + '.join(st.ids[l] for l in lines) + ', ' + iso_ts(a) + ' to ' + iso_ts(b), 'rows': len(lines) * (b - a + 1)},
                            {'table': 'hourly_production', 'filter': 'same range, one row per hour', 'rows': rc['total']}],
                'raw': {'table': 'hourly_production', 'cols': ['hour_start', 'line', 'produced', 'rejects', 'stopped_min', 'planned_min', 'oee_%'], 'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': tr, 'trendInfo': {'name': name, 'unit': unit, 'note': 'Per ' + step + '.'}, 'lens': lens}

    def ans_top(self, P, now):
        st = self.st
        lines = P['lines'] or [0, 1]
        a, b = P['range'] or [0, now]
        F = self.Facts()
        label = P.get('label') or 'all data up to now (' + full(now) + ')'
        want_def = P.get('measure') == 'rej' or bool(P.get('defect'))
        names = st.defect_names if want_def else st.fault_names
        tot = {n: 0 for n in names}
        if want_def:
            for l in lines:
                for j, n in enumerate(st.defect_names):
                    tot[n] += sum(st.L[l].dc[j][a:b + 1])
        else:
            for l in lines:
                for e in st.evL[l]:
                    if e['planned']:
                        continue
                    x, y = max(e['start'], a), min(e['end'] - 1, b)
                    if y >= x:
                        tot[e['reason']] += y - x + 1
        rank = sorted([[n, tot[n]] for n in names], key=lambda p: -p[1])
        rank = [x for x in rank if x[1] > 0]
        total = sum(x[1] for x in rank)
        tbl = 'defects' if want_def else 'downtime_events'
        if not rank:
            return {'kind': 'answer', 'intent': 'top', 'text': 'No ' + ('rejects' if want_def else 'stops') + ' were logged for ' + label + '.', 'facts': [],
                    'queried': [{'table': tbl, 'filter': label, 'rows': 0}], 'raw': {'table': tbl, 'cols': ['ts'], 'rows': [], 'total': 0, 'cut': False},
                    'trend': {'series': [], 'step': 1440}, 'trendInfo': {'name': '', 'unit': '', 'note': ''}, 'lens': {'before': [], 'same': [], 'past': []}}
        top = rank[0][0]
        unit = ' bottles' if want_def else ' min'
        chk_top = 0
        for l in lines:
            if want_def:
                chk_top += sum(st.L[l].dc[st.defect_names.index(top)][a:b + 1])
            else:
                code = st.fault_names.index(top) + 1
                chk_top += sum(1 for i in range(a, b + 1) if st.L[l].st[i] == 1 and st.L[l].rid[i] == code)
        t1 = F.add('Top ' + ('defect' if want_def else 'stop reason') + ' total', rank[0][1], num(rank[0][1]) + unit, chk_top)
        sh = F.add('Share of all ' + ('rejects' if want_def else 'stop minutes'), rank[0][1] / total * 100, str(jround(rank[0][1] / total * 100)) + '%', chk_top / total * 100)
        second = ('. Next: ' + ', '.join(x[0] + ' ' + F.add(x[0], x[1], num(x[1]) + unit, x[1]) for x in rank[1:3])) if len(rank) > 1 else ''
        lname = 'both lines together' if len(lines) == 2 else st.names[lines[0]]
        rows_all = []
        if want_def:
            j = st.defect_names.index(top)
            for l in lines:
                for i in range(a, b + 1):
                    if st.L[l].dc[j][i]:
                        rows_all.append([iso_ts(i), st.ids[l], top, st.L[l].dc[j][i]])
        else:
            for l in lines:
                for e in st.evL[l]:
                    if not e['planned'] and e['reason'] == top and e['end'] - 1 >= a and e['start'] <= b:
                        rows_all.append([e['id'], st.ids[l], iso_ts(e['start']), e['minutes'], e['reason'], e['comment']])
        rows_all.sort(key=lambda p: str(p[2]))
        rc = self.row_cap(rows_all)

        def value_of(l, x, y):
            if want_def:
                return sum(st.L[l].dc[st.defect_names.index(top)][x:y + 1])
            s = 0
            for e in st.evL[l]:
                if e['planned'] or e['reason'] != top:
                    continue
                u, v = max(e['start'], x), min(e['end'] - 1, y)
                if v >= u:
                    s += v - u + 1
            return s
        tr = self.bucket_trend(lines, a, b, value_of)
        lens = self.lens_simple(lines[0], a, b, value_of, lambda v: '–' if v is None else num(v) + unit)
        lens['before'][0] = lens['before'][0].replace('against', top + ': against', 1)
        step = 'day' if tr['step'] == 1440 else ('hour' if tr['step'] == 60 else '15 min')
        return {'kind': 'answer', 'intent': 'top', 'text': 'For ' + label + ' on ' + lname + ', the top ' + ('defect' if want_def else 'stop reason') + ' is "' + top + '": ' + t1 + ' (' + sh +
                ' of all' + (' rejects' if want_def else ' stop minutes') + ')' + second + '.', 'facts': F.facts,
                'queried': [{'table': tbl, 'filter': ' + '.join(st.ids[l] for l in lines) + ', ' + iso_ts(a) + ' to ' + iso_ts(b) + ('' if want_def else ', unplanned only'), 'rows': rc['total']}],
                'raw': {'table': tbl, 'cols': ['ts', 'line', 'code', 'qty'] if want_def else ['id', 'line', 'start', 'minutes', 'reason', 'comment'], 'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': tr, 'trendInfo': {'name': top, 'unit': unit, 'note': 'Per ' + step + '.'}, 'lens': lens, 'ranking': rank}

    def ans_shifts(self, P, now):
        st = self.st
        lines = P['lines'] or [0, 1]
        a, b = P['range'] or [0, now]
        F = self.Facts()
        label = P.get('label') or 'all data up to now (' + full(now) + ')'
        rows, spts = [], {}
        acc = [[{'good': 0, 'den': 0} for _ in range(3)] for _ in lines]
        hi = min(b, now)
        for li, l in enumerate(lines):
            blk = a // 480
            while blk * 480 + 479 <= hi:
                x, y = blk * 480, blk * 480 + 479
                r = self.rs(l, x, y)
                s = blk % 3
                acc[li][s]['good'] += r['good']
                acc[li][s]['den'] += st.ideal[l] * (r['minutes'] - r['planned'])
                o = None if r['oee'] is None else float(fixed(r['oee'] * 100, 1))
                rows.append([dlabel(x), SHIFTS[s], st.ids[l], int(r['produced']), int(r['rejected']), int(r['fault']), int(r['planned']), o])
                if r['oee'] is not None:
                    spts.setdefault(st.ids[l] + str(s), []).append([x, o])
                blk += 1
        parts = []
        for li, l in enumerate(lines):
            v = [c['good'] / c['den'] * 100 if c['den'] else None for c in acc[li]]
            lo = -1
            for i, x in enumerate(v):
                if x is not None and (lo < 0 or x < v[lo]):
                    lo = i
            chk = []
            for s in range(3):
                g = sum(r[3] - r[4] for r in rows if r[2] == st.ids[l] and r[1] == SHIFTS[s])
                d = 0
                blk = a // 480
                while blk * 480 + 479 <= hi:
                    if blk % 3 == s:
                        br = self.brute(l, blk * 480, blk * 480 + 479)
                        d += st.ideal[l] * (br['len'] - br['pln'])
                    blk += 1
                chk.append(g / d * 100 if d else None)
            parts.append(st.names[l] + ': ' + ', '.join('shift ' + n + ' ' + F.add(st.names[l] + ' shift ' + n, 0 if v[s] is None else v[s], '–' if v[s] is None else str(jround(v[s])) + '%', 0 if chk[s] is None else chk[s])
                                                       for s, n in enumerate(SHIFTS)) + (' (lowest: shift ' + SHIFTS[lo] + ')' if lo >= 0 else ''))
        rc = self.row_cap(rows)
        series = [{'name': st.names[l] + ' shift ' + n, 'line': l, 'shift': s, 'pts': spts.get(st.ids[l] + str(s), [])} for l in lines[:1] for s, n in enumerate(SHIFTS)]
        lens = {'before': ['Each shift is one 8-hour block: A 06-14, B 14-22, C 22-06.'],
                'same': ['Both lines are compared in the answer.'] if len(lines) == 2 else [st.names[1 - lines[0]] + ' is not in this answer. Ask "compare shifts on both lines".'],
                'past': ['The trend shows the shift scores for each day.']}
        return {'kind': 'answer', 'intent': 'shifts', 'text': 'For ' + label + ', overall score by shift - ' + '; '.join(parts) + '.', 'facts': F.facts,
                'queried': [{'table': 'oee_by_shift', 'filter': ' + '.join(st.ids[l] for l in lines) + ', full shifts from ' + iso_ts(a) + ' to ' + iso_ts(hi), 'rows': rc['total']}],
                'raw': {'table': 'oee_by_shift', 'cols': ['date', 'shift', 'line', 'produced', 'rejects', 'stopped_min', 'planned_min', 'oee_%'], 'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': {'series': series, 'step': 480, 'shiftMode': True},
                'trendInfo': {'name': 'Overall score by shift', 'unit': '%', 'note': 'Shows ' + st.names[lines[0]] + '. Each point is one shift block.'}, 'lens': lens}

    def worst_point(self, key, l, a, b):
        d = kpis.SPEC[key][3]
        best, bt = None, -1
        for t in range(max(a, 60), b + 1, 5):
            v = self.kv(key, l, t)
            if v is None:
                continue
            if best is None or (v < best if d == 'below' else v > best):
                best, bt = v, t
        if bt < 0:
            return None
        for t in range(max(a, 60, bt - 4), min(b, bt + 4) + 1):
            v = self.kv(key, l, t)
            if v is not None and (v < best if d == 'below' else v > best):
                best, bt = v, t
        return {'t': bt, 'v': best}

    def normal_check(self, key, l, t):
        v = []
        for k in range(1, jround(self.S['baseDays']) + 1):
            x = t - k * 1440
            if x < 60:
                break
            y = slow_kv(self.st, key, l, x)
            if y is not None:
                v.append(y)
        return sum(v) / len(v) if v else None

    def ans_why(self, P, now):
        st, S, eng = self.st, self.S, self.eng
        meas = 'oee' if P.get('measure') in (None, 'output') else P['measure']
        key = meas
        spec = kpis.SPEC[key]
        kname, kdir = spec[1], spec[3]
        a, b = P['range'] or [max(0, now - 1439), now]
        hi = min(b, now)
        F = self.Facts()
        cand = []
        for l in (P['lines'] or [0, 1]):
            if P.get('at') is not None:
                v = self.kv(key, l, P['at'])
                if v is not None:
                    cand.append({'l': l, 't': P['at'], 'v': v})
            else:
                w = self.worst_point(key, l, a, hi)
                if w:
                    cand.append({'l': l, 't': w['t'], 'v': w['v']})
        if not cand:
            return self.abstain('There is not enough data in ' + (P.get('label') or 'that period') + ' to judge ' + kname.lower() + '. The first hour of data has no ' + kname.lower() + ' value.', now)
        cand.sort(key=lambda x: x['v'] if kdir == 'below' else -x['v'])
        l, tw, v = cand[0]['l'], cand[0]['t'], cand[0]['v']
        r = eng.rca_core(l, key, tw, tw, S)
        top = r['top']
        breach = kpis.is_breach(S, key, v)
        nm, nchk = eng.normal_at(key, l, tw), self.normal_check(key, l, tw)
        LN = st.names[l]
        f1 = F.add(LN + ' ' + kname.lower(), self.disp(key, v), kpis.fmt(key, v), self.disp(key, slow_kv(st, key, l, tw)))
        f2 = F.add('Normal ' + kname.lower() + ' at this hour', self.disp(key, nm['mean']), kpis.fmt(key, nm['mean']), self.disp(key, nchk)) if nm else None
        dir_word = 'lowest' if kdir == 'below' else 'highest'
        lt = lim_text(S, key)
        text = LN + ' ' + kname.lower() + ' was at its ' + dir_word + ' at ' + full(tw) + ': ' + f1 + (('. Normal at this hour on ' + str(nm['n']) + ' earlier days: ' + f2) if f2 else '') + '. ' + \
            ('This is past the warning level (' + lt + ').' if breach else 'This is inside the warning level (' + lt + ').')
        good = [c for c in top['checks'] if c['ok']] if top else []
        unusual = breach or bool(nm and nm['sd'] > 0 and (v < nm['mean'] - 2 * nm['sd'] if kdir == 'below' else v > nm['mean'] + 2 * nm['sd']))
        nl = 4 if S['length'] >= 850 else (3 if S['length'] >= 450 else 2)
        nt = len(r['tested'])
        if not unusual:
            verdict = {'kind': 'normal', 'title': 'Nothing unusual here', 'sub': 'The value is in its usual range, so I name no cause.', 'lines': ['Ask about a different time if you saw a drop.']}
        elif r['cause']:
            verdict = {'kind': 'cause', 'title': HYP[r['cause']], 'sub': str(top['passed']) + ' of ' + str(top['total']) + ' checks passed', 'lines': [c['detail'] for c in good[:nl]]}
        elif top and top['key'] == 'normal_noise' and top['passed'] >= 1:
            verdict = {'kind': 'normal', 'title': 'Looks like normal variation', 'sub': str(top['passed']) + ' of ' + str(top['total']) + ' checks passed', 'lines': [c['detail'] for c in good]}
        else:
            verdict = {'kind': 'unclear', 'title': 'The cause is not clear from the data', 'sub': 'I tested ' + str(nt) + ' idea' + ('s' if nt > 1 else '') + '. None passed enough checks.',
                       'lines': ['Closest idea: ' + HYP[top['key']] + ' (' + str(top['passed']) + ' of ' + str(top['total']) + ' checks).'] if top else []}
        text += ' ' + verdict['title'] + ((' - ' + verdict['sub'] + '. ' + ' '.join(verdict['lines'])) if verdict['kind'] == 'cause' else '.')
        ar = jround(S['around'])
        x0, x1 = max(0, r['on'] - ar), min(now, tw + min(ar, 30))
        L = st.L[l]

        def rsn(i):
            rr = L.rid[i]
            return st.fault_names[rr - 1] if 1 <= rr <= 6 else (st.planned_names[rr - 11] if rr >= 11 else '')
        rows = [[iso_ts(i), st.ids[l], ['running', 'stopped', 'planned stop'][L.st[i]], rsn(i), jround(L.setp[i] * 100), L.prod[i], L.rej[i], L.stock[i], float(fixed(L.tor[i], 2))] for i in range(x0, x1 + 1)]
        rc = self.row_cap(rows)
        s0, s1 = max(0, tw - 480), min(now, tw + 60)

        def pts(ll):
            out = []
            for t in range(max(60, s0), s1 + 1, 10):
                y = self.kv(key, ll, t)
                if y is not None:
                    out.append([t, self.disp(key, y)])
            return out
        lens = self.lens_text(eng.lenses(l, r['on'], tw, now))
        tests = [h['name'] + ': ' + str(h['passed']) + ' of ' + str(h['total']) + ' checks passed' + ((' (' + '; '.join(c['text'] for c in h['checks'] if c['ok']) + ')') if h['passed'] else '') for h in r['tested']]
        unit = ' min' if key in ('stop', 'cover') else '%'
        limit = self.disp(key, S[spec[4]] if key in ('stop', 'cover') else S[spec[4]] / 100)
        return {'kind': 'answer', 'intent': 'why', 'text': text, 'facts': F.facts,
                'queried': [{'table': 'minute_readings', 'filter': st.ids[l] + ', ' + iso_ts(x0) + ' to ' + iso_ts(x1), 'rows': x1 - x0 + 1},
                            {'table': 'downtime_events + setpoint_changes + deliveries', 'filter': st.ids[l] + ' and ' + st.ids[1 - l] + ', ±' + str(ar) + ' min around the start', 'rows': len(lens['before'])},
                            {'table': 'event_features', 'filter': 'nearest past windows to ' + iso_ts(tw) + ' (30-min grid, before ' + iso_ts(max(0, tw - 180)) + ')', 'rows': 0}],
                'raw': {'table': 'minute_readings', 'cols': ['ts', 'line', 'state', 'stop_reason', 'set_speed_%', 'produced', 'rejects', 'preform_stock', 'cap_torque_Nm'], 'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': {'series': [{'name': LN, 'line': l, 'pts': pts(l)}, {'name': st.names[1 - l] + ' (other line)', 'line': 1 - l, 'pts': pts(1 - l)}], 'step': 10,
                          'marks': [{'t': r['on'], 'label': 'trouble starts'}, {'t': tw, 'label': dir_word}]},
                'trendInfo': {'name': kname, 'unit': unit, 'limit': limit, 'note': 'Last 8 hours before the ' + dir_word + ' point. Dashed line is the warning level.'},
                'lens': lens, 'tested': tests, 'cause': r['cause'] or None, 'verdict': verdict, 'headline': text[:text.find(' ' + verdict['title'])] if text.find(' ' + verdict['title']) >= 0 else text[:-1]}

    def ans_happened(self, P, now):
        st, S, eng = self.st, self.S, self.eng
        F = self.Facts()
        if P.get('at') is not None:
            w = max(15, jround(S['around'] / 4))
            a, b = max(0, P['at'] - w), min(now, P['at'] + w)
            label = 'around ' + full(P['at']) + ' (±' + str(w) + ' min)'
        elif P.get('range'):
            a, b, label = P['range'][0], min(now, P['range'][1]), P['label']
        else:
            a, b, label = max(0, now - 59), now, 'the last hour'
        rows, parts = [], []
        for l in (0, 1):
            evs = [e for e in st.evL[l] if e['end'] - 1 >= a and e['start'] <= b]
            for e in evs:
                rows.append([e['id'], st.ids[l], iso_ts(e['start']), e['minutes'], e['reason'], 'planned' if e['planned'] else 'unplanned', e['comment']])
            un = [e for e in evs if not e['planned']]
            br = self.brute(l, a, b)
            mins = F.add(st.names[l] + ' stopped minutes', br['flt'], str(br['flt']) + ' min', ws(st.L[l].P['flt'], a, b))
            lst = '; '.join(hhmm(e['start']) + ' ' + (e['reason'] if e['planned'] else 'Stop: ' + e['reason']) + ' (' + str(e['minutes']) + ' min' + (', note "' + e['comment'] + '"' if e['comment'] else '') + ')' for e in evs[:4])
            if evs:
                parts.append(st.names[l] + ': ' + str(len(evs)) + ' event' + ('s' if len(evs) > 1 else '') + ', ' + str(len(un)) + ' unplanned, ' + mins + ' stopped - ' + lst + ('; and ' + str(len(evs) - 4) + ' more' if len(evs) > 4 else ''))
            else:
                parts.append(st.names[l] + ': no stops, ' + mins + ' stopped')
        at = P['at'] if P.get('at') is not None else b
        kp = []
        for l in (0, 1):
            v = self.kv('oee', l, at)
            kp.append(st.names[l] + ' score: not enough data' if v is None else
                      st.names[l] + ' score in the hour to ' + hhmm(at) + ': ' + F.add(st.names[l] + ' overall score', self.disp('oee', v), kpis.fmt('oee', v), self.disp('oee', slow_kv(st, 'oee', l, at))))
        lt = [self.lens_text(eng.lenses(l, a, b, now)) for l in (0, 1)]
        rc = self.row_cap(rows)
        bt = self.bucket_trend([0, 1], max(0, a - 120), b, self.meas_f('oee'))
        return {'kind': 'answer', 'intent': 'happened', 'text': 'For ' + label + ' - ' + '. '.join(parts) + '. ' + '. '.join(kp) + '.', 'facts': F.facts,
                'queried': [{'table': 'downtime_events', 'filter': 'both lines, ' + iso_ts(a) + ' to ' + iso_ts(b), 'rows': rc['total']},
                            {'table': 'minute_readings', 'filter': 'both lines, same range', 'rows': 2 * (b - a + 1)}],
                'raw': {'table': 'downtime_events', 'cols': ['id', 'line', 'start', 'minutes', 'reason', 'type', 'comment'], 'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': bt, 'trendInfo': {'name': 'Overall score', 'unit': '%', 'note': 'Hourly score with 2 hours before. Per ' + ('hour' if bt['step'] == 60 else '15 min') + '.'},
                'lens': {'before': lt[0]['before'] if lt[0]['before'] else lt[1]['before'], 'same': lt[0]['same'], 'past': lt[0]['past']}}

    def ans_aggregate(self, P, now):
        if not P.get('agg') or not P.get('metric'):   # the model left parts out: read them from the words
            P.update({k: v for k, v in rule_agg(P).items() if not P.get(k)})
        r = Aggregator(self.st, self.S).run(P, now)
        if r is None:
            return self.abstain('I cannot work out that kind of total from the data.', now)
        if 'mismatch' in r:
            return self.abstain('I cannot confirm this. ' + str(r['mismatch']) + ' group value(s) did not match a second way, so I do not show the answer.', now)
        P.update({k: r['agg'][k] for k in ('agg', 'metric', 'by', 'cond')})   # what was really computed
        return r

    # ------------------------------------------------------------ dispatcher
    def answer_plan(self, P, intent, now, question):
        if P.get('abstain'):
            ans = self.abstain(P['abstain']['text'], now)
        elif intent == 'why':
            ans = self.ans_why(P, now)
        elif intent == 'happened':
            ans = self.ans_happened(P, now)
        elif intent == 'shifts':
            ans = self.ans_shifts(P, now)
        elif intent == 'top':
            ans = self.ans_top(P, now)
        elif intent == 'value':
            ans = self.ans_value(P, now)
        elif intent == 'aggregate':
            ans = self.ans_aggregate(P, now)
        else:
            ans = self.abstain('I cannot answer this from the data. Ask about overall score, stopped time, speed, rejects, bottles made or preforms left, for Line 1 or Line 2.', now)
        if ans['kind'] == 'answer':
            bad = [f for f in ans['facts'] if not f['ok']]
            if bad:
                ans = dict(self.abstain('I cannot confirm this. ' + str(len(bad)) + ' number' + ('s' if len(bad) > 1 else '') + ' did not pass the check, so I do not show the answer.', now), failed=bad)
            else:
                ans['shown'] = fill_text(ans['text'], ans['facts'])
                ans['check'] = {'total': len(ans['facts']), 'ok': len(ans['facts'])}
        ans['question'] = question
        ans['parsed'] = {'lines': P.get('lines'), 'measure': P.get('measure'), 'range': P.get('range'), 'label': P.get('label'), 'day': P.get('day'), 'at': P.get('at'),
                         'explicitLine': P.get('explicitLine')}
        if intent == 'aggregate' and P.get('agg'):
            ans['parsed'].update({k: P.get(k) for k in ('agg', 'metric', 'by', 'cond')})
        return ans

    def answer(self, text, now, hist=None):
        if not text or not str(text).strip():
            ans = self.abstain('Type a question about Line 1 or Line 2.', now)
            ans['question'] = str(text or '')
            return ans
        P = self.rule_plan(str(text), now, hist)
        intent = None if P.get('abstain') else self.rule_intent(P)
        return self.answer_plan(P, intent, now, str(text))
