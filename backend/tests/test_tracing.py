"""LangSmith tracing: off by default; when on, each question and each RCA report sends one named trace.

A small local HTTP server stands in for LangSmith (no key, no network). The app runs in a child
process with LANGSMITH_TRACING=true pointed at it, so the env settings are read fresh.
"""
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from bottleco import tracing

HERE = os.path.dirname(os.path.abspath(__file__))

CHILD = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
from bottleco.api import app
from bottleco.settings import defaults
c = TestClient(app)
S = dict(defaults(), wording=0)
r = c.post('/api/ask', json={'question': 'What incident had the highest impact on production?', 'now': 14853, 'settings': S, 'chat': []})
assert r.status_code == 200, r.text
inc = c.post('/api/scan', json={'settings': S}).json()['incidents'][0]
r2 = c.post('/api/report', json={'settings': S, 'now': inc['end'], 'id': inc['id']})
assert r2.status_code == 200, r2.text
print(json.dumps({'intent': r.json().get('intent')}))
'''


class Sink(BaseHTTPRequestHandler):
    got = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        Sink.got.append((self.path, body))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')

    def do_GET(self):   # /info
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')

    def log_message(self, *a):
        pass


def test_off_by_default():
    assert tracing.enabled() is False
    with tracing.step('x') as o:      # no-op, no error
        o['a'] = 1
    tracing.flush()


def test_traces_are_sent_when_on():
    Sink.got = []
    srv = HTTPServer(('127.0.0.1', 0), Sink)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    env = dict(os.environ, LANGSMITH_TRACING='true', LANGSMITH_API_KEY='test-key', LANGSMITH_PROJECT='bottleco-test',
               LANGSMITH_ENDPOINT='http://127.0.0.1:%d' % srv.server_port, BOTTLECO_DAILY_USD='0')   # spend cap 0 = no model calls, no network
    for k in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'):
        env.pop(k, None)
    env['NO_PROXY'] = '127.0.0.1,localhost'
    p = subprocess.run([sys.executable, '-c', CHILD, os.path.dirname(HERE)], env=env, capture_output=True, text=True, timeout=180)
    srv.shutdown()
    assert p.returncode == 0, p.stderr[-2000:]
    blob = b' '.join(b for _, b in Sink.got)
    for name in (b'Data Explorer', b'"plan"', b'"check"', b'"answer"', b'"write"', b'Line Watcher RCA', b'investigate', b'triangulate'):
        assert name in blob, (name, [p for p, _ in Sink.got])
    assert b'test-key' not in blob   # the key goes in a header, never in the trace


def test_langsmith_down_never_stalls_an_answer():
    child = r'''
import sys, time, logging
logging.disable(logging.CRITICAL)
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
from bottleco.api import app
from bottleco.settings import defaults
c = TestClient(app)
S = dict(defaults(), wording=0)
c.post('/api/ask', json={'question': 'How is Line 1 doing now?', 'now': 14853, 'settings': S, 'chat': []})
t = time.time()
r = c.post('/api/ask', json={'question': 'Which line had the most stops?', 'now': 14853, 'settings': S, 'chat': []})
assert r.status_code == 200
print(time.time() - t)
'''
    env = dict(os.environ, LANGSMITH_TRACING='true', LANGSMITH_API_KEY='k', LANGSMITH_ENDPOINT='http://127.0.0.1:9', BOTTLECO_DAILY_USD='0')
    for k in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'):
        env.pop(k, None)
    p = subprocess.run([sys.executable, '-c', child, os.path.dirname(HERE)], env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr[-1500:]
    assert float(p.stdout.strip().splitlines()[-1]) < 3.0   # flush waits at most 2 s
