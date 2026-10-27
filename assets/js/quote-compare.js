/* PEOnomics Quote Comparator — all arithmetic stays in the browser.
   Missing price != zero: a blank field is "unknown", and a proposal with any
   unknown required field gets no total. Pure math in `evaluateQuotes` (exported
   on window.PEOCompare for tests). */
(() => {
  'use strict';
  const FIELDS = [
    ['provider', 'Provider / offer label', 'text'],
    ['feeBasis', 'Admin fee basis', 'select'],
    ['fee', 'Admin fee ($ PEPM or % of payroll)', 'number'],
    ['setup', 'One-time implementation ($)', 'number'],
    ['suta', 'SUTA rate (%)', 'number'],
    ['wc', "Workers' comp ($ per $100 payroll)", 'number'],
    ['health', 'Employer health $ / enrollee / yr', 'number'],
    ['epli', 'EPLI $ per employee / month', 'number'],
    ['other', 'Other recurring charges ($ / yr)', 'number']
  ];
  const REQUIRED = ['fee', 'setup', 'suta', 'wc', 'health', 'epli', 'other'];
  const LINES = ['Admin', 'SUTA', 'Workers comp', 'Employer health', 'EPLI', 'Other', 'Year-one setup', 'Year one total', 'Three-year total'];
  const valid = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

  /* common = {employees, wage, enrollment, sutaBase}; quotes = [{label, feeBasis, fee, setup, ...}] (null = blank) */
  function evaluateQuotes(common, quotes) {
    const { employees: n, wage: w, enrollment: e, sutaBase: base } = common;
    if (!valid(n) || n < 1 || !valid(w) || !valid(e) || e > 100 || !valid(base)) return null;
    return quotes.map(q => {
      const missing = REQUIRED.filter(k => !valid(q[k]));
      if (missing.length) return { label: q.label, missing };
      if (q.suta > 30 || q.wc > 100 || (q.feeBasis === 'pct' && q.fee > 100)) return { label: q.label, missing: ['out-of-range rate'] };
      const N = Math.floor(n), payroll = N * w;
      const parts = {
        'Admin': q.feeBasis === 'pct' ? payroll * q.fee / 100 : N * q.fee * 12,
        'SUTA': N * Math.min(w, base) * q.suta / 100,
        'Workers comp': payroll * q.wc / 100,
        'Employer health': N * e / 100 * q.health,
        'EPLI': N * q.epli * 12,
        'Other': q.other,
        'Year-one setup': q.setup
      };
      const recurring = Object.entries(parts).filter(([k]) => k !== 'Year-one setup').reduce((a, [, v]) => a + v, 0);
      return { label: q.label, parts, recurring, yearOne: recurring + q.setup, threeYear: recurring * 3 + q.setup, missing: [] };
    });
  }
  window.PEOCompare = { evaluateQuotes, LINES };

  const root = typeof document !== 'undefined' && document.getElementById('compareCards');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const COLS = ['A', 'B', 'C'];
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  for (const letter of COLS) {
    const card = document.createElement('div'); card.className = 'compare-card';
    const h = document.createElement('h3'); h.textContent = 'Proposal ' + letter; card.append(h);
    for (const [id, label, type] of FIELDS) {
      const field = document.createElement('div'); field.className = 'field'; field.dataset.key = id;
      const lab = document.createElement('label'); lab.htmlFor = letter + '-' + id; lab.textContent = label;
      let input;
      if (type === 'select') {
        input = document.createElement('select');
        for (const [v, t] of [['pepm', 'Per employee per month (PEPM)'], ['pct', '% of gross payroll']]) {
          const o = document.createElement('option'); o.value = v; o.textContent = t; input.append(o);
        }
      } else {
        input = document.createElement('input'); input.type = type;
        if (type === 'number') { input.min = '0'; input.step = 'any'; input.inputMode = 'decimal'; input.placeholder = 'Not stated'; }
        else { input.placeholder = 'e.g. Provider X, 2026 renewal'; input.maxLength = 60; }
      }
      input.id = letter + '-' + id;
      field.append(lab, input); card.append(field);
    }
    root.append(card);
  }

  const read = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  const gather = () => evaluateQuotes(
    { employees: read('c-employees'), wage: read('c-wage'), enrollment: read('c-enrollment'), sutaBase: read('c-sutaBase') },
    COLS.map(L => {
      const q = { label: $(L + '-provider').value.trim() || 'Proposal ' + L, feeBasis: $(L + '-feeBasis').value };
      for (const k of REQUIRED) q[k] = read(L + '-' + k);
      return q;
    })
  );

  function draw() {
    const list = gather(), body = $('compareRows'), status = $('comparisonStatus');
    body.replaceChildren();
    document.querySelectorAll('.compare-card .field').forEach(f => f.classList.remove('is-missing'));
    if (!list) { status.textContent = 'Enter valid common assumptions (employees ≥ 1, enrollment 0–100%).'; return; }
    list.forEach((q, ix) => {
      const L = COLS[ix];
      const started = REQUIRED.some(k => $(L + '-' + k).value.trim() !== '');
      if (started) for (const k of q.missing) document.querySelector(`#compareCards .compare-card:nth-child(${ix + 1}) [data-key="${k}"]`)?.classList.add('is-missing');
    });
    const ready = list.filter(x => !x.missing.length);
    const low = ready.length >= 2 ? Math.min(...ready.map(x => x.yearOne)) : null;
    const headRow = document.querySelectorAll('.compare-table thead th');
    list.forEach((q, i) => { if (headRow[i + 1]) headRow[i + 1].textContent = q.label; });
    for (const line of LINES) {
      const tr = document.createElement('tr'); if (line.includes('total')) tr.className = 'total';
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = line; tr.append(th);
      for (const q of list) {
        const td = document.createElement('td');
        if (q.missing.length) { td.textContent = 'Incomplete'; td.className = 'incomplete'; td.title = 'Missing: ' + q.missing.join(', '); }
        else {
          const v = line === 'Year one total' ? q.yearOne : line === 'Three-year total' ? q.threeYear : q.parts[line];
          td.textContent = money(v);
          if (line === 'Year one total' && low !== null && Math.abs(q.yearOne - low) < 0.5) td.classList.add('lowest');
        }
        tr.append(td);
      }
      body.append(tr);
    }
    if (ready.length >= 1) { window.peoTrack && window.peoTrack('comparator_used', {}, { once: true }); }
    status.textContent = ready.length < 2
      ? 'Fill every pricing field for at least two proposals. Blank means not stated; 0 means a documented zero charge.'
      : `${ready.length} complete proposals. Lowest entered first-year cost: ${ready.filter(x => Math.abs(x.yearOne - low) < 0.5).map(x => x.label).join(' / ')}. This compares only what the quotes state.`;
  }

  document.querySelectorAll('.compare-main input, .compare-main select').forEach(el => el.addEventListener('input', draw));
  $('downloadCompare').addEventListener('click', () => {
    const list = gather(); if (!list) return;
    window.peoTrack && window.peoTrack('comparator_csv');
    const esc = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const rows = [['PEOnomics quote comparison', ...list.map(x => x.label)],
      ...LINES.map(k => [k, ...list.map(x => x.missing.length ? 'INCOMPLETE' : (k === 'Year one total' ? x.yearOne : k === 'Three-year total' ? x.threeYear : x.parts[k]).toFixed(2))]),
      ['Note', 'Only user-entered pricing is compared; charges a quote does not state are not included.']];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'PEOnomics_quote_comparison.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  draw();
})();
