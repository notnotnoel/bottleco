// BottleCo app shell: header clock, production floor, Explorer + Monitor panes, time drawer.
// The app holds the clock (decision D7). The API computes every number for the minute it is asked about.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Drawer, { SPEEDS, near } from './Drawer.jsx';
import Explorer from './Explorer.jsx';
import Floor from './Floor.jsx';
import Monitor from './Monitor.jsx';
import { NOT_USED, SHIFTS, SLIDER_FMT, api, full, hhmm, makeDays, shiftOf } from './lib.js';
import { Ico, Modal, useToast } from './ui.jsx';

const GROUPS = {
  E: [['What I look at', ['around', 'simK', 'simCut', 'rows', 'sure', 'memory']], ['How I talk', ['wording', 'length']], ['How I think', ['brain', 'think', 'retries', 'effort']]],
  W: [['Warning levels', ['oeeLim', 'stopLim', 'speedLim', 'rejLim', 'coverLim']], ['When I warn', ['every', 'hold', 'cool']], ['What I compare', ['baseDays', 'around', 'nCauses', 'reportLen']], ['How I talk', ['wording', 'length']], ['How I think', ['brain', 'think', 'retries', 'effort']]]
};
const defaults = meta => Object.fromEntries(meta.sliders.map(s => [s.key, s.default]));

function Settings({ which, meta, S, setS, onClose, toast }) {
  const [v, setV] = useState(S), t = useRef(0), SL = Object.fromEntries(meta.sliders.map(s => [s.key, s]));
  const change = (k, x) => { const n = { ...v, [k]: x }; setV(n); clearTimeout(t.current); t.current = setTimeout(() => setS(n), 250); };
  const reset = () => { const d = defaults(meta); setV(d); setS(d); toast('Back to the default settings.'); };
  return <Modal title={which === 'E' ? 'Data Explorer settings' : 'Monitor settings'} onClose={onClose} foot={<button className="btn" onClick={reset}>Reset</button>}>
    <div className="mnote">Move a slider. Words and effort change. Numbers never change: code computes them from the data.</div>
    {GROUPS[which].map(([title, keys]) => <div key={title} className="grp"><h6>{title}</h6><div className="list">{keys.map(k => {
      const s = SL[k], p = ((v[k] - s.min) / (s.max - s.min) * 100) + '%';
      return <div key={k} className="srow"><div className="t"><b>{s.q}</b>{NOT_USED.has(k) && <span className="later" title="This version runs a fixed number of steps">Not used yet</span>}<em>{SLIDER_FMT[k](v[k])}</em></div>
        <input type="range" min={s.min} max={s.max} step={s.step} value={v[k]} aria-label={s.q} style={{ '--p': p }} onChange={e => change(k, +e.target.value)} />
        <div className="lr"><span>{s.left}</span><span>{s.right}</span></div></div>;
    })}</div></div>)}
  </Modal>;
}
function Safety({ onClose }) {
  const items = [['Code computes every number.', 'The language model only reads your question and, if you ask for it, writes the words around the numbers.'],
    ['Every number can be checked.', 'Tap a blue number to see where it came from. A second code path computes it again. If the two differ, I say "I cannot confirm this".'],
    ['"Not in the data" is a valid answer.', 'Costs, energy, forecasts and opinions are not in the data. I say so, and I do not guess.'],
    ['A cause needs proof.', 'I name a cause only when enough checks pass. Otherwise I say "the cause is not clear".'],
    ['No peeking at the future.', 'I read only data up to the time bar. Move the bar back, and my answers change.'],
    ['I can only read.', 'The data is read-only. I cannot change it.']];
  return <Modal title="Why you can trust the answers" onClose={onClose}><ol className="safe">{items.map(([a, b]) => <li key={a}><b>{a + ' '}</b>{b}</li>)}</ol></Modal>;
}

