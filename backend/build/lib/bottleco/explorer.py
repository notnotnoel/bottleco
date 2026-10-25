"""Data Explorer agent (LangGraph).

Flow:  plan -> check -> answer -> write
- plan:   Claude reads the question (and recent chat) and fills a plan: what, which line, which time.
          Claude never sees data and never computes a number. If no model is set up, the rule reader plans.
- check:  code checks the plan: line exists, date is inside the data, nothing after "now", no forecasts.
- answer: code runs the plan on the Data Kit: facts (each computed twice), data queried, raw rows, trend, 3 lenses.
- write:  wording slider 0 = code text; above 0 = Claude re-words, the number check must pass.
"""
from typing import List, Literal, Optional, TypedDict

from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from . import llm
from .explorer_engine import Explorer, T, cal_day
from .fmt import full, hhmm
from .report import fill_text
from .settings import defaults
from .wording import reword


class Plan(BaseModel):
    """How to answer the question. Fill only what the question (or the recent chat) says."""
    intent: Literal['value', 'top', 'shifts', 'why', 'happened', 'not_in_data', 'unclear'] = Field(
        description="value = a number for a period; top = which stop reason or defect was biggest; shifts = compare shifts A/B/C; "
                    "why = explain a drop, a rise or a stop; happened = list what happened; not_in_data = asks for something the data cannot answer; unclear = not a question about the lines")
    lines: List[int] = Field(default_factory=list, description='Line numbers named, e.g. [1] or [1, 2]. Empty if no line is named. Keep any number the user wrote, even 3.')
    measure: Optional[Literal['oee', 'stop', 'speed', 'rej', 'output', 'cover']] = Field(
        None, description='oee = overall score/OEE/efficiency; stop = stopped time/downtime/faults; speed = speed/slow; rej = rejects/defects/quality; output = bottles made; cover = preforms/stock')
    period: Literal['day', 'day_time', 'time', 'yesterday', 'today', 'last_hour', 'last_24h', 'last_7_days', 'this_shift', 'now', 'all'] = Field(
        'all', description='day = a date; day_time = a date and a clock time; time = a clock time without a date; all = no time given')
    day: Optional[int] = Field(None, description='Day of the month the user wrote')
    month: Optional[str] = Field(None, description='Month the user wrote, 3 letters, e.g. sep')
    time: Optional[str] = Field(None, description='Clock time the user wrote, 24-hour HH:MM')
    defect: bool = Field(False, description='True if the user asks about reject or defect types')
    not_in_data: Optional[Literal['future', 'missing', 'opinion']] = Field(
        None, description='future = forecast or prediction; missing = cost, money, energy, people, weather or other things not in a production log; opinion = should, blame, judgement')
    missing_what: Optional[str] = Field(None, description='For missing: the words from the question that name the missing thing')


PLANNER = """You turn a question about a bottling plant into a plan. You do not answer the question.
The data: 2 filling lines (Line 1, Line 2), minute data from {start} to {now} (now). Shifts: A 06-14, B 14-22, C 22-06.
Signals: overall score (OEE), stopped time, speed, rejects and defect types, bottles made, preform stock, stop reasons, deliveries.
Rules:
- Fill only what the question says. If it is a short follow-up ("and Line 2?", "what about 6 Sep?"), take the missing parts from the recent chat.
- Copy line numbers, days and times exactly as written, even if they look wrong. Code checks them.
- If the question asks for a forecast, money, energy, people, weather or an opinion, set intent to not_in_data."""


class ExploreState(TypedDict, total=False):
    question: str
    now: int
    chat: list          # earlier turns: [{'q': ..., 'parsed': ...}]
    plan: dict
    planner: str
    P: dict
    intent: str
    answer: dict
    usage: dict


