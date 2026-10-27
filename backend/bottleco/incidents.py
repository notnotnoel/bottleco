"""Incident questions: "What incident had the highest impact on production?", "Which stop was the longest?"

Two kinds, picked from the words:
- warning incidents (the Line Watcher's RCA pills): ranked by bottles lost = ideal output - good bottles
  in the incident time, planned stops left out.
- single stops (unplanned stop events): ranked by bottles not made = stopped minutes x ideal rate, or by minutes for "longest".
Every number is computed twice (minute arrays and plain SQL). Only data up to `now` is read.
"""
import re

from . import kpis
from .db import ts as iso_ts, ws
from .fmt import dlabel, fixed, full, hhmm, jround, num

NOUN_RX = r'\b(incidents?|events?|stoppages?|outages?|breakdowns?|disruptions?|problems?|issues?|warnings?|alerts?|rcas?|stops?|downtimes?)\b'
RANK_RX = r'\b(highest|biggest|largest|most|worst|longest|major|main|top|greatest|costliest|impact\w*|hurt|severe\w*)\b'
STOP_RX = r'\b(stops?|stoppages?|outages?|breakdowns?|downtimes?)\b'


def wants_incident(q):
    """A question that asks to pick the biggest incident (not a stop reason or defect type)."""
    if re.search(r'\b(reasons?|types?|kinds?|defects?|causes?|shifts?|days?|hours?|happen\w*|went on|going on)\b', q):
        return False
    if not re.search(NOUN_RX, q) or re.search(r'\b(which|what)\s+(lines?|days?|hours?|shifts?|machines?)\b', q):
        return False
    return bool(re.search(RANK_RX, q)) or bool(re.search(r'\b(which|what)\s+(incident|event|stop|outage|breakdown|problem|issue|warning|alert)\b', q))


