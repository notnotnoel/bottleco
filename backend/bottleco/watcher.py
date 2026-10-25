"""Line Watcher agent (LangGraph).

Flow:  detect -> investigate -> verify -> write -> publish
- detect:      alerts up to `now` (rules in code, Data Kit)
- investigate: cause tests, report, data analysis, triangulation (all code)
- verify:      every number is computed twice; both paths must agree, or the report is held
- write:       wording slider 0 = code templates; above 0 = Claude re-words, then the number check
               (retry up to the "retries" slider; if it still fails, the code template is used)
- publish:     reports go out with the data they used
The model never computes a number and never sees data after `now`.
"""
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from . import llm, numcheck
from .alerts import scan
from .rca import Engine
from .report import analysis_for, fill_text, report_for, triangulate
from .settings import defaults


class WatchState(TypedDict, total=False):
    now: int
    settings: dict
    seen: list
    incidents: list
    reports: list
    held: list
    usage: dict


SYSTEM = """You re-word a short factory alert report for a plant supervisor.
Rules:
- Keep every number, time, percentage and order number exactly as written. Do not add any number. Do not drop any number.
- Write numbers as digits, never as words.
- Do not add facts, causes or advice that are not in the text.
- Plain, calm English. Short sentences. No headings, no lists, no markdown.
- Return only the re-worded text."""


def _variety(w):
    if w <= 30:
        return 'Change the wording only a little.'
    if w <= 70:
        return 'Use your own words, same meaning.'
    return 'Use fresh wording and a natural tone, same meaning.'


def _sections(rep):
    """The parts of a report that carry words. Numbers in them come from code."""
    f = rep['facts']
    return {'lead': fill_text(rep['lead'], f), 'cause': rep['causeLine'], 'evidence': ' '.join(rep['evidence']), 'next': rep['playbook']}


def build(store, settings=None, engine=None):
    S = dict(defaults(), **(settings or {}))
    eng = engine or Engine(store, S, scan(store, S))
    meter = llm.Meter()

    def detect(state: WatchState) -> WatchState:
        now = state['now']
        seen = set(state.get('seen') or [])
        res = scan(store, S, upto=now)
        new = [i for i in res['incidents'] if i['id'] not in seen]
        # incident ids from the "up to now" scan equal the full scan ids (alerts are a prefix), so they are stable
        return {'incidents': new}

    def investigate(state: WatchState) -> WatchState:
        now, out = state['now'], []
        full = {i['id']: i for i in eng.scan['incidents']}
        for inc in state['incidents']:
            rep = report_for(eng, full[inc['id']], now)
            rep['analysis'] = analysis_for(eng, rep)
            rep['triangulation'] = triangulate(eng, rep)
            out.append(rep)
        return {'reports': out}

    def verify(state: WatchState) -> WatchState:
        ok, held = [], list(state.get('held') or [])
        for rep in state['reports']:
            bad = [f['label'] for f in rep['facts'] if not f['ok']] + [c['label'] for c in rep['analysis']['checks']['bad']]
            if '{{' in fill_text(rep['lead'], rep['facts']):
                bad.append('unfilled number')
            rep['number_check'] = {'ok': not bad, 'problems': bad}
            (ok if not bad else held).append(rep)
        return {'reports': ok, 'held': held}

    def write(state: WatchState) -> WatchState:
        w = S['wording']
        for rep in state['reports']:
            secs = _sections(rep)
            rep['text'] = dict(secs)
            rep['wording'] = {'mode': 'template', 'tries': 0, 'model': None}
            if w <= 0:
                continue
            model = llm.chat(S)
            source = '\n'.join(secs[k] for k in ('lead', 'cause', 'evidence'))
            tries, last_problems = 0, []
            while tries <= int(S['retries']):
                tries += 1
                msgs = [('system', SYSTEM), ('human', _variety(w) + ' Keep it under ' + str(int(S['length'] // 4)) + ' words.\n\n' + source +
                                                      ('\n\nYour last try failed the number check: ' + '; '.join(last_problems) if last_problems else ''))]
                text = llm.timed_invoke(model, msgs, meter).strip()
                ok, last_problems = numcheck.check(source, text)
                if ok:
                    rep['text'] = {'body': text, 'next': secs['next']}
                    rep['wording'] = {'mode': 'model', 'tries': tries, 'model': model.model}
                    break
            else:
                rep['wording'] = {'mode': 'template', 'tries': tries, 'model': model.model, 'fallback': last_problems}
        return {'reports': state['reports'], 'usage': meter.as_dict()}

    def publish(state: WatchState) -> WatchState:
        seen = list(state.get('seen') or []) + [r['id'] for r in state['reports']] + [r['id'] for r in state.get('held') or []]
        return {'seen': seen, 'usage': meter.as_dict()}

    g = StateGraph(WatchState)
    for name, fn in [('detect', detect), ('investigate', investigate), ('verify', verify), ('write', write), ('publish', publish)]:
        g.add_node(name, fn)
    g.set_entry_point('detect')
    g.add_conditional_edges('detect', lambda s: 'investigate' if s['incidents'] else 'publish', {'investigate': 'investigate', 'publish': 'publish'})
    g.add_edge('investigate', 'verify')
    g.add_edge('verify', 'write')
    g.add_edge('write', 'publish')
    g.add_edge('publish', END)
    return g.compile()


def run(store, now, settings=None, seen=None, engine=None) -> Any:
    graph = build(store, settings, engine)
    return graph.invoke({'now': now, 'seen': seen or [], 'reports': [], 'held': []})
