// ===== Part 5a: Data Explorer - question reading, helpers, simple answers =====
const MNAME = { sep: 8, september: 8 };
const DATA_END = N - 1;
function dayRange(d) { const a = T(d, 0, 0); return [Math.max(0, a), Math.min(N - 1, a + 1439)]; }
function calDay(m) { return dt(m).getUTCDate(); }
function prodDayOf(m) { return Math.floor(m / 1440); }
function parseQ(raw, now, S, hist) {
  const q = ' ' + raw.toLowerCase().replace(/[?!]/g, ' ') + ' ', P = { raw, q, lines: [], measure: null, range: null, at: null, notes: [], abstain: null };
  // lines
  const lm = [...q.matchAll(/\bline\s*(\d)\b|\bl(\d)\b/g)].map(m => +(m[1] || m[2]));
  if (lm.some(x => x > 2 || x < 1)) { P.abstain = { why: 'unknown', text: 'Line ' + lm.find(x => x > 2 || x < 1) + ' is not in the data. The data has Line 1 and Line 2.' }; return P; }
  P.lines = [...new Set(lm.map(x => x - 1))];
  if (/\bboth\b|\ball lines\b|\beach line\b|\bplant\b/.test(q)) P.lines = [0, 1];
  P.explicitLine = P.lines.length > 0;
  // measure
  const M = [['oee', /\boee\b|overall score|overall equipment|efficiency/], ['cover', /preform|stock|cover|material/], ['rej', /reject|defect|scrap|quality|bad bottles/], ['stop', /stop|down ?time|fault|breakdown/], ['speed', /speed|slow|pace/], ['output', /output|produced|production|bottles|volume/]];
  for (const [k, re] of M) if (re.test(q)) { P.measure = k; break; }
  P.reason = FAULTS.find(r => q.includes(r.toLowerCase().split(' ')[0] === 'material' ? 'preform' : r.toLowerCase().split(' (')[0].split(' - ')[0])) || null;
  if (/labeler|label/.test(q) && !/misaligned/.test(q)) P.reason = P.reason || 'Labeler misfeed';
  P.defect = DEFECTS.find(r => q.includes(r.toLowerCase().split(' ')[0])) || null;
  const sh = q.match(/\bshift\s*([abc])\b/); P.shift = sh ? sh[1].toUpperCase() : null;
  // forecasts, opinions, things that are not in the data
  if (/\b(will|forecast|predict|predicted|tomorrow|next (week|shift|day|month|hour)|going to|expect|projected|upcoming)\b/.test(q)) { P.abstain = { why: 'future', text: 'A forecast is not in the data. I read only what already happened, up to ' + full(now) + '.' }; return P; }
  const miss = q.match(/\b(costs? (of|per)|how much did .* cost|price|pricing|profit|revenue|money|dollars?|sgd|usd|energy|kwh|electric\w*|water use|power use|temperature|headcount|employees?|salary|customers?|sales|weather|co2|emissions?|supplier name|operator name|who)\b/);
  if (miss) { P.abstain = { why: 'missing', text: '"' + miss[1] + '" is not in the data.' }; return P; }
  if (/\b(should|opinion|do you think|feel|blame|recommend)\b/.test(q)) { P.abstain = { why: 'opinion', text: 'That is a judgment, not a fact in the data. I can show the numbers behind it.' }; return P; }
  // time
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  let day = null, mon = null;
  for (const m of q.matchAll(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s*)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6})\b|\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6})\s*(\d{1,2})\b/g)) { // month names only, so 'about 6 Sep' still finds 6 Sep
    const d = m[1] ? +m[1] : +m[4], mm = (m[2] || m[3] || '').slice(0, 3);
    if (MON.includes(mm)) { day = d; mon = mm; break; }
  }
  const cm = q.match(/\b(\d{1,2})[:.](\d{2})\b/) || q.match(/\b(?:at|around)\s+(\d{1,2})\s*(am|pm)\b/);
  let clock = null; if (cm) { let h = +cm[1], mi = cm[2] === 'am' ? 0 : cm[2] === 'pm' ? 0 : +cm[2]; if (cm[2] === 'pm' && h < 12) h += 12; if (cm[2] === 'am' && h === 12) h = 0; clock = [h, mi]; }
  if (mon && mon !== 'sep') { P.abstain = { why: 'outside', text: day + ' ' + mon + ' is outside the data.' }; return P; }
  if (day != null && (day < 1 || day > 15)) { P.abstain = { why: 'outside', text: day + ' Sep is outside the data.' }; return P; }
  if (day != null && clock) { P.at = T(day, clock[0], clock[1]); P.range = [P.at, P.at]; P.label = full(P.at); }
  else if (day != null) { P.range = dayRange(day); P.label = day + ' Sep'; P.day = day; }
  else if (clock && /\b(at|around)\b/.test(q)) { const cur = dt(now); P.at = T(cur.getUTCDate() - (clock[0] * 60 + clock[1] > (cur.getUTCHours() * 60 + cur.getUTCMinutes()) ? 1 : 0), clock[0], clock[1]); P.range = [P.at, P.at]; P.label = full(P.at); }
  else if (/\byesterday\b/.test(q)) { const d = calDay(now) - 1, r = dayRange(d); P.range = r; P.label = 'yesterday (' + d + ' Sep)'; P.day = d; }
  else if (/\btoday\b|this day/.test(q)) { const r = dayRange(calDay(now)); P.range = [r[0], now]; P.label = 'today so far (since 00:00 on ' + calDay(now) + ' Sep)'; }
  else if (/last hour|past hour|last 60/.test(q)) { P.range = [now - 59, now]; P.label = 'the last hour'; }
  else if (/last 24|past 24|last day/.test(q)) { P.range = [now - 1439, now]; P.label = 'the last 24 hours'; }
  else if (/last 7 days|last week|past week|this week/.test(q)) { P.range = [now - 10079, now]; P.label = 'the last 7 days'; }
  else if (/this shift|current shift/.test(q)) { const s0 = Math.floor(now / 480) * 480; P.range = [s0, now]; P.label = 'this shift (since ' + hhmm(s0) + ')'; }
  else if (/\bnow\b|right now|currently|at the moment|\bcurrent\b/.test(q)) { P.at = now; P.range = [Math.max(0, now - 59), now]; P.label = 'the last hour to ' + full(now); P.isNow = true; }
  if (P.range && P.range[0] > now) { P.abstain = { why: 'after', text: P.label + ' is after the current time (' + full(now) + '). I read data only up to now. Move the time bar forward, or ask about an earlier time.' }; return P; }
  if (P.range && P.range[1] > now) { P.range = [P.range[0], now]; P.label += ' (up to now)'; }
  if (P.range) P.range[0] = Math.max(0, P.range[0]);
  // follow-ups: take missing parts from earlier questions (chat memory)
  const own = P.explicitLine || P.measure || P.range || P.at != null || P.shift || P.reason || P.defect, follow = /\b(and|what about|how about|same|that|then|it|those|there|also)\b/.test(q), short = raw.trim().split(/\s+/).length <= 6 && (own || follow);
  if (hist && hist.length) {
    const mem = hist.slice(-Math.max(1, Math.round(S.memory / 2))).reverse();
    for (const h of mem) {
      if (!P.explicitLine && h.lines && h.lines.length && short) { P.lines = h.lines.slice(); P.inherited = true; }
      if (!P.measure && h.measure && short) { P.measure = h.measure; P.inherited = true; }
      if (!P.range && h.range && short) { P.range = h.range.slice(); P.label = h.label; P.day = h.day; P.inherited = true; }
      if (P.lines.length && P.measure && P.range) break;
    }
  }
  return P;
}
// brute-force totals over minutes (independent of the prefix sums): used for the number check
function brute(D, l, a, b) { const L = D.L[l]; let run = 0, flt = 0, pln = 0, prd = 0, rj = 0; for (let i = a; i <= b; i++) { const s = L.st[i]; if (s === 0) run++; else if (s === 1) flt++; else pln++; prd += L.prod[i]; rj += L.rej[i]; } return { run, flt, pln, prd, rj, len: b - a + 1 }; }
function hourly(D, l, a, b) { const rows = []; for (let h = a - (a % 60 === 0 ? 0 : a % 60); h <= b; h += 60) { const x = Math.max(h, a), y = Math.min(h + 59, b), r = rangeStats(D, l, x, y); rows.push([isoTs(x), LID[l], r.prd, r.rj, r.flt, r.pln, r.oee == null ? null : +(r.oee * 100).toFixed(1)]); } return rows; }
const isoTs = m => { const d = dt(m); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + ' ' + hhmm(m); };
const HCOLS = ['hour_start', 'line', 'produced', 'rejects', 'stopped_min', 'planned_min', 'oee_%'];
function mkFacts() { const facts = []; return { facts, add(label, value, shown, check) { const id = 'f' + (facts.length + 1); facts.push({ id, label, value, shown, check, ok: check != null && Math.abs(value - check) < 1e-6 }); return '{{' + id + '}}'; } }; }
function rowCap(S, rows) { const cap = Math.round(S.rows); return rows.length > cap ? { rows: rows.slice(0, cap), total: rows.length, cut: true } : { rows, total: rows.length, cut: false }; }
function bucketTrend(D, S, lines, a, b, fn) { // series of fn(l, x, y) over hourly or daily buckets
  const span = b - a + 1, step = span > 72 * 60 ? 1440 : span > 12 * 60 ? 60 : 15, series = [];
  for (const l of lines) { const pts = []; for (let x = a; x <= b; x += step) { const y = Math.min(b, x + step - 1); if (y - x + 1 < Math.min(step, 15)) continue; pts.push([x, fn(l, x, y)]); } series.push({ name: LNAME[l], line: l, pts }); }
  return { series, step };
}
const MEAS = {
  oee: { name: 'Overall score', unit: '%', f: (D, l, x, y) => { const r = rangeStats(D, l, x, y); return r.oee == null ? null : r.oee * 100; } },
  stop: { name: 'Stopped time', unit: ' min', f: (D, l, x, y) => ws(D.P[l].flt, x, y) },
  speed: { name: 'Speed', unit: '%', f: (D, l, x, y) => { const r = rangeStats(D, l, x, y); return r.perf == null ? null : r.perf * 100; } },
  rej: { name: 'Rejects', unit: '%', f: (D, l, x, y) => { const r = rangeStats(D, l, x, y); return r.rejRate == null ? null : r.rejRate * 100; } },
  output: { name: 'Bottles made', unit: '', f: (D, l, x, y) => ws(D.P[l].prd, x, y) }
};
const SIMPLE = { kind: 'answer' };
function lensSimple(D, S, P, l, a, b, key, valueOf, fmt) {
  const len = b - a + 1, out = { before: [], same: [], past: [] };
  const pa = a - len, pb = a - 1;
  if (pa >= 0) { const v0 = valueOf(l, pa, pb), v1 = valueOf(l, a, b); out.before.push('Period before (' + dlabel(pa) + ' ' + hhmm(pa) + ' to ' + dlabel(pb) + ' ' + hhmm(pb) + '): ' + fmt(v0) + ' against ' + fmt(v1) + ' now.'); }
  else out.before.push('No earlier period of the same length is in the data.');
  const o = 1 - l; out.same.push(LNAME[o] + ' in the same period: ' + fmt(valueOf(o, a, b)) + '.');
  const days = []; for (let d = 0; d < DAYS; d++) { const x = d * 1440, y = x + 1439; if (y > b + 1440 || (x >= a && y <= b) || y > DATA_END) continue; if (x > b) continue; const v = valueOf(l, x, y); if (v != null) days.push([d, v]); }
  const cur = valueOf(l, a, b); if (cur != null && days.length) { days.sort((p, q) => Math.abs(p[1] - cur) - Math.abs(q[1] - cur)); out.past = days.slice(0, Math.round(S.simK)).map(([d, v]) => LNAME[l] + ' on ' + dlabel(d * 1440) + ': ' + fmt(v)); }
  if (!out.past.length) out.past.push('No other full day is in the data yet.');
  return out;
}

