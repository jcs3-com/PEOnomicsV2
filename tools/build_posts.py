#!/usr/bin/env python3
"""Builds the auto-post schedule for the LinkedIn feed.

    python3 tools/build_posts.py            # schedule + card images
    python3 tools/build_posts.py --no-cards # schedule only (no Pillow needed)

Reads data/posts/series.json (hand-authored templates) and resolves every figure from the
data files it names (rates-2026.json, dmv-index-2026.json, benchmarks-2026.json). Writes:
  data/post-schedule.json        every rendered post with its go-live time (GENERATED)
  assets/images/posts/<id>.png   a 1200x627 card per post, colors read from tokens.css (GENERATED)
/api/feed (functions/api/feed.js) serves the posts whose go-live time has passed as RSS.

Rules enforced here (and re-checked independently by tests/test_posts.py):
  - no number is typed into a template: figures come from refs into the data files
  - a low-confidence figure is refused unless the figure is flagged estimate and the post says so
  - a release renders only when its date is set (marked) and its 'requires' confidences are met
  - one post per day, weekdays only, every link points at an existing page
Do not hand-edit the generated files."""
import datetime as dt, html, json, os, re, struct, subprocess, sys, zlib
from email.utils import format_datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERIES = os.path.join(ROOT, 'data', 'posts', 'series.json')
OUT = os.path.join(ROOT, 'data', 'post-schedule.json')
CARDS = os.path.join(ROOT, 'assets', 'images', 'posts')
MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
MAX_TEXT = 1500  # LinkedIn allows 3,000; shorter posts read better


class BuildError(Exception):
    pass


def load(rel):
    return json.load(open(os.path.join(ROOT, rel), encoding='utf-8'))


def resolve(ref, data):
    """'rates:federal.fica_ss_wage_base', 'dmv:minimumWage.jurisdictions[key=va].hourly', 'x[0]'."""
    prefix, _, path = ref.partition(':')
    if prefix not in data:
        raise BuildError(f'unknown ref prefix in {ref}')
    node = data[prefix]
    for part in path.split('.'):
        m = re.fullmatch(r'([^\[\]]+)(?:\[(.+)\])?', part)
        if not m:
            raise BuildError(f'bad ref {ref}')
        key, sel = m.groups()
        if not isinstance(node, dict) or key not in node:
            raise BuildError(f'ref not found: {ref} (at {key})')
        node = node[key]
        if sel is not None:
            if sel.isdigit():
                node = node[int(sel)]
            else:
                k, _, v = sel.partition('=')
                hits = [x for x in node if isinstance(x, dict) and str(x.get(k)) == v]
                if len(hits) != 1:
                    raise BuildError(f'ref selector {sel} matched {len(hits)} items in {ref}')
                node = hits[0]
    return node


OPS = {'mul': lambda a, b: a * b, 'sub': lambda a, b: a - b, 'add': lambda a, b: a + b, 'min': min}


def figures(spec, data):
    """Returns {name: value} and the list of names flagged as estimates."""
    out, estimates = {}, []
    for name, f in spec.items():  # derived figures may only use names defined above them
        if isinstance(f, str):
            out[name] = resolve(f, data)
        elif 'op' in f:
            a, b = (out[x] for x in f['args'])
            out[name] = OPS[f['op']](a, b)
        else:
            out[name] = resolve(f['ref'], data)
            conf = resolve(f['conf'], data) if f.get('conf') else None
            if f.get('estimate'):
                estimates.append(name)
            elif conf == 'low':
                raise BuildError(f'{name} is low-confidence ({f["ref"]}); flag it estimate or improve the source')
        if out[name] is None:
            raise BuildError(f'{name} resolved to null')
    return out, estimates


def fmt_date(d):
    d = d if isinstance(d, dt.date) else dt.date.fromisoformat(str(d))
    return f'{MONTHS[d.month - 1]} {d.day}, {d.year}'


FORMATS = {
    'usd0': lambda v: '${:,.0f}'.format(round(v + 1e-9)),
    'usd2': lambda v: '${:,.2f}'.format(v + 1e-9),
    'pct1': lambda v: '{:.1f}%'.format(round(v * 100 + 1e-9, 1)),
    'pct2': lambda v: '{:.2f}%'.format(round(v * 100 + 1e-9, 2)),
    'int': lambda v: '{:,}'.format(int(v)),
    'date': fmt_date,
    'year': lambda v: str(v) if isinstance(v, int) else str(dt.date.fromisoformat(str(v)).year),
}


