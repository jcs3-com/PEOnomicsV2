/* Report pipeline tests: server model parity with the Cost Lab, PDF/XLSX
   generation, and /api/report-request success + every refusal path.
   Run: node tests/test_report.mjs   (writes sample files when WRITE_SAMPLES=dir) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSnapshot, calculate, reportLines } from '../functions/lib/report-model.js';
import { makeReportPdf } from '../functions/lib/simple-pdf.js';
import { makeReportXlsx } from '../functions/lib/simple-xlsx.js';
import { onRequestPost, onRequestGet, reportConfigured } from '../functions/api/report-request.js';
import { onRequestGet as statusGet } from '../functions/api/report-status.js';
globalThis.window = {};
await import(new URL('../assets/js/cost-lab.js', import.meta.url));
const { compute } = window.PEOLab;

const R = JSON.parse(fs.readFileSync(new URL('../data/rates-2025.json', import.meta.url), 'utf8'));
let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.005, `${m}: ${a} vs ${b}`);
const snap = { state: 'MD', company: 'Example Test Co', industry: 'clerical_professional', employees: 25, wage: 65000, suta: 2.6, wc: 0.3675, enrollment: 60, health: 7580, pepm: 160, currentAdmin: 0, adminAvoided: 0, peoSuta: null, peoWc: null, peoHealth: null };

/* ---------- model ---------- */
await t('MD 25 @ 65k (package QA figures)', () => {
  const r = calculate(R, parseSnapshot(snap, R));
  near(r.cur.fica, 124312.5, 'fica'); near(r.cur.futa, 1050, 'futa'); near(r.cur.suta, 5525, 'suta'); near(r.cur.health, 113700, 'health'); near(r.delta, 48000, 'delta = fee');
});
await t('server model == Cost Lab compute, 51 states x 6 industries x random inputs', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let n = 0;
  for (const st of Object.keys(R.states)) for (const [ind, m] of Object.entries(R.wc_industry_multipliers)) {
    if (typeof m !== 'number') continue;
    for (let k = 0; k < 4; k++) {
      const s = { ...snap, state: st, industry: ind, employees: 1 + Math.floor(rnd() * 400), wage: Math.round(20000 + rnd() * 250000),
        suta: +(rnd() * 8).toFixed(3), wc: +(R.states[st].wc_index_per_100 * m).toFixed(4), enrollment: Math.round(rnd() * 100),
        health: Math.round(4000 + rnd() * 12000), pepm: Math.round(rnd() * 250), currentAdmin: Math.round(rnd() * 90000),
        adminAvoided: Math.round(rnd() * 120000),
        peoSuta: k === 1 ? +(rnd() * 5).toFixed(2) : null, peoWc: k === 2 ? +(rnd() * 3).toFixed(3) : null, peoHealth: k === 3 ? Math.round(5000 + rnd() * 9000) : null };
      const server = calculate(R, parseSnapshot(s, R));
      const client = compute(R, s);
      for (const key of ['fica', 'futa', 'suta', 'wc', 'health', 'admin', 'fee']) { near(server.cur[key], client.cur[key], `${st}/${ind}/cur.${key}`); near(server.peo[key], client.peo[key], `${st}/${ind}/peo.${key}`); }
      near(server.delta, client.delta, `${st} delta`);
      if (k === 0) near(server.delta, server.peo.fee - server.avoided, `${st}/${ind} neutral delta`);
      n++;
    }
  }
  assert.equal(n, 51 * 6 * 4);
});
await t('snapshot validation rejects bad input; accepts Cost Lab ranges', () => {
  for (const bad of [{ employees: 0 }, { employees: -1 }, { wc: 200 }, { suta: 31 }, { enrollment: 101 }, { state: 'ZZ' }, { wage: 'abc' }, { health: -1 }])
    assert.throws(() => parseSnapshot({ ...snap, ...bad }, R), JSON.stringify(bad));
  parseSnapshot({ ...snap, suta: 30, wage: 0 }, R);
});
await t('company name stripped of markup/control chars', () => {
  assert.equal(parseSnapshot({ ...snap, company: '<b>Acme</b>\u0007 Inc' }, R).company, 'bAcme/b Inc');
});

