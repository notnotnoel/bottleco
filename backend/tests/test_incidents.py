"""Bug fix (28 Oct): answer the question asked, lead with the direct answer.

"What incident had the highest impact on production?" used to get a total of bottles made.
Expected numbers below come from plain SQL written here.
"""
import pytest

from bottleco import explorer, llm
from bottleco.alerts import scan
from bottleco.db import minute_of
from bottleco.explorer_engine import Explorer
from bottleco.rca import Engine
from bottleco.settings import defaults

NOW = '2026-09-11 15:33'


@pytest.fixture(scope='module')
def eng(store):
    S = defaults()
    return Engine(store, S, scan(store, S))


@pytest.fixture(scope='module')
def ex(eng):
    return Explorer(eng)


def lost_sql(store, lid, a, b):
    prd, rj, pln, n, ideal = store.con.execute("""SELECT sum(produced), sum(rejected), sum(state='planned'), count(*), l.ideal_bpm
        FROM minute_readings m JOIN lines l USING(line_id) WHERE line_id=? AND minute BETWEEN ? AND ?""", (lid, a, b)).fetchone()
    return ideal * (n - pln) - (prd - rj)


def test_highest_impact_incident(store, eng, ex):
    now = minute_of(NOW)
    ans = ex.answer('What incident had the highest impact on production?', now)
    assert ans['kind'] == 'answer' and ans['intent'] == 'incident'
    best = max((lost_sql(store, store.ids[i['line']], i['t0'], min(i['end'], now)), i['id']) for i in eng.scan['incidents'] if i['start'] <= now)
    assert ans['lead_shown'].startswith('The incident with the highest impact was RCA %d' % best[1])
    assert ans['facts'][0]['value'] == best[0] and all(f['ok'] for f in ans['facts'])
    assert 'Late preform delivery' in ans['lead_shown']


def test_longest_stop(store, ex):
    now = minute_of(NOW)
    ans = ex.answer('Which stop was the longest on line 2?', now)
    rows = store.con.execute("""SELECT start_minute, min(end_minute - 1, ?) - start_minute + 1 FROM downtime_events
                                WHERE line_id='L2' AND planned=0 AND start_minute <= ?""", (now, now)).fetchall()
    want = max(r[1] for r in rows)
    assert ans['intent'] == 'incident' and ans['facts'][0]['value'] == want
    assert ans['lead_shown'].startswith('The longest stop was on Line 2')


def test_which_line_most_stops_leads_with_the_line(store, ex):
    ans = ex.answer('Which line had the most stops?', minute_of(NOW))
    n = dict(store.con.execute("SELECT line_id, count(*) FROM downtime_events WHERE planned=0 AND start_minute <= ? GROUP BY line_id", (minute_of(NOW),)).fetchall())
    top = max(n, key=n.get)
    assert ans['lead_shown'].startswith('Line %s had the most stops' % top[1])


def test_unknown_which_says_do_not_know(ex):
    ans = ex.answer('Which operator made the most bottles?', minute_of(NOW))
    assert ans['lead_shown'].startswith('I do not know which operator')


def test_events_question_still_lists_events(ex):
    assert ex.answer('What events happened on 10 Sep?', minute_of(NOW))['intent'] == 'happened'


def test_model_plan_value_is_rerouted(eng, monkeypatch):
    """Even if the model planner reads the incident question as a total, code answers the question asked."""
    monkeypatch.setattr(llm, 'api_key', lambda: 'x')
    import bottleco.explorer as E

    class Fake:
        def with_structured_output(self, *a, **k):
            return self

        def invoke(self, msgs):
            class R:
                usage_metadata = {}
            return {'raw': R(), 'parsed': E.Plan(intent='value', measure='output', period='all')}
    monkeypatch.setattr(llm, 'chat', lambda *a, **k: Fake())
    out = explorer.ask(eng, 'What incident had the highest impact on production?', minute_of(NOW), [])
    assert out['answer']['intent'] == 'incident' and out['answer']['lead_shown'].startswith('The incident with the highest impact')


def test_model_aggregate_without_pick_still_picks_the_line(eng, monkeypatch):
    monkeypatch.setattr(llm, 'api_key', lambda: 'x')
    import bottleco.explorer as E

    class Fake:
        def with_structured_output(self, *a, **k):
            return self

        def invoke(self, msgs):
            class R:
                usage_metadata = {}
            return {'raw': R(), 'parsed': E.Plan(intent='aggregate', aggregate='count stop_events none none', period='all')}
    monkeypatch.setattr(llm, 'chat', lambda *a, **k: Fake())
    out = explorer.ask(eng, 'Which line had the most stops?', minute_of(NOW), [])
    assert out['answer']['lead_shown'].startswith('Line 1 had the most stops'), out['answer'].get('shown')
