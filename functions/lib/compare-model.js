/* Server-side Quote Comparator model for the emailed comparison report.
   Never trusts client totals: inputs are range-checked and recomputed here with the
   same arithmetic as assets/js/quote-compare.js (parity tested in tests/test_compare_report.mjs).
   Analysis and "questions to ask" are deterministic rules over the entered terms — no LLM,
   no invented figures. */
export const REQUIRED = ['fee', 'setup', 'suta', 'wc', 'health', 'epli', 'other'];
export const LINES = ['Admin', 'SUTA', 'Workers comp', 'Employer health', 'EPLI', 'Other', 'Year-one setup'];
const NAMES = { fee: 'admin fee', setup: 'setup fee', suta: 'SUTA rate', wc: "workers' comp rate", health: 'employer health cost', epli: 'EPLI', other: 'other charges' };
const LIMITS = { fee: 100000, setup: 10000000, suta: 30, wc: 100, health: 100000, epli: 10000, other: 100000000 };
const SRC = new Set(['file', 'check', 'typed', 'edited']);

const num = (x, lo, hi, allowNull) => {
  if (allowNull && (x === null || x === undefined || x === '')) return null;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi) throw new Error('invalid input');
  return x;
};
const label = (s, fallback) => String(s || '').replace(/[\x00-\x1f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

export function parseCompare(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid compare');
  const c = raw.common || {};
  const common = {
    employees: Math.floor(num(c.employees, 1, 100000)), wage: num(c.wage, 0, 5000000),
    enrollment: num(c.enrollment, 0, 100), sutaBase: num(c.sutaBase, 0, 1000000)
  };
  if (!Array.isArray(raw.quotes) || raw.quotes.length < 1 || raw.quotes.length > 3) throw new Error('invalid quotes');
  const quotes = raw.quotes.map((q, i) => {
    if (!q || typeof q !== 'object') throw new Error('invalid quote');
    const out = { label: label(q.label, 'Proposal ' + 'ABC'[i]), feeBasis: q.feeBasis === 'pct' ? 'pct' : 'pepm', src: {}, file: q.file ? 1 : 0 };
    for (const k of REQUIRED) out[k] = num(q[k], 0, LIMITS[k], true);
    if (out.feeBasis === 'pct' && out.fee !== null && out.fee > 100) throw new Error('invalid fee');
    const s = q.src && typeof q.src === 'object' ? q.src : {};
    for (const k of ['provider', 'feeBasis', ...REQUIRED]) if (SRC.has(s[k])) out.src[k] = s[k];
    return out;
  });
  return { common, quotes };
}

/* identical arithmetic to window.PEOCompare.evaluateQuotes (incl. partial lines for incomplete quotes) */
export function evaluate(common, quotes) {
  const { employees: n, wage: w, enrollment: e, sutaBase: base } = common;
  return quotes.map(q => {
    const N = Math.floor(n), payroll = N * w, has = k => q[k] !== null;
    const parts = {
      'Admin': !has('fee') ? null : q.feeBasis === 'pct' ? payroll * q.fee / 100 : N * q.fee * 12,
      'SUTA': has('suta') ? N * Math.min(w, base) * q.suta / 100 : null,
      'Workers comp': has('wc') ? payroll * q.wc / 100 : null,
      'Employer health': has('health') ? N * e / 100 * q.health : null,
      'EPLI': has('epli') ? N * q.epli * 12 : null,
      'Other': has('other') ? q.other : null,
      'Year-one setup': has('setup') ? q.setup : null
    };
    const missing = REQUIRED.filter(k => !has(k));
    if (missing.length) return { label: q.label, missing, parts };
    const recurring = LINES.filter(k => k !== 'Year-one setup').reduce((a, k) => a + parts[k], 0);
    return { label: q.label, parts, recurring, yearOne: recurring + q.setup, threeYear: recurring * 3 + q.setup, missing: [] };
  });
}
export const started = q => REQUIRED.some(k => q[k] !== null);

const money = v => (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const money2 = v => '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* Per-proposal analysis + questions. Rules only reference figures the visitor entered. */
export function analyze(c, evals) {
  const N = c.common.employees, payroll = N * c.common.wage;
  const done = evals.map((r, i) => ({ r, q: c.quotes[i], i })).filter(x => !x.r.missing.length);
  const low = done.length >= 2 ? done.reduce((a, b) => (b.r.yearOne < a.r.yearOne ? b : a)) : null;
  const out = evals.map((r, i) => {
    const q = c.quotes[i], complete = !r.missing.length;
    const stated = LINES.filter(k => k !== 'Year-one setup' && r.parts[k] !== null);
    const a = { label: r.label, complete, started: started(q), questions: [],
      statedAnnual: stated.reduce((t, k) => t + r.parts[k], 0), statedCount: stated.length,
      pepmAllIn: complete ? r.yearOne / N / 12 : null, gap: complete && low ? r.yearOne - low.r.yearOne : 0, driver: null };
    if (!a.started) { a.questions.push('No figures entered for this quote.'); return a; }
    if (complete && low && low.i !== i && a.gap > 0.5) {
      let best = null;
      for (const k of LINES) { const d = r.parts[k] - low.r.parts[k]; if (!best || d > best.d) best = { k, d }; }
      a.driver = { line: best.k, amount: best.d, share: best.d / a.gap };
    }
    if (!complete) a.questions.push(`Not stated: ${r.missing.map(k => NAMES[k] || k).join(', ')}. Ask ${r.label} to put ${r.missing.length > 1 ? 'these' : 'it'} in writing; until then this quote has no total.`);
    const others = c.quotes.filter((o, j) => j !== i && o.health !== null);
    if (q.fee !== null) {
      if (q.feeBasis === 'pct') a.questions.push(`The admin fee is ${q.fee}% of gross payroll (${money2(payroll * q.fee / 100 / N / 12)} per employee per month at your payroll). It rises with every raise and new hire; ask for a flat PEPM price or a cap.`);
      else a.questions.push(`Ask which workers the ${money2(q.fee)} PEPM counts: part-time, seasonal, employees terminated mid-month, and 1099 contractors.`);
    }
    if (q.setup === 0) a.questions.push('Setup is $0. Confirm the agreement has no termination, exit or data-transfer fee, and how much notice it requires to leave.');
    else if (q.setup !== null) a.questions.push(`Ask whether the ${money(q.setup)} setup fee is waived or credited for a multi-year term.`);
    if (q.suta !== null) {
      const lowerOthers = c.quotes.filter((o, j) => j !== i && o.suta !== null).map(o => o.suta);
      const sutaNote = lowerOthers.length && q.suta <= Math.min(...lowerOthers) - 0.5 ? ' This rate is at least 0.5 points below the other quotes; ask how long it is guaranteed.' : '';
      a.questions.push(`Ask whether SUTA (${q.suta}%) is reported under the PEO's state account or yours, and what rate you would carry if you leave.${sutaNote}`);
    }
    if (q.wc !== null) a.questions.push(`Ask for the class codes, the rate per code and the experience modifier behind ${q.wc} per $100 of payroll, and whether workers' comp is billed pay-as-you-go or by deposit.`);
    if (q.health !== null) {
      if (others.length) {
        const m = median(others.map(o => o.health)), dev = m > 0 ? (q.health - m) / m : 0;
        if (Math.abs(dev) >= 0.1) a.questions.push(`Employer health (${money(q.health)} per enrollee per year) is ${Math.round(Math.abs(dev) * 100)}% ${dev > 0 ? 'above' : 'below'} the other quote${others.length > 1 ? 's' : ''}. Confirm the same plans, network, contribution strategy and tier mix, and get the year-two renewal cap in writing.`);
        else a.questions.push('Health is in line with the other quotes. Get the year-two renewal cap in writing; health renewals usually move more than the admin fee.');
      } else a.questions.push('Get the year-two health renewal cap in writing.');
    }
    if (q.epli === 0) a.questions.push('EPLI shows $0. Get the limit, the deductible, and whether wage-and-hour claims are covered or excluded.');
    if (q.other === 0) a.questions.push('No other charges entered. Ask for the full fee schedule: per-check, year-end W-2 and ACA filing, technology, COBRA and garnishment fees.');
    const checks = Object.entries(q.src).filter(([, v]) => v === 'check').map(([k]) => NAMES[k] || k);
    if (checks.length) a.questions.push(`Read from your file but converted or inferred: ${checks.join(', ')}. Check these against the quote itself.`);
    return a;
  });
  return { per: out, low: low ? low.r : null, completeCount: done.length, startedCount: out.filter(a => a.started).length };
}

export function scenarioString(c) {
  const v = x => (x === null ? '?' : String(x));
  const cm = c.common;
  return ['compare', 'N=' + cm.employees, 'W=' + cm.wage, 'Enroll%=' + cm.enrollment, 'SUTAbase=' + cm.sutaBase,
    ...c.quotes.map((q, i) => `${'ABC'[i]}:${q.label.replace(/[|]/g, '/')}${q.file ? '(file)' : ''} ${q.feeBasis}=${v(q.fee)} setup=${v(q.setup)} suta=${v(q.suta)} wc=${v(q.wc)} health=${v(q.health)} epli=${v(q.epli)} other=${v(q.other)}`)].join(' | ').slice(0, 600);
}

/* PDF line objects for simple-pdf.js (ASCII-folded there). */
export function compareLines(c, evals, an) {
  const cols = evals.length, W = 20, LBL = 24;
  const head = s => s.length > W - 2 ? s.slice(0, W - 3) + '.' : s;
  const row = (name, vals) => name.padEnd(LBL, ' ').slice(0, LBL) + vals.map(x => x.padStart(W, ' ')).join('');
  const cell = (r, f) => r.missing.length ? 'Incomplete' : f(r);
  const line = (r, k) => r.parts[k] === null ? 'not stated' : money(r.parts[k]);
  const cm = c.common;
  const lines = [
    { t: 'PEONOMICS  |  PEO QUOTE COMPARISON', type: 'title' },
    { t: 'Generated ' + new Date().toISOString().slice(0, 10) + ' (UTC)  |  ' + cols + ' proposal' + (cols > 1 ? 's' : '') + ', ' + an.completeCount + ' complete' + (an.completeCount < cols ? ' (missing terms shown as "not stated")' : ''), type: 'small' },
    { t: `Assumptions applied to every proposal: ${cm.employees} employees, average wage ${money(cm.wage)} (payroll ${money(cm.employees * cm.wage)}), health enrollment ${cm.enrollment}%, SUTA taxable wage base ${money(cm.sutaBase)}.`, type: 'body' },
    { t: 'Employer FICA and FUTA are identical under every PEO and are left out. Compares only the terms entered; not a quote, not advice.', type: 'small' },
    { t: '', type: 'space' },
    { t: 'ANNUAL COST BY LINE', type: 'heading' },
    { t: row('', evals.map(r => head(r.label))), type: 'mono' }
  ];
  for (const k of LINES) lines.push({ t: row(k, evals.map(r => line(r, k))), type: 'mono' });
  if (evals.some(r => r.missing.length)) lines.push({ t: row('Stated so far, annual', an.per.map(a => a.complete ? '-' : money(a.statedAnnual))), type: 'mono' });
  lines.push({ t: row('Year one total', evals.map(r => cell(r, x => money(x.yearOne)))), type: 'monoBold' });
  lines.push({ t: row('Year two', evals.map(r => cell(r, x => money(x.recurring)))), type: 'mono' });
  lines.push({ t: row('Year three', evals.map(r => cell(r, x => money(x.recurring)))), type: 'mono' });
  lines.push({ t: row('Three-year total', evals.map(r => cell(r, x => money(x.threeYear)))), type: 'monoBold' });
  lines.push({ t: row('All-in PEPM, year one', an.per.map(a => a.complete ? money2(a.pepmAllIn) : 'Incomplete')), type: 'mono' });
  if (an.low) lines.push({ t: row('Above lowest, year one', an.per.map(a => a.complete ? (a.gap < 0.5 ? 'lowest' : '+' + money(a.gap)) : 'Incomplete')), type: 'mono' });
  if (evals.some(r => r.missing.length)) lines.push({ t: '"Stated so far" adds only the recurring lines a quote states. It is not a total and is not comparable across quotes.', type: 'small' });
  lines.push({ t: 'Years two and three repeat year-one pricing. Real renewals change; ask each provider for written caps.', type: 'small' });

  lines.push({ t: '', type: 'space' }, { t: 'WHAT SEPARATES THEM', type: 'heading' });
  const gaps = an.per.filter(a => a.complete && a.driver);
  if (!an.low) lines.push({ t: `${an.completeCount === 1 ? 'One complete proposal' : 'No complete proposals'} so far, so no ranking yet. The questions below are what it takes to fill in the missing terms; once they are stated, every quote gets a total on the same terms.`, type: 'body' });
  else if (!gaps.length) lines.push({ t: 'All complete proposals have the same first-year cost.', type: 'body' });
  for (const a of gaps) {
    const share = a.driver.share > 1 ? 'more than the whole gap (other lines are cheaper)' : Math.round(a.driver.share * 100) + '% of it';
    lines.push({ t: `${a.label} costs ${money(a.gap)} more than ${an.low.label} in year one. The largest difference is ${a.driver.line}: ${money(a.driver.amount)}, ${share}.`, type: 'body' });
  }

  lines.push({ t: '', type: 'space' }, { t: 'TERMS AS ENTERED', type: 'heading' });
  lines.push({ t: '(file) = read from your uploaded quote; (check) = converted or inferred from it; (edited) = changed after reading. Unmarked = typed.', type: 'small' });
  const tag = (q, k) => q.src[k] && q.src[k] !== 'typed' ? ' (' + q.src[k] + ')' : '';
  const v = (q, k, f) => q[k] === null ? 'not stated' : f(q[k]) + tag(q, k);
  c.quotes.forEach(q => {
    lines.push({ t: q.label + tag(q, 'provider'), type: 'heading' });
    lines.push({ t: 'Admin fee: ' + (q.fee === null ? 'not stated' : (q.feeBasis === 'pct' ? q.fee + '% of gross payroll' : money2(q.fee) + ' per employee per month') + tag(q, 'fee')) +
      '  |  Setup: ' + v(q, 'setup', money) + '  |  SUTA: ' + v(q, 'suta', x => x + '%') + '  |  WC: ' + v(q, 'wc', x => x + ' per $100'), type: 'body' });
    lines.push({ t: 'Employer health: ' + v(q, 'health', x => money(x) + ' per enrollee per year') + '  |  EPLI: ' + v(q, 'epli', x => money2(x) + ' PEPM') + '  |  Other: ' + v(q, 'other', x => money(x) + ' a year'), type: 'body' });
  });

  lines.push({ t: '', type: 'space' }, { t: 'QUESTIONS TO PUT TO EACH PROVIDER BEFORE YOU SIGN', type: 'heading' });
  an.per.forEach(a => {
    lines.push({ t: a.label, type: 'heading' });
    a.questions.forEach((qq, n) => lines.push({ t: (n + 1) + '. ' + qq, type: 'body' }));
  });
  lines.push({ t: 'All providers: three-year totals assume flat pricing. Ask each for year-two and year-three caps on the admin fee and workers\' comp.', type: 'body' });

  lines.push({ t: '', type: 'space' }, { t: 'LIMITATIONS', type: 'heading' },
    { t: 'Every figure comes from what you entered or what was read from your files in your browser. PEOnomics did not receive your files.', type: 'body' },
    { t: 'Health uses one employer cost per enrollee for everyone; family tiers and contribution strategy change it. WC uses one rate for all payroll.', type: 'body' },
    { t: 'Unstated fees, plan design, service levels and contract terms are not compared. Verify every figure against the signed documents.', type: 'body' },
    { t: 'PEOnomics favors no provider and does not sell or send your information to PEO providers.', type: 'small' },
    { t: 'https://peonomics.com/compare', type: 'small' });
  return lines;
}
