#!/usr/bin/env python3
"""Per-page Open Graph cards (1200x630) in the site's palette and faces, same look as the
auto-post cards. Figures are read from the data files, never typed here.

    python3 tools/build_og.py      # writes assets/images/og-<slug>.png for each page in PAGES

Needs Pillow; fonts come from tools/build_posts.fonts() (npm, cached in tools/.fonts/).
Pages without a card here keep assets/images/og-default.png."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from build_posts import tokens, fonts, fmt_date  # noqa: E402

D = json.load(open(os.path.join(ROOT, 'data', 'dmv-index-2026.json'), encoding='utf-8'))
MD = D['paidLeave']['MD']
BASE27 = D['federal']['socialSecurityWageBase2027']['value']


def pct2(r):
    return f'{r * 100:.2f}%'


def usd2(v):
    return f'${v:,.2f}'


PAGES = [{
    'slug': 'famli',
    'page': 'maryland-famli-calculator.html',
    'label': 'CALCULATOR',
    'right': 'MARYLAND · ' + MD['contributionsBegin'][:4],
    'title': 'What Maryland FAMLI costs your payroll',
    'sub': f'Contributions begin {fmt_date(MD["contributionsBegin"])}. Employer share, withholding and the quarterly payment.',
    'stats': [('Total rate', pct2(MD['totalRate'])),
              ('Employer, at the cap', usd2(MD['employerRate'] * BASE27)),
              ('First payment due', fmt_date(MD['firstRemittanceDue']).replace(', 2027', ''))],
}]


def draw(p):
    from PIL import Image, ImageDraw, ImageFont
    T, F = tokens(), fonts()
    W, H = 1200, 630
    font = lambda name, size: ImageFont.truetype(F[name], size)

    def wrap(d, text, f, width):
        lines, cur = [], ''
        for w in text.split():
            t = (cur + ' ' + w).strip()
            if d.textlength(t, font=f) <= width:
                cur = t
            else:
                lines.append(cur)
                cur = w
        return lines + [cur]

    im = Image.new('RGB', (W, H), T['bg'])
    d = ImageDraw.Draw(im)
    d.rectangle([24, 24, W - 25, H - 25], outline=T['border'], width=1)
    d.rectangle([30, 30, W - 31, H - 31], outline=T['text'], width=2)
    d.rectangle([30, H - 104, W - 31, H - 31], fill=T['ink'])
    d.text((72, H - 82), 'PEOnomics', font=font('Newsreader_600SemiBold', 34), fill=T['ink-text'])
    bw = d.textlength('PEOnomics', font=font('Newsreader_600SemiBold', 34))
    d.text((72 + bw + 16, H - 74), 'PEO cost intelligence', font=font('HankenGrotesk_500Medium', 22), fill=T['ink-muted'])
    sf = font('IBMPlexMono_500Medium', 22)
    site = 'peonomics.com'
    d.text((W - 72 - d.textlength(site, font=sf), H - 74), site, font=sf, fill=T['ink-muted'])
    lf = font('IBMPlexMono_600SemiBold', 20)
    d.text((72, 62), p['label'], font=lf, fill=T['accent'])
    d.text((W - 72 - d.textlength(p['right'], font=lf), 62), p['right'], font=lf, fill=T['muted'])
    d.line([72, 98, W - 72, 98], fill=T['border'], width=1)
    tf = font('Newsreader_600SemiBold', 62)
    y = 124
    for ln in wrap(d, p['title'], tf, W - 144)[:2]:
        d.text((72, y), ln, font=tf, fill=T['text'])
        y += 74
    sf2 = font('HankenGrotesk_500Medium', 25)
    y += 10
    for ln in wrap(d, p['sub'], sf2, W - 144)[:2]:
        d.text((72, y), ln, font=sf2, fill=T['muted'])
        y += 34
    top = 374
    d.line([72, top, W - 72, top], fill=T['text'], width=2)
    cw = (W - 144) / len(p['stats'])
    for i, (label, value) in enumerate(p['stats']):
        x = 72 + i * cw
        if i:
            d.line([x, top + 18, x, top + 122], fill=T['border'], width=1)
        pad = 0 if i == 0 else 24
        d.text((x + pad, top + 22), label.upper(), font=font('HankenGrotesk_600SemiBold', 17), fill=T['muted'])
        d.text((x + pad, top + 56), value, font=font('IBMPlexMono_600SemiBold', 44), fill=T['accent'])
    out = os.path.join(ROOT, 'assets', 'images', f'og-{p["slug"]}.png')
    im.save(out, optimize=True)
    return out


if __name__ == '__main__':
    for p in PAGES:
        print('built', os.path.relpath(draw(p), ROOT))
