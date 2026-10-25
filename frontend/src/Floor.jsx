// Production floor: two lanes, bottles move at each line's real rate (3-minute average of bottles per minute).
import { useEffect, useRef } from 'react';
import { fmtN } from './lib.js';

const STN = [['Blow moulder', .30], ['Filler', .44], ['Capper', .58], ['Labeler', .71], ['Check', .83], ['Packer', .93]];
const LIQ = ['#5AC8FA', '#E8A33D'];
const stnOf = rid => rid === 1 ? 1 : rid === 2 ? 3 : rid === 3 ? 2 : rid === 4 ? 'belt' : rid === 5 ? 'silo' : rid === 6 ? 'all' : rid === 12 ? 1 : rid === 13 ? 'all' : null;
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export default function Floor({ meta, days, clock, settingsRef, theme }) {
  const box = useRef(null), cv = useRef(null), hud = [useRef(null), useRef(null)], note = useRef(null), paused = useRef(null);
  useEffect(() => {
    const ctx = cv.current.getContext('2d'), lane = [{ off: 0, passed: 0, ej: [] }, { off: 0, passed: 0, ej: [] }];
    let W = 0, H = 0, col = {}, last = 0, lastMin = -1, raf = 0;
    const readTheme = () => { col = { belt: cssv('--belt'), mach: cssv('--mach'), machS: cssv('--mach-s'), red: cssv('--red'), green: cssv('--green'), orange: cssv('--orange'), blue: cssv('--blue'), l2: cssv('--label2') }; };
    const resize = () => {
      const r = box.current.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
      cv.current.width = Math.round(W * dpr); cv.current.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hud.forEach((x, l) => { if (x.current) x.current.style.top = (l * H / 2 + 6) + 'px'; }); lastMin = -1;
    };
    const rr = (x, y, w, hh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, r) : ctx.rect(x, y, w, hh); };
    const F = (l, f, m) => days.field(l, f, m);
    const bpmOf = (l, m) => { let t = 0, n = 0; for (let i = Math.max(0, m - 2); i <= m; i++) { t += F(l, 'prod', i) || 0; n++; } return t / n; };
    const runLen = (l, m) => { let i = m; const s = F(l, 'st', m), r = F(l, 'rid', m); while (i > 0 && F(l, 'st', i - 1) === s && F(l, 'rid', i - 1) === r) i--; return m - i + 1; };
    function bottle(x, y, bh, stage, l, tint) {
      const bw = bh * .46, nw = bw * .42, nh = bh * .2;
      if (stage === 0) { ctx.fillStyle = col.l2; rr(x - bw * .22, y - bh * .5, bw * .44, bh * .5, 2); ctx.fill(); return; }
      ctx.save(); if (tint) ctx.globalAlpha = tint;
      rr(x - bw / 2, y - bh * .8, bw, bh * .8, bw * .28); ctx.fillStyle = 'rgba(150,200,230,.28)'; ctx.fill();
      if (stage >= 2) { ctx.save(); rr(x - bw / 2, y - bh * .8, bw, bh * .8, bw * .28); ctx.clip(); ctx.fillStyle = LIQ[l]; ctx.globalAlpha *= .9; ctx.fillRect(x - bw / 2, y - bh * .62, bw, bh * .62); ctx.restore(); }
      rr(x - nw / 2, y - bh, nw, nh + 1, 2); ctx.fillStyle = stage >= 3 ? (l ? '#C0392B' : '#1E6FD9') : 'rgba(150,200,230,.5)'; ctx.fill();
      if (stage >= 4) { ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(x - bw / 2, y - bh * .5, bw, bh * .26); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x - bw * .3, y - bh * .4, bw * .6, 1.5); }
      ctx.strokeStyle = 'rgba(120,150,180,.55)'; ctx.lineWidth = 1; rr(x - bw / 2, y - bh * .8, bw, bh * .8, bw * .28); ctx.stroke(); ctx.restore();
    }
    function draw(dt, now, playing) {
      ctx.clearRect(0, 0, W, H); if (!days.ready(now)) return;
      const LH = H / 2, hh = W < 520 ? 32 : 0, CH = LH - hh, bh = Math.max(20, Math.min(34, CH * (hh ? .24 : .27))), gap = bh * 1.55, S = settingsRef.current;
      for (let l = 0; l < 2; l++) {
        const s = F(l, 'st', now), rid = F(l, 'rid', now), top = l * LH + hh, belt = top + CH * (hh ? .74 : .8), x0 = W * .16, x1 = W - 10, ln = lane[l];
        if (l) { ctx.fillStyle = 'rgba(128,128,128,.18)'; ctx.fillRect(0, l * LH, W, 1); }
        const fault = s === 1 || s === 2 ? stnOf(rid) : null, isP = s === 2;
        ctx.strokeStyle = col.belt; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, belt + 4); ctx.lineTo(x1, belt + 4); ctx.stroke();
        ctx.strokeStyle = fault === 'belt' ? col.red : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 10]); ctx.lineDashOffset = -ln.off; ctx.beginPath(); ctx.moveTo(x0, belt + 4); ctx.lineTo(x1, belt + 4); ctx.stroke(); ctx.setLineDash([]);
        const sx = W * .075, sw = Math.min(46, W * .07), sh = CH * (hh ? .46 : .5), sy = top + CH * (hh ? .3 : .36), lvl = Math.max(0, Math.min(1, F(l, 'stock', now) / meta.bay[l])), cov = days.kpi(l, 'cover', now), low = cov != null && cov < S.coverLim;
        ctx.fillStyle = col.mach; rr(sx - sw / 2, sy, sw, sh, 8); ctx.fill(); ctx.save(); rr(sx - sw / 2, sy, sw, sh, 8); ctx.clip(); ctx.fillStyle = low ? col.red : col.blue; ctx.globalAlpha = .75; ctx.fillRect(sx - sw / 2, sy + sh * (1 - lvl), sw, sh * lvl); ctx.restore();
        ctx.strokeStyle = fault === 'silo' ? col.red : col.machS; ctx.lineWidth = fault === 'silo' ? 2.5 : 1; rr(sx - sw / 2, sy, sw, sh, 8); ctx.stroke();
        ctx.fillStyle = col.l2; ctx.font = '600 9.5px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Preforms', sx, sy + sh + 11);
        ctx.strokeStyle = col.belt; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx + sw / 2, sy + sh * .85); ctx.lineTo(x0, sy + sh * .85); ctx.lineTo(x0, belt); ctx.stroke();
        STN.forEach(([nm, f], i) => {
          const cx = W * f, mw = Math.min(58, W * .075), my = top + CH * (hh ? .3 : .4), mh = CH * (hh ? .2 : .22), bad = fault === i || fault === 'all';
          ctx.fillStyle = col.mach; rr(cx - mw / 2, my, mw, mh, 9); ctx.fill();
          ctx.strokeStyle = bad ? (isP ? col.orange : col.red) : col.machS; ctx.lineWidth = bad ? 2.5 : 1; rr(cx - mw / 2, my, mw, mh, 9); ctx.stroke();
          if (bad && !isP && (Math.floor(performance.now() / 450) % 2)) { ctx.fillStyle = 'rgba(255,59,48,.18)'; rr(cx - mw / 2, my, mw, mh, 9); ctx.fill(); }
          ctx.fillStyle = bad ? (isP ? col.orange : col.red) : col.l2; ctx.font = '600 9.5px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(W < 520 ? nm.split(' ')[0] : nm, cx, my - 4);
          ctx.beginPath(); ctx.arc(cx + mw / 2 - 7, my + 7, 3, 0, 7); ctx.fillStyle = s === 0 ? col.green : bad ? (isP ? col.orange : col.red) : col.machS; ctx.fill();
        });
        const bx = W * .83, by = belt + 12; ctx.fillStyle = col.mach; ctx.strokeStyle = col.machS; ctx.lineWidth = 1; rr(bx - 15, by, 30, 11, 3); ctx.fill(); ctx.stroke();
        const bpm = bpmOf(l, now), v = playing ? gap * bpm / 60 : 0, dx = v * dt; ln.off = (ln.off + dx) % 1e6;
        if (dx > 0) { ln.passed += dx / gap; const p = F(l, 'prod', now), pr = p > 0 ? F(l, 'rej', now) / p : 0; while (ln.passed >= 1) { ln.passed -= 1; if (Math.random() < Math.min(.85, pr * 7)) ln.ej.push({ y: 0, a: 1 }); } }
        const total = x1 - x0 - 6;
        for (let i = -1; i * gap < total + gap; i++) {
          const px = x0 + 6 + ((i * gap + ln.off) % (Math.ceil(total / gap) * gap)); if (px < x0 + 4 || px > x1 - 6) continue;
          const f = px / W, stage = f < STN[0][1] ? 0 : f < STN[1][1] ? 1 : f < STN[2][1] ? 2 : f < STN[3][1] ? 3 : 4; bottle(px, belt, bh, stage, l);
        }
        ln.ej = ln.ej.filter(e => e.a > 0.02); ln.ej.forEach(e => { e.y += dt * 90; e.a -= dt * 1.2; bottle(bx, belt + e.y, bh * .9, 4, l, Math.max(0, e.a)); ctx.fillStyle = col.red; ctx.globalAlpha = Math.max(0, e.a) * .7; ctx.fillRect(bx - 11, belt + e.y - bh * .8, 22, 2); ctx.globalAlpha = 1; });
        if (s === 1 && rid && rid !== 5 && rid !== 4) { const k = stnOf(rid); if (typeof k === 'number') { ctx.fillStyle = col.red; ctx.font = '700 10px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', W * STN[k][1], top + CH * (hh ? .3 : .4) + CH * (hh ? .2 : .22) / 2 + 4); } }
      }
    }
    function updateHud(now) {
      if (!days.ready(now)) return;
      for (let l = 0; l < 2; l++) {
        const el = hud[l].current; if (!el) continue;
        const st = el.querySelector('.state'), tx = st.lastChild, s = F(l, 'st', now), rid = F(l, 'rid', now), sp = F(l, 'sp', now), setp = F(l, 'setp', now) / 100;
        st.className = 'state';
        if (s === 1) { st.classList.add('stop'); const nm = rid >= 1 && rid <= 6 ? meta.faults[rid - 1] : 'Stop'; tx.textContent = 'Stopped · ' + nm.replace(' (see comment)', '') + ' · ' + runLen(l, now) + ' min'; }
        else if (s === 2) { st.classList.add('plan'); tx.textContent = 'Planned · ' + (meta.planned[rid - 11] || 'stop') + ' · ' + runLen(l, now) + ' min'; }
        else if (sp < .8) { st.classList.add('slow'); tx.textContent = 'Running slow · ' + Math.round(sp * 100) + '% of set speed'; }
        else tx.textContent = 'Running · ' + Math.round(sp * setp * 100) + '% of ideal';
        const d0 = Math.floor(now / 1440) * 1440; let prd = 0, rj = 0; for (let i = d0; i <= now; i++) { prd += F(l, 'prod', i); rj += F(l, 'rej', i); }
        el.querySelector('.bpm').textContent = fmtN(bpmOf(l, now)) + (W < 520 ? '/min' : ' bottles/min');
        el.querySelector('.meta').textContent = ' of ' + meta.ideal[l] + ' ideal · made today ' + fmtN(prd) + ' · rejects ' + (prd ? (rj / prd * 100).toFixed(1) : '0.0') + '% · preforms ' + fmtN(F(l, 'stock', now));
      }
    }
    function frame(ts) {
      const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts; const c = clock.current, now = c.now();
      if (now !== lastMin && days.ready(now)) { lastMin = now; updateHud(now); }
      if (paused.current) paused.current.style.display = c.playing ? 'none' : 'inline-flex';
      const fx = c.rate * 60, nt = 'Bottle flow = each line\'s real rate' + (fx > 1.06 ? ' · clock ×' + (fx >= 100 ? Math.round(fx) : fx.toFixed(1).replace('.0', '')) : '');
      if (note.current && note.current.textContent !== nt) note.current.textContent = nt;
      draw(dt, now, c.playing); raf = requestAnimationFrame(frame);
    }
    readTheme(); const ro = new ResizeObserver(resize); ro.observe(box.current); resize(); raf = requestAnimationFrame(frame);
    const onTheme = () => requestAnimationFrame(readTheme); window.addEventListener('bottleco-theme', onTheme);  // read colors after the theme switch
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('bottleco-theme', onTheme); };
  }, [meta, days, clock, settingsRef]);
  useEffect(() => { window.dispatchEvent(new Event('bottleco-theme')); }, [theme]);
  return (
    <section className="floor" ref={box} aria-label="Production floor">
      <canvas ref={cv} role="img" aria-label="Two bottling lines with moving bottles" />
      {[0, 1].map(l => <div key={l} className="lanehud" ref={hud[l]}>
        <span className="nm"><span className="lg">{meta.names[l]}</span><span className="sh">{'L' + (l + 1)}</span></span>
        <span className="state"><i /><span>–</span></span><b className="bpm tn">–</b><span className="meta tn" />
      </div>)}
      <div className="floortop"><div className="floornote" ref={note} /><div className="state plan" ref={paused} style={{ display: 'none' }}><i /><span>Paused</span></div></div>
    </section>
  );
}
