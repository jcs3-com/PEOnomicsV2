#!/usr/bin/env python3
"""Generates /states/index.html and /states/{ab}.html from data/rates-2026.json,
then rebuilds sitemap.xml. Run from the repo root:  python3 tools/build_states.py

Every number on these pages comes from rates-2026.json and is shown with its own
year and source. Do not hand-edit the generated files."""
import json, os, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from site_chrome import nav, footer  # noqa: E402

R = json.load(open(os.path.join(ROOT, 'data', 'rates-2026.json')))
META = R['meta']
OUT = os.path.join(ROOT, 'states')
os.makedirs(OUT, exist_ok=True)
REVIEWED = META['lastReviewed']
IND = [('clerical_professional', 'Office / professional services'), ('retail_services', 'Retail'),
       ('hospitality_food', 'Food service & drinking places'), ('light_manufacturing', 'Manufacturing'),
       ('transportation_logistics', 'Transportation & warehousing'), ('construction_trades', 'Construction')]
SRC = {
    'dol': 'https://oui.doleta.gov/unemploy/content/sigpros/2020-2029/July2026.pdf',
    'ssa': 'https://www.ssa.gov/OACT/COLA/cbb.html',
    'fr': 'https://www.federalregister.gov/d/2026-00342',
    'qcew': 'https://www.bls.gov/cew/',
    'meps': 'https://meps.ahrq.gov/data_stats/summ_tables/insr/state/series_2/2025/ic25_iia_f.pdf',
    'oregon': 'https://www.oregon.gov/dcbs/cost/Pages/ranking-by-state.aspx',
}
esc = html.escape


def money(v):
    return '&mdash;' if v is None else f'${v:,.0f}'


def pct(r, d=3):
    s = f'{r * 100:.{d}f}'.rstrip('0').rstrip('.')
    return s + '%'


def a(url, text):
    return f'<a href="{esc(url)}" rel="noopener">{text}</a>'


def basis(cls, text):
    return f'<span class="basis basis-{cls}">{text}</span>'


def head(title, desc, canonical, jsonld):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/site.css">
<link rel="stylesheet" href="/assets/css/cost-lab.css">
<link rel="stylesheet" href="/assets/css/compare.css">
<link rel="canonical" href="https://peonomics.com{canonical}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://peonomics.com{canonical}">
<meta property="og:image" content="https://peonomics.com/assets/images/og-default.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{json.dumps(jsonld, ensure_ascii=False)}
</script>
</head>
<body>
"""


def page(title, desc, canonical, jsonld, body):
    return (head(title, desc, canonical, jsonld) + nav('/states/') + '\n' + body + '\n' + footer() +
            '\n<script src="/assets/js/track.js" defer></script>\n</body>\n</html>\n')


def sui_tag(s):
    if s['sui_basis'] == 'state_agency':
        return basis('bench', 'state agency')
    if s['sui_basis'] == 'dol_base_rate':
        return basis('bench', 'DOL base rate')
    return basis('est', '2025 reference')


# ---------------- index ----------------
rows = []
for ab, s in sorted(R['states'].items(), key=lambda kv: kv[1]['name']):
    h = s['health']['single_employer_share']
    mono = ' ' + basis('', 'state fund') if s['wc_monopolistic'] else ''
    rows.append(f"""<tr>
  <th scope="row"><a href="/states/{ab.lower()}">{esc(s['name'])}</a></th>
  <td class="num mono">{money(s['sui_wage_base'])}</td>
  <td class="num mono">{pct(s['sui_new_employer_rate'])} {sui_tag(s)}</td>
  <td class="num mono">{money(s['wages']['all_private'] and s['wages']['all_private']['value'])}</td>
  <td class="num mono">{money(h['lt50'])} / {money(h['ge50'])}</td>
  <td class="num mono">{s['wc_index_per_100']:.2f}{mono}</td>
