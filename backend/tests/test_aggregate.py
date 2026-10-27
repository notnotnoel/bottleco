"""Bug fix list (27 Oct): aggregate questions (SUM / AVG / COUNT / MIN / MAX) and the off-topic guard.

Every expected number below comes from plain SQL written here, apart from the engine.
"""
import os

import pytest

from bottleco import explorer, llm
from bottleco.alerts import scan
from bottleco.db import minute_of
from bottleco.explorer_engine import OFF_TOPIC, Explorer
from bottleco.rca import Engine
from bottleco.settings import defaults

LIVE = bool(os.environ.get('BOTTLECO_LIVE'))
IDEAL = {'L1': 200, 'L2': 90}


@pytest.fixture(scope='module')
def eng(store):
    S = defaults()
    return Engine(store, S, scan(store, S))


@pytest.fixture(scope='module')
def ex(eng):
    return Explorer(eng)


def day(d):
    """Calendar day d of Sep -> (first, last) minute, clipped to the data."""
    a = minute_of('2026-09-%02d 00:00' % d)
    return max(0, a), a + 1439


def one(store, sql, *args):
    return store.con.execute(sql, args).fetchone()[0]


def facts(ans):
    assert ans['kind'] == 'answer' and ans['intent'] == 'aggregate', ans.get('text')
    assert all(f['ok'] for f in ans['facts'])
    return [f['value'] for f in ans['facts']]


def test_count_stops(store, ex):
    a, b = day(5)
    ans = ex.answer('How many stops did Line 2 have on 5 Sep?', store.N - 1)
    want = one(store, "SELECT count(*) FROM downtime_events WHERE line_id='L2' AND planned=0 AND start_minute BETWEEN ? AND ?", a, b)
    assert facts(ans) == [want] and want > 0


def test_count_stops_for_one_reason(store, ex):
    ans = ex.answer('count of filler jam stops on line 1', store.N - 1)
    want = one(store, "SELECT count(*) FROM downtime_events WHERE line_id='L1' AND planned=0 AND reason='Filler jam'")
    assert facts(ans) == [want]


def test_average_speed_per_hour(store, ex):
    a, b = day(9)
    ans = ex.answer('What was the average speed per hour on Line 1 on 9 Sep?', store.N - 1)
    rows = store.con.execute("""SELECT sum(produced) * 1.0 / (200 * sum(state='running')) FROM minute_readings
                                WHERE line_id='L1' AND minute BETWEEN ? AND ? GROUP BY minute / 60 HAVING sum(state='running') > 0""", (a, b)).fetchall()
    want = sum(r[0] for r in rows) / len(rows) * 100
    assert facts(ans)[0] == pytest.approx(want, abs=1e-9)


def test_max_output_day(store, ex):
    ans = ex.answer('Which day had the highest output on Line 2?', store.N - 1)
    rows = store.con.execute("""SELECT day, sum(produced), count(*) FROM minute_readings WHERE line_id='L2' GROUP BY day""").fetchall()
    full = [r for r in rows if r[2] == 1440]     # part days are left out (and the answer says so)
    best = max(full, key=lambda r: r[1])
    assert facts(ans) == [best[1]]
    assert ans['facts'][0]['shown'].endswith('(%d Sep)' % int(best[0][-2:]))
    assert 'not a full day' in ans['shown']


def test_count_hours_below_limit(store, ex):
    a, b = day(10)
    ans = ex.answer('How many hours did Line 1 run below 95% speed on 10 Sep?', store.N - 1)
    rows = store.con.execute("""SELECT sum(produced) * 100.0 / (200 * sum(state='running')) FROM minute_readings
                                WHERE line_id='L1' AND minute BETWEEN ? AND ? GROUP BY minute / 60 HAVING sum(state='running') > 0""", (a, b)).fetchall()
    want = sum(1 for r in rows if r[0] < 95)
    assert facts(ans) == [want]
    assert ans['facts'][0]['shown'] == '%d of %d hours' % (want, len(rows))


def test_average_stop_minutes_per_day_both_lines(store, ex):
    ans = ex.answer('Average downtime per day for both lines', store.N - 1)
    got = facts(ans)
    for i, lid in enumerate(('L1', 'L2')):
        rows = store.con.execute("SELECT sum(state='fault'), count(*) FROM minute_readings WHERE line_id=? GROUP BY day", (lid,)).fetchall()
        full = [r[0] for r in rows if r[1] == 1440]
        assert got[i] == pytest.approx(sum(full) / len(full))


def test_average_delivery_delay(store, ex):
    ans = ex.answer('Average delivery delay on line 2', store.N - 1)
    want = one(store, "SELECT avg(arrived_minute - due_minute) FROM deliveries WHERE line_id='L2' AND arrived_minute IS NOT NULL")
    assert facts(ans)[0] == pytest.approx(want)


