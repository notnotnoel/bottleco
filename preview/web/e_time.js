// ===== Time drawer (video-player style), header clock and main loop =====
const Time = (() => {
  const dr = $('#drawer'), N = Sim.N;
  APP.pauseOnAlert = true;
  // speed: APP.rate = simulated minutes per real second. 1x = 1 min per second.
  const A = Math.log10(1 / 60), B = Math.log10(360);
  const rateOf = v => Math.pow(10, A + (B - A) * v / 100), posOf = r => (Math.log10(r) - A) / (B - A) * 100;
  const fmtRate = r => r <= 1 / 60 * 1.06 ? '1 s = 1 s' : r < 1 ? '1 s = ' + Math.round(r * 60) + ' s' : r < 60 ? '1 s = ' + (r < 10 ? (Math.round(r * 10) / 10) : Math.round(r)) + ' min' : '1 s = ' + (Math.round(r / 6) / 10) + ' h';
  const SPEEDS = [['Real', 1 / 60], ['1×', 1], ['2×', 2], ['3×', 3], ['5×', 5], ['10×', 10], ['30×', 30], ['60×', 60], ['360×', 360]];
  const near = (a, b) => Math.abs(Math.log10(a / b)) < .03;
  // ---- scrubber ----
  const track = h('div', { class: 'track' }), played = h('div', { class: 'played' }), thumb = h('div', { class: 'thumb' }), hov = h('div', { class: 'hover' });
  track.append(played);
  const scrub = h('div', { class: 'scrub', role: 'slider', tabindex: '0', 'aria-label': 'Time bar. Arrow keys move 10 minutes. Shift plus arrow moves 1 hour.', 'aria-valuemin': 0, 'aria-valuemax': N - 1 }, track, thumb, hov);
  Sim.STORY.forEach(s => scrub.append(h('div', { class: 'chap', style: { left: (s.at / (N - 1) * 100) + '%' }, title: Sim.dlabel(s.at) + ' · ' + s.name })));
  const dls = []; for (let d = 0; d < Sim.DAYS; d++) { const m = d * 1440, e = h('div', { class: 'dl' + (d === 0 ? ' first' : ''), style: { left: (m / (N - 1) * 100) + '%' } }, Sim.dt(m).getUTCDate() + ' Sep'); dls.push(e); scrub.append(e); }
  let marks = '';
  function drawMarks(now) {
    const vis = APP.inc.filter(i => i.start <= now), key = vis.map(i => i.id + ':' + Math.min(i.end, now)).join(',') + '|' + APP.SW.hold; if (key === marks) return; marks = key;
    track.replaceChildren(played); vis.forEach(i => track.append(h('div', { class: 'mk', style: { left: (i.t0 / (N - 1) * 100) + '%', width: (Math.max(2, Math.min(i.end, now) - i.t0) / (N - 1) * 100) + '%', top: i.line ? '50%' : '0', bottom: i.line ? '0' : '50%' } })));
  }
  // ---- buttons ----
  const playBtn = h('button', { class: 'tb play', 'aria-label': 'Play', title: 'Play or pause (Space)', onclick: () => toggle() });
  const step = (lab, sub, m, cls) => h('button', { class: 'tb ' + (cls || ''), 'aria-label': 'Jump ' + sub, title: 'Jump ' + sub, onclick: () => seek(APP.t + m) }, h('span', null, lab), h('small', null, sub));
  const prevW = h('button', { class: 'chip', title: 'Jump to the previous warning', 'aria-label': 'Previous warning', onclick: () => jumpWarn(-1) }, ico('back'), h('span', { class: 'hide-s' }, 'Prev warning'));
  const nextW = h('button', { class: 'chip', title: 'Jump to the next warning', 'aria-label': 'Next warning', onclick: () => jumpWarn(1) }, h('span', { class: 'hide-s' }, 'Next warning'), ico('fwd'));
  const chapBtn = h('button', { class: 'chip', 'aria-haspopup': 'dialog', title: 'Jump to a story moment' }, ico('list'), h('span', { class: 'hide-s' }, 'Moments'));
  const dmeta = h('span', { class: 'dmeta' });
  const spd = h('div', { class: 'speedseg', role: 'group', 'aria-label': 'Time speed' }, SPEEDS.map(([n, r]) => h('button', { 'data-r': r, title: r < 1 ? 'Real time: 1 second = 1 second' : '1 second = ' + (r < 60 ? r + ' min' : (r / 60) + ' h'), 'aria-label': 'Speed ' + n, onclick: () => setRate(r) }, n)));
  const custom = h('button', { class: 'chip', 'aria-haspopup': 'dialog', title: 'Set any speed' }, ico('gauge'), h('span', { class: 'hide-s' }, 'Custom'));
  const sw = h('label', { class: 'sw', title: 'Stop the clock when a new warning appears' }, h('input', { type: 'checkbox', checked: true, onchange: e => { APP.pauseOnAlert = e.target.checked; } }), h('span', { class: 'knob' }), 'Pause at warnings');
  dr.append(scrub, h('div', { class: 'drow2' },
    h('div', { class: 'dleft' }, prevW, nextW, chapBtn, dmeta),
    h('div', { class: 'tport' }, step('−1h', '1 hour back', -60, 'k1h'), step('−10m', '10 min back', -10), playBtn, step('+10m', '10 min on', 10), step('+1h', '1 hour on', 60, 'k1h')),
    h('div', { class: 'dright2' }, spd, custom, sw)));
  function toggle(on) { APP.playing = on == null ? !APP.playing : on; if (APP.playing && APP.t >= N - 2) APP.t = 0; drawPlay(); }
  function drawPlay() { playBtn.replaceChildren(ico(APP.playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', APP.playing ? 'Pause' : 'Play'); }
  function seek(m) { APP.t = Math.max(0, Math.min(N - 1, m)); update(true); }
  function setRate(r) { APP.rate = r; paintRate(); update(true); }
  function paintRate() {
    let hit = false; [...spd.children].forEach(b => { const on = near(+b.dataset.r, APP.rate); b.setAttribute('aria-pressed', on); hit = hit || on; });
    const on = spd.querySelector('[aria-pressed=true]'); if (on && spd.scrollWidth > spd.clientWidth) spd.scrollTo({ left: on.offsetLeft - (spd.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
    custom.setAttribute('aria-pressed', !hit); custom.style.background = hit ? '' : 'var(--blue-soft)';
    dmeta.textContent = 'Day ' + (Math.floor(nowMin() / 1440) + 1) + ' of ' + Sim.DAYS + ' · ' + fmtRate(APP.rate);
  }
  function jumpWarn(dir) {
    const now = nowMin(), L = APP.inc.map(i => i.start).sort((a, b) => a - b), t = dir > 0 ? L.find(x => x > now) : [...L].reverse().find(x => x < now - 1);
    if (t == null) { toast(dir > 0 ? 'No later warning in the data.' : 'No earlier warning.'); return; } seek(t);
  }
  function pos(e) { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  let drag = false;
  scrub.addEventListener('pointerdown', e => { drag = true; scrub.setPointerCapture(e.pointerId); scrub.classList.add('drag'); seek(pos(e) * (N - 1)); });
  scrub.addEventListener('pointermove', e => { const p = pos(e); hov.style.left = (p * 100) + '%'; hov.textContent = Sim.full(Math.round(p * (N - 1))); if (drag) seek(p * (N - 1)); });
  const up = () => { drag = false; scrub.classList.remove('drag'); }; scrub.addEventListener('pointerup', up); scrub.addEventListener('pointercancel', up);
  scrub.addEventListener('keydown', e => { const k = e.key; if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(APP.t + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 60 : 10)); } });
  function pop(node, cls) {
    const old = $('.pop', dr); if (old) { const same = old.dataset.k === cls; old.remove(); if (same) return; }
    node.classList.add('pop'); node.dataset.k = cls; dr.append(node);
    const off = e => { if (!node.contains(e.target) && !e.target.closest('.chip')) { node.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  custom.addEventListener('click', () => {
    const big = h('div', { class: 'big2 tn' }), inp = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Time speed' }), box = h('div');
    const paint = () => { big.textContent = fmtRate(APP.rate); inp.value = posOf(APP.rate); inp.style.setProperty('--p', inp.value + '%'); paintRate(); };
    inp.addEventListener('input', () => { APP.rate = rateOf(+inp.value); paint(); });
    box.append(h('h5', null, 'Any speed'), big, inp, h('div', { class: 'hint', style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, '1 s = 1 s'), h('span', null, '1 s = 6 hours')));
    paint(); pop(box, 'speed');
  });
  chapBtn.addEventListener('click', () => {
    const box = h('div', { class: 'chaplist l' }, h('h5', { style: { margin: '0 0 6px', fontSize: '13px', color: 'var(--label2)' } }, 'Jump to a moment (45 min before)'), Sim.STORY.map(s => h('button', { onclick: () => { seek(s.at - 45); $('.pop', dr) && $('.pop', dr).remove(); } }, h('em', null, Sim.dlabel(s.at) + ' ' + Sim.hhmm(s.at)), h('div', null, h('b', null, Sim.LNAME[s.line] + ' · ' + s.name), h('span', null, s.text)))));
    box.style.width = 'min(420px,calc(100vw - 32px))'; pop(box, 'chap');
  });
  // ---- header clock: date, time, shift ----
  const hDate = $('#hDate'), hDay = $('#hDay'), hTime = $('#hTime'), hShift = $('#hShift'), hShiftN = $('#hShiftN'), hShiftT = $('#hShiftT');
  function clock(now) {
    const m = Sim.full(now).match(/^(\w+) (\d+ \w+) (\d\d:\d\d)$/), s = Sim.shiftOf(now), st = now - (now % 480);
    hDate.textContent = m[1] + ' ' + m[2]; hDay.textContent = '2026 · Day ' + (Math.floor(now / 1440) + 1) + ' of ' + Sim.DAYS; hTime.textContent = m[3];
    hShift.className = 'hs s' + Sim.SHIFTS[s]; hShiftN.textContent = 'Shift ' + Sim.SHIFTS[s]; hShiftT.textContent = Sim.hhmm(st) + '–' + Sim.hhmm(st + 480);
  }
  function update(force) {
    const now = nowMin(), pct = APP.t / (N - 1) * 100;
    thumb.style.left = pct + '%'; played.style.width = pct + '%'; scrub.setAttribute('aria-valuenow', now); scrub.setAttribute('aria-valuetext', Sim.full(now));
    if (now !== APP.lastNow || force) {
      const prev = APP.lastNow; APP.lastNow = now;
      clock(now); paintRate(); drawMarks(now); Watch.refresh(force); Chat.suggestions();
      if (APP.playing && APP.pauseOnAlert && prev >= 0 && APP.inc.some(i => i.start > prev && i.start <= now)) { toggle(false); toast('Warning at ' + Sim.hhmm(now) + '. Paused. Click the new RCA pill.'); }
    }
  }
  paintRate(); drawPlay();
  let last = performance.now();
  function loop(ts) { const dt = Math.min(.1, (ts - last) / 1000); last = ts; if (APP.playing) { APP.t += APP.rate * dt; if (APP.t >= N - 1) { APP.t = N - 1; toggle(false); } } update(false); requestAnimationFrame(loop); }
  function fit() { const w = scrub.getBoundingClientRect().width, every = w < 420 ? 3 : w < 700 ? 2 : 1; dls.forEach((e, i) => { e.style.display = i % every === 0 ? '' : 'none'; }); }
  new ResizeObserver(fit).observe(scrub);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,[role=slider]') || e.metaKey || e.ctrlKey || $('.scrim')) return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); seek(APP.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 60 : 10)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); let i = SPEEDS.findIndex(p => near(p[1], APP.rate)); if (i < 0) i = SPEEDS.findIndex(p => p[1] >= APP.rate); if (i < 0) i = SPEEDS.length - 1; setRate(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === 'ArrowUp' ? 1 : -1)))][1]); }
  });
  requestAnimationFrame(loop);
  return { toggle, seek, update, setRate };
})();