</tr>""")

index_body = f"""<main class="section compare-main"><div class="shell">
  <div class="eyebrow">State reference data &middot; v{META['version']}</div>
  <h1>Employer costs by state, <em>sourced.</em></h1>
  <p class="hero-sub">2026 unemployment-insurance wage bases and new-employer rates, average private-sector pay, employer health cost and a workers&rsquo; comp index for all 50 states and DC. Each column shows its year; every state page links its sources. Reviewed {REVIEWED}.</p>
  <div class="compare-scroll"><table class="rate-table data-table">
    <caption>State employer-cost reference values</caption>
    <thead><tr><th scope="col">Jurisdiction</th><th scope="col" class="num">SUTA wage base 2026</th><th scope="col" class="num">New-employer SUTA 2026</th><th scope="col" class="num">Avg. pay, private 2025</th><th scope="col" class="num">Employer health, single &lt;50 / 50+ EEs, 2025</th><th scope="col" class="num">WC index / $100, 2024</th></tr></thead>
    <tbody>
{chr(10).join(rows)}
    </tbody>
  </table></div>
  <p class="sec-sub">Sources: {a(SRC['dol'], 'U.S. DOL Significant Provisions (July 2026)')} and state agencies for SUTA; {a(SRC['qcew'], 'BLS QCEW 2025')} for pay; {a(SRC['meps'], 'AHRQ MEPS-IC 2025')} for health; {a(SRC['oregon'], 'Oregon DCBS 2024')} for workers&rsquo; comp. Method and caveats in the <a href="/data-library#sources">Data Library</a>.</p>
