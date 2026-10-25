"""Phase 3 gate: KPIs and alerts.

1. Python gives the same KPI values and alerts as the approved preview (second path).
2. At the default sliders, the 8 story events raise their expected alerts and nothing else raises.
3. Sliders change what raises (they are live, not decoration).
"""
from bottleco import kpis
from bottleco.alerts import scan
from bottleco.settings import defaults, validate

# Answer key: what each story event must raise. 'lines' lists every line that must warn.
EXPECT = {
    1: {'lines': ['L1'], 'keys': {'stop'}},          # filler jams after a clean
    2: {'lines': ['L2'], 'keys': {'rej'}},           # bad labels after a changeover
    3: {'lines': ['L1'], 'keys': {'rej'}},           # capper drift
    4: {'lines': ['L2'], 'keys': {'speed'}},         # tiny stops after the 22:00 handover
    5: {'lines': ['L2'], 'keys': {'speed'}},         # speed set lower
    6: {'lines': ['L1'], 'keys': {'cover'}},         # late preform truck
    7: {'lines': ['L1', 'L2'], 'keys': {'stop'}},    # both lines stop together
    8: {'lines': ['L2'], 'keys': {'oee', 'speed'}},  # unexplained dip (must warn; the cause must be "not clear")
}
WINDOW = 240  # an incident belongs to a story event if it starts within 4 h after it


def test_kpi_values_match_preview(store, oracle):
    step = oracle['step']
    n = 0
    for name, series in oracle['kpi'].items():
        line, key = name.split(':')
        L = store.lines[line]
        for i, want in enumerate(series):
            got = kpis.value(L, store.N, key, i * step)
            if want is None:
                assert got is None, (name, i * step)
            else:
                assert abs(got - want) < 1e-9, (name, i * step, got, want)
            n += 1
    assert n == 10 * len(oracle["kpi"]["L1:oee"]) and n > 28000


def test_alerts_match_preview_for_three_slider_sets(store, oracle):
    for case, o in oracle['scans'].items():
        got = scan(store, o['settings'])
        a = [(x['line_id'], x['key'], x['t0'], x['ta'], x['t_end']) for x in got['alerts']]
        b = [(x['line_id'], x['key'], x['t0'], x['ta'], x['t_end']) for x in o['alerts']]
        assert a == b, case
        a = [(x['line_id'], x['start'], x['end'], x['keys']) for x in got['incidents']]
        b = [(x['line_id'], x['start'], x['end'], x['keys']) for x in o['incidents']]
        assert a == b, case


def _owner(inc, story):
    for s in story:
        if inc['line_id'] in EXPECT[s['id']]['lines'] and s['minute'] <= inc['start'] <= s['minute'] + WINDOW:
            return s['id']
    return None


def test_story_events_raise_and_nothing_else(store, story):
    res = scan(store, defaults())
    owners = {}
    for inc in res['incidents']:
        sid = _owner(inc, story)
        assert sid is not None, 'Alert with no story event: %s %s %s' % (inc['line_id'], inc['start'], inc['keys'])
        owners.setdefault(sid, []).append(inc)
    for s in story:
        exp = EXPECT[s['id']]
        got = owners.get(s['id'], [])
        assert sorted({i['line_id'] for i in got}) == sorted(exp['lines']), s['id']
        keys = set().union(*(set(i['keys']) for i in got))
        assert exp['keys'] <= keys, (s['id'], keys)


def test_sliders_are_live(store):
    base = len(scan(store, defaults())['incidents'])
    assert len(scan(store, validate({'oeeLim': 75, 'speedLim': 90}))['incidents']) > base
    assert len(scan(store, validate({'stopLim': 45, 'rejLim': 8, 'speedLim': 50, 'oeeLim': 30, 'coverLim': 10}))['incidents']) < base


def test_unknown_or_wild_settings(store):
    import pytest
    with pytest.raises(KeyError):
        validate({'temperature': 1})
    assert validate({'oeeLim': 999})['oeeLim'] == 80
