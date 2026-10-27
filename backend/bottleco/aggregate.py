"""Aggregate questions: SUM, AVG, COUNT, MIN, MAX over hours, shifts, days, lines or stop reasons.

Examples: "average speed per hour on Line 1 on 9 Sep", "how many stops did Line 2 have on 5 Sep",
"which day had the highest output on Line 2", "how many hours did Line 1 run below 75% speed on 10 Sep".

Every group value is computed twice: path A from the in-memory minute arrays and stop events,
path B with plain SQL on the database. The answer is shown only if both paths agree on every group.
"""
import re

from . import kpis
from .db import ts as iso_ts, ws
from .fmt import dlabel, fixed, full, hhmm, jround, num

AGGS = ('sum', 'avg', 'count', 'min', 'max')
# key: (plain name, unit, kind)   add = can be added up; ratio = a percent per group; avg_only = an average per item
METRICS = {
    'output': ('bottles made', '', 'add'),
    'rejects': ('rejected bottles', '', 'add'),
    'good': ('good bottles', '', 'add'),
    'stop_minutes': ('minutes stopped by faults', ' min', 'add'),
    'planned_minutes': ('minutes of planned stops', ' min', 'add'),
    'stop_events': ('stops (fault events)', '', 'add'),
    'oee': ('overall score', '%', 'ratio'),
    'speed': ('speed against ideal while running', '%', 'ratio'),
    'reject_rate': ('reject rate', '%', 'ratio'),
    'deliveries': ('preform deliveries', '', 'add'),
    'late_minutes': ('delivery delay', ' min', 'avg_only'),
}
BYS = ('none', 'hour', 'shift', 'day', 'line', 'reason')
BY_SIZE = {'hour': 60, 'shift': 480, 'day': 1440}
BY_PLURAL = {'hour': 'hours', 'shift': 'shifts', 'day': 'days', 'line': 'lines', 'reason': 'stop reasons', 'none': 'periods'}
OPS = {'<': 'below', '<=': 'at or below', '>': 'above', '>=': 'at or above'}
SHIFTS = ['A', 'B', 'C']
HIGHER_IS_BETTER = {'oee', 'speed', 'output', 'good', 'deliveries'}


def fmt_val(metric, v):
    if v is None:
        return '–'
    unit = METRICS[metric][1]
    if unit == '%':
        return fixed(v, 1) + '%'
    if abs(v - round(v)) < 1e-9:
        return num(v) + unit
    return '{:,.1f}'.format(float(fixed(v, 1))) + unit


def _same(a, b):
    return (a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-6)


# ------------------------------------------------------------------ rule reader
AGG_RX = r'\b(average|averages|avg|mean|typical|per (day|hour|shift)|each (day|hour|shift)|every (day|hour|shift)|by (day|hour)|daily|hourly|' \
         r'how many (stops|times|hours|days|shifts|deliveries|faults|stop events|breakdowns)|number of (stops|times|hours|days|shifts|deliveries|faults)|count|' \
         r'(highest|lowest|maximum|minimum|max|min|best|worst|peak) (day|hour|shift)|which (day|hour|shift|line)|(by|per|each) (stop )?reasons?|sum of|in total|altogether)\b'


def wants_aggregate(q):
    return bool(re.search(AGG_RX, q))


