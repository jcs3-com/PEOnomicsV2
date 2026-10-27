"""Data integrity for data/rates-2026.json. Run: python3 tests/test_data.py
- the committed file is exactly what tools/build_rates_2026.py produces from data/src/
- priority-state values equal the agency-verified file; others equal the DOL table
- every state figure has a source URL and a year; no invented fallbacks
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails, passes = [], 0
def check(cond, msg):
    global passes
    if cond: passes += 1
    else: fails.append(msg); print('FAIL', msg)

path = os.path.join(ROOT, 'data', 'rates-2026.json')
committed = open(path).read()
subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_rates_2026.py')], check=True, capture_output=True)
rebuilt = open(path).read()
check(committed == rebuilt, 'rates-2026.json matches a fresh build from data/src (run tools/build_rates_2026.py and commit)')

R = json.loads(rebuilt)
src = lambda n: json.load(open(os.path.join(ROOT, 'data', 'src', n)))
dol, ver, meps = src('dol-sigpros-2026-07.json'), src('state-ui-verified-2026.json'), src('meps-ic-2025-state.json')
check(len(R['states']) == 51, '51 jurisdictions')
check(R['federal']['fica_ss_wage_base'] == 184500, '2026 SS wage base')
check(R['meta']['tax_year'] == 2026, 'tax year 2026')

PRIORITY = ['DC', 'MD', 'VA', 'CA', 'TX', 'FL', 'NY', 'OH']
EXPECT = {'DC': (9000, 0.029), 'MD': (8500, 0.026), 'VA': (8000, 0.025), 'CA': (7000, 0.035),
          'TX': (9000, 0.027), 'FL': (7000, 0.027), 'NY': (17600, 0.041), 'OH': (9000, 0.0285)}
for c, (wb, rate) in EXPECT.items():
    s = R['states'][c]
    check(s['sui_wage_base'] == wb and abs(s['sui_new_employer_rate'] - rate) < 1e-9 and s['sui_basis'] == 'state_agency',
          f'{c} verified 2026 SUTA {s["sui_wage_base"]} {s["sui_new_employer_rate"]}')
    check(dol['states'][c]['wageBase'] == wb, f'{c} agency wage base agrees with DOL July 2026')
check(abs(R['states']['OH']['sui_rate_by_industry']['construction_trades'] - 0.0585) < 1e-9, 'OH construction 5.85%')

indavg = sorted(c for c, d in dol['states'].items() if d['newEmployerRatePct'] is None)
check(indavg == ['LA', 'MN', 'MT', 'NM', 'UT', 'WA', 'WY'], f'IndAvg states {indavg}')
for c, s in R['states'].items():
    d = dol['states'][c]
    check(s['sui_source']['url'].startswith('https://'), f'{c} SUTA source URL')
    check(s['sui_wage_base'] == (ver['states'][c]['wageBase'] if c in ver['states'] else d['wageBase']), f'{c} wage base provenance')
    if c not in PRIORITY and d['newEmployerRatePct'] is not None:
        check(abs(s['sui_new_employer_rate'] * 100 - d['newEmployerRatePct']) < 1e-9 and s['sui_year'] == 2026, f'{c} = DOL base rate')
    if c in indavg:
        check(s['sui_year'] == 2025 and s['sui_confidence'] == 'low', f'{c} industry-average fallback labeled 2025 / low')
    sp, se = meps['tables']['singlePremium'][c], meps['tables']['singleEmployee'][c]
    for band in ('total', 'lt50', 'ge50'):
        v = s['health']['single_employer_share'][band]
        if v is not None:
            check(v == sp[band] - se[band] and band not in sp['unreliable'] + se['unreliable'], f'{c} {band} health share derivation')
    check(s['health']['single_employer_share']['ge50'] is not None, f'{c} health 50+ available')
    check(0.3 <= s['wc_index_per_100'] <= 3.0 and s['wc_year'] == 2024, f'{c} WC index range/year')
    check(s['wages']['all_private'] and 30000 < s['wages']['all_private']['value'] < 200000, f'{c} all-private pay plausible')
print(f'data: {passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
