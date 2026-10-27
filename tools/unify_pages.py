#!/usr/bin/env python3
"""Bring every hand-authored page onto the shared chrome and the data-first design.

For each root page (quote.html redirect stub excluded):
  * nav    -> tools/site_chrome.nav(active)
  * footer -> tools/site_chrome.footer() + the referral disclosure (DISCLOSURE)
  * dark gradient "quote teaser" blocks and per-page lead-capture forms (all
    pages except /contact) -> one standard Cost Lab panel (CTA_SECTION)
  * quote-funnel wording ("Get a Quote", "Build my quote", "quote builder") ->
    the Cost Lab, which is free, email-optional and sends nothing to any PEO
Idempotent. Run from the repo root:  python3 tools/unify_pages.py
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from site_chrome import nav, footer  # noqa: E402

CTA_SECTION = """<section>
    <div class="container">
      <div class="cta-panel">
        <div>
          <h2>Put your own numbers next to this.</h2>
          <p>The Cost Lab itemizes employer cost &mdash; payroll taxes, unemployment insurance, workers&rsquo; comp, health, admin and the PEO fee &mdash; from sourced 2026 reference data you can edit line by line. Free, no email required, nothing sent to any PEO.</p>
        </div>
        <div class="cta-actions">
          <a href="/#cost-lab" class="btn-go">Open the Cost Lab &rarr;</a>
          <a href="/compare" class="cta-link">Compare PEO quotes</a>
          <a href="/contact" class="cta-link">Ask a question</a>
        </div>
      </div>
    </div>
  </section>"""

ACTIVE = {'compare.html': '/compare', 'data-library.html': '/data-library',
          'peo-pricing-explained.html': '/peo-pricing-explained'}

TEXT = [
    ('Get a Quote →', 'Open the Cost Lab →'),
    ('Get a Quote', 'Open the Cost Lab'),
    ('Build my quote', 'Open the Cost Lab'),
    ('The quote builder is the fastest way to get a structured cost analysis.',
     'The Cost Lab is the fastest way to see a structured, editable cost comparison.'),
    ('<h3>Quote builder</h3>', '<h3>Cost Lab</h3>'),
    ('If you want numbers before the conversation, start here. We model your cost across five components and reply with a structured breakdown.',
     'If you want numbers before the conversation, start here: itemized employer cost, standalone vs. PEO, every assumption editable. It runs in your browser and sends nothing to any PEO.'),
    ('The quote builder is the fastest if you want numbers before a conversation.',
     'The Cost Lab is the fastest if you want numbers before a conversation.'),
    ('the quote tool will model your numbers directly.', 'the Cost Lab models your own numbers.'),
    ('Run a quote', 'Open the Cost Lab'),
    ("For a full breakdown — including healthcare, WC, SUI, and 401(k) — use the <a href=\"/#cost-lab\">quote builder</a>.",
     "For a full breakdown — payroll taxes, SUTA, workers' comp, health and admin, from sourced 2026 reference data — use the <a href=\"/#cost-lab\">Cost Lab</a>."),
]

ABOUT_WHO_OLD = re.compile(r'<h2>Who reads us\.</h2>\s*<p>.*?</p>', re.S)
ABOUT_WHO_NEW = ('<h2>Who it&rsquo;s for.</h2>\n        <p>Anyone weighing what it costs to employ people with or without a PEO: '
                 'owners running the numbers for the first time, teams checking a renewal, anyone who wants the arithmetic '
                 'laid out before a sales conversation. Every tool on the site is free and works without an email.</p>')


def unify(path):
    name = os.path.basename(path)
    s = open(path, encoding='utf-8').read()
    orig = s
    s = re.sub(r'<nav class="nav">.*?</nav>', lambda m: nav(ACTIVE.get(name, '')), s, count=1, flags=re.S)
    s = re.sub(r'<footer class="footer">.*?</footer>', lambda m: footer(), s, count=1, flags=re.S)
    # funnel sections -> one Cost Lab panel
    placed = 'class="cta-panel"' in s

    def repl(m):
        nonlocal placed
        block = m.group(0)
        funnel = 'radial-gradient' in block or ('formspree.io' in block and name != 'contact.html')
        if not funnel:
            return block
        if placed:
            return ''
        placed = True
        return CTA_SECTION
    s = re.sub(r'<section>(?:(?!<section).)*?</section>', repl, s, flags=re.S)
    for a, b in TEXT:
        s = s.replace(a, b)
    if '/assets/js/track.js' not in s:
        s = s.replace('</body>', '<script src="/assets/js/track.js" defer></script>\n</body>', 1)
    if name == 'about.html':
        s = ABOUT_WHO_OLD.sub(ABOUT_WHO_NEW, s)
    if s != orig:
        open(path, 'w', encoding='utf-8').write(s)
        return True
    return False


if __name__ == '__main__':
    pages = [p for p in sorted(glob.glob(os.path.join(ROOT, '*.html'))) if os.path.basename(p) != 'quote.html']
    changed = [os.path.basename(p) for p in pages if unify(p)]
    print('unified', len(changed), 'pages:', ', '.join(changed))
