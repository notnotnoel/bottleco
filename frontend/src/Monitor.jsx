// Production Monitor (Line Watcher): 5 live KPI tiles per line, RCA pills, and the full RCA sheet.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, fmtKpi, full, hhmm } from './lib.js';
import { FactText, Ico, LensView, MiniTable, Modal, Sparkline, TrendChart, trendWords } from './ui.jsx';

const WIN = { oee: 60, stop: 60, speed: 15, rej: 30, cover: 30 };
const stWord = s => s === 0 ? 'running' : s === 1 ? 'stopped' : 'planned';

export function RowsModal({ f, meta, days, onClose }) {
  const w = WIN[f.key] || 30, a = Math.max(0, f.t - w + 1), rows = [];
  for (let i = a; i <= f.t; i++) { const rid = days.field(f.line, 'rid', i); rows.push([hhmm(i), stWord(days.field(f.line, 'st', i)), (rid >= 1 && rid <= 6 ? meta.faults[rid - 1] : rid >= 11 ? meta.planned[rid - 11] : '') || '–', days.field(f.line, 'prod', i), days.field(f.line, 'rej', i), days.field(f.line, 'stock', i)]); }
  return <Modal title="Where this number comes from" onClose={onClose}>
    <div className="blk"><h4>{f.label}</h4><p className="big tn">{f.shown}</p>
      <p>{'Computed by code from ' + rows.length + ' minute rows of ' + meta.names[f.line] + ', ' + full(a) + ' to ' + hhmm(f.t) + '.'}</p>
      <div className={'foot' + (f.ok ? '' : ' bad')}><Ico n="shield" />{f.ok ? 'Checked: a second code path gives the same number.' : 'Check failed: the two code paths differ.'}</div></div>
    <div className="blk"><h4>Rows used</h4><MiniTable cols={['time', 'state', 'stop reason', 'produced', 'rejects', 'preform stock']} rows={rows} cap={80} /></div>
  </Modal>;
}

function limOf(K, S) { return (K.dir === 'below' ? 'Warn below ' : 'Warn above ') + S[K.lim] + (K.key === 'stop' || K.key === 'cover' ? ' min' : '%'); }
const breach = (K, S, v) => v != null && (K.dir === 'below' ? v < S[K.lim] / K.scale : v > S[K.lim] / K.scale);