/* ---------- documents ---------- */
const s0 = parseSnapshot({ ...snap, company: 'Café Rouge — “LLC”', peoWc: 0.25 }, R), r0 = calculate(R, s0);
const pdf = makeReportPdf(reportLines(s0, r0)), xlsx = makeReportXlsx(s0, r0, R);
await t('PDF structure', () => {
  const txt = new TextDecoder().decode(pdf);
  assert.ok(txt.startsWith('%PDF-1.4')); assert.match(txt, /%%EOF\n$/);
  assert.match(txt, /Model tax year 2025, dataset v2025\.2/); assert.match(txt, /Cafe Rouge - "LLC"/);
  assert.match(txt, /No PEO savings assumed/); assert.ok(!/2026 rate/i.test(txt));
});
await t('XLSX is a valid zip with two sheets and formulas', () => {
  assert.equal(xlsx[0], 0x50); assert.equal(xlsx[1], 0x4b);
  const txt = new TextDecoder('latin1').decode(xlsx);
  assert.match(txt, /<sheet name="Inputs"/); assert.match(txt, /<sheet name="Model"/); assert.match(txt, /<f>SUM\(B2:B8\)<\/f>/);
});
if (process.env.WRITE_SAMPLES) { fs.writeFileSync(process.env.WRITE_SAMPLES + '/sample_report.pdf', pdf); fs.writeFileSync(process.env.WRITE_SAMPLES + '/sample_workbook.xlsx', xlsx); }

/* ---------- endpoint ---------- */
const real = globalThis.fetch;
let calls, events, resendResp, turnstileOk, webhookOk;
function mock() {
  calls = []; events = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); calls.push(url);
    if (url.includes('turnstile')) return Response.json({ success: turnstileOk, hostname: 'peonomics.com' });
    if (url === 'https://hook.example/exec') { events.push(JSON.parse(opts.body)); return Response.json({ ok: webhookOk }); }
    if (url.includes('api.resend.com')) { calls.push({ headers: new Headers(opts.headers), body: JSON.parse(opts.body) }); return resendResp(); }
    throw new Error('unexpected fetch ' + url);
  };
}
const ENV = { TURNSTILE_SECRET: 's', RESEND_API_KEY: 'k', REPORT_FROM: 'PEOnomics <reports@peonomics.com>', USAGE_WEBHOOK_URL: 'https://hook.example/exec',
  ASSETS: { fetch: async () => Response.json(R) } };
const BODY = { email: 'Finance@SampleBusiness.com', snapshot: snap, turnstileToken: 'valid-token-123', requestId: '11111111-1111-4111-8111-111111111111' };
const call = async (b = BODY, { origin = 'https://peonomics.com', env = ENV, ct = 'application/json' } = {}) => {
  const res = await onRequestPost({ request: new Request('https://peonomics.com/api/report-request', { method: 'POST', headers: { origin, 'content-type': ct }, body: typeof b === 'string' ? b : JSON.stringify(b) }), env });
  return { status: res.status, body: await res.json() };
};
const reset = () => { turnstileOk = true; webhookOk = true; resendResp = () => Response.json({ id: 'msg_123' }); mock(); };

