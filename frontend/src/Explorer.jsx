// Data Explorer: iMessage-style chat. Every answer shows the data queried, the raw rows and the trend.
import { useEffect, useRef, useState } from 'react';
import { api, dlabel, dt, fmtN, full, hhmm } from './lib.js';
import { FactText, Ico, LensView, MiniTable, Modal, TrendChart, trendWords } from './ui.jsx';

function FactModal({ f, onClose }) {
  const fm = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toString();
  return <Modal title="Where this number comes from" onClose={onClose}><div className="blk"><h4>{f.label}</h4><p className="big tn">{f.shown}</p>
    <p>Code computed this number from the rows in the "Raw data" card. A second code path counted the rows again.</p>
    <table className="kt"><tbody><tr><td>First count</td><td className="tn">{fm(f.value)}</td></tr><tr><td>Second count</td><td className="tn">{fm(f.check)}</td></tr></tbody></table>
    <div className={'foot' + (f.ok ? '' : ' bad')}><Ico n="shield" />{f.ok ? 'The two counts match.' : 'The two counts differ.'}</div></div></Modal>;
}
const Att = ({ icon, title, count, open, children }) => <details className="att" open={open}><summary><Ico n={icon} />{title}{count && <span className="cnt">{count}</span>}</summary><div className="ab">{children}</div></details>;
function RawCard({ raw }) {
  const [all, setAll] = useState(false), cap = 6, rows = all ? raw.rows.slice(0, 200) : raw.rows.slice(0, cap);
  return <Att icon="table" title="Raw data" count={(raw.table || '') + ' · ' + fmtN(raw.total) + ' rows'} open>
    <MiniTable cols={raw.cols} rows={rows} cap={rows.length} />
    {raw.rows.length > cap && !all && <button className="btn" style={{ marginTop: 8, height: 28 }} onClick={() => setAll(true)}>{'Show ' + Math.min(200, raw.rows.length) + ' rows'}</button>}
    <div className="more">{raw.cut ? 'Showing ' + raw.rows.length + ' of ' + fmtN(raw.total) + ' rows. The "How much data may I read?" slider sets the limit.' : fmtN(raw.total) + ' row' + (raw.total === 1 ? '' : 's') + ' in total.'}</div>
  </Att>;
}
function Answer({ a, onAsk, onFact }) {
  if (a.kind === 'abstain') return <div className="msg in">
    <div className="bub warn"><div className="tag">{a.failed ? 'Could not confirm' : 'Not in the data'}</div>{a.text}{a.dataRange && <div className="cap">{a.dataRange + ' Up to now means up to the time bar.'}</div>}</div>
    <div className="sugs" style={{ padding: '6px 0 0', flexWrap: 'wrap', overflow: 'visible' }}>{(a.suggestions || []).slice(0, 4).map(q => <button key={q} className="sug" onClick={() => onAsk(q)}>{q}</button>)}</div></div>;
  const v = a.verdict;
  return <div className="msg in">
    {v ? <div className="bub"><FactText text={a.headline} facts={a.facts} onTap={onFact} />
      <div className={'verdict k-' + v.kind}><div className="vt"><span className="vb">{v.kind === 'cause' ? '✓' : v.kind === 'unclear' ? '?' : '–'}</span><div><b>{v.title}</b><small>{v.sub}</small></div></div>
        {v.lines.map((x, i) => <div key={i} className="chk"><b className={v.kind === 'cause' ? 'y' : 's'}>{v.kind === 'cause' ? '✓' : '·'}</b><span>{x}</span></div>)}</div></div>
      : <div className="bub"><FactText text={a.text} facts={a.facts} onTap={onFact} /></div>}
    {a.shown_model && <div className="bub" style={{ marginTop: 4 }}><div className="tag">In plain words</div>{a.shown_model}</div>}
    <Att icon="db" title="Data queried" count={a.queried.length + ' source' + (a.queried.length > 1 ? 's' : '')} open>{a.queried.map((q, i) => <div key={i} className="qrow"><code>{q.table}</code><span>{q.filter + ' · ' + fmtN(q.rows) + ' rows'}</span></div>)}</Att>
    {a.raw && <RawCard raw={a.raw} />}
    {a.trend && a.trend.series && <Att icon="trend" title="Trend observed" open><TrendChart tr={a.trend} info={a.trendInfo} /><div className="cap">{trendWords(a.trend, a.trendInfo)}</div>{a.trendInfo && a.trendInfo.note && <div className="cap">{a.trendInfo.note}</div>}</Att>}
    {a.lens && <Att icon="eye" title="Context I checked" count="before, same time, similar past"><LensView lens={a.lens} /></Att>}
    {a.tested && a.tested.length > 0 && <Att icon="find" title="Causes I tested" count={a.tested.length + ' ideas'}>{a.tested.map((t, i) => <div key={i} className="li"><span className="dotp" /><span>{t}</span></div>)}</Att>}
    <div className="foot"><Ico n="shield" />{a.check.ok + ' of ' + a.check.total + ' numbers checked a second way · data up to ' + full(a.at_now) + (a.planner === 'model' ? ' · question read by Claude' : ' · question read by rules')}</div>
    {a.note && <div className="cap">{a.note}</div>}
  </div>;
}

