// ===== Wire-up =====
$('#exGear').addEventListener('click', () => openSettings('E'));
$('#waGear').addEventListener('click', () => openSettings('W'));
$('#safeBtn').addEventListener('click', openSafety);
$('#themeBtn').addEventListener('click', () => setTheme({ dark: 'light', light: 'auto', auto: 'dark' }[APP.theme]));
setTheme('dark');
try { matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => Floor.theme()); } catch (e) {}
const tabsEl = $('#tabs');
function showTab(k) { APP.tab = k; if (window.innerWidth <= 520) setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 60); $('#paneEx').classList.toggle('show', k === 'chat'); $('#paneWa').classList.toggle('show', k === 'watch'); $$('button', tabsEl).forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k)); }
tabsEl.append(h('button', { 'data-k': 'chat', onclick: () => showTab('chat') }, 'Explorer'), h('button', { 'data-k': 'watch', onclick: () => showTab('watch') }, 'Monitor'));
showTab('chat');
Watch.refresh(true); Time.update(true);
window.__app = APP;
