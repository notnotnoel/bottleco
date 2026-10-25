// ===== Part 3: cause tests, three lenses, similar past events =====
const HYP = {
  late_supply: 'Late preform delivery', startup_after_cip: 'Start-up after a clean', after_changeover: 'Changeover to a new product',
  capper_drift: 'Capper torque drifting', shift_handover: 'Shift handover', setpoint_lowered: 'Line speed set lower',
  plant_wide: 'Both lines stopped together', normal_noise: 'Normal ups and downs'
};
const ORDER = {
  cover: ['late_supply', 'plant_wide', 'startup_after_cip', 'setpoint_lowered', 'shift_handover', 'after_changeover', 'capper_drift', 'normal_noise'],
  stop: ['startup_after_cip', 'late_supply', 'plant_wide', 'shift_handover', 'capper_drift', 'after_changeover', 'setpoint_lowered', 'normal_noise'],
  speed: ['setpoint_lowered', 'shift_handover', 'plant_wide', 'startup_after_cip', 'late_supply', 'capper_drift', 'after_changeover', 'normal_noise'],
  rej: ['after_changeover', 'capper_drift', 'startup_after_cip', 'setpoint_lowered', 'shift_handover', 'plant_wide', 'late_supply', 'normal_noise'],
  oee: ['late_supply', 'startup_after_cip', 'plant_wide', 'setpoint_lowered', 'shift_handover', 'after_changeover', 'capper_drift', 'normal_noise']
};
const PLAYBOOK = {
  late_supply: 'Ask the supplier when the truck arrives. Plan the stop. Check if the other line can lend preforms.',
  startup_after_cip: 'After a clean, check the filler valves and bottle guides for water or residue. Start slower after each clean.',
  after_changeover: 'Check label position, fill level and neck guides against the recipe of the new product.',
  capper_drift: 'Check capper torque and retorque the heads. Hold the last bottles and test their cap torque.',
  shift_handover: 'Ask the new crew to check line settings and guides at each handover.',
  setpoint_lowered: 'Ask the operator why the speed is lower. Read the note. Set the speed back when the cause is fixed.',
  plant_wide: 'Check site power and air. Tell maintenance that both lines stopped together.',
  none: 'No cause is proven. Ask the operator. Watch the next 60 minutes.'
};
const pctS = (v, d) => (v * 100).toFixed(d || 0) + '%';
const sumR = (arr, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += arr[i]; return s; };
const num = v => Math.round(v).toLocaleString('en-US');

// where did the trouble start? (uses data up to t0 only)
function onsetOf(D, l, key, t0) {
  const L = D.L[l], span = { oee: 59, stop: 59, speed: 14, rej: 29, cover: 0 }[key], a = Math.max(0, t0 - span);
  if (key === 'cover') return t0;
  if (key === 'rej') { for (let m = a; m <= t0; m++) { let r = 0, p = 0; for (let j = Math.max(a, m - 4); j <= m; j++) { r += L.rej[j]; p += L.prod[j]; } if (p > 0 && r / p > 0.025) { for (let j = Math.max(a, m - 4); j <= m; j++) if (L.prod[j] > 0) return j; return m; } } return t0; }
  if (key === 'speed') { for (let m = a; m <= t0; m++) if (L.st[m] === 0 && L.sp[m] < 0.7) return m; return t0; }
  const slow5 = j => { if (j < 4) return false; let s = 0; for (let i = j - 4; i <= j; i++) { if (L.st[i] !== 0) return false; s += L.sp[i]; } return s / 5 < 0.75; };
  const bad = j => L.st[j] === 1 || slow5(j);
  let m = t0; while (m >= a && !bad(m)) m--;
  if (m < a) return t0;
  let start = m, gap = 0;
  for (let j = m; j >= a; j--) { if (bad(j)) { start = j; gap = 0; } else if (L.st[j] !== 2) { gap++; if (gap > 20) break; } }
  return start;
}
function normalAt(D, S, key, l, t) { // the same clock time on earlier days
  const v = []; for (let k = 1; k <= Math.round(S.baseDays); k++) { const x = t - k * 1440; if (x < 60) break; const y = kv(D, key, l, x); if (y != null) v.push(y); }
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, sd, n: v.length, v };
}

