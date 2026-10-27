"""Phase 5 gate, part 1: the Data Explorer answer engine.

1. Same as the approved preview, word for word (52 questions x 2 slider sets).
2. Golden questions: the numbers equal independent plain-SQL results; "why" names the known cause.
3. Trick questions: the Explorer says the answer is not in the data (abstains).
"""
import json
import os
import sqlite3

import pytest
from conftest import DB, FIX
from test_watcher_engine import same

from bottleco.alerts import scan
from bottleco.db import minute_of
from bottleco.explorer_engine import Explorer
from bottleco.rca import Engine
from bottleco.settings import defaults

Q = json.load(open(os.path.join(FIX, 'questions.json')))


@pytest.fixture(scope='module')
def oracle():
    return json.load(open(os.path.join(FIX, 'preview_answers.json')))


def explorer(store, S):
    return Explorer(Engine(store, S, scan(store, S)))


def ask(ex, c):
    now, hist = minute_of(c['now']), []
    for h in c.get('hist', []):
        hist.append(ex.answer(h, now, list(hist))['parsed'])
    return ex.answer(c['q'], now, hist)


# "hello" now gets the off-topic answer (the preview gave a general "cannot answer" text).
from bottleco.explorer_engine import OFF_TOPIC  # noqa: E402
CHANGED = {'X09': OFF_TOPIC, 'T04': 'I do not know who: the data has no names of people.'}   # T04: plainer 'do not know' text (28 Oct)


@pytest.mark.parametrize('case', ['defaults', 'full'])
def test_answers_equal_preview(store, oracle, case):
    o = oracle[case]
    ex = explorer(store, o['settings'])
    cases = {c['id']: c for c in Q['golden'] + Q['trick'] + Q['extra']}
    for x in o['answers']:
        a = ask(ex, cases[x['id']])
        if x['id'] in CHANGED:   # intended change since the preview (bug fix list, 27 Oct)
            assert a['kind'] == 'abstain' and a['text'] == CHANGED[x['id']], (x['id'], a['text'])
            continue
        same(x['ans'], a, '%s.%s' % (case, x['id']))


# ---------------- golden questions: independent plain SQL ----------------
IDEAL = {'L1': 200, 'L2': 90}


