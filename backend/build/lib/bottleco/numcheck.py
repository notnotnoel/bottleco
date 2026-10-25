"""Number check for model-written text.

The model may only re-word. It may not add, drop or change a number. Rules:
1. Every number in the model's text must appear in the source text (the code-made template).
2. Every number in the source text must appear in the model's text.
3. Spelled-out numbers ("two", "dozen", "half") are refused, so a number cannot hide in words.
Times (08:04), percentages (51.8%), and numbers with commas (12,345) count as one token each.
"""
import re
from collections import Counter

NUM = re.compile(r'\d{1,2}:\d{2}|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?')
WORDS = re.compile(r'\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|dozen|half|twice|double|triple)\b', re.I)
IDS = re.compile(r'\b(?:PO|RCA)-?\s?\d+\b|\bL[12]\b|\bLine [12]\b')  # names, not quantities


def tokens(text):
    text = IDS.sub(lambda m: m.group(0).replace(' ', '_'), text)
    out = []
    for m in NUM.finditer(text):
        s = m.start()
        if s > 0 and (text[s - 1].isalpha() or text[s - 1] in '_-'):
            continue  # part of a name such as PO-1027 or Line_1
        out.append(m.group(0).replace(',', ''))
    return out


def check(source, written):
    """Returns (ok, problems)."""
    a, b = Counter(tokens(source)), Counter(tokens(written))
    problems = []
    added = sorted(set(b) - set(a))
    dropped = sorted(set(a) - set(b))
    if added:
        problems.append('New numbers: ' + ', '.join(added))
    if dropped:
        problems.append('Missing numbers: ' + ', '.join(dropped))
    w = sorted({m.group(0).lower() for m in WORDS.finditer(written)} - {m.group(0).lower() for m in WORDS.finditer(source)})
    if w:
        problems.append('Numbers in words: ' + ', '.join(w))
    for po in set(re.findall(r'PO-\d+', written)) - set(re.findall(r'PO-\d+', source)):
        problems.append('Unknown order: ' + po)
    return (not problems), problems
