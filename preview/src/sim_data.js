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
