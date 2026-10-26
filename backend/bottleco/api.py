"""BottleCo API (FastAPI). The app holds the clock; every request says what "now" is.

GET  /api/meta            constants, sliders, KPI list, story moments (for the time bar)
GET  /api/day/{c}         one day of minute data + the 5 KPIs per minute (server computes them)
POST /api/scan            all warning start times (for prev/next and markers; navigation only)
POST /api/watch           Line Watcher: warnings and RCA pills up to now
POST /api/report          one full RCA report at now (summary, data analysis, triangulation)
POST /api/ask             Data Explorer answer (JSON)
POST /api/ask/stream      the same, as server-sent events: one event per agent step, then the answer

Guards: read-only data, settings checked, a per-visitor rate limit on questions, and a daily spend cap.
When the cap is reached, the agents keep working without the model (rule reader + code wording).
"""
import json
import math
import os
import threading
import time
from collections import OrderedDict, defaultdict, deque
from datetime import date

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import explorer as explorer_agent
from . import kpis, llm
from .alerts import scan
from .db import Store, ts
from .explorer_engine import SAMPLE_Q, Explorer
from .fmt import full, hhmm
from .rca import Engine
from .report import analysis_for, fill_text, report_for, triangulate
from .settings import slider_list, validate
from .wording import reword

DAILY_USD = float(os.environ.get('BOTTLECO_DAILY_USD', '2.0'))
ASK_PER_10_MIN = int(os.environ.get('BOTTLECO_ASK_LIMIT', '30'))

app = FastAPI(title='BottleCo API', version='0.6.0')
app.add_middleware(GZipMiddleware, minimum_size=1000)
_origins = [o for o in os.environ.get('BOTTLECO_ORIGINS', '').split(',') if o]   # e.g. https://noel.sg when the page is hosted apart
if _origins:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=['GET', 'POST'], allow_headers=['content-type'])
STORE = Store()
_lock = threading.Lock()


# ---------------------------------------------------------------- guards
class Spend:
    def __init__(self):
        self.day, self.usd = date.today(), 0.0

    def left(self):
        if date.today() != self.day:
            self.day, self.usd = date.today(), 0.0
        return DAILY_USD - self.usd

    def add(self, usd):
        self.left()
        self.usd += usd


SPEND = Spend()
_hits = defaultdict(deque)


def visitor(request):
    """The visitor's address. Behind Cloudflare and Cloud Run the direct peer is a proxy, so use their headers."""
    h = request.headers
    ip = h.get('cf-connecting-ip') or (h.get('x-forwarded-for') or '').split(',')[0].strip()
    return ip or (request.client.host if request.client else 'x')


def rate_ok(ip):
    q, now = _hits[ip], time.time()
    while q and q[0] < now - 600:
        q.popleft()
    if len(q) >= ASK_PER_10_MIN:
        return False
    q.append(now)
    return True


def model_allowed(S):
    """Model calls only when a key exists and today's cap has room. Otherwise: no-model mode."""
    if not llm.api_key() or SPEND.left() <= 0:
        return False
    return True


# ---------------------------------------------------------------- caches
class Ctx:
    """One settings set: engine (full scan), explorer, cached pill summaries and reports."""

    def __init__(self, S):
        self.S = S
        self.eng = Engine(STORE, S, scan(STORE, S))
        self.ex = Explorer(self.eng)
        self.ex.S = S
        self.summary = {}
        self.reports = {}


_ctx = OrderedDict()


def ctx_for(settings):
    try:
        S = validate(settings or {})
    except KeyError as e:
        raise HTTPException(400, str(e))
    key = json.dumps(S, sort_keys=True)
    with _lock:
        if key in _ctx:
            _ctx.move_to_end(key)
            return _ctx[key]
        c = Ctx(S)
        _ctx[key] = c
        while len(_ctx) > 12:
            _ctx.popitem(last=False)
        return c


_days = {}


def clamp_now(now):
    if now is None or not (0 <= now < STORE.N):
        raise HTTPException(400, 'now must be a minute inside the data (0 to %d)' % (STORE.N - 1))
    return int(now)


def clean(o):
    """JSON-safe copy (no NaN/inf)."""
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    return o


# ---------------------------------------------------------------- endpoints
class Body(BaseModel):
    settings: dict = Field(default_factory=dict)
    now: int | None = None


class ReportBody(Body):
    id: int


class AskBody(Body):
    question: str = ''
    chat: list = Field(default_factory=list)


@app.get('/api/health')
def health():
    return {'ok': True, 'model': bool(llm.api_key()), 'spend_left_usd': round(SPEND.left(), 4)}