def render(tpl, figs, n=None):
    def sub(m):
        name, kind = m.group(1), m.group(2)
        if name == 'n':
            return '{:,}'.format(n)
        if name not in figs:
            raise BuildError(f'template uses unknown figure {{{name}}}')
        if kind is None:
            if not isinstance(figs[name], str) or re.search(r'\d', figs[name]):
                raise BuildError(f'{{{name}}} needs a format (only digit-free text figures may be used bare)')
            return figs[name]
        return FORMATS[kind](figs[name])
    out = re.sub(r'\{(\w+)(?::(\w+))?\}', sub, tpl)
    if re.search(r'[{}]', out):
        raise BuildError(f'unrendered braces in: {out[:80]}')
    return out


def page_exists(url):
    path = url.split('#')[0].split('?')[0].strip('/')
    if path == '':
        return os.path.exists(os.path.join(ROOT, 'index.html'))
    return os.path.exists(os.path.join(ROOT, path + '.html')) or os.path.exists(os.path.join(ROOT, path, 'index.html'))


def compose(meta, headline, body, s):
    site = meta['site']
    tags = ' '.join('#' + h for h in s.get('hashtags', []))
    parts = [headline, body, 'Source: ' + '; '.join(s['sources']),
             f'{s["cta"]}: {site}{s["url"]}', f'{meta["brand"]} · {meta["tagline"]}']
    if tags:
        parts.append(tags)
    return '\n\n'.join(parts)


def build(today=None):
    S = json.load(open(SERIES, encoding='utf-8'))
    meta = S['meta']
    data = {k: load(v) for k, v in meta['refs'].items()}
    tz = ZoneInfo(meta['timezone'])
    hh, mm = (int(x) for x in meta['postTime'].split(':'))
    items, dormant = [], []

    def add(item_id, series_id, kind, day, headline, body, s, figs, estimates, n, event, key=None):
        if day.weekday() >= 5:
            raise BuildError(f'{item_id} lands on a weekend ({day})')
        if not page_exists(s['url']):
            raise BuildError(f'{item_id} links to {s["url"]}, which is not a page in the repo')
        s = dict(s, cta=render(s['cta'], figs, n))
        text = compose(meta, headline, body, s)
        if estimates and 'estimate' not in body.lower():
            raise BuildError(f'{item_id} uses estimate figures {estimates} but never says "estimate"')
        if len(text) > MAX_TEXT:
            raise BuildError(f'{item_id} is {len(text)} characters (max {MAX_TEXT})')
        stats = [[render(a, figs, n), render(b, figs, n)] for a, b in s.get('stats', [])]
        live = dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz)
        items.append({
            'id': item_id, 'series': series_id, 'kind': kind, 'label': s['series'],
            'liveDate': day.isoformat(), 'liveAt': live.isoformat(), 'pubDate': format_datetime(live),
            'event': event.isoformat() if event else None, 'daysToEvent': n,
            'key': key, 'headline': headline, 'cardTitle': render(s['cardTitle'], figs, n), 'cardSub': render(s.get('cardSub', ''), figs, n), 'stats': stats,
            'estimates': [stats[i][0] for i, (a, b) in enumerate(s.get('stats', [])) if any('{' + e + ':' in b for e in estimates)],
            'text': text, 'url': meta['site'] + s['url'],
            'image': f'{meta["site"]}/assets/images/posts/{item_id}.png',
            'figures': {k: v for k, v in figs.items()},
        })

    for s in S['countdowns']:
        event = dt.date.fromisoformat(s['event'])
        figs, est = figures(s['figures'], data)
        variants = s.get('variants') or [{'body': s['body'], 'cta': s.get('cta'), 'url': s.get('url')}]
        for i, off in enumerate(sorted(s['offsets'])):
            day = event + dt.timedelta(days=off)
            if off < 0:
                while day.weekday() >= 5:  # weekend -> the Friday before
                    day -= dt.timedelta(days=1)
            n = (event - day).days
            key = 'before' if n > 0 else 'today' if n == 0 else 'after'
            if key not in s['headline']:
                raise BuildError(f'{s["id"]} offset {off} needs a "{key}" headline')
            v = variants[i % len(variants)]
            sv = dict(s, cta=v.get('cta') or s.get('cta'), url=v.get('url') or s.get('url'))
            add(f'{s["id"]}-{day.isoformat()}', s['id'], 'countdown', day,
                render(s['headline'][key], figs, n), render(v['body'], figs, n), sv, figs, est, n, event)

    for r in S['releases']:
        if not r.get('date'):
            dormant.append(r['id'])
            continue
        unmet = {k: resolve(k, data) for k, want in r.get('requires', {}).items() if resolve(k, data) != want}
        if unmet:
            raise BuildError(f'release {r["id"]} is marked but its data is not ready: {unmet}')
        figs, est = figures(r['figures'], data)
        day = dt.date.fromisoformat(r['date'])
        add(r['id'], r['id'], 'release', day, render(r['headline'], figs), render(r['body'], figs), r, figs, est, None, None)

    skipped = fill(S, data, items, add)

    items.sort(key=lambda x: x['liveAt'])
    days = [x['liveDate'] for x in items]
    dupes = sorted({d for d in days if days.count(d) > 1})
    if dupes:
        raise BuildError(f'more than one post on {dupes}; change an offset')
    return {
        'meta': {
            'generatedBy': 'tools/build_posts.py from data/posts/series.json',
            'dataVersions': {k: (data[k].get('meta') or data[k].get('metadata') or {}).get('lastReviewed') for k in data},
            'feedWindowDays': meta['feedWindowDays'],
            'channel': {'title': f'{meta["brand"]} · {meta["tagline"]}', 'link': meta['site'] + '/',
                        'description': 'Sourced payroll and employer-cost countdowns and data releases for DC, Maryland and Virginia employers.'},
            'dormantReleases': dormant,
            'rotationSkips': skipped,
        },
        'items': items,
    }


