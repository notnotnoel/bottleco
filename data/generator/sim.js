(function(root){'use strict';
// ===== Bottle Co data engine (preview). Deterministic. Part 1: constants + data build =====
const DAYS = 14, N = DAYS * 1440, START = Date.UTC(2026, 8, 1, 6, 0, 0);
const IDEAL = [200, 90], LNAME = ['Line 1', 'Line 2'], LID = ['L1', 'L2'];
const FAULTS = ['Filler jam', 'Labeler misfeed', 'Capper fault', 'Conveyor blockage', 'Material shortage - preforms', 'Other (see comment)'];
const PLANNED = ['Break', 'CIP clean', 'Changeover'];
const DEFECTS = ['Underfill', 'Label misaligned', 'Cap torque out of spec', 'Foreign particle', 'Damaged bottle'];
const SKUS = [['Spring 500', 'Mint 500', 'Citrus 500'], ['Spring 1.5L', 'Cola 1.5L', 'Tonic 1.5L']];
const BAY = [110000, 50000], SHIFTS = ['A', 'B', 'C'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const T = (day, hh, mm) => Math.round((Date.UTC(2026, 8, day, hh, mm || 0) - START) / 60000);
const dt = m => new Date(START + m * 60000);
const hhmm = m => { const d = dt(m); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
const dlabel = m => { const d = dt(m); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const full = m => WD[dt(m).getUTCDay()] + ' ' + dlabel(m) + ' ' + hhmm(m);
const dayOf = m => Math.floor(m / 1440), shiftOf = m => Math.floor((m % 1440) / 480);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function rngMake(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Story: 8 events with known causes (event 8 has none). Used to build the data and to test the agents.
const STORY = [
  { id: 1, line: 0, name: 'Filler jam burst', at: T(3, 10, 12), cause: 'startup_after_cip', text: 'Four filler jams in 45 minutes, soon after a clean.' },
  { id: 2, line: 1, name: 'Rejects after changeover', at: T(5, 14, 20), cause: 'after_changeover', text: 'Many bad labels after a product change.' },
  { id: 3, line: 0, name: 'Capper drift', at: T(7, 0, 30), cause: 'capper_drift', text: 'Cap torque slid down for two hours. Rejects rose.' },
  { id: 4, line: 1, name: 'Tiny stops after shift change', at: T(8, 22, 2), cause: 'shift_handover', text: 'Many 1-2 minute slowdowns just after the 22:00 handover.' },
  { id: 5, line: 1, name: 'Slow running', at: T(9, 15, 10), cause: 'setpoint_lowered', text: 'The line ran at 70% of ideal speed for 3.5 hours.' },
  { id: 6, line: 0, name: 'Preform shortage', at: T(10, 5, 0), cause: 'late_supply', text: 'A preform delivery came very late. The line ran dry.' },
  { id: 7, line: 0, name: 'Both lines stop together', at: T(11, 13, 10), cause: 'plant_wide', text: 'Both lines stopped for over 20 minutes at the same time.' },
  { id: 8, line: 1, name: 'Unexplained dip', at: T(13, 2, 20), cause: null, text: 'Score dipped for 80 minutes. No clear cause in the data.' }
];
const DRIFTS = [ // [line, start, bottom, fix, depth, note]
  [0, T(4, 18, 30), T(4, 20, 40), T(4, 21, 20), 0.23, 'capper retorqued'],
  [0, T(7, 0, 30), T(7, 2, 45), T(7, 3, 10), 0.46, 'capper retorqued after alarm'],
  [1, T(12, 9, 0), T(12, 10, 45), T(12, 11, 10), 0.22, 'capper retorqued']
];
const LATE = { // late deliveries, key = line@due minute, value = minutes late
  ['0@' + T(10, 5, 0)]: 880, ['0@' + T(6, 13, 0)]: 55, ['1@' + T(2, 21, 0)]: 35, ['1@' + T(8, 5, 0)]: 40
};
const SKIP = new Set(['0@' + T(10, 13, 0)]); // truck merged into the late one
const RES = [[0, T(3, 9, 0), T(3, 11, 30)], [0, T(7, 0, 0), T(7, 3, 40)], [0, T(10, 5, 0), T(10, 17, 30)], [0, T(11, 13, 0), T(11, 14, 0)], [1, T(5, 13, 30), T(5, 15, 30)], [1, T(8, 21, 45), T(8, 23, 0)], [1, T(9, 15, 0), T(9, 19, 0)], [1, T(11, 13, 0), T(11, 14, 0)], [1, T(12, 21, 0), T(13, 4, 0)]];
const SETPTS = [ // [line, start, end, level, note start, note end]
  [1, T(9, 15, 10), T(9, 18, 40), 0.70, 'slowed line - label glue tank cold', 'glue tank heated, full speed'],
  [0, T(2, 14, 30), T(2, 16, 0), 0.95, 'new operator, running slower', 'back to full speed'],
  [1, T(12, 9, 0), T(12, 10, 30), 0.90, 'slowed for trial of new labels', 'trial done']
];
const SEED = 20261151;
const COMMENTS = ['waited for fitter', 'sensor reset', 'operator on training', '?', 'restarted', 'cleared by hand'];

function build(seed) {
  const base = seed || SEED; let R = rngMake(base);
  const g = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const expo = mean => -mean * Math.log(1 - R());
  const pois = lam => { if (lam <= 0) return 0; if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * g())); const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= R(); } while (p > L); return k - 1; };
  const D = { N, L: [], notes: new Map(), changeovers: [], setpoints: [], deliveries: [], sched: [], events: [] };
  const baseRates = [0.0030, 0.0022, 0.0012, 0.0008, 0.0018]; // per bottle, by defect code

  for (let l = 0; l < 2; l++) {
    R = rngMake(base + l * 7919);
    const busy = new Uint8Array(N), pm = new Uint8Array(N), fm = new Uint8Array(N), rid = new Uint8Array(N);
    const mic = new Uint8Array(N), micF = new Float32Array(N).fill(1), slow = new Float32Array(N).fill(1), setp = new Float32Array(N).fill(1);
    const free = (a, b, pad) => { for (let i = Math.max(0, a - pad); i <= Math.min(N - 1, b + pad); i++) if (busy[i]) return false; return true; };
    const note = (a, text) => { if (text) D.notes.set(l + ':' + a, text); };
    const putP = (a, dur, k, text) => { if (a < 0 || a + dur > N || !free(a, a + dur - 1, 0)) return false; for (let i = a; i < a + dur; i++) { busy[i] = 1; pm[i] = 1; rid[i] = 11 + k; } note(a, text); return true; };
    const putF = (a, dur, name, text) => { if (a < 0 || a + dur > N || !free(a, a + dur - 1, 0)) return false; const k = FAULTS.indexOf(name) + 1; for (let i = a; i < a + dur; i++) { busy[i] = 2; fm[i] = 1; rid[i] = k; } note(a, text); return true; };
    const faultIn = (a, b) => { let s = 0; for (let i = Math.max(0, a); i <= Math.min(N - 1, b); i++) s += fm[i]; return s; };
    const winOK = (a, dur, cap) => { for (let w = a + dur - 59; w <= a; w++) if (faultIn(w, w + 59) + dur > cap) return false; return true; };
    const cips = [];

    // 1) forced planned, forced faults, breaks, reserved story windows, random clean / changeover
    if (l === 0) putP(T(3, 9, 5), 60, 1);
    if (l === 1) putP(T(5, 14, 0), 20, 2);
    if (l === 0) {
      [[10, 12, 8, ''], [10, 26, 7, 'sensor reset'], [10, 38, 9, ''], [10, 50, 8, 'waited for fitter']].forEach(x => putF(T(3, x[0], x[1]), x[2], 'Filler jam', x[3]));
      putF(T(11, 13, 10), 24, 'Other (see comment)', 'power dip, restarted');
    } else {
      putF(T(11, 13, 11), 22, 'Other (see comment)', '?');
      putF(T(13, 2, 41), 7, 'Other (see comment)', 'sensor reset');
      putF(T(13, 3, 12), 9, 'Other (see comment)', '?');
    }
    putF(T(4, 6, 50) + l, 6, 'Other (see comment)', l === 0 ? 'power dip' : '');
    DRIFTS.filter(x => x[0] === l).forEach(x => putF(x[3], x[3] === T(7, 3, 10) ? 18 : 11, 'Capper fault', x[5]));
    for (let d = 0; d < DAYS; d++) { const b0 = d * 1440, off = l * 20; [300, 780, 1380].forEach(o => putP(b0 + o + off, 30, 0)); }
    RES.filter(x => x[0] === l).forEach(([, a, b]) => { for (let i = a; i < b; i++) if (!busy[i]) busy[i] = 3; });
    for (let d = 0; d < DAYS; d++) {
      const b0 = d * 1440;
      for (const kind of [1, 2]) {
        const dur = kind === 1 ? 60 : 20;
        if (kind === 1 && l === 0 && d === 2) continue; // forced CIP exists
        if (kind === 2 && l === 1 && d === 4) continue; // forced changeover exists
        for (let tr = 0; tr < 80; tr++) {
          const a = b0 + 60 + 15 * Math.floor(R() * 82);
          if (a + dur > N) continue;
          if (free(a, a + dur - 1, 25)) { putP(a, dur, kind); break; }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (rid[i] === 12 && (i === 0 || rid[i - 1] !== 12)) { let e = i; while (e < N && rid[e] === 12) e++; cips.push([i, e]); }
      if (rid[i] === 13 && (i === 0 || rid[i - 1] !== 13)) { let e = i; while (e < N && rid[e] === 13) e++; const n = D.changeovers.filter(c => c.line === l).length; D.changeovers.push({ line: l, start: i, end: e, from: SKUS[l][n % 3], to: SKUS[l][(n + 1) % 3] }); }
    }
    // 3) random faults (kept calm so that only the story raises alerts)
    const mix = [['Filler jam', 1.2, 9], ['Labeler misfeed', 1.0, 6], ['Capper fault', 0.4, 18], ['Conveyor blockage', 0.8, 5], ['Other (see comment)', 0.3, 12]];
    for (let s = 0; s < DAYS * 3; s++) {
      for (const [name, rate, mean] of mix) {
        const n = pois(rate);
        for (let i = 0; i < n; i++) {
          const dur = Math.max(3, Math.min(2 * mean, Math.round(expo(mean))));
          for (let tr = 0; tr < 40; tr++) {
            const a = s * 480 + Math.floor(R() * (480 - dur));
            if (free(a, a + dur - 1, 4) && winOK(a, dur, 12)) { putF(a, dur, name, name === 'Other (see comment)' ? COMMENTS[Math.floor(R() * COMMENTS.length)] : (R() < 0.3 ? COMMENTS[Math.floor(R() * COMMENTS.length)] : '')); break; }
          }
        }
      }
    }
    // post-clean start-up jams (small, in the past of the story)
    for (const [ci, [, e]] of cips.entries()) {
      if (ci < 2 || R() < 0.55) {
        const n = R() < 0.35 ? 2 : 1;
        for (let i = 0; i < n; i++) { const dur = 5 + Math.floor(R() * 5); for (let tr = 0; tr < 20; tr++) { const a = e + 4 + Math.floor(R() * 50); if (free(a, a + dur - 1, 4) && winOK(a, dur, 12)) { putF(a, dur, 'Filler jam', ''); break; } } }
      }
    }
    // 4) micro-stops (1-2 minute slowdowns)
    if (l === 1) for (const dd of [2, 3, 5, 6, 7, 10]) for (let i = T(dd, 22, 0); i < T(dd, 22, 35); i++) if (!busy[i]) busy[i] = 3;
    let recent = [], since = 99; // minutes of recent micro-stops; minutes since last stop
    for (let m = 0; m < N; m++) {
      since = (busy[m] === 1 || busy[m] === 2) ? 0 : since + 1;
      if (busy[m] || mic[m] || since < 10) continue;
      recent = recent.filter(x => x > m - 15);
      if (recent.length < 2 && R() < 0.03) { const dur = R() < 0.8 ? 1 : 2, f = 0.3 + 0.3 * R(); for (let i = 0; i < dur && m + i < N; i++) if (!busy[m + i]) { mic[m + i] = 1; micF[m + i] = f; recent.push(m + i); } }
    }
    if (l === 1) { // story 4: tiny stops after the 22:00 handover
      for (let k = 0; k < 12; k++) { const a = T(8, 22, 2) + 4 * k, dur = 1 + (k % 2); for (let i = 0; i < dur; i++) if (busy[a + i] !== 1 && busy[a + i] !== 2) { mic[a + i] = 1; micF[a + i] = 0.18; } }
      for (const dd of [2, 3, 5, 6, 7, 10]) for (let k = 0; k < 3; k++) { const a = T(dd, 22, 5) + 6 * k; if (busy[a] !== 1 && busy[a] !== 2) { mic[a] = 1; micF[a] = 0.55; } }
      for (let m = T(13, 2, 20); m < T(13, 3, 40); m++) slow[m] = 0.66; // story 8
    }
    // 5) setpoints
    for (const [sl, a, b, lv, n1, n2] of SETPTS) if (sl === l) { for (let m = a; m < b; m++) setp[m] = lv; D.setpoints.push({ line: l, ts: a, from: 100, to: Math.round(lv * 100), note: n1 }, { line: l, ts: b, from: Math.round(lv * 100), to: 100, note: n2 }); }

    // 6) capper torque
    const tor = new Float32Array(N); let ar = 0;
    for (let m = 0; m < N; m++) {
      ar = 0.6 * ar + 0.015 * g(); let off = 0;
      for (const x of DRIFTS) if (x[0] === l) { const [, a, bt, fx, depth] = x; if (m >= a && m < bt) off = -depth * (m - a) / (bt - a); else if (m >= bt && m < fx) off = -depth; }
      tor[m] = 2.5 + ar + off;
    }

    // 7) deliveries (due 05:00 / 13:00 / 21:00) with arrival jitter
    const arrivals = [];
    for (let day = 1; day <= 15; day++) for (const hh of [5, 13, 21]) {
      const due = T(day, hh, 0); if (due < 0 || due >= N || SKIP.has(l + '@' + due)) continue;
      const late = LATE[l + '@' + due]; const arr = due + (late != null ? late : Math.floor(-5 + R() * 25));
      arrivals.push({ due, arr });
    }
    arrivals.sort((a, b) => a.due - b.due); arrivals.forEach((x, i) => { x.po = 'PO-' + (1000 + l * 100 + i + 1); D.sched.push({ line: l, due: x.due, arr: x.arr, po: x.po }); });
    arrivals.sort((a, b) => a.arr - b.arr);

    // 8) main minute loop
    const st = new Uint8Array(N), sp = new Float32Array(N), prod = new Uint16Array(N), rej = new Uint16Array(N), stock = new Int32Array(N), dc = DEFECTS.map(() => new Uint8Array(N));
    let stk = l === 0 ? 100000 : 45000, ai = 0, lastEnd = -999, lastLen = 0, stopRun = 0, po = 1000 + l * 100;
    const chg = D.changeovers.filter(c => c.line === l);
    for (let m = 0; m < N; m++) {
      while (ai < arrivals.length && arrivals[ai].arr <= m) { const q = BAY[l] - stk; stk = BAY[l]; D.deliveries.push({ po: arrivals[ai].po, line: l, due: arrivals[ai].due, arrived: m, qty: q }); ai++; }
      let s = 0, r = rid[m];
      if (pm[m]) s = 2; else if (fm[m]) s = 1; else if (stk <= 0) { s = 1; r = 5; rid[m] = 5; if (!(m > 0 && rid[m - 1] === 5 && st[m - 1] === 1)) note(m, 'no preforms on line, waiting for truck'); }
      st[m] = s;
      if (s !== 0) { stopRun++; sp[m] = 0; stock[m] = stk; continue; }
      if (stopRun > 0) { lastLen = stopRun; lastEnd = m; stopRun = 0; }
      const k = m - lastEnd; const ramp = lastLen >= 10 && k < 6 ? 0.85 + 0.15 * k / 6 : 1;
      let v = clamp(0.94 + 0.02 * g(), 0.86, 0.99) * setp[m] * slow[m] * ramp;
      if (mic[m]) v *= micF[m];
      let p = Math.round(IDEAL[l] * v); p = Math.min(p, stk); prod[m] = p; sp[m] = p / IDEAL[l]; stk -= p; stock[m] = stk;
      // rejects
      const rt = baseRates.slice();
      for (const c of chg) { const kk = m - c.end; const story = l === 1 && c.start === T(5, 14, 0), len = story ? 50 : 40, amp = story ? 0.075 : 0.008; if (kk >= 0 && kk < len) { const b = amp * (1 - kk / len); rt[1] += 0.7 * b; rt[0] += 0.3 * b; } }
      rt[2] += clamp((2.30 - tor[m]) / 0.25, 0, 1) * 0.08;
      if (lastLen >= 10 && k < 6) { rt[0] += 0.003; rt[4] += 0.003; }
      if (l === 1 && m >= T(13, 2, 20) && m < T(13, 3, 40)) { rt[3] += 0.008; rt[4] += 0.006; }
      let tr = 0; for (let j = 0; j < 5; j++) { const c = Math.min(255, pois(p * rt[j])); dc[j][m] = c; tr += c; }
      rej[m] = Math.min(tr, p);
    }
    D.L[l] = { st, rid, sp, setp, prod, rej, stock, tor, mic, dc };
  }
  D.cipEnds = [0, 1].map(l => { const a = []; const r = D.L[l].rid; for (let i = 1; i < N; i++) if (r[i - 1] === 12 && r[i] !== 12) a.push(i); return a; });

  // downtime events from the minute arrays (planned + unplanned)
  let id = 1;
  for (let l = 0; l < 2; l++) {
    const { st, rid } = D.L[l];
    for (let i = 0; i < N;) {
      if (st[i] === 0) { i++; continue; }
      let e = i; while (e < N && st[e] === st[i] && rid[e] === rid[i]) e++;
      const code = rid[i], planned = st[i] === 2, name = planned ? PLANNED[code - 11] : FAULTS[code - 1];
      D.events.push({ id: id++, line: l, start: i, end: e, minutes: e - i, planned, reason: name, comment: D.notes.get(l + ':' + i) || '' });
      i = e;
    }
  }
  D.deliveries.sort((a, b) => a.arrived - b.arrived);
  return D;
}

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
  for (const m of q.matchAll(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s*)?([a-z]{3,9})\b|\b([a-z]{3,9})\s*(\d{1,2})\b/g)) {
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
      else if (/\bshifts?\b/.test(q)) ans = ansShifts(D, S, P, now);
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

const API = { N, DAYS, START, IDEAL, LNAME, LID, FAULTS, PLANNED, DEFECTS, SKUS, BAY, SHIFTS, STORY, SEED, SLIDERS, KPIS, KEYS, PLAIN, T, dt, hhmm, dlabel, full, dayOf, shiftOf, clamp, build, prep, defaults, kv, scan, rangeStats, isBreach, fmtKpi, ws, pace30, mins };
Object.assign(API, { HYP, ORDER, PLAYBOOK, rcaCore, rcaIncident, similarPast, lensesFor, onsetOf, normalAt, num, pctS });
if (typeof reportFor !== 'undefined') Object.assign(API, { reportFor, slowKv, fillText });
if (typeof analysisFor !== 'undefined') Object.assign(API, { analysisFor, triangulate });
if (typeof answer !== 'undefined') Object.assign(API, { answer, SAMPLE_Q, pastText });
root.BottleSim = API; if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window!=='undefined'?window:globalThis);
