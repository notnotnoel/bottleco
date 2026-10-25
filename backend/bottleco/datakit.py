"""Data Kit: the only tools the agents may call.

Rules every tool follows:
1. Read-only. The database opens with mode=ro and query_only.
2. No future peek. Every tool takes `now` (a minute index). Nothing after `now` comes back.
   An event that is still running at `now` is cut at `now` and marked ongoing.
3. Every result says what it read: table, filter and row count ("queried"). The UI shows this.
4. A row limit applies (the "How much data may I read?" slider). If a result is cut, it says so.
"""
import math
from .db import Store, ts, ws, minute_of
from . import kpis
from .alerts import scan

STATE_NAMES = ('running', 'fault', 'planned')


class DataKit:
    def __init__(self, store=None, settings=None):
        from .settings import defaults
        self.store = store or Store()
        self.S = settings or defaults()
        self.N = self.store.N

    # ---------- helpers ----------
    def _line(self, line_id):
        if line_id not in self.store.lines:
            raise ValueError('Unknown line: %s. Use L1 or L2.' % line_id)
        return self.store.lines[line_id]

    def _clip(self, a, b, now):
        if now < 0 or now >= self.N:
            raise ValueError('now is outside the data')
        a, b = max(0, a), min(b, now)
        if a > b:
            raise ValueError('The time range is after "now". I cannot read the future.')
        return a, b

    @staticmethod
    def _q(table, filt, rows, cut=False):
        return {'table': table, 'filter': filt, 'rows': rows, 'cut': cut}

    # ---------- tools ----------
    def kpi_now(self, line_id, now):
        """All 5 KPIs for a line at `now`, with the limit and whether each is in breach."""
        L = self._line(line_id)
        out = []
        for key, name, what, direction, lim, scale, unit in kpis.KPIS:
            v = kpis.value(L, self.N, key, now)
            out.append({'key': key, 'name': name, 'what': what, 'value': v, 'shown': kpis.fmt(key, v),
                        'limit': self.S[lim] / scale, 'warn_when': direction, 'breach': kpis.is_breach(self.S, key, v)})
        return {'line_id': line_id, 'at': ts(now), 'kpis': out,
                'queried': [self._q('minute_readings', '%s, %s to %s' % (line_id, ts(max(0, now - 59)), ts(now)), min(60, now + 1))]}

    def kpi_series(self, line_id, key, a, b, now, step=None):
        """One KPI over a time range. Step grows so the series stays under the row limit."""
        L = self._line(line_id)
        a, b = self._clip(a, b, now)
        if key not in kpis.KEYS:
            raise ValueError('Unknown KPI: ' + key)
        lim = int(self.S['rows'])
        step = step or max(1, math.ceil((b - a + 1) / lim))
        rows = [(ts(t), kpis.value(L, self.N, key, t)) for t in range(a, b + 1, step)]
        return {'line_id': line_id, 'key': key, 'step_min': step, 'rows': rows,
                'queried': [self._q('minute_readings', '%s, %s to %s' % (line_id, ts(a), ts(b)), b - a + 1)]}

    def minutes(self, line_id, a, b, now):
        """Raw minute rows (state, speed, output, rejects, stock, torque)."""
        self._line(line_id)
        a, b = self._clip(a, b, now)
        lim = int(self.S['rows'])
        cur = self.store.con.execute(
            'SELECT ts, shift, state, reason_code, round(speed, 3) AS speed, setpoint, produced, rejected, preform_stock, '
            'round(cap_torque, 3) AS cap_torque, micro_stop FROM minute_readings '
            'WHERE line_id = ? AND minute BETWEEN ? AND ? ORDER BY minute LIMIT ?', (line_id, a, b, lim + 1))
        rows = [dict(r) for r in cur]
        cut = len(rows) > lim
        return {'rows': rows[:lim], 'queried': [self._q('minute_readings', '%s, %s to %s' % (line_id, ts(a), ts(b)), min(len(rows), lim), cut)]}

    def range_totals(self, line_id, a, b, now):
        """Totals and ratios (overall score, availability, speed, quality) for a range."""
        L = self._line(line_id)
        a, b = self._clip(a, b, now)
        r = kpis.range_stats(L, self.N, a, b)
        r.update({'line_id': line_id, 'from': ts(a), 'to': ts(b)})
        return {'totals': r, 'queried': [self._q('minute_readings', '%s, %s to %s' % (line_id, ts(a), ts(b)), b - a + 1)]}

    def downtime(self, line_id, a, b, now, planned=None):
        """Stops that overlap a..b, cut at now. Includes the operator comment as written."""
        self._line(line_id)
        a, b = self._clip(a, b, now)
        sql = ('SELECT event_id, start_minute, end_minute, minutes, planned, reason, operator_comment FROM downtime_events '
               'WHERE line_id = ? AND start_minute <= ? AND end_minute > ?')
        args = [line_id, b, a]
        if planned is not None:
            sql += ' AND planned = ?'
            args.append(1 if planned else 0)
        rows = []
        for r in self.store.con.execute(sql + ' ORDER BY start_minute', args):
            ongoing = r['end_minute'] - 1 > now
            end = now + 1 if ongoing else r['end_minute']
            rows.append({'event_id': r['event_id'], 'start': ts(r['start_minute']), 'end': ts(end), 'minutes': end - r['start_minute'],
                         'planned': bool(r['planned']), 'reason': r['reason'], 'comment': r['operator_comment'], 'ongoing': ongoing})
        return {'rows': rows, 'queried': [self._q('downtime_events', '%s, overlaps %s to %s' % (line_id, ts(a), ts(b)), len(rows))]}

    def deliveries(self, line_id, a, b, now):
        """Preform deliveries due or arrived in a..b. An arrival after now shows as 'not arrived yet'."""
        self._line(line_id)
        a, b = self._clip(a, b, now)
        rows = []
        for r in self.store.con.execute(
                'SELECT po, due_minute, arrived_minute, qty FROM deliveries WHERE line_id = ? AND '
                '((due_minute BETWEEN ? AND ?) OR (arrived_minute BETWEEN ? AND ?)) ORDER BY due_minute', (line_id, a, b, a, b)):
            arrived = r['arrived_minute'] is not None and r['arrived_minute'] <= now
            rows.append({'po': r['po'], 'due': ts(r['due_minute']), 'arrived': ts(r['arrived_minute']) if arrived else None,
                         'minutes_late': (r['arrived_minute'] - r['due_minute']) if arrived else max(0, now - r['due_minute']),
                         'still_open': not arrived, 'qty': r['qty'] if arrived else None})
        return {'rows': rows, 'queried': [self._q('deliveries', '%s, due or arrived %s to %s' % (line_id, ts(a), ts(b)), len(rows))]}

    def changes(self, line_id, a, b, now):
        """Product changeovers and speed setting changes in a..b."""
        self._line(line_id)
        a, b = self._clip(a, b, now)
        co = [dict(r) for r in self.store.con.execute(
            'SELECT start_ts, end_ts, end_minute, from_sku, to_sku FROM changeovers WHERE line_id = ? AND start_minute BETWEEN ? AND ? '
            'ORDER BY start_minute', (line_id, a, b))]
        for c in co:
            if c.pop('end_minute') - 1 > now:
                c['end_ts'], c['ongoing'] = None, True
        sp = [dict(r) for r in self.store.con.execute(
            'SELECT ts, from_pct, to_pct, note FROM setpoint_changes WHERE line_id = ? AND minute BETWEEN ? AND ? ORDER BY minute',
            (line_id, a, b))]
        return {'changeovers': co, 'setpoints': sp,
                'queried': [self._q('changeovers', '%s, %s to %s' % (line_id, ts(a), ts(b)), len(co)),
                            self._q('setpoint_changes', '%s, %s to %s' % (line_id, ts(a), ts(b)), len(sp))]}

    def defects(self, line_id, a, b, now):
        """Reject counts by defect type in a..b."""
        self._line(line_id)
        a, b = self._clip(a, b, now)
        rows = [dict(r) for r in self.store.con.execute(
            'SELECT defect, sum(count) AS count FROM defects WHERE line_id = ? AND minute BETWEEN ? AND ? GROUP BY defect ORDER BY count DESC',
            (line_id, a, b))]
        return {'rows': rows, 'queried': [self._q('defects', '%s, %s to %s' % (line_id, ts(a), ts(b)), len(rows))]}

    # ---------- look-around lenses ----------
    def normal_at(self, line_id, key, t, now):
        """Same clock time on earlier days (the 'How many days of normal' slider)."""
        L = self._line(line_id)
        if t > now:
            raise ValueError('I cannot read the future.')
        v = []
        for k in range(1, int(math.floor(self.S['baseDays'] + 0.5)) + 1):
            x = t - k * 1440
            if x < 60:
                break
            y = kpis.value(L, self.N, key, x)
            if y is not None:
                v.append(y)
        if not v:
            return None
        mean = sum(v) / len(v)
        sd = math.sqrt(sum((y - mean) ** 2 for y in v) / len(v))
        return {'mean': mean, 'sd': sd, 'n': len(v), 'values': v}

    def same_time(self, line_id, t, now):
        """Lens 2: the other signals and the other line at the same minute."""
        if t > now:
            raise ValueError('I cannot read the future.')
        return {lid: self.kpi_now(lid, t)['kpis'] for lid in self.store.lines}

    def _features(self, line_id, t):
        L = self._line(line_id)

        def v(k, d):
            x = kpis.value(L, self.N, k, t)
            return d if x is None else x

        def last_end(reason):
            e = -1
            for x in self.store.events:
                if x['line_id'] != line_id or x['reason'] != reason:
                    continue
                if x['end_minute'] - 1 <= t:
                    e = x['end_minute']
                else:
                    break
            return e
        cip, chg = last_end('CIP clean'), last_end('Changeover')
        return [v('oee', 0.85) / 0.2, v('stop', 0) / 12, v('speed', 0.93) / 0.12, v('rej', 0.009) / 0.015,
                min(360, v('cover', 360)) / 100, min(240, 240 if cip < 0 else t - cip) / 60,
                min(240, 240 if chg < 0 else t - chg) / 60, min(120, t % 480) / 60]

    def similar_past(self, line_id, t, now):
        """Lens 3: past moments (both lines) that looked most like this one. Past only: at least 3 h before t."""
        k = int(math.floor(self.S['simK'] + 0.5))
        cut = 0.3 + 0.45 * self.S['simCut'] / 100
        lim = min(now, t - 180)
        f0 = self._features(line_id, t)
        cand = []
        for o in self.store.lines:
            for u in range(120, lim + 1, 30):
                f = self._features(o, u)
                d = sum((f[i] - f0[i]) ** 2 for i in range(8))
                cand.append({'line_id': o, 't': u, 'sim': 1 / (1 + math.sqrt(d / 8))})
        cand.sort(key=lambda x: -x['sim'])
        pick = []
        for x in cand:
            if len(pick) >= max(k, 1):
                break
            if any(p['line_id'] == x['line_id'] and abs(p['t'] - x['t']) < 120 for p in pick):
                continue
            pick.append(x)
        for p in pick:
            L = self.store.lines[p['line_id']]
            p['at'] = ts(p['t'])
            p['kpis'] = {kk: kpis.value(L, self.N, kk, p['t']) for kk in kpis.KEYS}
            p['weak'] = p['sim'] < cut
            a, b = p['t'] + 1, p['t'] + 90  # what happened next; still before t - 90, so not the future
            q = ws(L.P['prd'], a, b)
            p['next'] = {'stop': ws(L.P['flt'], a, b), 'rej': ws(L.P['rj'], a, b) / q if q else None}
        return {'strong': [p for p in pick if not p['weak']], 'closest': pick[0] if pick else None, 'cut': cut, 'pool': len(cand)}

    # ---------- alerts ----------
    def alerts(self, now):
        """Alerts and incidents seen up to now."""
        return scan(self.store, self.S, upto=now)


__all__ = ['DataKit', 'ts', 'minute_of']