def rule_agg(P):
    """Read agg, metric, group and condition from the question words. P is the rule reader's plan."""
    q, meas = P['q'], P.get('measure')
    by = 'none'
    m = re.search(r'\b(?:per|by|each|every|which|what) (day|hour|shift|line)\b', q) or re.search(r'\b(day|hour|shift)s? (?:with|had|was)\b', q)
    if m:
        by = m.group(1)
    elif re.search(r'\bdaily\b', q):
        by = 'day'
    elif re.search(r'\bhourly\b', q):
        by = 'hour'
    elif re.search(r'\b(?:per|by|each|which|what) (?:stop )?reasons?\b', q):
        by = 'reason'
    cond = None
    c = re.search(r'\b(below|under|less than|lower than|above|over|more than|higher than|at least|at most)\s*(\d+(?:\.\d+)?)\s*(%|percent|min|minutes)?', q)
    if c:
        cond = {'op': {'below': '<', 'under': '<', 'less than': '<', 'lower than': '<', 'above': '>', 'over': '>', 'more than': '>',
                       'higher than': '>', 'at least': '>=', 'at most': '<='}[c.group(1)], 'value': float(c.group(2))}
    # what to measure
    if re.search(r'\bdeliver', q):
        metric = 'late_minutes' if re.search(r'\blate|delay', q) else 'deliveries'
    elif meas == 'stop' or re.search(r'\bstops?\b|\bbreakdowns?\b|\bfaults?\b', q):
        metric = 'stop_events' if re.search(r'how many (stops|times|faults|breakdowns|stop events)|number of (stops|faults|times)|count of stops|stops count|\bcount\b|'
                                            r'\b(most|fewest|least|more|less) (stops|faults|breakdowns)\b', q) else 'stop_minutes'
    elif meas == 'rej':
        metric = 'reject_rate' if re.search(r'\brate\b|%|percent|share', q) or cond else 'rejects'
    elif meas in ('oee', 'speed', 'output'):
        metric = meas
    elif re.search(r'\bplanned\b', q):
        metric = 'planned_minutes'
    else:
        metric = 'output'
    # how to combine
    if re.search(r'\b(average|averages|avg|mean|typical)\b', q):
        agg = 'avg'
    elif re.search(r'\b(highest|maximum|max|peak|most|biggest|largest|longest)\b', q):
        agg = 'max'
    elif re.search(r'\b(lowest|minimum|min|least|fewest|smallest|shortest)\b', q):
        agg = 'min'
    elif re.search(r'\bbest\b', q):
        agg = 'max' if metric in HIGHER_IS_BETTER else 'min'
    elif re.search(r'\bworst\b', q):
        agg = 'min' if metric in HIGHER_IS_BETTER else 'max'
    elif cond or re.search(r'\bhow many (hours|days|shifts)\b', q):
        agg = 'count'
        if by == 'none':
            hm = re.search(r'\bhow many (hours|days|shifts)\b', q)
            by = {'hours': 'hour', 'days': 'day', 'shifts': 'shift'}[hm.group(1)] if hm else 'hour'
    elif metric in ('stop_events', 'deliveries'):
        agg = 'count'
    else:
        agg = 'sum'
    if agg in ('max', 'min') and by == 'none':
        r = P.get('range')
        by = 'hour' if r and r[1] - r[0] < 1440 else 'day'
    return {'agg': agg, 'metric': metric, 'by': by, 'cond': cond}


