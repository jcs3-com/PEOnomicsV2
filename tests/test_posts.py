"""Auto-post feed: every number in every scheduled post must trace to a data file.
Run: python3 tests/test_posts.py

Checks, independently of tools/build_posts.py where it matters:
  - data/post-schedule.json is current (rebuilding from series.json + data gives the same posts)
  - every numeral in a post body/headline equals a figure resolved here from the data files, a
    figure x 100 (rates), a part of a date figure, the event/release date, or the countdown day
    count recomputed from the dates; source citations and hashtags are not claims and are skipped
  - low-confidence figures appear only in posts that say "estimate"
  - weekdays only, at most one post a day, links resolve to repo pages, cards exist at 1200x627
  - a marked release whose data is not ready is refused; a typed-in number is caught"""
import copy, datetime as dt, json, os, re, struct, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import build_posts as B  # noqa: E402

S = json.load(open(os.path.join(ROOT, 'data', 'posts', 'series.json'), encoding='utf-8'))
SCHED = json.load(open(os.path.join(ROOT, 'data', 'post-schedule.json'), encoding='utf-8'))
DATA = {k: json.load(open(os.path.join(ROOT, v), encoding='utf-8')) for k, v in S['meta']['refs'].items()}
fails, passes = [], 0


def check(c, m):
    global passes
    if c:
        passes += 1
    else:
        fails.append(m)
        print('FAIL', m)


def get(ref):
    """Independent resolver (deliberately not B.resolve)."""
    prefix, path = ref.split(':', 1)
    node = DATA[prefix]
    for part in path.split('.'):
        key, sel = (part.split('[', 1) + [None])[:2]
        node = node[key]
        if sel:
            sel = sel.rstrip(']')
            if sel.isdigit():
                node = node[int(sel)]
            else:
                k, v = sel.split('=')
                node = next(x for x in node if str(x.get(k)) == v)
    return node


def candidates(spec):
    vals, dates, conf = {}, [], {}
    for name, f in spec.items():
        if isinstance(f, str):
            v = get(f)
        elif 'op' in f:
            a, b = (vals[x] for x in f['args'])
            v = {'mul': a * b, 'sub': a - b, 'add': a + b}[f['op']]
        else:
            v = get(f['ref'])
            conf[name] = get(f['conf']) if f.get('conf') else None
        vals[name] = v
    nums = []
    for v in vals.values():
        if isinstance(v, (int, float)):
            nums += [v, v * 100]
        elif isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
            dates.append(dt.date.fromisoformat(v))
    return nums, dates, conf


def numerals(text):
    keep = [ln for ln in text.split('\n') if not ln.startswith('Source:') and not ln.startswith('#')]
    keep = [re.sub(r'https?://\S+', '', ln) for ln in keep]
    return re.findall(r'\d[\d,]*(?:\.\d+)?', '\n'.join(keep))


def traced(tok, nums):
    t = float(tok.replace(',', ''))
    dec = len(tok.split('.')[1]) if '.' in tok else 0
    return any(abs(round(c + 1e-9, dec) - t) < 1e-9 for c in nums)


LABEL = {'60d': ('60 days', 60), '30d': ('30 days', 30), '1m': ('1 month', 1), '1w': ('1 week', 1)}


def month_before(e):
    y, m = (e.year, e.month - 1) if e.month > 1 else (e.year - 1, 12)
    return dt.date(y, m, e.day)


def milestone_ok(code, event, day):
    """Independent re-derivation of the owner's milestone rule."""
    return {'60d': (event - day).days == 60, '30d': (event - day).days == 30,
            '1w': (event - day).days == 7, '1m': month_before(event) == day}.get(code, False)


def event_of(spec):
    if 'event' not in spec:
        return None
    ev = spec['event']
    return dt.date.fromisoformat(get(ev) if ':' in ev else ev)


def provenance_ok(it, spec, event):
    nums, dates, _ = candidates(spec['figures'])
    if it.get('milestone') and milestone_ok(it['milestone'], event, dt.date.fromisoformat(it['liveDate'])):
        nums.append(LABEL[it['milestone']][1])
    for d in dates + ([event] if event else []) + [dt.date.fromisoformat(it['liveDate'])] * (event is None):
        nums += [d.year, d.day]
    if event:
        nums.append((event - dt.date.fromisoformat(it['liveDate'])).days)
    nums += [float(k) for k in spec.get('definitions', {})]
    bad = [tok for tok in numerals(it['text']) if not traced(tok, nums)]
    return bad


