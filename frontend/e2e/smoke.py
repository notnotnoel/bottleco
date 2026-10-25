"""End-to-end check of the built app served by the API: desktop and phone screenshots, no console errors."""
import sys
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/'
out = sys.argv[2] if len(sys.argv) > 2 else 'shot'
T = lambda d, h, m: (d - 1) * 1440 + h * 60 + m - 360
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    pg = b.new_page(viewport={'width': 1360, 'height': 860})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append('CONSOLE ' + m.text))
    pg.goto(url); pg.wait_for_selector('.lcard', timeout=20000)
    pg.evaluate(f'window.__bottleco.seek({T(10, 9, 0)})'); pg.wait_for_timeout(2500)
    pg.screenshot(path=out + '_desk.png')
    pills = pg.locator('.rpill'); print('pills', pills.count())
    pills.first.click(); pg.wait_for_selector('.sheet .blk', timeout=20000); pg.wait_for_timeout(800)
    pg.screenshot(path=out + '_sheet.png')
    pg.locator('[data-sec=tri]').scroll_into_view_if_needed(); pg.wait_for_timeout(500); pg.screenshot(path=out + '_tri.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.fill('input[aria-label="Ask a question"]', 'Why did Line 1 overall score drop on 10 Sep?'); pg.keyboard.press('Enter')
    pg.wait_for_selector('.msg.in .verdict', timeout=60000); pg.wait_for_timeout(800)
    pg.screenshot(path=out + '_chat.png')
    print('chat foot:', pg.locator('.msg.in .foot').last.inner_text())
    # play for 2 seconds at 60x: the clock must move and warnings must not break anything
    pg.evaluate('window.__bottleco.setRate(60); window.__bottleco.toggle(true)'); pg.wait_for_timeout(2000)
    print('clock after play:', pg.locator('.ht').inner_text())
    ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ph.on('pageerror', lambda e: errs.append('PHONE ' + str(e)))
    ph.goto(url); ph.wait_for_selector('.lcard', state='attached', timeout=20000); ph.evaluate(f'window.__bottleco.seek({T(10, 9, 0)})'); ph.wait_for_timeout(2000)
    ph.screenshot(path=out + '_ph1.png')
    ph.tap('nav.tabs button:nth-child(2)'); ph.wait_for_timeout(800); ph.screenshot(path=out + '_ph2.png')
    print('phone scrollWidth', ph.evaluate('document.documentElement.scrollWidth'))
    print('ERRS', errs); b.close()
