// Second path for the Phase 5 tests: the preview's own Data Explorer answers for the test questions.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('./generator/sim.js');
const D = S.build(S.SEED); S.prep(D);
const Q = JSON.parse(readFileSync('../backend/tests/fixtures/questions.json', 'utf8'));
const out = process.argv[2] || '../backend/tests/fixtures/preview_answers.json';
const minute = s => { const [d, t] = s.split(' '); const [, , dd] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number); return S.T(dd, h, m); };
const cases = { defaults: S.defaults(), full: Object.assign(S.defaults(), { length: 900, around: 240, simK: 5, rows: 200, memory: 4 }) };
const res = {};
for (const [name, set] of Object.entries(cases)) {
  S.scan(D, set); // the preview links similar past moments to the current scan
  res[name] = { settings: set, answers: [] };
  for (const c of [...Q.golden, ...Q.trick, ...Q.extra]) {
    const now = minute(c.now), hist = [];
    for (const h of c.hist || []) hist.push(S.answer(D, set, h, now, hist.slice()).parsed);
    res[name].answers.push({ id: c.id, now, ans: S.answer(D, set, c.q, now, hist) });
  }
}
writeFileSync(out, JSON.stringify(res));
console.log('wrote', out);
