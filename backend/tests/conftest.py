import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
FIX = os.path.join(HERE, 'fixtures')
DB = os.path.join(HERE, '..', '..', 'data', 'bottleco.sqlite')


@pytest.fixture(scope='session')
def store():
    from bottleco.db import Store
    return Store(DB)


@pytest.fixture(scope='session')
def kit(store):
    from bottleco.datakit import DataKit
    return DataKit(store)


@pytest.fixture(scope='session')
def oracle():
    return json.load(open(os.path.join(FIX, 'preview_oracle.json')))


@pytest.fixture(scope='session')
def story():
    return json.load(open(os.path.join(FIX, 'story_events.json')))


@pytest.fixture(scope='session')
def raw():
    p = os.path.join(HERE, '..', '..', 'data', 'build', 'raw.json')
    if not os.path.exists(p):
        pytest.skip('data/build/raw.json missing (run: node data/export.mjs)')
    return json.load(open(p))
