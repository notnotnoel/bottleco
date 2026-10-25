"""Phase 4 gate, part 2: the Line Watcher agent.

- Every report passes the number check.
- At the moment each warning fires (no future data), the top cause equals the known cause
  for the 7 story events that have one, and story event 8 gives "not clear".
- The text number check catches added, dropped and changed numbers.
"""
import os

import pytest

from bottleco import numcheck
from bottleco.alerts import scan
from bottleco.rca import Engine
from bottleco.settings import defaults
from bottleco.watcher import run

KNOWN = {1: 'startup_after_cip', 2: 'after_changeover', 3: 'capper_drift', 4: 'shift_handover',
         5: 'setpoint_lowered', 6: 'late_supply', 7: 'plant_wide', 8: None}


@pytest.fixture(scope='module')
def eng(store):
    S = defaults()
    return Engine(store, S, scan(store, S))


def _story_of(inc, story):
    for s in story:
        if s['minute'] <= inc['start'] <= s['minute'] + 240 and (inc['line_id'] == s['line_id'] or s['id'] == 7):
            return s['id']
    return None


def test_causes_at_alert_time(store, story, eng):
    seen, got = [], {}
    for inc in eng.scan['incidents']:
        out = run(store, inc['start'], seen=seen, engine=eng)   # the agent sees data up to the alert minute only
        seen = out['seen']
        assert not out['held'], [h['number_check'] for h in out['held']]
        for rep in out['reports']:
            got.setdefault(_story_of(rep_inc(eng, rep), story), []).append(rep)
    assert sorted(k for k in got) == list(range(1, 9))
    for sid, reps in got.items():
        for rep in reps:
            assert rep['cause'] == KNOWN[sid], (sid, rep['title'], rep['cause'])
            if KNOWN[sid] is None:
                assert rep['causeLine'].startswith('The cause is not clear')
                assert rep['triangulation']['level'] == 'weak'
            else:
                assert rep['triangulation']['proven']
    assert len(got[7]) == 2, 'story 7 must warn on both lines'


def rep_inc(eng, rep):
    return next(i for i in eng.scan['incidents'] if i['id'] == rep['id'])


def test_every_report_passes_the_number_check(store, eng):
    out = run(store, store.N - 1, engine=eng)
    assert len(out['reports']) == len(eng.scan['incidents']) and not out['held']
    for rep in out['reports']:
        assert rep['number_check']['ok']
        assert rep['analysis']['checks']['ok'] == rep['analysis']['checks']['total']
        assert all(f['ok'] for f in rep['facts'])
        assert '{{' not in rep['text']['lead']
        assert rep['wording']['mode'] == 'template'          # default wording = code templates, no model call
    assert out['usage']['calls'] == 0


def test_no_report_before_its_warning(store, eng):
    first = eng.scan['incidents'][0]['start']
    out = run(store, first - 1, engine=eng)
    assert out['reports'] == []


def test_text_number_check():
    src = 'Line 1 has preforms for 41 min. The warning level is 45 min. PO-1027 was due 05:00. Rejects 1.6%. Made 12,345.'
    ok, _ = numcheck.check(src, 'Preforms on Line 1 last 41 min, under the 45 min level. Order PO-1027 (due 05:00) is late. Rejects: 1.6%. Output 12,345.')
    assert ok
    assert not numcheck.check(src, src.replace('41', '42'))[0]                       # changed
    assert not numcheck.check(src, src.replace(' Made 12,345.', ''))[0]               # dropped
    assert not numcheck.check(src, src + ' About 3 trucks are late.')[0]             # added
    assert not numcheck.check(src, src + ' Two trucks are late.')[0]                 # number in words
    assert not numcheck.check(src, src.replace('PO-1027', 'PO-1028'))[0]             # wrong order number


@pytest.mark.skipif(not os.environ.get('BOTTLECO_LIVE'), reason='live model test: set BOTTLECO_LIVE=1 (costs a few cents)')
def test_model_wording_keeps_numbers(store, eng):
    S = dict(defaults(), wording=60, brain=0, think=20)
    inc = eng.scan['incidents'][5]   # late preform truck
    out = run(store, inc['start'], settings=S, seen=[i['id'] for i in eng.scan['incidents'][:5]], engine=eng)
    rep = out['reports'][0]
    assert rep['wording']['mode'] == 'model', rep['wording']
    print('\nMODEL TEXT:', rep['text']['body'], '\nUSAGE:', out['usage'])