export default function Monitor({ meta, days, now, S, watch, playing, onGear, sheetId, setSheetId, show }) {
  const [fresh, setFresh] = useState({}), seen = useRef(new Set()), freshPill = useRef(new Set()), seenPills = useRef(new Set());
  const active = (l, k) => (watch.alerts || []).find(a => a.line === l && a.key === k && a.ta <= now && a.tEnd >= now && (a.live || a.tEnd >= now));
  useEffect(() => { // a tile flashes once when a new warning starts while playing
    for (const a of watch.alerts || []) { const id = a.line + a.key + a.ta; if (a.ta <= now && a.live && !seen.current.has(id)) { seen.current.add(id); if (playing) { setFresh(f => ({ ...f, [a.line + a.key]: true })); setTimeout(() => setFresh(f => ({ ...f, [a.line + a.key]: false })), 2600); } } }
  }, [watch, now, playing]);
  const vis = (watch.incidents || []).filter(i => i.start <= now).sort((a, b) => b.start - a.start);
  return (
    <section className={'pane card' + (show ? ' show' : '')} id="paneWa" aria-label="Production Monitor">
      <div className="phead"><div className="avatar wa"><Ico n="eye" /></div>
        <div className="tt"><b>Production Monitor</b><span>Watches 5 signals on both lines, live</span></div>
        <button className="iconbtn" aria-label="Monitor settings" onClick={onGear}><Ico n="sliders" /></button></div>
      <div className="wbody">
        <div className="matrix">
          <div className="khead"><span /><div className="tiles">{meta.kpis.map(K => <div key={K.key} className="kh"><b>{K.name}</b><small>{limOf(K, S)}</small></div>)}</div></div>
          {[0, 1].map(l => {
            let nb = 0;
            const tiles = meta.kpis.map(K => {
              const v = days.kpi(l, K.key, now), br = breach(K, S, v), al = active(l, K.key); if (br) nb++;
              const pts = []; for (let x = Math.max(60, now - 360); x <= now; x += 12) { const y = days.kpi(l, K.key, x); if (y != null) pts.push([x, y]); }
              const cls = 'tile' + (v == null ? ' na' : '') + (br ? ' red alerting' : '') + (fresh[l + K.key] ? ' fresh' : '');
              return <div key={K.key} className={cls} title={K.what}>
                <div className="k">{K.name}</div><div className="v">{v === undefined ? '…' : fmtKpi(K.key, v, K.scale, K.unit)}</div>
                <div className="w">{br && al ? 'Warning since ' + hhmm(al.ta) : br ? 'Checking…' : v == null ? 'Too little run time' : limOf(K, S)}</div>
                <div className="spk"><Sparkline pts={pts} limit={S[K.lim] / K.scale} color={br ? 'var(--red)' : 'var(--blue)'} /></div>
              </div>;
            });
            return <div key={l} className="lcard"><div className="lhead"><b>{meta.names[l]}</b><span className={'state' + (nb ? ' stop' : '')}><i /><span>{nb ? nb + ' warning' + (nb > 1 ? 's' : '') : 'All clear'}</span></span></div><div className="tiles">{tiles}</div></div>;
          })}
        </div>
        <div className="rsec"><div className="sech">RCA reports<span>{vis.length ? ' · ' + vis.length : ''}</span><span>Click a pill to open the full analysis</span></div>
          <div className="rlist">
            {!vis.length ? <div className="empty">No warnings yet. Press play. An RCA pill appears here when something triggers.</div> :
              vis.map(inc => {
                const isNew = !seenPills.current.has(inc.id); if (isNew) { seenPills.current.add(inc.id); freshPill.current.add(inc.id); setTimeout(() => freshPill.current.delete(inc.id), 2600); }
                return <button key={inc.id} className={'rpill' + (inc.live ? ' live' : '') + (freshPill.current.has(inc.id) ? ' fresh' : '')} onClick={() => setSheetId(inc.id)}
                  aria-label={'RCA ' + inc.id + '. ' + inc.title + '. ' + (inc.cause ? 'Cause: ' + inc.causeName : 'Cause not clear') + (inc.live ? '. Still on.' : '. Cleared.') + ' Open the full report.'}>
                  <span className="dot" /><span className="tx"><b>{'RCA ' + inc.id + ' · ' + inc.title}</b><small>{full(inc.start) + ' · ' + (inc.cause ? 'Cause: ' + inc.causeName : 'Cause not clear') + (inc.live ? ' · still on' : '')}</small></span>
                  <span className={'badge' + (inc.cause ? '' : ' q')}>{inc.cause ? 'Cause found' : 'Not clear'}</span><span className="chev">›</span></button>;
              })}
          </div></div>
      </div>
      {sheetId != null && <Sheet id={sheetId} meta={meta} days={days} now={now} S={S} onClose={() => setSheetId(null)} />}
    </section>
  );
}

function Table({ cols, rows }) {
  return <table className="kt"><thead><tr>{cols.map((c, i) => <th key={i} className={i ? 'n' : ''}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.label}</td><td className={'n tn' + (r.bad ? ' up' : '')}>{r.now}</td><td className="n tn">{r.normal}</td><td className="n">{r.bad ? <span className="up">▲ off</span> : ''}</td></tr>)}</tbody></table>;
}
function Bars({ list, unit }) {
  const mx = Math.max(1, ...list.map(x => Math.max(x.now, x.normal || 0)));
  return list.map(x => <div key={x.name} className={'bar2' + (x.bad ? ' bad' : '')}><span className="nm" title={x.name}>{x.name}</span>
    <div className="hb"><i style={{ width: (x.now / mx * 100) + '%' }} />{x.normal != null && <em style={{ left: 'calc(' + (x.normal / mx * 100) + '% - 1px)' }} />}</div>
    <span className="vl">{x.now + unit}<small>{x.normal != null ? 'normal ' + (Math.round(x.normal * 10) / 10) : ''}</small></span></div>);
}
const Chk = ({ c }) => <div className="chk"><b className={c.skipped ? 's' : c.ok ? 'y' : 'n'}>{c.skipped ? '–' : c.ok ? '✓' : '✗'}</b><span><span style={{ color: 'var(--label)' }}>{c.text + '. '}</span>{c.detail}</span></div>;

