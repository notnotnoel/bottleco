"""Phase 2 gate: the SQLite file is complete and its totals match plain SQL checks."""
import sqlite3

import pytest
from conftest import DB


@pytest.fixture(scope='module')
def con():
    c = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    yield c
    c.close()


def one(con, sql, *a):
    return con.execute(sql, a).fetchone()[0]


def test_every_minute_is_there(con):
    assert one(con, 'SELECT count(*) FROM minute_readings') == 2 * 14 * 1440
    for line in ('L1', 'L2'):
        assert one(con, 'SELECT count(DISTINCT minute) FROM minute_readings WHERE line_id = ?', line) == 20160
        assert one(con, 'SELECT min(ts) FROM minute_readings WHERE line_id = ?', line) == '2026-09-01 06:00'
        assert one(con, 'SELECT max(ts) FROM minute_readings WHERE line_id = ?', line) == '2026-09-15 05:59'


def test_l1_10_sep_overall_score(con, oracle):
    # Plain SQL: good bottles / (ideal rate x minutes not planned), calendar day 10 Sep.
    v = one(con, """SELECT (sum(produced) - sum(rejected)) * 1.0 / (200 * (count(*) - sum(state = 'planned')))
                    FROM minute_readings WHERE line_id = 'L1' AND day = '2026-09-10'""")
    assert round(v * 100, 1) == 51.8
    assert abs(v - oracle['day']['L1:2026-09-10']) < 1e-12


def test_every_day_score_matches_preview(con, oracle):
    for key, want in oracle['day'].items():
        line, day = key.split(':')
        ideal = 200 if line == 'L1' else 90
        got = one(con, """SELECT (sum(produced) - sum(rejected)) * 1.0 / (? * (count(*) - sum(state = 'planned')))
                          FROM minute_readings WHERE line_id = ? AND day = ?""", ideal, line, day)
        assert abs(got - want) < 1e-12, key


def test_totals_match_generator(con, raw):
    for i, line in enumerate(('L1', 'L2')):
        L = raw['lines'][i]
        assert one(con, 'SELECT sum(produced) FROM minute_readings WHERE line_id = ?', line) == sum(L['produced'])
        assert one(con, 'SELECT sum(rejected) FROM minute_readings WHERE line_id = ?', line) == sum(L['rejected'])
        assert one(con, 'SELECT sum(count) FROM defects WHERE line_id = ?', line) == sum(sum(d) for d in L['defects'])


def test_stop_events_match_minutes(con):
    # Every stopped minute belongs to exactly one downtime event, and every event minute is stopped.
    for line in ('L1', 'L2'):
        stopped = one(con, "SELECT count(*) FROM minute_readings WHERE line_id = ? AND state != 'running'", line)
        assert one(con, 'SELECT sum(minutes) FROM downtime_events WHERE line_id = ?', line) == stopped
        bad = one(con, """SELECT count(*) FROM downtime_events e JOIN minute_readings m
                          ON m.line_id = e.line_id AND m.minute >= e.start_minute AND m.minute < e.end_minute
                          WHERE e.line_id = ? AND m.state != CASE e.planned WHEN 1 THEN 'planned' ELSE 'fault' END""", line)
        assert bad == 0


def test_rejects_never_exceed_output(con):
    assert one(con, 'SELECT count(*) FROM minute_readings WHERE rejected > produced') == 0
    assert one(con, "SELECT count(*) FROM minute_readings WHERE state != 'running' AND produced > 0") == 0


def test_shifts(con):
    assert one(con, "SELECT shift FROM minute_readings WHERE ts = '2026-09-10 06:00' AND line_id = 'L1'") == 'A'
    assert one(con, "SELECT shift FROM minute_readings WHERE ts = '2026-09-10 14:00' AND line_id = 'L1'") == 'B'
    assert one(con, "SELECT shift FROM minute_readings WHERE ts = '2026-09-10 22:00' AND line_id = 'L1'") == 'C'
    assert one(con, "SELECT shift FROM minute_readings WHERE ts = '2026-09-11 05:59' AND line_id = 'L1'") == 'C'


def test_late_preform_truck_is_in_the_data(con):
    # Story 6 must come from the data itself: PO due 05:00 on 10 Sep, about 14 h 40 min late.
    r = con.execute("SELECT po, minutes_late FROM deliveries WHERE line_id = 'L1' AND due_ts = '2026-09-10 05:00'").fetchone()
    assert r == ('PO-1027', 880)


def test_answer_key_is_not_in_the_agent_database(con):
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert not any('story' in n or 'cause' in n for n in names)


def test_database_is_read_only(store):
    with pytest.raises(sqlite3.OperationalError):
        store.con.execute("DELETE FROM lines")
