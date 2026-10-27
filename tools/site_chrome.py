"""Shared site chrome (nav + footer) — the single definition used by the generators
and by tools/unify_pages.py. Matches index.html's `.nav` / `.footer` markup.

Usage: nav(active='/states/')  ->  HTML string;  footer()  ->  HTML string.
"""

NAV_LINKS = [
    ('/compare.html', 'Compare quotes'),
    ('/data-library.html', 'Data library'),
    ('/states/', 'State rates'),
    ('/peo-pricing-explained.html', 'Pricing, explained'),
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
    <a href="/compare.html">Compare quotes</a>
    <a href="/data-library.html">Data library</a>
    <a href="/states/">State rates</a>
    <a href="/peo-pricing-explained.html">Pricing, explained</a>
    <a href="/hidden-costs.html">Hidden costs</a>
    <a href="/methodology.html">Methodology &amp; disclosures</a>
    <a href="/about.html">About</a>
    <a href="/privacy.html">Privacy (draft)</a>
    <a href="https://github.com/jcs3-com/PEOnomicsV2">Dataset on GitHub</a>
  </div>
</footer>"""


def footer():
    return FOOTER