function rcaCore(D, S, l, key, t0, ta) {
  const o = 1 - l, L = D.L[l], P = D.P[l], Po = D.P[o], ev = D.evL[l], evo = D.evL[o], fmtT = hhmm;
  const on = Math.min(onsetOf(D, l, key, t0), ta);
  const done = e => e.end - 1 <= ta;
  const clip = (list, a, b, f) => { const r = {}; for (const e of list) { if (e.planned) continue; const x = Math.max(e.start, a), y = Math.min(e.end - 1, b, ta); if (y >= x) r[e.reason] = (r[e.reason] || 0) + y - x + 1; } return r; };
  const tot = r => Object.values(r).reduce((a, b) => a + b, 0);
  const lost = (list, a, b) => tot(clip(list, a, b));
  const rate = (PP, a, b) => { a = Math.max(0, a); const p = ws(PP.prd, a, b); return p > 0 ? ws(PP.rj, a, b) / p : null; };
  const H = {};
  H.late_supply = () => {
    let mc = 1e9; for (let t = Math.max(60, ta - 60); t <= ta; t += 5) mc = Math.min(mc, kv(D, 'cover', l, t));
    const c1 = { ok: mc < 90, text: 'Preform cover is under 90 min', detail: 'Lowest cover in the last hour: ' + fmtKpi('cover', mc) + '. Stock now ' + num(L.stock[ta]) + ' preforms.' };
    const due = D.sched.filter(x => x.line === l && x.due <= ta).sort((a, b) => b.due - a.due)[0];
    let c2;
    if (!due) c2 = { ok: false, text: 'A delivery is late', detail: 'No delivery was due yet.' };
    else { const arrived = due.arr <= ta, late = (arrived ? due.arr : ta) - due.due; c2 = { ok: late > 30, text: 'A delivery is late', detail: due.po + ' was due ' + fmtT(due.due) + '. ' + (arrived ? 'It came ' + late + ' min late.' : 'It had not arrived by ' + fmtT(ta) + ' (' + late + ' min late).') }; }
    const prev = D.sched.filter(x => x.line === l && x.due <= ta && (!due || x.po !== due.po) && x.arr <= ta), onTime = prev.filter(x => x.arr - x.due <= 30).length;
    const c3 = { ok: prev.length >= 5 && onTime / prev.length >= 0.8, text: 'Late deliveries are rare', detail: onTime + ' of ' + prev.length + ' earlier deliveries came within 30 min of the due time.' };
    const mo = kv(D, 'cover', o, ta);
    return [c1, c2, c3, { ok: mo > 90, text: LNAME[o] + ' has enough preforms', detail: LNAME[o] + ' has ' + fmtKpi('cover', mo) + ' of preforms.' }];
  };
  H.startup_after_cip = () => {
    const cips = D.cipL[l].filter(done), last = cips[cips.length - 1], gap = last ? on - last.end : null;
    const c1 = { ok: !!last && gap >= -2 && gap <= 90, text: 'A clean ended shortly before the trouble began', detail: last ? 'The last clean ended ' + fmtT(last.end) + ', ' + (gap >= 0 ? gap + ' min before' : 'at the start of') + ' the trouble (' + fmtT(on) + ').' : 'No clean has run yet.' };
    const br = clip(ev, on, ta), tt = tot(br), fj = br['Filler jam'] || 0;
    const c2 = { ok: tt >= 5 && fj / tt >= 0.6, text: 'Filler jams are most of the lost time', detail: fj + ' of ' + tt + ' lost minutes were filler jams.' };
    let c3 = { ok: false, text: 'Jams were also more frequent after earlier cleans', detail: 'Skipped: no clean before the trouble.' };
    if (c1.ok) {
      const prev = cips.filter(e => e !== last && e.end + 60 <= on - 30);
      let jm = 0; for (const e of prev) jm += clip(ev, e.end, e.end + 59)['Filler jam'] || 0;
      const allJ = ev.filter(e => !e.planned && e.reason === 'Filler jam' && e.end - 1 < on - 60).reduce((s, e) => s + e.minutes, 0);
      const normal = allJ / Math.max(1, (on - 60) / 60), after = prev.length ? jm / prev.length : 0;
      c3 = { ok: prev.length >= 2 && normal > 0 && after / normal >= 1.5, text: 'Jams were also more frequent after earlier cleans', detail: 'In the hour after ' + prev.length + ' earlier cleans, filler jams averaged ' + after.toFixed(1) + ' min. In a normal hour: ' + normal.toFixed(1) + ' min.' };
    }
    const fo = lost(evo, on, ta);
    return [c1, c2, c3, { ok: fo * 2 <= tt, text: LNAME[o] + ' was calm', detail: LNAME[o] + ' lost ' + fo + ' min in the same period. ' + LNAME[l] + ' lost ' + tt + ' min.' }];
  };
  H.after_changeover = () => {
    const ch = D.chgL[l].filter(done), last = ch[ch.length - 1], gap = last ? on - last.end : null;
    const info = last && D.changeovers.find(c => c.line === l && c.start === last.start);
    const c1 = { ok: !!last && gap >= -2 && gap <= 60, text: 'A changeover ended shortly before rejects rose', detail: last ? 'The last changeover (' + info.from + ' to ' + info.to + ') ended ' + fmtT(last.end) + ', ' + (gap >= 0 ? gap + ' min before' : 'at the start of') + ' the trouble.' : 'No changeover has run yet.' };
    const base = rate(P, 0, Math.max(0, on - 1)), now = last ? rate(P, Math.max(on, last.end), ta) : null;
    const c2 = { ok: now != null && base != null && now >= Math.max(0.025, 2 * base), text: 'Rejects are far above normal', detail: now == null ? 'No bottles made since then.' : 'Rejects: ' + pctS(now, 1) + ' since the changeover. Normal: ' + pctS(base || 0, 1) + '.' };
    let c3 = { ok: false, text: 'Rejects were also higher after earlier changeovers', detail: 'Skipped: no changeover before the trouble.' };
    if (c1.ok) {
      const prev = ch.filter(e => e !== last && e.end + 60 <= on - 60); let r = 0, p = 0; for (const e of prev) { r += ws(P.rj, e.end, e.end + 39); p += ws(P.prd, e.end, e.end + 39); }
      const rr = p ? r / p : 0;
      c3 = { ok: prev.length >= 2 && base > 0 && rr / base >= 1.3, text: 'Rejects were also higher after earlier changeovers', detail: 'In the 40 min after ' + prev.length + ' earlier changeovers, rejects averaged ' + pctS(rr, 1) + '. Normal: ' + pctS(base || 0, 1) + '.' };
    }
    const ro = rate(Po, ta - 29, ta);
    return [c1, c2, c3, { ok: ro != null && ro < 0.02, text: LNAME[o] + ' rejects are normal', detail: LNAME[o] + ' rejects: ' + (ro == null ? '–' : pctS(ro, 1)) + ' in the last 30 min.' }];
  };
  H.capper_drift = () => {
    const mean = (PP, a, b) => (PP.tor[b + 1] - PP.tor[Math.max(0, a)]) / (b - Math.max(0, a) + 1);
    const norm = on > 500 ? mean(P, 0, on - 240) : 2.5, now = mean(P, ta - 19, ta);
    const c1 = { ok: now < norm - 0.15, text: 'Cap torque is well below normal', detail: 'Cap torque averaged ' + now.toFixed(2) + ' Nm in the last 20 min. Normal: ' + norm.toFixed(2) + ' Nm.' };
    const before = ta >= 120 ? mean(P, ta - 119, ta - 100) : now;
    const c2 = { ok: before - now >= 0.12, text: 'Cap torque slid down over time', detail: 'Cap torque fell by ' + (before - now).toFixed(2) + ' Nm in 2 hours.' };
    const rj = sumR(L.rej, ta - 29, ta), cd = sumR(L.dc[2], ta - 29, ta);
    const c3 = { ok: rj >= 10 && cd / rj >= 0.5, text: '"Cap torque out of spec" is the main reject type', detail: cd + ' of ' + rj + ' rejects in the last 30 min were cap torque.' };
    const no = mean(Po, ta - 19, ta);
    return [c1, c2, c3, { ok: Math.abs(no - 2.5) <= 0.1, text: LNAME[o] + ' cap torque is normal', detail: LNAME[o] + ' cap torque: ' + no.toFixed(2) + ' Nm.' }];
  };
  H.shift_handover = () => {
    const b = Math.floor(on / 480) * 480, since = on - b;
    const c1 = { ok: since <= 30, text: 'The trouble began just after a shift change', detail: 'The trouble began ' + since + ' min after the ' + fmtT(b) + ' shift change.' };
    const mic = ws(P.mc, on, ta), longStop = lost(ev, on, ta);
    const c2 = { ok: mic >= 4 && longStop <= 3, text: 'Many short slowdowns, no long stops', detail: mic + ' slow minutes. ' + longStop + ' min of long stops.' };
    let c3 = { ok: false, text: 'Earlier shift changes were also slower', detail: 'Skipped: the trouble did not start at a shift change.' };
    if (c1.ok) {
      const hist = []; for (let k = 1; b - k * 1440 >= 0; k++) hist.push(ws(P.mc, b - k * 1440, b - k * 1440 + 59));
      const all = ws(P.mc, 0, Math.max(0, b - 1)) / Math.max(1, b / 60), avg = hist.length ? hist.reduce((a, c) => a + c, 0) / hist.length : 0;
      c3 = { ok: hist.length >= 3 && all > 0 && avg / all >= 1.5, text: 'Earlier shift changes were also slower', detail: 'In the hour after ' + hist.length + ' earlier ' + fmtT(b) + ' shift changes: ' + avg.toFixed(1) + ' slow min. In a normal hour: ' + all.toFixed(1) + '.' };
    }
    const run = ws(Po.run, on, ta), so = run >= 5 ? ws(Po.prd, on, ta) / (IDEAL[o] * run) : null;
    return [c1, c2, c3, { ok: so != null && so >= 0.85, text: LNAME[o] + ' kept its speed', detail: LNAME[o] + ' speed: ' + (so == null ? '–' : pctS(so)) + ' in the same period.' }];
  };
  H.setpoint_lowered = () => {
    const ch = D.setpoints.filter(x => x.line === l && x.ts <= ta && x.ts >= ta - 240 && x.to <= x.from - 10).sort((a, b) => b.ts - a.ts)[0];
    const c1 = { ok: !!ch, text: 'Someone set the line speed lower', detail: ch ? 'Set speed went from ' + ch.from + '% to ' + ch.to + '% at ' + fmtT(ch.ts) + '.' : 'No speed-setting change in the last 4 hours.' };
    if (!ch) return [c1, ...['The line ran at its new setting', 'No long stops explain the loss', 'An operator note explains the change'].map(t => ({ ok: false, text: t, detail: 'Skipped: no setting change found.' }))];
    const run = ws(P.run, ch.ts, ta), ratio = run ? ws(P.prd, ch.ts, ta) / (IDEAL[l] * run) : 0, lf = lost(ev, ch.ts, ta);
    return [c1, { ok: ratio >= 0.85 * ch.to / 100, text: 'The line ran at its new setting', detail: 'The line ran at ' + pctS(ratio) + ' of ideal against a ' + ch.to + '% setting.' },
      { ok: lf <= 5, text: 'No long stops explain the loss', detail: 'Long stops since then: ' + lf + ' min.' },
      { ok: !!ch.note, text: 'An operator note explains the change', detail: ch.note ? 'Operator note: "' + ch.note + '".' : 'No note.' }];
  };
  H.plant_wide = () => {
    const mine = ev.filter(e => !e.planned && e.minutes >= 3 && e.start <= ta && e.start >= on - 5 && e.start <= on + 10)[0];
    const near = (e, f) => !f.planned && f.minutes >= 3 && Math.abs(f.start - e.start) <= 3;
    const other = mine && evo.find(f => f.start <= ta && near(mine, f));
    const c1 = { ok: !!other, text: LNAME[o] + ' also stopped at the same time', detail: other ? LNAME[o] + ' stopped at ' + fmtT(other.start) + '. ' + LNAME[l] + ' stopped at ' + fmtT(mine.start) + '.' : 'No stop on ' + LNAME[o] + ' within 3 min.' };
    if (!other) return [c1, ...['Same stop reason on both lines', 'A note names a site problem', 'Both lines stopped together before'].map(t => ({ ok: false, text: t, detail: 'Skipped: only one line stopped.' }))];
    const n1 = D.notes.get(l + ':' + mine.start) || '', n2 = D.notes.get(o + ':' + other.start) || '', hit = [[l, n1], [o, n2]].find(x => /power|air|water|grid|utilit/i.test(x[1]));
    const earlier = ev.filter(e => !e.planned && e.minutes >= 3 && e.end - 1 < on - 60 && evo.some(f => near(e, f) && f.end - 1 < on - 60));
    return [c1, { ok: mine.reason === other.reason, text: 'Same stop reason on both lines', detail: 'Both lines: "' + mine.reason + '".' },
      { ok: !!hit, text: 'A note names a site problem', detail: hit ? 'Note on ' + LNAME[hit[0]] + ': "' + hit[1] + '".' : 'Notes: ' + LNAME[l] + ' "' + (n1 || '–') + '", ' + LNAME[o] + ' "' + (n2 || '–') + '".' },
      { ok: earlier.length >= 1, text: 'Both lines stopped together before', detail: earlier.length ? earlier.length + ' earlier time(s): ' + earlier.map(e => dlabel(e.start) + ' ' + fmtT(e.start) + ', ' + e.minutes + ' min').join('; ') + '.' : 'Never before.' }];
  };
  H.normal_noise = () => {
    const v = kv(D, key, l, ta), nm = normalAt(D, S, key, l, ta), k = KPIS[KEYS.indexOf(key)];
    if (!nm || nm.n < 3) return [{ ok: false, text: 'The value is in its usual range', detail: 'Not enough earlier days to tell.' }, { ok: false, text: 'It was this bad before', detail: 'Not enough earlier days to tell.' }];
    const z = nm.sd > 0 ? Math.abs(v - nm.mean) / nm.sd : (v === nm.mean ? 0 : 9), worse = nm.v.filter(x => k.dir === 'below' ? x <= v : x >= v).length;
    return [{ ok: z < 2, text: 'The value is in its usual range', detail: k.name + ' is ' + fmtKpi(key, v) + '. Same time on ' + nm.n + ' earlier days: ' + fmtKpi(key, nm.mean) + ' on average.' }, { ok: worse >= 2, text: 'It was this bad before', detail: worse + ' of ' + nm.n + ' earlier days were as bad at this time.' }];
  };
  const ord = ORDER[key] || ORDER.oee, n = Math.max(1, Math.min(8, Math.round(S.nCauses)));
  const tested = ord.slice(0, n).map((k, i) => { const checks = H[k](); if (k !== 'normal_noise' && !checks[0].ok) for (let j = 1; j < checks.length; j++) { checks[j].ok = false; checks[j].skipped = true; } const passed = checks.filter(c => c.ok).length; return { key: k, name: HYP[k], checks, passed, total: checks.length, share: passed / checks.length, rank0: i }; });
  tested.sort((a, b) => b.share - a.share || b.passed - a.passed || a.rank0 - b.rank0);
  const thr = S.sure / 100, top = tested[0], sec = tested[1];
  const cause = top && top.key !== 'normal_noise' && top.share >= thr && (!sec || top.share - sec.share >= 0.25) ? top.key : null;
  return { key, t0, on, ta, line: l, tested, cause, top, thr, notTested: ord.slice(n).map(k => HYP[k]) };
}
function rcaIncident(D, S, inc) { const a = inc.alerts[0]; return rcaCore(D, Object.assign({}, S, { sure: 75 }), inc.line, a.key, a.t0, a.ta); }

