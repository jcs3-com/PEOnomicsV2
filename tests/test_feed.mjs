/* /api/feed: only posts whose go-live time has passed, inside the window, valid RSS, audit view.
   Run: node tests/test_feed.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet, liveItems, upcomingItems, rss, audit } from '../functions/api/feed.js';

let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };
const SCHED = JSON.parse(readFileSync(new URL('../data/post-schedule.json', import.meta.url), 'utf8'));
const at = s => Date.parse(s);
const ENV = { ASSETS: { fetch: async req => { assert.equal(new URL(req.url).pathname, '/data/post-schedule.json'); return new Response(JSON.stringify(SCHED)); } } };
const get = (q = '') => onRequestGet({ request: new Request('https://peonomics.com/api/feed' + q), env: ENV });

await t('nothing is live before the first post time', () => {
  const first = SCHED.items[0];
  assert.equal(liveItems(SCHED, at(first.liveAt) - 1).length, 0);
  assert.deepEqual(liveItems(SCHED, at(first.liveAt)).map(i => i.id), [first.id]);
});
await t('future posts never leak into the feed', () => {
  for (const it of SCHED.items) {
    const now = at(it.liveAt) + 60000;
    assert.ok(liveItems(SCHED, now).every(x => at(x.liveAt) <= now), it.id);
  }
});
await t('window drops posts older than feedWindowDays; newest first', () => {
  const now = at('2026-12-22T12:00:00-05:00');
  const live = liveItems(SCHED, now);
  const win = SCHED.meta.feedWindowDays * 86400000;
  assert.ok(live.length > 1);
  assert.ok(live.every(x => now - at(x.liveAt) < win));
  for (let i = 1; i < live.length; i++) assert.ok(at(live[i - 1].liveAt) >= at(live[i].liveAt));
  assert.equal(live[0].liveDate, '2026-12-22');
});
await t('every post is in the feed on its go-live day (Zapier sees it)', () => {
  for (const it of SCHED.items) assert.ok(liveItems(SCHED, at(it.liveAt) + 15 * 60000).some(x => x.id === it.id), it.id);
});
await t('RSS: stable guid, escaped text, image enclosure, brand channel', () => {
  const xml = rss(SCHED, SCHED.items.slice(0, 3));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.equal((xml.match(/<item>/g) || []).length, 3);
  assert.ok(xml.includes(`<guid isPermaLink="false">peonomics-post-${SCHED.items[0].id}</guid>`));
  assert.ok(xml.includes('<title>PEOnomics · PEO cost intelligence</title>'));
  assert.match(xml, /<enclosure url="https:\/\/peonomics\.com\/assets\/images\/posts\/[a-z0-9-]+\.png" type="image\/png" length="\d+"\/>/);
  const evil = { ...SCHED, items: [{ ...SCHED.items[0], headline: 'A & B <x>', text: 'say "hi" & <b>' }] };
  const e = rss(evil, evil.items);
  assert.ok(e.includes('<title>A &amp; B &lt;x&gt;</title>') && !e.includes('<b>'));
});
await t('endpoint serves RSS for the current time; audit is plain text and noindex', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/rss\+xml/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  const body = await r.text();
  const now = Date.now();
  assert.equal((body.match(/<item>/g) || []).length, liveItems(SCHED, now).length);
  const a = await get('?audit=1');
  assert.match(a.headers.get('content-type'), /text\/plain/);
  assert.match(await a.text(), /GOING LIVE IN THE NEXT 35 DAYS/);
});
await t('audit lists upcoming posts with full text and dormant releases', () => {
  const now = at('2026-10-29T12:00:00-04:00');
  const txt = audit(SCHED, now);
  const next = upcomingItems(SCHED, now);
  assert.ok(next.length >= 5);
  for (const it of next) assert.ok(txt.includes(it.text), it.id);
  assert.ok(txt.includes('futa-credit-reduction-2026-final'));
});
await t('missing schedule -> 503, never a broken feed', async () => {
  const r = await onRequestGet({ request: new Request('https://peonomics.com/api/feed'), env: { ASSETS: { fetch: async () => new Response('', { status: 404 }) } } });
  assert.equal(r.status, 503);
});
console.log(`${pass} passed`);
