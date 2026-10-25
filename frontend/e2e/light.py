import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1360, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(sys.argv[1]); pg.wait_for_selector('.lcard', timeout=20000)
    pg.evaluate('window.__bottleco.seek(%d)' % ((5 - 1) * 1440 + 14 * 60 + 50 - 360)); pg.click('button[aria-label=Appearance]'); pg.wait_for_timeout(2000)
    pg.screenshot(path=sys.argv[2]); print('ERRS', errs); b.close()
