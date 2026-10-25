// ===== Monitoring agent: KPI tiles, report and cause pills, sheet =====
const rsnName = rid => rid >= 1 && rid <= 6 ? Sim.FAULTS[rid - 1] : rid >= 11 ? Sim.PLANNED[rid - 11] : '';
const stWord = s => s === 0 ? 'running' : s === 1 ? 'stopped' : 'planned';
const WIN = { oee: 60, stop: 60, speed: 15, rej: 30, cover: 30 };
function minuteRows(l, a, b) {
  const L = APP.D.L[l], r = []; for (let i = Math.max(0, a); i <= b; i++) r.push([Sim.hhmm(i), stWord(L.st[i]), rsnName(L.rid[i]) || '–', L.prod[i], L.rej[i], L.stock[i]]); return r;
}
function openRows(f) { // tap a number: see the rows behind it
  const w = WIN[f.key] || 30, a = f.t - w + 1, rows = minuteRows(f.line, a, f.t), ok = f.ok;
  modal('Where this number comes from', [
    h('div', { class: 'blk' }, h('h4', null, f.label), h('p', { class: 'big tn' }, f.shown),
      h('p', null, 'Computed by code from ' + rows.length + ' minute rows of ' + Sim.LNAME[f.line] + ', ' + Sim.full(a) + ' to ' + Sim.hhmm(f.t) + '.'),
      h('div', { class: 'foot' + (ok ? '' : ' bad') }, ico('shield'), ok ? 'Checked: a second code path gives the same number.' : 'Check failed: the two code paths differ.')),
    h('div', { class: 'blk' }, h('h4', null, 'Rows used'), miniTable(['time', 'state', 'stop reason', 'produced', 'rejects', 'preform stock'], rows, 80))]);
}
function factText(text, facts, onTap) { // "{{f1}}" becomes a tappable number
  const out = []; text.split(/(\{\{f\d+\}\})/).forEach(p => {
    const m = p.match(/^\{\{(f\d+)\}\}$/); if (!m) { if (p) out.push(p); return; }
    const f = facts.find(x => x.id === m[1]); if (!f) return;
    out.push(h('button', { class: 'num' + (f.ok ? '' : ' bad'), title: 'Tap to see where this number comes from', onclick: () => onTap(f) }, f.shown));
  }); return out;
}
const limOf = k => { const K = Sim.KPIS[Sim.KEYS.indexOf(k)], v = APP.SW[K.lim]; return (K.dir === 'below' ? 'Warn below ' : 'Warn above ') + v + (k === 'stop' || k === 'cover' ? ' min' : '%'); };

