/* Quote Comparator emailed report: server model parity with the on-page comparator,
   validation, PDF content and questions, XLSX formulas recalculated in LibreOffice
   (Incomplete proposals stay Incomplete), and the /api/report-request kind:"compare" path.
   Run: node tests/test_compare_report.mjs   (WRITE_SAMPLES=dir writes the PDF/XLSX) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCompare, evaluate, analyze, compareLines } from '../functions/lib/compare-model.js';
import { makeReportPdf } from '../functions/lib/simple-pdf.js';
import { makeCompareXlsx } from '../functions/lib/simple-xlsx.js';
import { onRequestPost } from '../functions/api/report-request.js';
import { _resetForTests as resetLimiter } from '../functions/lib/ratelimit.js';
globalThis.window = {};
await import(new URL('../assets/js/quote-compare.js', import.meta.url));
const client = window.PEOCompare.evaluateQuotes;

let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.005, `${m}: ${a} vs ${b}`);

const SNAP = {
  common: { employees: 25, wage: 65000, enrollment: 60, sutaBase: 8500 },
  quotes: [
    { label: 'Insperity', feeBasis: 'pepm', fee: 149, setup: 0, suta: 2.6, wc: 0.31, health: 7348.8, epli: 0, other: 2475, src: { provider: 'file', fee: 'file', setup: 'file', suta: 'file', wc: 'file', health: 'file', epli: 'file', other: 'check' }, file: 1 },
    { label: 'TriNet', feeBasis: 'pct', fee: 3.25, setup: 1500, suta: 2.7, wc: 0.29, health: 7308, epli: 2.5, other: 0, src: { suta: 'check', health: 'edited' }, file: 1 },
    { label: 'Proposal C', feeBasis: 'pepm', fee: 160, setup: 500, suta: 2.6, wc: null, health: 7580, epli: 1.07, other: 0, src: {}, file: 0 }
  ]
};

await t('server model == on-page comparator (random scenarios, both fee bases, blanks)', () => {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 600; k++) {
    const common = { employees: 1 + Math.floor(rnd() * 900), wage: Math.round(18000 + rnd() * 300000), enrollment: Math.round(rnd() * 100), sutaBase: Math.round(7000 + rnd() * 70000) };
    const quotes = [0, 1, 2].map(() => {
      const pct = rnd() < 0.4;
      const q = { label: 'Q', feeBasis: pct ? 'pct' : 'pepm', fee: pct ? +(rnd() * 8).toFixed(2) : Math.round(rnd() * 300), setup: Math.round(rnd() * 5000), suta: +(rnd() * 9).toFixed(3),
        wc: +(rnd() * 12).toFixed(4), health: Math.round(rnd() * 16000), epli: +(rnd() * 6).toFixed(2), other: Math.round(rnd() * 20000) };
      if (rnd() < 0.15) q[['fee', 'setup', 'suta', 'wc', 'health', 'epli', 'other'][Math.floor(rnd() * 7)]] = null;
      return q;
    });
    const c = parseCompare({ common, quotes });
    const s = evaluate(c.common, c.quotes), w = client(common, quotes);
    s.forEach((r, i) => {
      assert.deepEqual(r.missing, w[i].missing);
      if (!r.missing.length) { near(r.yearOne, w[i].yearOne, 'yearOne'); near(r.threeYear, w[i].threeYear, 'threeYear'); for (const k of Object.keys(r.parts)) near(r.parts[k], w[i].parts[k], k); }
    });
  }
});
await t('validation: ranges, labels sanitized, unknown src values dropped', () => {
  for (const bad of [{ common: { ...SNAP.common, employees: 0 } }, { common: { ...SNAP.common, enrollment: 101 } }, { quotes: [] },
    { quotes: [...SNAP.quotes, SNAP.quotes[0]] }, { quotes: [{ ...SNAP.quotes[0], suta: 31 }] }, { quotes: [{ ...SNAP.quotes[1], fee: 101 }] }, { quotes: [{ ...SNAP.quotes[0], health: 'x' }] }])
    assert.throws(() => parseCompare({ ...SNAP, ...bad }), JSON.stringify(bad).slice(0, 80));
  const c = parseCompare({ ...SNAP, quotes: [{ ...SNAP.quotes[0], label: '<b>Evil</b>\u0007 Co', src: { fee: 'file', suta: 'javascript:' } }] });
  assert.equal(c.quotes[0].label, 'bEvil/b Co'); assert.deepEqual(c.quotes[0].src, { fee: 'file' });
});
const c0 = parseCompare(SNAP), e0 = evaluate(c0.common, c0.quotes), a0 = analyze(c0, e0);
const pdf = makeReportPdf(compareLines(c0, e0, a0)), xlsx = makeCompareXlsx(c0, e0, a0);
const pdfTxt = new TextDecoder('latin1').decode(pdf);
await t('analysis: lowest, all-in PEPM, gap driver, incomplete proposal', () => {
  assert.equal(a0.completeCount, 2); assert.equal(a0.low.label, 'Insperity');
  near(a0.per[0].pepmAllIn, e0[0].yearOne / 25 / 12, 'pepm all-in');
  assert.equal(a0.per[1].driver.line, 'Admin'); near(a0.per[1].gap, e0[1].yearOne - e0[0].yearOne, 'gap');
  assert.equal(a0.per[2].complete, false); assert.match(a0.per[2].questions[0], /workers' comp rate/);
});
await t('questions follow the entered terms', () => {
  const q0 = a0.per[0].questions.join(' '), q1 = a0.per[1].questions.join(' ');
  assert.match(q0, /Setup is \$0/); assert.match(q0, /EPLI shows \$0/); assert.match(q0, /converted or inferred: other charges/);
  assert.match(q1, /3\.25% of gross payroll \(\$176\.04 per employee per month/); assert.match(q1, /full fee schedule/); assert.match(q1, /SUTA rate/);
  assert.ok(!/EPLI shows/.test(q1), 'TriNet EPLI is not zero');
});
await t('PDF: table, totals, provenance tags, questions, limitations', () => {
  assert.ok(pdfTxt.startsWith('%PDF-1.4'));
  for (const s of ['PEO QUOTE COMPARISON', '$' + Math.round(e0[0].yearOne).toLocaleString('en-US'), '$' + Math.round(e0[1].threeYear).toLocaleString('en-US'),
    'Incomplete', 'QUESTIONS TO PUT TO EACH PROVIDER', '\\(file\\)', '\\(check\\)', '\\(edited\\)', 'did not receive your files', 'WHAT SEPARATES THEM'])
    assert.ok(pdfTxt.includes(s), 'PDF missing ' + s);
});
if (process.env.WRITE_SAMPLES) { fs.writeFileSync(process.env.WRITE_SAMPLES + '/sample_comparison.pdf', pdf); fs.writeFileSync(process.env.WRITE_SAMPLES + '/sample_comparison.xlsx', xlsx); }

let soffice = null; for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']) if (fs.existsSync(p)) soffice = p;
if (soffice) await t('XLSX recalculated in LibreOffice matches the server; blank term -> Incomplete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-cmp-'));
  fs.writeFileSync(path.join(dir, 'c.xlsx'), xlsx);
  execFileSync(soffice, ['--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,2', '--outdir', dir, path.join(dir, 'c.xlsx')], { stdio: 'ignore', timeout: 120000 });
  const rows = fs.readFileSync(path.join(dir, 'c-Comparison.csv'), 'utf8').split('\n').map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(s => s.replace(/,$/, '').replace(/^"|"$/g, '')));
  const r = name => rows.find(x => x[0] === name);
  const n = s => Number(String(s).replace(/[^0-9.\-]/g, ''));
  assert.ok(Math.abs(n(r('Year one total')[1]) - e0[0].yearOne) < 1 && Math.abs(n(r('Year one total')[2]) - e0[1].yearOne) < 1, 'year one ' + r('Year one total'));
  assert.ok(Math.abs(n(r('Three-year total')[2]) - e0[1].threeYear) < 1, 'three-year');
  assert.equal(r('Year one total')[3], 'Incomplete'); assert.equal(r('Admin')[3], 'Incomplete');
  assert.ok(Math.abs(n(r('Above lowest, year one')[2]) - (e0[1].yearOne - e0[0].yearOne)) < 1, 'above lowest');
  assert.equal(r('Annual cost')[1], 'Insperity');
});
else console.log('  (LibreOffice not found — XLSX recalculation check skipped)');

/* ---------- endpoint: kind=compare ---------- */
const real = globalThis.fetch;
let calls, events, turnstileOk;
const mock = () => { calls = []; events = []; globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push(url);
  if (url.includes('turnstile')) return Response.json({ success: turnstileOk, hostname: 'peonomics.com' });
  if (url === 'https://hook.example/exec') { events.push(JSON.parse(opts.body)); return Response.json({ ok: true }); }
  if (url.includes('api.resend.com')) { calls.push({ body: JSON.parse(opts.body) }); return Response.json({ id: 'msg_9' }); }
  throw new Error('unexpected fetch ' + url); }; };
