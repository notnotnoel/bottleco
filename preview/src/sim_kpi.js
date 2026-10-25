// ===== Part 2: settings (sliders), KPIs, alert scan =====
const mins = v => v < 60 ? v + ' min' : (v % 60 === 0 ? (v / 60) + (v === 60 ? ' hour' : ' hours') : Math.floor(v / 60) + ' h ' + (v % 60) + ' min');
// 23 sliders. g: s = shared, e = Explorer, w = Watcher. live = changes the preview now.
const SLIDERS = [
  { key: 'wording', g: 's', q: 'How free is my wording?', l: 'Same words every time', r: 'More variety', min: 0, max: 100, step: 5, def: 0, fmt: v => v === 0 ? 'Same words every time' : v + '% variety', live: false },
  { key: 'length', g: 's', q: 'How long are my answers?', l: 'Short', r: 'Long', min: 150, max: 1200, step: 50, def: 150, fmt: v => v < 450 ? 'Short' : v < 850 ? 'Medium' : 'Long', live: true },
  { key: 'brain', g: 's', q: 'Brain', l: 'Fast', r: 'Deep', min: 0, max: 2, step: 1, def: 1, fmt: v => ['Fast', 'Balanced', 'Deep'][v], live: false },
  { key: 'effort', g: 's', q: 'How hard do I try?', l: 'Quick look', r: 'Dig deep', min: 3, max: 20, step: 1, def: 6, fmt: v => v + ' steps', live: false },
  { key: 'think', g: 's', q: 'How long may I think?', l: '10 sec', r: '2 min', min: 10, max: 120, step: 5, def: 45, fmt: v => v < 60 ? v + ' sec' : (v / 60).toFixed(v % 60 ? 1 : 0) + ' min', live: false },
  { key: 'retries', g: 's', q: 'If my number check fails, how often do I try again?', l: 'Never', r: '3 times', min: 0, max: 3, step: 1, def: 2, fmt: v => ['Never', 'Once', '2 times', '3 times'][v], live: false },
  { key: 'around', g: 's', q: 'How far around the moment do I look?', l: '15 min', r: '12 hours', min: 15, max: 720, step: 15, def: 120, fmt: mins, live: true },
  { key: 'simK', g: 'e', q: 'How many past events do I compare?', l: '1', r: '10', min: 1, max: 10, step: 1, def: 3, fmt: v => String(v), live: true },
  { key: 'simCut', g: 'e', q: 'How alike must a past event be?', l: 'Loosely alike', r: 'Nearly the same', min: 0, max: 100, step: 5, def: 50, fmt: v => v < 35 ? 'Loosely alike' : v < 70 ? 'Middle' : 'Nearly the same', live: true },
  { key: 'rows', g: 'e', q: 'How much data may I read?', l: '100 rows', r: '5,000 rows', min: 100, max: 5000, step: 100, def: 1000, fmt: v => v.toLocaleString('en-US') + ' rows', live: true },
  { key: 'sure', g: 'e', q: 'How sure must I be before I answer?', l: 'Answer fast', r: 'Be very sure', min: 50, max: 100, step: 5, def: 75, fmt: v => v < 60 ? 'Answer fast' : v < 75 ? 'Fairly sure' : v < 95 ? 'High' : 'Be very sure', live: true },
  { key: 'memory', g: 'e', q: 'How much of our chat do I remember?', l: '2 messages', r: '30 messages', min: 2, max: 30, step: 1, def: 10, fmt: v => v + ' messages', live: true },
  { key: 'oeeLim', g: 'w', q: 'Overall score: warn me below', l: '30%', r: '80%', min: 30, max: 80, step: 1, def: 55, fmt: v => v + '%', live: true },
  { key: 'stopLim', g: 'w', q: 'Stopped time: warn me above', l: '5 min', r: '45 min', min: 5, max: 45, step: 1, def: 20, fmt: v => v + ' min', live: true },
  { key: 'speedLim', g: 'w', q: 'Speed: warn me below', l: '50%', r: '95%', min: 50, max: 95, step: 1, def: 75, fmt: v => v + '%', live: true },
  { key: 'rejLim', g: 'w', q: 'Rejects: warn me above', l: '1%', r: '8%', min: 1, max: 8, step: 0.5, def: 3, fmt: v => v + '%', live: true },
  { key: 'coverLim', g: 'w', q: 'Preforms left: warn me below', l: '10 min', r: '120 min', min: 10, max: 120, step: 5, def: 45, fmt: v => v + ' min', live: true },
  { key: 'every', g: 'w', q: 'How often do I check?', l: 'Every minute', r: 'Every 15 min', min: 1, max: 15, step: 1, def: 1, fmt: v => v === 1 ? 'Every minute' : 'Every ' + v + ' min', live: true },
  { key: 'hold', g: 'w', q: 'How long must a problem last before I warn?', l: '1 min', r: '30 min', min: 1, max: 30, step: 1, def: 5, fmt: v => v + ' min', live: true },
  { key: 'cool', g: 'w', q: 'How long do I stay quiet after a warning?', l: '0 min', r: '2 hours', min: 0, max: 120, step: 5, def: 30, fmt: mins, live: true },
  { key: 'baseDays', g: 'w', q: 'How many days of normal do I compare with?', l: '1', r: '14', min: 1, max: 14, step: 1, def: 7, fmt: v => v + (v === 1 ? ' day' : ' days'), live: true },
  { key: 'nCauses', g: 'w', q: 'How many causes do I check?', l: '1', r: '8', min: 1, max: 8, step: 1, def: 5, fmt: v => String(v), live: true },
  { key: 'reportLen', g: 'w', q: 'How long is a report?', l: 'Brief', r: 'Full', min: 0, max: 1, step: 1, def: 0, fmt: v => v ? 'Full' : 'Brief', live: true }
];
function defaults() { const o = {}; SLIDERS.forEach(s => o[s.key] = s.def); return o; }

