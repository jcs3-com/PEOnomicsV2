"""PEOnomics browser QA (Playwright, Chromium).

  python3 tests/test_browser.py                 # serves this checkout locally, mocks /api/*
  python3 tests/test_browser.py https://peonomics.com --live   # real deployment, no API mocks

Local mode mocks /api/enrich, /api/report-status, /api/report-request and the
Turnstile script so every UI state can be exercised without credentials.
Live mode never submits a lookup or report (no real emails, no log rows).
"""
import json, os, subprocess, sys, time, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
LIVE = '--live' in sys.argv
BASE = args[0].rstrip('/') if args else None
server = None
if not BASE:
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', ROOT],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    BASE = f'http://127.0.0.1:{port}'; time.sleep(0.8)

fails, passes = [], 0
def check(cond, msg):
    global passes
    if cond: passes += 1
    else: fails.append(msg); print('FAIL', msg)

TURNSTILE_STUB = "window.turnstile={render:(el,o)=>{const b=document.createElement('button');b.id='tsStub';b.type='button';b.textContent='verify';b.onclick=()=>o.callback('stub-token-123456');el.append(b);return 'w1';},reset:()=>{}};"

def no_overflow(pg):
    return not pg.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, name in [(1440, 1000, 'desktop'), (360, 780, 'mobile')]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
        pg = ctx.new_page()
        errors, reqs = [], []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'cloudflareinsights' not in m.text and 'Failed to load resource' not in m.text else None)
        pg.on('request', lambda r: reqs.append(r.url))
        state = {'available': False, 'report': (200, {'ok': True, 'status': 'accepted_for_delivery'}), 'posted': [], 'events': []}
        if not LIVE:
            pg.route('**/api/enrich', lambda r: r.fulfill(status=503, content_type='application/json', body=json.dumps({'ok': False, 'error': 'log_not_configured'})))
            pg.route('**/api/report-status', lambda r: r.fulfill(content_type='application/json', body=json.dumps({'ok': True, 'available': state['available'], 'siteKey': '0x4AAAAAAATESTKEY000' if state['available'] else None})))
            def rep(route):
                state['posted'].append(json.loads(route.request.post_data))
                st, body = state['report']; route.fulfill(status=st, content_type='application/json', body=json.dumps(body))
            pg.route('**/api/report-request', rep)
            pg.route('**/api/event', lambda r: (state['events'].append(r.request.post_data or ''), r.fulfill(status=204)))
            pg.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(content_type='application/javascript', body=TURNSTILE_STUB))

        # ---- Cost Lab (P0 regression) ----
        pg.goto(BASE + '/?nocache=' + str(time.time())); pg.wait_for_function("document.querySelectorAll('#state option').length>1", timeout=20000)
        check(pg.locator('#state option').count() == 51, f'{name}: 51 states')
        check(pg.locator('label[for=state]').inner_text().startswith('HQ / Main Worksite State') and pg.locator('#labForm select').count() == 2, f'{name}: single geo selector')
        check(pg.locator('#currentTotal').inner_text() == '$346,665' and pg.locator('#delta').inner_text() == '+$48,000', f'{name}: default totals (2026 data: MD, 25 EEs, office) {pg.locator("#currentTotal").inner_text()}')
        check(pg.locator('h1').count() == 1, f'{name}: one h1 on home')
        check(not any('apollo' in u for u in reqs), f'{name}: no apollo')
        check(no_overflow(pg), f'{name}: home overflow')
        pg.fill('#employees', '10'); check(pg.locator('#delta').inner_text() == '+$19,200', f'{name}: live recalc')
        # ---- 2026 sourced defaults ----
        pg.fill('#employees', '25')
        check(pg.input_value('#salary') == '128976' and pg.locator('#salaryHint a[href="https://www.bls.gov/cew/"]').count() == 1, f'{name}: MD office wage = BLS QCEW 2025 with source link')
        check(pg.input_value('#health') == '6042' and pg.input_value('#enrollment') == '55.2' and 'MEPS-IC' in pg.locator('#healthHint').inner_text(), f'{name}: MD <50 health/enrollment = MEPS-IC')
        check(pg.input_value('#suta') == '2.6' and pg.locator('#sutaHint a').count() == 1 and pg.locator('#wcBasis').inner_text().lower() == 'estimate', f'{name}: SUTA sourced, WC labeled estimate')
        pg.fill('#employees', '60')
        check(pg.input_value('#health') == '6868' and pg.input_value('#enrollment') == '56.7', f'{name}: 50+ band rebases health/enrollment')
        pg.select_option('#industry', 'construction_trades')
        check(pg.input_value('#salary') == '86149', f'{name}: industry change rebases wage')
        pg.select_option('#state', 'OH')
        check(pg.input_value('#suta') == '5.85' and 'construction' in pg.locator('#sutaHint').inner_text().lower(), f'{name}: OH construction new-employer SUTA incl. 0.15% fee')
        pg.fill('#salary', '70000'); pg.select_option('#state', 'VA')
        check(pg.input_value('#salary') == '70000' and pg.locator('[data-restore="salary"]').is_visible() and pg.locator('#salaryBasis').inner_text().lower() == 'your input', f'{name}: edited wage survives state change, Restore offered')
        pg.click('[data-restore="salary"]'); check(pg.input_value('#salary') == '82626', f'{name}: restore VA construction wage')
        pg.select_option('#state', 'CA'); pg.select_option('#industry', 'clerical_professional')
        check('estimate' in pg.locator('#resultRows tr:nth-child(2)').inner_text().lower() and pg.input_value('#suta') == '3.5', f'{name}: CA FUTA estimate tag, SUTA incl. ETT')
        pg.select_option('#state', 'MD'); pg.fill('#employees', '10')
        check(pg.locator('#emailReport').is_disabled(), f'{name}: report button disabled by default')
        note = pg.locator('#emailNote').inner_text()
        check('being connected' in note and 'Nothing is sent' in note, f'{name}: honest unconfigured note: {note}')
        check(not any('challenges.cloudflare.com' in u for u in reqs), f'{name}: Turnstile not loaded when unconfigured')
        check(pg.locator('a[href="/compare"]').count() >= 1 and pg.locator('a[href="/data-library"]').count() >= 1 and pg.locator('a[href$=".html"]').count() == 0, f'{name}: tool links, no .html redirects')

        if not LIVE:
            # configured path: fake public key + server says available + stubbed Turnstile
            state['available'] = True
            pg.goto(BASE + '/?cfg=1'); pg.wait_for_function("document.querySelectorAll('#state option').length>1")
            pg.wait_for_selector('#tsStub', timeout=10000)
            check(pg.locator('#emailReport').is_disabled(), f'{name}: disabled before verification')
            check('survey' in pg.locator('#emailNote').inner_text(), f'{name}: survey disclosure shown when live')
            pg.click('#tsStub'); check(pg.locator('#emailReport').is_enabled(), f'{name}: enabled after verification')
            pg.fill('#businessEmail', 'me@gmail.com'); pg.click('#emailReport')
            check('Personal email' in pg.locator('#emailNote').inner_text() and not state['posted'], f'{name}: personal email blocked client-side')
            pg.fill('#businessEmail', 'cfo@acme.com'); pg.fill('#employees', '30'); pg.click('#emailReport')
            pg.wait_for_function("document.getElementById('emailNote').textContent.includes('Accepted for delivery')")
            sent = state['posted'][-1]
            check(sent['email'] == 'cfo@acme.com' and sent['snapshot']['employees'] == 30 and sent['snapshot']['state'] == 'MD' and len(sent['requestId']) == 36 and sent['turnstileToken'], f'{name}: report payload')
            check('delivered' not in pg.locator('#emailNote').inner_text().lower(), f'{name}: never claims delivered')
            check(pg.locator('#emailReport').is_disabled(), f'{name}: re-disabled after send (single-use token)')
            state['report'] = (502, {'ok': False, 'error': 'email_unavailable'})
            pg.click('#tsStub'); pg.click('#emailReport')
            pg.wait_for_function("document.getElementById('emailNote').textContent.includes('Nothing was sent')")
            check(True, 'failure message')
            check(no_overflow(pg), f'{name}: overflow with widget')

        # ---- state deep link ----
        pg.goto(BASE + '/?state=VA#cost-lab'); pg.wait_for_function("document.querySelectorAll('#state option').length>1")
        check(pg.input_value('#state') == 'VA', f'{name}: ?state=VA preselects')
        pg.goto(BASE + '/states/md.html')
        st_txt = pg.locator('main').inner_text()
        check(pg.locator('h1').count() == 1 and pg.locator('a[href="/?state=MD#cost-lab"]').count() == 1, f'{name}: state page h1 + deep link')
        check('$8,500' in st_txt and '2.6%' in st_txt and '$128,976' in st_txt and pg.locator('link[rel=canonical]').get_attribute('href') == 'https://peonomics.com/states/md', f'{name}: state page 2026 data + extensionless canonical')
        check(no_overflow(pg), f'{name}: state page overflow')
        pg.goto(BASE + '/states/index.html'); check(pg.locator('h1').count() == 1 and pg.locator('tbody tr').count() == 51, f'{name}: state index h1 + 51 rows')

        # ---- Quote Comparator ----
        pg.goto(BASE + '/compare.html'); pg.wait_for_selector('.compare-card')
        check(pg.locator('.compare-card').count() == 3 and pg.locator('h1').count() == 1, f'{name}: comparator cards/h1')
        check('Incomplete' in pg.locator('#compareRows').inner_text(), f'{name}: blank = Incomplete')
        for L, fee in [('A', '150'), ('B', '160')]:
            for k, v in {'fee': fee, 'setup': '500', 'suta': '2.6', 'wc': '0.3675', 'health': '7580', 'epli': '1.07', 'other': '0'}.items():
                pg.fill(f'#{L}-{k}', v)
        rows = pg.locator('#compareRows').inner_text()
        check('$45,000' in rows and '$48,000' in rows and 'Incomplete' in rows, f'{name}: comparator math A=$45,000 B=$48,000, C incomplete')
        check('2 complete proposals' in pg.locator('#comparisonStatus').inner_text() and 'Proposal A' in pg.locator('#comparisonStatus').inner_text(), f'{name}: lowest named')
        pg.fill('#B-other', ''); check('Incomplete' in pg.locator('#compareRows tr:nth-child(1) td:nth-child(3)').inner_text(), f'{name}: clearing a field -> Incomplete, not $0')
        pg.fill('#B-other', '0')
        with pg.expect_download() as d: pg.click('#downloadCompare')
        csv = open(d.value.path()).read()
        check('Three-year total' in csv and 'INCOMPLETE' in csv, f'{name}: comparator CSV')
        check(no_overflow(pg), f'{name}: compare overflow')

        # ---- Data Library ----
        pg.goto(BASE + '/data-library.html'); pg.wait_for_function("document.querySelectorAll('#stateRows tr').length>40")
        check(pg.locator('#stateRows tr').count() == 51, f'{name}: 51 data rows')
        check('v2026.1' in pg.locator('#dataVintage').inner_text() and pg.locator('#sourceList li').count() >= 7, f'{name}: 2026 dataset label + sources')
        md_row = pg.locator('#stateRows tr', has_text='Maryland').inner_text()
        check('$8,500' in md_row and '2.6%' in md_row and '$6,042 / $6,868' in md_row, f'{name}: MD row {md_row}')
        check(pg.locator('#wageRows tr').count() == 51, f'{name}: wage table rows')
        pg.fill('#filterStates', 'MD'); check(pg.locator('#stateRows tr').count() == 1, f'{name}: filter')
        pg.wait_for_function("document.querySelectorAll('#benchRows tr').length>=8")
        bench = pg.locator('#benchRows').inner_text()
        check('$184,500' in bench and '$9,804' in bench and '$28,303' in bench and '$8,132' in bench, f'{name}: 2026 benchmarks rendered from JSON')
        with pg.expect_download() as d: pg.click('#dataCsv')
        csvt = open(d.value.path()).read()
        check('2026.1' in csvt and 'Employer single health <50 EEs 2025' in csvt, f'{name}: data CSV')
        check(no_overflow(pg), f'{name}: data overflow')

        # ---- Privacy draft ----
        pg.goto(BASE + '/privacy.html')
        check(pg.locator('h1').count() == 1 and 'noindex' in (pg.locator('meta[name=robots]').get_attribute('content') or ''), f'{name}: privacy draft noindex')
        check('Draft' in pg.locator('main').inner_text(), f'{name}: privacy labeled draft')

        if not LIVE:
            names = [json.loads(e)['name'] for e in state['events'] if e]
            check('calc_used' in names and 'comparator_used' in names and 'data_csv' in names and 'report_requested' in names, f'{name}: product events sent {sorted(set(names))}')
            check(not any('@' in e or 'acme' in e.lower() or '71250' in e for e in state['events']), f'{name}: no personal data in events')
        check(not errors, f'{name}: console/page errors {errors[:3]}')
        if os.environ.get('SCREENSHOT_DIR'):
            for path in ['/', '/compare.html', '/data-library.html']:
                pg.goto(BASE + path); pg.wait_for_timeout(600)
                pg.screenshot(path=os.environ['SCREENSHOT_DIR'] + f'/{name}_{path.strip("/").replace(".html","") or "home"}.png', full_page=True)
        ctx.close()
    b.close()
if server: server.terminate()
print(f'browser: {passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
