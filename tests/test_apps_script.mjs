/* Event-log tests: runs the REAL apps-script/usage-log-v2.gs in a Node VM against an
   in-memory SpreadsheetApp, then drives /api/enrich and /api/report-request end to end
   through it (Turnstile + Resend mocked). Verifies append-only events, contact
   de-duplication, counters, survey date, the logged final scenario, and that the
   emailed PDF/XLSX carry the visitor's edited values.
   Run: node tests/test_apps_script.mjs   (WRITE_SAMPLES=dir also writes the attachments) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.stack || e.message); process.exitCode = 1; } };

/* ---------- in-memory Google Sheets ---------- */
function makeBook() {
  const sheets = new Map();
  const mkSheet = name => {
    const grid = [];
    const sh = {
      name, grid,
      getLastRow: () => grid.length,
      getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
      appendRow: r => { grid.push([...r]); },
      setFrozenRows: () => {},
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setValues: vals => { vals.forEach((row, i) => { const rr = r - 1 + i; while (grid.length <= rr) grid.push([]); row.forEach((v, j) => { grid[rr][c - 1 + j] = v; }); }); }
      })
    };
    return sh;
  };
  return {
    sheets,
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = mkSheet(n); sheets.set(n, s); return s; }
  };
}
const book = makeBook();
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => book },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  JSON, Date, Number, String, Math, Array, isFinite
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../apps-script/usage-log-v2.gs', import.meta.url), 'utf8'), ctx);
const doPost = obj => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).s);
const rows = name => book.getSheetByName(name).grid;
const head = name => rows(name)[0];
const col = (name, header) => head(name).indexOf(header);

/* ---------- Apps Script unit behavior ---------- */
await t('rejects unknown events and malformed emails', () => {
  assert.deepEqual(doPost({ event: 'lead', email: 'a@b.co' }), { ok: false, error: 'bad_event' });
  assert.deepEqual(doPost({ event: 'lookup_requested', email: 'not-an-email' }), { ok: false, error: 'bad_email' });
});
await t('formula injection is neutralized', () => {
  assert.equal(doPost({ event: 'lookup_requested', email: 'inj@evil-co.com', company: '=IMPORTXML("x")' }).ok, true);
  const r = rows('Usage Log').at(-1);
  assert.equal(r[col('Usage Log', 'Company')], `'=IMPORTXML("x")`);
});

/* ---------- end to end through the real endpoints ---------- */
const R = JSON.parse(fs.readFileSync(new URL('../data/rates-2026.json', import.meta.url), 'utf8'));
const HOOK = 'https://script.example/macros/s/test/exec';
let sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url === HOOK) return Response.json(doPost(JSON.parse(opts.body)));
  if (url.includes('turnstile')) return Response.json({ success: true, hostname: 'peonomics.com' });
  if (url.includes('api.resend.com')) { sent.push(JSON.parse(opts.body)); return Response.json({ id: 'msg_' + sent.length }); }
  if (url.includes('api.anthropic.com')) return Response.json({ content: [{ type: 'text', text: '{"company":"Sample Business LLC","stateGuess":"MD","employeesGuess":30,"industryGuess":"clerical_professional","summary":"A test firm."}' }] });
  if (url.includes('cloudflare-dns.com')) return Response.json({ Answer: [] });
  throw new Error('unexpected fetch ' + url);
};
const { onRequestPost: enrich } = await import('../functions/api/enrich.js');
const { onRequestPost: report } = await import('../functions/api/report-request.js');
const ENV = { USAGE_WEBHOOK_URL: HOOK, ANTHROPIC_API_KEY: 'test', TURNSTILE_SECRET: 's', RESEND_API_KEY: 'k',
  REPORT_FROM: 'PEOnomics <reports@peonomics.com>', ASSETS: { fetch: async () => Response.json(R) } };
