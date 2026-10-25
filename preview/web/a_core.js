// ===== BottleOps preview - core: helpers, state, icons, charts, settings =====
const Sim = window.BottleSim;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? (k.slice(0, 5) === 'aria-' ? 'true' : '') : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const ICON = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  back: '<path d="M12 6v12L3.5 12zM21 6v12l-8.5-6z" fill="currentColor"/>',
  fwd: '<path d="M12 6v12l8.5-6zM3 6v12l8.5-6z" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  send: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  doc: '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12h6M9 15.5h6M9 8.5h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  find: '<circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 10h16M10 10v9" stroke="currentColor" stroke-width="1.7"/>',
  db: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  trend: '<path d="M4 17l5-6 4 3.5L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  chat: '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.8 12.2l2.4 2.4 4-4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.3M12 18.7V21M3 12h2.3M18.7 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  auto: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  list: '<path d="M8 7h12M8 12h12M8 17h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="4.2" cy="7" r="1.2" fill="currentColor"/><circle cx="4.2" cy="12" r="1.2" fill="currentColor"/><circle cx="4.2" cy="17" r="1.2" fill="currentColor"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  shrink: '<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  gauge: '<path d="M4.5 16a7.5 7.5 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 16l3.5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};
const ico = n => h('span', { class: 'ico', html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>' });
const fmtN = n => n == null ? '–' : Math.round(n).toLocaleString('en-US');

// ---- state ----
const APP = { D: null, SE: Sim.defaults(), SW: Sim.defaults(), t: Sim.T(3, 7, 30), now: 0, playing: false, rate: 10, theme: 'dark', rc: new Map(), seen: new Set(), open: null, openTab: 'report', hist: [], inc: [], tab: 'chat', lastNow: -1 };
APP.D = Sim.build(Sim.SEED); Sim.prep(APP.D);
function rescan() { APP.scan = Sim.scan(APP.D, APP.SW); APP.inc = APP.scan.incidents; APP.rc = new Map(); }
rescan();
const nowMin = () => Math.max(0, Math.min(Sim.N - 1, Math.floor(APP.t)));
const LN = Sim.LNAME;

// ---- theme ----
function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function setTheme(m) {
  APP.theme = m; const r = document.documentElement;
  if (m === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', m);
  document.querySelectorAll('meta[name=theme-color]').forEach(x => x.remove());
  const b = $('#themeBtn'); if (b) { b.replaceChildren(ico(m === 'auto' ? 'auto' : m === 'dark' ? 'moon' : 'sun')); b.title = 'Appearance: ' + m; }
  try { Floor.theme(); } catch (e) {}
}

// ---- toast / modal ----
function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
function modal(title, body, foot) {
  const close = () => { sc.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const sc = h('div', { class: 'scrim', onclick: e => { if (e.target === sc) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('div', { class: 'mhead' }, h('b', null, title), foot || null, h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, ico('x'))),
      h('div', { class: 'mbody' }, body)));
  document.addEventListener('keydown', esc, true); document.body.append(sc); return close;
}

// ---- charts (SVG, no library) ----
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); kids.flat().forEach(c => c && e.append(c)); return e; }
function fmtClock(m) { return Sim.full(m); }
function sparkline(pts, o) {
  o = o || {}; const W = 120, H = 26, p = pts.filter(x => x[1] != null);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (p.length < 2) return s;
  const xs = p.map(a => a[0]), ys = p.map(a => a[1]).concat(o.limit != null ? [o.limit] : []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * .12; y0 -= pad; y1 += pad;
  const X = x => (x - xs[0]) / (xs[xs.length - 1] - xs[0] || 1) * W, Y = y => H - 2 - (y - y0) / (y1 - y0) * (H - 4);
  if (o.limit != null) s.append(svg('line', { x1: 0, x2: W, y1: Y(o.limit), y2: Y(o.limit), stroke: 'currentColor', 'stroke-opacity': .35, 'stroke-dasharray': '3 3', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  s.append(svg('polyline', { points: p.map(a => X(a[0]).toFixed(1) + ',' + Y(a[1]).toFixed(1)).join(' '), fill: 'none', stroke: o.color || 'var(--blue)', 'stroke-width': 1.7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const l = p[p.length - 1]; s.append(svg('circle', { cx: X(l[0]), cy: Y(l[1]), r: 2.2, fill: o.color || 'var(--blue)' }));
  return s;
}
const SERIES_COL = ['var(--blue)', 'var(--orange)', 'var(--indigo)', 'var(--teal)'];
function trendChart(tr, info) { // series [{name, pts:[[minute,value]]}], marks, limit
  const W = (info && info.w) || 400, H = (info && info.h) || 150, L = 40, R = 10, T0 = 10, B = 22, series = (tr.series || []).filter(s => s.pts && s.pts.length), box = h('div', { class: 'chart' });
  if (!series.length) { box.append(h('div', { class: 'cap' }, 'No points to draw.')); return box; }
  const all = series.flatMap(s => s.pts).filter(a => a[1] != null);
  const xs = all.map(a => a[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), ys = all.map(a => a[1]);
  if (info && info.limit != null) ys.push(info.limit);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; } const pd = (y1 - y0) * .1; y0 = Math.max(info && info.unit === '%' ? 0 : -Infinity, y0 - pd); y1 += pd;
  const X = x => L + (x - x0) / (x1 - x0 || 1) * (W - L - R), Y = y => T0 + (1 - (y - y0) / (y1 - y0)) * (H - T0 - B);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Trend chart' });
  for (let i = 0; i <= 3; i++) { const v = y0 + (y1 - y0) * i / 3, yy = Y(v); s.append(svg('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: 'var(--sep)', 'stroke-width': .6 })); const tx = svg('text', { x: L - 5, y: yy + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: 'var(--label2)' }); tx.textContent = (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)) + ''; s.append(tx); }
  if (info && info.limit != null) { s.append(svg('line', { x1: L, x2: W - R, y1: Y(info.limit), y2: Y(info.limit), stroke: 'var(--red)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' })); }
  for (const m of tr.marks || []) { if (m.t < x0 || m.t > x1) continue; s.append(svg('line', { x1: X(m.t), x2: X(m.t), y1: T0, y2: H - B, stroke: 'var(--label3)', 'stroke-width': 1, 'stroke-dasharray': '2 3' })); const tx = svg('text', { x: X(m.t) + 3, y: T0 + 8 + 10 * ((tr.marks || []).indexOf(m) % 2), 'font-size': 9, fill: 'var(--label2)' }); tx.textContent = m.label; s.append(tx); }
  series.forEach((sr, i) => {
    let d = '', pen = false; sr.pts.forEach(a => { if (a[1] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(a[0]).toFixed(1) + ' ' + Y(a[1]).toFixed(1); pen = true; });
    s.append(svg('path', { d, fill: 'none', stroke: SERIES_COL[i % 4], 'stroke-width': 1.9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: i ? .8 : 1 }));
    if (sr.pts.length <= 40) sr.pts.forEach(a => a[1] != null && s.append(svg('circle', { cx: X(a[0]), cy: Y(a[1]), r: 2.1, fill: SERIES_COL[i % 4] })));
  });
  const tl = (x, anchor) => { const t = svg('text', { x: X(x), y: H - 6, 'text-anchor': anchor, 'font-size': 9.5, fill: 'var(--label2)' }); t.textContent = Sim.dlabel(x) + ' ' + Sim.hhmm(x); s.append(t); };
  tl(x0, 'start'); tl(x1, 'end'); if (x1 - x0 > 600) tl(Math.round((x0 + x1) / 2), 'middle');
  const cur = svg('line', { y1: T0, y2: H - B, stroke: 'var(--label2)', 'stroke-width': 1, opacity: 0 }); s.append(cur);
  const tip = h('div', { class: 'tip', style: { display: 'none' } }); box.append(s, tip);
  s.addEventListener('pointermove', e => {
    const r = s.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, xv = x0 + (px - L) / (W - L - R) * (x1 - x0);
    if (px < L || px > W - R) { tip.style.display = 'none'; cur.setAttribute('opacity', 0); return; }
    let best = null; series.forEach((sr, i) => sr.pts.forEach(a => { if (a[1] == null) return; const d = Math.abs(a[0] - xv); if (!best || d < best.d) best = { d, a, i, sr }; }));
    if (!best) return; cur.setAttribute('x1', X(best.a[0])); cur.setAttribute('x2', X(best.a[0])); cur.setAttribute('opacity', .6);
    const v = best.a[1], vs = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
    tip.textContent = best.sr.name + ' · ' + Sim.hhmm(best.a[0]) + ' ' + Sim.dlabel(best.a[0]) + ' · ' + vs + ((info && info.unit) || ''); tip.style.display = 'block';
    tip.style.left = (X(best.a[0]) / W * r.width) + 'px'; tip.style.top = (Y(v) / H * r.height) + 'px';
  });
  s.addEventListener('pointerleave', () => { tip.style.display = 'none'; cur.setAttribute('opacity', 0); });
  if (series.length > 1 || (info && info.limit != null)) box.append(h('div', { class: 'leg' }, series.map((sr, i) => h('span', null, h('i', { style: { background: SERIES_COL[i % 4] } }), sr.name)), info && info.limit != null ? h('span', null, h('i', { style: { background: 'var(--red)' } }), 'Warning level') : null));
  return box;
}
function trendWords(tr, info) { // plain words from the numbers
  const s = (tr.series || []).filter(x => x.pts && x.pts.length)[0]; if (!s) return 'No trend to describe.';
  const p = s.pts.filter(a => a[1] != null); if (p.length < 2) return 'Too few points for a trend.';
  const u = (info && info.unit) || '', f = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10)) + u;
  const a = p[0], b = p[p.length - 1], mn = p.reduce((m, x) => x[1] < m[1] ? x : m), mx = p.reduce((m, x) => x[1] > m[1] ? x : m);
  const dir = Math.abs(b[1] - a[1]) < (mx[1] - mn[1]) * .1 ? 'stayed about level' : b[1] > a[1] ? 'went up' : 'went down';
  return (s.name || 'Value') + ' ' + dir + ' from ' + f(a[1]) + ' (' + Sim.hhmm(a[0]) + ') to ' + f(b[1]) + ' (' + Sim.hhmm(b[0]) + '). Low: ' + f(mn[1]) + ' at ' + Sim.hhmm(mn[0]) + '. High: ' + f(mx[1]) + ' at ' + Sim.hhmm(mx[0]) + '.';
}
function miniTable(cols, rows, cap) {
  const show = rows.slice(0, cap || 8);
  return h('div', { class: 'tbl' }, h('table', null, h('thead', null, h('tr', null, cols.map(c => h('th', null, c)))), h('tbody', null, show.map(r => h('tr', null, r.map(c => h('td', null, c == null ? '–' : typeof c === 'number' ? c.toLocaleString('en-US') : String(c))))))));
}

// ---- lenses: before/after, same time, similar past ----
function lensView(L) {
  const norm = a => (a || []).map(x => typeof x === 'string' ? { text: x } : x);
  const mk = { before: norm(L.before), same: norm((L.same || []).map(x => typeof x === 'string' ? x : { text: x.label + ': ' + x.value })), past: [] };
  const past = L.past; mk.past = Array.isArray(past) ? norm(past) : norm(Sim.pastText(past));
  const tabs = [['before', 'Before and after'], ['same', 'Same time, other signals'], ['past', 'Similar past']];
  let cur = 'before'; const body = h('div'), seg = h('div', { class: 'seg', role: 'tablist' });
  const draw = () => { seg.replaceChildren(...tabs.map(([k, n]) => h('button', { role: 'tab', 'aria-pressed': k === cur, onclick: () => { cur = k; draw(); } }, n + ' (' + mk[k].length + ')'))); body.replaceChildren(...(mk[cur].length ? mk[cur].map(x => h('div', { class: 'li ' + (x.phase || '') }, h('span', { class: 'dotp' }), h('span', null, x.text))) : [h('div', { class: 'cap' }, 'Nothing found.')])); };
  draw(); return h('div', null, seg, h('div', { style: { height: '6px' } }), body);
}

// ---- settings sheet (all sliders, plain words) ----
const GROUPS = {
  E: [['What I look at', ['around', 'simK', 'simCut', 'rows', 'sure', 'memory']], ['How I talk', ['wording', 'length']], ['How I think', ['brain', 'effort', 'think', 'retries']]],
  W: [['Warning levels', ['oeeLim', 'stopLim', 'speedLim', 'rejLim', 'coverLim']], ['When I warn', ['every', 'hold', 'cool']], ['What I compare', ['baseDays', 'around', 'nCauses', 'reportLen']], ['How I talk', ['wording', 'length']], ['How I think', ['brain', 'effort', 'think', 'retries']]]
};
function openSettings(which) {
  const S = which === 'E' ? APP.SE : APP.SW, def = Sim.defaults(), SL = Object.fromEntries(Sim.SLIDERS.map(s => [s.key, s]));
  let t = null; const apply = k => { if (which === 'W' && SL[k].live && SL[k].g !== 's') { clearTimeout(t); t = setTimeout(() => { rescan(); Watch.refresh(true); }, 120); } else if (which === 'W' && k === 'around') Watch.refresh(true); };
  const rows = {};
  const groups = GROUPS[which].map(([title, keys]) => h('div', { class: 'grp' }, h('h6', null, title), h('div', { class: 'list' }, keys.map(k => {
    const s = SL[k], val = h('em', null, s.fmt(S[k])), inp = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: S[k], 'aria-label': s.q });
    const paint = () => inp.style.setProperty('--p', ((inp.value - s.min) / (s.max - s.min) * 100) + '%');
    inp.addEventListener('input', () => { S[k] = +inp.value; val.textContent = s.fmt(S[k]); paint(); apply(k); });
    paint(); rows[k] = { inp, val, paint, s };
    return h('div', { class: 'srow' }, h('div', { class: 't' }, h('b', null, s.q), s.live ? null : h('span', { class: 'later', title: 'Works in the full build' }, 'Full build'), val), inp, h('div', { class: 'lr' }, h('span', null, s.l), h('span', null, s.r)));
  }))));
  const reset = h('button', { class: 'btn', onclick: () => { for (const k in rows) { S[k] = def[k]; rows[k].inp.value = def[k]; rows[k].val.textContent = rows[k].s.fmt(def[k]); rows[k].paint(); } if (which === 'W') { rescan(); Watch.refresh(true); } toast('Back to the default settings.'); } }, 'Reset');
  modal(which === 'E' ? 'Data Explorer settings' : 'Monitor settings', [h('div', { class: 'mnote' }, 'Move a slider. Words and effort change. Numbers never change: code computes them from the data.'), groups], reset);
}
function openSafety() {
  modal('Why you can trust the answers', h('ol', { class: 'safe' }, [
    ['Code computes every number.', 'The language model only writes the words around the numbers.'],
    ['Every number can be checked.', 'Tap a blue number to see where it came from. A second code path computes it again. If the two differ, I say "I cannot confirm this".'],
    ['"Not in the data" is a valid answer.', 'Costs, energy, forecasts and opinions are not in the data. I say so, and I do not guess.'],
    ['A cause needs proof.', 'I name a cause only when enough checks pass. Otherwise I say "the cause is not clear".'],
    ['No peeking at the future.', 'I read only data up to the time bar. Move the bar back, and my answers change.'],
    ['I can only read.', 'The data is read-only. I cannot change it.']
  ].map(([a, b]) => h('li', null, h('b', null, a + ' '), b))));
}
