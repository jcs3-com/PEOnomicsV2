/* /api/event: allowlisted names and coarse props only; personal data can't get through.
   Run: node tests/test_event.mjs */
import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet, sanitize } from '../functions/api/event.js';
import { _resetForTests } from '../functions/lib/ratelimit.js';
let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };
const points = [];
const ENV = { EVENTS: { writeDataPoint: p => points.push(p) } };
const post = (body, { origin = 'https://peonomics.com', env = ENV, ip = '203.0.113.5' } = {}) => onRequestPost({ request: new Request('https://peonomics.com/api/event',
  { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env });

await t('valid event stored with allowlisted fields only', async () => {
  const r = await post({ name: 'calc_used', props: { state: 'MD', industry: 'construction_trades', band: '10-49', path: '/', email: 'a@b.com', company: 'Acme', wage: 71250 } });
  assert.equal(r.status, 204);
  assert.deepEqual(points.at(-1).blobs, ['calc_used', 'MD', 'construction_trades', '10-49', '', '/']);
  assert.ok(!JSON.stringify(points).includes('a@b.com') && !JSON.stringify(points).includes('Acme') && !JSON.stringify(points).includes('71250'));
});
await t('free text in allowlisted slots is dropped', () => {
  const e = sanitize({ name: 'lookup_submitted', props: { state: 'owner@x.com', industry: 'x', band: '25', outcome: 'john@acme.com', path: '/?email=a@b.com' } });
  assert.deepEqual(e, { name: 'lookup_submitted', state: '', industry: '', band: '', outcome: '', path: '' });
});
await t('unknown event / bad json / oversize / cross-origin refused', async () => {
  assert.equal((await post({ name: 'page_view' })).status, 400);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post('x'.repeat(700))).status, 413);
  assert.equal((await post({ name: 'calc_used' }, { origin: 'https://evil.example' })).status, 403);
});
await t('no Analytics Engine binding -> accepted and discarded', async () => {
  const before = points.length; assert.equal((await post({ name: 'data_csv' }, { env: {} })).status, 204); assert.equal(points.length, before);
});
await t('rate limited after 120 events / 10 min per IP; GET 405', async () => {
  _resetForTests(); let last;
  for (let i = 0; i < 121; i++) last = await post({ name: 'data_csv' }, { ip: '198.51.100.99' });
  assert.equal(last.status, 429); assert.equal((await onRequestGet()).status, 405);
});
console.log(`event: ${pass} passed`);