export default function App() {
  const [meta, setMeta] = useState(null), [, force] = useState(0);
  const [SE, setSE] = useState(null), [SW, setSW] = useState(null), [tab, setTab] = useState('chat'), [theme, setTheme] = useState('dark');
  const [now, setNow] = useState(0), [playing, setPlaying] = useState(false), [rate, setRate] = useState(10), [pauseOnAlert, setPauseOnAlert] = useState(true);
  const [allInc, setAllInc] = useState([]), [watch, setWatch] = useState({ alerts: [], incidents: [] }), [sheetId, setSheetId] = useState(null), [modal, setModal] = useState(null);
  const [toastNode, toast] = useToast();
  const days = useMemo(() => makeDays(() => force(x => x + 1)), []);
  const clock = useRef({ t: 0, playing: false, rate: 10, now: () => Math.max(0, Math.floor(clock.current.t)) });
  const swRef = useRef(null); swRef.current = SW;

  useEffect(() => { api.meta().then(m => { setMeta(m); const d = defaults(m); setSE(d); setSW({ ...d }); const t0 = (3 - 1) * 1440 + 7 * 60 + 30 - 360; clock.current.t = t0; setNow(t0); }); }, []);
  useEffect(() => { const r = document.documentElement; if (theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { if (SW) api.scan(SW).then(r => setAllInc(r.incidents)); }, [SW]);
  // load the minute data around now (and the day before, for 6-hour sparklines)
  useEffect(() => { const c = Math.floor(now / 1440); days.ensure(c); days.ensure(c - 1); days.ensure(c + 1); }, [now, days]);
  // Line Watcher: warnings and pills up to now (latest request wins)
  useEffect(() => {
    if (!SW || !meta) return; const ctl = new AbortController();
    const id = setTimeout(() => api.watch(SW, now, ctl.signal).then(setWatch).catch(() => {}), playing ? 120 : 0);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [SW, now, meta, playing]);

  const seek = useCallback(m => { if (!meta) return; clock.current.t = Math.max(0, Math.min(meta.N - 1, m)); setNow(clock.current.now()); }, [meta]);
  const toggle = useCallback(on => { const p = on == null ? !clock.current.playing : on; if (p && meta && clock.current.t >= meta.N - 2) clock.current.t = 0; clock.current.playing = p; setPlaying(p); }, [meta]);
  const changeRate = r => { clock.current.rate = r; setRate(r); };
  // main loop: the app holds the clock
  const incRef = useRef([]); incRef.current = allInc; const poa = useRef(true); poa.current = pauseOnAlert;
  useEffect(() => {
    if (!meta) return; let last = performance.now(), raf = 0, prevNow = clock.current.now();
    const loop = ts => {
      const c = clock.current, dt = Math.min(.1, (ts - last) / 1000); last = ts;
      if (c.playing) {
        const next = Math.min(meta.N - 1, c.t + c.rate * dt), nm = Math.floor(next);
        if (!days.ready(nm)) { days.ensure(Math.floor(nm / 1440)); } else {   // wait for the data, then move on
          c.t = next; if (c.t >= meta.N - 1) { c.playing = false; setPlaying(false); }
          if (nm !== prevNow) {
            if (poa.current && incRef.current.some(i => i.start > prevNow && i.start <= nm)) { c.playing = false; setPlaying(false); toast('Warning at ' + hhmm(nm) + '. Paused. Click the new RCA pill.'); }
            prevNow = nm; setNow(nm);
          }
        }
      } else prevNow = c.now();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [meta, days]);
  useEffect(() => { clock.current.rate = rate; }, [rate]);
  // keyboard: Space plays, arrows jump, up/down change speed
  useEffect(() => {
    const key = e => {
      if (e.target.closest('input,textarea,select,[role=slider]') || e.metaKey || e.ctrlKey || document.querySelector('.scrim')) return;
      if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); seek(clock.current.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 60 : 10)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); let i = SPEEDS.findIndex(p => near(p[1], clock.current.rate)); if (i < 0) i = SPEEDS.findIndex(p => p[1] >= clock.current.rate); if (i < 0) i = SPEEDS.length - 1; changeRate(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === 'ArrowUp' ? 1 : -1)))][1]); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [toggle, seek]);
  useEffect(() => { window.__bottleco = { seek, toggle, setRate: changeRate, clock }; }, [seek, toggle]);  // hook for the end-to-end tests
  const showTab = k => { setTab(k); if (window.innerWidth <= 520) setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 60); };
  const openSheet = id => { setSheetId(id); if (id != null && window.innerWidth <= 520) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); };

  if (!meta || !SE || !SW) return <div className="app"><div className="cap" style={{ padding: 24 }}>Loading BottleCo…</div></div>;
  const s = shiftOf(now), st = now - (now % 480), parts = full(now).match(/^(\w+) (\d+ \w+) (\d\d:\d\d)$/);
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><b>BottleCo</b><span>Bottle Co · 2 filling lines · sample data</span></div>
        <div className="hclock" role="timer" aria-live="off" aria-label="Current date, time and shift">
          <div className="hd"><b>{parts[1] + ' ' + parts[2]}</b><small>{'2026 · Day ' + (Math.floor(now / 1440) + 1) + ' of ' + meta.days}</small></div>
          <div className="ht tn">{parts[3]}</div>
          <div className={'hs s' + SHIFTS[s]}><i /><span>{'Shift ' + SHIFTS[s]}</span><small>{hhmm(st) + '–' + hhmm(st + 480)}</small></div>
        </div>
        <div className="acts">
          <button className="chip ok" aria-label="Why you can trust the answers" onClick={() => setModal('safe')}><Ico n="shield" /><span className="hide-s">Answers only from data</span></button>
          <button className="iconbtn" aria-label="Appearance" title={'Appearance: ' + theme} onClick={() => { const n = { dark: 'light', light: 'auto', auto: 'dark' }[theme], r = document.documentElement; if (n === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', n); setTheme(n); }}><Ico n={theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun'} /></button>
        </div>
      </header>
      <Floor meta={meta} days={days} clock={clock} settingsRef={swRef} theme={theme} />
      <nav className="seg tabs" role="tablist" aria-label="Panels">
        <button aria-pressed={tab === 'chat'} onClick={() => showTab('chat')}>Explorer</button><button aria-pressed={tab === 'watch'} onClick={() => showTab('watch')}>Monitor</button></nav>
      <main className="panes">
        <Explorer now={now} S={SE} incidents={watch.incidents} onGear={() => setModal('E')} show={tab === 'chat'} />
        <Monitor meta={meta} days={days} now={now} S={SW} watch={watch} playing={playing} onGear={() => setModal('W')} sheetId={sheetId} setSheetId={openSheet} show={tab === 'watch'} />
      </main>
      <Drawer meta={meta} now={now} t={clock.current.t} playing={playing} rate={rate} incidents={allInc} watchInc={watch.incidents}
        pauseOnAlert={pauseOnAlert} setPauseOnAlert={setPauseOnAlert} onToggle={toggle} onSeek={seek} onRate={changeRate} toast={toast} />
      {modal === 'E' && <Settings which="E" meta={meta} S={SE} setS={setSE} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'W' && <Settings which="W" meta={meta} S={SW} setS={setSW} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'safe' && <Safety onClose={() => setModal(null)} />}
      {toastNode}
    </div>
  );
}