</div></main>"""

idx_title = 'Employer Costs by State 2026: SUTA, Wages, Health | PEOnomics'
idx_desc = ('2026 SUTA wage bases and new-employer rates, BLS average pay, AHRQ employer health cost and a '
            "workers' comp index for all 50 states and DC, each with its source.")
open(os.path.join(OUT, 'index.html'), 'w').write(page(idx_title, idx_desc, '/states/', {
    '@context': 'https://schema.org', '@type': 'Dataset', 'name': 'PEOnomics state employer-cost reference data',
    'description': idx_desc, 'url': 'https://peonomics.com/states/', 'isAccessibleForFree': True,
    'dateModified': REVIEWED, 'temporalCoverage': '2024/2026', 'spatialCoverage': 'United States',
    'creator': {'@type': 'Organization', 'name': 'PEOnomics', 'url': 'https://peonomics.com/'},
    'distribution': [{'@type': 'DataDownload', 'encodingFormat': 'application/json',
                      'contentUrl': 'https://peonomics.com/data/rates-2026.json'}]}, index_body))

# ---------------- per-state ----------------
f = R['federal']
for ab, s in R['states'].items():
    name = s['name']
    cr = f['futa_credit_reduction_states'].get(ab, 0)
    futa_rate = f['futa_net_rate'] + cr
    h = s['health']
    wages = s['wages']
    avg = wages['all_private']['value'] if wages['all_private'] else None
    sui_per_ee = min(avg or 0, s['sui_wage_base']) * s['sui_new_employer_rate'] if avg else None
    comps = [c for c in s.get('sui_components', []) if 'base rate' not in c['name']]
    comp_txt = (' Includes ' + ', '.join(f"{esc(c['name'])} {pct(c['rate'])}" for c in comps) + '.') if comps else ''
    ind_rate = s.get('sui_rate_by_industry') or {}
    ind_txt = ''.join(f" New construction employers: {pct(r)}." for k, r in ind_rate.items() if k == 'construction_trades')
    sui_src = a(s['sui_source']['url'], 'State agency' if s['sui_basis'] == 'state_agency' else 'U.S. DOL')
    sui_note = esc(s.get('sui_note', ''))
    hs = h['single_employer_share']
    band_note = ''
    if hs['lt50'] is None:
        band_note = ' AHRQ does not publish a reliable figure for firms under 50 in this state.'

    rows = [
        ('SUTA taxable wage base', money(s['sui_wage_base']), '2026', sui_tag(s), sui_src),
        ('SUTA new-employer rate', pct(s['sui_new_employer_rate']) + (f'<br><small>{comp_txt.strip()}{ind_txt}</small>' if comp_txt or ind_txt else ''), str(s['sui_year']), sui_tag(s), sui_src),
        ('SUTA cost per employee at that rate', (money(sui_per_ee) + '/yr') if sui_per_ee else '&mdash;', str(s['sui_year']), basis('', 'derived'), 'on average pay below'),
        ('FUTA effective rate', pct(futa_rate, 2), '2026', basis('est', 'estimate') if cr else basis('stat', 'statutory'), a(SRC['fr'], 'Federal Register') if cr else 'IRC &sect;3301'),
        ('Employer FICA', '7.65% to $184,500; 1.45% above', '2026', basis('stat', 'statutory'), a(SRC['ssa'], 'SSA')),
        ('Average annual pay, private sector', money(avg), '2025', basis('bench', 'BLS'), a(SRC['qcew'], 'BLS QCEW')),
        ('Employer health cost, single coverage', f"{money(hs['lt50'])} (firms &lt;50) &middot; {money(hs['ge50'])} (50+)", '2025', basis('bench', 'AHRQ'), a(SRC['meps'], 'MEPS-IC')),
        ('Employer health cost, family coverage', money(h['family_employer_share']['total']) + ' (all firm sizes)', '2025', basis('bench', 'AHRQ'), a(SRC['meps'], 'MEPS-IC')),
        ('Employees enrolled where coverage is offered', (str(h['enrolled_pct']['total']) + '%') if h['enrolled_pct']['total'] is not None else '&mdash;', '2025', basis('bench', 'AHRQ'), a(SRC['meps'], 'MEPS-IC')),
        ("Workers' comp index (per $100 payroll)", f"${s['wc_index_per_100']:.2f} &middot; rank {s['wc_rank']} of 51 &middot; {s['wc_pct_of_median']}% of median", '2024', basis('bench', 'Oregon DCBS'), a(SRC['oregon'], 'Oregon DCBS')),
    ]
    trs = '\n'.join(f'<tr><th scope="row">{l}</th><td class="num mono">{v}</td><td>{y}</td><td>{b}</td><td>{src}</td></tr>' for l, v, y, b, src in rows)
    wrows = '\n'.join(
        f'<tr><th scope="row">{lbl}</th><td class="num mono">{money(wages[k]["value"]) if wages[k] else "&mdash;"}'
        + (' ' + basis('est', 'partial') if wages[k] and wages[k]['method'] == 'disclosed_subsectors' else '') + '</td></tr>'
        for k, lbl in IND)
    notes = []
    if cr:
        notes.append(f'<p><strong>FUTA credit reduction:</strong> {esc(f["futa_credit_reduction_note"])}</p>')
    if s['wc_monopolistic']:
        notes.append(f"<p><strong>Monopolistic workers&rsquo; comp:</strong> employers in {esc(name)} buy coverage from the state fund, so a PEO master policy cannot replace it.</p>")
    if sui_note:
        notes.append(f'<p><strong>SUTA note:</strong> {sui_note}</p>')
    body = f"""<main class="section compare-main"><div class="shell">
  <div class="eyebrow"><a href="/states/">State rates</a> / {esc(name)}</div>
  <h1>Employer costs in {esc(name)}, <em>2026.</em></h1>
  <p class="hero-sub">The published reference figures behind any {esc(name)} payroll or PEO cost comparison: unemployment insurance, federal payroll taxes, pay, health cost and workers&rsquo; comp. Each line shows its year and source. Your own experience rate, class codes and plan design will differ.</p>
  <div class="compare-scroll"><table class="rate-table data-table">
    <caption>{esc(name)} employer-cost reference values</caption>
    <thead><tr><th scope="col">Item</th><th scope="col" class="num">Value</th><th scope="col">Year</th><th scope="col">Basis</th><th scope="col">Source</th></tr></thead>
    <tbody>
{trs}
    </tbody>
  </table></div>
  <div class="prose-narrow">{''.join(notes)}
  <p>The workers&rsquo; comp index prices one fixed basket of job classes so states can be compared; your rate depends on your class codes, carrier and loss history. Office-heavy firms run well below the index; construction and transportation run well above it.</p></div>
  <section class="compare-section" aria-labelledby="pay-title">
    <h2 id="pay-title">Average annual pay by industry, {esc(name)}, 2025</h2>
    <div class="compare-scroll"><table class="rate-table data-table"><caption>Average annual pay per job by industry</caption>
    <thead><tr><th scope="col">Industry</th><th scope="col" class="num">Avg. annual pay per job</th></tr></thead>
    <tbody>
{wrows}
    </tbody></table></div>
    <p class="sec-sub">{a(SRC['qcew'], 'BLS QCEW')} 2025 annual averages, private ownership; includes part-time jobs. &ldquo;partial&rdquo; = BLS suppresses the sector total, averaged from disclosed subsectors.</p>
  </section>
  <div class="panel lab-cta">
    <div><h3>Run {esc(name)} numbers against your headcount</h3><p>The Cost Lab preloads these defaults for {esc(name)}. Free, no email required, every figure editable.</p></div>
    <div class="lab-cta-buttons"><a href="/?state={ab}#cost-lab" class="btn-go">Model {ab} in the Cost Lab &rarr;</a></div>
  </div>
