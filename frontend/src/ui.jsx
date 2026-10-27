// Small shared UI parts: icons, modal, toast, charts (SVG, no library), tables, tappable numbers, lens tabs.
import { useEffect, useRef, useState } from 'react';
import { dlabel, hhmm } from './lib.js';

const ICON = {
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="5.5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.5" cy="12" r="1.9" fill="currentColor"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  back: '<path d="M12 6v12L3.5 12zM21 6v12l-8.5-6z" fill="currentColor"/>',
  fwd: '<path d="M12 6v12l8.5-6zM3 6v12l8.5-6z" fill="currentColor"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  send: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
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
export const Ico = ({ n }) => <span className="ico" dangerouslySetInnerHTML={{ __html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>' }} />;

// ---------------- modal + toast ----------------
export function Modal({ title, onClose, foot, children }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc, true); return () => document.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="mhead"><b>{title}</b>{foot}<button className="iconbtn" aria-label="Close" onClick={onClose}><Ico n="x" /></button></div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}
export function useToast() {
  const [msg, setMsg] = useState(null), t = useRef(0);
  const show = m => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 2600); };
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return [node, show];
}

// ---------------- charts ----------------
export function Sparkline({ pts, limit, color }) {
  const W = 120, H = 26, p = pts.filter(x => x[1] != null);
  if (p.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">{limit != null && isFinite(limit) && <line className="lim" x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" strokeOpacity={.9} strokeDasharray="4 3" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}</svg>;
  const xs = p.map(a => a[0]), ys = p.map(a => a[1]).concat(limit != null && isFinite(limit) ? [limit] : []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * .12; y0 -= pad; y1 += pad;
  const X = x => (x - xs[0]) / (xs[xs.length - 1] - xs[0] || 1) * W, Y = y => H - 2 - (y - y0) / (y1 - y0) * (H - 4), l = p[p.length - 1], c = color || 'var(--blue)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {limit != null && isFinite(limit) && <line className="lim" x1={0} x2={W} y1={Y(limit)} y2={Y(limit)} stroke="currentColor" strokeOpacity={.9} strokeDasharray="4 3" strokeWidth={1.2} vectorEffect="non-scaling-stroke"><title>Warning level</title></line>}
      <polyline points={p.map(a => X(a[0]).toFixed(1) + ',' + Y(a[1]).toFixed(1)).join(' ')} fill="none" stroke={c} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={X(l[0])} cy={Y(l[1])} r={2.2} fill={c} />
    </svg>
  );
}
const SERIES_COL = ['var(--blue)', 'var(--orange)', 'var(--indigo)', 'var(--teal)'];
export function TrendChart({ tr, info }) {
  const W = (info && info.w) || 400, H = (info && info.h) || 150, L = 40, R = 10, T0 = 10, B = 22;
  const series = (tr.series || []).filter(s => s.pts && s.pts.length), [tip, setTip] = useState(null), ref = useRef(null);
  if (!series.length) return <div className="chart"><div className="cap">No points to draw.</div></div>;
  const all = series.flatMap(s => s.pts).filter(a => a[1] != null);
  if (!all.length) return <div className="chart"><div className="cap">No points to draw.</div></div>;
  const xs = all.map(a => a[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), ys = all.map(a => a[1]);
  if (info && info.limit != null) ys.push(info.limit);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pd = (y1 - y0) * .1; y0 = Math.max(info && info.unit === '%' ? 0 : -Infinity, y0 - pd); y1 += pd;
  const X = x => L + (x - x0) / (x1 - x0 || 1) * (W - L - R), Y = y => T0 + (1 - (y - y0) / (y1 - y0)) * (H - T0 - B);
  const ticks = [0, 1, 2, 3].map(i => y0 + (y1 - y0) * i / 3);
  const tl = (x, anchor) => <text key={'t' + x + anchor} x={X(x)} y={H - 6} textAnchor={anchor} fontSize={9.5} fill="var(--label2)">{dlabel(x) + ' ' + hhmm(x)}</text>;
  const move = e => {
    const r = ref.current.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, xv = x0 + (px - L) / (W - L - R) * (x1 - x0);
    if (px < L || px > W - R) { setTip(null); return; }
    let best = null; series.forEach(sr => sr.pts.forEach(a => { if (a[1] == null) return; const d = Math.abs(a[0] - xv); if (!best || d < best.d) best = { d, a, sr }; }));
    if (!best) return; const v = best.a[1], vs = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
    setTip({ x: best.a[0], v, text: best.sr.name + ' · ' + hhmm(best.a[0]) + ' ' + dlabel(best.a[0]) + ' · ' + vs + ((info && info.unit) || ''), left: X(best.a[0]) / W * r.width, top: Y(v) / H * r.height });
  };
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend chart" onPointerMove={move} onPointerLeave={() => setTip(null)}>
        {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--sep)" strokeWidth={.6} /><text x={L - 5} y={Y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--label2)">{Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)}</text></g>)}
        {info && info.limit != null && <line x1={L} x2={W - R} y1={Y(info.limit)} y2={Y(info.limit)} stroke="var(--red)" strokeWidth={1.2} strokeDasharray="4 3" />}
        {(tr.marks || []).filter(m => m.t >= x0 && m.t <= x1).map((m, i) => <g key={'m' + i}><line x1={X(m.t)} x2={X(m.t)} y1={T0} y2={H - B} stroke="var(--label3)" strokeWidth={1} strokeDasharray="2 3" /><text x={X(m.t) + 3} y={T0 + 8 + 10 * (i % 2)} fontSize={9} fill="var(--label2)">{m.label}</text></g>)}
        {series.map((sr, i) => {
          let d = '', pen = false; sr.pts.forEach(a => { if (a[1] == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(a[0]).toFixed(1) + ' ' + Y(a[1]).toFixed(1); pen = true; });
          return <g key={'s' + i}><path d={d} fill="none" stroke={SERIES_COL[i % 4]} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" opacity={i ? .8 : 1} />
            {sr.pts.length <= 40 && sr.pts.filter(a => a[1] != null).map((a, j) => <circle key={j} cx={X(a[0])} cy={Y(a[1])} r={2.1} fill={SERIES_COL[i % 4]} />)}</g>;
        })}
        {tl(x0, 'start')}{tl(x1, 'end')}{x1 - x0 > 600 && tl(Math.round((x0 + x1) / 2), 'middle')}
        {tip && <line x1={X(tip.x)} x2={X(tip.x)} y1={T0} y2={H - B} stroke="var(--label2)" strokeWidth={1} opacity={.6} />}
      </svg>
      {tip && <div className="tip" style={{ display: 'block', left: tip.left, top: tip.top }}>{tip.text}</div>}
      {(series.length > 1 || (info && info.limit != null)) && <div className="leg">{series.map((sr, i) => <span key={i}><i style={{ background: SERIES_COL[i % 4] }} />{sr.name}</span>)}{info && info.limit != null && <span><i style={{ background: 'var(--red)' }} />Warning level</span>}</div>}
    </div>
  );
}
export function trendWords(tr, info) {
  const s = (tr.series || []).filter(x => x.pts && x.pts.length)[0]; if (!s) return 'No trend to describe.';
  const p = s.pts.filter(a => a[1] != null); if (p.length < 2) return 'Too few points for a trend.';
  const u = (info && info.unit) || '', f = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10)) + u;
  const a = p[0], b = p[p.length - 1], mn = p.reduce((m, x) => x[1] < m[1] ? x : m), mx = p.reduce((m, x) => x[1] > m[1] ? x : m);
  const dir = Math.abs(b[1] - a[1]) < (mx[1] - mn[1]) * .1 ? 'stayed about level' : b[1] > a[1] ? 'went up' : 'went down';
  return (s.name || 'Value') + ' ' + dir + ' from ' + f(a[1]) + ' (' + hhmm(a[0]) + ') to ' + f(b[1]) + ' (' + hhmm(b[0]) + '). Low: ' + f(mn[1]) + ' at ' + hhmm(mn[0]) + '. High: ' + f(mx[1]) + ' at ' + hhmm(mx[0]) + '.';
}
export function MiniTable({ cols, rows, cap }) {
  const show = rows.slice(0, cap || 8);
  return <div className="tbl"><table><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
    <tbody>{show.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c == null ? '–' : typeof c === 'number' ? c.toLocaleString('en-US') : String(c)}</td>)}</tr>)}</tbody></table></div>;
}

