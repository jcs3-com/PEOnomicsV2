"""SEO ship-checklist (AI_GUIDE §4) on every indexable page in the checkout.
Run: python3 tests/test_seo.py"""
import glob, os, re, sys, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails, passes = [], 0
def check(c, m):
    global passes
    if c: passes += 1
    else: fails.append(m); print('FAIL', m)
sitemap = set(re.findall(r'<loc>([^<]+)</loc>', open(os.path.join(ROOT, 'sitemap.xml')).read()))
pages = glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'states', '*.html'))
for p in sorted(pages):
    rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
    s = open(p, encoding='utf-8').read()
    if 'name="robots" content="noindex' in s:
        check(not any(u.endswith(rel[:-5]) for u in sitemap), f'{rel}: noindex page not in sitemap'); continue
    url = 'https://peonomics.com/' + ('' if rel == 'index.html' else rel[:-5].replace('/index', '/') if rel.endswith('index.html') else rel[:-5])
    can = re.search(r'<link rel="canonical" href="([^"]+)"', s)
    check(can and can.group(1) == url, f'{rel}: canonical {can and can.group(1)} != {url}')
    check(url in sitemap, f'{rel}: in sitemap as {url}')
    check(len(re.findall(r'<h1[ >]', s)) == 1, f'{rel}: exactly one h1')
    check(bool(re.search(r'<meta name="description" content="[^"]{70,}"', s)), f'{rel}: meta description')
    for k in ('og:title', 'og:description', 'og:type', 'og:url', 'og:image'):
        check(f'property="{k}"' in s, f'{rel}: {k}')
    og = re.search(r'property="og:url" content="([^"]+)"', s)
    check(og and og.group(1) == url, f'{rel}: og:url matches canonical')
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S)
    check(bool(blocks), f'{rel}: JSON-LD present')
    for b in blocks:
        try: json.loads(b)
        except Exception: check(False, f'{rel}: JSON-LD parses')
    check(not re.search(r'href="/[a-z0-9/-]+\.html', s) and 'peonomics.com/' not in re.sub(r'https://peonomics\.com/[a-z0-9/#?=-]*', '', s).replace('peonomics.com/', '', 0), f'{rel}: no .html internal links')
    check('footer-disclosure' in s and 'XcelHR' in s, f'{rel}: referral disclosure in footer')
    check('/assets/js/track.js' in s, f'{rel}: event tracker loaded')
print(f'seo: {passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
