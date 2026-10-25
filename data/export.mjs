// Runs the deterministic Bottle Co generator (the same engine as the preview)
// and writes its raw output as JSON. build_db.py turns this JSON into SQLite.
// One generator for both the preview and the database, so their numbers never differ.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('./generator/sim.js');

const out = process.argv[2] || 'build/raw.json';
const D = S.build(S.SEED);
const arr = a => Array.from(a, x => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1e6) / 1e6 : x));

const raw = {
  seed: S.SEED, days: S.DAYS, minutes: S.N,
  start_local: '2026-09-01 06:00',
  ideal: S.IDEAL, line_names: S.LNAME, line_ids: S.LID, bay: S.BAY,
  faults: S.FAULTS, planned: S.PLANNED, defects: S.DEFECTS, skus: S.SKUS,
  lines: D.L.map(L => ({
    state: arr(L.st), reason: arr(L.rid), speed: arr(L.sp), setpoint: arr(L.setp),
    produced: arr(L.prod), rejected: arr(L.rej), stock: arr(L.stock), torque: arr(L.tor), micro: arr(L.mic),
    defects: L.dc.map(arr)
  })),
  events: D.events, deliveries: D.deliveries, schedule: D.sched,
  changeovers: D.changeovers, setpoints: D.setpoints,
  notes: [...D.notes.entries()],
  story: S.STORY // answer key: goes to tests only, never into the agent database
};
writeFileSync(out, JSON.stringify(raw));
console.log('wrote', out);
