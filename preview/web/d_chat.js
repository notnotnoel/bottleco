// ===== Data Explorer: iMessage-style chat =====
function openFact(f) {
  const fm = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toString();
  modal('Where this number comes from', h('div', { class: 'blk' }, h('h4', null, f.label), h('p', { class: 'big tn' }, f.shown),
    h('p', null, 'Code computed this number from the rows in the "Raw data" card. A second code path counted the rows again.'),
    h('table', { class: 'kt' }, h('tbody', null, h('tr', null, h('td', null, 'First count'), h('td', { class: 'tn' }, fm(f.value))), h('tr', null, h('td', null, 'Second count'), h('td', { class: 'tn' }, fm(f.check))))),
    h('div', { class: 'foot' + (f.ok ? '' : ' bad') }, ico('shield'), f.ok ? 'The two counts match.' : 'The two counts differ.')));
}
const Chat = (() => {
  const log = $('#chatLog'), input = $('#chatIn'), sendBtn = $('#sendBtn'), sugBox = $('#sugs');
  let busy = false, sugKey = '', topOf = null;
  const scroll = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function att(icon, title, count, body, open) {
    return h('details', { class: 'att', open: open ? true : null }, h('summary', null, ico(icon), title, count ? h('span', { class: 'cnt' }, count) : null), h('div', { class: 'ab' }, body));
  }
  function rawCard(raw) {
    if (!raw) return null; const cap = 6; let all = false;
    const wrap = h('div'), draw = () => { const rows = all ? raw.rows.slice(0, 200) : raw.rows.slice(0, cap); wrap.replaceChildren(miniTable(raw.cols, rows, rows.length), raw.rows.length > cap && !all ? h('button', { class: 'btn', style: { marginTop: '8px', height: '28px' }, onclick: () => { all = true; draw(); } }, 'Show ' + Math.min(200, raw.rows.length) + ' rows') : null, h('div', { class: 'more' }, raw.cut ? 'Showing ' + raw.rows.length + ' of ' + fmtN(raw.total) + ' rows. The "How much data may I read?" slider sets the limit.' : fmtN(raw.total) + ' row' + (raw.total === 1 ? '' : 's') + ' in total.')); };
    draw(); return att('table', 'Raw data', (raw.table || '') + ' · ' + fmtN(raw.total) + ' rows', wrap, true);
  }
  function renderAnswer(a) {
    const msg = h('div', { class: 'msg in' });
    if (a.kind === 'abstain') {
      msg.append(h('div', { class: 'bub warn' }, h('div', { class: 'tag' }, a.failed ? 'Could not confirm' : 'Not in the data'), a.text, a.dataRange ? h('div', { class: 'cap' }, a.dataRange + ' Up to now means up to the time bar.') : null));
      const row = h('div', { class: 'sugs', style: { padding: '6px 0 0', flexWrap: 'wrap', overflow: 'visible' } }, (a.suggestions || []).slice(0, 4).map(q => h('button', { class: 'sug', onclick: () => ask(q) }, q)));
      msg.append(row); return msg;
    }
    if (a.verdict) { const v = a.verdict; msg.append(h('div', { class: 'bub' }, factText(a.headline, a.facts, openFact), h('div', { class: 'verdict k-' + v.kind }, h('div', { class: 'vt' }, h('span', { class: 'vb' }, v.kind === 'cause' ? '✓' : v.kind === 'unclear' ? '?' : '–'), h('div', null, h('b', null, v.title), h('small', null, v.sub))), v.lines.map(x => h('div', { class: 'chk' }, h('b', { class: v.kind === 'cause' ? 'y' : 's' }, v.kind === 'cause' ? '✓' : '·'), h('span', null, x))))));
    } else msg.append(h('div', { class: 'bub' }, factText(a.text, a.facts, openFact)));
    msg.append(att('db', 'Data queried', a.queried.length + ' source' + (a.queried.length > 1 ? 's' : ''), a.queried.map(q => h('div', { class: 'qrow' }, h('code', null, q.table), h('span', null, q.filter + ' · ' + fmtN(q.rows) + ' rows'))), true));
    msg.append(rawCard(a.raw));
    if (a.trend && a.trend.series) msg.append(att('trend', 'Trend observed', null, [trendChart(a.trend, a.trendInfo), h('div', { class: 'cap' }, trendWords(a.trend, a.trendInfo)), a.trendInfo && a.trendInfo.note ? h('div', { class: 'cap' }, a.trendInfo.note) : null], true));
    if (a.lens) msg.append(att('eye', 'Context I checked', 'before, same time, similar past', lensView(a.lens), false));
    if (a.tested && a.tested.length) msg.append(att('find', 'Causes I tested', a.tested.length + ' ideas', a.tested.map(t => h('div', { class: 'li' }, h('span', { class: 'dotp' }), h('span', null, t))), false));
    msg.append(h('div', { class: 'foot' }, ico('shield'), a.check.ok + ' of ' + a.check.total + ' numbers checked a second way · data up to ' + Sim.full(nowMin())));
    return msg;
  }
  async function ask(text) {
    text = (text || '').trim(); if (!text || busy) return; busy = true; sendBtn.disabled = true; input.value = '';
    const now = nowMin();
    log.append(h('div', { class: 'ts tn' }, Sim.full(now)), h('div', { class: 'msg out' }, h('div', { class: 'bub tail' }, text))); scroll();
    const typing = h('div', { class: 'msg in' }, h('div', { class: 'bub tail typing', 'aria-label': 'Checking the data' }, h('i'), h('i'), h('i'))), step = h('div', { class: 'step' }, 'Reading the data…');
    log.append(typing, step); scroll();
    await sleep(380); step.textContent = 'Looking before, after and at the same time…'; await sleep(420); step.textContent = 'Checking every number a second way…'; await sleep(360);
    let ans; try { ans = Sim.answer(APP.D, APP.SE, text, now, APP.hist); } catch (e) { ans = { kind: 'abstain', text: 'I could not work this out (' + e.message + ').', suggestions: Sim.SAMPLE_Q }; }
    typing.remove(); step.remove(); const el = renderAnswer(ans); log.append(el); topOf = el;
    if (ans.parsed) { APP.hist.push(ans.parsed); const keep = Math.max(2, Math.round(APP.SE.memory)); if (APP.hist.length > keep) APP.hist.splice(0, APP.hist.length - keep); }
    busy = false; sendBtn.disabled = !input.value.trim(); log.scrollTo({ top: Math.max(0, el.offsetTop - log.offsetTop - 10), behavior: 'smooth' });
  }
  function suggestions() {
    const now = nowMin(), cd = Sim.dt(now).getUTCDate(), last = APP.inc.filter(i => i.start <= now).sort((a, b) => b.start - a.start)[0], L = [];
    if (last) { const K = Sim.KPIS[Sim.KEYS.indexOf(last.first)], noun = { oee: 'overall score', stop: 'stopped time', speed: 'speed', rej: 'rejects', cover: 'preforms left' }[last.first]; L.push([`Why did ${Sim.LNAME[last.line]} ${noun} ${K.dir === 'below' ? 'drop' : 'rise'} on ${Sim.dlabel(last.start)}?`]); }
    else L.push(['How is Line 1 doing now?']);
    L.push(['Which stop reason cost the most minutes on Line 2?']);
    if (cd >= 2) L.push(['How many bottles were rejected yesterday?']);
    L.push(['Compare shift A, B and C on both lines']);
    const at = last ? last.start : Math.max(60, now - 30); L.push([`What happened at ${Sim.hhmm(at)} on ${Sim.dt(at).getUTCDate()} Sep?`]);
    L.push(['What will the overall score be tomorrow?', 'trick']); L.push(['What did Line 3 make yesterday?', 'trick']);
    const key = JSON.stringify(L); if (key === sugKey) return; sugKey = key;
    sugBox.replaceChildren(...L.map(([q, t]) => h('button', { class: 'sug' + (t ? ' trick' : ''), title: t ? 'A trick question. I should refuse.' : '', onclick: () => ask(q) }, q)));
  }
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  input.addEventListener('input', () => { sendBtn.disabled = busy || !input.value.trim(); });
  log.append(h('div', { class: 'msg in' }, h('div', { class: 'bub' }, 'Hi. I am the Data Explorer. I answer only from Bottle Co data, and only up to the time on the time bar. Every answer shows the data I queried, the raw rows and the trend I saw.'),
    h('div', { class: 'bub tail', style: { marginTop: '4px' } }, 'Press play, then ask me why something happened. Tap a blue number to see where it comes from.')));
  sendBtn.disabled = true;
  return { ask, suggestions };
})();
