"""LangSmith tracing. Off unless the server sets it on; the app works the same either way.

Turn it on with environment variables (no code change):
    LANGSMITH_TRACING=true
    LANGSMITH_API_KEY=<key from smith.langchain.com>      (keep it in Secret Manager)
    LANGSMITH_PROJECT=bottleco                             (optional; default "default")
    LANGSMITH_TRACING_SAMPLING_RATE=1                      (optional; e.g. 0.2 keeps 1 run in 5)

What a trace shows:
- "Data Explorer": one run per question, with the LangGraph nodes plan -> check -> answer -> write
  and any Claude call inside them (tokens, time, cost).
- "Line Watcher RCA": one run per RCA report opened, with the steps investigate, analyse,
  triangulate and write (Claude re-wording, when the wording slider is above 0).

Cloud Run gives a container CPU only while a request runs, so each request waits for its
trace to be sent before it ends (flush), for at most 2 seconds. Only when tracing is on.
"""
import threading
from contextlib import contextmanager

try:
    from langsmith import trace as _ls_trace
    from langsmith.utils import tracing_is_enabled as _enabled
except Exception:  # langsmith missing: tracing is simply off
    _ls_trace, _enabled = None, (lambda: False)

APP_VERSION = '0.7.2'


def enabled():
    try:
        return bool(_enabled())
    except Exception:
        return False


def config(name, now, settings=None, **meta):
    """LangGraph / LangChain run config: a clear run name, tags and metadata for each trace."""
    S = settings or {}
    md = {'app': 'bottleco', 'version': APP_VERSION, 'now_minute': now,
          'brain': S.get('brain'), 'wording': S.get('wording'), **meta}
    return {'run_name': name, 'tags': ['bottleco', name.lower().replace(' ', '-')],
            'metadata': {k: v for k, v in md.items() if v is not None}}


@contextmanager
def step(name, run_type='chain', inputs=None, **meta):
    """A named step in the trace (no-op when tracing is off). Yields a dict; put outputs in it."""
    out = {}
    if not enabled() or _ls_trace is None:
        yield out
        return
    with _ls_trace(name=name, run_type=run_type, inputs=inputs or {}, metadata=meta, tags=['bottleco']) as rt:
        yield out
        rt.end(outputs=out)


def flush(timeout=2.0):
    """Send any trace still waiting before the request ends. Waits at most `timeout` seconds,
    so a slow or down LangSmith can never hold up an answer (a late trace is lost, not the answer)."""
    if not enabled():
        return

    def _send():
        try:
            from langchain_core.tracers.langchain import wait_for_all_tracers
            wait_for_all_tracers()
        except Exception:
            pass
        try:
            from langsmith.run_trees import get_cached_client
            get_cached_client().flush()
        except Exception:
            pass
    t = threading.Thread(target=_send, daemon=True)
    t.start()
    t.join(timeout)
