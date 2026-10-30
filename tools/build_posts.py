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
    'md': lambda v: fmt_date(v).rsplit(',', 1)[0],
    'wd': lambda v: dt.date.fromisoformat(str(v)).strftime('%A'),
    'year': lambda v: str(v) if isinstance(v, int) else str(dt.date.fromisoformat(str(v)).year),
}


# Countdowns run only on exact milestones (owner rule): the post goes out on the day the
# milestone is true, never "43 days". code -> (label used in copy, card number, card unit)
MILESTONES = {'60d': ('60 days', '60', 'DAYS'), '30d': ('30 days', '30', 'DAYS'),
              '1m': ('1 month', '1', 'MONTH'), '1w': ('1 week', '1', 'WEEK')}


def milestone_date(event, code):
    if code == '1m':
        y, m = (event.year, event.month - 1) if event.month > 1 else (event.year - 1, 12)
        try:
            return dt.date(y, m, event.day)
        except ValueError:
            raise BuildError(f'no "1 month" date before {event} (day {event.day} missing in month {m})')
    return event - dt.timedelta(days={'60d': 60, '30d': 30, '1w': 7}[code])


def render(tpl, figs, n=None, when=None):
    def sub(m):
        name, kind = m.group(1), m.group(2)
        if name == 'when':
            if when is None:
                raise BuildError('{when} is only for milestone countdown headlines')
            return when
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

    cad = S['cadence']
    no_post = set(cad['noPostDates'])

    def add(item_id, series_id, kind, day, headline, body, s, figs, estimates, n, event, key=None, milestone=None):
        if day.weekday() >= 5:
            raise BuildError(f'{item_id} lands on a weekend ({day})')
        if day.isoformat() in no_post:
            raise BuildError(f'{item_id} lands on a no-post day ({day})')
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
            'event': event.isoformat() if event else None, 'daysToEvent': n, 'milestone': milestone,
            'cardTag': render(s['cardTag'], figs) if s.get('cardTag') else None,
            'key': key, 'headline': headline, 'cardTitle': render(s['cardTitle'], figs, n), 'cardSub': render(s.get('cardSub', ''), figs, n), 'stats': stats,
            'estimates': [stats[i][0] for i, (a, b) in enumerate(s.get('stats', [])) if any('{' + e + ':' in b for e in estimates)],
            'text': text, 'url': meta['site'] + s['url'],
            'image': f'{meta["site"]}/assets/images/posts/{item_id}.png',
            'figures': {k: v for k, v in figs.items()},
        })

    for s in S['countdowns']:
        ev = s['event']
        event = dt.date.fromisoformat(resolve(ev, data) if ':' in ev else ev)
        figs, est = figures(s['figures'], data)
        figs['event'] = event.isoformat()
        if 'offsets' in s:
            raise BuildError(f'{s["id"]}: day offsets are retired; use milestones (60d, 30d, 1m, 1w) or dated posts')
        for code in s.get('milestones', []):
            if code not in MILESTONES:
                raise BuildError(f'{s["id"]}: unknown milestone {code}')
            day = milestone_date(event, code)
            label = MILESTONES[code][0]
            add(f'{s["id"]}-{day.isoformat()}', s['id'], 'countdown', day,
                render(s['headline']['countdown'], figs, when=label), render(s['body'], figs), s, figs, est,
                (event - day).days, event, milestone=code)
        for d in s.get('dated', []):
            day = dt.date.fromisoformat(d)
            n = (event - day).days
            key = 'upcoming' if n > 0 else 'today' if n == 0 else 'after'
            if key not in s['headline']:
                raise BuildError(f'{s["id"]} dated post {d} needs a "{key}" headline')
            body = s.get('bodyAfter', s['body']) if n < 0 else s['body']
            add(f'{s["id"]}-{day.isoformat()}', s['id'], 'dated', day,
                render(s['headline'][key], figs), render(body, figs), dict(s, series='Key date'), figs, est, n, event)

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

    for it in items:  # fixed posts must respect the weekly caps too
        wk = week_of(dt.date.fromisoformat(it['liveDate']))
        n_wk = sum(1 for x in items if week_of(dt.date.fromisoformat(x['liveDate'])) == wk)
        if n_wk > week_cap(cad, wk):
            raise BuildError(f'week of {wk} has {n_wk} fixed posts; cap is {week_cap(cad, wk)}')
    skipped, pulled = fill(S, data, items, add)

    items.sort(key=lambda x: x['liveAt'])
    days = [x['liveDate'] for x in items]
    dupes = sorted({d for d in days if days.count(d) > 1})
    if dupes:
        raise BuildError(f'more than one post on {dupes}; move one')
    gaps = find_gaps(cad, items)
    return {
        'meta': {
            'generatedBy': 'tools/build_posts.py from data/posts/series.json',
            'dataVersions': {k: (data[k].get('meta') or data[k].get('metadata') or {}).get('lastReviewed') for k in data},
            'feedWindowDays': meta['feedWindowDays'],
            'channel': {'title': f'{meta["brand"]} · {meta["tagline"]}', 'link': meta['site'] + '/',
                        'description': 'Sourced payroll and employer-cost countdowns and data releases for DC, Maryland and Virginia employers.'},
            'dormantReleases': dormant,
            'rotationSkips': skipped,
            'pulled': pulled,
            'gaps': gaps,
            'openSlots': sum(g['open'] for g in gaps),
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


def week_of(day):
    return (day - dt.timedelta(days=day.weekday())).isoformat()


def week_cap(cad, monday):
    m = dt.date.fromisoformat(monday)
    days = [(m + dt.timedelta(days=i)).isoformat() for i in range(7)]
    for q in cad.get('quietPeriods', []):
        if any(q['from'] <= d <= q['to'] for d in days):
            return q['perWeek']
    return cad['perWeek']


def open_days(cad, monday):
    """Weekdays in the week that may carry a post, in fill-preference order."""
    m = dt.date.fromisoformat(monday)
    order = cad['fillWeekdays'] + [d for d in range(5) if d not in cad['fillWeekdays']]
    out = []
    for wd in order:
        d = m + dt.timedelta(days=wd)
        if d.isoformat() not in cad['noPostDates']:
            out.append(d)
    return out


def find_gaps(cad, items):
    """Weeks from fillFrom to horizon with fewer posts than their cap (and an open day to put one on)."""
    taken = {it['liveDate'] for it in items}
    count = {}
    for it in items:
        wk = week_of(dt.date.fromisoformat(it['liveDate']))
        count[wk] = count.get(wk, 0) + 1
    gaps, mon = [], dt.date.fromisoformat(week_of(dt.date.fromisoformat(cad['fillFrom'])))
    while mon <= dt.date.fromisoformat(cad['horizon']):
        wk = mon.isoformat()
        free = [d for d in open_days(cad, wk) if d.isoformat() not in taken and d.isoformat() >= cad['fillFrom']]
        n_open = min(week_cap(cad, wk) - count.get(wk, 0), len(free))
        if n_open > 0:
            gaps.append({'week': wk, 'open': n_open, 'suggest': sorted(d.isoformat() for d in free[:n_open])})
        mon += dt.timedelta(days=7)
    return gaps


def fill(S, data, items, add):
    """Tops every week up to its cap (cadence.perWeek, or a quiet period's perWeek) from the rotations,
    taking them in turn so formats alternate. Days: cadence.fillWeekdays first, then other weekdays;
    never a no-post day. A rotation posts only between validFrom and validUntil (its data edition's
    shelf life); a key is skipped when its data is missing or flagged (skipIf) and pulled when the
    owner judged it weak (exclude / limit). Whatever cannot be filled is reported as a gap."""
    cad = S['cadence']
    queues, skipped, pulled = [], {}, {}
    for rot in S.get('rotations', []):
        q = []
        keys = rotation_keys(rot, data)
        for key in keys:
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
            if key in rot.get('exclude', {}):
                pulled.setdefault(rot['id'], []).append(f'{key}: {rot["exclude"][key]}')
                continue
            if rot.get('limit') and len(q) >= rot['limit']:
                pulled.setdefault(rot['id'], []).append(f'{key}: {rot.get("limitReason", "over limit")}')
                continue
            ov = rot.get('nameOverrides', {}).get(key.split('/')[0])
            if ov and 'name' in figs:
                figs['name'] = ov
            q.append((key, r, figs, est))
        queues.append((rot, q))
    taken = {it['liveDate'] for it in items}
    count = {}
    for it in items:
        wk = week_of(dt.date.fromisoformat(it['liveDate']))
        count[wk] = count.get(wk, 0) + 1
    turn = 0
    mon = dt.date.fromisoformat(week_of(dt.date.fromisoformat(cad['fillFrom'])))
    end = min(dt.date.fromisoformat(cad['horizon']), max(dt.date.fromisoformat(r['validUntil']) for r, _ in queues))
    while mon <= end:
        wk = mon.isoformat()
        for day in open_days(cad, wk):
            iso = day.isoformat()
            if count.get(wk, 0) >= week_cap(cad, wk):
                break
            if iso in taken or iso < cad['fillFrom']:
                continue
            for k in range(len(queues)):
                rot, q = queues[(turn + k) % len(queues)]
                if q and rot['validFrom'] <= iso <= rot['validUntil']:
                    key, r, figs, est = q.pop(0)
                    add(f'{rot["id"]}-{key.lower().replace("/", "-")}', rot['id'], 'note', day,
                        render(r['headline'], figs), render(r['body'], figs), r, figs, est, None, None, key)
                    taken.add(iso)
                    count[wk] = count.get(wk, 0) + 1
                    turn = (turn + k + 1) % len(queues)
                    break
        mon += dt.timedelta(days=7)
    for rot, q in queues:
        for key, *_ in q:
            pulled.setdefault(rot['id'], []).append(f'{key}: not scheduled (rotation shelf life ended)')
    return skipped, pulled


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
        right = it['cardTag'].upper() if it.get('cardTag') else fmt_date(it['event']).upper() if it['event'] else ('DMV · ' if it['kind'] == 'note' and it.get('key', '')[:2] in ('DC', 'MD', 'VA') else '') + fmt_date(it['liveDate']).upper()
        d.text((W - 72 - d.textlength(right, font=lf), 62), right, font=lf, fill=T['muted'])
        d.line([72, 98, W - 72, 98], fill=T['border'], width=1)

        stats_top = 372
        if it['kind'] in ('countdown', 'dated'):
            n = it['daysToEvent']
            if it['kind'] == 'countdown':
                _, big, unit = MILESTONES[it['milestone']]
                bf = font('IBMPlexMono_600SemiBold', 176)
                d.text((66, 112), big, font=bf, fill=T['text'])
                d.text((76, 318), unit, font=font('IBMPlexMono_500Medium', 24), fill=T['muted'])
            elif n > 0:
                ev = dt.date.fromisoformat(it['event'])
                big = ev.strftime('%b').upper() + ' ' + str(ev.day)
                bf = font('IBMPlexMono_600SemiBold', 104)
                d.text((66, 150), big, font=bf, fill=T['text'])
                d.text((76, 290), ev.strftime('%A').upper(), font=font('IBMPlexMono_500Medium', 24), fill=T['muted'])
            else:
                big = 'TODAY' if n == 0 else 'IN EFFECT'
                bf = font('IBMPlexMono_600SemiBold', 74)
                d.text((66, 170), big, font=bf, fill=T['text'])
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