const ENV = { TURNSTILE_SECRET: 's', RESEND_API_KEY: 'k', REPORT_FROM: 'PEOnomics <reports@peonomics.com>', USAGE_WEBHOOK_URL: 'https://hook.example/exec', ASSETS: { fetch: async () => { throw new Error('compare must not need rates'); } } };
const BODY = { kind: 'compare', email: 'Owner@SampleBusiness.com', compare: SNAP, turnstileToken: 'valid-token-123', requestId: '22222222-2222-4222-8222-222222222222' };
const call = async b => { const res = await onRequestPost({ request: new Request('https://peonomics.com/api/report-request', { method: 'POST', headers: { origin: 'https://peonomics.com', 'content-type': 'application/json' }, body: JSON.stringify(b) }), env: ENV }); return { status: res.status, body: await res.json() }; };
const reset = () => { resetLimiter(); turnstileOk = true; mock(); };

await t('compare report: logged, two attachments named for the comparison, server-recomputed', async () => {
  reset(); const r = await call({ ...BODY, compare: { ...SNAP, results: { yearOne: 1 } } });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'accepted_for_delivery');
  assert.deepEqual(events.map(e => e.event), ['report_requested', 'report_accepted']);
  assert.equal(events[0].page, 'compare'); assert.match(events[0].scenario, /^compare \| N=25/); assert.match(events[0].scenario, /A:Insperity\(file\)/);
  const send = calls.find(c => typeof c === 'object');
  assert.equal(send.body.subject, 'Your PEOnomics quote comparison');
  assert.match(send.body.attachments[0].filename, /^PEOnomics_Quote_Comparison_\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.ok(send.body.attachments[1].filename.endsWith('.xlsx'));
  const p = Buffer.from(send.body.attachments[0].content, 'base64').toString('latin1');
  assert.ok(p.includes('$' + Math.round(e0[0].yearOne).toLocaleString('en-US')));
});
await t('fewer than two complete proposals -> need_two before Turnstile', async () => {
  reset(); const r = await call({ ...BODY, compare: { ...SNAP, quotes: [SNAP.quotes[0], SNAP.quotes[2]] } });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'need_two'); assert.equal(calls.length, 0);
});
await t('invalid compare -> 400 invalid_compare, nothing called; personal email refused', async () => {
  reset(); let r = await call({ ...BODY, compare: { ...SNAP, common: { ...SNAP.common, employees: -1 } } });
  assert.equal(r.body.error, 'invalid_compare'); assert.equal(calls.length, 0);
  r = await call({ ...BODY, email: 'me@gmail.com' }); assert.equal(r.body.error, 'business_email_required'); assert.equal(calls.length, 0);
});
await t('Turnstile failure -> 403, nothing logged or sent', async () => {
  reset(); turnstileOk = false; const r = await call(BODY);
  assert.equal(r.status, 403); assert.equal(events.length, 0); assert.ok(!calls.some(c => typeof c === 'object'));
});
globalThis.fetch = real;
console.log(`compare report: ${pass} passed`);
