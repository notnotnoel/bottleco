"""Number formatting that matches the approved preview exactly (JavaScript rules).

Python's round() rounds half to even; JavaScript's Math.round and toFixed round half up.
The tests compare report text with the preview word for word, so the rules must match.
"""
import math
from decimal import Decimal, ROUND_HALF_UP

WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def jround(x):
    """JavaScript Math.round: half rounds up (towards +infinity)."""
    return int(math.floor(x + 0.5))


def fixed(x, d=0):
    """JavaScript Number.prototype.toFixed(d)."""
    q = Decimal(1).scaleb(-d) if d else Decimal(1)
    return str(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


def jstr(x):
    """JavaScript String(number) for the values the reports print."""
    if isinstance(x, bool):
        return 'true' if x else 'false'
    if isinstance(x, int) or float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def num(v):
    """Math.round(v).toLocaleString('en-US')."""
    return '{:,}'.format(jround(v))


def pct(v, d=0):
    return fixed(v * 100, d) + '%'


# ---- time labels (minute 0 = Tue 1 Sep 2026 06:00) ----
from datetime import datetime, timedelta  # noqa: E402
START = datetime(2026, 9, 1, 6, 0)


def _dt(m):
    return START + timedelta(minutes=int(m))


def hhmm(m):
    return _dt(m).strftime('%H:%M')


def dlabel(m):
    d = _dt(m)
    return '%d %s' % (d.day, MON[d.month - 1])


def full(m):
    d = _dt(m)
    return '%s %s %s' % (WD[d.weekday()], dlabel(m), hhmm(m))
