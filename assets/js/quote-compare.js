/* PEOnomics Quote Comparator — all arithmetic stays in the browser.
   Missing price != zero: a blank field is "unknown", and a proposal with any
   unknown required field gets no total. Pure math in `evaluateQuotes` (exported
   on window.PEOCompare for tests). Dropped quote files are read in the browser by
   quote-parse.js; every figure taken from a file shows the line it came from and
   stays editable. */
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
  const NAMES = { fee: 'admin fee', setup: 'setup', suta: 'SUTA', wc: "workers' comp", health: 'health', epli: 'EPLI', other: 'other charges' };
  const valid = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

  /* common = {employees, wage, enrollment, sutaBase}; quotes = [{label, feeBasis, fee, setup, ...}] (null = blank) */
  function evaluateQuotes(common, quotes) {
    const { employees: n, wage: w, enrollment: e, sutaBase: base } = common;
    if (!valid(n) || n < 1 || !valid(w) || !valid(e) || e > 100 || !valid(base)) return null;
    return quotes.map(q => {
      if ((valid(q.suta) && q.suta > 30) || (valid(q.wc) && q.wc > 100) || (q.feeBasis === 'pct' && valid(q.fee) && q.fee > 100)) return { label: q.label, missing: ['out-of-range rate'], parts: {} };
      const N = Math.floor(n), payroll = N * w;
      const has = k => valid(q[k]);
      // every line that can be priced from what the quote states; null = not stated
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
      const recurring = Object.entries(parts).filter(([k]) => k !== 'Year-one setup').reduce((a, [, v]) => a + v, 0);
      return { label: q.label, parts, recurring, yearOne: recurring + q.setup, threeYear: recurring * 3 + q.setup, missing: [] };
    });
  }
  window.PEOCompare = { evaluateQuotes, LINES, REQUIRED };

  const root = typeof document !== 'undefined' && document.getElementById('compareCards');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const COLS = ['A', 'B', 'C'];
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const track = (name, props, opts) => window.peoTrack && window.peoTrack(name, props || {}, opts);

  /* src[L][key] = 'file' | 'check' | 'typed' | 'edited' — where each figure came from (sent with a report) */
  const src = Object.fromEntries(COLS.map(L => [L, {}]));
  const loaded = {};               // L -> file name
  const touchedCommon = new Set(); // common fields the visitor typed (files never overwrite these)
  const commonFrom = {};           // common field -> proposal letter whose file set it

  for (const letter of COLS) {
    const card = el('div', 'compare-card'); card.dataset.letter = letter;
    const head = el('div', 'card-head');
    head.append(el('h3', '', 'Proposal ' + letter));
    const tools = el('div', 'card-tools');
    const pick = el('label', 'card-load'); pick.htmlFor = letter + '-file'; pick.textContent = 'Load quote file';
    const input = document.createElement('input'); input.type = 'file'; input.id = letter + '-file'; input.className = 'sr-file';
    input.accept = '.pdf,.xlsx,.xlsm,.docx,.csv,.tsv,.txt,application/pdf';
    input.addEventListener('change', () => { if (input.files[0]) loadInto(letter, input.files[0]); input.value = ''; });
    const clear = el('button', 'card-clear', 'Clear'); clear.type = 'button';
    clear.addEventListener('click', () => { resetCard(letter); draw(); });
    tools.append(pick, input, clear); head.append(tools); card.append(head);
    const status = el('div', 'card-status'); status.id = letter + '-status'; status.setAttribute('aria-live', 'polite'); card.append(status);
    for (const [id, label, type] of FIELDS) {
      const field = el('div', 'field'); field.dataset.key = id;
      const lab = el('label', '', label); lab.htmlFor = letter + '-' + id;
      let inp;
      if (type === 'select') {
        inp = document.createElement('select');
        for (const [v, t] of [['pepm', 'Per employee per month (PEPM)'], ['pct', '% of gross payroll']]) {
          const o = el('option', '', t); o.value = v; inp.append(o);
        }
      } else {
        inp = document.createElement('input'); inp.type = type;
        if (type === 'number') { inp.min = '0'; inp.step = 'any'; inp.inputMode = 'decimal'; inp.placeholder = 'Not stated'; }
        else { inp.placeholder = 'e.g. Provider X, 2026 renewal'; inp.maxLength = 60; }
      }
      inp.id = letter + '-' + id;
      inp.addEventListener('input', () => {
        src[letter][id] = src[letter][id] === 'file' || src[letter][id] === 'check' || src[letter][id] === 'edited' ? 'edited' : 'typed';
        field.classList.remove('is-parsed', 'is-check');
        const ev = field.querySelector('.evidence .basis'); if (ev) { ev.className = 'basis basis-user'; ev.textContent = 'Edited'; }
      });
      field.append(lab, inp);
      field.append(Object.assign(el('div', 'evidence'), { id: letter + '-' + id + '-ev' }));
      card.append(field);
    }
    card.append(Object.assign(el('ul', 'card-warn'), { id: letter + '-warn' }));
    // drop a file straight onto a card to (re)load that proposal
    card.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); card.classList.add('is-drop'); } });
    card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('is-drop'); });
    card.addEventListener('drop', e => {
      if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); card.classList.remove('is-drop');
      const f = e.dataTransfer.files[0]; if (f) loadInto(letter, f);
      if (e.dataTransfer.files.length > 1) setDropStatus('One file per proposal card — only ' + f.name + ' was loaded into Proposal ' + letter + '. Drop several files on the box above to fill empty proposals.');
    });
    root.append(card);
  }

  const read = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  const commonValues = () => ({ employees: read('c-employees'), wage: read('c-wage'), enrollment: read('c-enrollment'), sutaBase: read('c-sutaBase') });
  const quoteValues = () => COLS.map(L => {
    const q = { label: $(L + '-provider').value.trim() || 'Proposal ' + L, feeBasis: $(L + '-feeBasis').value };
    for (const k of REQUIRED) q[k] = read(L + '-' + k);
    return q;
  });
  const gather = () => evaluateQuotes(commonValues(), quoteValues());

  /* ------------------------------------------------------------ file loading */
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const cardEmpty = L => !loaded[L] && FIELDS.every(([k, , t]) => t === 'select' || $(L + '-' + k).value.trim() === '');
  const setDropStatus = msg => { $('dropStatus').textContent = msg; };
  const ERR = {
    image: "That's an image. The comparator reads text, not pictures: export the quote as a PDF or spreadsheet, or type the numbers in.",
    legacy_office: 'Old .xls / .doc files are not supported. Re-save as .xlsx or .docx (or PDF) and drop it again.',
    too_large: 'That file is over 15 MB. Drop the pricing pages only, or type the numbers in.',
    unsupported: 'Unsupported file type. Use PDF, XLSX, DOCX, CSV or TXT.',
    pdf_unavailable: "The PDF reader couldn't load (offline or blocked by a browser extension). Try the spreadsheet version, or type the numbers in.",
    unreadable: "That file couldn't be read. It may be damaged or password-protected.",
    no_text: 'No readable text in this file: it looks like a scan or a photo of the quote. Type the numbers in, or ask the PEO for a text PDF or the spreadsheet.',
    none_found: 'File read, but no pricing lines we recognize. Type the numbers in.'
  };

  function resetCard(L) {
    for (const [k, , t] of FIELDS) {
      const inp = $(L + '-' + k); inp.value = t === 'select' ? 'pepm' : '';
      const f = inp.closest('.field'); f.classList.remove('is-parsed', 'is-check');
      $(L + '-' + k + '-ev').replaceChildren();
    }
    $(L + '-warn').replaceChildren(); $(L + '-status').replaceChildren();
    delete loaded[L]; src[L] = {};
    for (const [k, from] of Object.entries(commonFrom)) if (from === L) delete commonFrom[k];
    refreshCommonNotes();
  }

  async function loadInto(L, file) {
    const P = window.PEOQuoteParse;
    const status = $(L + '-status');
    if (!P) { status.replaceChildren(el('p', 'card-error', 'The file reader did not load. Type the numbers in.')); return; }
    resetCard(L);
    status.replaceChildren(el('p', 'card-reading', 'Reading ' + file.name + '…'));
    let res;
    try { res = await P.readQuoteFile(file); } catch { res = { error: 'unreadable' }; }
    if (res.error) { status.replaceChildren(el('p', 'card-error', file.name + ': ' + ERR[res.error])); track('quote_parsed', { outcome: res.error }); draw(); return; }
    const parsed = P.extractQuote(res.text, { filename: file.name, employees: read('c-employees') });
    track('quote_parsed', { outcome: parsed.outcome + '_' + res.kind });
    if (parsed.outcome === 'no_text' || parsed.outcome === 'none_found') {
      status.replaceChildren(el('p', 'card-error', file.name + ': ' + ERR[parsed.outcome])); draw(); return;
    }
    loaded[L] = file.name;
    applyParsed(L, parsed, file.name);
    draw();
  }

  function setField(L, key, value) {
    const inp = $(L + '-' + key);
    inp.value = typeof value === 'number' ? String(Math.round(value * 10000) / 10000) : String(value);
  }

  function evidence(L, key, item, alts) {
    const box = $(L + '-' + key + '-ev'); box.replaceChildren();
    const field = box.closest('.field');
    if (item) {
      const tag = el('span', item.confidence === 'found' ? 'basis basis-stat' : 'basis basis-est', item.confidence === 'found' ? 'From file' : 'Check');
      const p = el('p', 'ev-line'); p.append(tag, ' ');
      if (item.note) p.append(el('span', 'ev-note', item.note + ' '));
      if (item.evidence) p.append(el('q', 'ev-quote', item.evidence));
      box.append(p);
      field.classList.add(item.confidence === 'found' ? 'is-parsed' : 'is-check');
    }
    const usable = (alts || []).filter(c => c.value !== null && c.value !== undefined);
    const notes = (alts || []).filter(c => c.value === null && c.note);
    if (usable.length) {
      const p = el('p', 'ev-alts', item ? 'Also in the file: ' : 'Found in the file (pick one): ');
      for (const c of usable) {
        const b = el('button', 'ev-chip', (key === 'fee' && c.basis === 'pct') ? c.value + '%' : String(c.value)); b.type = 'button';
        b.title = [c.note, c.evidence].filter(Boolean).join(' — ');
        b.addEventListener('click', () => {
          setField(L, key, c.value);
          if (key === 'fee' && c.basis) $(L + '-feeBasis').value = c.basis;
          src[L][key] = 'check'; evidence(L, key, { ...c, confidence: 'check' }, alts.filter(x => x !== c)); draw();
        });
        p.append(b, ' ');
      }
      box.append(p);
    }
    for (const c of notes) box.append(el('p', 'ev-alts', 'In the file but not convertible: ' + c.note + '.'));
  }

  function applyParsed(L, r, filename) {
    const f = r.fields;
    if (f.provider) { setField(L, 'provider', f.provider.value); src[L].provider = 'file'; evidence(L, 'provider', f.provider); }
    if (f.feeBasis) { $(L + '-feeBasis').value = f.feeBasis.value; src[L].feeBasis = f.feeBasis.confidence === 'found' ? 'file' : 'check'; }
    for (const k of REQUIRED) {
      if (f[k] && f[k].value !== null && f[k].value !== undefined) { setField(L, k, f[k].value); src[L][k] = f[k].confidence === 'found' ? 'file' : 'check'; }
      if (f[k] || r.candidates[k]) evidence(L, k, f[k] && f[k].value !== null ? f[k] : null, r.candidates[k]);
    }
    if (f.feeBasis) $(L + '-feeBasis-ev').replaceChildren(el('p', 'ev-line', f.feeBasis.value === 'pct' ? 'Set from the file: % of gross payroll.' : 'Set from the file: per employee per month.'));
    // common assumptions: fill blanks/defaults the visitor hasn't typed; flag disagreements
    for (const [k, id] of [['employees', 'c-employees'], ['wage', 'c-wage'], ['enrollment', 'c-enrollment'], ['sutaBase', 'c-sutaBase']]) {
      const c = r.common[k]; if (!c) continue;
      if (!touchedCommon.has(k) && !commonFrom[k]) { $(id).value = String(c.value); commonFrom[k] = L; $(id).closest('.field').classList.add('is-parsed'); }
    }
    refreshCommonNotes(r, L);
    const warn = $(L + '-warn'); warn.replaceChildren();
    for (const w of r.warnings) warn.append(el('li', '', w.text));
    const found = REQUIRED.filter(k => f[k] && f[k].value !== null && f[k].value !== undefined);
    const checks = found.filter(k => f[k].confidence !== 'found').length;
    const missing = REQUIRED.filter(k => !found.includes(k));
    const st = $(L + '-status'); st.replaceChildren();
    const p = el('p', 'card-read');
    p.append(el('strong', '', filename), ` — ${found.length} of ${REQUIRED.length} pricing figures found` + (checks ? `, ${checks} to check.` : '.'));
    st.append(p);
    if (missing.length) st.append(el('p', 'card-missing', 'Not in the file: ' + missing.map(k => NAMES[k]).join(', ') + '. Blank stays "not stated" until you type a number (0 only if the quote says so).'));
  }

  const parsedCommon = {}; // L -> common facts from that file, for conflict notes
  function refreshCommonNotes(r, L) {
    if (r && L) parsedCommon[L] = r.common;
    for (const k of Object.keys(parsedCommon)) if (!loaded[k] && k !== L) delete parsedCommon[k];
    const ul = $('assumptionNotes'); ul.replaceChildren();
    const labels = { employees: 'employees', wage: 'average wage', enrollment: 'health enrollment', sutaBase: 'SUTA wage base' };
    const fmt = (k, v) => k === 'employees' ? String(v) : k === 'enrollment' ? v + '%' : money(v);
    for (const [k, id] of [['employees', 'c-employees'], ['wage', 'c-wage'], ['enrollment', 'c-enrollment'], ['sutaBase', 'c-sutaBase']]) {
      const cur = read(id);
      if (commonFrom[k]) { const c = parsedCommon[commonFrom[k]] && parsedCommon[commonFrom[k]][k]; if (c) ul.append(el('li', '', `${labels[k][0].toUpperCase() + labels[k].slice(1)} ${fmt(k, c.value)} taken from Proposal ${commonFrom[k]}'s file${c.note ? ' (' + c.note + ')' : ''}.`)); }
      for (const [P, facts] of Object.entries(parsedCommon)) {
        const c = facts && facts[k];
        if (c && cur !== null && Math.abs(c.value - cur) > (k === 'enrollment' ? 1 : k === 'wage' ? 500 : 0.5))
          ul.append(Object.assign(el('li', 'is-conflict', `Proposal ${P}'s file states ${fmt(k, c.value)} for ${labels[k]}; the comparison uses ${fmt(k, cur)}. Quotes priced on different ${labels[k]} figures are not comparable — ask the PEO to re-quote on the same census.`)));
      }
    }
  }

  /* global drop zone: fill the empty proposals in order */
  const zone = $('quoteDrop'), many = $('quoteFiles');
  async function takeFiles(list) {
    const files = [...list].slice(0, 3);
    if (list.length > 3) setDropStatus('Up to three files at a time — the first three were used.');
    const empty = COLS.filter(cardEmpty);
    if (!empty.length) { setDropStatus('All three proposals already have numbers. Drop a file onto a proposal card to replace it, or Clear one first.'); return; }
    if (files.length > empty.length) setDropStatus(`Only ${empty.length} empty proposal${empty.length > 1 ? 's' : ''} left — ${files.slice(empty.length).map(f => f.name).join(', ')} not loaded.`);
    else if (list.length <= 3) setDropStatus('');
    zone.closest('section').querySelector('.compare-cards').scrollIntoView({ behavior: 'smooth', block: 'start' });
    // one at a time, in order, so Proposal A's file (not the fastest parse) sets shared assumptions
    const targets = files.slice(0, empty.length);
    targets.forEach((f, i) => $(empty[i] + '-status').replaceChildren(el('p', 'card-reading', 'Queued: ' + f.name)));
    for (let i = 0; i < targets.length; i++) await loadInto(empty[i], targets[i]);
  }
  if (zone) {
    zone.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); zone.classList.add('is-drop'); } });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-drop'); });
    zone.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); zone.classList.remove('is-drop'); takeFiles(e.dataTransfer.files); });
    many.addEventListener('change', () => { takeFiles(many.files); many.value = ''; });
    // a file dropped anywhere else on the page would navigate away from the comparison
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });
  }

  /* ------------------------------------------------------------ table */
  function draw() {
    const list = gather(), body = $('compareRows'), status = $('comparisonStatus');
    body.replaceChildren();
    document.querySelectorAll('.compare-card .field').forEach(f => f.classList.remove('is-missing'));
    refreshCommonNotes();
    if (!list) { status.textContent = 'Enter valid common assumptions (employees ≥ 1, enrollment 0–100%).'; document.dispatchEvent(new CustomEvent('peo:compare', { detail: null })); return; }
    list.forEach((q, ix) => {
      const L = COLS[ix];
      const started = loaded[L] || REQUIRED.some(k => $(L + '-' + k).value.trim() !== '');
      if (started) for (const k of q.missing) document.querySelector(`#compareCards .compare-card:nth-child(${ix + 1}) [data-key="${k}"]`)?.classList.add('is-missing');
    });
    const ready = list.filter(x => !x.missing.length);
    const low = ready.length >= 2 ? Math.min(...ready.map(x => x.yearOne)) : null;
    const headRow = document.querySelectorAll('.compare-table thead th');
    list.forEach((q, i) => { if (headRow[i + 1]) headRow[i + 1].textContent = q.label; });
    for (const line of LINES) {
      const tr = el('tr', line.includes('total') ? 'total' : '');
      const th = el('th', '', line); th.scope = 'row'; tr.append(th);
      for (const q of list) {
        const td = document.createElement('td');
        const lineVal = q.parts && q.parts[line];
        if (q.missing.length && (line.includes('total') || lineVal === null || lineVal === undefined)) {
          td.textContent = line.includes('total') ? 'Incomplete' : 'Not stated';
          td.className = line.includes('total') ? 'incomplete' : 'unstated'; td.title = 'Missing: ' + q.missing.join(', ');
        } else if (q.missing.length) td.textContent = money(lineVal);
        else {
          const v = line === 'Year one total' ? q.yearOne : line === 'Three-year total' ? q.threeYear : q.parts[line];
          td.textContent = money(v);
          if (line === 'Year one total' && low !== null && Math.abs(q.yearOne - low) < 0.5) td.classList.add('lowest');
        }
        tr.append(td);
      }
      body.append(tr);
    }
    if (ready.length >= 1) track('comparator_used', {}, { once: true });
    status.textContent = ready.length < 2
      ? 'Fill every pricing field for at least two proposals. Blank means not stated; 0 means a documented zero charge.'
      : `${ready.length} complete proposals. Lowest entered first-year cost: ${ready.filter(x => Math.abs(x.yearOne - low) < 0.5).map(x => x.label).join(' / ')}. This compares only what the quotes state.`;
    document.dispatchEvent(new CustomEvent('peo:compare', { detail: { list, ready, low } }));
  }

  /* snapshot for the emailed report: raw inputs + where each figure came from (the server recomputes) */
  window.PEOCompare.snapshot = () => ({
    common: commonValues(),
    quotes: quoteValues().map((q, i) => {
      const L = COLS[i], s = {};
      for (const k of ['provider', 'feeBasis', ...REQUIRED]) if (src[L][k]) s[k] = src[L][k];
      return { ...q, src: s, file: loaded[L] ? 1 : 0 };
    })
  });
  window.PEOCompare.current = () => gather();

  for (const [k, id] of [['employees', 'c-employees'], ['wage', 'c-wage'], ['enrollment', 'c-enrollment'], ['sutaBase', 'c-sutaBase']])
    $(id).addEventListener('input', () => { touchedCommon.add(k); delete commonFrom[k]; $(id).closest('.field').classList.remove('is-parsed'); });
  document.querySelectorAll('.compare-main input:not([type=file]), .compare-main select').forEach(e => { if (!e.closest('#reportForm')) e.addEventListener('input', draw); });
  $('downloadCompare').addEventListener('click', () => {
    const list = gather(); if (!list) return;
    track('comparator_csv');
    const esc = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const rows = [['PEOnomics quote comparison', ...list.map(x => x.label)],
      ...LINES.map(k => [k, ...list.map(x => {
        if (!x.missing.length) return (k === 'Year one total' ? x.yearOne : k === 'Three-year total' ? x.threeYear : x.parts[k]).toFixed(2);
        if (k.includes('total')) return 'INCOMPLETE';
        const v = x.parts && x.parts[k]; return v === null || v === undefined ? 'NOT STATED' : v.toFixed(2);
      })]),
      ['Note', 'Only user-entered pricing is compared; charges a quote does not state are not included.']];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'PEOnomics_quote_comparison.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  draw();
})();
