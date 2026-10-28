"""DMV Employer Cost Index: every static figure on /dmv-employer-cost-index must equal a fresh
computation from data/rates-2026.json + data/dmv-index-2026.json. Run: python3 tests/test_dmv_index.py
If a rate changes, update the source data, re-derive the page figures, and this test tells you which ones."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, 'data', 'rates-2026.json')))
D = json.load(open(os.path.join(ROOT, 'data', 'dmv-index-2026.json')))
page = open(os.path.join(ROOT, 'dmv-employer-cost-index.html'), encoding='utf-8').read()
text = re.sub(r'\s+', ' ', page)
fails, passes = [], 0
def check(c, m):
    global passes
    if c: passes += 1
    else: fails.append(m); print('FAIL', m)

f = R['federal']
def cost(st, w, year=2026, hc=20):
    base = D['federal']['socialSecurityWageBase2027']['value'] if year >= 2027 else f['fica_ss_wage_base']
    s, pl = R['states'][st], D['paidLeave']
    t = (f['fica_ss_rate'] * min(w, base) + f['fica_medicare_rate'] * w +
         f['futa_net_rate'] * min(w, f['futa_wage_base']) + s['sui_new_employer_rate'] * min(w, s['sui_wage_base']))
    if st == 'DC': t += pl['DC']['employerRate'] * w
    if st == 'MD' and year >= 2027 and hc >= pl['MD']['smallEmployerThreshold']: t += pl['MD']['employerRate'] * min(w, base)
    return t
usd0 = lambda n: '${:,.0f}'.format(round(n + 1e-9))
usd2 = lambda n: '${:,.2f}'.format(n)
pct = lambda n: '{:.2f}%'.format(round(n * 100 + 1e-9, 2))

# hero shares and calculator totals at $60,000
for st in ('DC', 'MD', 'VA'):
    c = cost(st, 60000)
    check(pct(c / 60000) in text, f'{st} share {pct(c / 60000)} on page')
    check(usd0(c) in text, f'{st} total {usd0(c)} on page')
check(pct(cost('MD', 60000, 2027) / 60000) in text, 'MD 2027 share on page')
for st in ('DC', 'MD', 'VA'):
    s = R['states'][st]
    check('{} {:.2f}% to ${:,}'.format(st, s['sui_new_employer_rate'] * 100, s['sui_wage_base']) in text, f'{st} SUI rate label')

# wage floor
H = D['metadata']['fullTimeHours']
floor = {}
for j in D['minimumWage']['jurisdictions']:
    w = j['hourly'] * H; t = cost(j['state'], w); floor[j['key']] = w + t
    row = f"<td class=\"num mono\">{usd2(j['hourly'])}</td><td class=\"num mono\">{usd0(w)}</td><td class=\"num mono\">{usd0(t)}</td><td class=\"num mono\">{usd0(w + t)}</td>"
    check(row in page, f"floor row {j['name']}")
gap = floor['dc'] - floor['va']
check(f"{usd0(floor['dc'])} a year in DC" in text and f"{usd0(floor['va'])} in Virginia" in text, 'headline figures')
check(f'{usd0(gap)} gap' in text, f'headline gap {usd0(gap)}')
check(usd0(floor['va']) in page.split('og:description')[1][:300], 'og:description figures')

# tipped
tip = {j['state']: j['hourly'] for j in D['tippedCashWage']['jurisdictions']}
for st, h in tip.items():
    check(usd2(h * H) in text, f'tipped {st} annual')
check('+' + usd2((tip['DC'] - tip['VA']) * H) in text, 'tipped DC over VA')
check(usd0((tip['DC'] - tip['VA']) * H * 30) in text, '30-person tipped gap')

# calculator note default
note = f"DC costs {usd0((cost('DC', 60000) - cost('VA', 60000)) * 20)} more than Virginia"
check(note in text, 'calculator default note')
print(f'dmv-index: {passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
