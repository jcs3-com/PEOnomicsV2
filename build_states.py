#!/usr/bin/env python3
"""Generates /states/index.html and /states/{ab}.html from data/rates-2025.json.
Run from repo root: python3 tools/build_states.py"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, 'data', 'rates-2025.json')))
OUT = os.path.join(ROOT, 'states')
os.makedirs(OUT, exist_ok=True)

CONF = {'high': 'verified', 'med': 'likely', 'low': 'estimate'}

def shell(title, desc, body, canonical):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://peonomics.com{canonical}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/site.css">
</head>
<body>
<nav class="nav"><div class="nav-inner">
  <a href="/" class="nav-logo">PEO<span class="accent">nomics</span></a>
  <ul class="nav-links">
    <li><a href="/peo-pricing-explained.html">Pricing, explained</a></li>
    <li><a href="/states/" class="is-active">State rates</a></li>
    <li><a href="/methodology.html">Methodology</a></li>
    <li><a href="/quote.html" class="nav-cta">Run a quote</a></li>
  </ul>
</div></nav>
{body}
<footer class="footer">
  <div><span class="nav-logo" style="font-size:17px;">PEO<span class="accent">nomics</span></span><br>PEO cost intelligence.</div>
  <div><a href="/states/">State rates</a><a href="/methodology.html">Methodology</a><a href="https://github.com/jcs3-com/PEOnomicsV2">Dataset on GitHub</a></div>
</footer>
</body>
</html>"""

# ---- index ----
rows = ""
for ab, s in sorted(R['states'].items(), key=lambda kv: kv[1]['name']):
    mono = ' &middot; monopolistic WC' if s['wc_monopolistic'] else ''
    rows += f"""<tr>
  <td><a href="/states/{ab.lower()}.html" style="font-weight:600;text-decoration:none;">{s['name']}</a></td>
  <td class="num mono">${s['sui_wage_base']:,}</td>
  <td class="num mono">{s['sui_new_employer_rate']*100:.2f}%</td>
  <td class="num mono">${s['wc_index_per_100']:.2f}</td>
  <td><span class="conf {s['sui_confidence']}">{CONF[s['sui_confidence']]}</span>{mono}</td>
</tr>\n"""

index_body = f"""<section class="section"><div class="shell">
  <div class="sec-eyebrow">2025 rate dataset &middot; v{R['meta']['version']}</div>
  <h2>Employer rates, all 51 jurisdictions.</h2>
  <p class="sec-sub">The same dataset that powers the quote engine. SUI new-employer rates and wage bases, plus a workers' comp index per $100 of payroll. Rates marked <em>estimate</em> are pending primary-source verification — corrections welcome via GitHub.</p>
  <table class="rate-table">
    <thead><tr><th>Jurisdiction</th><th style="text-align:right">SUI wage base</th><th style="text-align:right">SUI new-employer</th><th style="text-align:right">WC index /$100</th><th>Data status</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div></section>"""

open(os.path.join(OUT, 'index.html'), 'w').write(shell(
    "PEO Cost Rates by State (2025) | PEOnomics",
    "2025 SUI wage bases, new-employer rates, and workers' comp index for all 50 states and DC — the dataset behind the PEOnomics quote engine.",
    index_body, "/states/"))