// ---- similar past events ----
function feat(D, l, t) {
  D.fc = D.fc || {}; const id = l + ':' + t; if (D.fc[id]) return D.fc[id];
  const v = (k, d) => { const x = kv(D, k, l, t); return x == null ? d : x; };
  const lastEnd = list => { let e = -1; for (const x of list) { if (x.end - 1 <= t) e = x.end; else break; } return e; };
  const cip = lastEnd(D.cipL[l]), chg = lastEnd(D.chgL[l]);
  return (D.fc[id] = [v('oee', 0.85) / 0.2, v('stop', 0) / 12, v('speed', 0.93) / 0.12, v('rej', 0.009) / 0.015, Math.min(360, v('cover', 360)) / 100, Math.min(240, cip < 0 ? 240 : t - cip) / 60, Math.min(240, chg < 0 ? 240 : t - chg) / 60, Math.min(120, t % 480) / 60]);
}
function similarPast(D, S, l, t, cap) {
  const f0 = feat(D, l, t), cut = 0.3 + 0.45 * S.simCut / 100, k = Math.round(S.simK), lim = Math.min(cap, t - 180), c = [];
  for (let o = 0; o < 2; o++) for (let u = 120; u <= lim; u += 30) { const f = feat(D, o, u); let d = 0; for (let i = 0; i < 8; i++) d += (f[i] - f0[i]) ** 2; c.push({ line: o, t: u, sim: 1 / (1 + Math.sqrt(d / 8)) }); }
  c.sort((a, b) => b.sim - a.sim);
  const pick = []; for (const x of c) { if (pick.length >= Math.max(k, 1)) break; if (pick.some(p => p.line === x.line && Math.abs(p.t - x.t) < 120)) continue; pick.push(x); }
  const inc = D.lastScan ? D.lastScan.incidents : [];
  pick.forEach(p => { p.kpis = {}; KEYS.forEach(kk => p.kpis[kk] = kv(D, kk, p.line, p.t)); const m = inc.find(i => i.line === p.line && i.start >= p.t - 30 && i.start <= p.t + 90 && i.start <= cap); p.alert = m ? m.id : null; p.weak = p.sim < cut; const P2 = D.P[p.line]; p.next = { stop: ws(P2.flt, p.t + 1, p.t + 90), rej: (() => { const q = ws(P2.prd, p.t + 1, p.t + 90); return q ? ws(P2.rj, p.t + 1, p.t + 90) / q : null; })() }; });
  return { strong: pick.filter(p => !p.weak), closest: pick[0] || null, cut, pool: c.length };
}

