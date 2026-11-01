// Agent trace log (top right): what the agents did in this session, step by step, in plain words.
// Entries come from the API (each answer and each RCA report carries its own steps, times and cost)
// and from new Line Watcher warnings. Kept in memory only; a page reload starts a new session.
import { useEffect, useRef, useState } from 'react';
import { full, hhmm } from './lib.js';
import { Ico } from './ui.jsx';

export const pushTrace = e => window.dispatchEvent(new CustomEvent('bottleco:trace', { detail: { ...e, wall: Date.now(), id: Math.random().toString(36).slice(2) } }));

const dur = ms => ms == null ? '' : ms < 1000 ? Math.max(1, Math.round(ms)) + ' ms' : (ms / 1000).toFixed(1) + ' s';
const usd = v => !v ? 'code only, no AI cost' : 'AI cost US$' + (v < 0.0001 ? '0.0001' : v < 0.01 ? v.toFixed(4) : v.toFixed(3));

function Entry({ e }) {
  if (e.kind === 'warn') return <li className="te warn">
    <div className="th"><i className="dot w" /><b>Line Watcher</b><span>{'time bar ' + full(e.at)}</span></div>
    <div className="tt">{e.items.length === 1 ? 'New warning' : e.items.length + ' new warnings'}</div>
    <ul className="ts">{e.items.slice(0, 4).map(i => <li key={i.id}><span className="ok">!</span><span><b>{i.title}</b>{' · ' + hhmm(i.start)}<small>{i.causeName ? 'Cause: ' + i.causeName : 'Cause not clear yet'}</small></span></li>)}
      {e.items.length > 4 && <li><span className="ok">·</span><span>{'and ' + (e.items.length - 4) + ' more'}</span></li>}</ul>
  </li>;
  const t = e.trace || {};
  return <li className={'te ' + (t.agent === 'Line Watcher' ? 'warn' : 'ex')}>
    <div className="th"><i className={'dot ' + (t.agent === 'Line Watcher' ? 'w' : 'e')} /><b>{t.agent}</b><span>{'time bar ' + full(e.at)}</span></div>
    <div className="tt">{e.q ? '“' + e.q + '”' : t.title}</div>
    <ul className="ts">{(t.steps || []).map((s, i) => <li key={i}><span className="ok">✓</span><span><b>{s.step}</b>{' · ' + s.how}</span><em>{dur(s.ms)}</em></li>)}</ul>
    <div className="tf">{(t.cached ? 'From memory' : 'Total ' + dur(t.ms)) + ' · ' + usd(t.usd) + (t.tokens ? ' · ' + t.tokens.toLocaleString('en-US') + ' tokens' : '') + (t.langsmith ? ' · saved in LangSmith' : '')}</div>
  </li>;
}

export default function Trace({ langsmith }) {
  const [log, setLog] = useState([]), [open, setOpen] = useState(false), [seen, setSeen] = useState(0), pane = useRef(null), btn = useRef(null);
  useEffect(() => { const on = ev => setLog(l => [ev.detail, ...l].slice(0, 200)); window.addEventListener('bottleco:trace', on); return () => window.removeEventListener('bottleco:trace', on); }, []);
  useEffect(() => {
    if (!open) return; setSeen(log.length);
    const key = e => { if (e.key === 'Escape') setOpen(false); };
    const off = e => { if (pane.current && !pane.current.contains(e.target) && !btn.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', off, true);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', off, true); };
  }, [open, log.length]);
  const fresh = Math.max(0, log.length - seen);
  return <>
    <button ref={btn} className={'tracebtn' + (open ? ' on' : '')} aria-haspopup="dialog" aria-expanded={open} aria-label={'Agent trace log' + (fresh ? ', ' + fresh + ' new' : '')} title="Agent trace: what the agents did" onClick={() => setOpen(o => !o)}>
      <Ico n="trace" /><span className="hide-s">Trace</span>{fresh > 0 && <i className="badge tn">{fresh > 99 ? '99+' : fresh}</i>}</button>
    {open && <div ref={pane} className="tracep" role="dialog" aria-label="Agent trace log">
      <div className="tph"><div><b>Agent trace</b><span>This session · newest first</span></div>
        {log.length > 0 && <button className="tclear" onClick={() => { setLog([]); setSeen(0); }}>Clear</button>}
        <button className="iconbtn" aria-label="Close" onClick={() => setOpen(false)}><Ico n="x" /></button></div>
      <p className="tsub">Each step the agents took, how long it took and what it cost. Claude is paid only when it reads a question or re-words text; rules and code are free.{langsmith ? ' Each run is also saved in LangSmith.' : ''}</p>
      {log.length ? <ol className="tlist">{log.map(e => <Entry key={e.id} e={e} />)}</ol>
        : <div className="tempty">Nothing yet. Ask a question, open an RCA report or press play.</div>}
    </div>}
  </>;
}
