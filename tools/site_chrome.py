"""Shared site chrome (nav + footer) — the single definition used by the generators
and by tools/unify_pages.py. Matches index.html's `.nav` / `.footer` markup.

Usage: nav(active='/states/')  ->  HTML string;  footer()  ->  HTML string.
"""

NAV_LINKS = [
    ('/compare', 'Compare quotes'),
    ('/data-library', 'Data library'),
    ('/states/', 'State rates'),
    ('/peo-pricing-explained', 'Pricing, explained'),
]


def nav(active=''):
    active_attr = ' class="is-active"'
    items = '\n'.join(
        '      <li><a href="%s"%s>%s</a></li>' % (href, active_attr if href == active else '', label)
        for href, label in NAV_LINKS)
    return f"""<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">PEO<span class="accent">nomics</span></a>
    <ul class="nav-links">
{items}
      <li><a href="/#cost-lab" class="nav-cta">Open the Cost Lab</a></li>
    </ul>
  </div>
</nav>"""


FOOTER = """<footer class="footer">
  <div><span class="footer-brand">PEO<span class="accent">nomics</span></span><br>Free, independent PEO cost comparison. Estimates are not quotes or advice.</div>
  <div>
    <a href="/#cost-lab">Cost Lab</a>
    <a href="/compare">Compare quotes</a>
    <a href="/data-library">Data library</a>
    <a href="/states/">State rates</a>
    <a href="/dmv-employer-cost-index">DMV cost index</a>
    <a href="/peo-pricing-explained">Pricing, explained</a>
    <a href="/hidden-costs">Hidden costs</a>
    <a href="/insights">Guides &amp; rankings</a>
    <a href="/methodology">Methodology &amp; disclosures</a>
    <a href="/about">About</a>
    <a href="/privacy">Privacy (draft)</a>
    <a href="https://github.com/jcs3-com/PEOnomicsV2">Dataset on GitHub</a>
  </div>
  <p class="footer-disclosure">The Cost Lab, Quote Comparator and Data Library assume no PEO savings, favor no provider, and send nothing to any PEO.</p>
</footer>"""

# 2026-10-28: owner decision — no paid or referral relationship with any PEO, so the referral
# disclosure was removed site-wide. Only the owner may change factual claims about the business.


def footer():
    return FOOTER
