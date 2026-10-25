"""Build bottleco.sqlite from the generator output (build/raw.json).

The database is the only data the agents can read. It opens read-only at run time.
The answer key (story events) is NOT written here. It goes to backend/tests/fixtures.

Times are plant local time, 'YYYY-MM-DD HH:MM'. Minute 0 = 2026-09-01 06:00.
Shifts: A 06:00-14:00, B 14:00-22:00, C 22:00-06:00.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
START = datetime(2026, 9, 1, 6, 0)
STATES = ['running', 'fault', 'planned']
SHIFTS = ['A', 'B', 'C']

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE lines (
  line_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  ideal_bpm INTEGER NOT NULL,          -- ideal bottles per minute
  preform_bay INTEGER NOT NULL         -- preforms the bay holds when full
);
CREATE TABLE shifts (code TEXT PRIMARY KEY, start_hhmm TEXT NOT NULL, end_hhmm TEXT NOT NULL);
CREATE TABLE products (line_id TEXT NOT NULL, sku TEXT NOT NULL, PRIMARY KEY (line_id, sku));
CREATE TABLE reasons (code INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE minute_readings (
  line_id TEXT NOT NULL, minute INTEGER NOT NULL, ts TEXT NOT NULL, day TEXT NOT NULL, shift TEXT NOT NULL,
  state TEXT NOT NULL,                 -- running | fault | planned
  reason_code INTEGER,                 -- reasons.code when stopped, else NULL
  speed REAL NOT NULL,                 -- produced / ideal, 0 when stopped
  setpoint REAL NOT NULL,              -- set speed as share of ideal
  produced INTEGER NOT NULL, rejected INTEGER NOT NULL,
  preform_stock INTEGER NOT NULL,      -- preforms left at end of minute
  cap_torque REAL NOT NULL,            -- Nm
  micro_stop INTEGER NOT NULL,         -- 1 = a short slowdown in this minute
  PRIMARY KEY (line_id, minute)
);
CREATE TABLE defects (
  line_id TEXT NOT NULL, minute INTEGER NOT NULL, ts TEXT NOT NULL,
  defect TEXT NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE downtime_events (
  event_id INTEGER PRIMARY KEY, line_id TEXT NOT NULL,
  start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,   -- end is exclusive
  start_ts TEXT NOT NULL, end_ts TEXT NOT NULL, minutes INTEGER NOT NULL,
  planned INTEGER NOT NULL, reason TEXT NOT NULL, operator_comment TEXT NOT NULL
);
CREATE TABLE deliveries (
  po TEXT PRIMARY KEY, line_id TEXT NOT NULL,
  due_minute INTEGER NOT NULL, due_ts TEXT NOT NULL,
  arrived_minute INTEGER, arrived_ts TEXT,  -- NULL = not arrived inside the data window
  minutes_late INTEGER, qty INTEGER
);
CREATE TABLE changeovers (
  line_id TEXT NOT NULL, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,
  start_ts TEXT NOT NULL, end_ts TEXT NOT NULL, from_sku TEXT NOT NULL, to_sku TEXT NOT NULL
);
CREATE TABLE setpoint_changes (
  line_id TEXT NOT NULL, minute INTEGER NOT NULL, ts TEXT NOT NULL,
  from_pct INTEGER NOT NULL, to_pct INTEGER NOT NULL, note TEXT NOT NULL
);
CREATE VIEW event_features AS
  SELECT event_id, line_id, start_minute, start_ts, minutes, planned, reason,
         CAST(substr(start_ts, 12, 2) AS INTEGER) AS hour,
         CASE WHEN (start_minute % 1440) < 480 THEN 'A' WHEN (start_minute % 1440) < 960 THEN 'B' ELSE 'C' END AS shift,
         CASE WHEN minutes < 5 THEN 'short' WHEN minutes < 20 THEN 'medium' ELSE 'long' END AS size
  FROM downtime_events;
CREATE INDEX ix_def ON defects (line_id, minute);
CREATE INDEX ix_evt ON downtime_events (line_id, start_minute);
CREATE INDEX ix_mr_day ON minute_readings (line_id, day);
"""