// ---- lenses: before/after, same time other signals, similar past ----
function lensesFor(D, S, l, on, ta, cap) {
  const o = 1 - l, ar = Math.round(S.around), a = Math.max(0, on - ar), b = Math.min(cap, ta + ar), items = [];
  for (const e of D.evL[l]) {
    if (e.end - 1 < a || e.start > b) continue;
    const ongoing = e.end - 1 > cap, end = ongoing ? cap + 1 : e.end;
    items.push({ t: e.start, kind: e.planned ? 'planned' : 'stop', text: hhmm(e.start) + '–' + (ongoing ? 'now' : hhmm(end)) + ' ' + (e.planned ? e.reason : 'Stop: ' + e.reason) + ' (' + (end - e.start) + ' min' + (ongoing ? ', still on' : '') + ')' + (e.comment ? ', note "' + e.comment + '"' : '') });
  }
  for (const c of D.setpoints) if (c.line === l && c.ts >= a && c.ts <= b) items.push({ t: c.ts, kind: 'setting', text: hhmm(c.ts) + ' Set speed ' + c.from + '% to ' + c.to + '% – note "' + c.note + '"' });
  for (const d of D.deliveries) if (d.line === l && d.arrived >= a && d.arrived <= b) items.push({ t: d.arrived, kind: 'delivery', text: hhmm(d.arrived) + ' ' + d.po + ' arrived (due ' + hhmm(d.due) + ', ' + num(d.qty) + ' preforms)' });
  for (const d of D.sched) if (d.line === l && d.due >= a && d.due <= b && d.arr > cap) items.push({ t: d.due, kind: 'delivery', text: hhmm(d.due) + ' ' + d.po + ' due – not arrived yet' });
  for (let m = Math.ceil(a / 480) * 480; m <= b; m += 480) items.push({ t: m, kind: 'shift', text: hhmm(m) + ' Shift ' + SHIFTS[shiftOf(m)] + ' starts' });
  items.sort((x, y) => x.t - y.t);
  items.forEach(x => x.phase = x.t < on ? 'before' : x.t <= ta ? 'during' : 'after');
  const keep = items.length > 16 ? items.filter((x, i) => Math.abs(x.t - on) <= ar / 2 || x.phase !== 'before').slice(-16) : items;
  const mean = (PP, x, y) => (PP.tor[y + 1] - PP.tor[x]) / (y - x + 1), at = Math.min(ta, cap);
  const same = [];
  KPIS.forEach(k => same.push({ label: LNAME[o] + ' ' + k.name.toLowerCase(), value: fmtKpi(k.key, kv(D, k.key, o, at)), line: o, key: k.key }));
  same.push({ label: LNAME[l] + ' cap torque', value: mean(D.P[l], at - 19, at).toFixed(2) + ' Nm' }, { label: LNAME[l] + ' set speed', value: Math.round(D.L[l].setp[at] * 100) + '%' }, { label: LNAME[l] + ' preform stock', value: num(D.L[l].stock[at]) + ' (' + fmtKpi('cover', kv(D, 'cover', l, at)) + ')' });
  return { before: keep, same, past: similarPast(D, S, l, ta, cap), window: [a, b] };
}