def test_stop_minutes_by_reason(store, ex):
    a, b = day(10)
    ans = ex.answer('Stop minutes by reason on line 1 on 10 Sep', store.N - 1)
    rows = dict(store.con.execute("""SELECT r.name, count(*) FROM minute_readings m JOIN reasons r ON r.code = m.reason_code
                                     WHERE m.line_id='L1' AND m.state='fault' AND m.minute BETWEEN ? AND ? GROUP BY r.name""", (a, b)).fetchall())
    assert facts(ans) == [sum(rows.values())]
    assert {r[0]: r[2] for r in ans['raw']['rows']} == rows


def test_lowest_hourly_score(store, ex):
    a, b = day(10)
    ans = ex.answer('Lowest hourly overall score on Line 1 on 10 Sep', store.N - 1)
    rows = store.con.execute("""SELECT (sum(produced) - sum(rejected)) * 100.0 / (200 * (count(*) - sum(state='planned'))) FROM minute_readings
                                WHERE line_id='L1' AND minute BETWEEN ? AND ? GROUP BY minute / 60 HAVING count(*) - sum(state='planned') >= 15""", (a, b)).fetchall()
    assert facts(ans)[0] == pytest.approx(min(r[0] for r in rows))


def test_ratio_is_never_added_up(store, ex):
    ans = ex.answer('sum of overall score per day on line 1', store.N - 1)
    assert ans['parsed']['agg'] == 'avg' and 'cannot be added up' in ans['shown']


def test_no_future_peek(store, ex):
    now = minute_of('2026-09-08 11:30')
    ans = ex.answer('average output per hour on line 1', now)
    rows = store.con.execute("SELECT sum(produced) FROM minute_readings WHERE line_id='L1' AND minute <= ? GROUP BY minute / 60 HAVING count(*) = 60", (now,)).fetchall()
    assert facts(ans)[0] == pytest.approx(sum(r[0] for r in rows) / len(rows))
    assert max(r[3] for r in ans['raw']['rows']) <= 60


# ---------------- off-topic guard (the chat-reset bug) ----------------
OFF = ['why is red a color', 'what is the capital of France', 'tell me a joke', 'hello', 'how do airplanes fly']


@pytest.mark.parametrize('q', OFF)
def test_off_topic_abstains(store, ex, q):
    ans = ex.answer(q, store.N - 1)
    assert ans['kind'] == 'abstain' and ans['text'] == OFF_TOPIC


def test_off_topic_in_a_chat_does_not_reuse_the_last_answer(store, ex):
    now = store.N - 1
    first = ex.answer("What's happening on line 1 now?", now)
    assert first['kind'] == 'answer'
    ans = ex.answer('why is red a color', now, [first['parsed']])
    assert ans['kind'] == 'abstain' and ans['text'] == OFF_TOPIC
    # a real short follow-up still uses the chat
    ans = ex.answer('and Line 2?', now, [first['parsed']])
    assert ans['kind'] == 'answer'


def test_model_plan_cannot_override_off_topic(eng, monkeypatch):
    """Even if the model planner reads an off-topic question as 'why' or 'happened', code abstains."""
    monkeypatch.setattr(llm, 'api_key', lambda: 'x')
    import bottleco.explorer as E

    class Fake:
        def __init__(self, intent):
            self.intent = intent

        def with_structured_output(self, *a, **k):
            return self

        def invoke(self, msgs):
            plan = E.Plan(intent=self.intent, lines=[1], measure='oee', period='now')

            class R:
                usage_metadata = {}
            return {'raw': R(), 'parsed': plan}
    for intent in ('why', 'happened', 'unclear'):
        monkeypatch.setattr(llm, 'chat', lambda *a, **k: Fake(intent))
        out = explorer.ask(eng, 'why is red a color', eng.st.N - 1, [{'q': "What's happening on line 1?", 'parsed': {'lines': [0], 'measure': 'oee'}}])
        assert out['answer']['kind'] == 'abstain' and out['answer']['text'] == OFF_TOPIC, intent


@pytest.mark.skipif(not LIVE, reason='live model test: set BOTTLECO_LIVE=1')
def test_model_planner_aggregates(eng, store):
    S = dict(defaults(), brain=0)
    out = explorer.ask(eng, 'On average, how many bottles did Line 2 make per day?', store.N - 1, [], S)
    ans = out['answer']
    rows = store.con.execute("SELECT sum(produced), count(*) FROM minute_readings WHERE line_id='L2' GROUP BY day").fetchall()
    full = [r[0] for r in rows if r[1] == 1440]
    assert ans['intent'] == 'aggregate' and ans['facts'][0]['value'] == pytest.approx(sum(full) / len(full)), out.get('plan')
    out = explorer.ask(eng, 'why is the sky blue', store.N - 1, [], S)
    assert out['answer']['text'] == OFF_TOPIC
