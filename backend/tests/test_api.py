"""Phase 6 gate (API): the endpoints the React app uses, and the guards."""
import pytest
from fastapi.testclient import TestClient

from bottleco import api as A
from bottleco.db import minute_of


@pytest.fixture(scope='module')
def c():
    return TestClient(A.app)


def test_meta_and_day(c):
    m = c.get('/api/meta').json()
    assert m['N'] == 20160 and len(m['sliders']) == 23 and len(m['kpis']) == 5 and len(m['moments']) == 8
    assert all('cause' not in x for x in m['moments'])          # the answer key never reaches the app
    d = c.get('/api/day/9').json()
    assert d['from'] == 9 * 1440 and len(d['lines'][0]['st']) == 1440 and set(d['lines'][0]['kpi']) == {'oee', 'stop', 'speed', 'rej', 'cover'}
    assert c.get('/api/day/99').status_code == 404


def test_day_kpis_equal_engine(c):
    from bottleco import kpis
    d = c.get('/api/day/9').json()
    L = A.STORE.L[0]
    for i in range(0, 1440, 37):
        v = kpis.value(L, A.STORE.N, 'cover', 9 * 1440 + i)
        got = d['lines'][0]['kpi']['cover'][i]
        assert (v is None and got is None) or abs(got - v) < 1e-5


def test_watch_shows_only_the_past(c):
    now = minute_of('2026-09-10 09:00')
    w = c.post('/api/watch', json={'now': now, 'settings': {}}).json()
    assert w['incidents'] and all(i['start'] <= now and i['end'] <= now for i in w['incidents'])
    assert all(a['ta'] <= now and a['tEnd'] <= now for a in w['alerts'])
    assert [i['cause'] for i in w['incidents']][-1] == 'late_supply'


def test_report_is_refused_before_its_warning(c):
    now = minute_of('2026-09-10 08:00')       # the preform warning (RCA 6) starts at 08:04
    assert c.post('/api/report', json={'now': now, 'id': 6, 'settings': {}}).status_code == 404
    r = c.post('/api/report', json={'now': now + 10, 'id': 6, 'settings': {}}).json()
    assert r['cause'] == 'late_supply' and r['analysis']['checks']['ok'] == r['analysis']['checks']['total']
    assert all(isinstance(x, str) for x in r['lens']['past'])


def test_bad_input_is_refused(c):
    assert c.post('/api/watch', json={'now': 10 ** 6, 'settings': {}}).status_code == 400
    assert c.post('/api/watch', json={'now': 100, 'settings': {'temperature': 1}}).status_code == 400


def test_no_model_mode_when_cap_is_reached(c, monkeypatch):
    monkeypatch.setattr(A, 'DAILY_USD', 0.0)
    A._hits.clear()
    r = c.post('/api/ask', json={'now': minute_of('2026-09-14 05:59'), 'question': 'What was Line 1 overall score on 10 Sep?', 'settings': {'wording': 50}}).json()
    assert r['planner'] == 'rules' and r['usage']['calls'] == 0 and r['note'] and r['kind'] == 'answer'


def test_rate_limit(c, monkeypatch):
    monkeypatch.setattr(A, 'DAILY_USD', 0.0)
    monkeypatch.setattr(A, 'ASK_PER_10_MIN', 2)
    A._hits.clear()
    codes = [c.post('/api/ask', json={'now': 5000, 'question': 'Stopped time on Line 1 on 3 Sep', 'settings': {}}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    A._hits.clear()


def test_stream_sends_steps_then_answer(c, monkeypatch):
    monkeypatch.setattr(A, 'DAILY_USD', 0.0)
    A._hits.clear()
    with c.stream('POST', '/api/ask/stream', json={'now': 5000, 'question': 'What happened at 10:30 on 3 Sep?', 'settings': {}}) as s:
        events = [line.split(': ', 1)[1] for line in s.iter_lines() if line.startswith('event: ')]
    assert events[0] == 'step' and events[-1] == 'answer' and events.count('step') >= 3
