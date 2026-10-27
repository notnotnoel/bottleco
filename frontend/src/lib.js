// Shared helpers: time labels, number display, slider words, API calls and the day cache.
// Numbers come from the API. These helpers only format them for display (same rules as the approved preview).

export const START = Date.UTC(2026, 8, 1, 6, 0, 0);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dt = m => new Date(START + m * 60000);
export const hhmm = m => { const d = dt(m); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
export const dlabel = m => { const d = dt(m); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
export const full = m => WD[dt(m).getUTCDay()] + ' ' + dlabel(m) + ' ' + hhmm(m);
export const shiftOf = m => Math.floor((m % 1440) / 480);
export const SHIFTS = ['A', 'B', 'C'];
export const fmtN = n => n == null ? '–' : Math.round(n).toLocaleString('en-US');
export const mins = v => v < 60 ? v + ' min' : (v % 60 === 0 ? (v / 60) + (v === 60 ? ' hour' : ' hours') : Math.floor(v / 60) + ' h ' + (v % 60) + ' min');

export function fmtKpi(key, v, scale, unit) {
  if (v == null) return '–';
  if (key === 'cover') return v >= 360 ? '6 h+' : v >= 60 ? Math.floor(v / 60) + ' h ' + String(Math.round(v % 60)).padStart(2, '0') + ' min' : Math.round(v) + ' min';
  if (key === 'rej') return (v * 100).toFixed(1) + '%';
  return Math.round(v * scale) + unit;
}

// Plain-English value text for each slider (same words as the preview).
export const SLIDER_FMT = {
  wording: v => v === 0 ? 'Same words every time' : v + '% variety',
  length: v => v < 450 ? 'Short' : v < 850 ? 'Medium' : 'Long',
  brain: v => ['Fast', 'Balanced', 'Deep'][v],
  effort: v => v + ' steps',
  think: v => v < 60 ? v + ' sec' : (v / 60).toFixed(v % 60 ? 1 : 0) + ' min',
  retries: v => ['Never', 'Once', '2 times', '3 times'][v],
  around: mins, simK: v => String(v),
  simCut: v => v < 35 ? 'Loosely alike' : v < 70 ? 'Middle' : 'Nearly the same',
  rows: v => v.toLocaleString('en-US') + ' rows',
  sure: v => v < 60 ? 'Answer fast' : v < 75 ? 'Fairly sure' : v < 95 ? 'High' : 'Be very sure',
  memory: v => v + ' messages',
  oeeLim: v => v + '%', stopLim: v => v + ' min', speedLim: v => v + '%', rejLim: v => v + '%', coverLim: v => v + ' min',
  every: v => v === 1 ? 'Every minute' : 'Every ' + v + ' min', hold: v => v + ' min', cool: mins,
  baseDays: v => v + (v === 1 ? ' day' : ' days'), nCauses: v => String(v), reportLen: v => v ? 'Full' : 'Brief'
};
// Sliders the model uses: shown with the model's name so the effect is clear.
export const NOT_USED = new Set(['effort']);

// ---------------- API ----------------
// Paths are relative to the page, so the app works at the site root and under a sub-path
// (noelpaliath.com/opsagent/bottleco/app/). When the API is on another host, set VITE_API_BASE at build time.
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '.';
async function post(path, body, signal) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) { let d = ''; try { d = (await r.json()).detail; } catch (e) { /* no body */ } const err = new Error(d || r.statusText); err.status = r.status; throw err; }
  return r.json();
}
export const api = {
  meta: () => fetch(BASE + '/api/meta').then(r => r.json()),
  day: c => fetch(BASE + '/api/day/' + c).then(r => r.json()),
  scan: settings => post('/api/scan', { settings }),
  watch: (settings, now, signal) => post('/api/watch', { settings, now }, signal),
  report: (settings, now, id, signal) => post('/api/report', { settings, now, id }, signal),
  // Server-sent events over POST: one "step" event per agent step, then "answer".
  async askStream(body, onStep) {
    const r = await fetch(BASE + '/api/ask/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { let d = ''; try { d = (await r.json()).detail; } catch (e) { /* none */ } return { kind: 'abstain', text: d || 'The server did not answer.', facts: [], suggestions: [] }; }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', ans = null;
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1], data = (chunk.match(/^data: (.*)$/m) || [])[1];
        if (!data) continue; const d = JSON.parse(data);
        if (ev === 'step') onStep && onStep(d.text); else if (ev === 'answer') ans = d; else if (ev === 'error') ans = { kind: 'abstain', text: d.text, facts: [], suggestions: [] };
      }
    }
    return ans || { kind: 'abstain', text: 'The answer did not arrive.', facts: [], suggestions: [] };
  }
};

// ---------------- day cache: minute data + KPIs per minute, 1,440 minutes per block ----------------
export function makeDays(onLoad) {
  const cache = new Map(), loading = new Set();
  function ensure(c) {
    if (c < 0 || cache.has(c) || loading.has(c)) return;
    loading.add(c);
    api.day(c).then(d => { cache.set(c, d); loading.delete(c); onLoad && onLoad(c); }).catch(() => loading.delete(c));
  }
  const at = m => { const c = Math.floor(m / 1440), d = cache.get(c); return d ? { d, i: m - c * 1440 } : null; };
  return {
    ensure, has: c => cache.has(c),
    field(l, f, m) { const x = at(m); return x ? x.d.lines[l][f][x.i] : null; },
    kpi(l, k, m) { const x = at(m); return x ? x.d.lines[l].kpi[k][x.i] : undefined; },
    ready(m) { return !!at(m); }
  };
}