// KPI list (plain names)
const KPIS = [
  { key: 'oee', name: 'Overall score', what: 'Share of ideal output you got, last 60 min', dir: 'below', lim: 'oeeLim', scale: 100, unit: '%' },
  { key: 'stop', name: 'Stopped time', what: 'Minutes stopped by faults, last 60 min', dir: 'above', lim: 'stopLim', scale: 1, unit: ' min' },
  { key: 'speed', name: 'Speed', what: 'Running speed against ideal, last 15 min', dir: 'below', lim: 'speedLim', scale: 100, unit: '%' },
  { key: 'rej', name: 'Rejects', what: 'Share of bottles rejected, last 30 min', dir: 'above', lim: 'rejLim', scale: 100, unit: '%' },
  { key: 'cover', name: 'Preforms left', what: 'Minutes of preforms left at the current pace', dir: 'below', lim: 'coverLim', scale: 1, unit: ' min' }
];
const KEYS = KPIS.map(k => k.key);

// prefix sums
function prep(D) {
  D.P = D.L.map(L => {
    const mk = () => new Float64Array(N + 1), p = { run: mk(), flt: mk(), pln: mk(), prd: mk(), rj: mk(), mc: mk(), tor: mk() };
    for (let i = 0; i < N; i++) {
      const s = L.st[i];
      p.run[i + 1] = p.run[i] + (s === 0 ? 1 : 0); p.flt[i + 1] = p.flt[i] + (s === 1 ? 1 : 0); p.pln[i + 1] = p.pln[i] + (s === 2 ? 1 : 0);
      p.prd[i + 1] = p.prd[i] + L.prod[i]; p.rj[i + 1] = p.rj[i] + L.rej[i]; p.mc[i + 1] = p.mc[i] + (s === 0 && L.mic[i] ? 1 : 0); p.tor[i + 1] = p.tor[i] + L.tor[i];
    }
    return p;
  });
  D.evL = [0, 1].map(l => D.events.filter(e => e.line === l));
  D.cipL = D.evL.map(a => a.filter(e => e.reason === 'CIP clean'));
  D.chgL = D.evL.map(a => a.filter(e => e.reason === 'Changeover'));
  return D;
}
const ws = (a, x, y) => a[y + 1] - a[x];
// range metrics (inclusive minutes a..b)
function rangeStats(D, l, a, b) {
  const P = D.P[l]; a = Math.max(0, a); b = Math.min(N - 1, b);
  const len = b - a + 1, run = ws(P.run, a, b), flt = ws(P.flt, a, b), pln = ws(P.pln, a, b), prd = ws(P.prd, a, b), rj = ws(P.rj, a, b);
  const den = IDEAL[l] * (len - pln);
  return { len, run, flt, pln, prd, rj, good: prd - rj, oee: len - pln >= 15 ? (prd - rj) / den : null, avail: len - pln > 0 ? run / (len - pln) : null, perf: run > 0 ? prd / (IDEAL[l] * run) : null, qual: prd > 0 ? (prd - rj) / prd : null, rejRate: prd > 0 ? rj / prd : null };
}
// KPI value at time t (data up to t only)
function kv(D, key, l, t) {
  const P = D.P[l], L = D.L[l];
  if (key === 'oee') { if (t < 59) return null; const r = rangeStats(D, l, t - 59, t); return 60 - r.pln >= 40 ? r.oee : null; }
  if (key === 'stop') { if (t < 59) return null; return ws(P.flt, t - 59, t); }
  if (key === 'speed') { if (t < 14) return null; const run = ws(P.run, t - 14, t); return run < 12 ? null : ws(P.prd, t - 14, t) / (IDEAL[l] * run); }
  if (key === 'rej') { if (t < 29) return null; const p = ws(P.prd, t - 29, t); return p < IDEAL[l] * 20 ? null : ws(P.rj, t - 29, t) / p; }
  if (key === 'cover') { const pace = pace30(D, l, t); return L.stock[t] / pace; }
  return null;
}
function pace30(D, l, t) { const P = D.P[l], a = Math.max(0, t - 29), run = ws(P.run, a, t); return run >= 5 ? Math.max(20, ws(P.prd, a, t) / run) : IDEAL[l] * 0.85; }
function isBreach(S, key, v) { if (v == null) return false; const k = KPIS[KEYS.indexOf(key)], lim = S[k.lim] / k.scale; return k.dir === 'below' ? v < lim : v > lim; }