# ---- per-state pages ----
f = R['federal']
for ab, s in R['states'].items():
    cr = f['futa_credit_reduction_states'].get(ab, 0)
    futa_rate = (f['futa_net_rate'] + cr) * 100
    cr_line = (f'<p style="color:var(--negative);font-size:14px;"><strong>{s["name"]} is a FUTA credit-reduction state:</strong> the effective federal unemployment rate is {futa_rate:.1f}% instead of the standard 0.6%.</p>' if cr else '')
    mono_line = (f'<p style="font-size:14px;color:var(--muted);"><strong>Note:</strong> {s["name"]} runs a monopolistic state workers\' comp fund — coverage is purchased from the state, and PEO master policies work differently here than in open-market states.</p>' if s['wc_monopolistic'] else '')
    sui_max = min(65000, s['sui_wage_base'])
    sui_per_ee = sui_max * s['sui_new_employer_rate']
    body = f"""<section class="section"><div class="shell" style="max-width:var(--w-prose);">
  <div class="sec-eyebrow"><a href="/states/" style="text-decoration:none;color:var(--accent);">State rates</a> / {s['name']}</div>
  <h2>What employers pay in {s['name']}.</h2>
  <p class="sec-sub">The 2025 statutory rates that drive employer costs — and any PEO quote — in {s['name']}.</p>

  <table class="rate-table">
    <tr><td>SUI wage base</td><td class="num mono">${s['sui_wage_base']:,}</td><td><span class="conf {s['sui_confidence']}">{CONF[s['sui_confidence']]}</span></td></tr>
    <tr><td>SUI new-employer rate</td><td class="num mono">{s['sui_new_employer_rate']*100:.2f}%</td><td><span class="conf {s['sui_confidence']}">{CONF[s['sui_confidence']]}</span></td></tr>
    <tr><td>SUI cost per employee (at new-employer rate)</td><td class="num mono">${sui_per_ee:,.0f}/yr</td><td></td></tr>
    <tr><td>FUTA effective rate</td><td class="num mono">{futa_rate:.1f}%</td><td><span class="conf high">verified</span></td></tr>
    <tr><td>Workers' comp index (per $100 payroll)</td><td class="num mono">${s['wc_index_per_100']:.2f}</td><td><span class="conf {s['wc_confidence']}">{CONF[s['wc_confidence']]}</span></td></tr>
    <tr><td>FICA (federal, all states)</td><td class="num mono">7.65%</td><td><span class="conf high">verified</span></td></tr>
  </table>
  {cr_line}
  {mono_line}
  <p style="font-size:14px;color:var(--muted);">The workers' comp index is a payroll-weighted average — your actual rate depends on class-code mix. Office-heavy firms run well below the index; construction and transportation run well above it.</p>
  <div style="margin-top:36px;border:1px solid var(--text);background:var(--bg-elev);padding:24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
    <div><strong>Run these rates against your headcount.</strong><br><span style="color:var(--muted);font-size:14px;">Itemized estimate, standalone vs PEO, in thirty seconds.</span></div>
    <a href="/quote.html" class="btn-go" style="text-decoration:none;">Run a {ab} quote &rarr;</a>
  </div>
</div></section>"""
    open(os.path.join(OUT, ab.lower() + '.html'), 'w').write(shell(
        f"PEO Costs in {s['name']} (2025 Rates) | PEOnomics",
        f"2025 {s['name']} employer rates: SUI wage base ${s['sui_wage_base']:,}, new-employer rate {s['sui_new_employer_rate']*100:.2f}%, workers' comp index, and FUTA — the inputs behind any PEO quote.",
        body, f"/states/{ab.lower()}.html"))

print(f"built {len(R['states'])} state pages + index")


# ---- sitemap (covers ALL public pages, not just states) ----
def build_sitemap():
    import glob, datetime
    today = datetime.date.today().isoformat()
    urls = []
    for p in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        n = os.path.basename(p)
        urls.append('https://peonomics.com/' if n == 'index.html' else f'https://peonomics.com/{n}')
    for p in sorted(glob.glob(os.path.join(ROOT, 'states', '*.html'))):
        n = os.path.basename(p)
        urls.append('https://peonomics.com/states/' if n == 'index.html' else f'https://peonomics.com/states/{n}')
    urls = sorted(set(urls), key=lambda u: (u != 'https://peonomics.com/', u))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        lines.append(f'  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>')
    lines.append('</urlset>')
    open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(lines) + '\n')
    print(f"built sitemap.xml ({len(urls)} urls)")


build_sitemap()