def plan_to_P(ex, plan, raw, now):
    """Turn the model's plan into the engine's plan, with the same labels and checks as the rule reader."""
    q = ' ' + raw.lower() + ' '
    P = {'raw': raw, 'q': q, 'lines': [], 'measure': plan.get('measure'), 'range': None, 'at': None, 'notes': [], 'abstain': None,
         'reason': None, 'defect': 'any' if plan.get('defect') else None, 'shift': None}
    if plan['intent'] == 'not_in_data':
        why = plan.get('not_in_data') or 'missing'
        text = {'future': 'A forecast is not in the data. I read only what already happened, up to ' + full(now) + '.',
                'opinion': 'That is a judgment, not a fact in the data. I can show the numbers behind it.'}.get(
            why, '"' + (plan.get('missing_what') or 'That') + '" is not in the data.')
        P['abstain'] = {'why': why, 'text': text}
        return P
    bad = [x for x in plan.get('lines') or [] if x not in (1, 2)]
    if bad:
        P['abstain'] = {'why': 'unknown', 'text': 'Line ' + str(bad[0]) + ' is not in the data. The data has Line 1 and Line 2.'}
        return P
    P['lines'] = list(dict.fromkeys(x - 1 for x in plan.get('lines') or []))
    P['explicitLine'] = bool(P['lines'])
    day, mon, tm, per = plan.get('day'), (plan.get('month') or 'sep')[:3].lower(), plan.get('time'), plan.get('period')
    if per in ('day', 'day_time') and day is not None:
        if mon != 'sep':
            P['abstain'] = {'why': 'outside', 'text': str(day) + ' ' + mon + ' is outside the data.'}
            return P
        if day < 1 or day > 15:
            P['abstain'] = {'why': 'outside', 'text': str(day) + ' Sep is outside the data.'}
            return P
    clock = None
    if tm:
        try:
            h, m = (int(x) for x in tm.split(':'))
            clock = [h, m]
        except ValueError:
            clock = None
    if per == 'day_time' and day is not None and clock:
        P['at'] = T(day, clock[0], clock[1])
        P['range'], P['label'] = [P['at'], P['at']], full(P['at'])
    elif per in ('day', 'day_time') and day is not None:
        P['range'], P['label'], P['day'] = ex.day_range(day), str(day) + ' Sep', day
    elif per == 'time' and clock:
        from .explorer_engine import _dt
        cur = _dt(now)
        P['at'] = T(cur.day - (1 if clock[0] * 60 + clock[1] > cur.hour * 60 + cur.minute else 0), clock[0], clock[1])
        P['range'], P['label'] = [P['at'], P['at']], full(P['at'])
    elif per == 'yesterday':
        d = cal_day(now) - 1
        P['range'], P['label'], P['day'] = ex.day_range(d), 'yesterday (' + str(d) + ' Sep)', d
    elif per == 'today':
        r = ex.day_range(cal_day(now))
        P['range'], P['label'] = [r[0], now], 'today so far (since 00:00 on ' + str(cal_day(now)) + ' Sep)'
    elif per == 'last_hour':
        P['range'], P['label'] = [now - 59, now], 'the last hour'
    elif per == 'last_24h':
        P['range'], P['label'] = [now - 1439, now], 'the last 24 hours'
    elif per == 'last_7_days':
        P['range'], P['label'] = [now - 10079, now], 'the last 7 days'
    elif per == 'this_shift':
        s0 = (now // 480) * 480
        P['range'], P['label'] = [s0, now], 'this shift (since ' + hhmm(s0) + ')'
    elif per == 'now':
        P['at'], P['range'], P['label'], P['isNow'] = now, [max(0, now - 59), now], 'the last hour to ' + full(now), True
    return ex.finish_plan(P, now, None)   # the model already used the chat; code still checks "after now"


def build(eng, settings=None, use_model=True):
    S = dict(defaults(), **(settings or {}))
    ex = Explorer(eng)
    ex.S = S
    meter = llm.Meter()

    def plan(state: ExploreState) -> ExploreState:
        q, now = state['question'], state['now']
        if not use_model or not llm.api_key() or not q.strip():
            return {'planner': 'rules'}
        chat = (state.get('chat') or [])[-int(S['memory']):]
        recent = '\n'.join('- Earlier question: "%s" -> read as: %s' % (c['q'], {k: c['parsed'].get(k) for k in ('lines', 'measure', 'label')}) for c in chat) or '(none)'
        model = llm.chat(dict(S, think=min(S['think'], 30)), max_tokens=2000).with_structured_output(Plan, method='json_schema', include_raw=True)
        import time
        t = time.time()
        try:
            r = model.invoke([('system', PLANNER.format(start=full(0), now=full(now))), ('human', 'Recent chat:\n' + recent + '\n\nQuestion: ' + q)])
        except Exception as e:  # model down or refused: fall back to the rule reader
            return {'planner': 'rules', 'plan': {'error': str(e)[:200]}}
        u = r['raw'].usage_metadata or {}
        meter.add(llm.model_for(S), {'input_tokens': u.get('input_tokens', 0), 'output_tokens': u.get('output_tokens', 0)}, time.time() - t)
        if r.get('parsed') is None:
            return {'planner': 'rules', 'plan': {'error': 'no plan'}}
        return {'planner': 'model', 'plan': r['parsed'].model_dump()}

    def check(state: ExploreState) -> ExploreState:
        q, now = state['question'], state['now']
        if state.get('planner') != 'model':
            hist = [c['parsed'] for c in (state.get('chat') or [])]
            P = ex.rule_plan(q, now, hist)
            return {'P': P, 'intent': None if P.get('abstain') else ex.rule_intent(P)}
        p = state['plan']
        P = plan_to_P(ex, p, q, now)
        intent = None if P.get('abstain') else ({'unclear': 'none'}.get(p['intent'], p['intent']))
        if intent == 'top' and not P.get('defect') and P.get('measure') == 'rej':
            P['defect'] = 'any'
        return {'P': P, 'intent': intent}

    def answer(state: ExploreState) -> ExploreState:
        if not state['question'].strip():
            ans = ex.abstain('Type a question about Line 1 or Line 2.', state['now'])
            ans['question'] = state['question']
            return {'answer': ans}
        ans = ex.answer_plan(state['P'], state['intent'], state['now'], state['question'])
        ans['planner'] = state.get('planner')
        return {'answer': ans}

    def write(state: ExploreState) -> ExploreState:
        ans = state['answer']
        if ans['kind'] == 'answer':
            text, info = reword(ans['shown'], S, meter)
            ans['wording'] = info
            if info['mode'] == 'model':
                ans['shown_model'] = text
        return {'answer': ans, 'usage': meter.as_dict()}

    g = StateGraph(ExploreState)
    for name, fn in [('plan', plan), ('check', check), ('answer', answer), ('write', write)]:
        g.add_node(name, fn)
    g.set_entry_point('plan')
    g.add_edge('plan', 'check')
    g.add_edge('check', 'answer')
    g.add_edge('answer', 'write')
    g.add_edge('write', END)
    return g.compile()


def ask(eng, question, now, chat=None, settings=None, use_model=True):
    return build(eng, settings, use_model).invoke({'question': question, 'now': now, 'chat': chat or []})


__all__ = ['ask', 'build', 'Plan', 'plan_to_P', 'fill_text']