const Watch = (() => {
  const body = $('#watchBody'), sheet = $('#sheet'), tiles = [{}, {}], pillBox = h('div', { class: 'rlist' }), pillCount = h('span', null, '');
  let pillKey = '', lastSheetNow = -1, fresh = new Set(), big = false;
  document.body.append(sheet); // the sheet floats in front of the Monitor
  function place() { const r = $('#paneWa').getBoundingClientRect(), f = $('#floor').getBoundingClientRect(), top = big ? Math.max(8, f.top) : r.top; Object.assign(sheet.style, { left: r.left + 'px', width: r.width + 'px', top: top + 'px', height: (r.bottom - top) + 'px' }); }
  window.addEventListener('resize', () => APP.open != null && place());
  const khs = Sim.KPIS.map(K => ({ n: h('b', null, K.name), w: h('small', null, '') })), khead = h('div', { class: 'khead' }, h('span'), h('div', { class: 'tiles' }, khs.map(x => h('div', { class: 'kh' }, x.n, x.w))));
  const cards = [0, 1].map(l => {
    const st = h('span', { class: 'state' }, h('i'), h('span', null, 'Watching')), grid = h('div', { class: 'tiles' });
    Sim.KEYS.forEach((k, i) => {
      const K = Sim.KPIS[i], t = { k: h('div', { class: 'k' }, K.name), v: h('div', { class: 'v' }, '–'), w: h('div', { class: 'w' }, ''), sp: h('div') };
      t.el = h('div', { class: 'tile na', title: K.what }, t.k, t.v, t.w, t.sp); tiles[l][k] = t; grid.append(t.el);
    });
    return h('div', { class: 'lcard' }, h('div', { class: 'lhead' }, h('b', null, Sim.LNAME[l]), st), grid);
  });
  body.append(h('div', { class: 'matrix' }, khead, cards[0], cards[1]), h('div', { class: 'rsec' }, h('div', { class: 'sech' }, 'RCA reports', pillCount, h('span', null, 'Click a pill to open the full analysis')), pillBox));
  function active(l, k, now) { return APP.scan.alerts.find(a => a.line === l && a.key === k && a.ta <= now && a.tEnd >= now); }
  function rcaOf(inc) { // light summary for a pill, cached until the settings change
    let r = APP.rc.get(inc.id); if (!r) { const rep = Sim.reportFor(APP.D, APP.SW, inc, nowMin()); r = { title: rep.title, cause: rep.cause, causeName: rep.causeName }; APP.rc.set(inc.id, r); } return r;
  }
  function refresh(force) {
    const now = nowMin(), D = APP.D;
    for (let l = 0; l < 2; l++) {
      let nb = 0;
      Sim.KEYS.forEach((k, i) => {
        const K = Sim.KPIS[i], t = tiles[l][k], v = Sim.kv(D, k, l, now), br = Sim.isBreach(APP.SW, k, v), al = active(l, k, now), id = l + k + (al ? al.ta : '');
        t.v.textContent = Sim.fmtKpi(k, v); t.el.classList.toggle('red', br); t.el.classList.toggle('na', v == null);
        t.w.textContent = br && al ? 'Warning since ' + Sim.hhmm(al.ta) : br ? 'Checking…' : v == null ? 'Too little run time' : limOf(k); t.el.classList.toggle('alerting', br); khs[i].w.textContent = limOf(k);
        if (al && !fresh.has(id) && APP.playing) { fresh.add(id); t.el.classList.add('fresh'); setTimeout(() => t.el.classList.remove('fresh'), 2600); } else if (al) fresh.add(id);
        if (br) nb++;
        const pts = []; for (let x = Math.max(60, now - 360); x <= now; x += 12) { const y = Sim.kv(D, k, l, x); if (y != null) pts.push([x, y]); }
        t.sp.replaceChildren(sparkline(pts, { limit: APP.SW[K.lim] / K.scale, color: br ? 'var(--red)' : 'var(--blue)' }));
        t.sp.style.color = 'var(--label2)';
      });
      const st = cards[l].querySelector('.state'); st.className = 'state' + (nb ? ' stop' : ''); st.lastChild.textContent = nb ? nb + ' warning' + (nb > 1 ? 's' : '') : 'All clear';
    }
    drawPills(now, force);
    if (APP.open != null) { if (!APP.inc.some(i => i.id === APP.open && i.start <= now)) closeSheet(); else if (force || now !== lastSheetNow) renderSheet(); }
  }
  function drawPills(now, force) {
    const vis = APP.inc.filter(i => i.start <= now).sort((a, b) => b.start - a.start), key = vis.map(i => i.id + (i.end >= now ? 'L' : 'D')).join(',') + '|' + APP.rc.size;
    if (key === pillKey && !force) return; pillKey = key;
    pillCount.textContent = vis.length ? ' · ' + vis.length : '';
    if (!vis.length) { pillBox.replaceChildren(h('div', { class: 'empty' }, 'No warnings yet. Press play. An RCA pill appears here when something triggers.')); return; }
    pillBox.replaceChildren(...vis.map(inc => {
      const live = inc.end >= now, isNew = !APP.seen.has(inc.id); APP.seen.add(inc.id); const r = rcaOf(inc);
      return h('button', { class: 'rpill' + (live ? ' live' : '') + (isNew ? ' fresh' : ''), 'aria-label': 'RCA ' + inc.id + '. ' + r.title + '. ' + (r.cause ? 'Cause: ' + r.causeName : 'Cause not clear') + (live ? '. Still on.' : '. Cleared.') + ' Open the full report.', onclick: () => openSheet(inc.id) },
        h('span', { class: 'dot' }),
        h('span', { class: 'tx' }, h('b', null, 'RCA ' + inc.id + ' · ' + r.title), h('small', null, Sim.full(inc.start) + ' · ' + (r.cause ? 'Cause: ' + r.causeName : 'Cause not clear') + (live ? ' · still on' : ''))),
        h('span', { class: 'badge' + (r.cause ? '' : ' q') }, r.cause ? 'Cause found' : 'Not clear'), h('span', { class: 'chev' }, '›'));
    }));
  }
  // ---- the full RCA sheet ----
  function openSheet(id) { APP.open = id; if (window.innerWidth <= 520) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); place(); sheet.classList.add('on'); lastSheetNow = -1; renderSheet(true); const sb = sheet.querySelector('.sbody'); if (sb) sb.scrollTop = 0;  }
  function closeSheet() { APP.open = null; sheet.classList.remove('on'); }
  function causeBlock(rep) {
    const ok = !!rep.cause;
    return h('div', { class: 'blk' }, h('h4', null, 'Most likely cause'), h('div', { class: 'cause' }, h('div', { class: 'bd ' + (ok ? 'g' : 'o') }, ok ? '✓' : '?'), h('div', null, h('div', { class: 'big' }, ok ? rep.causeName : 'The cause is not clear'), h('div', { class: 'cap' }, rep.causeLine))),
      rep.evidence.length ? h('div', { style: { marginTop: '8px' } }, rep.evidence.map(e => h('div', { class: 'chk' }, h('b', { class: 'y' }, '✓'), h('span', null, e)))) : null);
  }
  function barRows(list, unit) { // bars: now (bar) against normal (tick)
    const mx = Math.max(1, ...list.map(x => Math.max(x.now, x.normal || 0)));
    return list.map(x => h('div', { class: 'bar2' + (x.bad ? ' bad' : '') }, h('span', { class: 'nm', title: x.name }, x.name), h('div', { class: 'hb' }, h('i', { style: { width: (x.now / mx * 100) + '%' } }), x.normal != null ? h('em', { style: { left: 'calc(' + (x.normal / mx * 100) + '% - 1px)' } }) : null), h('span', { class: 'vl' }, x.now + unit, h('small', null, x.normal != null ? 'normal ' + (Math.round(x.normal * 10) / 10) : ''))));
  }
  function table(cols, rows, right) { return h('table', { class: 'kt' }, h('thead', null, h('tr', null, cols.map((c, i) => h('th', { class: right && i ? 'n' : '' }, c)))), h('tbody', null, rows)); }
  function dataAnalysis(rep, an, inc, now) {
    const K = Sim.KPIS[Sim.KEYS.indexOf(rep.key)], pts = [], pts2 = [], op = [], op2 = [], x0 = Math.max(60, rep.on - 240), x1 = Math.min(now, Math.max(rep.ta, inc.end) + 180);
    const scale = (rep.key === 'oee' || rep.key === 'speed' || rep.key === 'rej') ? 100 : 1, unit = rep.key === 'stop' || rep.key === 'cover' ? ' min' : '%';
    for (let x = x0; x <= x1; x += 10) {
      const a = Sim.kv(APP.D, rep.key, rep.line, x), b = Sim.kv(APP.D, rep.key, 1 - rep.line, x); if (a != null) pts.push([x, a * scale]); if (b != null) pts2.push([x, b * scale]);
      let s1 = 0, s2 = 0; for (let i = x - 9; i <= x; i++) { s1 += APP.D.L[rep.line].prod[i]; s2 += APP.D.L[1 - rep.line].prod[i]; } op.push([x, s1 / (Sim.IDEAL[rep.line] * 10) * 100]); op2.push([x, s2 / (Sim.IDEAL[1 - rep.line] * 10) * 100]);
    }
    const marks = [{ t: rep.on, label: 'starts' }, { t: rep.ta, label: 'alert' }], L = Sim.LNAME[rep.line], O = Sim.LNAME[1 - rep.line];
    return [
      h('div', { class: 'band', 'data-sec': 'da' }, h('h3', null, 'Data analysis'), h('span', { class: 'tn' }, Sim.hhmm(an.a) + '–' + Sim.hhmm(an.b) + ' (' + an.n + ' min) against ' + (an.hasNormal ? 'the same time on ' + an.normalDays + ' earlier day' + (an.normalDays > 1 ? 's' : '') : 'no earlier day'))),
      h('div', { class: 'blk' }, h('h4', null, 'What the data says'), h('ol', { class: 'read' }, an.read.map(t => h('li', null, t)))),
      h('div', { class: 'blk' }, h('h4', null, L + ': this window against normal'), table(['Measure', 'Now', 'Normal at this time', ''], an.rows.map(r => h('tr', null, h('td', null, r.label), h('td', { class: 'n tn' + (r.bad ? ' up' : '') }, r.now), h('td', { class: 'n tn' }, r.normal), h('td', { class: 'n' }, r.bad ? h('span', { class: 'up' }, '▲ off') : ''))), true)),
      an.supply ? h('div', { class: 'blk' }, h('h4', null, 'Preform supply'), table(['Measure', 'Now', 'Normal at this time', ''], an.supply.map(r => h('tr', null, h('td', null, r.label), h('td', { class: 'n tn' + (r.bad ? ' up' : '') }, r.now), h('td', { class: 'n tn' }, r.normal), h('td', { class: 'n' }, r.bad ? h('span', { class: 'up' }, '▲ off') : ''))), true)) : null,
      h('div', { class: 'twocol' },
        h('div', { class: 'blk' }, h('h4', null, 'Where the lost minutes went'), an.reasons.length ? barRows(an.reasons, ' min') : h('div', { class: 'cap' }, 'No fault stops in this window.'), an.planned.length ? h('div', { class: 'cap' }, 'Planned stops (not faults): ' + an.planned.join(', ') + '.') : null, h('div', { class: 'legend2' }, h('span', null, h('i'), 'This window'), h('span', null, h('u'), 'Normal'))),
        h('div', { class: 'blk' }, h('h4', null, 'Reject types'), an.defects.length ? barRows(an.defects, '') : h('div', { class: 'cap' }, 'No rejects in this window.'), h('div', { class: 'legend2' }, h('span', null, h('i'), 'This window'), h('span', null, h('u'), 'Normal')))),
      h('div', { class: 'blk' }, h('h4', null, 'The other line (' + O + '), same window'), table(['Measure', 'Now', 'Normal at this time', ''], an.other.map(r => h('tr', null, h('td', null, r.label), h('td', { class: 'n tn' + (r.bad ? ' up' : '') }, r.now), h('td', { class: 'n tn' }, r.normal), h('td', { class: 'n' }, r.bad ? h('span', { class: 'up' }, '▲ off') : ''))), true)),
      h('div', { class: 'blk' }, h('h4', null, K.name + ' around the trouble'), trendChart({ series: [{ name: L, pts }, { name: O, pts: pts2 }], marks }, { unit, limit: APP.SW[K.lim], w: 760, h: 190 }), h('div', { class: 'cap' }, trendWords({ series: [{ name: L, pts }] }, { unit }))),
      h('div', { class: 'blk' }, h('h4', null, 'Output against ideal (10-minute average)'), trendChart({ series: [{ name: L, pts: op }, { name: O, pts: op2 }], marks }, { unit: '%', w: 760, h: 170 }), h('div', { class: 'cap' }, 'Each line is shown against its own ideal speed (' + Sim.IDEAL[rep.line] + ' and ' + Sim.IDEAL[1 - rep.line] + ' bottles a minute). A planned stop counts as zero.')),
      h('div', { class: 'foot2' + (an.checks.ok === an.checks.total ? '' : ' bad') }, ico('shield'), an.checks.ok + ' of ' + an.checks.total + ' totals matched a second way (minute rows against the stop and reject tables)')];
  }
  function triangulation(rep, tri) {
    const sym = { strong: '✓', medium: '✓', weak: '?' }[tri.level], vt = { supports: 'Supports', partly: 'Partly', against: 'Does not support', none: 'No check' };
    return [
      h('div', { class: 'band', 'data-sec': 'tri' }, h('h3', null, 'Triangulation'), h('span', null, 'Three angles on one moment. Each angle uses different rows.')),
      h('div', { class: 'tri-sum ' + tri.level }, h('div', { class: 'bd' }, sym), h('div', null, h('b', null, tri.summary), h('small', null, tri.proven ? 'A cause is named when at least ' + Math.round(tri.thr * 100) + '% of checks pass and it beats the next idea by 25 points.' : 'I do not name a cause unless enough checks pass. Ask the operator and watch the next 60 minutes.'))),
      h('div', { class: 'angles' }, tri.angles.map(a => h('div', { class: 'angle' },
        h('div', { class: 'ah' }, h('b', null, a.name), h('span', { class: 'vd ' + a.verdict }, vt[a.verdict] + (a.total ? ' ' + a.passed + '/' + a.total : ''))),
        h('div', { class: 'ask' }, a.ask),
        a.total ? a.checks.map(c => h('div', { class: 'chk' }, h('b', { class: c.skipped ? 's' : c.ok ? 'y' : 'n' }, c.skipped ? '–' : c.ok ? '✓' : '✗'), h('span', null, h('span', { style: { color: 'var(--label)' } }, c.text + '. '), c.detail))) : h('div', { class: 'cap' }, 'This idea has no check in this angle.'),
        a.context && a.context.length ? h('div', { class: 'seen' }, h('h6', null, 'What I saw'), a.context.map(x => h('div', { class: 'li ' + (x.phase || '') }, h('span', { class: 'dotp' }), h('span', null, x.text)))) : null))),
      tri.runner ? h('div', { class: 'runner' }, 'Idea tested: "' + tri.idea + '" (' + rep.rca.tested[0].passed + ' of ' + rep.rca.tested[0].total + ' checks). Next best: "' + tri.runner.name + '" (' + tri.runner.passed + ' of ' + tri.runner.total + ').') : null];
  }
  function renderSheet() {
    const now = nowMin(), inc = APP.inc.find(i => i.id === APP.open); if (!inc) return; lastSheetNow = now;
    const rep = Sim.reportFor(APP.D, APP.SW, inc, now), an = Sim.analysisFor(APP.D, APP.SW, rep), tri = Sim.triangulate(rep), r = rep.rca;
    const old = sheet.querySelector('.sbody'), sc = old ? old.scrollTop : 0;
    const jump = k => () => { const el = sheet.querySelector('[data-sec="' + k + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const nav = h('nav', { class: 'snav', 'aria-label': 'Sections of this report' }, [['sum', 'Summary'], ['da', 'Data analysis'], ['tri', 'Triangulation'], ['ideas', 'Ideas tested'], ['act', 'Next steps']].map(([k, n]) => h('button', { onclick: jump(k) }, n)));
    const head = h('div', { class: 'shead' }, h('div', { class: 'tt' }, h('b', null, 'RCA ' + inc.id + ' · ' + rep.title), h('span', { class: 'tn' }, 'Alert at ' + Sim.full(rep.ta) + (inc.end >= now ? ' · still on' : ' · cleared'))), h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'iconbtn', 'aria-label': big ? 'Make the report smaller' : 'Make the report larger', title: big ? 'Smaller' : 'Larger', onclick: () => { big = !big; place(); renderSheet(); } }, ico(big ? 'shrink' : 'expand')), h('button', { class: 'iconbtn', 'aria-label': 'Close the report', onclick: closeSheet }, ico('x'))));
    const nOk = rep.facts.filter(f => f.ok).length, foot = h('div', { class: 'foot' + (nOk === rep.facts.length ? '' : ' bad') }, ico('shield'), nOk + ' of ' + rep.facts.length + ' numbers in the summary checked a second way');
    const cont = [
      h('div', { class: 'blk', 'data-sec': 'sum' }, h('h4', null, 'What is wrong'), h('p', { class: 'big' }, factText(rep.lead, rep.facts, openRows)), h('div', { class: 'cap' }, 'Trouble began about ' + Sim.hhmm(rep.on) + '. Tap a blue number to see its rows.')),
      causeBlock(rep),
      h('div', { class: 'blk' }, h('h4', null, 'All five signals at alert time'), h('table', { class: 'kt' }, h('thead', null, h('tr', null, ['Signal', 'Then', 'Warning', 'Normal here'].map(c => h('th', null, c)))), h('tbody', null, rep.kpis.map(k => h('tr', null, h('td', null, k.name), h('td', { class: k.breach ? 'r' : '' }, k.shown), h('td', null, k.limit), h('td', null, k.normal || '–')))))),
      ...dataAnalysis(rep, an, inc, now),
      ...triangulation(rep, tri),
      h('div', { class: 'band', 'data-sec': 'ideas' }, h('h3', null, 'Ideas tested (' + r.tested.length + ')'), h('span', null, 'Every idea gets the same checks.')),
      h('div', { class: 'blk' }, r.tested.map((hy, i) => h('details', { class: 'hyp', open: i === 0 }, h('summary', null, hy.name, h('span', { class: 'cap', style: { margin: 0 } }, hy.passed + ' of ' + hy.total), h('span', { class: 'bar' + (hy.passed / hy.total >= APP.SW.sure / 100 ? '' : ' low') }, h('i', { style: { width: (hy.passed / hy.total * 100) + '%' } }))), hy.checks.map(c => h('div', { class: 'chk' }, h('b', { class: c.skipped ? 's' : c.ok ? 'y' : 'n' }, c.skipped ? '–' : c.ok ? '✓' : '✗'), h('span', null, h('span', { style: { color: 'var(--label)' } }, c.text + '. '), c.detail))))),
        r.notTested.length ? h('div', { class: 'cap' }, 'Not tested (limit set by the slider): ' + r.notTested.join(', ') + '.') : null),
      h('div', { class: 'blk' }, h('h4', null, 'Everything I looked at around the moment'), lensView(rep.lens)),
      h('div', { class: 'band', 'data-sec': 'act' }, h('h3', null, 'Next steps')),
      rep.updates.length ? h('div', { class: 'blk' }, h('h4', null, 'Updates since'), rep.updates.map(u => h('div', { class: 'upd' }, h('time', null, Sim.hhmm(u.t)), h('span', null, factText(u.text, rep.facts, openRows))))) : null,
      h('div', { class: 'blk' }, h('h4', null, 'What to check next'), h('p', null, rep.playbook)), foot];
    sheet.replaceChildren(h('div', { class: 'grab' }), head, nav, h('div', { class: 'sbody', tabindex: '-1' }, cont)); const nb = sheet.querySelector('.sbody'); if (nb) nb.scrollTop = sc;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && APP.open != null && !$('.scrim')) closeSheet(); });
  return { refresh, openSheet, closeSheet };
})();
