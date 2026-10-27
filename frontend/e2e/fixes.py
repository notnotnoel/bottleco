"""Bug fix list (27 Oct) checks. Run: python3 fixes.py http://127.0.0.1:8000/
1. +10 min moves the clock 10 minutes, on desktop and phone, and shows the jump bubble.
2. KPI tiles keep one height while time moves (warnings come and go).
3. Every sparkline has its dashed warning line.
4. Phone: one-row time bar with a More menu; the page never scrolls sideways; the RCA sheet fits the screen.
5. Data Explorer: the answer leads with the direct answer, the chat snaps to its start; an aggregate question gets an aggregate answer; an off-topic question after a real one gets "not about Line 1 or Line 2".
"""
import sys

from playwright.sync_api import sync_playwright

U = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/'
T = lambda d, h, m: (d - 1) * 1440 + h * 60 + m - 360  # noqa: E731
fails = []


def check(ok, what):
    print(('PASS ' if ok else 'FAIL ') + what)
    if not ok:
        fails.append(what)


def ask(pg, q):
    n = pg.locator('.msg.in').count()
    pg.fill('input[aria-label="Ask a question"]', q); pg.keyboard.press('Enter')
    pg.wait_for_function(f"document.querySelectorAll('.msg.in').length > {n} && !document.querySelector('.bub.typing')", timeout=90000)
    pg.wait_for_timeout(400)
    return pg.locator('.msg.in').last.inner_text()


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1360, 'height': 860}); pg.goto(U); pg.wait_for_selector('.lcard')
    pg.evaluate(f'window.__bottleco.seek({T(10, 9, 0)})'); pg.wait_for_timeout(1200)
    pg.click('button[aria-label="Jump 10 min on"]'); pg.wait_for_timeout(500)
    check(pg.locator('.ht').inner_text() == '09:10', '+10 min on desktop')
    pg.evaluate('window.__bottleco.setRate(10); window.__bottleco.toggle(true)'); pg.wait_for_timeout(700)
    t0 = pg.evaluate('window.__bottleco.clock.current.t'); pg.click('button[aria-label="Jump 10 min on"]'); t1 = pg.evaluate('window.__bottleco.clock.current.t')
    pg.evaluate('window.__bottleco.toggle(false)')
    check(9.5 <= t1 - t0 <= 12.5, '+10 min while playing (moved %.1f min)' % (t1 - t0))
    hs = set()
    for k in range(40):
        pg.evaluate(f'window.__bottleco.seek({T(3, 9, 0)}+{k * 7})'); pg.wait_for_timeout(100)
        hs.add(tuple(round(x) for x in pg.evaluate("[...document.querySelectorAll('.lcard .tile')].map(e=>e.getBoundingClientRect().height)")))
    check(len(hs) == 1, 'tile heights stay the same (%d sets seen)' % len(hs))
    check(pg.locator('.tile svg line.lim').count() == pg.locator('.tile').count(), 'warning line on every sparkline')
    a1 = ask(pg, "What's happening on line 1 now?")
    a2 = ask(pg, 'why is red a color')
    check('not about Line 1 or Line 2' in a2, 'off-topic question after a real one: ' + a2[:70])
    a3 = ask(pg, 'Which day had the highest output on Line 2?')
    check('Highest bottles made per day' in a3 or 'highest' in a3.lower(), 'aggregate answer: ' + a3[:90])
    a4 = ask(pg, 'What incident had the highest impact on production?'); pg.wait_for_timeout(700)
    check(a4.startswith('The incident with the highest impact was RCA'), 'direct answer first: ' + a4[:70])
    gap = pg.evaluate("(()=>{const b=document.querySelector('.chat'), q=[...b.querySelectorAll('[data-q]')].pop(); return q.getBoundingClientRect().top-b.getBoundingClientRect().top})()")
    check(0 <= gap <= 20, 'chat snaps to the start of the answer (gap %d px)' % gap)

    ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ph.goto(U); ph.wait_for_selector('.lcard', state='attached'); ph.evaluate(f'window.__bottleco.seek({T(10, 9, 0)})'); ph.wait_for_timeout(1500)
    ph.tap('button[aria-label="Jump 10 min on"]'); ph.wait_for_timeout(80)
    check(ph.locator('.tb .bump').count() == 1, 'jump bubble shows')
    ph.wait_for_timeout(500); check(ph.locator('.ht').inner_text() == '09:10', '+10 min on phone')
    dr = ph.locator('.drawer').bounding_box()
    check(dr['height'] < 150, 'phone time bar is compact (%d px)' % dr['height'])
    ph.tap('button[aria-label="More time controls"]'); ph.wait_for_timeout(300)
    check(ph.locator('.pop.more .mrow').count() == 6, 'More menu has 6 rows')
    ph.locator('.pop.more .mrow', has_text='Next warning').tap(); ph.wait_for_timeout(500)
    check(ph.locator('.ht').inner_text() != '09:10', 'Next warning from More moves the clock')
    ph.tap('nav.tabs button:nth-child(2)'); ph.wait_for_timeout(400); ph.locator('.rpill').first.tap(); ph.wait_for_selector('.sheet .blk'); ph.wait_for_timeout(800)
    sw = ph.evaluate("[document.querySelector('.sheet .sbody').scrollWidth, document.querySelector('.sheet .sbody').clientWidth, document.documentElement.scrollWidth, innerWidth]")
    check(sw[0] <= sw[1] and sw[2] <= sw[3], 'RCA sheet fits the phone screen %s' % sw)
    b.close()
print('ALL PASS' if not fails else '%d FAIL' % len(fails))
sys.exit(1 if fails else 0)
