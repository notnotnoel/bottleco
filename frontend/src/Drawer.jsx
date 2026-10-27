// Time drawer (video-player style): scrub bar, play/pause, jumps, speed chips, warnings, story moments.
import { useEffect, useRef, useState } from 'react';
import { dlabel, dt, full, hhmm } from './lib.js';
import { Ico } from './ui.jsx';

export const SPEEDS = [['Real', 1 / 60], ['1×', 1], ['2×', 2], ['3×', 3], ['5×', 5], ['10×', 10], ['30×', 30], ['60×', 60], ['360×', 360]];
const A = Math.log10(1 / 60), B = Math.log10(360);
const rateOf = v => Math.pow(10, A + (B - A) * v / 100), posOf = r => (Math.log10(r) - A) / (B - A) * 100;
export const fmtRate = r => r <= 1 / 60 * 1.06 ? '1 s = 1 s' : r < 1 ? '1 s = ' + Math.round(r * 60) + ' s' : r < 60 ? '1 s = ' + (r < 10 ? (Math.round(r * 10) / 10) : Math.round(r)) + ' min' : '1 s = ' + (Math.round(r / 6) / 10) + ' h';
export const near = (a, b) => Math.abs(Math.log10(a / b)) < .03;

// Phone (<=520 px): play, -10m, +10m, a speed button and a "More" menu. Warnings, moments, custom speed, pause switch,
// the trust sheet and the theme move into "More", so the time bar stays one short row.
export default function Drawer({ meta, now, t, clock, playing, rate, incidents, watchInc, pauseOnAlert, setPauseOnAlert, onToggle, onSeek, onRate, toast, theme, onTheme, onSafety }) {
  const N = meta.N, [bump, setBump] = useState(null), scrub = useRef(null), spd = useRef(null), [hover, setHover] = useState(null), [pop, setPop] = useState(null), [every, setEvery] = useState(1), drag = useRef(false);
  const pct = t / (N - 1) * 100, hit = SPEEDS.some(([, r]) => near(r, rate));
  useEffect(() => { const on = spd.current && spd.current.querySelector('[aria-pressed=true]'); if (on && spd.current.scrollWidth > spd.current.clientWidth) spd.current.scrollTo({ left: on.offsetLeft - (spd.current.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' }); }, [rate]);
  useEffect(() => { const ro = new ResizeObserver(() => { const w = scrub.current.getBoundingClientRect().width; setEvery(w < 420 ? 3 : w < 700 ? 2 : 1); }); ro.observe(scrub.current); return () => ro.disconnect(); }, []);
  useEffect(() => { if (!pop) return; const off = e => { if (!e.target.closest('.pop') && !e.target.closest('.chip') && !e.target.closest('[data-pop]')) setPop(null); }; const id = setTimeout(() => document.addEventListener('pointerdown', off, true), 0); return () => { clearTimeout(id); document.removeEventListener('pointerdown', off, true); }; }, [pop]);
  const pos = e => { const r = scrub.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const jumpWarn = dir => {
    const L = incidents.map(i => i.start).sort((a, b) => a - b), x = dir > 0 ? L.find(v => v > now) : [...L].reverse().find(v => v < now - 1);
    if (x == null) { toast(dir > 0 ? 'No later warning in the data.' : 'No earlier warning.'); return; } onSeek(x);
  };
  // Jump from the live clock (not the last render), then show a short "+10 min" bubble and flash the header time.
  const step = (lab, sub, m, cls) => <button className={'tb step ' + (cls || '')} aria-label={'Jump ' + sub} title={'Jump ' + sub}
    onClick={() => {
      const from = clock ? clock.current.t : t, to = Math.max(0, Math.min(N - 1, from + m));
      if (to === from) { toast(m > 0 ? 'This is the end of the data.' : 'This is the start of the data.'); return; }
      onSeek(to); setBump({ m, k: Date.now() });
      const h = document.querySelector('.hclock .ht'); if (h) { h.classList.remove('jolt'); void h.offsetWidth; h.classList.add('jolt'); }
    }}>
    <span>{lab}</span><small>{sub}</small>{bump && bump.m === m && <i key={bump.k} className="bump" aria-hidden="true" onAnimationEnd={() => setBump(null)}>{lab}</i>}</button>;
  const spdName = (SPEEDS.find(([, r]) => near(r, rate)) || ['Custom'])[0];
  const more = (lab, icon, fn, extra) => <button className="mrow" onClick={() => { fn(); if (!extra) setPop(null); }}><Ico n={icon} /><span>{lab}</span></button>;
  return (
    <footer className="drawer glass" aria-label="Time controls">
      <div className="scrub" ref={scrub} role="slider" tabIndex={0} aria-label="Time bar. Arrow keys move 10 minutes. Shift plus arrow moves 1 hour." aria-valuemin={0} aria-valuemax={N - 1} aria-valuenow={now} aria-valuetext={full(now)}
        onPointerDown={e => { drag.current = true; scrub.current.setPointerCapture(e.pointerId); onSeek(pos(e) * (N - 1)); }}
        onPointerMove={e => { const p = pos(e); setHover(p); if (drag.current) onSeek(p * (N - 1)); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }} onPointerLeave={() => setHover(null)}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 60 : 10)); } }}>
        <div className="track"><div className="played" style={{ width: pct + '%' }} />
          {watchInc.map(i => <div key={i.id} className="mk" style={{ left: (i.t0 / (N - 1) * 100) + '%', width: (Math.max(2, Math.min(i.end, now) - i.t0) / (N - 1) * 100) + '%', top: i.line ? '50%' : '0', bottom: i.line ? '0' : '50%' }} />)}</div>
        <div className="thumb" style={{ left: pct + '%' }} />
        {hover != null && <div className="hover" style={{ left: (hover * 100) + '%', opacity: 1 }}>{full(Math.round(hover * (N - 1)))}</div>}
        {meta.moments.map(s => <div key={s.id} className="chap" style={{ left: (s.at / (N - 1) * 100) + '%' }} title={dlabel(s.at) + ' · ' + s.name} />)}
        {Array.from({ length: meta.days }, (_, d) => <div key={d} className={'dl' + (d === 0 ? ' first' : '')} style={{ left: (d * 1440 / (N - 1) * 100) + '%', display: d % every === 0 ? '' : 'none' }}>{dt(d * 1440).getUTCDate() + ' Sep'}</div>)}
      </div>
      <div className="drow2">
        <div className="dleft">
          <button className="chip" title="Jump to the previous warning" aria-label="Previous warning" onClick={() => jumpWarn(-1)}><Ico n="back" /><span className="hide-s">Prev warning</span></button>
          <button className="chip" title="Jump to the next warning" aria-label="Next warning" onClick={() => jumpWarn(1)}><span className="hide-s">Next warning</span><Ico n="fwd" /></button>
          <button className="chip" aria-haspopup="dialog" title="Jump to a story moment" onClick={() => setPop(pop === 'chap' ? null : 'chap')}><Ico n="list" /><span className="hide-s">Moments</span></button>
          <span className="dmeta">{'Day ' + (Math.floor(now / 1440) + 1) + ' of ' + meta.days + ' · ' + fmtRate(rate)}</span>
        </div>
        <div className="tport">
          <button className="tb ph spdb" data-pop aria-haspopup="dialog" aria-expanded={pop === 'speed'} aria-label={'Time speed ' + spdName} onClick={() => setPop(pop === 'speed' ? null : 'speed')}><span>{spdName}</span></button>
          {step('−1h', '1 hour back', -60, 'k1h')}{step('−10m', '10 min back', -10)}
          <button className="tb play" aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)" onClick={() => onToggle()}><Ico n={playing ? 'pause' : 'play'} /></button>
          {step('+10m', '10 min on', 10)}{step('+1h', '1 hour on', 60, 'k1h')}
          <button className="tb ph moreb" data-pop aria-haspopup="menu" aria-expanded={pop === 'more'} aria-label="More time controls" onClick={() => setPop(pop === 'more' ? null : 'more')}><Ico n="more" /></button></div>
        <div className="dright2">
          <div className="speedseg" ref={spd} role="group" aria-label="Time speed">{SPEEDS.map(([n, r]) => <button key={n} aria-pressed={near(r, rate)} aria-label={'Speed ' + n} title={r < 1 ? 'Real time: 1 second = 1 second' : '1 second = ' + (r < 60 ? r + ' min' : (r / 60) + ' h')} onClick={() => onRate(r)}>{n}</button>)}</div>
          <button className="chip" aria-haspopup="dialog" aria-pressed={!hit} style={{ background: hit ? '' : 'var(--blue-soft)' }} title="Set any speed" onClick={() => setPop(pop === 'speed' ? null : 'speed')}><Ico n="gauge" /><span className="hide-s">Custom</span></button>
          <label className="sw" title="Stop the clock when a new warning appears"><input type="checkbox" checked={pauseOnAlert} onChange={e => setPauseOnAlert(e.target.checked)} /><span className="knob" />Pause at warnings</label>
        </div>
      </div>
      {pop === 'more' && <div className="pop more" role="menu"><div>
        {more('Previous warning', 'back', () => jumpWarn(-1))}{more('Next warning', 'fwd', () => jumpWarn(1))}
        {more('Story moments', 'list', () => setPop('chap'), true)}
        <label className="mrow sw"><Ico n="pause" /><span>Pause at warnings</span><input type="checkbox" checked={pauseOnAlert} onChange={e => setPauseOnAlert(e.target.checked)} /><span className="knob" /></label>
        <div className="msep" />
        {more('Why you can trust the answers', 'shield', () => onSafety && onSafety())}
        {more('Appearance: ' + (theme || 'dark'), theme === 'auto' ? 'auto' : theme === 'light' ? 'sun' : 'moon', () => onTheme && onTheme(), true)}
      </div></div>}
      {pop === 'speed' && <div className="pop"><div><h5>Any speed</h5><div className="big2 tn">{fmtRate(rate)}</div>
        <div className="spgrid ph-grid">{SPEEDS.map(([n, r]) => <button key={n} aria-pressed={near(r, rate)} onClick={() => onRate(r)}>{n}</button>)}</div>
        <input type="range" min={0} max={100} step={1} aria-label="Time speed" value={posOf(rate)} style={{ '--p': posOf(rate) + '%' }} onChange={e => onRate(rateOf(+e.target.value))} />
        <div className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}><span>1 s = 1 s</span><span>1 s = 6 hours</span></div></div></div>}
      {pop === 'chap' && <div className="pop"><div className="chaplist l" style={{ width: 'min(420px,calc(100vw - 32px))' }}><h5 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--label2)' }}>Jump to a moment (45 min before)</h5>
        {meta.moments.map(s => <button key={s.id} onClick={() => { onSeek(s.at - 45); setPop(null); }}><em>{dlabel(s.at) + ' ' + hhmm(s.at)}</em><div><b>{meta.names[s.line] + ' · ' + s.name}</b><span>{s.text}</span></div></button>)}</div></div>}
    </footer>
  );
}
