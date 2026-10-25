"""Read-only access to bottleco.sqlite, plus the minute arrays and prefix sums the KPIs use."""
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta

DEFAULT_DB = os.environ.get('BOTTLECO_DB', os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'bottleco.sqlite'))
START = datetime(2026, 9, 1, 6, 0)
LINES = ('L1', 'L2')


def connect(path=DEFAULT_DB):
    """Open the database read-only. Any write raises sqlite3.OperationalError."""
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(path + ' (run: python data/build_db.py)')
    con = sqlite3.connect('file:' + path + '?mode=ro', uri=True, check_same_thread=False)
    con.execute('PRAGMA query_only = ON')
    con.row_factory = sqlite3.Row
    return con


def ts(m):
    return (START + timedelta(minutes=int(m))).strftime('%Y-%m-%d %H:%M')


def minute_of(text):
    """'2026-09-10 08:04' -> minute index."""
    return int((datetime.strptime(text, '%Y-%m-%d %H:%M') - START).total_seconds() // 60)


@dataclass
class Line:
    line_id: str
    ideal: int
    bay: int
    st: list = field(default_factory=list)       # 0 running, 1 fault, 2 planned
    rid: list = field(default_factory=list)
    sp: list = field(default_factory=list)
    prod: list = field(default_factory=list)
    rej: list = field(default_factory=list)
    stock: list = field(default_factory=list)
    tor: list = field(default_factory=list)
    mic: list = field(default_factory=list)
    setp: list = field(default_factory=list)
    dc: list = field(default_factory=list)      # reject counts per minute, one list per defect type
    P: dict = field(default_factory=dict)        # prefix sums


class Store:
    """Loads each line's minute data once. Read-only."""

    def __init__(self, path=DEFAULT_DB):
        self.path = path
        self.con = connect(path)
        meta = {r['key']: r['value'] for r in self.con.execute('SELECT key, value FROM meta')}
        self.N = int(meta['minutes'])
        self.lines = {}
        smap = {'running': 0, 'fault': 1, 'planned': 2}
        for r in self.con.execute('SELECT line_id, ideal_bpm, preform_bay FROM lines ORDER BY line_id'):
            L = Line(r['line_id'], r['ideal_bpm'], r['preform_bay'])
            for x in self.con.execute('SELECT state, reason_code, speed, produced, rejected, preform_stock, cap_torque, micro_stop, setpoint '
                                      'FROM minute_readings WHERE line_id = ? ORDER BY minute', (L.line_id,)):
                L.st.append(smap[x[0]]); L.rid.append(x[1] or 0); L.sp.append(x[2]); L.prod.append(x[3]); L.rej.append(x[4])
                L.stock.append(x[5]); L.tor.append(x[6]); L.mic.append(x[7]); L.setp.append(x[8])
            L.P = self._prefix(L)
            self.lines[L.line_id] = L
        if any(len(L.st) != self.N for L in self.lines.values()):
            raise ValueError('minute_readings is incomplete')
        self.events = [dict(r) for r in self.con.execute('SELECT * FROM downtime_events ORDER BY line_id, start_minute')]
        # Index-based views (0 = L1, 1 = L2) used by the cause tests and reports.
        self.ids = list(self.lines)
        self.L = [self.lines[k] for k in self.ids]
        self.names = [r['name'] for r in self.con.execute('SELECT name FROM lines ORDER BY line_id')]
        self.ideal = [L.ideal for L in self.L]
        self.defect_names = ['Underfill', 'Label misaligned', 'Cap torque out of spec', 'Foreign particle', 'Damaged bottle']
        self.fault_names = [r[0] for r in self.con.execute("SELECT name FROM reasons WHERE kind = 'fault' ORDER BY code")]
        self.planned_names = [r[0] for r in self.con.execute("SELECT name FROM reasons WHERE kind = 'planned' ORDER BY code")]
        for i, L in enumerate(self.L):
            L.dc = [[0] * self.N for _ in self.defect_names]
            for m, d, c in self.con.execute('SELECT minute, defect, count FROM defects WHERE line_id = ?', (L.line_id,)):
                L.dc[self.defect_names.index(d)][m] = c
        ix = {k: i for i, k in enumerate(self.ids)}
        self.evL = [[], []]
        for e in self.events:
            self.evL[ix[e['line_id']]].append({'start': e['start_minute'], 'end': e['end_minute'], 'minutes': e['minutes'],
                                               'planned': bool(e['planned']), 'reason': e['reason'], 'comment': e['operator_comment']})
        self.cipL = [[e for e in a if e['reason'] == 'CIP clean'] for a in self.evL]
        self.chgL = [[e for e in a if e['reason'] == 'Changeover'] for a in self.evL]
        INF = 10 ** 9
        self.sched = [{'line': ix[r['line_id']], 'due': r['due_minute'], 'arr': r['arrived_minute'] if r['arrived_minute'] is not None else INF,
                       'po': r['po'], 'qty': r['qty']} for r in self.con.execute('SELECT * FROM deliveries ORDER BY due_minute')]
        self.deliveries = sorted([d for d in self.sched if d['arr'] < INF], key=lambda d: d['arr'])
        self.changeovers = [{'line': ix[r['line_id']], 'start': r['start_minute'], 'end': r['end_minute'], 'from': r['from_sku'], 'to': r['to_sku']}
                            for r in self.con.execute('SELECT * FROM changeovers ORDER BY start_minute')]
        self.setpoints = [{'line': ix[r['line_id']], 'ts': r['minute'], 'from': r['from_pct'], 'to': r['to_pct'], 'note': r['note']}
                          for r in self.con.execute('SELECT * FROM setpoint_changes ORDER BY rowid')]

    def _prefix(self, L):
        keys = ('run', 'flt', 'pln', 'prd', 'rj', 'mc', 'tor')
        P = {k: [0.0] * (len(L.st) + 1) for k in keys}
        for i, s in enumerate(L.st):
            P['run'][i + 1] = P['run'][i] + (s == 0)
            P['flt'][i + 1] = P['flt'][i] + (s == 1)
            P['pln'][i + 1] = P['pln'][i] + (s == 2)
            P['prd'][i + 1] = P['prd'][i] + L.prod[i]
            P['rj'][i + 1] = P['rj'][i] + L.rej[i]
            P['mc'][i + 1] = P['mc'][i] + (s == 0 and L.mic[i] == 1)
            P['tor'][i + 1] = P['tor'][i] + L.tor[i]
        return P


def ws(a, x, y):
    """Sum of a prefix-summed series over minutes x..y (inclusive)."""
    return a[y + 1] - a[x]