def bind(obj, key, labels=None):
    """Substitutes {key}, {k0}, {k1}, {keyLower} and {label} (labels[k1]) in a rotation's strings."""
    parts = key.split('/')
    subs = {'key': key, 'keyLower': parts[0].lower(), **{f'k{i}': p for i, p in enumerate(parts)}}
    if labels and len(parts) > 1:
        subs['label'] = labels[parts[1]]
    if isinstance(obj, str):
        return re.sub(r'\{(key|keyLower|label|k\d)\}', lambda m: subs.get(m.group(1), m.group(0)), obj)
    if isinstance(obj, list):
        return [bind(x, key, labels) for x in obj]
    if isinstance(obj, dict):
        return {k: bind(v, key, labels) for k, v in obj.items() if k != 'labels'}
    return obj


def rotation_keys(rot, data):
    if 'keys' in rot:
        return list(rot['keys'])
    pool = resolve(rot['keysFrom'], data)
    first = [k for k in rot.get('first', []) if k in pool]
    rest = [k for k in pool if k not in first]
    if rot.get('sortBy'):
        def val(k):
            node = pool[k]
            for p in rot['sortBy'].split('.'):
                node = node[p]
            return node
        rest.sort(key=lambda k: -val(k))
    return first + rest


def fill(S, data, items, add):
    """Tops every week up to cadence.perWeek using the rotations, on cadence.weekdays only.
    A rotation posts only between validFrom and validUntil (its data edition's shelf life) and
    skips any key whose figures are missing or flagged by its skipIf rules."""
    cad = S.get('cadence')
    if not cad:
        return {}
    skip_days = set(cad.get('skipDates', []))
    queues, skipped = [], {}
    for rot in S.get('rotations', []):
        q = []
        for key in rotation_keys(rot, data):
            r = bind(rot, key, rot.get('labels'))
            why = None
            for rule in r.get('skipIf', []):
                try:
                    v = resolve(rule['ref'], data)
                except (BuildError, TypeError):
                    why = 'data missing'
                    break
                if ('contains' in rule and rule['contains'] in (v or [])) or ('equals' in rule and v == rule['equals']):
                    why = rule.get('reason', 'skipIf')
            if not why:
                try:
                    figs, est = figures(r['figures'], data)
                except (BuildError, KeyError, TypeError) as e:
                    why = f'data missing: {e}'
            if why:
                skipped.setdefault(rot['id'], []).append(f'{key}: {why}')
                continue
            ov = rot.get('nameOverrides', {}).get(key.split('/')[0])
            if ov and 'name' in figs:
                figs['name'] = ov
            q.append((key, r, figs, est))
        queues.append((rot, q))
    taken = {it['liveDate'] for it in items}
    week = {}
    for it in items:
        y, w, _ = dt.date.fromisoformat(it['liveDate']).isocalendar()
        week[(y, w)] = week.get((y, w), 0) + 1
    day = dt.date.fromisoformat(cad['fillFrom'])
    end = max(dt.date.fromisoformat(r['validUntil']) for r, _ in queues)
    while day <= end:
        y, w, _ = day.isocalendar()
        iso = day.isoformat()
        if day.weekday() in cad['weekdays'] and iso not in skip_days and iso not in taken and week.get((y, w), 0) < cad['perWeek']:
            for rot, q in queues:
                if q and rot['validFrom'] <= iso <= rot['validUntil']:
                    key, r, figs, est = q.pop(0)
                    add(f'{rot["id"]}-{key.lower().replace("/", "-")}', rot['id'], 'note', day,
                        render(r['headline'], figs), render(r['body'], figs), r, figs, est, None, None, key)
                    taken.add(iso)
                    week[(y, w)] = week.get((y, w), 0) + 1
                    break
        day += dt.timedelta(days=1)
    return skipped


