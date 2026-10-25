"""Wording slider, shared by both agents.

0      -> the code-made text is shown as it is (no model call, same words every time)
above  -> Claude re-words it; the number check must pass, else retry ("retries" slider), else the code text.
"""
from . import llm, numcheck

SYSTEM = """You re-word a short text about a bottling plant for a plant supervisor.
Rules:
- Keep every number, time, date, percentage and order number exactly as written. Do not add any number. Do not drop any number.
- Write numbers as digits, never as words.
- Do not add facts, causes or advice that are not in the text.
- Plain, calm English. Short sentences. No headings, no lists, no markdown.
- Return only the re-worded text."""


def variety(w):
    if w <= 30:
        return 'Change the wording only a little.'
    if w <= 70:
        return 'Use your own words, same meaning.'
    return 'Use fresh wording and a natural tone, same meaning.'


def reword(source, S, meter):
    """Returns (text, info). text is None when the model text failed the number check every time."""
    if S['wording'] <= 0:
        return source, {'mode': 'template', 'tries': 0, 'model': None}
    model = llm.chat(S, max_tokens=S['length'] * 2 + 6000)
    tries, problems = 0, []
    while tries <= int(S['retries']):
        tries += 1
        limit = max(int(S['length'] // 4), int(len(source.split()) * 1.2))  # never shorter than the facts need
        ask = variety(S['wording']) + ' Keep it under ' + str(limit) + ' words.\n\n' + source
        if problems:
            ask += '\n\nYour last try failed the number check: ' + '; '.join(problems)
        text = llm.timed_invoke(model, [('system', SYSTEM), ('human', ask)], meter).strip()
        ok, problems = numcheck.check(source, text)
        if ok:
            return text, {'mode': 'model', 'tries': tries, 'model': model.model}
    return None, {'mode': 'template', 'tries': tries, 'model': model.model, 'fallback': problems}
