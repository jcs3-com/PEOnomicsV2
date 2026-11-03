/* Quote file parsing (assets/js/quote-parse.js): field extraction on realistic quote layouts,
   unit conversions, refusals (bundled pricing, several WC class codes, scans), and the
   XLSX / DOCX / CSV readers on files produced by LibreOffice (skipped if not installed).
   Run: node tests/test_quote_parse.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
await import(new URL('../assets/js/quote-parse.js', import.meta.url));
const { extractQuote, _internals: I } = globalThis.PEOQuoteParse;

let pass = 0; const t = async (n, f) => { try { await f(); pass++; } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };
const fx = name => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const val = (r, k) => r.fields[k] ? r.fields[k].value : undefined;
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.006, `${m}: ${a} vs ${b}`);

await t('PEPM quote: every field, waived/included = documented 0, add-ons annualized', () => {
  const r = extractQuote(fx('quote-pepm.txt'), { filename: 'insperity_proposal.pdf' });
  assert.equal(r.outcome, 'complete');
  assert.equal(val(r, 'feeBasis'), 'pepm'); assert.equal(val(r, 'fee'), 149);
  assert.equal(val(r, 'setup'), 0); assert.equal(val(r, 'suta'), 2.6); assert.equal(val(r, 'wc'), 0.31);
  near(val(r, 'health'), 612.4 * 12, 'health monthly x12'); assert.equal(val(r, 'epli'), 0);
  near(val(r, 'other'), 8 * 25 * 12 + 3 * 25, 'tech PEPM + W-2 per employee');
  assert.equal(val(r, 'provider'), 'Insperity');
  assert.equal(r.common.employees.value, 25); assert.equal(r.common.wage.value, 65000); assert.equal(r.common.sutaBase.value, 8500);
  assert.equal(r.common.enrollment.value, 60);
  assert.ok(r.fields.fee.evidence.includes('$149.00 per employee per month'), 'evidence is the source line');
});
await t('FUTA/FICA percentages never land in SUTA; experience mod never lands in WC', () => {
  const r = extractQuote(fx('quote-pepm.txt'));
  assert.notEqual(val(r, 'suta'), 0.6); assert.notEqual(val(r, 'wc'), 0.95);
  const w = extractQuote(fx('quote-weighted.txt'));
  assert.equal(val(w, 'suta'), 3.4, 'SUI 3.4% beside FUTA 0.6% and FICA 7.65% on one line');
});
await t('% of payroll quote: basis pct, decimal SUI, contribution % x EE-only premium, "no additional fees" = 0', () => {
  const r = extractQuote(fx('quote-pct.txt'), { filename: 'trinet.pdf' });
  assert.equal(val(r, 'feeBasis'), 'pct'); assert.equal(val(r, 'fee'), 3.25);
  assert.equal(val(r, 'setup'), 1500); assert.equal(val(r, 'suta'), 2.7); assert.equal(r.fields.suta.confidence, 'check');
  assert.equal(val(r, 'wc'), 0.29); assert.equal(val(r, 'epli'), 2.5); assert.equal(val(r, 'other'), 0);
  assert.equal(val(r, 'health'), Math.round(0.7 * 870 * 12)); assert.equal(r.fields.health.confidence, 'check');
  assert.equal(val(r, 'provider'), 'TriNet');
});
await t('per-check fee converted with the stated pay frequency; class codes payroll-weighted; group EPLI premium per head', () => {
  const r = extractQuote(fx('quote-weighted.txt'));
  near(val(r, 'fee'), 38.5 * 52 / 12, 'weekly per-check fee'); assert.equal(r.fields.fee.confidence, 'check');
  near(val(r, 'wc'), (0.12 * 1400000 + 9.4 * 600000) / 2000000, 'payroll-weighted WC');
  assert.equal(val(r, 'health'), 9600); near(val(r, 'epli'), 1920 / 32 / 12, 'EPLI per employee per month');
  assert.equal(val(r, 'other'), 3000); assert.equal(val(r, 'setup'), 0); assert.equal(val(r, 'provider'), 'Oasis');
});
await t('several WC class rates without payroll: fill nothing, offer each, warn against averaging', () => {
  const r = extractQuote(fx('quote-multiwc.txt'));
  assert.equal(val(r, 'wc'), undefined);
  assert.deepEqual(r.candidates.wc.map(c => c.value).sort((a, b) => a - b), [0.14, 6.85]);
  assert.ok(r.warnings.some(w => w.field === 'wc' && /weighted/.test(w.text)));
  assert.equal(val(r, 'fee'), 165); assert.equal(val(r, 'setup'), 2500); assert.equal(val(r, 'health'), 7200); assert.equal(val(r, 'other'), 540);
  assert.equal(r.common.employees.value, 40); assert.equal(r.common.wage.value, 65000);
});
await t('bundled pricing: warn, never put the bundled rate in the admin fee', () => {
  const r = extractQuote(fx('quote-bundled.txt'));
  assert.equal(r.bundled, true); assert.equal(val(r, 'fee'), undefined);
  assert.ok(/bundled/i.test(r.warnings[0].text) && /double count/.test(r.warnings[0].text));
  assert.equal(val(r, 'setup'), 0); assert.equal(val(r, 'provider'), 'Justworks');
});
await t('no text layer -> no_text, nothing invented', () => {
  const r = extractQuote(fx('quote-scan.txt'));
  assert.equal(r.outcome, 'no_text'); assert.deepEqual(r.fields, {});
});
await t('unknown stays unknown: a quote silent on EPLI/other leaves them blank (never 0)', () => {
  const r = extractQuote('Acme PEO proposal for 12 employees\nAdministrative fee: $139 per employee per month\nSUTA 2.7%\nWorkers comp $0.45 per $100 of payroll\nSetup fee $750');
  assert.equal(val(r, 'epli'), undefined); assert.equal(val(r, 'other'), undefined); assert.equal(val(r, 'health'), undefined);
  assert.equal(r.outcome, 'partial'); assert.equal(val(r, 'fee'), 139);
});
await t('per-check fee with no pay frequency is not converted', () => {
  const r = extractQuote('Proposal for 20 employees\nAdmin fee $42 per check\nSUTA 2.7%\nWorkers comp 0.5 per $100\nSetup $0');
  assert.equal(val(r, 'fee'), undefined); assert.ok(r.candidates.fee.some(c => c.value === null && /pay frequency/.test(c.note)));
});
await t('termination fees are not setup fees; years and class codes are not amounts', () => {
  const r = extractQuote('Pricing for 2026\nEarly termination fee: $5,000\nImplementation fee: $1,200\nWorkers comp class 8810 rate 0.11 per $100\nAdmin fee $120 PEPM effective 2026');
  assert.equal(val(r, 'setup'), 1200); assert.equal(val(r, 'wc'), 0.11); assert.equal(val(r, 'fee'), 120);
});
await t('number tokenizer', () => {
  assert.deepEqual(I.numbers('$1,250.00 and 2.7% and .85 and (1,000)').map(n => n.v), [1250, 2.7, 0.85, 1000]);
  assert.ok(I.numbers('2.6%')[0].pct && I.numbers('$5')[0].dollar);
});
await t('CSV reader keeps quoted commas and joins cells', () => {
  assert.equal(I.csvToText('"Admin fee","$1,149.00 PEPM"\nSUTA,2.6%\n', ','), 'Admin fee | $1,149.00 PEPM\nSUTA | 2.6%');
});

// ---- real Office files written by LibreOffice (deflate ZIP, shared strings, % number formats, Word tables)
let soffice = null; for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']) if (fs.existsSync(p)) soffice = p;
if (soffice) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peon-parse-'));
  fs.writeFileSync(path.join(dir, 'q.csv'), 'Insperity pricing,\nNumber of employees,25\nAdministrative fee per employee per month,$149.00\nImplementation fee,Waived\nSUTA rate,2.6%\nWorkers comp per $100 of payroll,0.31\nEmployer health contribution per enrollee per year,"$7,348.80"\nEPLI,Included\nOther fees,None\n');
  execFileSync(soffice, ['--headless', '--infilter=CSV:44,34,76,1', '--convert-to', 'xlsx', '--outdir', dir, path.join(dir, 'q.csv')], { stdio: 'ignore', timeout: 120000 });
  fs.writeFileSync(path.join(dir, 'd.html'), '<html><body><h1>TriNet proposal</h1><p>Headcount: 25 employees</p><table><tr><td>Service fee</td><td>3.25% of gross payroll</td></tr><tr><td>Setup fee</td><td>$1,500</td></tr><tr><td>SUI rate</td><td>2.7%</td></tr><tr><td>Workers comp</td><td>$0.29 per $100</td></tr><tr><td>Employer medical contribution</td><td>$600 per employee per month</td></tr><tr><td>EPLI</td><td>$2.50 PEPM</td></tr></table><p>No additional fees.</p></body></html>');
  execFileSync(soffice, ['--headless', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', dir, path.join(dir, 'd.html')], { stdio: 'ignore', timeout: 120000 });
  await t('XLSX from LibreOffice: % cells read as percents, fields extracted', async () => {
    const text = await I.readXlsx(fs.readFileSync(path.join(dir, 'q.xlsx')));
    assert.ok(/SUTA rate \| 2\.6%/.test(text), 'percent cell rendered as 2.6% not 0.026: ' + text.split('\n').find(l => /SUTA/.test(l)));
    const r = extractQuote(text);
    assert.equal(val(r, 'fee'), 149); assert.equal(val(r, 'suta'), 2.6); assert.equal(val(r, 'wc'), 0.31);
    assert.equal(val(r, 'health'), 7348.8); assert.equal(val(r, 'epli'), 0); assert.equal(val(r, 'setup'), 0); assert.equal(val(r, 'other'), 0);
    assert.equal(r.outcome, 'complete');
  });
  await t('DOCX from LibreOffice: table rows become label | value lines', async () => {
    const text = await I.readDocx(fs.readFileSync(path.join(dir, 'd.docx')));
    assert.ok(text.includes('Service fee | 3.25% of gross payroll'), text);
    const r = extractQuote(text);
    assert.equal(val(r, 'feeBasis'), 'pct'); assert.equal(val(r, 'fee'), 3.25); assert.equal(val(r, 'setup'), 1500);
    assert.equal(val(r, 'suta'), 2.7); assert.equal(val(r, 'wc'), 0.29); assert.equal(val(r, 'health'), 7200); assert.equal(val(r, 'epli'), 2.5); assert.equal(val(r, 'other'), 0);
  });
} else console.log('  (LibreOffice not found — XLSX/DOCX reader checks skipped)');

console.log(`quote parse: ${pass} passed`);
