#!/usr/bin/env python3
"""Build data/rates-2026.json from the sourced inputs in data/src/.

Every figure in the output traces to a file in data/src/ (which records its
source URL and review date) or to data/rates-2025.json for the few fields that
have no 2026 primary source yet — those carry an explicit year and a
low-confidence flag. Nothing is invented here; this script only selects,
labels and reshapes.

    python3 tools/build_rates_2026.py      # writes data/rates-2026.json
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'src'
REVIEWED = '2026-10-27'

def load(name):
    return json.loads((SRC / name).read_text())

dol = load('dol-sigpros-2026-07.json')
ver = load('state-ui-verified-2026.json')
orwc = load('oregon-wc-index-2024.json')
qcew = load('qcew-2025-annual.json')
meps = load('meps-ic-2025-state.json')
old = json.loads((ROOT / 'data' / 'rates-2025.json').read_text())

NAME_TO_CODE = {s['name']: c for c, s in old['states'].items()}
wc_by_code = {}
for row in orwc['rows']:
    code = NAME_TO_CODE.get(row['state'])
    if not code:
        raise SystemExit('Unmapped Oregon WC state: ' + row['state'])
    wc_by_code[code] = row
assert len(wc_by_code) == 51, len(wc_by_code)

INDUSTRIES = ['clerical_professional', 'retail_services', 'hospitality_food',
              'light_manufacturing', 'transportation_logistics', 'construction_trades']

def pct(x):
    return round(x / 100, 6)

def health_for(code):
    t = meps['tables']
    out = {}
    for key, table in (('single_premium', 'singlePremium'), ('single_employee', 'singleEmployee'),
                       ('family_premium', 'familyPremium'), ('family_employee', 'familyEmployee'),
                       ('enrolled_pct', 'enrolledPct')):
        row = t[table][code]
        out[key] = {k: row[k] for k in ('total', 'lt50', 'ge50')}
        out[key + '_unreliable'] = row['unreliable']
    share = {}
    for band in ('total', 'lt50', 'ge50'):
        p, c = out['single_premium'][band], out['single_employee'][band]
        bad = band in out['single_premium_unreliable'] or band in out['single_employee_unreliable']
        share[band] = None if (p is None or c is None or bad) else p - c
    out['single_employer_share'] = share
    fshare = {}
    for band in ('total', 'lt50', 'ge50'):
        p, c = out['family_premium'][band], out['family_employee'][band]
        bad = band in out['family_premium_unreliable'] or band in out['family_employee_unreliable']
        fshare[band] = None if (p is None or c is None or bad) else p - c
    out['family_employer_share'] = fshare
    return out

states = {}
for code, prev in sorted(old['states'].items()):
    d = dol['states'][code]
    v = ver['states'].get(code)
    st = {'name': prev['name']}
    if v:
        surcharge = sum(s['ratePct'] for s in v['surcharges'])
        st['sui_wage_base'] = v['wageBase']
        st['sui_new_employer_rate'] = pct(v['baseRatePct'] + surcharge)
        st['sui_components'] = [{'name': 'New-employer base rate', 'rate': pct(v['baseRatePct'])}] + \
            [{'name': s['name'], 'rate': pct(s['ratePct']), 'sourceUrl': s['sourceUrl']} for s in v['surcharges']]
        if v.get('industryBaseRatePct'):
            st['sui_rate_by_industry'] = {k: pct(r + surcharge) for k, r in v['industryBaseRatePct'].items()}
        st['sui_confidence'] = v['confidence']
        st['sui_year'] = 2026
        st['sui_basis'] = 'state_agency'
        st['sui_note'] = v['note']
        st['sui_source'] = {'name': v['sourceName'], 'url': v['sourceUrl'], 'effective': v['effective'],
                            'lastReviewed': ver['lastReviewed']}
    else:
        st['sui_wage_base'] = d['wageBase']
        src = {'name': dol['source']['name'], 'url': dol['source']['url'],
               'effective': dol['source']['effective'], 'lastReviewed': dol['source']['lastReviewed']}
        if d['newEmployerRatePct'] is not None:
            st['sui_new_employer_rate'] = pct(d['newEmployerRatePct'])
            st['sui_components'] = [{'name': 'New-employer base rate', 'rate': pct(d['newEmployerRatePct'])}]
            st['sui_confidence'] = 'med'
            st['sui_year'] = 2026
            st['sui_basis'] = 'dol_base_rate'
            st['sui_note'] = ('U.S. DOL base new-employer rate; state surcharges or assessments, if any, are not included.' +
                              (' Rate year runs July–June.' if '8' in d['footnotes'] else ''))
        else:
            # DOL publishes "industry average" for these states — no single 2026 number exists.
            st['sui_new_employer_rate'] = prev['sui_new_employer_rate']
            st['sui_components'] = [{'name': 'New-employer rate (2025 reference value)', 'rate': prev['sui_new_employer_rate']}]
            st['sui_confidence'] = 'low'
            st['sui_year'] = 2025
            st['sui_basis'] = 'industry_average_state'
            st['sui_note'] = ('New employers pay their industry\'s average rate (DOL: IndAvg), so no single 2026 rate exists. '
                              'The default is the 2025 reference value — replace it with the rate on your notice.')
        st['sui_source'] = src
    st['sui_min_rate'] = pct(d['minRatePct'])
    st['sui_max_rate'] = pct(d['maxRatePct'])

    w = wc_by_code[code]
    st['wc_index_per_100'] = w['index']
    st['wc_rank'] = w['rank']
    st['wc_pct_of_median'] = w['pctMedian']
    st['wc_rates_effective'] = w['effective']
    st['wc_confidence'] = 'med'
    st['wc_year'] = 2024
    st['wc_monopolistic'] = prev.get('wc_monopolistic', False)

    st['wages'] = {k: qcew['states'][code].get(k) for k in ['all_private'] + INDUSTRIES}
    st['health'] = health_for(code)
    states[code] = st

us = health_for('US')
out = {
    'meta': {
        'dataset': 'PEOnomics employer-burden reference data',
        'tax_year': 2026,
        'version': '2026.1',
        'lastReviewed': REVIEWED,
        'status': ('2026 statutory and unemployment-insurance figures from primary government sources; '
                   'wages (BLS QCEW 2025), health (AHRQ MEPS-IC 2025) and workers\' comp index (Oregon DCBS 2024) '
                   'are the latest published editions, labeled with their own years. Fields without a 2026 '
                   'primary source say so and carry a low-confidence flag.'),
        'sources': [
            {'name': 'Social Security Administration — Contribution and benefit base', 'url': 'https://www.ssa.gov/OACT/COLA/cbb.html'},
            {'name': 'Federal Register 2026-00342 — FUTA credit reductions applicable for 2025', 'url': 'https://www.federalregister.gov/d/2026-00342'},
            {'name': dol['source']['name'], 'url': dol['source']['url']},
            {'name': 'State workforce agencies (DC, MD, VA, CA, TX, FL, NY, OH) — see each state\'s sui_source', 'url': 'https://peonomics.com/data-library'},
            {'name': orwc['source']['name'], 'url': orwc['source']['url']},
            {'name': qcew['source']['name'], 'url': qcew['source']['url']},
            {'name': meps['source']['name'], 'url': meps['source']['url']}
        ],
        'derivedFrom': 'tools/build_rates_2026.py over data/src/*.json'
    },
    'federal': {
        'fica_ss_rate': 0.062,
        'fica_ss_wage_base': 184500,
        'fica_medicare_rate': 0.0145,
        'futa_gross_rate': 0.06,
        'futa_net_rate': 0.006,
        'futa_wage_base': 7000,
        'futa_credit_reduction_states': {'CA': 0.015},
        'futa_credit_reduction_note': ('California: 1.2% applied for 2025 (Federal Register 2026-00342). For 2026 the statutory '
                                       'schedule adds 0.3 points (1.5%) if the state still owes Title XII advances on '
                                       'Nov. 10, 2026; DOL finalizes after that date. Estimate until then.'),
        'futa_credit_reduction_confidence': {'CA': 'low'},
        'confidence': 'high',
        'provenance': {
            'fica_ss_wage_base': {'value': 184500, 'year': 2026, 'sourceUrl': 'https://www.ssa.gov/OACT/COLA/cbb.html', 'lastReviewed': REVIEWED},
            'fica_rates': {'note': 'Statutory: 6.2% Social Security (26 U.S.C. 3111(a)), 1.45% Medicare (3111(b)). Employer pays no Additional Medicare Tax.'},
            'futa': {'note': 'Statutory: 6.0% on the first $7,000 (26 U.S.C. 3301, 3306(b)(1)) less the maximum 5.4% state credit = 0.6% net.'}
        }
    },
    'health': {
        'employer_annual_single_avg': us['single_employer_share']['total'],
        'source': 'AHRQ MEPS-IC 2025, United States, private sector: average single premium minus average employee contribution (Tables II.C.1, II.C.2).',
        'sourceUrl': meps['source']['url'],
        'year': 2025,
        'us': us,
        'confidence': 'high'
    },
    'peo_admin': {**old['peo_admin'], 'year': 2025},
    'wc_industry_multipliers': {**old['wc_industry_multipliers'],
                                'note': ('PEOnomics estimate (not a published source): approximate class-mix exposure relative to the '
                                         'Oregon index basket. Use your class-code rate or quote whenever you have it.')},
    'hr_admin_burden': old['hr_admin_burden'],
    'states': states
}

dest = ROOT / 'data' / 'rates-2026.json'
dest.write_text(json.dumps(out, separators=(',', ':')) + '\n')

# coverage report
def cnt(pred):
    return sum(1 for s in states.values() if pred(s))
print('wrote', dest.relative_to(ROOT))
print('SUI: state-verified', cnt(lambda s: s['sui_basis'] == 'state_agency'),
      '| DOL base', cnt(lambda s: s['sui_basis'] == 'dol_base_rate'),
      '| industry-average (2025 fallback)', cnt(lambda s: s['sui_basis'] == 'industry_average_state'))
print('Wages: cells with value', sum(1 for s in states.values() for k in INDUSTRIES if s['wages'][k]), '/', 51 * 6)
print('Health single employer share lt50 available', cnt(lambda s: s['health']['single_employer_share']['lt50'] is not None),
      '| ge50', cnt(lambda s: s['health']['single_employer_share']['ge50'] is not None))
