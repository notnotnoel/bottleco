// Second path for the tests: the preview engine's own KPI values and alerts.
// The Python back end must give the same numbers. Written to backend/tests/fixtures/preview_oracle.json.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('./generator/sim.js');
const D = S.build(S.SEED); S.prep(D);
const out = process.argv[2] || '../backend/tests/fixtures/preview_oracle.json';

const kpi = {};
for (let l = 0; l < 2; l++) for (const key of S.KEYS) {
  const v = []; for (let t = 0; t < S.N; t += 7) v.push(S.kv(D, key, l, t)); kpi[S.LID[l] + ':' + key] = v;
}
const cases = {
  defaults: S.defaults(),
  strict: Object.assign(S.defaults(), { oeeLim: 70, stopLim: 10, speedLim: 85, rejLim: 2, coverLim: 90, hold: 3, cool: 15 }),
  loose: Object.assign(S.defaults(), { oeeLim: 40, stopLim: 30, speedLim: 60, rejLim: 5, coverLim: 20, hold: 10, cool: 60, every: 5 })
};
const scans = {};
for (const [name, set] of Object.entries(cases)) {
  const sc = S.scan(D, set);
  scans[name] = { settings: set, alerts: sc.alerts.map(a => ({ line_id: S.LID[a.line], key: a.key, t0: a.t0, ta: a.ta, t_end: a.tEnd })),
    incidents: sc.incidents.map(i => ({ id: i.id, line_id: S.LID[i.line], start: i.start, end: i.end, keys: i.keys })) };
}
const day = {}; // calendar-day overall score per line (preview definition)
for (let l = 0; l < 2; l++) for (let d = 1; d <= 14; d++) { const a = Math.max(0, S.T(d, 0, 0)), b = S.T(d + 1, 0, 0) - 1; day[S.LID[l] + ':2026-09-' + String(d).padStart(2, '0')] = S.rangeStats(D, l, a, b).oee; }
writeFileSync(out, JSON.stringify({ step: 7, kpi, scans, day }));
console.log('wrote', out);
