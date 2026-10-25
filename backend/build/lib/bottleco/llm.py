"""Claude access for the agents. The sliders map to model settings here, in one place.

Brain     -> model:  Fast = Haiku 5.5, Balanced = Sonnet 5.5, Deep = Opus 5.5
Thinking  -> effort: up to 30 s = low, up to 75 s = medium, more = high
Length    -> max_tokens (plus room for thinking)
Wording   -> 0 = code templates only (no model call); above 0 = Claude re-words, number check on every answer.
(Claude 5.5 models refuse `temperature`, so wording variety is a prompt rule, not a sampling setting.)
"""
import os
import time

MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']
PRICE = {  # US$ per million tokens: input, output (platform.claude.com/docs/en/about-claude/pricing, Oct 2026)
    'claude-haiku-5-5': (0.10, 0.50), 'claude-sonnet-5-5': (2.0, 10.0), 'claude-opus-5-5': (4.0, 20.0),
}
API_URL = os.environ.get('BOTTLECO_API_URL', 'https://api.anthropic.com')


def api_key():
    k = os.environ.get('ANTHROPIC_API_KEY')
    if k:
        return k
    path = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
    if os.path.exists(path):
        for line in open(path):
            if line.startswith('ANTHROPIC_API_KEY='):
                return line.split('=', 1)[1].strip()
    return None


def model_for(S):
    return MODELS[max(0, min(2, int(round(S['brain']))))]


def effort_for(S):
    t = S['think']
    return 'low' if t <= 30 else ('medium' if t <= 75 else 'high')


def chat(S, max_tokens=None):
    from langchain_anthropic import ChatAnthropic
    key = api_key()
    if not key:
        raise RuntimeError('No Claude API key. Set ANTHROPIC_API_KEY.')
    return ChatAnthropic(model=model_for(S), api_key=key, base_url=API_URL,
                         max_tokens=int(max_tokens or (S['length'] * 2 + 2000)),
                         output_config={'effort': effort_for(S)}, timeout=float(S['think']) + 30, max_retries=1)


def cost(model, usage):
    pi, po = PRICE.get(model, (0, 0))
    return (usage.get('input_tokens', 0) * pi + usage.get('output_tokens', 0) * po) / 1e6


class Meter:
    """Counts calls, tokens and US$ for one run."""

    def __init__(self):
        self.calls, self.inp, self.out, self.usd, self.secs = 0, 0, 0, 0.0, 0.0

    def add(self, model, usage, secs):
        self.calls += 1
        self.inp += usage.get('input_tokens', 0)
        self.out += usage.get('output_tokens', 0)
        self.usd += cost(model, usage)
        self.secs += secs

    def as_dict(self):
        return {'calls': self.calls, 'input_tokens': self.inp, 'output_tokens': self.out, 'usd': round(self.usd, 6), 'seconds': round(self.secs, 1)}


def text_of(msg):
    c = msg.content
    if isinstance(c, str):
        return c
    return ''.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')


def timed_invoke(model, messages, meter):
    t = time.time()
    r = model.invoke(messages)
    u = r.usage_metadata or {}
    meter.add(model.model, {'input_tokens': u.get('input_tokens', 0), 'output_tokens': u.get('output_tokens', 0)}, time.time() - t)
    return text_of(r)
