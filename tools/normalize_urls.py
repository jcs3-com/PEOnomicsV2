#!/usr/bin/env python3
"""Rewrite internal page URLs to the form Cloudflare Pages actually serves.

Pages answers /x.html with a 308 to /x, so canonical tags, og:url, JSON-LD,
sitemap entries and internal links that end in .html all point at redirects.
This rewrites, in every hand-authored page and front-end script:
  https://peonomics.com/x.html  -> https://peonomics.com/x      (index.html -> /)
  href="/x.html" / href="/x.html#y" -> href="/x" / href="/x#y"
External URLs (e.g. ssa.gov/.../cbb.html) are untouched. Idempotent.
Run: python3 tools/normalize_urls.py   (state pages are produced by build_states.py)
"""
import glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ABS = re.compile(r'https://peonomics\.com/((?:[a-z0-9-]+/)*)([a-z0-9-]+)\.html')
REL = re.compile(r'''(href=["'])/((?:[a-z0-9-]+/)*)([a-z0-9-]+)\.html(?=[#"'?])''')


def fix(text):
    text = ABS.sub(lambda m: 'https://peonomics.com/' + m.group(1) + ('' if m.group(2) == 'index' else m.group(2)), text)
    text = REL.sub(lambda m: m.group(1) + '/' + m.group(2) + ('' if m.group(3) == 'index' else m.group(3)), text)
    return text


files = glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'assets', 'js', '*.js'))
changed = 0
for p in files:
    src = open(p, encoding='utf-8').read()
    out = fix(src)
    if out != src:
        open(p, 'w', encoding='utf-8').write(out)
        changed += 1
print(f'normalized {changed} files')
