"""Maryland FAMLI calculator: every static figure on /maryland-famli-calculator must equal a fresh
computation from data/dmv-index-2026.json. Run: python3 tests/test_famli.py
If FAMLI rules change, update data/dmv-index-2026.json, re-derive the page figures, and this test
lists every one that moved (hero, default results, salary table, FAQ, JSON-LD, og:description)."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, 'data', 'dmv-index-2026.json')))
page = open(os.path.join(ROOT, 'maryland-famli-calculator.html'), encoding='utf-8').read()
text = re.sub(r'\s+', ' ', page)
fails, passes = [], 0
def check(c, m):
    global passes
    if c: passes += 1
    else: fails.append(m); print('FAIL', m)

MD, BASE = D['paidLeave']['MD'], D['federal']['socialSecurityWageBase2027']['value']
usd0 = lambda n: '${:,.0f}'.format(round(n + 1e-9))
usd2 = lambda n: '${:,.2f}'.format(round(n + 1e-9, 2))
pct2 = lambda r: '{:.2f}%'.format(round(r * 100 + 1e-9, 2))
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
def long_date(iso):
    y, m, d = (int(x) for x in iso.split('-'))
    return f'{MONTHS[m - 1]} {d}, {y}'

# rules the page states in words
check(abs(MD['employerRate'] + MD['employeeRate'] - MD['totalRate']) < 1e-12, 'employer + employee = total rate')
for r in (MD['totalRate'], MD['employerRate'], MD['employeeRate']):
    check(pct2(r) in text, f'rate {pct2(r)} on page')
check(usd0(BASE) in text, f'wage cap {usd0(BASE)} on page')
check(f"{MD['smallEmployerThreshold']} or more employees" in text, 'threshold wording')
check(f"fewer than {MD['smallEmployerThreshold']} employees" in text, 'small-employer wording')
check(long_date(MD['contributionsBegin']) in text, 'contributions begin date')
check(long_date(MD['firstRemittanceDue']) in text, 'first payment due date')
check(long_date(MD['benefitsBegin']) in text, 'benefits date')
check(long_date(MD['privatePlanDeclarationDeadline']).replace('November', 'Nov') in text or
      'Nov 15, 2026' in text, 'private-plan declaration deadline')
check('{:.1f}%'.format(MD['maxTotalRate'] * 100) in text, 'statutory rate ceiling')
cap_er = MD['employerRate'] * BASE
check(text.count(usd2(cap_er)) >= 4, f'employer share at cap {usd2(cap_er)} (hero, table, FAQ, JSON-LD)')

# default scenario: 20 employees, all in Maryland, $60,000, employer covers none, biweekly
n, avg, periods = 20, 60000, 26
capped = n * min(avg, BASE)
er, ee = MD['employerRate'] * capped, MD['employeeRate'] * capped
defaults = {'famli-employer': usd0(er), 'famli-withheld': usd0(ee), 'famli-remitted': usd0(er + ee),
            'famli-quarter': usd0((er + ee) / 4), 'famli-per-ee': usd0(er / n), 'famli-paycheck': usd2(ee / n / periods)}
for el, v in defaults.items():
    check(f'id="{el}">{v}<' in page, f'default {el} = {v}')
for el, v in (('famli-total', n), ('famli-md', n), ('famli-avg', avg)):
    check(re.search(rf'id="{el}"[^>]*value="{v}"', page), f'default input {el} = {v}')

# salary table
rows = re.findall(r'<tr><th scope="row" class="mono">([^<]+)</th><td class="num mono">([^<]+)</td><td class="num mono">([^<]+)</td><td class="num mono">([^<]+)</td></tr>', page)
check(len(rows) >= 6, f'salary table has rows ({len(rows)})')
for w, a, b, t in rows:
    wage = float(re.sub(r'[^\d.]', '', w.split(' ')[0]))
    c = min(wage, BASE)
    check(a == usd2(MD['employerRate'] * c), f'table {w} employer {a}')
    check(b == usd2(MD['employeeRate'] * c), f'table {w} employee {b}')
    check(t == usd2(MD['totalRate'] * c), f'table {w} total {t}')
check(any(r[0].startswith(usd0(BASE)) for r in rows), 'table has a row at the cap')

# JSON-LD parses and the FAQ answers match the visible FAQ
ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
faq = [g for g in ld['@graph'] if g['@type'] == 'FAQPage'][0]['mainEntity']
for q in faq:
    check(f"<h3>{q['name']}</h3>" in page, f"FAQ question visible: {q['name']}")
    check(q['acceptedAnswer']['text'][:80] in text, f"FAQ answer visible: {q['name']}")
og = re.search(r'property="og:description" content="([^"]+)"', page).group(1)
check(pct2(MD['totalRate']) in og and usd2(cap_er) in og, 'og:description figures')
check(os.path.exists(os.path.join(ROOT, 'assets', 'images', 'og-famli.png')), 'og image exists')
check('https://paidleave.maryland.gov/employers/make-contributions/' in page, 'primary source cited')
print(f'famli: {passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