specs = {s['id']: s for s in S['countdowns'] + S['releases'] + S.get('rotations', [])}

# 1. schedule is current
fresh = B.build()
strip = lambda items: [{k: v for k, v in it.items() if k != 'imageBytes'} for it in items]
check(strip(fresh['items']) == strip(SCHED['items']), 'data/post-schedule.json is stale: run python3 tools/build_posts.py')
check(fresh['meta']['dormantReleases'] == SCHED['meta']['dormantReleases'], 'dormant release list current')
check(len(SCHED['items']) > 0, 'schedule has posts')

# 2. provenance + rules per post
days = []
for it in SCHED['items']:
    spec = specs[it['series']]
    if it.get('key'):
        spec = B.bind(spec, it['key'], spec.get('labels'))
    event = event_of(spec)
    bad = provenance_ok(it, spec, event)
    check(not bad, f'{it["id"]}: untraceable numbers {bad}')
    _, _, conf = candidates(spec['figures'])
    low = [k for k, c in conf.items() if c == 'low']
    if low:
        check('estimate' in it['text'].lower(), f'{it["id"]}: low-confidence {low} but no "estimate" in text')
    day = dt.date.fromisoformat(it['liveDate'])
    check(day.weekday() < 5, f'{it["id"]}: weekend post {day}')
    if event:
        check(it['daysToEvent'] == (event - day).days, f'{it["id"]}: day count')
        if it['kind'] == 'countdown':  # owner rule: only exact 60 days / 30 days / 1 month / 1 week
            check(it.get('milestone') in LABEL and milestone_ok(it['milestone'], event, day), f'{it["id"]}: not an exact milestone')
            check(it['headline'].startswith(LABEL.get(it.get('milestone'), ('?',))[0] + ' until'), f'{it["id"]}: headline names the milestone')
        else:
            n = it['daysToEvent']
            md = B.FORMATS['md'](event.isoformat())
            check((md in it['headline']) if n > 0 else ('Today' in it['headline'] or 'Now in effect' in it['headline']), f'{it["id"]}: dated headline names the date')
    check(not re.match(r'^\d+ (days?|weeks?|months?) until', it['headline']) or it['kind'] == 'countdown', f'{it["id"]}: day count outside a milestone post')
    days.append(day)
    check(it['url'].startswith('https://peonomics.com/') and '.html' not in it['url'], f'{it["id"]}: absolute extensionless link')
    check(B.page_exists(it['url'][len('https://peonomics.com'):]), f'{it["id"]}: link target exists')
    check(it['text'].count('PEOnomics · PEO cost intelligence') == 1, f'{it["id"]}: brand line once')
    check(len(it['text']) <= B.MAX_TEXT, f'{it["id"]}: length')
    check(not re.search(r'[{}]', it['text']), f'{it["id"]}: no unrendered braces')
    p = os.path.join(ROOT, 'assets', 'images', 'posts', it['id'] + '.png')
    ok = os.path.exists(p)
    check(ok and open(p, 'rb').read(8) == b'\x89PNG\r\n\x1a\n' and B.png_size(p) == (1200, 627), f'{it["id"]}: card 1200x627 PNG')
    check(ok and it.get('imageBytes') == os.path.getsize(p), f'{it["id"]}: imageBytes matches card')
check(len(days) == len(set(days)), 'one post per day at most')
# cadence: weekly caps (quiet periods included), no-post days, weekdays, rotation shelf life
cad = S['cadence']
def cap(monday):
    days = [(monday + dt.timedelta(days=i)).isoformat() for i in range(7)]
    for q in cad.get('quietPeriods', []):
        if any(q['from'] <= d <= q['to'] for d in days):
            return q['perWeek']
    return cad['perWeek']
