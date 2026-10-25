"""Phase 3 gate: no tool can see the future.

Method: cut the database at `now` (delete every row after it), then call every tool on the full
database and on the cut one. The answers must be the same. If a tool used a later row, they differ.
"""
import os
import shutil
import sqlite3

import pytest
from conftest import DB

from bottleco.alerts import scan
from bottleco.datakit import DataKit
from bottleco.db import Store, minute_of

NOWS = ['2026-09-10 09:00', '2026-09-11 13:40', '2026-09-03 10:30', '2026-09-13 03:00']


def _cut_db(tmp, now):
    path = os.path.join(tmp, 'cut.sqlite')
    shutil.copy(DB, path)
    c = sqlite3.connect(path)
    # Rows after now are replaced by neutral values (the table must keep its length; the tools must not use them).
    c.execute("UPDATE minute_readings SET state='running', reason_code=NULL, speed=0.5, produced=7, rejected=7, "
              "preform_stock=1, cap_torque=9, micro_stop=1 WHERE minute > ?", (now,))
    c.execute('DELETE FROM defects WHERE minute > ?', (now,))
    c.execute('UPDATE downtime_events SET end_minute = ?, minutes = ? - start_minute WHERE end_minute > ? + 1 AND start_minute <= ?',
              (now + 99999, now + 99999, now, now))  # an ongoing stop now looks endless: only the past part may show
    c.execute('DELETE FROM downtime_events WHERE start_minute > ?', (now,))
    c.execute('UPDATE deliveries SET arrived_minute = NULL, arrived_ts = NULL, minutes_late = NULL, qty = NULL WHERE arrived_minute > ?', (now,))
    c.execute('DELETE FROM changeovers WHERE start_minute > ?', (now,))
    c.execute('UPDATE changeovers SET end_minute = ? WHERE end_minute > ? + 1', (now + 99999, now))
    c.execute('DELETE FROM setpoint_changes WHERE minute > ?', (now,))
    c.commit()
    c.close()
    return path


def _calls(k, now):
    out = []
    for line in ('L1', 'L2'):
        out += [k.kpi_now(line, now), k.minutes(line, now - 300, now + 300, now), k.range_totals(line, now - 600, now + 600, now),
                k.downtime(line, now - 600, now + 600, now), k.deliveries(line, now - 900, now + 900, now),
                k.changes(line, now - 900, now + 900, now), k.defects(line, now - 120, now + 120, now),
                k.kpi_series(line, 'oee', now - 240, now + 240, now), k.normal_at(line, 'speed', now, now),
                k.similar_past(line, now, now)]
    out.append(k.same_time('L1', now, now))
    a = k.alerts(now)
    out.append([(x['line_id'], x['key'], x['t0'], x['ta'], x['t_end']) for x in a['alerts']])
    return out


@pytest.mark.parametrize('now_ts', NOWS)
def test_tools_ignore_rows_after_now(kit, tmp_path, now_ts):
    now = minute_of(now_ts)
    cut = DataKit(Store(_cut_db(str(tmp_path), now)))
    assert _calls(kit, now) == _calls(cut, now)


def test_future_range_is_refused(kit):
    now = minute_of('2026-09-10 09:00')
    with pytest.raises(ValueError):
        kit.minutes('L1', now + 10, now + 60, now)


def test_alerts_up_to_now_are_a_prefix_of_the_full_scan(store, kit):
    full = scan(store, kit.S)['alerts']
    for now_ts in NOWS:
        now = minute_of(now_ts)
        part = kit.alerts(now)['alerts']
        assert [(a['line_id'], a['key'], a['ta']) for a in part] == [(a['line_id'], a['key'], a['ta']) for a in full if a['ta'] <= now]