await t('success: logs requested+accepted, two attachments, idempotency key, honest status', async () => {
  reset(); const r = await call();
  assert.equal(r.status, 200); assert.equal(r.body.status, 'accepted_for_delivery');
  assert.deepEqual(events.map(e => e.event), ['report_requested', 'report_accepted']);
  assert.equal(events[0].email, 'finance@samplebusiness.com'); assert.equal(events[1].providerMessageId, 'msg_123');
  const send = calls.find(c => typeof c === 'object');
  assert.equal(send.headers.get('Idempotency-Key'), 'peonomics-report-' + BODY.requestId);
  assert.deepEqual(send.body.to, ['finance@samplebusiness.com']);
  assert.ok(send.body.attachments[0].filename.endsWith('.pdf') && send.body.attachments[1].filename.endsWith('.xlsx'));
});
await t('tampered client totals are ignored (server recomputes)', async () => {
  reset(); const r = await call({ ...BODY, snapshot: { ...snap, currentTotal: 1, delta: -999999 }, results: { peoTotal: 0 } });
  assert.equal(r.status, 200);
  const send = calls.find(c => typeof c === 'object');
  const pdfTxt = Buffer.from(send.body.attachments[0].content, 'base64').toString('latin1');
  assert.match(pdfTxt, /\$250,559/); assert.match(pdfTxt, /\$298,559/);
});
await t('unconfigured -> 503 with zero third-party calls', async () => {
  for (const k of ['RESEND_API_KEY', 'REPORT_FROM', 'USAGE_WEBHOOK_URL', 'TURNSTILE_SECRET']) {
    reset(); const r = await call(BODY, { env: { ...ENV, [k]: '' } });
    assert.equal(r.status, 503, k); assert.equal(r.body.error, 'report_unconfigured'); assert.equal(calls.length, 0, k);
  }
});
await t('bad origin 403 / missing origin 403 / non-JSON 415', async () => {
  reset(); assert.equal((await call(BODY, { origin: 'https://attack.example' })).status, 403);
  assert.equal((await call(BODY, { origin: '' })).status, 403);
  assert.equal((await call(BODY, { ct: 'text/plain' })).status, 415); assert.equal(calls.length, 0);
});
await t('personal / unsafe email 400, nothing called', async () => {
  for (const email of ['john@gmail.com', 'x@outlook.com', 'a@127.0.0.1.nip.io', 'nope']) { reset(); const r = await call({ ...BODY, email }); assert.equal(r.status, 400, email); assert.equal(calls.length, 0); }
});
await t('bad request id / bad snapshot 400 before Turnstile', async () => {
  reset(); assert.equal((await call({ ...BODY, requestId: 'x' })).status, 400);
  assert.equal((await call({ ...BODY, snapshot: { ...snap, employees: -5 } })).status, 400);
  assert.ok(!calls.some(c => typeof c === 'string' && c.includes('turnstile')));
});
await t('Turnstile failure 403, nothing logged or sent', async () => {
  reset(); turnstileOk = false; const r = await call();
  assert.equal(r.status, 403); assert.equal(events.length, 0); assert.ok(!calls.some(c => typeof c === 'object'));
});
await t('log failure 503, no email sent', async () => {
  reset(); webhookOk = false; const r = await call();
  assert.equal(r.status, 503); assert.equal(r.body.error, 'log_unavailable'); assert.ok(!calls.some(c => typeof c === 'object'));
});
await t('provider rejection 502 and report_failed logged', async () => {
  reset(); resendResp = () => new Response('{"message":"domain not verified"}', { status: 403 }); const r = await call();
  assert.equal(r.status, 502); assert.deepEqual(events.map(e => e.event), ['report_requested', 'report_failed']); assert.match(events[1].summary, /403/);
});
await t('oversize body 413', async () => { reset(); assert.equal((await call('{"x":"' + 'a'.repeat(13000) + '"}')).status, 413); });
await t('duplicate requestId reuses the same Idempotency-Key', async () => {
  reset(); await call(); await call();
  const keys = calls.filter(c => typeof c === 'object').map(c => c.headers.get('Idempotency-Key'));
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});
await t('GET /api/report-request 405; /api/report-status reveals boolean only', async () => {
  assert.equal((await onRequestGet()).status, 405);
  assert.deepEqual(await (await statusGet({ env: ENV })).json(), { ok: true, available: true });
  assert.deepEqual(await (await statusGet({ env: {} })).json(), { ok: true, available: false });
  assert.equal(reportConfigured({ ...ENV, REPORT_FROM: '' }), false);
});
globalThis.fetch = real;
console.log(`report: ${pass} passed`);
