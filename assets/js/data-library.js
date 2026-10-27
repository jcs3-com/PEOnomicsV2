/* PEOnomics Data Library — renders the historical state reference table from
   /data/rates-2025.json and the sourced 2026 national benchmarks from
   /data/benchmarks-2026.json. Never relabels one as the other. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('stateRows')) return;
  const CONF = { high: 'high confidence', med: 'medium confidence', low: 'estimate' };
  let rows = [], meta = {};
  const money = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
  const filtered = () => { const q = $('filterStates').value.toLowerCase().trim(); return rows.filter(r => (r.name + ' ' + r.code).toLowerCase().includes(q)); };

  function draw() {
    const body = $('stateRows'); body.replaceChildren();
    for (const r of filtered()) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row';
      const a = document.createElement('a'); a.href = `/states/${r.code.toLowerCase()}.html`; a.textContent = `${r.name} (${r.code})`;
      th.append(a); tr.append(th);
      cell(tr, money(r.base), 'num');
      cell(tr, (r.rate * 100).toFixed(2) + '%', 'num');
      cell(tr, r.wc.toFixed(2), 'num');
      cell(tr, `SUTA ${CONF[r.sutaConf] || 'unrated'} · WC ${CONF[r.wcConf] || 'unrated'}${r.mono ? ' · monopolistic state fund' : ''}`);
      cell(tr, String(r.year) + ' (historical)');
      body.append(tr);
    }
    if (!body.children.length) { const tr = document.createElement('tr'); const td = cell(tr, 'No matching state.'); td.colSpan = 6; body.append(tr); }
  }

  fetch('/data/rates-2025.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(d => {
    meta = d.meta || {};
    const v = $('dataVintage'); v.replaceChildren();
    const s = document.createElement('strong'); s.textContent = 'Historical data: ';
    v.append(s, `tax year ${meta.tax_year} · dataset v${meta.version} · preliminary. Not current employer rates. Confidence labels are the dataset compiler's own ratings, not independent verification; "estimate" marks figures pending primary-source checks.`);
    rows = Object.entries(d.states).map(([code, s]) => ({
      code, name: s.name, base: s.sui_wage_base, rate: s.sui_new_employer_rate, wc: s.wc_index_per_100,
      sutaConf: s.sui_confidence, wcConf: s.wc_confidence, mono: !!s.wc_monopolistic, year: meta.tax_year
    })).sort((a, b) => a.name.localeCompare(b.name));
    draw();
  }).catch(() => { $('dataVintage').textContent = 'The state dataset could not be loaded.'; });

  fetch('/data/benchmarks-2026.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(b => {
    const body = $('benchRows'); body.replaceChildren();
    const fmt = (k, x) => /Rate$/.test(k) ? (x * 100).toFixed(1) + '%' : money(x);
    for (const group of ['federal', 'healthNational']) {
      for (const [k, x] of Object.entries(b[group] || {})) {
        const tr = document.createElement('tr');
        const th = document.createElement('th'); th.scope = 'row'; th.textContent = x.label || k; tr.append(th);
        cell(tr, fmt(k, x.value), 'num'); cell(tr, String(x.year));
        const td = cell(tr, ''); const a = document.createElement('a'); a.href = x.sourceUrl; a.rel = 'noopener'; a.textContent = x.sourceName; td.append(a);
        cell(tr, x.lastReviewed || '');
        body.append(tr);
      }
    }
    for (const [label, url, name] of [['State × industry average wage', 'https://www.bls.gov/cew/downloadable-data-files.htm', 'BLS QCEW'], ['State-specific employer health premium', 'https://www.kff.org/', 'KFF / AHRQ MEPS-IC']]) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; tr.append(th);
      cell(tr, 'Not yet published here', 'num'); cell(tr, '—');
      const td = cell(tr, ''); const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.textContent = name; td.append(a);
      cell(tr, '—'); body.append(tr);
    }
  }).catch(() => { $('benchRows').replaceChildren(); });

  $('filterStates').addEventListener('input', draw);
  $('dataCsv').addEventListener('click', () => {
    const esc = s => '"' + String(s ?? '').replaceAll('"', '""') + '"';
    const header = ['State', 'Code', 'SUTA wage base', 'New-employer SUTA rate', 'WC index per $100', 'SUTA confidence', 'WC confidence', 'Monopolistic WC', 'Data year', 'Dataset version', 'Status'];
    const csv = [header, ...filtered().map(r => [r.name, r.code, r.base, r.rate, r.wc, r.sutaConf, r.wcConf, r.mono, r.year, meta.version, 'historical, preliminary'])]
      .map(row => row.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `PEOnomics_state_reference_${meta.tax_year || ''}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
