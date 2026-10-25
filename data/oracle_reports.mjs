// Second path for the Phase 4 tests: the preview's own RCA reports, data analysis and triangulation.
// The Python Line Watcher must produce the same words and numbers.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('./generator/sim.js');
const D = S.build(S.SEED); S.prep(D);
const out = process.argv[2] || '../backend/tests/fixtures/preview_reports.json';

const cases = {
  defaults: S.defaults(),
  strict: Object.assign(S.defaults(), { oeeLim: 70, stopLim: 10, speedLim: 85, rejLim: 2, coverLim: 90, hold: 3, cool: 15 }),
  full: Object.assign(S.defaults(), { reportLen: 1, nCauses: 8, baseDays: 3, around: 240, simK: 5, simCut: 20 })
};
const res = {};
for (const [name, set] of Object.entries(cases)) {
  const sc = S.scan(D, set); const reps = [];
  for (const inc of sc.incidents) for (const cap of [inc.start, S.N - 1]) {
    const rep = S.reportFor(D, set, inc, cap);
    const an = S.analysisFor(D, set, rep), tri = S.triangulate(rep);
    delete rep.rca.top; // same object as tested[0]
    reps.push({ incident: inc.id, cap, rep, analysis: an, tri });
  }
  res[name] = { settings: set, reports: reps };
}
writeFileSync(out, JSON.stringify(res));
console.log('wrote', out);
