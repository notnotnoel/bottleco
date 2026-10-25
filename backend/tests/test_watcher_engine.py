"""Phase 4 gate, part 1: the Python cause tests, reports, data analysis and triangulation
equal the approved preview, word for word (168 reports, 3 slider sets, 2 time points each)."""
import json
import os

import pytest
from conftest import FIX

from bottleco.alerts import scan
from bottleco.rca import Engine
from bottleco.report import analysis_for, report_for, triangulate


@pytest.fixture(scope='module')
def oracle():
    return json.load(open(os.path.join(FIX, 'preview_reports.json')))


def same(js, py, path='$'):
    """Every field the preview has must be equal in Python (floats to 1e-9). Extra Python fields are allowed."""
    if isinstance(js, dict):
        assert isinstance(py, dict), path
        for k, v in js.items():
            assert k in py, path + '.' + k + ' missing'
            same(v, py[k], path + '.' + k)
    elif isinstance(js, list):
        assert isinstance(py, (list, tuple)) and len(js) == len(py), (path, len(js), len(py) if isinstance(py, (list, tuple)) else py)
        for i, (a, b) in enumerate(zip(js, py)):
            same(a, b, '%s[%d]' % (path, i))
    elif isinstance(js, bool) or js is None or isinstance(js, str):
        assert js == py, (path, js, py)
    else:
        assert py is not None and abs(js - py) < 1e-9, (path, js, py)


@pytest.mark.parametrize('case', ['defaults', 'strict', 'full'])
def test_reports_equal_preview(store, oracle, case):
    o = oracle[case]
    S = o['settings']
    eng = Engine(store, S, scan(store, S))
    incs = {i['id']: i for i in eng.scan['incidents']}
    for x in o['reports']:
        rep = report_for(eng, incs[x['incident']], x['cap'])
        an, tri = analysis_for(eng, rep), triangulate(eng, rep)
        same(x['rep'], rep, '%s#%d@%d.rep' % (case, x['incident'], x['cap']))
        same(x['analysis'], an, '%s#%d.analysis' % (case, x['incident']))
        same(x['tri'], tri, '%s#%d.tri' % (case, x['incident']))
