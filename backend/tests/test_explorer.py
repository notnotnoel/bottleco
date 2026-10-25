"""Phase 5 gate, part 2: the Data Explorer agent (LangGraph).

Without a model the agent uses the rule reader (tested word for word in test_explorer_engine.py).
With a model (BOTTLECO_LIVE=1), Claude plans each question; code checks the plan and computes the answer.
Gate: all 30 golden questions pass the plain-SQL checks; all 10 trick questions get "not in the data".
"""
import json
import os

import pytest
from conftest import FIX
from test_explorer_engine import check_golden

from bottleco import explorer, llm
from bottleco.alerts import scan
from bottleco.db import minute_of
from bottleco.rca import Engine
from bottleco.settings import defaults

Q = json.load(open(os.path.join(FIX, 'questions.json')))
LIVE = bool(os.environ.get('BOTTLECO_LIVE'))


@pytest.fixture(scope='module')
def eng(store):
    S = defaults()
    return Engine(store, S, scan(store, S))


def run(eng, c, settings=None):
    now, chat = minute_of(c['now']), []
    for h in c.get('hist', []):
        out = explorer.ask(eng, h, now, chat, settings)
        chat.append({'q': h, 'parsed': out['answer']['parsed']})
    return explorer.ask(eng, c['q'], now, chat, settings)


def test_no_model_uses_rule_reader(eng, sql, monkeypatch):
    monkeypatch.setattr(llm, 'api_key', lambda: None)
    for c in Q['golden']:
        out = run(eng, c)
        assert out['planner'] == 'rules' and out['usage']['calls'] == 0
        check_golden(out['answer'], c, sql)
    for c in Q['trick']:
        assert run(eng, c)['answer']['kind'] == 'abstain', c['id']


@pytest.mark.skipif(not LIVE, reason='live model test: set BOTTLECO_LIVE=1')
@pytest.mark.parametrize('brain', [0, 1], ids=['haiku', 'sonnet'])
def test_model_planner_golden_and_trick(eng, sql, brain):
    S = dict(defaults(), brain=brain)
    fails, cost = [], 0.0
    for c in Q['golden']:
        out = run(eng, c, S)
        cost += out['usage']['usd']
        try:
            assert out['planner'] == 'model', out.get('plan')
            check_golden(out['answer'], c, sql)
        except AssertionError as e:
            fails.append((c['id'], str(e)[:160], out.get('plan')))
    for c in Q['trick']:
        out = run(eng, c, S)
        cost += out['usage']['usd']
        if out['answer']['kind'] != 'abstain':
            fails.append((c['id'], 'answered: ' + out['answer'].get('shown', '')[:120], out.get('plan')))
    print('\nbrain', brain, 'cost US$%.4f' % cost, 'fails', len(fails))
    for f in fails:
        print(' ', f)
    assert not fails
