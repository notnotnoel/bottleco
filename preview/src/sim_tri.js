// ===== Part 5: RCA data analysis + triangulation (all numbers from code, each cross-checked) =====
// Which of the 3 angles each check of an idea belongs to (same order as the checks in rcaCore).
const ROLES = {
  late_supply: ['cross', 'time', 'history', 'cross'], startup_after_cip: ['time', 'cross', 'history', 'cross'],
  after_changeover: ['time', 'cross', 'history', 'cross'], capper_drift: ['cross', 'time', 'cross', 'cross'],
  shift_handover: ['time', 'cross', 'history', 'cross'], setpoint_lowered: ['time', 'cross', 'cross', 'cross'],
  plant_wide: ['cross', 'cross', 'cross', 'history'], normal_noise: ['history', 'history']
};
function winStats(D, l, a, b) { // plain loop over minute rows
  const L = D.L[l]; let prod = 0, rej = 0, prodRun = 0, run = 0, flt = 0, pln = 0, slow = 0; const byF = {}, byP = {}, byD = DEFECTS.map(() => 0);
  for (let i = a; i <= b; i++) {
    prod += L.prod[i]; rej += L.rej[i]; const s = L.st[i];
    if (s === 0) { run++; prodRun += L.prod[i]; if (L.sp[i] < 0.75) slow++; }
    else if (s === 1) { flt++; const nm = FAULTS[L.rid[i] - 1] || 'Other'; byF[nm] = (byF[nm] || 0) + 1; }
    else { pln++; const nm = PLANNED[L.rid[i] - 11] || 'Planned stop'; byP[nm] = (byP[nm] || 0) + 1; }
    for (let j = 0; j < DEFECTS.length; j++) byD[j] += L.dc[j][i];
  }
  const n = b - a + 1, ideal = IDEAL[l] * (n - pln);
  return { n, prod, rej, run, flt, pln, slow, ideal, prodRun, byF, byP, byD, out: ideal > 0 ? prod / ideal : null, rejPct: prod > 0 ? rej / prod : null, speed: run > 0 ? prodRun / (IDEAL[l] * run) : null };
}
function winNormal(D, S, l, a, b) { // same clock window on earlier days only
  const days = []; for (let k = 1; k <= Math.round(S.baseDays); k++) { const x = a - k * 1440, y = b - k * 1440; if (x < 0) break; days.push(winStats(D, l, x, y)); }
  if (!days.length) return null;
  const mean = f => { const v = days.map(f).filter(x => x != null); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null; };
  const byF = {}; FAULTS.forEach(nm => byF[nm] = days.reduce((s, d) => s + (d.byF[nm] || 0), 0) / days.length);
  const byD = DEFECTS.map((_, j) => days.reduce((s, d) => s + d.byD[j], 0) / days.length);
  return { n: days.length, prod: mean(d => d.prod), out: mean(d => d.out), flt: mean(d => d.flt), rejPct: mean(d => d.rejPct), speed: mean(d => d.speed), slow: mean(d => d.slow), pln: mean(d => d.pln), byF, byD };
}
function evFaults(D, l, a, b) { // second path: the stop-event table
  const r = {}; for (const e of D.evL[l]) { if (e.planned) continue; const x = Math.max(e.start, a), y = Math.min(e.end - 1, b); if (y >= x) r[e.reason] = (r[e.reason] || 0) + y - x + 1; } return r;
}
function analysisFor(D, S, rep) {
  const l = rep.line, o = 1 - l, ta = rep.ta, key = rep.key, span = key === 'cover' ? 60 : 30;
  const b = ta, a = Math.max(0, Math.min(rep.on, ta - span + 1));
  const w = winStats(D, l, a, b), wo = winStats(D, o, a, b), nm = winNormal(D, S, l, a, b), nmo = winNormal(D, S, o, a, b);
  const checks = []; const chk = (label, x, y) => checks.push({ label, a: x, b: y, ok: x === y });
  chk('Bottles made', w.prod, ws(D.P[l].prd, a, b)); chk('Rejects', w.rej, ws(D.P[l].rj, a, b));
  const ef = evFaults(D, l, a, b), efTot = Object.values(ef).reduce((p, c) => p + c, 0);
  chk('Minutes lost to faults', w.flt, efTot);
  Object.keys(w.byF).forEach(k => chk('Minutes: ' + k, w.byF[k], ef[k] || 0));
  chk('Reject types add up', w.byD.reduce((p, c) => p + c, 0), w.rej);
  const pc = v => v == null ? '–' : pctS(v, 0), pc1 = v => v == null ? '–' : pctS(v, 1), mn = v => v == null ? '–' : (Math.round(v * 10) / 10) + ' min';
  const low = (v, n) => n != null && v != null && v < n * 0.85, hi = (v, n, d) => n != null && v != null && v > n + d;
  const rows = [
    { label: 'Bottles made', now: num(w.prod), normal: nm ? num(nm.prod) : '–', bad: low(w.prod, nm && nm.prod) },
    { label: 'Output against ideal', now: pc(w.out), normal: nm ? pc(nm.out) : '–', bad: low(w.out, nm && nm.out) },
    { label: 'Running speed', now: pc(w.speed), normal: nm ? pc(nm.speed) : '–', bad: low(w.speed, nm && nm.speed) },
    { label: 'Minutes lost to faults', now: w.flt + ' min', normal: nm ? mn(nm.flt) : '–', bad: hi(w.flt, nm && nm.flt, 3) },
    { label: 'Slow minutes', now: w.slow + ' min', normal: nm ? mn(nm.slow) : '–', bad: hi(w.slow, nm && nm.slow, 3) },
    { label: 'Rejects', now: pc1(w.rejPct), normal: nm ? pc1(nm.rejPct) : '–', bad: nm && nm.rejPct != null && w.rejPct != null && w.rejPct > nm.rejPct * 1.5 && w.rejPct - nm.rejPct > 0.005 },
    { label: 'Planned stops', now: w.pln + ' min', normal: nm ? mn(nm.pln) : '–', bad: false }
  ];
  const reasons = FAULTS.map(k => ({ name: k, now: w.byF[k] || 0, normal: nm ? nm.byF[k] : null })).filter(x => x.now > 0 || (x.normal || 0) >= 1).sort((x, y) => y.now - x.now).slice(0, 6).map(x => Object.assign(x, { bad: x.now > (x.normal || 0) + 3 }));
  const planned = Object.keys(w.byP).map(k => k + ' ' + w.byP[k] + ' min');
  const defects = DEFECTS.map((k, j) => ({ name: k, now: w.byD[j], normal: nm ? nm.byD[j] : null })).filter(x => x.now > 0 || (x.normal || 0) >= 1).sort((x, y) => y.now - x.now).map(x => Object.assign(x, { bad: x.normal != null && x.now > x.normal * 1.8 && x.now - x.normal >= 5 }));
  const other = [
    { label: 'Output against ideal', now: pc(wo.out), normal: nmo ? pc(nmo.out) : '–', bad: low(wo.out, nmo && nmo.out) },
    { label: 'Minutes lost to faults', now: wo.flt + ' min', normal: nmo ? mn(nmo.flt) : '–', bad: hi(wo.flt, nmo && nmo.flt, 3) },
    { label: 'Rejects', now: pc1(wo.rejPct), normal: nmo ? pc1(nmo.rejPct) : '–', bad: nmo && nmo.rejPct != null && wo.rejPct != null && wo.rejPct > nmo.rejPct * 1.5 && wo.rejPct - nmo.rejPct > 0.005 }
  ];
  const read = [];
  read.push(LNAME[l] + ' made ' + num(w.prod) + ' bottles from ' + hhmm(a) + ' to ' + hhmm(b) + ' (' + w.n + ' min). Ideal output for that time is ' + num(w.ideal) + '. That is ' + pc(w.out) + ' of ideal' + (nm && nm.out != null ? '. At the same time on ' + nm.n + ' earlier day' + (nm.n > 1 ? 's' : '') + ' it was ' + pc(nm.out) + '.' : '.'));
  if (reasons.length && reasons[0].now > 0) { const t = reasons[0]; read.push('Faults cost ' + w.flt + ' min. The biggest part is "' + t.name + '": ' + t.now + ' min (' + Math.round(t.now / w.flt * 100) + '% of the lost time).'); }
  else read.push('No fault stops in this window.');
  if (w.rej > 0) { const t = defects[0]; read.push('Rejects were ' + pc1(w.rejPct) + ' (' + num(w.rej) + ' bottles)' + (t ? '. The most common type is "' + t.name + '" with ' + t.now + '.' : '.')); }
  read.push(LNAME[o] + ' ran at ' + pc(wo.out) + ' of ideal in the same window' + (wo.out != null && wo.out >= 0.8 ? '. It was not hit.' : '. It was hit too.'));
  let supply = null, supplyText = null;
  if (key === 'cover') { // preform supply: stock, use and the delivery that was due
    const L = D.L[l], st0 = L.stock[a], st1 = L.stock[b], use = (st0 - st1) / w.n, nstock = []; for (let k = 1; k <= Math.round(S.baseDays); k++) { if (b - k * 1440 < 0) break; nstock.push(L.stock[b - k * 1440]); }
    const due = D.sched.filter(x => x.line === l && x.due <= ta).sort((x, y) => y.due - x.due)[0], arrived = due && due.arr <= ta;
    supply = [
      { label: 'Preforms in stock', now: num(st1), normal: nstock.length ? num(nstock.reduce((p, c) => p + c, 0) / nstock.length) : '–', bad: nstock.length > 0 && st1 < nstock.reduce((p, c) => p + c, 0) / nstock.length * 0.5 },
      { label: 'Stock ' + w.n + ' min earlier', now: num(st0), normal: '–', bad: false },
      { label: 'Use per minute', now: num(use), normal: '–', bad: false },
      { label: 'Minutes of cover', now: fmtKpi('cover', kv(D, 'cover', l, b)), normal: '–', bad: kv(D, 'cover', l, b) < S.coverLim },
      due ? { label: 'Last delivery due', now: due.po + ' at ' + hhmm(due.due), normal: '–', bad: false } : { label: 'Last delivery due', now: 'none yet', normal: '–', bad: false },
      due ? { label: 'Delivery status', now: arrived ? 'Came ' + hhmm(due.arr) + ' (' + (due.arr - due.due) + ' min late)' : 'Not here yet (' + (ta - due.due) + ' min late)', normal: '–', bad: !arrived || due.arr - due.due > 30 } : { label: 'Delivery status', now: '–', normal: '–', bad: false }
    ];
    supplyText = LNAME[l] + ' preform stock fell from ' + num(st0) + ' to ' + num(st1) + ' in ' + w.n + ' min (' + num(use) + ' a minute). That is ' + fmtKpi('cover', kv(D, 'cover', l, b)) + ' of cover.' + (due ? ' Delivery ' + due.po + ' was due ' + hhmm(due.due) + (arrived ? ' and came ' + hhmm(due.arr) + '.' : ' and had not arrived by ' + hhmm(ta) + ' (' + (ta - due.due) + ' min late).') : '');
  }
  if (supplyText) read.splice(1, 0, supplyText);
  return { a, b, n: w.n, rows, supply, reasons, planned, defects, other, read, hasNormal: !!nm, normalDays: nm ? nm.n : 0, checks: { ok: checks.filter(c => c.ok).length, total: checks.length, bad: checks.filter(c => !c.ok) } };
}
function triangulate(rep) {
  const r = rep.rca, top = r.tested[0], run = r.tested[1] || null, roles = ROLES[top.key] || [];
  const ANG = [['time', 'Before and after', 'What happened just before and just after it began?'], ['cross', 'Same time, other signals', 'What do other signals and the other line show at the same time?'], ['history', 'Similar past situations', 'Did the same thing happen before?']];
  const angles = ANG.map(([k, name, ask]) => {
    const checks = top.checks.filter((c, i) => roles[i] === k), passed = checks.filter(c => c.ok).length, total = checks.length, share = total ? passed / total : null;
    return { key: k, name, ask, checks, passed, total, verdict: !total ? 'none' : share >= 0.75 ? 'supports' : share >= 0.5 ? 'partly' : 'against' };
  });
  const L = rep.lens, bf = L.before.filter(x => x.phase === 'before').slice(-3), du = L.before.filter(x => x.phase === 'during').slice(0, 3), af = L.before.filter(x => x.phase === 'after').slice(0, 3);
  angles[0].context = [...bf, ...du, ...af].map(x => ({ phase: x.phase, text: x.text }));
  angles[1].context = L.same.slice(0, 8).map(x => ({ text: x.label + ': ' + x.value }));
  angles[2].context = pastText(L.past).slice(0, 4).map(t => ({ text: t }));
  const voted = angles.filter(a => a.total > 0), sup = voted.filter(a => a.verdict === 'supports').length, proven = !!rep.cause;
  const level = proven && voted.length >= 2 && sup === voted.length ? 'strong' : proven ? 'medium' : 'weak';
  const summary = proven
    ? (sup === voted.length && voted.length >= 2 ? (voted.length === 2 ? 'Both angles agree: ' : 'All 3 angles agree: ') + top.name + '.' : sup + ' of ' + voted.length + ' angles support ' + top.name + '.') + ' ' + top.passed + ' of ' + top.total + ' checks pass, so I name it.'
    : 'No cause is proven. The best idea is "' + top.name + '": ' + top.passed + ' of ' + top.total + ' checks pass, and ' + sup + ' of ' + voted.length + ' angles support it. That is not enough.';
  return { idea: top.name, key: top.key, proven, level, summary, angles, runner: run ? { name: run.name, passed: run.passed, total: run.total } : null, thr: r.thr, sup, voted: voted.length };
}
