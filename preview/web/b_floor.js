// ===== Production floor: two lanes, moving bottles =====
const Floor = (() => {
  const cv = $('#floorCv'), ctx = cv.getContext('2d'), box = $('#floor');
  let W = 0, H = 0, col = {}, last = 0, lastMin = -1;
  const lane = [{ off: 0, passed: 0, ej: [] }, { off: 0, passed: 0, ej: [] }];
  const STN = [['Blow moulder', .30], ['Filler', .44], ['Capper', .58], ['Labeler', .71], ['Check', .83], ['Packer', .93]];
  const LIQ = ['#5AC8FA', '#E8A33D'];
  const hud = [0, 1].map(l => ({ nm: h('span', { class: 'nm' }, h('span', { class: 'lg' }, Sim.LNAME[l]), h('span', { class: 'sh' }, 'L' + (l + 1))), st: h('span', { class: 'state' }, h('i'), h('span', null, '–')), bpm: h('b', { class: 'bpm tn' }, '–'), meta: h('span', { class: 'meta tn' }) }));
  hud.forEach((x, l) => { const e = h('div', { class: 'lanehud' }, x.nm, x.st, x.bpm, x.meta); x.el = e; box.append(e); });
  const paused = h('div', { class: 'state plan', style: { display: 'none' } }, h('i'), h('span', null, 'Paused'));
  const note = h('div', { class: 'floornote' }); box.append(h('div', { class: 'floortop' }, note, paused));
  function theme() { col = { belt: cssv('--belt'), mach: cssv('--mach'), machS: cssv('--mach-s'), ink: cssv('--ink'), red: cssv('--red'), green: cssv('--green'), orange: cssv('--orange'), blue: cssv('--blue'), l2: cssv('--label2') }; }
  function resize() {
    const r = box.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hud.forEach((x, l) => { x.el.style.top = (l * H / 2 + 6) + 'px'; });
  }
  const rr = (x, y, w, hh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, r) : ctx.rect(x, y, w, hh); };
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
  const stnOf = rid => rid === 1 ? 1 : rid === 2 ? 3 : rid === 3 ? 2 : rid === 4 ? 'belt' : rid === 5 ? 'silo' : rid === 6 ? 'all' : rid === 12 ? 1 : rid === 13 ? 'all' : null;
  const bpmOf = (L, m) => { let t = 0, n = 0; for (let i = Math.max(0, m - 2); i <= m; i++) { t += L.prod[i]; n++; } return t / n; }; // bottles per minute, 3-minute average
  function runLen(L, m) { let i = m; while (i > 0 && L.st[i - 1] === L.st[m] && L.rid[i - 1] === L.rid[m]) i--; return m - i + 1; }
  function draw(dt, now, playing, rate) {
    ctx.clearRect(0, 0, W, H); const D = APP.D, LH = H / 2, hh = W < 520 ? 32 : 0, CH = LH - hh, bh = Math.max(20, Math.min(34, CH * (hh ? .24 : .27))), gap = bh * 1.55;
    for (let l = 0; l < 2; l++) {
      const L = D.L[l], s = L.st[now], rid = L.rid[now], top = l * LH + hh, belt = top + CH * (hh ? .74 : .8), x0 = W * .16, x1 = W - 10, ln = lane[l];
      if (l) { ctx.fillStyle = 'rgba(128,128,128,.18)'; ctx.fillRect(0, l * LH, W, 1); }
      const fault = s === 1 ? stnOf(rid) : s === 2 ? stnOf(rid) : null, isP = s === 2;
      // belt
      ctx.strokeStyle = col.belt; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, belt + 4); ctx.lineTo(x1, belt + 4); ctx.stroke();
      ctx.strokeStyle = fault === 'belt' ? col.red : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 10]); ctx.lineDashOffset = -ln.off; ctx.beginPath(); ctx.moveTo(x0, belt + 4); ctx.lineTo(x1, belt + 4); ctx.stroke(); ctx.setLineDash([]);
      // silo
      const sx = W * .075, sw = Math.min(46, W * .07), sh = CH * (hh ? .46 : .5), sy = top + CH * (hh ? .3 : .36), lvl = Math.max(0, Math.min(1, L.stock[now] / Sim.BAY[l])), cv2 = Sim.kv(D, 'cover', l, now), low = cv2 != null && cv2 < APP.SW.coverLim;
      ctx.fillStyle = col.mach; rr(sx - sw / 2, sy, sw, sh, 8); ctx.fill(); ctx.save(); rr(sx - sw / 2, sy, sw, sh, 8); ctx.clip(); ctx.fillStyle = low ? col.red : col.blue; ctx.globalAlpha = .75; ctx.fillRect(sx - sw / 2, sy + sh * (1 - lvl), sw, sh * lvl); ctx.restore();
      ctx.strokeStyle = fault === 'silo' ? col.red : col.machS; ctx.lineWidth = fault === 'silo' ? 2.5 : 1; rr(sx - sw / 2, sy, sw, sh, 8); ctx.stroke();
      ctx.fillStyle = col.l2; ctx.font = '600 9.5px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Preforms', sx, sy + sh + 11);
      ctx.strokeStyle = col.belt; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx + sw / 2, sy + sh * .85); ctx.lineTo(x0, sy + sh * .85); ctx.lineTo(x0, belt); ctx.stroke();
      // stations
      STN.forEach(([nm, f], i) => {
        const cx = W * f, mw = Math.min(58, W * .075), my = top + CH * (hh ? .3 : .4), mh = CH * (hh ? .2 : .22), bad = fault === i || fault === 'all';
        ctx.fillStyle = col.mach; rr(cx - mw / 2, my, mw, mh, 9); ctx.fill();
        ctx.strokeStyle = bad ? (isP ? col.orange : col.red) : col.machS; ctx.lineWidth = bad ? 2.5 : 1; rr(cx - mw / 2, my, mw, mh, 9); ctx.stroke();
        if (bad && !isP && (Math.floor(performance.now() / 450) % 2)) { ctx.fillStyle = 'rgba(255,59,48,.18)'; rr(cx - mw / 2, my, mw, mh, 9); ctx.fill(); }
        ctx.fillStyle = bad ? (isP ? col.orange : col.red) : col.l2; ctx.font = '600 9.5px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(W < 520 ? nm.split(' ')[0] : nm, cx, my - 4);
        ctx.beginPath(); ctx.arc(cx + mw / 2 - 7, my + 7, 3, 0, 7); ctx.fillStyle = s === 0 ? col.green : bad ? (isP ? col.orange : col.red) : col.machS; ctx.fill();
      });
      // reject bin
      const bx = W * .83, by = belt + 12; ctx.fillStyle = col.mach; ctx.strokeStyle = col.machS; ctx.lineWidth = 1; rr(bx - 15, by, 30, 11, 3); ctx.fill(); ctx.stroke();
      // belt motion + bottles
      const bpm = bpmOf(L, now), v = playing ? gap * bpm / 60 : 0, dx = v * dt; ln.off = (ln.off + dx) % 1e6; ln.bpm = bpm;
      if (dx > 0) { ln.passed += dx / gap; const pr = L.prod[now] > 0 ? L.rej[now] / L.prod[now] : 0; while (ln.passed >= 1) { ln.passed -= 1; if (Math.random() < Math.min(.85, pr * 7)) ln.ej.push({ y: 0, a: 1 }); } }
      const total = x1 - x0 - 6; for (let i = -1; i * gap < total + gap; i++) {
        const px = x0 + 6 + ((i * gap + ln.off) % (Math.ceil(total / gap) * gap)); if (px < x0 + 4 || px > x1 - 6) continue;
        const f = px / W, stage = f < STN[0][1] ? 0 : f < STN[1][1] ? 1 : f < STN[2][1] ? 2 : f < STN[3][1] ? 3 : 4;
        if (s === 2 && stnOf(rid) === 'all' && false) continue; bottle(px, belt, bh, stage, l);
      }
      ln.ej = ln.ej.filter(e => e.a > 0.02); ln.ej.forEach(e => { e.y += dt * 90; e.a -= dt * 1.2; bottle(bx, belt + e.y, bh * .9, 4, l, Math.max(0, e.a)); ctx.fillStyle = col.red; ctx.globalAlpha = Math.max(0, e.a) * .7; ctx.fillRect(bx - 11, belt + e.y - bh * .8, 22, 2); ctx.globalAlpha = 1; });
      if (s === 1 && rid && rid !== 5 && rid !== 4) { const k = stnOf(rid); if (typeof k === 'number') { ctx.fillStyle = col.red; ctx.font = '700 10px -apple-system,Inter,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', W * STN[k][1], top + CH * (hh ? .3 : .4) + CH * (hh ? .2 : .22) / 2 + 4); } }
    }
  }
  function updateHud(now) {
    const D = APP.D; for (let l = 0; l < 2; l++) {
      const L = D.L[l], s = L.st[now], rid = L.rid[now], x = hud[l], e = x.st, tx = e.lastChild; e.className = 'state';
      if (s === 1) { e.classList.add('stop'); const nm = rid >= 1 && rid <= 6 ? Sim.FAULTS[rid - 1] : 'Stop'; tx.textContent = 'Stopped · ' + nm.replace(' (see comment)', '') + ' · ' + runLen(L, now) + ' min'; }
      else if (s === 2) { e.classList.add('plan'); tx.textContent = 'Planned · ' + (Sim.PLANNED[rid - 11] || 'stop') + ' · ' + runLen(L, now) + ' min'; }
      else if (L.sp[now] < .8) { e.classList.add('slow'); tx.textContent = 'Running slow · ' + Math.round(L.sp[now] * 100) + '% of set speed'; }
      else tx.textContent = 'Running · ' + Math.round(L.sp[now] * L.setp[now] * 100) + '% of ideal';
      const d0 = Math.floor(now / 1440) * 1440, P = D.P[l], prd = P.prd[now + 1] - P.prd[d0], rj = P.rj[now + 1] - P.rj[d0];
      x.bpm.textContent = fmtN(bpmOf(L, now)) + (W < 520 ? '/min' : ' bottles/min'); x.meta.textContent = ' of ' + Sim.IDEAL[l] + ' ideal · made today ' + fmtN(prd) + ' · rejects ' + (prd ? (rj / prd * 100).toFixed(1) : '0.0') + '% · preforms ' + fmtN(L.stock[now]);
    }
  }
  function frame(ts) {
    const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts; const now = nowMin();
    if (now !== lastMin) { lastMin = now; updateHud(now); }
    paused.style.display = APP.playing ? 'none' : 'inline-flex';
    const fx = APP.rate * 60, nt = 'Bottle flow = each line\'s real rate' + (fx > 1.06 ? ' · clock ×' + (fx >= 100 ? Math.round(fx) : fx.toFixed(1).replace('.0', '')) : ''); if (note.textContent !== nt) note.textContent = nt;
    draw(dt, now, APP.playing, APP.rate); requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(box); theme(); resize(); requestAnimationFrame(frame);
  return { lane, theme, resize, hud: () => { lastMin = -1; } };
})();