export default function Explorer({ now, S, incidents, onGear, show }) {
  const [log, setLog] = useState([]), [busy, setBusy] = useState(false), [step, setStep] = useState(''), [text, setText] = useState(''), [fact, setFact] = useState(null);
  const chat = useRef([]), box = useRef(null), nowRef = useRef(now); nowRef.current = now;
  useEffect(() => { requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }); }, [log, step]);
  async function ask(q) {
    q = (q || '').trim(); if (!q || busy) return; setBusy(true); setText('');
    const at = nowRef.current;
    setLog(l => [...l, { out: q, at }]); setStep('Reading your question…');
    const keep = Math.max(2, Math.round(S.memory));
    const ans = await api.askStream({ question: q, now: at, settings: S, chat: chat.current.slice(-keep) }, setStep);
    ans.at_now = at;
    if (ans.parsed) { chat.current.push({ q, parsed: ans.parsed }); if (chat.current.length > keep) chat.current.splice(0, chat.current.length - keep); }
    setLog(l => [...l, { ans }]); setStep(''); setBusy(false);
  }
  const cd = dt(now).getUTCDate(), last = [...incidents].filter(i => i.start <= now).sort((a, b) => b.start - a.start)[0], sugs = [];
  if (last) { const noun = { oee: 'overall score', stop: 'stopped time', speed: 'speed', rej: 'rejects', cover: 'preforms left' }[last.first], dir = last.first === 'stop' || last.first === 'rej' ? 'rise' : 'drop'; sugs.push([`Why did Line ${last.line + 1} ${noun} ${dir} on ${dlabel(last.start)}?`]); }
  else sugs.push(['How is Line 1 doing now?']);
  sugs.push(['Which stop reason cost the most minutes on Line 2?']);
  if (cd >= 2) sugs.push(['How many bottles were rejected yesterday?']);
  sugs.push(['Compare shift A, B and C on both lines']);
  const at = last ? last.start : Math.max(60, now - 30); sugs.push([`What happened at ${hhmm(at)} on ${dt(at).getUTCDate()} Sep?`]);
  sugs.push(['What will the overall score be tomorrow?', 'trick'], ['What did Line 3 make yesterday?', 'trick']);
  return (
    <section className={'pane card' + (show ? ' show' : '')} id="paneEx" aria-label="Data Explorer">
      <div className="phead"><div className="avatar ex"><Ico n="chat" /></div><div className="tt"><b>Data Explorer</b><span>Reads only data up to the time bar</span></div>
        <button className="iconbtn" aria-label="Data Explorer settings" onClick={onGear}><Ico n="sliders" /></button></div>
      <div className="chat" ref={box} aria-live="polite">
        <div className="msg in"><div className="bub">Hi. I am the Data Explorer. I answer only from Bottle Co data, and only up to the time on the time bar. Every answer shows the data I queried, the raw rows and the trend I saw.</div>
          <div className="bub tail" style={{ marginTop: 4 }}>Press play, then ask me why something happened. Tap a blue number to see where it comes from.</div></div>
        {log.map((m, i) => m.out ? <div key={i}><div className="ts tn">{full(m.at)}</div><div className="msg out"><div className="bub tail">{m.out}</div></div></div>
          : <Answer key={i} a={m.ans} onAsk={ask} onFact={setFact} />)}
        {busy && <><div className="msg in"><div className="bub tail typing" aria-label="Checking the data"><i /><i /><i /></div></div><div className="step">{step}</div></>}
      </div>
      <div className="sugs">{sugs.map(([q, t]) => <button key={q} className={'sug' + (t ? ' trick' : '')} title={t ? 'A trick question. I should refuse.' : ''} onClick={() => ask(q)}>{q}</button>)}</div>
      <form className="composer" autoComplete="off" onSubmit={e => { e.preventDefault(); ask(text); }}>
        <input type="text" placeholder="Ask about Line 1 or Line 2" aria-label="Ask a question" enterKeyHint="send" value={text} onChange={e => setText(e.target.value)} />
        <button className="send" type="submit" aria-label="Send" disabled={busy || !text.trim()}><Ico n="send" /></button></form>
      {fact && <FactModal f={fact} onClose={() => setFact(null)} />}
    </section>
  );
}
