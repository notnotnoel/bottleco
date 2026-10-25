"""Agent settings ("sliders"). Plain-English names only; the UI shows q, left and right.

g: s = shared, e = Data Explorer, w = Line Watcher.
This list is the single source of truth. The UI gets it from the API.
"""

SLIDERS = [
    # key, group, question, left label, right label, min, max, step, default
    ('wording', 's', 'How free is my wording?', 'Same words every time', 'More variety', 0, 100, 5, 0),
    ('length', 's', 'How long are my answers?', 'Short', 'Long', 150, 1200, 50, 150),
    ('brain', 's', 'Brain', 'Fast', 'Deep', 0, 2, 1, 1),
    ('effort', 's', 'How hard do I try?', 'Quick look', 'Dig deep', 3, 20, 1, 6),
    ('think', 's', 'How long may I think?', '10 sec', '2 min', 10, 120, 5, 45),
    ('retries', 's', 'If my number check fails, how often do I try again?', 'Never', '3 times', 0, 3, 1, 2),
    ('around', 's', 'How far around the moment do I look?', '15 min', '12 hours', 15, 720, 15, 120),
    ('simK', 'e', 'How many past events do I compare?', '1', '10', 1, 10, 1, 3),
    ('simCut', 'e', 'How alike must a past event be?', 'Loosely alike', 'Nearly the same', 0, 100, 5, 50),
    ('rows', 'e', 'How much data may I read?', '100 rows', '5,000 rows', 100, 5000, 100, 1000),
    ('sure', 'e', 'How sure must I be before I answer?', 'Answer fast', 'Be very sure', 50, 100, 5, 75),
    ('memory', 'e', 'How much of our chat do I remember?', '2 messages', '30 messages', 2, 30, 1, 10),
    ('oeeLim', 'w', 'Overall score: warn me below', '30%', '80%', 30, 80, 1, 55),
    ('stopLim', 'w', 'Stopped time: warn me above', '5 min', '45 min', 5, 45, 1, 20),
    ('speedLim', 'w', 'Speed: warn me below', '50%', '95%', 50, 95, 1, 75),
    ('rejLim', 'w', 'Rejects: warn me above', '1%', '8%', 1, 8, 0.5, 3),
    ('coverLim', 'w', 'Preforms left: warn me below', '10 min', '120 min', 10, 120, 5, 45),
    ('every', 'w', 'How often do I check?', 'Every minute', 'Every 15 min', 1, 15, 1, 1),
    ('hold', 'w', 'How long must a problem last before I warn?', '1 min', '30 min', 1, 30, 1, 5),
    ('cool', 'w', 'How long do I stay quiet after a warning?', '0 min', '2 hours', 0, 120, 5, 30),
    ('baseDays', 'w', 'How many days of normal do I compare with?', '1', '14', 1, 14, 1, 7),
    ('nCauses', 'w', 'How many causes do I check?', '1', '8', 1, 8, 1, 5),
    ('reportLen', 'w', 'How long is a report?', 'Brief', 'Full', 0, 1, 1, 0),
]
FIELDS = ('key', 'group', 'q', 'left', 'right', 'min', 'max', 'step', 'default')


def slider_list():
    return [dict(zip(FIELDS, s)) for s in SLIDERS]


def defaults():
    return {s[0]: s[8] for s in SLIDERS}


def validate(values):
    """Merge user values onto defaults. Clamp to each slider's range. Unknown keys are refused."""
    out = defaults()
    spec = {s[0]: s for s in SLIDERS}
    for k, v in (values or {}).items():
        if k not in spec:
            raise KeyError('Unknown setting: ' + k)
        lo, hi = spec[k][5], spec[k][6]
        out[k] = max(lo, min(hi, float(v)))
    return out