@app.get('/api/meta')
def meta():
    story = json.load(open(os.path.join(os.path.dirname(__file__), 'moments.json')))
    return {'N': STORE.N, 'days': STORE.N // 1440, 'start': '2026-09-01 06:00', 'lines': STORE.ids, 'names': STORE.names,
            'ideal': STORE.ideal, 'bay': [L.bay for L in STORE.L], 'faults': STORE.fault_names, 'planned': STORE.planned_names,
            'defects': STORE.defect_names, 'shifts': ['A', 'B', 'C'], 'sliders': slider_list(),
            'kpis': [{'key': k[0], 'name': k[1], 'what': k[2], 'dir': k[3], 'lim': k[4], 'scale': k[5], 'unit': k[6]} for k in kpis.KPIS],
            'plain': kpis.PLAIN, 'moments': story, 'samples': SAMPLE_Q, 'models': llm.MODELS}


@app.get('/api/day/{c}')
def day(c: int):
    """Minute data for minutes c*1440 .. c*1440+1439 (a 06:00-to-06:00 block), both lines, plus KPIs per minute."""
    if not (0 <= c < STORE.N // 1440):
        raise HTTPException(404, 'no such day')
    if c not in _days:
        a, b = c * 1440, c * 1440 + 1440
        out = {'c': c, 'from': a, 'lines': []}
        for L in STORE.L:
            d = {'st': L.st[a:b], 'rid': L.rid[a:b], 'sp': [round(x, 4) for x in L.sp[a:b]], 'prod': L.prod[a:b], 'rej': L.rej[a:b], 'stock': L.stock[a:b],
                 'setp': [round(x * 100) for x in L.setp[a:b]], 'kpi': {}}
            for k in kpis.KEYS:
                d['kpi'][k] = [None if v is None else round(v, 6) for v in (kpis.value(L, STORE.N, k, t) for t in range(a, b))]
            out['lines'].append(d)
        _days[c] = clean(out)
    return _days[c]


@app.post('/api/scan')
def scan_all(body: Body):
    c = ctx_for(body.settings)
    return {'incidents': [{'id': i['id'], 'line': i['line'], 'start': i['start'], 't0': i['t0'], 'end': i['end']} for i in c.eng.scan['incidents']]}


def summary(c, inc):
    if inc['id'] not in c.summary:
        r = c.eng.rca_incident(inc)
        c.summary[inc['id']] = {'title': STORE.names[inc['line']] + ' · ' + kpis.PLAIN[inc['alerts'][0]['key']],
                                'cause': r['cause'], 'causeName': r['top']['name'] if r['cause'] else None}
    return c.summary[inc['id']]


@app.post('/api/watch')
def watch(body: Body):
    """Warnings up to now. Same as a scan that stops at now (tested: the alerts are a prefix of the full scan)."""
    c, now = ctx_for(body.settings), clamp_now(body.now)
    alerts = [{'line': a['line'], 'key': a['key'], 'ta': a['ta'], 't0': a['t0'], 'live': a['t_end'] >= now,
               'tEnd': min(a['t_end'], now)} for a in c.eng.scan['alerts'] if a['ta'] <= now]
    incs = []
    for i in c.eng.scan['incidents']:
        if i['start'] > now:
            continue
        s = summary(c, i)
        incs.append({'id': i['id'], 'line': i['line'], 'start': i['start'], 't0': i['t0'], 'live': i['end'] >= now,
                     'end': min(i['end'], now), 'first': i['first'], **s})
    return {'now': now, 'alerts': alerts, 'incidents': incs}


@app.post('/api/report')
def report(body: ReportBody):
    c, now = ctx_for(body.settings), clamp_now(body.now)
    inc = next((i for i in c.eng.scan['incidents'] if i['id'] == body.id), None)
    if not inc or inc['start'] > now:
        raise HTTPException(404, 'no such report at this time')
    key = (body.id, now)
    if key in c.reports:
        return c.reports[key]
    rep = report_for(c.eng, inc, now)
    an, tri = analysis_for(c.eng, rep), triangulate(c.eng, rep)
    st, l, o = STORE, rep['line'], 1 - rep['line']
    scale = 100 if rep['key'] in ('oee', 'speed', 'rej') else 1
    x0, x1 = max(60, rep['on'] - 240), min(now, max(rep['ta'], inc['end']) + 180)
    pts, pts2, op, op2 = [], [], [], []
    for x in range(x0, x1 + 1, 10):
        va, vb = c.eng.kv(rep['key'], l, x), c.eng.kv(rep['key'], o, x)
        if va is not None:
            pts.append([x, va * scale])
        if vb is not None:
            pts2.append([x, vb * scale])
        op.append([x, sum(st.L[l].prod[x - 9:x + 1]) / (st.ideal[l] * 10) * 100])
        op2.append([x, sum(st.L[o].prod[x - 9:x + 1]) / (st.ideal[o] * 10) * 100])
    rep['charts'] = {'kpi': [pts, pts2], 'out': [op, op2], 'marks': [{'t': rep['on'], 'label': 'starts'}, {'t': rep['ta'], 'label': 'alert'}]}
    rep['analysis'], rep['triangulation'], rep['live'] = an, tri, inc['end'] >= now
    rep['lead_text'] = fill_text(rep['lead'], rep['facts'])
    rep['lens'] = {'before': rep['lens']['before'], 'same': rep['lens']['same'], 'past': c.eng.past_text(rep['lens']['past'])}
    if c.S['wording'] > 0 and model_allowed(c.S):
        meter = llm.Meter()
        text, info = reword('\n'.join([rep['lead_text'], rep['causeLine'], ' '.join(rep['evidence'])]), c.S, meter)
        SPEND.add(meter.usd)
        rep['wording'] = info
        if text and info['mode'] == 'model':
            rep['model_text'] = text
    out = clean(rep)
    c.reports[key] = out
    if len(c.reports) > 400:
        c.reports.clear()
    return out


def _ask_settings(c, ip):
    S = dict(c.S)
    note = None
    if not model_allowed(S):
        note = 'The model is off (no key or today\'s spend cap is reached). Answers use the rule reader and code wording.'
        S['wording'] = 0
    return S, note


def _run_ask(body, request):
    ip = visitor(request)
    if not rate_ok(ip):
        raise HTTPException(429, 'Too many questions. Wait a few minutes.')
    c, now = ctx_for(body.settings), clamp_now(body.now)
    S, note = _ask_settings(c, ip)
    q = (body.question or '')[:400]
    chat = [x for x in body.chat if isinstance(x, dict) and 'q' in x and 'parsed' in x][-30:]
    out = explorer_agent.build(c.eng, S, use_model=note is None).invoke({'question': q, 'now': now, 'chat': chat})
    SPEND.add(out.get('usage', {}).get('usd', 0))
    ans = out['answer']
    ans['usage'], ans['planner'], ans['note'] = out.get('usage'), out.get('planner'), note
    return clean(ans)


@app.post('/api/ask')
def ask(body: AskBody, request: Request):
    return _run_ask(body, request)


STEP_TEXT = {'plan': 'Reading your question…', 'check': 'Checking the plan against the data…',
             'answer': 'Computing the numbers and checking each one a second way…', 'write': 'Writing the answer…'}


@app.post('/api/ask/stream')
def ask_stream(body: AskBody, request: Request):
    ip = visitor(request)
    if not rate_ok(ip):
        return JSONResponse({'detail': 'Too many questions. Wait a few minutes.'}, status_code=429)
    c, now = ctx_for(body.settings), clamp_now(body.now)
    S, note = _ask_settings(c, ip)
    q = (body.question or '')[:400]
    chat = [x for x in body.chat if isinstance(x, dict) and 'q' in x and 'parsed' in x][-30:]

    def gen():
        try:
            graph = explorer_agent.build(c.eng, S, use_model=note is None)
            yield 'event: step\ndata: %s\n\n' % json.dumps({'node': 'start', 'text': STEP_TEXT['plan']})
            final = {}
            for upd in graph.stream({'question': q, 'now': now, 'chat': chat}, stream_mode='updates'):
                for node, val in upd.items():
                    final.update(val or {})
                    nxt = {'plan': 'check', 'check': 'answer', 'answer': 'write'}.get(node)
                    if nxt:
                        yield 'event: step\ndata: %s\n\n' % json.dumps({'node': nxt, 'text': STEP_TEXT[nxt]})
            SPEND.add((final.get('usage') or {}).get('usd', 0))
            ans = final['answer']
            ans['usage'], ans['planner'], ans['note'] = final.get('usage'), final.get('planner'), note
            yield 'event: answer\ndata: %s\n\n' % json.dumps(clean(ans))
        except Exception as e:  # never leave the client waiting
            yield 'event: error\ndata: %s\n\n' % json.dumps({'text': 'I could not work this out (%s).' % type(e).__name__})
    return StreamingResponse(gen(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ---------------------------------------------------------------- the built React app (same host)
_dist = os.environ.get('BOTTLECO_WEB', os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'dist'))
if os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles
    app.mount('/', StaticFiles(directory=_dist, html=True), name='web')