def _mins(v):
    v = int(v)
    return str(v) + ' min' if v < 60 else (str(v // 60) + ' h ' + str(v % 60).zfill(2) + ' min' if v % 60 else str(v // 60) + ' h')


class Incidents:
    def __init__(self, ex):
        self.ex, self.st, self.eng = ex, ex.st, ex.eng

    # ---- bottles lost in [a, b]: ideal output (planned minutes left out) minus good bottles
    def lost_a(self, l, a, b):
        L = self.st.L[l]
        n, pln = b - a + 1, ws(L.P['pln'], a, b)
        return L.ideal * (n - pln) - (ws(L.P['prd'], a, b) - ws(L.P['rj'], a, b)), L.ideal * (n - pln)

    def lost_b(self, l, a, b):
        prd, rj, pln, n = self.st.con.execute("SELECT sum(produced), sum(rejected), sum(state='planned'), count(*) FROM minute_readings "
                                              'WHERE line_id=? AND minute BETWEEN ? AND ?', (self.st.ids[l], a, b)).fetchone()
        return self.st.ideal[l] * (n - pln) - (prd - rj)

    def run(self, P, now):
        q = P['q']
        lines = P.get('lines') or [0, 1]
        a, b = P.get('range') or [0, now]
        b = min(b, now)
        if re.search(STOP_RX, q) and not re.search(r'\b(incidents?|warnings?|alerts?|rcas?)\b', q):
            return self.stops(P, lines, a, b, now)
        return self.warnings(P, lines, a, b, now)

    # ---------------------------------------------------------------- warning incidents (RCA pills)
    def warnings(self, P, lines, a, b, now):
        st, ex = self.st, self.ex
        label = P.get('label') or ('all data up to now (' + full(now) + ')')
        incs = [i for i in self.eng.scan['incidents'] if i['line'] in lines and i['start'] <= b and i['start'] >= a]
        if not incs:
            return ex.abstain('There was no warning incident on ' + (' or '.join(st.names[l] for l in lines)) + ' in ' + label +
                              '. So no incident had an impact. Ask about stopped time or bottles made instead.', now)
        rows = []
        for i in incs:
            x, y = i['t0'], min(i['end'], now)
            lost, ideal = self.lost_a(i['line'], x, y)
            rows.append({'inc': i, 'x': x, 'y': y, 'lost': lost, 'ideal': ideal, 'chk': self.lost_b(i['line'], x, y)})
        rows.sort(key=lambda r: -r['lost'])
        top = rows[0]
        i, l = top['inc'], top['inc']['line']
        F = ex.Facts()
        f_lost = F.add('Bottles lost in RCA %d' % i['id'], top['lost'], num(top['lost']) + ' bottles', top['chk'])
        share = top['lost'] / top['ideal'] * 100 if top['ideal'] else 0
        f_share = F.add('Share of ideal output lost in RCA %d' % i['id'], share, fixed(share, 0) + '%', top['chk'] / top['ideal'] * 100 if top['ideal'] else 0)
        title = st.names[l] + ' · ' + kpis.PLAIN[i['alerts'][0]['key']]
        r = self.eng.rca_incident(i)
        cause = ('Most likely cause: ' + r['top']['name'] + '.') if r['cause'] else 'The cause is not clear from the data.'
        live = i['end'] >= now
        lead = ('The incident with the highest impact was RCA %d, %s, from %s to %s%s. It cost %s against ideal output (%s of the ideal output in that time). %s'
                % (i['id'], title, full(top['x']), (hhmm(top['y']) if dlabel(top['y']) == dlabel(top['x']) else full(top['y'])),
                   ' (still on)' if live else '', f_lost, f_share, cause))
        nxt = []
        for k in rows[1:3]:
            fid = F.add('Bottles lost in RCA %d' % k['inc']['id'], k['lost'], num(k['lost']) + ' bottles', k['chk'])
            nxt.append('RCA %d, %s (%s)' % (k['inc']['id'], st.names[k['inc']['line']] + ' · ' + kpis.PLAIN[k['inc']['alerts'][0]['key']], fid))
        text = ('How I ranked: %d warning incident%s (RCA pills) in %s, by bottles lost = ideal output minus good bottles in the incident time, with planned stops left out. '
                % (len(rows), '' if len(rows) == 1 else 's', label) + ('Next: ' + '; '.join(nxt) + '.' if nxt else 'It was the only incident.'))
        raw = [['RCA %d' % k['inc']['id'], st.ids[k['inc']['line']], iso_ts(k['x']), iso_ts(k['y']), k['y'] - k['x'] + 1, int(k['lost']),
                float(fixed(k['lost'] / k['ideal'] * 100, 1)) if k['ideal'] else None, kpis.PLAIN[k['inc']['alerts'][0]['key']]] for k in rows]
        rc = ex.row_cap(raw)
        bt = ex.bucket_trend([l], max(0, top['x'] - 120), min(now, top['y'] + 120), ex.meas_f('oee'))
        return {'kind': 'answer', 'intent': 'incident', 'lead': lead, 'text': text, 'facts': F.facts,
                'queried': [{'table': 'incidents (Line Watcher warnings)', 'filter': ' + '.join(st.ids[x] for x in lines) + ', started ' + iso_ts(a) + ' to ' + iso_ts(b), 'rows': len(rows)},
                            {'table': 'minute_readings', 'filter': 'produced, rejected, planned minutes in each incident time', 'rows': sum(k['y'] - k['x'] + 1 for k in rows)}],
                'raw': {'table': 'incidents, biggest impact first', 'cols': ['incident', 'line', 'from', 'to', 'minutes', 'bottles lost', '% of ideal lost', 'warning'],
                        'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': bt, 'trendInfo': {'name': 'Overall score', 'unit': '%', 'note': st.names[l] + ', RCA %d with 2 hours before and after.' % i['id']},
                'lens': None}

    # ---------------------------------------------------------------- single stop events
    def stops(self, P, lines, a, b, now):
        st, ex = self.st, self.ex
        label = P.get('label') or ('all data up to now (' + full(now) + ')')
        by_min = bool(re.search(r'\b(longest|long)\b', P['q']))
        evs = []
        for l in lines:
            for e in st.evL[l]:
                if e['planned'] or e['start'] > b or e['start'] < a:
                    continue
                y = min(e['end'] - 1, now)
                m = y - e['start'] + 1
                evs.append({'e': e, 'l': l, 'y': y, 'min': m, 'lost': m * st.ideal[l]})
        if not evs:
            return ex.abstain('There was no unplanned stop on ' + (' or '.join(st.names[l] for l in lines)) + ' in ' + label + '.', now)
        evs.sort(key=lambda r: -(r['min'] if by_min else r['lost']))
        top = evs[0]
        e, l = top['e'], top['l']
        chk_min = st.con.execute("SELECT count(*) FROM minute_readings WHERE line_id=? AND state='fault' AND minute BETWEEN ? AND ?", (st.ids[l], e['start'], top['y'])).fetchone()[0]
        F = ex.Facts()
        f_min = F.add('Minutes stopped in stop %d' % e['id'], top['min'], _mins(top['min']), chk_min)
        f_lost = F.add('Bottles not made in stop %d' % e['id'], top['lost'], num(top['lost']) + ' bottles', chk_min * st.ideal[l])
        lead = ('The %s stop was on %s: "%s" from %s to %s. It lasted %s, so about %s were not made (at the ideal %d bottles per minute).%s'
                % ('longest' if by_min else 'biggest', st.names[l], e['reason'], full(e['start']), hhmm(top['y'] + 1), f_min, f_lost, st.ideal[l],
                   (' Operator note: "' + e['comment'] + '".') if len((e['comment'] or '').strip('?. ')) > 2 else ''))
        nxt = ['%s, %s on %s (%s)' % (st.names[k['l']], k['e']['reason'], dlabel(k['e']['start']), _mins(k['min'])) for k in evs[1:3]]
        text = ('How I ranked: %d unplanned stop%s in %s, by %s. Planned stops (breaks, cleaning, changeovers) are left out. '
                % (len(evs), '' if len(evs) == 1 else 's', label, 'minutes stopped' if by_min else 'bottles not made = minutes stopped x ideal rate') +
                ('Next: ' + '; '.join(nxt) + '.' if nxt else ''))
        raw = [[k['e']['id'], st.ids[k['l']], iso_ts(k['e']['start']), k['min'], k['lost'], k['e']['reason'], k['e']['comment']] for k in evs]
        rc = ex.row_cap(raw)
        bt = ex.bucket_trend([l], max(0, e['start'] - 120), min(now, top['y'] + 120), ex.meas_f('oee'))
        return {'kind': 'answer', 'intent': 'incident', 'lead': lead, 'text': text, 'facts': F.facts,
                'queried': [{'table': 'downtime_events', 'filter': ' + '.join(st.ids[x] for x in lines) + ', ' + iso_ts(a) + ' to ' + iso_ts(b) + ', unplanned only', 'rows': len(evs)},
                            {'table': 'minute_readings', 'filter': 'fault minutes in the top stop (second count)', 'rows': top['min']}],
                'raw': {'table': 'downtime_events, ' + ('longest' if by_min else 'biggest') + ' first', 'cols': ['id', 'line', 'start', 'minutes', 'bottles not made', 'reason', 'comment'],
                        'rows': rc['rows'], 'total': rc['total'], 'cut': rc['cut']},
                'trend': bt, 'trendInfo': {'name': 'Overall score', 'unit': '%', 'note': st.names[l] + ', the stop with 2 hours before and after.'},
                'lens': None}