# ------------------------------------------------------------------ engine
class Aggregator:
    def __init__(self, store, settings):
        self.st, self.S = store, settings

    def groups(self, by, a, b):
        """[(label, x, y)] covering a..b. Day = calendar day; shift = A 06-14, B 14-22, C 22-06; hour = clock hour."""
        if by not in BY_SIZE:
            return [('', a, b)]
        size, off = BY_SIZE[by], (360 if by == 'day' else 0)
        out, x = [], a
        while x <= b:
            y = min(b, ((x + off) // size + 1) * size - off - 1)
            if by == 'hour':
                lab = dlabel(x) + ' ' + hhmm(x - x % 60)
            elif by == 'shift':
                lab = dlabel(x - x % 480) + ' shift ' + SHIFTS[(x % 1440) // 480]
            else:
                lab = dlabel(x)
            out.append((lab, x, y))
            x = y + 1
        return out

    # ---- path A: minute arrays, prefix sums, event lists
    def value_a(self, metric, l, x, y, reason=None):
        st, L = self.st, self.st.L[l]
        P = L.P
        if metric == 'output':
            return ws(P['prd'], x, y)
        if metric == 'rejects':
            return ws(P['rj'], x, y)
        if metric == 'good':
            return ws(P['prd'], x, y) - ws(P['rj'], x, y)
        if metric == 'stop_minutes':
            if reason:
                code = st.fault_names.index(reason) + 1
                return sum(1 for i in range(x, y + 1) if L.st[i] == 1 and L.rid[i] == code)
            return ws(P['flt'], x, y)
        if metric == 'planned_minutes':
            return ws(P['pln'], x, y)
        if metric == 'stop_events':
            return sum(1 for e in st.evL[l] if not e['planned'] and x <= e['start'] <= y and (not reason or e['reason'] == reason))
        if metric in ('oee', 'speed', 'reject_rate'):
            r = kpis.range_stats(L, st.N, x, y)
            v = {'oee': r['oee'], 'speed': r['performance'], 'reject_rate': r['reject_rate']}[metric]
            return None if v is None else v * 100
        if metric == 'deliveries':
            return sum(1 for d in st.deliveries if d['line'] == l and x <= d['arr'] <= y)
        if metric == 'late_minutes':
            v = [d['arr'] - d['due'] for d in st.deliveries if d['line'] == l and x <= d['arr'] <= y]
            return sum(v) / len(v) if v else None
        raise ValueError(metric)

    # ---- path B: plain SQL
    def value_b(self, metric, l, x, y, reason=None):
        con, lid, ideal = self.st.con, self.st.ids[l], self.st.ideal[l]
        if metric in ('output', 'rejects', 'good', 'stop_minutes', 'planned_minutes', 'oee', 'speed', 'reject_rate'):
            code = self.st.fault_names.index(reason) + 1 if reason else -1
            prd, rj, run, flt, pln, n, flt_r = con.execute(
                "SELECT coalesce(sum(produced),0), coalesce(sum(rejected),0), coalesce(sum(state='running'),0), coalesce(sum(state='fault'),0), "
                "coalesce(sum(state='planned'),0), count(*), coalesce(sum(state='fault' AND reason_code=?),0) "
                'FROM minute_readings WHERE line_id=? AND minute BETWEEN ? AND ?', (code, lid, x, y)).fetchone()
            return {'output': lambda: prd, 'rejects': lambda: rj, 'good': lambda: prd - rj,
                    'stop_minutes': lambda: flt_r if reason else flt, 'planned_minutes': lambda: pln,
                    'oee': lambda: (prd - rj) / (ideal * (n - pln)) * 100 if n - pln >= 15 else None,
                    'speed': lambda: prd / (ideal * run) * 100 if run > 0 else None,
                    'reject_rate': lambda: rj / prd * 100 if prd > 0 else None}[metric]()
        if metric == 'stop_events':
            q = 'SELECT count(*) FROM downtime_events WHERE line_id=? AND planned=0 AND start_minute BETWEEN ? AND ?' + (' AND reason=?' if reason else '')
            return con.execute(q, (lid, x, y) + ((reason,) if reason else ())).fetchone()[0]
        if metric == 'deliveries':
            return con.execute('SELECT count(*) FROM deliveries WHERE line_id=? AND arrived_minute BETWEEN ? AND ?', (lid, x, y)).fetchone()[0]
        if metric == 'late_minutes':
            return con.execute('SELECT avg(arrived_minute - due_minute) FROM deliveries WHERE line_id=? AND arrived_minute BETWEEN ? AND ?', (lid, x, y)).fetchone()[0]
        raise ValueError(metric)

    @staticmethod
    def _ok(cond, v):
        if v is None:
            return False
        o, c = cond['op'], float(cond['value'])
        return {'<': v < c, '<=': v <= c, '>': v > c, '>=': v >= c}.get(o, False)

    def _combine(self, agg, cond, use, idx):
        """use = [(label, va, vb)]; idx 1 = path A, 2 = path B. Returns (value, picked label)."""
        vals = [u for u in use if u[idx] is not None]
        if agg == 'count':
            return (len([u for u in vals if self._ok(cond, u[idx])]), None) if cond else (sum(u[idx] for u in vals), None)
        if agg == 'sum':
            return sum(u[idx] for u in vals), None
        if agg == 'avg':
            return (sum(u[idx] for u in vals) / len(vals), None) if vals else (None, None)
        if not vals:
            return None, None
        pick = (min if agg == 'min' else max)(vals, key=lambda u: u[idx])
        return pick[idx], pick[0]

    def run(self, P, now):
        st = self.st
        agg, metric, by = P.get('agg') or 'sum', P.get('metric') or 'output', P.get('by') or 'none'
        if agg not in AGGS or metric not in METRICS or by not in BYS:
            return None
        reason = P.get('reason') if P.get('reason') in st.fault_names else None
        cond = P.get('cond') if P.get('cond') and P['cond'].get('op') in OPS else None
        notes = []
        kind = METRICS[metric][2]
        if by == 'reason' and metric not in ('stop_minutes', 'stop_events'):
            metric, kind = 'stop_minutes', 'add'
        if agg == 'sum' and kind != 'add':
            agg = 'avg'
            notes.append('A ' + METRICS[metric][0] + ' cannot be added up, so I show the average.')
        if agg == 'count' and not cond and metric not in ('stop_events', 'deliveries'):
            agg = 'sum'
        if agg in ('avg', 'min', 'max') and by == 'none' and kind == 'add':
            by = 'hour'
        if agg == 'count' and cond and by in ('none', 'line', 'reason'):
            by = 'hour'
        lines = P.get('lines') or [0, 1]
        a, b = P.get('range') or [0, now]
        b = min(b, now)
        a = max(0, a)
        name, unit = METRICS[metric][0], METRICS[metric][1]
        what = name + (' for "' + reason + '"' if reason else '')

        # ---- group values, two ways
        per_line = []
        for l in lines:
            if by == 'reason':
                vals = [(r, a, b, self.value_a(metric, l, a, b, r), self.value_b(metric, l, a, b, r)) for r in st.fault_names]
                vals = [v for v in vals if v[3] or v[4]]
            else:
                vals = [(lab, x, y, self.value_a(metric, l, x, y, reason), self.value_b(metric, l, x, y, reason)) for lab, x, y in self.groups(by, a, b)]
            per_line.append((l, vals))
        if by == 'line':
            per_line = [(None, [(st.names[l], a, b, v[0][3], v[0][4]) for l, v in per_line])]
        bad = sum(1 for _, vals in per_line for v in vals if not _same(v[3], v[4]))
        if bad:
            return {'mismatch': bad}

        # ---- leave out part-groups for avg / min / max / count-if, when full groups exist
        size = BY_SIZE.get(by)
        if size and agg in ('avg', 'min', 'max', 'count') and (agg != 'count' or cond):
            cut = []
            for i, (l, vals) in enumerate(per_line):
                full_g = [v for v in vals if v[2] - v[1] + 1 == size]
                if full_g and len(full_g) < len(vals):
                    cut += [v[0] for v in vals if v[2] - v[1] + 1 < size]
                    per_line[i] = (l, full_g)
            if cut:
                cut = list(dict.fromkeys(cut))
                notes.append('I left out ' + ', '.join(cut[:3]) + (' and %d more' % (len(cut) - 3) if len(cut) > 3 else '') +
                             ' because ' + ('it is' if len(cut) == 1 else 'they are') + ' not a full ' + by + ' in the data.')

        facts, parts, rows, series = [], [], [], []
        for l, vals in per_line:
            lname = 'Both lines' if l is None else st.names[l]
            for lab, x, y, va, vb in vals:
                rows.append([lab, lname if l is not None else '–', None if va is None else round(va, 2), y - x + 1])
            use = [(lab, va, vb) for lab, x, y, va, vb in vals]
            ra, pa = self._combine(agg, cond, use, 1)
            rb, pb = self._combine(agg, cond, use, 2)
            n_ok = len([u for u in use if u[1] is not None])
            if agg == 'count' and cond:
                shown = num(ra) + ' of ' + num(n_ok) + ' ' + BY_PLURAL[by]
            elif agg == 'count':
                shown = num(ra)
            else:
                shown = fmt_val(metric, ra) + (' (' + pa + ')' if pa else '')
            fid = 'f%d' % (len(facts) + 1)
            facts.append({'id': fid, 'label': lname + ': ' + agg + ' of ' + what, 'value': 0 if ra is None else ra, 'shown': shown,
                          'check': 0 if rb is None else rb, 'ok': _same(ra, rb) and pa == pb})
            parts.append(('' if l is None else lname + ' ') + '{{' + fid + '}}')
            if by in BY_SIZE:
                series.append({'name': lname, 'line': l, 'pts': [[x, va] for lab, x, y, va, vb in vals]})

        per = {'none': '', 'hour': ' per hour', 'shift': ' per shift', 'day': ' per day', 'line': ' across the lines', 'reason': ' by stop reason'}[by]
        if agg == 'count' and cond:
            head = 'Number of ' + BY_PLURAL[by] + ' with ' + what + ' ' + OPS[cond['op']] + ' ' + fmt_val(metric, float(cond['value']))
        elif agg == 'count':
            head = 'Number of ' + what
        else:
            word = {'sum': 'Total', 'avg': 'Average', 'min': 'Lowest', 'max': 'Highest'}[agg]
            head = word + ' ' + what + ('' if agg == 'sum' else per)
        label = P.get('label') or ('all data up to now (' + full(now) + ')')
        lead = None
        if by == 'line' and agg in ('min', 'max') and facts and facts[0]['ok']:
            sv = sorted([(v[3], v[0]) for v in per_line[0][1] if v[3] is not None], reverse=(agg == 'max'))
            if sv:
                lead = sv[0][1] + ' had the ' + ('most ' if agg == 'max' else 'fewest ') + what if metric in ('stop_events', 'deliveries') else \
                    sv[0][1] + ' had the ' + ('highest ' if agg == 'max' else 'lowest ') + what
                lead += ': ' + '; '.join(n + ' ' + fmt_val(metric, v) for v, n in sv) + '.'
        text = head + ', ' + label + ': ' + '; '.join(parts) + '.' + (' ' + ' '.join(notes) if notes else '')
        cap = jround(self.S['rows'])
        table = {'stop_events': 'downtime_events', 'deliveries': 'deliveries', 'late_minutes': 'deliveries'}.get(metric, 'minute_readings')
        ucol = unit.strip()
        return {
            'kind': 'answer', 'intent': 'aggregate', 'text': text, 'facts': facts,
            'queried': [{'table': table,
                         'filter': ' + '.join(st.ids[l] for l in lines) + ', ' + iso_ts(a) + ' to ' + iso_ts(b) + (', reason ' + reason if reason else '') +
                         ', ' + agg.upper() + ' over ' + (str(len(rows)) + ' ' + BY_PLURAL[by] if by != 'none' else 'the whole range'),
                         'rows': len(rows)}],
            'raw': {'table': ('one row per ' + by if by != 'none' else 'one row') + ' (' + table + ')', 'cols': ['group', 'line', name + (' (' + ucol + ')' if ucol else ''), 'minutes'],
                    'rows': rows[:cap], 'total': len(rows), 'cut': len(rows) > cap},
            'trend': {'series': series, 'step': BY_SIZE[by]} if series else None,
            'trendInfo': {'name': name[0].upper() + name[1:], 'unit': unit, 'note': 'One point per ' + by + '. Code and plain SQL agree on every point.'} if series else None,
            'lens': None, 'lead': lead,
            'agg': {'agg': agg, 'metric': metric, 'by': by, 'cond': cond, 'reason': reason},
        }