const post = (fn, pathName, body, ip) => fn({ request: new Request('https://peonomics.com' + pathName, { method: 'POST',
  headers: { origin: 'https://peonomics.com', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env: ENV });

const edited = { state: 'MD', company: 'Sample Business LLC', industry: 'clerical_professional', employees: 32, wage: 71250,
  suta: 2.6, wc: 0.31, enrollment: 64, health: 6400, pepm: 139, currentAdmin: 42000, adminAvoided: 30000, peoSuta: 2.1, peoWc: null, peoHealth: 6100 };

await t('lookup: business email logged, profile returned only after the log confirms', async () => {
  const res = await post(enrich, '/api/enrich', { email: 'Owner@SampleBusiness.com', page: 'cost-lab' }, '203.0.113.10');
  const j = await res.json();
  assert.equal(res.status, 200); assert.equal(j.recorded, true); assert.equal(j.stateGuess, 'MD'); assert.equal(j.company, 'Sample Business LLC');
  const last = rows('Usage Log').at(-1);
  assert.equal(last[col('Usage Log', 'Event')], 'lookup_requested');
  assert.equal(last[col('Usage Log', 'Business Email')], 'owner@samplebusiness.com');
  assert.equal(last[col('Usage Log', 'Enrichment Source')], 'research');
});
await t('report: final edited values logged, PDF + XLSX carry them, contact deduped', async () => {
  const res = await post(report, '/api/report-request', { email: 'OWNER@samplebusiness.com', snapshot: edited,
    turnstileToken: 'valid-token-123', requestId: '22222222-2222-4222-8222-222222222222' }, '203.0.113.11');
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j)); assert.equal(j.status, 'accepted_for_delivery');
  const ev = rows('Usage Log').slice(-2);
  assert.deepEqual(ev.map(r => r[col('Usage Log', 'Event')]), ['report_requested', 'report_accepted']);
  const scen = ev[0][col('Usage Log', 'Scenario Inputs')];
  for (const frag of ['MD', 'N=32', 'W=71250', 'WC=0.31', 'Enroll%=64', 'Health=6400', 'PEPM=139', 'Admin=42000', 'Replaced=30000', 'PEO_SUTA%=2.1', 'PEO_WC=same', 'PEO_Health=6100'])
    assert.ok(scen.includes(frag), 'scenario missing ' + frag + ' in ' + scen);
  // independent hand calculation of the edited scenario on the 2026 dataset
  const N = 32, W = 71250, f = R.federal, st = R.states.MD;
  const fica = N * (Math.min(W, f.fica_ss_wage_base) * 0.062 + W * 0.0145), futa = N * 7000 * 0.006;
  const cur = fica + futa + N * Math.min(W, st.sui_wage_base) * 0.026 + N * W * 0.31 / 100 + N * 0.64 * 6400 + 42000;
  const peo = fica + futa + N * Math.min(W, st.sui_wage_base) * 0.021 + N * W * 0.31 / 100 + N * 0.64 * 6100 + 12000 + N * 139 * 12;
  assert.equal(ev[0][col('Usage Log', 'Annual Current')], Math.round(cur));
  assert.equal(ev[0][col('Usage Log', 'Annual With PEO')], Math.round(peo));
  assert.equal(ev[0][col('Usage Log', 'Annual Delta')], Math.round(peo - cur));
  assert.equal(ev[1][col('Usage Log', 'Provider Message ID')], 'msg_1');
  // contacts: the lookup and the report (different case) are ONE contact
  const contacts = rows('Contacts').slice(1).filter(r => String(r[0]).endsWith('@samplebusiness.com'));
  assert.equal(contacts.length, 1);
  const c = contacts[0], C = h => c[col('Contacts', h)];
  assert.equal(C('Lookup Count'), 1); assert.equal(C('PDF Requested Count'), 1); assert.equal(C('PDF Accepted Count'), 1);
  assert.match(String(C('Survey Eligibility Date')), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(String(C('Last Report Scenario')).includes('N=32')); assert.equal(C('Last Report Annual Delta'), Math.round(peo - cur));
  // attachments
  const mail = sent.at(-1);
  assert.deepEqual(mail.to, ['owner@samplebusiness.com']);
  const pdf = Buffer.from(mail.attachments[0].content, 'base64');
  const xlsx = Buffer.from(mail.attachments[1].content, 'base64');
  const pdfTxt = pdf.toString('latin1');
  assert.ok(pdfTxt.startsWith('%PDF-1.4'));
  assert.ok(pdfTxt.includes('$' + Math.round(cur).toLocaleString('en-US')), 'PDF current total');
  assert.ok(pdfTxt.includes('$' + Math.round(peo).toLocaleString('en-US')), 'PDF PEO total');
  assert.ok(pdfTxt.includes('Employees: 32'));
  if (process.env.WRITE_SAMPLES) { fs.writeFileSync(path.join(process.env.WRITE_SAMPLES, 'e2e_report.pdf'), pdf); fs.writeFileSync(path.join(process.env.WRITE_SAMPLES, 'e2e_workbook.xlsx'), xlsx); }
  // Recalculate the workbook in LibreOffice (if installed) and compare to the server totals.
  let soffice = null; for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']) if (fs.existsSync(p)) soffice = p;
  if (soffice) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-xlsx-'));
    fs.writeFileSync(path.join(dir, 'w.xlsx'), xlsx);
    execFileSync(soffice, ['--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,2', '--outdir', dir, path.join(dir, 'w.xlsx')], { stdio: 'ignore', timeout: 120000 });
    const model = fs.readFileSync(path.join(dir, 'w-Model.csv'), 'utf8').split('\n').map(l => l.split(','));
    const total = model.find(r => r[0] === 'ANNUAL TOTAL');
    const num = s => Number(String(s).replace(/[^0-9.\-]/g, ''));
    assert.ok(Math.abs(num(total[1]) - cur) < 1 && Math.abs(num(total[2]) - peo) < 1, `XLSX recalculated ${total} vs ${cur}/${peo}`);
  } else console.log('  (LibreOffice not found — XLSX recalculation check skipped)');
});
await t('second lookup from same address increments, never duplicates', async () => {
  await post(enrich, '/api/enrich', { email: 'owner@samplebusiness.com' }, '203.0.113.12');
  const contacts = rows('Contacts').slice(1).filter(r => String(r[0]) === 'owner@samplebusiness.com');
  assert.equal(contacts.length, 1); assert.equal(contacts[0][col('Contacts', 'Lookup Count')], 2);
  assert.equal(rows('Usage Log').filter(r => r[col('Usage Log', 'Business Email')] === 'owner@samplebusiness.com').length, 4);
});
await t('rate limits: enrich 9th lookup and report 7th request in a window are refused', async () => {
  let last;
  for (let k = 0; k < 9; k++) last = await post(enrich, '/api/enrich', { email: 'x@samplebusiness.com' }, '198.51.100.7');
  assert.equal(last.status, 429);
  for (let k = 0; k < 7; k++) last = await post(report, '/api/report-request', { email: 'x@samplebusiness.com', snapshot: edited, turnstileToken: 'valid-token-123', requestId: '33333333-3333-4333-8333-33333333333' + (k % 10) }, '198.51.100.8');
  assert.equal(last.status, 429);
});
globalThis.fetch = realFetch;
console.log(`event log: ${pass} passed`);