weeks = {}
for it in SCHED['items']:
    d = dt.date.fromisoformat(it['liveDate'])
    m = d - dt.timedelta(days=d.weekday())
    weeks[m] = weeks.get(m, 0) + 1
    check(it['liveDate'] not in cad['noPostDates'], f'{it["id"]}: on a no-post day')
    if it['kind'] == 'note':
        rot = specs[it['series']]
        check(rot['validFrom'] <= it['liveDate'] <= rot['validUntil'], f'{it["id"]}: outside its data shelf life')
for m, n in weeks.items():
    check(n <= cap(m), f'week of {m}: {n} posts, cap {cap(m)}')
for day in ['2026-11-25', '2026-11-26', '2026-12-07'] + [f'2026-12-{d}' for d in range(23, 32)] + ['2027-01-01']:
    check(day in cad['noPostDates'], f'owner no-post day {day} listed')
gap_total = sum(g['open'] for g in SCHED['meta']['gaps'])
check(gap_total == SCHED['meta']['openSlots'], 'open-slot total matches gap list')
for g in SCHED['meta']['gaps']:
    for d in g['suggest']:
        check(d not in cad['noPostDates'] and dt.date.fromisoformat(d).weekday() < 5 and d not in {i['liveDate'] for i in SCHED['items']}, f'gap suggestion {d} is a usable day')
check(len({it['id'] for it in SCHED['items']}) == len(SCHED['items']), 'unique post ids')
cards = {f for f in os.listdir(os.path.join(ROOT, 'assets', 'images', 'posts')) if f.endswith('.png')}
check(cards == {it['id'] + '.png' for it in SCHED['items']}, 'no orphan or missing cards')

# 3. the checker and the builder refuse bad input
fake = dict(SCHED['items'][0], text=SCHED['items'][0]['text'].replace('\n\n', '\n\nSave 37% today.\n\n', 1))
spec0 = specs[fake['series']]
check(provenance_ok(fake, spec0, event_of(spec0)) == ['37'], 'typed-in number is caught')

orig = copy.deepcopy(S)
try:
    S2 = copy.deepcopy(orig)
    for r in S2['releases']:
        if r.get('requires'):
            r['date'] = '2026-11-12'
    json_path = B.SERIES
    B.SERIES = os.path.join(ROOT, 'tests', '.series-tmp.json')
    json.dump(S2, open(B.SERIES, 'w'))
    try:
        B.build()
        ready = all(get(k) == v for r in S2['releases'] for k, v in r.get('requires', {}).items())
        check(ready, 'marked release with unready data must be refused')
    except B.BuildError as e:
        check('not ready' in str(e) or 'more than one post' in str(e), f'release refusal reason: {e}')
    S4 = copy.deepcopy(orig)  # a milestone on a no-post day is refused, never shifted
    S4['countdowns'][0]['milestones'] = ['1w']
    json.dump(S4, open(B.SERIES, 'w'))
    try:
        B.build()
        check(False, 'milestone on Thanksgiving must be refused')
    except B.BuildError as e:
        check('no-post day' in str(e), f'no-post refusal reason: {e}')
    S5 = copy.deepcopy(orig)  # day offsets (non-milestone counts) are retired
    S5['countdowns'][0]['offsets'] = [-43]
    json.dump(S5, open(B.SERIES, 'w'))
    try:
        B.build()
        check(False, 'offsets must be refused')
    except B.BuildError as e:
        check('offsets are retired' in str(e), f'offset refusal reason: {e}')
    S3 = copy.deepcopy(orig)
    fi = next(i for i, c in enumerate(S3['countdowns']) if c['id'] == 'futa-credit-reduction-2026')
    S3['countdowns'][fi]['figures']['futaNet'] = {'ref': 'rates:federal.futa_credit_reduction_states.CA', 'conf': 'rates:federal.futa_credit_reduction_confidence.CA'}
    json.dump(S3, open(B.SERIES, 'w'))
    try:
        B.build()
        check(get('rates:federal.futa_credit_reduction_confidence.CA') != 'low', 'unflagged low-confidence figure refused')
    except B.BuildError as e:
        check('low-confidence' in str(e), f'low-confidence refusal reason: {e}')
finally:
    B.SERIES = json_path
    if os.path.exists(os.path.join(ROOT, 'tests', '.series-tmp.json')):
        os.remove(os.path.join(ROOT, 'tests', '.series-tmp.json'))

print(f'{passes} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