def ts(m):
    return (START + timedelta(minutes=int(m))).strftime('%Y-%m-%d %H:%M')


def build(raw_path, db_path, story_path):
    raw = json.load(open(raw_path))
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    lid = raw['line_ids']
    meta = {'seed': raw['seed'], 'days': raw['days'], 'minutes': raw['minutes'], 'start_local': raw['start_local'],
            'source': 'Bottle Co sample data, deterministic generator (data/generator/sim.js)'}
    db.executemany('INSERT INTO meta VALUES (?,?)', [(k, str(v)) for k, v in meta.items()])
    db.executemany('INSERT INTO lines VALUES (?,?,?,?)',
                   [(lid[i], raw['line_names'][i], raw['ideal'][i], raw['bay'][i]) for i in range(2)])
    db.executemany('INSERT INTO shifts VALUES (?,?,?)', [('A', '06:00', '14:00'), ('B', '14:00', '22:00'), ('C', '22:00', '06:00')])
    db.executemany('INSERT INTO products VALUES (?,?)', [(lid[i], s) for i in range(2) for s in raw['skus'][i]])
    rs = [(i + 1, 'fault', n) for i, n in enumerate(raw['faults'])] + [(11 + i, 'planned', n) for i, n in enumerate(raw['planned'])]
    db.executemany('INSERT INTO reasons VALUES (?,?,?)', rs)

    for i, L in enumerate(raw['lines']):
        rows, drows = [], []
        for m in range(raw['minutes']):
            t = ts(m)
            st = L['state'][m]
            rows.append((lid[i], m, t, t[:10], SHIFTS[(m % 1440) // 480], STATES[st], L['reason'][m] if st else None,
                         L['speed'][m], L['setpoint'][m], L['produced'][m], L['rejected'][m], L['stock'][m],
                         L['torque'][m], L['micro'][m]))
            for j, name in enumerate(raw['defects']):
                c = L['defects'][j][m]
                if c:
                    drows.append((lid[i], m, t, name, c))
        db.executemany('INSERT INTO minute_readings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows)
        db.executemany('INSERT INTO defects VALUES (?,?,?,?,?)', drows)

    db.executemany('INSERT INTO downtime_events VALUES (?,?,?,?,?,?,?,?,?,?)', [
        (e['id'], lid[e['line']], e['start'], e['end'], ts(e['start']), ts(e['end']), e['minutes'],
         1 if e['planned'] else 0, e['reason'], e['comment']) for e in raw['events']])
    arrived = {d['po']: d for d in raw['deliveries']}
    drows = []
    for s in raw['schedule']:
        d = arrived.get(s['po'])
        am = d['arrived'] if d else None
        drows.append((s['po'], lid[s['line']], s['due'], ts(s['due']), am, ts(am) if am is not None else None,
                      (am - s['due']) if am is not None else None, d['qty'] if d else None))
    db.executemany('INSERT INTO deliveries VALUES (?,?,?,?,?,?,?,?)', drows)
    db.executemany('INSERT INTO changeovers VALUES (?,?,?,?,?,?,?)', [
        (lid[c['line']], c['start'], c['end'], ts(c['start']), ts(c['end']), c['from'], c['to']) for c in raw['changeovers']])
    db.executemany('INSERT INTO setpoint_changes VALUES (?,?,?,?,?,?)', [
        (lid[s['line']], s['ts'], ts(s['ts']), s['from'], s['to'], s['note']) for s in raw['setpoints']])
    db.commit()
    db.execute('VACUUM')
    db.close()

    story = [{'id': s['id'], 'line_id': lid[s['line']], 'minute': s['at'], 'ts': ts(s['at']), 'name': s['name'],
              'cause': s['cause'], 'text': s['text']} for s in raw['story']]
    json.dump(story, open(story_path, 'w'), indent=1)
    print('wrote', db_path, os.path.getsize(db_path) // 1024, 'KB;', story_path)


if __name__ == '__main__':
    root = os.path.dirname(HERE)
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'raw.json'),
          os.path.join(HERE, 'bottleco.sqlite'),
          os.path.join(root, 'backend', 'tests', 'fixtures', 'story_events.json'))