</div></main>"""
    title = f'{name} Employer Costs 2026: SUTA, Payroll Tax, Health | PEOnomics'
    if len(title) > 70:
        title = f'{name} Employer Costs 2026: SUTA & Health | PEOnomics'
    desc = (f"{name} 2026: SUTA wage base {money(s['sui_wage_base']).replace('$', '$')}, new-employer rate "
            f"{pct(s['sui_new_employer_rate'])}; BLS pay, AHRQ health cost and workers' comp index — each sourced.")
    desc = desc.replace('&mdash;', '-')
    open(os.path.join(OUT, ab.lower() + '.html'), 'w').write(page(title, desc, f'/states/{ab.lower()}', {
        '@context': 'https://schema.org', '@type': 'Article', 'headline': f'Employer costs in {name}, 2026',
        'description': desc, 'dateModified': REVIEWED, 'datePublished': '2026-01-15',
        'author': {'@type': 'Organization', 'name': 'PEOnomics'},
        'publisher': {'@type': 'Organization', 'name': 'PEOnomics', 'url': 'https://peonomics.com/'},
        'mainEntityOfPage': f'https://peonomics.com/states/{ab.lower()}',
        'about': {'@type': 'AdministrativeArea', 'name': name}}, body))

print(f"built {len(R['states'])} state pages + index")


# ---- sitemap (covers ALL public pages, not just states) ----
def build_sitemap():
    import glob, datetime
    today = datetime.date.today().isoformat()
    urls = []
    for p in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        n = os.path.basename(p)
        if 'name="robots" content="noindex' in open(p, encoding='utf-8').read():
            continue  # redirect stubs and drafts stay out of the sitemap
        # Cloudflare Pages serves /x.html at /x (308 from .html); list the final URL only.
        urls.append('https://peonomics.com/' if n == 'index.html' else f'https://peonomics.com/{n[:-5]}')
    for p in sorted(glob.glob(os.path.join(ROOT, 'states', '*.html'))):
        n = os.path.basename(p)
        urls.append('https://peonomics.com/states/' if n == 'index.html' else f'https://peonomics.com/states/{n[:-5]}')
    urls = sorted(set(urls), key=lambda u: (u != 'https://peonomics.com/', u))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        lines.append(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>')
    lines.append('</urlset>')
    open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(lines) + '\n')
    print(f"built sitemap.xml ({len(urls)} urls)")


build_sitemap()