// "{{f1}}" becomes a tappable number
export function FactText({ text, facts, onTap }) {
  return <>{text.split(/(\{\{f\d+\}\})/).map((p, i) => {
    const m = p.match(/^\{\{(f\d+)\}\}$/); if (!m) return p ? <span key={i}>{p}</span> : null;
    const f = facts.find(x => x.id === m[1]); if (!f) return null;
    return <button key={i} className={'num' + (f.ok ? '' : ' bad')} title="Tap to see where this number comes from" onClick={() => onTap(f)}>{f.shown}</button>;
  })}</>;
}

// The three look-around lenses
export function LensView({ lens }) {
  const norm = a => (a || []).map(x => typeof x === 'string' ? { text: x } : x);
  const mk = { before: norm(lens.before), same: norm((lens.same || []).map(x => typeof x === 'string' ? x : x.label + ': ' + x.value)), past: norm(lens.past) };
  const tabs = [['before', 'Before and after'], ['same', 'Same time, other signals'], ['past', 'Similar past']];
  const [cur, setCur] = useState('before');
  return <div>
    <div className="seg" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" aria-pressed={k === cur} onClick={() => setCur(k)}>{n + ' (' + mk[k].length + ')'}</button>)}</div>
    <div style={{ height: 6 }} />
    <div>{mk[cur].length ? mk[cur].map((x, i) => <div key={i} className={'li ' + (x.phase || '')}><span className="dotp" /><span>{x.text}</span></div>) : <div className="cap">Nothing found.</div>}</div>
  </div>;
}
