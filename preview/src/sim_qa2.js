// ===== Part 5b: Data Explorer - "why", "what happened", and the dispatcher =====
const SAMPLE_Q = ['Why did Line 1 overall score drop on 10 Sep?', 'Which stop reason cost the most minutes on Line 2?', 'How many bottles were rejected yesterday?', 'Compare shift A, B and C on both lines', 'What happened at 13:20 on 11 Sep?'];
const rsn = (l, i) => { const r = D_rid(l, i); return r >= 1 && r <= 6 ? FAULTS[r - 1] : r >= 11 ? PLANNED[r - 11] : ''; };
let D_cur = null; function D_rid(l, i) { return D_cur.L[l].rid[i]; }
const stName = s => s === 0 ? 'running' : s === 1 ? 'stopped' : 'planned stop';
function pastText(sp) {
  if (!sp || !sp.closest) return ['No similar past situation is in the data yet.'];
  const f = p => LNAME[p.line] + ' on ' + dlabel(p.t) + ' ' + hhmm(p.t) + ' (' + Math.round(p.sim * 100) + '% alike): score ' + fmtKpi('oee', p.kpis.oee) + ', stopped ' + fmtKpi('stop', p.kpis.stop) + '. In the next 90 min: ' + p.next.stop + ' min stopped, rejects ' + (p.next.rej == null ? '–' : pctS(p.next.rej, 1)) + (p.alert ? ', alert ' + p.alert + ' followed' : ', no alert followed') + '.';
  if (sp.strong.length) return sp.strong.map(f);
  return ['No past situation is close enough (needs ' + Math.round(sp.cut * 100) + '% alike). Closest: ' + f(sp.closest)];
}
function lensText(L) { return { before: L.before, same: L.same.map(x => x.label + ': ' + x.value), past: pastText(L.past) }; }
function worstPoint(D, key, l, a, b) {
  const K = KPIS[KEYS.indexOf(key)]; let best = null, bt = -1;
  for (let t = Math.max(a, 60); t <= b; t += 5) { const v = kv(D, key, l, t); if (v == null) continue; if (best == null || (K.dir === 'below' ? v < best : v > best)) { best = v; bt = t; } }
  if (bt < 0) return null;
  for (let t = Math.max(a, 60, bt - 4); t <= Math.min(b, bt + 4); t++) { const v = kv(D, key, l, t); if (v != null && (K.dir === 'below' ? v < best : v > best)) { best = v; bt = t; } }
  return { t: bt, v: best };
}
function normalCheck(D, S, key, l, t) { // second code path for the "normal" value
  const v = []; for (let k = 1; k <= Math.round(S.baseDays); k++) { const x = t - k * 1440; if (x < 60) break; const y = slowKv(D, key, l, x); if (y != null) v.push(y); }
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const disp = (key, v) => key === 'oee' || key === 'speed' || key === 'rej' ? (v == null ? null : v * 100) : v;
function ansWhy(D, S, P, now) {
  const meas = P.measure === 'output' || !P.measure ? 'oee' : P.measure, key = meas, K = KPIS[KEYS.indexOf(key)];
  const [a, b] = P.range || [Math.max(0, now - 1439), now], hi = Math.min(b, now), F = mkFacts();
  const cand = (P.lines.length ? P.lines : [0, 1]).map(l => {
    if (P.at != null) { const v = kv(D, key, l, P.at); return v == null ? null : { l, t: P.at, v }; }
    const w = worstPoint(D, key, l, a, hi); return w ? { l, t: w.t, v: w.v } : null;
  }).filter(Boolean);
  if (!cand.length) return mkAbstain('There is not enough data in ' + (P.label || 'that period') + ' to judge ' + K.name.toLowerCase() + '. The first hour of data has no ' + K.name.toLowerCase() + ' value.', now);
  cand.sort((x, y) => K.dir === 'below' ? x.v - y.v : y.v - x.v);
  const { l, t: tw, v } = cand[0], r = rcaCore(D, S, l, key, tw, tw), top = r.top, ok = r.tested.length > 0;
  const breach = isBreach(S, key, v), nm = normalAt(D, S, key, l, tw), nchk = normalCheck(D, S, key, l, tw);
  const f1 = F.add(LNAME[l] + ' ' + K.name.toLowerCase(), disp(key, v), fmtKpi(key, v), disp(key, slowKv(D, key, l, tw)));
  const f2 = nm ? F.add('Normal ' + K.name.toLowerCase() + ' at this hour', disp(key, nm.mean), fmtKpi(key, nm.mean), disp(key, nchk)) : null;
  const dirWord = K.dir === 'below' ? 'lowest' : 'highest';
  let text = LNAME[l] + ' ' + K.name.toLowerCase() + ' was at its ' + dirWord + ' at ' + full(tw) + ': ' + f1 + (f2 ? '. Normal at this hour on ' + nm.n + ' earlier days: ' + f2 : '') + '. ' + (breach ? 'This is past the warning level (' + limText(S, K) + ').' : 'This is inside the warning level (' + limText(S, K) + ').');
  const good = top ? top.checks.filter(c => c.ok) : [], unusual = breach || (nm && nm.sd > 0 && (K.dir === 'below' ? v < nm.mean - 2 * nm.sd : v > nm.mean + 2 * nm.sd)), nl = S.length >= 850 ? 4 : S.length >= 450 ? 3 : 2;
  let verdict;
  if (!unusual) verdict = { kind: 'normal', title: 'Nothing unusual here', sub: 'The value is in its usual range, so I name no cause.', lines: ['Ask about a different time if you saw a drop.'] };
  else if (r.cause) verdict = { kind: 'cause', title: HYP[r.cause], sub: top.passed + ' of ' + top.total + ' checks passed', lines: good.slice(0, nl).map(c => c.detail) };
  else if (top && top.key === 'normal_noise' && top.passed >= 1) verdict = { kind: 'normal', title: 'Looks like normal variation', sub: top.passed + ' of ' + top.total + ' checks passed', lines: good.map(c => c.detail) };
  else verdict = { kind: 'unclear', title: 'The cause is not clear from the data', sub: 'I tested ' + r.tested.length + ' idea' + (r.tested.length > 1 ? 's' : '') + '. None passed enough checks.', lines: top ? ['Closest idea: ' + HYP[top.key] + ' (' + top.passed + ' of ' + top.total + ' checks).'] : [] };
  text += ' ' + verdict.title + (verdict.kind === 'cause' ? ' - ' + verdict.sub + '. ' + verdict.lines.join(' ') : '.');
  const ar = Math.round(S.around), x0 = Math.max(0, r.on - ar), x1 = Math.min(now, tw + Math.min(ar, 30)), rows = [];
  for (let i = x0; i <= x1; i++) { const L = D.L[l]; rows.push([isoTs(i), LID[l], stName(L.st[i]), (D_cur = D, rsn(l, i)), Math.round(L.setp[i] * 100), L.prod[i], L.rej[i], L.stock[i], +L.tor[i].toFixed(2)]); }
  const rc = rowCap(S, rows), s0 = Math.max(0, tw - 480), s1 = Math.min(now, tw + 60), pts = (ll) => { const q = []; for (let t = Math.max(60, s0); t <= s1; t += 10) { const y = kv(D, key, ll, t); if (y != null) q.push([t, disp(key, y)]); } return q; };
  const lens = lensText(lensesFor(D, S, l, r.on, tw, now));
  const tests = r.tested.map(h => h.name + ': ' + h.passed + ' of ' + h.total + ' checks passed' + (h.passed ? ' (' + h.checks.filter(c => c.ok).map(c => c.text).join('; ') + ')' : ''));
  return { kind: 'answer', intent: 'why', text, facts: F.facts, queried: [{ table: 'minute_readings', filter: LID[l] + ', ' + isoTs(x0) + ' to ' + isoTs(x1), rows: x1 - x0 + 1 }, { table: 'downtime_events + setpoint_changes + deliveries', filter: LID[l] + ' and ' + LID[1 - l] + ', ±' + ar + ' min around the start', rows: lens.before.length }, { table: 'event_features', filter: 'nearest past windows to ' + isoTs(tw) + ' (30-min grid, before ' + isoTs(Math.max(0, tw - 180)) + ')', rows: r.top ? 0 : 0 }], raw: { table: 'minute_readings', cols: ['ts', 'line', 'state', 'stop_reason', 'set_speed_%', 'produced', 'rejects', 'preform_stock', 'cap_torque_Nm'], rows: rc.rows, total: rc.total, cut: rc.cut }, trend: { series: [{ name: LNAME[l], line: l, pts: pts(l) }, { name: LNAME[1 - l] + ' (other line)', line: 1 - l, pts: pts(1 - l) }], step: 10, marks: [{ t: r.on, label: 'trouble starts' }, { t: tw, label: dirWord }] }, trendInfo: { name: K.name, unit: K.key === 'stop' || K.key === 'cover' ? ' min' : '%', limit: disp(key, K.key === 'stop' || K.key === 'cover' ? S[K.lim] : S[K.lim] / 100), note: 'Last 8 hours before the ' + dirWord + ' point. Dashed line is the warning level.' }, lens, tested: tests, cause: r.cause || null, verdict, headline: text.slice(0, text.indexOf(' ' + verdict.title)) };
}
function ansHappened(D, S, P, now) {
  const F = mkFacts(); let a, b, label;
  if (P.at != null) { const w = Math.max(15, Math.round(S.around / 4)); a = Math.max(0, P.at - w); b = Math.min(now, P.at + w); label = 'around ' + full(P.at) + ' (±' + w + ' min)'; }
  else if (P.range) { a = P.range[0]; b = Math.min(now, P.range[1]); label = P.label; } else { a = Math.max(0, now - 59); b = now; label = 'the last hour'; }
  const rows = [], parts = []; D_cur = D;
  [0, 1].forEach(l => {
    const evs = D.evL[l].filter(e => e.end - 1 >= a && e.start <= b); evs.forEach(e => rows.push([e.id, LID[l], isoTs(e.start), e.minutes, e.reason, e.planned ? 'planned' : 'unplanned', e.comment]));
    const un = evs.filter(e => !e.planned), br = brute(D, l, a, b), mins = F.add(LNAME[l] + ' stopped minutes', br.flt, br.flt + ' min', ws(D.P[l].flt, a, b));
    const list = evs.slice(0, 4).map(e => hhmm(e.start) + ' ' + (e.planned ? e.reason : 'Stop: ' + e.reason) + ' (' + e.minutes + ' min' + (e.comment ? ', note "' + e.comment + '"' : '') + ')').join('; ');
    parts.push(LNAME[l] + ': ' + (evs.length ? evs.length + ' event' + (evs.length > 1 ? 's' : '') + ', ' + un.length + ' unplanned, ' + mins + ' stopped - ' + list + (evs.length > 4 ? '; and ' + (evs.length - 4) + ' more' : '') : 'no stops, ' + mins + ' stopped'));
  });
  const at = P.at != null ? P.at : b;
  const kp = [0, 1].map(l => { const v = kv(D, 'oee', l, at); return v == null ? LNAME[l] + ' score: not enough data' : LNAME[l] + ' score in the hour to ' + hhmm(at) + ': ' + F.add(LNAME[l] + ' overall score', disp('oee', v), fmtKpi('oee', v), disp('oee', slowKv(D, 'oee', l, at))); });
  const lt = [0, 1].map(l => lensText(lensesFor(D, S, l, a, b, now)));
  const rc = rowCap(S, rows), bt = bucketTrend(D, S, [0, 1], Math.max(0, a - 120), b, MEAS.oee.f ? (l, x, y) => MEAS.oee.f(D, l, x, y) : null);
  const raw = { table: 'downtime_events', cols: ['id', 'line', 'start', 'minutes', 'reason', 'type', 'comment'], rows: rc.rows, total: rc.total, cut: rc.cut };
  return { kind: 'answer', intent: 'happened', text: 'For ' + label + ' - ' + parts.join('. ') + '. ' + kp.join('. ') + '.', facts: F.facts, queried: [{ table: 'downtime_events', filter: 'both lines, ' + isoTs(a) + ' to ' + isoTs(b), rows: rc.total }, { table: 'minute_readings', filter: 'both lines, same range', rows: 2 * (b - a + 1) }], raw, trend: bt, trendInfo: { name: 'Overall score', unit: '%', note: 'Hourly score with 2 hours before. Per ' + (bt.step === 60 ? 'hour' : '15 min') + '.' }, lens: { before: lt[0].before.length ? lt[0].before : lt[1].before, same: lt[0].same, past: lt[0].past } };
}
function mkAbstain(text, now) {
  return { kind: 'abstain', intent: 'abstain', text, facts: [], queried: [], raw: null, trend: null, lens: null, dataRange: 'The data runs from ' + full(0) + ' to ' + full(now) + '.', suggestions: SAMPLE_Q };
}
function answer(D, S, text, now, hist) {
  D_cur = D;
  if (!text || !String(text).trim()) return mkAbstain('Type a question about Line 1 or Line 2.', now);
  const P = parseQ(String(text), now, S, hist);
  let ans;
  if (P.abstain) ans = mkAbstain(P.abstain.text, now);
  else {
    const q = P.q;
    try {
      if (/\bwhy\b|what caused|root cause|\bcause of\b|explain|how come|reason for the|reason behind/.test(q)) ans = ansWhy(D, S, P, now);
      else if (/what happened|what went on|what.s going on|what is going on|anything (odd|unusual)|\bevents?\b/.test(q)) ans = ansHappened(D, S, P, now);
      else if (/\bshifts\b|\bby shift\b|\beach shift\b|\bcompare\b.*\bshift\b/.test(q)) ans = ansShifts(D, S, P, now); // 'this shift' is a time, not a shift comparison
      else if (/\b(reason|reasons|type|types|kind|kinds|defect|defects|fault|faults)\b/.test(q) && /\b(most|top|biggest|largest|worst|main|highest|cost|which|what)\b/.test(q) && P.measure !== 'oee' && P.measure !== 'speed') ans = ansTop(D, S, P, now);
      else if (P.measure || P.range || P.at != null) ans = ansValue(D, S, P, now);
      else ans = mkAbstain('I cannot answer this from the data. Ask about overall score, stopped time, speed, rejects, bottles made or preforms left, for Line 1 or Line 2.', now);
    } catch (e) { ans = mkAbstain('I could not work this out from the data (' + e.message + ').', now); }
  }
  if (ans.kind === 'answer') {
    const bad = ans.facts.filter(f => !f.ok);
    if (bad.length) ans = Object.assign(mkAbstain('I cannot confirm this. ' + bad.length + ' number' + (bad.length > 1 ? 's' : '') + ' did not pass the check, so I do not show the answer.', now), { failed: bad });
    else { ans.shown = fillText(ans.text, ans.facts); ans.check = { total: ans.facts.length, ok: ans.facts.length }; }
  }
  ans.question = String(text); ans.parsed = { lines: P.lines, measure: P.measure, range: P.range, label: P.label, day: P.day, at: P.at, explicitLine: P.explicitLine };
  return ans;
}