def window(c):
    """The time window the question means, worked out without the engine."""
    now = minute_of(c['now'])
    if c.get('day'):
        a, b = max(0, minute_of(c['day'] + ' 00:00')), minute_of(c['day'] + ' 23:59')
    elif c.get('last_minutes'):
        a, b = now - c['last_minutes'] + 1, now
    elif c.get('this_shift'):
        a, b = (now // 480) * 480, now
    elif c.get('today'):
        a, b = max(0, minute_of(c['now'][:10] + ' 00:00')), now
    else:
        a, b = 0, now
    return max(0, a), min(b, now)


def measure_sql(con, line, measure, a, b):
    r = con.execute("""SELECT sum(produced), sum(rejected), sum(state = 'running'), sum(state = 'fault'), sum(state = 'planned'), count(*)
                       FROM minute_readings WHERE line_id = ? AND minute BETWEEN ? AND ?""", (line, a, b)).fetchone()
    prd, rj, run, flt, pln, n = r
    return {'oee': (prd - rj) / (IDEAL[line] * (n - pln)) * 100, 'output': prd, 'rej': rj / prd * 100, 'stop': flt,
            'speed': prd / (IDEAL[line] * run) * 100}[measure], (prd, rj)


def fact(ans, label):
    f = [x for x in ans['facts'] if x['label'] == label]
    assert f, (label, [x['label'] for x in ans['facts']])
    return f[0]['value']


NAMES = {'oee': 'overall score', 'output': 'bottles made', 'rej': 'rejects', 'stop': 'stopped time', 'speed': 'speed'}


def check_golden(ans, c, con):
    assert ans['kind'] == 'answer', (c['id'], ans['text'])
    assert ans['intent'] == c['kind'], (c['id'], ans['intent'])
    a, b = window(c)
    now = minute_of(c['now'])
    if c['kind'] == 'value':
        lines = ['L1', 'L2'] if c['line'] == 'both' else [c['line']]
        for line in lines:
            nm = 'Line ' + line[1]
            if c['measure'] == 'cover':
                stock, = con.execute('SELECT preform_stock FROM minute_readings WHERE line_id = ? AND minute = ?', (line, now)).fetchone()
                got = fact(ans, nm + ' preforms left')
                rows = con.execute("SELECT sum(state = 'running'), sum(produced) FROM minute_readings WHERE line_id = ? AND minute BETWEEN ? AND ?",
                                   (line, now - 29, now)).fetchone()
                pace = max(20, rows[1] / rows[0]) if rows[0] >= 5 else IDEAL[line] * 0.85
                assert abs(got - stock / pace) < 1e-6, c['id']
                continue
            want, (prd, rj) = measure_sql(con, line, c['measure'], a, b)
            assert abs(fact(ans, nm + ' ' + NAMES[c['measure']]) - want) < 1e-6, (c['id'], line)
            if c['measure'] == 'rej':
                assert fact(ans, nm + ' rejected bottles') == rj and fact(ans, nm + ' bottles made') == prd
    elif c['kind'] == 'top':
        lines = ('L1', 'L2') if c['line'] == 'both' else (c['line'],)
        ph = ','.join('?' * len(lines))
        if c['what'] == 'defect':
            rows = con.execute('SELECT defect, sum(count) s FROM defects WHERE line_id IN (%s) AND minute BETWEEN ? AND ? GROUP BY defect ORDER BY s DESC' % ph, (*lines, a, b)).fetchall()
        else:
            rows = con.execute("""SELECT r.name, count(*) s FROM minute_readings m JOIN reasons r ON r.code = m.reason_code
                                  WHERE m.state = 'fault' AND m.line_id IN (%s) AND m.minute BETWEEN ? AND ? GROUP BY r.name ORDER BY s DESC""" % ph, (*lines, a, b)).fetchall()
        assert [ans['ranking'][0][0], ans['ranking'][0][1]] == [rows[0][0], rows[0][1]], (c['id'], ans['ranking'][:2], rows[:2])
        if c.get('expect_top'):
            assert rows[0][0] == c['expect_top']
    elif c['kind'] == 'shifts':
        lines = ['L1', 'L2'] if not c.get('line') else [c['line']]
        for line in lines:
            for i, sname in enumerate('ABC'):
                r = con.execute("""SELECT sum(produced) - sum(rejected), count(*) - sum(state = 'planned') FROM minute_readings
                                   WHERE line_id = ? AND shift = ? AND minute BETWEEN ? AND ? AND minute < ? """,
                                (line, sname, (a // 480) * 480, b, ((b + 1) // 480) * 480)).fetchone()
                want = r[0] / (IDEAL[line] * r[1]) * 100
                assert abs(fact(ans, 'Line %s shift %s' % (line[1], sname)) - want) < 1e-6, (c['id'], line, sname)
    elif c['kind'] == 'happened':
        assert any(row[4] == c['expect_reason'] for row in ans['raw']['rows']), c['id']
    elif c['kind'] == 'why':
        assert ans['cause'] == c['expect_cause'], (c['id'], ans['cause'])
        if c['expect_cause'] is None:
            assert ans['verdict']['kind'] in ('unclear', 'normal')
    assert ans['check']['ok'] == ans['check']['total']


@pytest.fixture(scope='module')
def ex(store):
    return explorer(store, defaults())


@pytest.mark.parametrize('c', Q['golden'], ids=[c['id'] for c in Q['golden']])
def test_golden_rule_reader(ex, sql, c):
    check_golden(ask(ex, c), c, sql)


@pytest.mark.parametrize('c', Q['trick'], ids=[c['id'] for c in Q['trick']])
def test_trick_questions_abstain(ex, c):
    ans = ask(ex, c)
    assert ans['kind'] == 'abstain', (c['id'], ans.get('shown') or ans['text'])
    assert ans['facts'] == [] and ans['raw'] is None