function ansValue(D, S, P, now) {
  const lines = P.lines.length ? P.lines : [0, 1], meas = P.measure || 'oee', [a, b] = P.range || [0, now], F = mkFacts();
  if (meas === 'cover') {
    const at = P.at != null ? P.at : now, parts = lines.map(l => LNAME[l] + ' has preforms for ' + F.add(LNAME[l] + ' preforms left', kv(D, 'cover', l, at), fmtKpi('cover', kv(D, 'cover', l, at)), slowKv(D, 'cover', l, at)) + ' (stock ' + num(D.L[l].stock[at]) + ')');
    const rows = lines.map(l => [isoTs(at), LID[l], D.L[l].stock[at], D.L[l].prod[at], Math.round(pace30(D, l, at) * 10) / 10]);
    return { kind: 'answer', intent: 'value', text: parts.join('. ') + ' at ' + full(at) + '.', facts: F.facts, queried: [{ table: 'minute_readings', filter: 'preform_stock at ' + full(at) + ', ' + lines.map(l => LID[l]).join(' + '), rows: lines.length }, { table: 'minute_readings', filter: 'last 30 min, bottles per running minute (pace)', rows: lines.length * 30 }], raw: { table: 'minute_readings', cols: ['ts', 'line', 'preform_stock', 'produced', 'pace_per_min'], rows, total: rows.length, cut: false }, trend: bucketTrend(D, S, lines, Math.max(0, at - 720), at, (l, x, y) => D.L[l].stock[y]), trendInfo: { name: 'Preform stock', unit: '', note: 'Stock over the last 12 hours.' }, lens: { before: ['Stock moves up when a delivery arrives and down while the line runs.'], same: lines.map(l => LNAME[l] + ' pace: ' + (Math.round(pace30(D, l, at) * 10) / 10) + ' bottles per running minute.'), past: [] } };
  }
  const spec = MEAS[meas] || MEAS.oee, label = P.label || 'all data up to now (' + full(now) + ')';
  const valueOf = (l, x, y) => spec.f(D, l, x, y), fmt = v => v == null ? '–' : (meas === 'output' ? num(v) : v.toFixed(meas === 'rej' ? 1 : 0)) + spec.unit;
  const bl = lines.map(l => {
    const v = valueOf(l, a, b), br = brute(D, l, a, b); let chk = null;
    if (meas === 'oee') chk = br.len - br.pln >= 15 ? (br.prd - br.rj) / (IDEAL[l] * (br.len - br.pln)) * 100 : null;
    if (meas === 'stop') chk = br.flt; if (meas === 'speed') chk = br.run ? br.prd / (IDEAL[l] * br.run) * 100 : null;
    if (meas === 'rej') chk = br.prd ? br.rj / br.prd * 100 : null; if (meas === 'output') chk = br.prd;
    const sh = F.add(LNAME[l] + ' ' + spec.name.toLowerCase(), v == null ? 0 : v, fmt(v), chk == null ? 0 : chk);
    let extra = ''; if (meas === 'rej') extra = ' (' + F.add(LNAME[l] + ' rejected bottles', br.rj, num(br.rj), ws(D.P[l].rj, a, b)) + ' of ' + F.add(LNAME[l] + ' bottles made', br.prd, num(br.prd), ws(D.P[l].prd, a, b)) + ')';
    if (meas === 'stop') extra = ' out of ' + num(br.len) + ' min';
    return LNAME[l] + ': ' + sh + extra;
  });
  const rowsAll = []; lines.forEach(l => rowsAll.push(...hourly(D, l, a, b)));
  const rc = rowCap(S, rowsAll), tr = bucketTrend(D, S, lines, a, b, valueOf);
  const lens = lensSimple(D, S, P, lines[0], a, b, meas, valueOf, fmt);
  const noun = { oee: 'overall score', stop: 'stopped time (faults only)', speed: 'speed against ideal while running', rej: 'rejects', output: 'bottles made' }[meas];
  return { kind: 'answer', intent: 'value', text: 'For ' + label + ', ' + noun + ' was - ' + bl.join('; ') + '.', facts: F.facts, queried: [{ table: 'minute_readings', filter: lines.map(l => LID[l]).join(' + ') + ', ' + isoTs(a) + ' to ' + isoTs(b), rows: lines.length * (b - a + 1) }, { table: 'hourly_production', filter: 'same range, one row per hour', rows: rc.total }], raw: { table: 'hourly_production', cols: HCOLS, rows: rc.rows, total: rc.total, cut: rc.cut }, trend: tr, trendInfo: { name: spec.name, unit: spec.unit, note: 'Per ' + (tr.step === 1440 ? 'day' : tr.step === 60 ? 'hour' : '15 min') + '.' }, lens };
}
function ansTop(D, S, P, now) {
  const lines = P.lines.length ? P.lines : [0, 1], [a, b] = P.range || [0, now], F = mkFacts(), label = P.label || 'all data up to now (' + full(now) + ')';
  const wantDef = P.measure === 'rej' || !!P.defect, names = wantDef ? DEFECTS : FAULTS.filter(r => r !== 'Material shortage - preforms' || true);
  const tot = {}, cnt = {}; names.forEach(n => { tot[n] = 0; cnt[n] = 0; });
  if (wantDef) lines.forEach(l => DEFECTS.forEach((n, j) => { tot[n] += sumR(D.L[l].dc[j], a, b); })); else lines.forEach(l => D.evL[l].forEach(e => { if (e.planned) return; const x = Math.max(e.start, a), y = Math.min(e.end - 1, b); if (y >= x) { tot[e.reason] += y - x + 1; cnt[e.reason]++; } }));
  const rank = names.map(n => [n, tot[n]]).sort((p, q) => q[1] - p[1]).filter(x => x[1] > 0), sum = rank.reduce((s, x) => s + x[1], 0);
  if (!rank.length) return { kind: 'answer', intent: 'top', text: 'No ' + (wantDef ? 'rejects' : 'stops') + ' were logged for ' + label + '.', facts: [], queried: [{ table: wantDef ? 'defects' : 'downtime_events', filter: label, rows: 0 }], raw: { table: wantDef ? 'defects' : 'downtime_events', cols: ['ts'], rows: [], total: 0, cut: false }, trend: { series: [], step: 1440 }, trendInfo: { name: '', unit: '', note: '' }, lens: { before: [], same: [], past: [] } };
  const top = rank[0][0], unit = wantDef ? ' bottles' : ' min', chkTop = (() => { let s = 0; lines.forEach(l => { if (wantDef) s += sumR(D.L[l].dc[DEFECTS.indexOf(top)], a, b); else for (let i = a; i <= b; i++) if (D.L[l].st[i] === 1 && D.L[l].rid[i] === FAULTS.indexOf(top) + 1) s++; }); return s; })();
  const t1 = F.add('Top ' + (wantDef ? 'defect' : 'stop reason') + ' total', rank[0][1], num(rank[0][1]) + unit, chkTop), sh = F.add('Share of all ' + (wantDef ? 'rejects' : 'stop minutes'), rank[0][1] / sum * 100, Math.round(rank[0][1] / sum * 100) + '%', chkTop / sum * 100);
  const second = rank[1] ? '. Next: ' + rank.slice(1, 3).map(x => x[0] + ' ' + F.add(x[0], x[1], num(x[1]) + unit, x[1])).join(', ') : '';
  const lname = lines.length === 2 ? 'both lines together' : LNAME[lines[0]];
  const rowsAll = []; if (wantDef) lines.forEach(l => { const j = DEFECTS.indexOf(top); for (let i = a; i <= b; i++) if (D.L[l].dc[j][i]) rowsAll.push([isoTs(i), LID[l], top, D.L[l].dc[j][i]]); }); else lines.forEach(l => D.evL[l].forEach(e => { if (!e.planned && e.reason === top && e.end - 1 >= a && e.start <= b) rowsAll.push([e.id, LID[l], isoTs(e.start), e.minutes, e.reason, e.comment]); }));
  rowsAll.sort((p, q) => String(p[2]).localeCompare(String(q[2])) || 0);
  const rc = rowCap(S, rowsAll), valueOf = (l, x, y) => { if (wantDef) return sumR(D.L[l].dc[DEFECTS.indexOf(top)], x, y); let s = 0; for (const e of D.evL[l]) { if (e.planned || e.reason !== top) continue; const u = Math.max(e.start, x), v = Math.min(e.end - 1, y); if (v >= u) s += v - u + 1; } return s; };
  const tr = bucketTrend(D, S, lines, a, b, valueOf), lens = lensSimple(D, S, P, lines[0], a, b, 'top', valueOf, v => v == null ? '–' : num(v) + unit);
  lens.before[0] = lens.before[0].replace('against', top + ': against');
  return { kind: 'answer', intent: 'top', text: 'For ' + label + ' on ' + lname + ', the top ' + (wantDef ? 'defect' : 'stop reason') + ' is "' + top + '": ' + t1 + ' (' + sh + ' of all' + (wantDef ? ' rejects' : ' stop minutes') + ')' + second + '.', facts: F.facts, queried: [{ table: wantDef ? 'defects' : 'downtime_events', filter: lines.map(l => LID[l]).join(' + ') + ', ' + isoTs(a) + ' to ' + isoTs(b) + (wantDef ? '' : ', unplanned only'), rows: rc.total }], raw: { table: wantDef ? 'defects' : 'downtime_events', cols: wantDef ? ['ts', 'line', 'code', 'qty'] : ['id', 'line', 'start', 'minutes', 'reason', 'comment'], rows: rc.rows, total: rc.total, cut: rc.cut }, trend: tr, trendInfo: { name: top, unit, note: 'Per ' + (tr.step === 1440 ? 'day' : tr.step === 60 ? 'hour' : '15 min') + '.' }, lens, ranking: rank };
}
function ansShifts(D, S, P, now) {
  const lines = P.lines.length ? P.lines : [0, 1], [a, b] = P.range || [0, now], F = mkFacts(), label = P.label || 'all data up to now (' + full(now) + ')', rows = [];
  const spts = {}, acc = lines.map(() => [0, 1, 2].map(() => ({ good: 0, den: 0 })));
  lines.forEach((l, li) => { for (let blk = Math.floor(a / 480); blk * 480 + 479 <= Math.min(b, now); blk++) { const x = blk * 480, y = x + 479, r = rangeStats(D, l, x, y), s = blk % 3; acc[li][s].good += r.good; acc[li][s].den += IDEAL[l] * (r.len - r.pln); rows.push([dlabel(x), SHIFTS[s], LID[l], r.prd, r.rj, r.flt, r.pln, r.oee == null ? null : +(r.oee * 100).toFixed(1)]); if (r.oee != null) (spts[LID[l] + s] = spts[LID[l] + s] || []).push([x, +(r.oee * 100).toFixed(1)]); } });
  const parts = lines.map((l, li) => { const v = acc[li].map(c => c.den ? c.good / c.den * 100 : null); const lo = v.reduce((m, x, i) => x != null && (m < 0 || x < v[m]) ? i : m, -1); const chk = [0, 1, 2].map(s => { let g = 0, d = 0; rows.filter(r => r[2] === LID[l] && r[1] === SHIFTS[s]).forEach(r => { g += r[3] - r[4]; }); for (let blk = Math.floor(a / 480); blk * 480 + 479 <= Math.min(b, now); blk++) if (blk % 3 === s) { const br = brute(D, l, blk * 480, blk * 480 + 479); d += IDEAL[l] * (br.len - br.pln); } return d ? g / d * 100 : null; });
    return LNAME[l] + ': ' + SHIFTS.map((n, s) => 'shift ' + n + ' ' + F.add(LNAME[l] + ' shift ' + n, v[s] == null ? 0 : v[s], v[s] == null ? '–' : Math.round(v[s]) + '%', chk[s] == null ? 0 : chk[s])).join(', ') + (lo >= 0 ? ' (lowest: shift ' + SHIFTS[lo] + ')' : ''); });
  const rc = rowCap(S, rows), series = lines.slice(0, 1).flatMap(l => SHIFTS.map((n, s) => ({ name: LNAME[l] + ' shift ' + n, line: l, shift: s, pts: spts[LID[l] + s] || [] })));
  const lens = { before: ['Each shift is one 8-hour block: A 06-14, B 14-22, C 22-06.'], same: lines.length === 2 ? ['Both lines are compared in the answer.'] : [LNAME[1 - lines[0]] + ' is not in this answer. Ask "compare shifts on both lines".'], past: ['The trend shows the shift scores for each day.'] };
  return { kind: 'answer', intent: 'shifts', text: 'For ' + label + ', overall score by shift - ' + parts.join('; ') + '.', facts: F.facts, queried: [{ table: 'oee_by_shift', filter: lines.map(l => LID[l]).join(' + ') + ', full shifts from ' + isoTs(a) + ' to ' + isoTs(Math.min(b, now)), rows: rc.total }], raw: { table: 'oee_by_shift', cols: ['date', 'shift', 'line', 'produced', 'rejects', 'stopped_min', 'planned_min', 'oee_%'], rows: rc.rows, total: rc.total, cut: rc.cut }, trend: { series, step: 480, shiftMode: true }, trendInfo: { name: 'Overall score by shift', unit: '%', note: 'Shows ' + LNAME[lines[0]] + '. Each point is one shift block.' }, lens };
}