// scan all data: alerts and incidents under settings S
function scan(D, S) {
  const alerts = [], iv = Math.max(1, Math.round(S.every)), need = Math.max(1, Math.ceil(S.hold / iv));
  for (let l = 0; l < 2; l++) for (const key of KEYS) {
    let t0 = -1, n = 0, last = -1e9, fired = false, ta = -1;
    const close = tEnd => { if (fired) { const a = alerts[alerts.length - 1]; a.tEnd = tEnd; } t0 = -1; n = 0; fired = false; };
    for (let t = 60; t < N; t += iv) {
      const v = kv(D, key, l, t); if (v == null) continue; const br = isBreach(S, key, v);
      if (br) {
        if (t0 < 0) { t0 = t; n = 0; }
        n++;
        if (!fired && n >= need && t >= last + S.cool) { fired = true; ta = t; last = t; alerts.push({ line: l, key, t0, ta, tEnd: t, v }); }
      } else if (t0 >= 0) close(t - iv);
    }
    if (t0 >= 0) close(N - 1);
  }
  alerts.sort((a, b) => a.ta - b.ta || a.line - b.line);
  const inc = [];
  for (const a of alerts) {
    const o = inc.find(x => x.line === a.line && a.t0 <= x.end + 90);
    if (o) { o.alerts.push(a); o.end = Math.max(o.end, a.tEnd); o.t0 = Math.min(o.t0, a.t0); }
    else inc.push({ line: a.line, alerts: [a], start: a.ta, t0: a.t0, end: a.tEnd });
  }
  inc.sort((a, b) => a.start - b.start); inc.forEach((x, i) => { x.id = i + 1; x.keys = [...new Set(x.alerts.map(a => a.key))]; x.first = x.alerts[0].key; });
  return (D.lastScan = { alerts, incidents: inc });
}
const PLAIN = { oee: 'Overall score low', stop: 'Long stops', speed: 'Running slow', rej: 'Many rejects', cover: 'Preforms running low' };
function fmtKpi(key, v) {
  if (v == null) return '–';
  const k = KPIS[KEYS.indexOf(key)];
  if (key === 'cover') return v >= 360 ? '6 h+' : v >= 60 ? Math.floor(v / 60) + ' h ' + String(Math.round(v % 60)).padStart(2, '0') + ' min' : Math.round(v) + ' min';
  if (key === 'rej') return (v * 100).toFixed(1) + '%';
  return Math.round(v * k.scale) + k.unit;
}