# ---------------------------------------------------------------- cards

def tokens():
    css = open(os.path.join(ROOT, 'assets', 'css', 'tokens.css'), encoding='utf-8').read()
    return {k: v for k, v in re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{6})', css)}


FONT_PKGS = {'@expo-google-fonts/newsreader': ['Newsreader_600SemiBold.ttf', 'Newsreader_500Medium.ttf'],
             '@expo-google-fonts/hanken-grotesk': ['HankenGrotesk_500Medium.ttf', 'HankenGrotesk_600SemiBold.ttf'],
             '@expo-google-fonts/ibm-plex-mono': ['IBMPlexMono_500Medium.ttf', 'IBMPlexMono_600SemiBold.ttf']}


def fonts():
    """The site's own faces (tokens.css). Fetched once from npm (OFL) into tools/.fonts/, gitignored."""
    cache = os.path.join(ROOT, 'tools', '.fonts')
    os.makedirs(cache, exist_ok=True)
    for pkg, files in FONT_PKGS.items():
        if all(os.path.exists(os.path.join(cache, f)) for f in files):
            continue
        tgz = subprocess.run(['npm', 'pack', pkg, '--silent'], cwd=cache, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
        members = [f'package/{f.split("_")[1][:-4]}/{f}' for f in files]
        subprocess.run(['tar', 'xzf', tgz, '--strip-components=2', '-C', cache, *members], cwd=cache, check=True)
        os.remove(os.path.join(cache, tgz))
    return {f.rsplit('.', 1)[0]: os.path.join(cache, f) for fs in FONT_PKGS.values() for f in fs}


def draw_cards(sched):
    from PIL import Image, ImageDraw, ImageFont
    T, F = tokens(), fonts()
    W, H = 1200, 627
    font = lambda name, size: ImageFont.truetype(F[name], size)
    os.makedirs(CARDS, exist_ok=True)

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

    for it in sched['items']:
        im = Image.new('RGB', (W, H), T['bg'])
        d = ImageDraw.Draw(im)
        # double engraved rule frame
        d.rectangle([24, 24, W - 25, H - 25], outline=T['border'], width=1)
        d.rectangle([30, 30, W - 31, H - 31], outline=T['text'], width=2)
        # ink footer band
        d.rectangle([30, H - 104, W - 31, H - 31], fill=T['ink'])
        d.text((72, H - 82), 'PEOnomics', font=font('Newsreader_600SemiBold', 34), fill=T['ink-text'])
        bw = d.textlength('PEOnomics', font=font('Newsreader_600SemiBold', 34))
        d.text((72 + bw + 16, H - 74), 'PEO cost intelligence', font=font('HankenGrotesk_500Medium', 22), fill=T['ink-muted'])
        site = 'peonomics.com'
        sf = font('IBMPlexMono_500Medium', 22)
        d.text((W - 72 - d.textlength(site, font=sf), H - 74), site, font=sf, fill=T['ink-muted'])
        # header line
        lab = f'{it["label"].upper()}'
        lf = font('IBMPlexMono_600SemiBold', 20)
        d.text((72, 62), lab, font=lf, fill=T['accent'])
        right = fmt_date(it['event']).upper() if it['event'] else ('DMV · ' if it['kind'] == 'note' and it.get('key', '')[:2] in ('DC', 'MD', 'VA') else '') + fmt_date(it['liveDate']).upper()
        d.text((W - 72 - d.textlength(right, font=lf), 62), right, font=lf, fill=T['muted'])
        d.line([72, 98, W - 72, 98], fill=T['border'], width=1)

        stats_top = 372
        if it['kind'] == 'countdown':
            n = it['daysToEvent']
            big = str(n) if n > 0 else ('TODAY' if n == 0 else 'IN EFFECT')
            bf = font('IBMPlexMono_600SemiBold', 176 if n > 0 else 74)
            d.text((66, 112 if n > 0 else 170), big, font=bf, fill=T['text'])
            if n > 0:
                d.text((76, 318), 'DAY' if n == 1 else 'DAYS', font=font('IBMPlexMono_500Medium', 24), fill=T['muted'])
            x0 = 72 + max(d.textlength(big, font=bf), 200) + 40
            d.line([x0, 124, x0, 340], fill=T['border'], width=1)
            tf = font('Newsreader_600SemiBold', 50)
            lines = wrap(d, it['cardTitle'], tf, W - 72 - x0 - 36)[:4]
            y = 232 - len(lines) * 30
            for ln in lines:
                d.text((x0 + 36, y), ln, font=tf, fill=T['text'])
                y += 60
        else:
            tf = font('Newsreader_600SemiBold', 64)
            y = 128
            for ln in wrap(d, it['cardTitle'], tf, W - 144)[:2]:
                d.text((72, y), ln, font=tf, fill=T['text'])
                y += 76
            sf2 = font('HankenGrotesk_500Medium', 26)
            y += 14
            for ln in wrap(d, it['cardSub'], sf2, W - 260)[:3] if it['cardSub'] else []:
                d.text((72, y), ln, font=sf2, fill=T['muted'])
                y += 36
        # stat ledger
        d.line([72, stats_top, W - 72, stats_top], fill=T['text'], width=2)
        stats = it['stats'][:3]
        cw = (W - 144) / max(len(stats), 1)
        for i, (label, value) in enumerate(stats):
            x = 72 + i * cw
            if i:
                d.line([x, stats_top + 18, x, stats_top + 122], fill=T['border'], width=1)
            pad = 0 if i == 0 else 24
            d.text((x + pad, stats_top + 22), label.upper(), font=font('HankenGrotesk_600SemiBold', 17), fill=T['muted'])
            est = label in it['estimates']
            d.text((x + pad, stats_top + 56), value, font=font('IBMPlexMono_600SemiBold', 44), fill=T['warm'] if est else T['accent'])
        im.save(os.path.join(CARDS, it['id'] + '.png'), optimize=True)
        it['imageBytes'] = os.path.getsize(os.path.join(CARDS, it['id'] + '.png'))


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


def main():
    try:
        sched = build()
    except BuildError as e:
        sys.exit(f'build_posts: {e}')
    if '--no-cards' in sys.argv:
        for it in sched['items']:
            p = os.path.join(CARDS, it['id'] + '.png')
            it['imageBytes'] = os.path.getsize(p) if os.path.exists(p) else 0
    else:
        draw_cards(sched)
    keep = {it['id'] + '.png' for it in sched['items']}
    if os.path.isdir(CARDS):
        for f in os.listdir(CARDS):
            if f.endswith('.png') and f not in keep:
                os.remove(os.path.join(CARDS, f))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(sched, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'{len(sched["items"])} posts, {len(sched["meta"]["dormantReleases"])} dormant releases -> data/post-schedule.json')
    for it in sched['items']:
        print(f'  {it["liveDate"]}  {it["headline"]}')


if __name__ == '__main__':
    main()
