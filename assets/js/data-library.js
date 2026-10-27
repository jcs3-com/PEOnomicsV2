/* PEOnomics Data Library — renders /data/rates-2026.json (every figure with its
   own year and source) and the national benchmarks in /data/benchmarks-2026.json.
   Older editions keep their own year label; nothing is relabeled. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('stateRows')) return;
  let D = null, rows = [];
  const money = n => (n === null || n === undefined) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pct = (x, d = 2) => (x === null || x === undefined) ? '—' : (x * 100).toFixed(d).replace(/\.?0+$/, '') + '%';
  const IND = ['clerical_professional', 'retail_services', 'hospitality_food', 'light_manufacturing', 'transportation_logistics', 'construction_trades'];
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.append(td); return td; };
  const tag = (el, cls, text, title) => { const s = document.createElement('span'); s.className = 'basis ' + cls; s.textContent = text; if (title) s.title = title; el.append(s); };
  const link = (el, href, text) => { const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; a.textContent = text; el.append(a); return a; };
  const filtered = () => { const q = $('filterStates').value.toLowerCase().trim(); return rows.filter(r => (r.s.name + ' ' + r.code).toLowerCase().includes(q)); };
  const SUTA_TAG = { state_agency: ['basis-bench', 'state agency', 'Checked on the state agency page; includes listed surcharges.'],
    dol_base_rate: ['basis-bench', 'DOL base', 'U.S. DOL Significant Provisions (July 2026): base new-employer rate; state surcharges not included.'],
    industry_average_state: ['basis-est', '2025 ref.', 'New employers pay their industry average; no single 2026 rate exists. 2025 reference value shown.'] };

  function draw() {
    const body = $('stateRows'), wb = $('wageRows');
    body.replaceChildren(); wb.replaceChildren();
    for (const { code, s } of filtered()) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row'; link(th, `/states/${code.toLowerCase()}`, `${s.name} (${code})`); tr.append(th);
      cell(tr, money(s.sui_wage_base), 'num');
      const td = cell(tr, pct(s.sui_new_employer_rate, 3), 'num');
      const [c, l, t] = SUTA_TAG[s.sui_basis] || ['basis', s.sui_basis, ''];
      tag(td, c, l, t);
      cell(tr, money(s.wages.all_private && s.wages.all_private.value), 'num');
      const h = s.health.single_employer_share;
      cell(tr, `${money(h.lt50)} / ${money(h.ge50)}`, 'num');
      cell(tr, s.health.enrolled_pct.total === null ? '—' : s.health.enrolled_pct.total + '%', 'num');
      const wc = cell(tr, s.wc_index_per_100.toFixed(2), 'num');
      if (s.wc_monopolistic) tag(wc, 'basis', 'state fund', 'Monopolistic state workers’ comp fund');
      const src = cell(tr, ''); link(src, s.sui_source.url, s.sui_basis === 'state_agency' ? 'State agency' : 'U.S. DOL');
      body.append(tr);

      const wr = document.createElement('tr');
      const wth = document.createElement('th'); wth.scope = 'row'; wth.textContent = s.name; wr.append(wth);
      for (const k of IND) {
        const w = s.wages[k]; const t2 = cell(wr, money(w && w.value), 'num');
        if (w && w.method === 'disclosed_subsectors') tag(t2, 'basis-est', 'partial', 'BLS suppresses the sector total; averaged from disclosed subsectors: ' + (w.subsectors || []).join(', '));
      }
      wb.append(wr);
    }
    if (!body.children.length) { const tr = document.createElement('tr'); cell(tr, 'No matching state.').colSpan = 8; body.append(tr); }
  }

  function sources(d) {
    const ul = $('sourceList'); ul.replaceChildren();
    const items = [
      ['Social Security wage base $184,500; FICA and FUTA rates', 'Statute and SSA, 2026', 'https://www.ssa.gov/OACT/COLA/cbb.html', 'Employer FICA and FUTA in the Cost Lab.'],
      ['FUTA credit reduction', 'Federal Register 2026-00342 (California 1.2% for 2025)', 'https://www.federalregister.gov/d/2026-00342', 'California 2026 shown as 1.5% — the statutory next step — and labeled an estimate until DOL finalizes it after Nov. 10, 2026.'],
      ['State unemployment: wage bases and new-employer rates', 'U.S. DOL, Significant Provisions of State UI Laws, effective July 2026', 'https://oui.doleta.gov/unemploy/content/sigpros/2020-2029/July2026.pdf', 'All 51 jurisdictions. DOL lists base rates only (its footnote 3 excludes surcharges).'],
      ['State unemployment: priority states checked at the agency', 'DC DOES, Maryland Labor, Virginia VEC, California EDD, Texas TWC, Florida DOR, New York DOL, Ohio ODJFS (2026)', '/data/src/state-ui-verified-2026.json', 'Adds surcharges the DOL table excludes (DC 0.2% admin assessment, CA 0.1% ETT, NY 0.075% RSF, OH 0.15% fee) and Ohio’s 5.7% construction new-employer rate.'],
      ['Average annual pay by state and industry', 'BLS QCEW, 2025 annual averages, private ownership', 'https://www.bls.gov/cew/', 'Default average wage in the Cost Lab (state × industry).'],
      ['Employer health cost and enrollment', 'AHRQ MEPS-IC 2025, private sector, state tables II.B.2.b, II.C.1, II.C.2, II.D.1, II.D.2', 'https://meps.ahrq.gov/data_stats/summ_tables/insr/state/series_2/2025/ic25_iia_f.pdf', 'Employer share = average premium − average employee contribution, by firm size (<50 / 50+). Cells AHRQ flags as unreliable or suppresses are not used.'],
      ['Workers’ comp state index', 'Oregon DCBS, 2024 Workers’ Compensation Premium Rate Ranking', 'https://www.oregon.gov/dcbs/cost/Pages/ranking-by-state.aspx', 'Premium per $100 payroll for a fixed 50-class basket. The Cost Lab multiplies it by a PEOnomics industry multiplier (an estimate), so WC is labeled Estimate.'],
      ['National health premiums (context only)', 'KFF Employer Health Benefits Survey 2026', 'https://www.kff.org/health-costs/2026-employer-health-benefits-survey/', 'Shown in the benchmark table; the Cost Lab uses the state MEPS-IC figures instead.']
    ];
    for (const [what, edition, url, use] of items) {
      const li = document.createElement('li');
      const st = document.createElement('strong'); st.textContent = what; li.append(st);
      const m = document.createElement('span'); m.className = 'mono'; link(m, url, edition); li.append(m);
      const u = document.createElement('span'); u.textContent = use; li.append(u);
      ul.append(li);
    }
  }

  fetch('/data/rates-2026.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(d => {
    D = d;
    const meta = d.meta || {};
    const v = $('dataVintage'); v.replaceChildren();
    const s = document.createElement('strong'); s.textContent = 'Reference data v' + meta.version + ': ';
    v.append(s, `2026 unemployment-insurance rules; latest published wages (BLS 2025), health (AHRQ 2025) and workers’ comp index (Oregon 2024). Reviewed ${meta.lastReviewed}. Each column header shows its year; `);
    const a = document.createElement('a'); a.href = '#sources'; a.textContent = 'sources below'; v.append(a, '.');
    rows = Object.entries(d.states).map(([code, st]) => ({ code, s: st })).sort((x, y) => x.s.name.localeCompare(y.s.name));
    sources(d); draw();
  }).catch(() => { $('dataVintage').textContent = 'The state dataset could not be loaded.'; });

  fetch('/data/benchmarks-2026.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(b => {
    const body = $('benchRows'); body.replaceChildren();
    const fmt = (k, x) => /Rate$/.test(k) ? (x * 100).toFixed(1) + '%' : money(x);
    for (const group of ['federal', 'healthNational']) {
      for (const [k, x] of Object.entries(b[group] || {})) {
        const tr = document.createElement('tr');
        const th = document.createElement('th'); th.scope = 'row'; th.textContent = x.label || k; tr.append(th);
        cell(tr, fmt(k, x.value), 'num'); cell(tr, String(x.year));
        link(cell(tr, ''), x.sourceUrl, x.sourceName);
        cell(tr, x.lastReviewed || '');
        body.append(tr);
      }
    }
  }).catch(() => { $('benchRows').replaceChildren(); });

  $('filterStates').addEventListener('input', draw);
  $('dataCsv').addEventListener('click', () => {
    if (!D) return;
    const esc = s => '"' + String(s ?? '').replaceAll('"', '""') + '"';
    const header = ['State', 'Code', 'SUTA wage base 2026', 'New-employer SUTA rate 2026', 'SUTA basis', 'SUTA year', 'SUTA source',
      'Avg pay all private 2025', ...IND.map(k => 'Avg pay ' + k + ' 2025'),
      'Employer single health <50 EEs 2025', 'Employer single health 50+ EEs 2025', 'Employer single health all 2025',
      'Employer family health all 2025', 'Enrolled % all 2025', 'WC index per $100 (Oregon 2024)', 'WC rates effective', 'Monopolistic WC', 'Dataset version'];
    const out = [header];
    for (const { code, s } of filtered()) {
      const h = s.health;
      out.push([s.name, code, s.sui_wage_base, s.sui_new_employer_rate, s.sui_basis, s.sui_year, s.sui_source.url,
        s.wages.all_private && s.wages.all_private.value, ...IND.map(k => s.wages[k] ? s.wages[k].value : ''),
        h.single_employer_share.lt50, h.single_employer_share.ge50, h.single_employer_share.total, h.family_employer_share.total,
        h.enrolled_pct.total, s.wc_index_per_100, s.wc_rates_effective, s.wc_monopolistic, D.meta.version]);
    }
    const csv = out.map(r => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `PEOnomics_state_reference_${D.meta.version}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
