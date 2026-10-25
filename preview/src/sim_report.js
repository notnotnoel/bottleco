// ===== Part 4: Watcher report + number check =====
function slowKv(D, key, l, t) { // brute-force recompute, a second code path for the number check
  const L = D.L[l];
  if (key === 'stop') { let s = 0; for (let i = t - 59; i <= t; i++) s += L.st[i] === 1 ? 1 : 0; return s; }
  if (key === 'oee') { let pl = 0, good = 0; for (let i = t - 59; i <= t; i++) { if (L.st[i] === 2) pl++; good += L.prod[i] - L.rej[i]; } return 60 - pl >= 40 ? good / (IDEAL[l] * (60 - pl)) : null; }
  if (key === 'speed') { let run = 0, prd = 0; for (let i = t - 14; i <= t; i++) { if (L.st[i] === 0) run++; prd += L.prod[i]; } return run < 12 ? null : prd / (IDEAL[l] * run); }
  if (key === 'rej') { let r = 0, p = 0; for (let i = t - 29; i <= t; i++) { r += L.rej[i]; p += L.prod[i]; } return p < IDEAL[l] * 20 ? null : r / p; }
  if (key === 'cover') { let run = 0, p = 0; for (let i = t - 29; i <= t; i++) { if (L.st[i] === 0) run++; p += L.prod[i]; } return L.stock[t] / (run >= 5 ? Math.max(20, p / run) : IDEAL[l] * 0.85); }
  return null;
}
const limText = (S, k) => k.key === 'cover' || k.key === 'stop' ? S[k.lim] + ' min' : S[k.lim] + '%';
function reportFor(D, S, inc, cap) {
  const first = inc.alerts[0], l = inc.line, ta = first.ta, key = first.key, K = KPIS[KEYS.indexOf(key)];
  const r = rcaIncident(D, S, inc), facts = [];
  const fact = (k, t) => { const v = kv(D, k, l, t), w = slowKv(D, k, l, t), id = 'f' + (facts.length + 1); facts.push({ id, key: k, t, line: l, value: v, shown: fmtKpi(k, v), check: w, ok: v != null && w != null && Math.abs(v - w) < 1e-9, label: LNAME[l] + ' · ' + KPIS[KEYS.indexOf(k)].name + ' · ' + hhmm(t) }); return '{{' + id + '}}'; };
  const L = LNAME[l], lim = limText(S, K);
  const leads = { cover: () => L + ' has preforms for ' + fact('cover', ta) + ' at the current pace. The warning level is ' + lim + '.',
    stop: () => L + ' lost ' + fact('stop', ta) + ' to stops in the last hour. The warning level is ' + lim + '.',
    oee: () => L + ' overall score is ' + fact('oee', ta) + ' for the last hour. The warning level is ' + lim + '.',
    speed: () => L + ' runs at ' + fact('speed', ta) + ' of ideal speed over the last 15 min. The warning level is ' + lim + '.',
    rej: () => L + ' rejected ' + fact('rej', ta) + ' of bottles in the last 30 min. The warning level is ' + lim + '.' };
  const lead = leads[key]();
  const ev = r.top ? r.top.checks.filter(c => c.ok).slice(0, S.reportLen ? 4 : 2).map(c => c.detail) : [];
  const causeLine = r.cause ? 'Most likely cause: ' + HYP[r.cause] + ' (' + r.top.passed + ' of ' + r.top.total + ' checks passed).' : 'The cause is not clear from the data. I tested ' + r.tested.length + ' idea' + (r.tested.length > 1 ? 's' : '') + '. None passed enough checks.';
  const kpis = KPIS.map(k => { const v = kv(D, k.key, l, ta), nm = normalAt(D, S, k.key, l, ta); return { key: k.key, name: k.name, shown: fmtKpi(k.key, v), limit: limText(S, k), breach: isBreach(S, k.key, v), normal: nm ? fmtKpi(k.key, nm.mean) : null, dir: k.dir }; });
  const updates = [];
  for (const a of inc.alerts.slice(1)) if (a.ta <= cap && !(a.key === key)) updates.push({ t: a.ta, text: PLAIN[a.key] + ': ' + fact(a.key, a.ta) + ' (warning level ' + limText(S, KPIS[KEYS.indexOf(a.key)]) + ').' });
  if (key === 'cover') { let z = -1; for (let t = ta + 1; t <= Math.min(cap, ta + 240); t++) if (D.L[l].stock[t] <= 0) { z = t; break; } if (z > 0) updates.push({ t: z, text: L + ' ran out of preforms. The line is stopped.' }); }
  if (inc.end <= cap - 5) updates.push({ t: inc.end, text: 'The last warning level cleared.' });
  updates.sort((a, b) => a.t - b.t);
  const lens = lensesFor(D, S, l, r.on, ta, ta);
  return { id: inc.id, line: l, key, title: L + ' · ' + PLAIN[key], ta, on: r.on, lead, evidence: ev, causeLine, cause: r.cause, causeName: r.cause ? HYP[r.cause] : null, rca: r, lens, kpis, updates, playbook: PLAYBOOK[r.cause || 'none'], facts, full: !!S.reportLen };
}
const fillText = (txt, facts) => txt.replace(/\{\{(f\d+)\}\}/g, (m, id) => { const f = facts.find(x => x.id === id); return f ? f.shown : m; });