function Sheet({ id, meta, days, now, S, onClose }) {
  const [rep, setRep] = useState(null), [err, setErr] = useState(null), [big, setBig] = useState(false), [rows, setRows] = useState(null), body = useRef(null), el = useRef(null);
  const tick = useRef(0);
  useEffect(() => { // fetch the report for this moment (throttled while the clock runs)
    const ctl = new AbortController(), wait = Date.now() - tick.current > 600 ? 0 : 600;
    const t = setTimeout(() => { tick.current = Date.now(); api.report(S, now, id, ctl.signal).then(r => { setRep(r); setErr(null); }).catch(e => { if (e.name !== 'AbortError') setErr(e.message); }); }, wait);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [id, now, S]);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [id]);
  useLayoutEffect(() => { // the sheet floats in front of the Monitor; larger = also over the floor
    const place = () => { const r = document.getElementById('paneWa').getBoundingClientRect(), f = document.querySelector('.floor').getBoundingClientRect(), top = big ? Math.max(8, f.top) : r.top; Object.assign(el.current.style, { left: r.left + 'px', width: r.width + 'px', top: top + 'px', height: (r.bottom - top) + 'px' }); };
    place(); window.addEventListener('resize', place); return () => window.removeEventListener('resize', place);
  }, [big, rep]);
  useEffect(() => { const esc = e => { if (e.key === 'Escape' && !document.querySelector('.scrim')) onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);
  const jump = k => () => { const x = el.current.querySelector('[data-sec="' + k + '"]'); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const K = rep && meta.kpis.find(k => k.key === rep.key);
  return createPortal(
    <div className="sheet on" ref={el} role="dialog" aria-label="Report">
      <div className="grab" />
      <div className="shead"><div className="tt"><b>{'RCA ' + id + (rep ? ' · ' + rep.title : '')}</b><span className="tn">{rep ? 'Alert at ' + full(rep.ta) + (rep.live ? ' · still on' : ' · cleared') : 'Loading…'}</span></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="iconbtn" aria-label={big ? 'Make the report smaller' : 'Make the report larger'} title={big ? 'Smaller' : 'Larger'} onClick={() => setBig(!big)}><Ico n={big ? 'shrink' : 'expand'} /></button>
          <button className="iconbtn" aria-label="Close the report" onClick={onClose}><Ico n="x" /></button></div></div>
      <nav className="snav" aria-label="Sections of this report">{[['sum', 'Summary'], ['da', 'Data analysis'], ['tri', 'Triangulation'], ['ideas', 'Ideas tested'], ['act', 'Next steps']].map(([k, n]) => <button key={k} onClick={jump(k)}>{n}</button>)}</nav>
      <div className="sbody" tabIndex={-1} ref={body}>
        {err && <div className="blk"><p>{'The report could not load: ' + err}</p></div>}
        {rep && <>
          <div className="blk" data-sec="sum"><h4>What is wrong</h4><p className="big"><FactText text={rep.lead} facts={rep.facts} onTap={f => setRows(f)} /></p>
            {rep.model_text && <p className="cap">{'In plain words: ' + rep.model_text}</p>}
            <div className="cap">{'Trouble began about ' + hhmm(rep.on) + '. Tap a blue number to see its rows.'}</div></div>
          <div className="blk"><h4>Most likely cause</h4><div className="cause"><div className={'bd ' + (rep.cause ? 'g' : 'o')}>{rep.cause ? '✓' : '?'}</div><div><div className="big">{rep.cause ? rep.causeName : 'The cause is not clear'}</div><div className="cap">{rep.causeLine}</div></div></div>
            {rep.evidence.length > 0 && <div style={{ marginTop: 8 }}>{rep.evidence.map((e, i) => <div key={i} className="chk"><b className="y">✓</b><span>{e}</span></div>)}</div>}</div>
          <div className="blk"><h4>All five signals at alert time</h4><table className="kt"><thead><tr>{['Signal', 'Then', 'Warning', 'Normal here'].map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rep.kpis.map(k => <tr key={k.key}><td>{k.name}</td><td className={k.breach ? 'r' : ''}>{k.shown}</td><td>{k.limit}</td><td>{k.normal || '–'}</td></tr>)}</tbody></table></div>
          <Analysis rep={rep} meta={meta} K={K} S={S} />
          <Triangulation rep={rep} />
          <div className="band" data-sec="ideas"><h3>{'Ideas tested (' + rep.rca.tested.length + ')'}</h3><span>Every idea gets the same checks.</span></div>
          <div className="blk">{rep.rca.tested.map((hy, i) => <details key={hy.key} className="hyp" open={i === 0}><summary>{hy.name}<span className="cap" style={{ margin: 0 }}>{hy.passed + ' of ' + hy.total}</span><span className={'bar' + (hy.passed / hy.total >= S.sure / 100 ? '' : ' low')}><i style={{ width: (hy.passed / hy.total * 100) + '%' }} /></span></summary>{hy.checks.map((c, j) => <Chk key={j} c={c} />)}</details>)}
            {rep.rca.notTested.length > 0 && <div className="cap">{'Not tested (limit set by the slider): ' + rep.rca.notTested.join(', ') + '.'}</div>}</div>
          <div className="blk"><h4>Everything I looked at around the moment</h4><LensView lens={rep.lens} /></div>
          <div className="band" data-sec="act"><h3>Next steps</h3></div>
          {rep.updates.length > 0 && <div className="blk"><h4>Updates since</h4>{rep.updates.map((u, i) => <div key={i} className="upd"><time>{hhmm(u.t)}</time><span><FactText text={u.text} facts={rep.facts} onTap={f => setRows(f)} /></span></div>)}</div>}
          <div className="blk"><h4>What to check next</h4><p>{rep.playbook}</p></div>
          <div className={'foot' + (rep.facts.every(f => f.ok) ? '' : ' bad')}><Ico n="shield" />{rep.facts.filter(f => f.ok).length + ' of ' + rep.facts.length + ' numbers in the summary checked a second way'}</div>
        </>}
      </div>
      {rows && <RowsModal f={rows} meta={meta} days={days} onClose={() => setRows(null)} />}
    </div>, document.body  // the sheet floats in front of the Monitor (outside the glass pane)
  );
}

function Analysis({ rep, meta, K, S }) {
  const an = rep.analysis, L = meta.names[rep.line], O = meta.names[1 - rep.line], unit = rep.key === 'stop' || rep.key === 'cover' ? ' min' : '%', ch = rep.charts;
  const kpiTr = { series: [{ name: L, pts: ch.kpi[0] }, { name: O, pts: ch.kpi[1] }], marks: ch.marks };
  return <>
    <div className="band" data-sec="da"><h3>Data analysis</h3><span className="tn">{hhmm(an.a) + '–' + hhmm(an.b) + ' (' + an.n + ' min) against ' + (an.hasNormal ? 'the same time on ' + an.normalDays + ' earlier day' + (an.normalDays > 1 ? 's' : '') : 'no earlier day')}</span></div>
    <div className="blk"><h4>What the data says</h4><ol className="read">{an.read.map((t, i) => <li key={i}>{t}</li>)}</ol></div>
    <div className="blk"><h4>{L + ': this window against normal'}</h4><Table cols={['Measure', 'Now', 'Normal at this time', '']} rows={an.rows} /></div>
    {an.supply && <div className="blk"><h4>Preform supply</h4><Table cols={['Measure', 'Now', 'Normal at this time', '']} rows={an.supply} /></div>}
    <div className="twocol">
      <div className="blk"><h4>Where the lost minutes went</h4>{an.reasons.length ? <Bars list={an.reasons} unit=" min" /> : <div className="cap">No fault stops in this window.</div>}
        {an.planned.length > 0 && <div className="cap">{'Planned stops (not faults): ' + an.planned.join(', ') + '.'}</div>}<div className="legend2"><span><i />This window</span><span><u />Normal</span></div></div>
      <div className="blk"><h4>Reject types</h4>{an.defects.length ? <Bars list={an.defects} unit="" /> : <div className="cap">No rejects in this window.</div>}<div className="legend2"><span><i />This window</span><span><u />Normal</span></div></div>
    </div>
    <div className="blk"><h4>{'The other line (' + O + '), same window'}</h4><Table cols={['Measure', 'Now', 'Normal at this time', '']} rows={an.other} /></div>
    <div className="blk"><h4>{K.name + ' around the trouble'}</h4><TrendChart tr={kpiTr} info={{ unit, limit: S[K.lim], w: 760, h: 190 }} /><div className="cap">{trendWords({ series: [{ name: L, pts: ch.kpi[0] }] }, { unit })}</div></div>
    <div className="blk"><h4>Output against ideal (10-minute average)</h4><TrendChart tr={{ series: [{ name: L, pts: ch.out[0] }, { name: O, pts: ch.out[1] }], marks: ch.marks }} info={{ unit: '%', w: 760, h: 170 }} />
      <div className="cap">{'Each line is shown against its own ideal speed (' + meta.ideal[rep.line] + ' and ' + meta.ideal[1 - rep.line] + ' bottles a minute). A planned stop counts as zero.'}</div></div>
    <div className={'foot2' + (an.checks.ok === an.checks.total ? '' : ' bad')}><Ico n="shield" />{an.checks.ok + ' of ' + an.checks.total + ' totals matched a second way (minute rows against the stop and reject tables)'}</div>
  </>;
}

function Triangulation({ rep }) {
  const tri = rep.triangulation, sym = { strong: '✓', medium: '✓', weak: '?' }[tri.level], vt = { supports: 'Supports', partly: 'Partly', against: 'Does not support', none: 'No check' };
  return <>
    <div className="band" data-sec="tri"><h3>Triangulation</h3><span>Three angles on one moment. Each angle uses different rows.</span></div>
    <div className={'tri-sum ' + tri.level}><div className="bd">{sym}</div><div><b>{tri.summary}</b><small>{tri.proven ? 'A cause is named when at least ' + Math.round(tri.thr * 100) + '% of checks pass and it beats the next idea by 25 points.' : 'I do not name a cause unless enough checks pass. Ask the operator and watch the next 60 minutes.'}</small></div></div>
    <div className="angles">{tri.angles.map(a => <div key={a.key} className="angle">
      <div className="ah"><b>{a.name}</b><span className={'vd ' + a.verdict}>{vt[a.verdict] + (a.total ? ' ' + a.passed + '/' + a.total : '')}</span></div>
      <div className="ask">{a.ask}</div>
      {a.total ? a.checks.map((c, j) => <Chk key={j} c={c} />) : <div className="cap">This idea has no check in this angle.</div>}
      {a.context && a.context.length > 0 && <div className="seen"><h6>What I saw</h6>{a.context.map((x, j) => <div key={j} className={'li ' + (x.phase || '')}><span className="dotp" /><span>{x.text}</span></div>)}</div>}
    </div>)}</div>
    {tri.runner && <div className="runner">{'Idea tested: "' + tri.idea + '" (' + rep.rca.tested[0].passed + ' of ' + rep.rca.tested[0].total + ' checks). Next best: "' + tri.runner.name + '" (' + tri.runner.passed + ' of ' + tri.runner.total + ').'}</div>}
  </>;
}
