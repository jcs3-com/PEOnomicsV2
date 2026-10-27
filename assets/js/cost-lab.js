/* PEOnomics Cost Lab — transparent, editable employer-cost comparison.
   No automatic PEO savings: the two scenarios carry identical statutory and
   insurance costs unless the visitor enters a PEO-quoted rate. The only
   built-in difference is the PEO fee the visitor sets.
   Pure math lives in `compute` (exported on window.PEOLab for tests). */
(() => {
  'use strict';

  /* ---------- pure model ---------- */
  function compute(rates, i) {
    const f = rates.federal;
    const st = rates.states[i.state];
    if (!st) throw new Error('unknown state ' + i.state);
    const N = Math.max(0, Math.floor(i.employees));
    const W = Math.max(0, i.wage);
    const pct = x => Math.max(0, x) / 100;
    const fica = N * (Math.min(W, f.fica_ss_wage_base) * f.fica_ss_rate + W * f.fica_medicare_rate);
    const futaRate = f.futa_net_rate + ((f.futa_credit_reduction_states || {})[i.state] || 0);
    const futa = N * Math.min(W, f.futa_wage_base) * futaRate;
    const sutaBase = N * Math.min(W, st.sui_wage_base);
    const enrolled = N * Math.min(100, Math.max(0, i.enrollment)) / 100;
    const payroll = N * W;
    const cur = {
      fica, futa,
      suta: sutaBase * pct(i.suta),
      wc: payroll * Math.max(0, i.wc) / 100,
      health: enrolled * Math.max(0, i.health),
      admin: Math.max(0, i.currentAdmin),
      fee: 0
    };
    const pick = (v, fallback) => (v === null || v === undefined || Number.isNaN(v)) ? fallback : v;
    const avoided = Math.min(cur.admin, Math.max(0, i.adminAvoided));
    const peo = {
      fica, futa,
      suta: sutaBase * pct(pick(i.peoSuta, i.suta)),
      wc: payroll * Math.max(0, pick(i.peoWc, i.wc)) / 100,
      health: enrolled * Math.max(0, pick(i.peoHealth, i.health)),
      admin: cur.admin - avoided,
      fee: N * Math.max(0, i.pepm) * 12
    };
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const currentTotal = sum(cur), peoTotal = sum(peo);
    return { N, W, payroll, enrolled, futaRate, avoided, cur, peo, currentTotal, peoTotal, delta: peoTotal - currentTotal };
  }

  function adminReferencePepy(rates, N) {
    const hb = rates.hr_admin_burden;
    if (!hb || !Array.isArray(hb.pepy_by_headcount)) return null;
    return hb.pepy_by_headcount.find(t => N <= t.max_employees) || hb.pepy_by_headcount[hb.pepy_by_headcount.length - 1];
  }

  window.PEOLab = { compute, adminReferencePepy };
  if (typeof document === 'undefined' || !document.getElementById('labForm')) return;

  /* ---------- DOM ---------- */
  const $ = id => document.getElementById(id);
  const money = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  const signed = v => (v > 0.5 ? '+' : v < -0.5 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };
  const optNum = id => { const raw = $(id).value.trim(); if (raw === '') return null; const v = parseFloat(raw); return Number.isFinite(v) ? v : null; };
  const CONF = { high: 'high confidence', med: 'medium confidence', low: 'estimate' };

  const PERSONAL = new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com','hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com','mail.com','email.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','zoho.com','yandex.com','tutanota.com','fastmail.com','hey.com','comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','cox.net','charter.net','earthlink.net','duck.com']);

  let R = null;
  const BENCH = ['salary', 'suta', 'wc', 'health', 'enrollment'];
  const edited = new Set();          // benchmark fields the visitor has overwritten
  const defaults = {};               // current dataset value per benchmark field (null = none)
  const basis = {};                  // current basis per benchmark field: stat | bench | est | user
  const MONEY_FIELDS = new Set(['salary', 'health']);
  const BAND = n => (n < 50 ? 'lt50' : 'ge50');
  const BAND_LABEL = { lt50: 'firms under 50 employees', ge50: 'firms with 50+ employees', total: 'all firm sizes' };

  // Writes "text … source" into a hint span, with the source as a real link.
  function hint(id, text, src) {
    const el = $(id); el.replaceChildren(text);
    if (src && src.url) {
      el.append(' ');
      const a = document.createElement('a'); a.href = src.url; a.rel = 'noopener'; a.target = '_blank';
      a.className = 'lab-source'; a.textContent = src.label || 'Source'; el.append(a);
    }
  }
  const pctTxt = r => +(r * 100).toFixed(3) + '%';

  function bandValue(table, unreliable, N) {
    const b = BAND(N);
    if (table[b] !== null && table[b] !== undefined && !(unreliable || []).includes(b)) return { value: table[b], band: b };
    if (table.total !== null && table.total !== undefined && !(unreliable || []).includes('total')) return { value: table.total, band: 'total' };
    return null;
  }

  function setDefaults() {
    const code = $('state').value, st = R.states[code];
    if (!st) return;
    const ind = $('industry').value;
    const N = Math.max(1, Math.floor(num('employees')) || 1);
    const MEPS = { url: 'https://meps.ahrq.gov/data_stats/summ_tables/insr/state/series_2/2025/ic25_iia_f.pdf', label: 'AHRQ MEPS-IC 2025' };

    // SUTA: state new-employer rate (industry-specific where the state publishes one)
    const sutaRate = (st.sui_rate_by_industry && st.sui_rate_by_industry[ind]) || st.sui_new_employer_rate;
    defaults.suta = +(sutaRate * 100).toFixed(4);
    basis.suta = st.sui_confidence === 'low' ? 'est' : 'bench';
    const comps = (st.sui_components || []).filter(c => !/base rate/i.test(c.name)).map(c => `${c.name} ${pctTxt(c.rate)}`);
    const srcName = st.sui_basis === 'state_agency' ? 'State agency' : st.sui_basis === 'dol_base_rate' ? 'U.S. DOL' : 'Why';
    if (st.sui_year === 2026) {
      hint('sutaHint', `${st.name} 2026 new-employer rate on a $${st.sui_wage_base.toLocaleString('en-US')} wage base` +
        (comps.length ? ` (includes ${comps.join(', ')})` : '') +
        (st.sui_rate_by_industry && st.sui_rate_by_industry[ind] ? ` — the ${($('industry').selectedOptions[0]?.textContent || 'industry').toLowerCase()} new-employer rate` : '') +
        `. ${st.sui_basis === 'dol_base_rate' ? 'Base rate; state surcharges not included. ' : ''}${st.sui_confidence === 'med' && st.sui_basis === 'state_agency' ? st.sui_note + ' ' : ''}Your experience rate will differ.`,
        { url: st.sui_source.url, label: srcName });
    } else {
      hint('sutaHint', `${st.name} assigns new employers their industry's average rate, so there is no single 2026 figure. ` +
        `Default is the 2025 reference value on the 2026 $${st.sui_wage_base.toLocaleString('en-US')} wage base — enter the rate on your notice.`,
        { url: st.sui_source.url, label: 'U.S. DOL' });
    }

    // Workers' comp: Oregon DCBS state index × PEOnomics industry multiplier (estimate)
    const mult = R.wc_industry_multipliers[ind];
    const m = typeof mult === 'number' ? mult : 1;
    defaults.wc = +((st.wc_index_per_100 || 0) * m).toFixed(4);
    basis.wc = 'est';
    hint('wcHint', `Oregon DCBS 2024 index for ${st.name} $${st.wc_index_per_100}/$100 (rates as of ${st.wc_rates_effective}; ${st.wc_pct_of_median}% of the U.S. median) × ${m} industry multiplier (PEOnomics estimate). Not a class-code rate.` +
      (st.wc_monopolistic ? ' Monopolistic state fund: coverage comes from the state, PEO or not.' : ''),
      { url: 'https://www.oregon.gov/dcbs/cost/Pages/ranking-by-state.aspx', label: 'Oregon DCBS' });

    // Health: MEPS-IC 2025 state employer share of single coverage, by firm size
    const h = st.health || {};
    const share = h.single_employer_share ? bandValue(h.single_employer_share, [], N) : null;
    if (share) {
      defaults.health = share.value; basis.health = 'bench';
      const p = h.single_premium[share.band], c = h.single_employee[share.band];
      hint('healthHint', `${st.name}, ${BAND_LABEL[share.band]}, 2025: single premium $${p.toLocaleString('en-US')} − employee share $${c.toLocaleString('en-US')}. Private sector; not trended to 2026.`, MEPS);
    } else {
      defaults.health = R.health.employer_annual_single_avg; basis.health = 'bench';
      hint('healthHint', `U.S. private-sector employer share of single coverage, 2025 (no reliable ${st.name} figure for this firm size).`, MEPS);
    }

    // Enrollment: MEPS-IC 2025 share of employees enrolled at establishments that offer coverage
    const en = h.enrolled_pct ? bandValue(h.enrolled_pct, h.enrolled_pct_unreliable, N) : null;
    if (en) {
      defaults.enrollment = en.value; basis.enrollment = 'bench';
      hint('enrollmentHint', `${en.value}% of private-sector employees at ${st.name} establishments that offer coverage were enrolled (${BAND_LABEL[en.band]}, 2025). Use your own number if you know it.`, MEPS);
    } else {
      defaults.enrollment = 60; basis.enrollment = 'user';
      hint('enrollmentHint', 'Share of employees on the employer plan. 60% is illustrative — no reliable state figure.');
    }

    // Average wage: BLS QCEW 2025 average annual pay per job, state × industry
    const w = st.wages && st.wages[ind];
    if (w && w.value) {
      defaults.salary = w.value; basis.salary = 'bench';
      hint('salaryHint', `${st.name} average annual pay per job, ${w.series}, 2025 (includes part-time jobs)` +
        (w.method === 'disclosed_subsectors' ? ' — BLS suppresses the sector total, so this averages the disclosed subsectors' : '') + '. Use your payroll if you know it.',
        { url: 'https://www.bls.gov/cew/', label: 'BLS QCEW' });
    } else {
      defaults.salary = null; basis.salary = 'user';
      hint('salaryHint', `BLS does not publish a ${st.name} figure for this industry. Enter your average wage.`);
    }

    for (const k of BENCH) {
      if (!edited.has(k) && defaults[k] !== null && defaults[k] !== undefined) $(k).value = defaults[k];
      setBasis(k);
    }
    syncEditedUI();
  }

  const BASIS = {
    stat: ['basis-stat', 'Statutory', 'Set by law.'],
    bench: ['basis-bench', 'Benchmark', 'Published reference value — see the source link under the field.'],
    est: ['basis-est', 'Estimate', 'Partly or wholly a PEOnomics estimate or an older reference value — replace it if you have the real figure.'],
    user: ['basis-user', 'Your input', 'Your number.']
  };
  function currentBasis(k) { return edited.has(k) && String(defaults[k]) !== $(k).value ? 'user' : (basis[k] || 'user'); }
  function setBasis(k) {
    const el = $(k + 'Basis'); if (!el) return;
    const [cls, label, title] = BASIS[currentBasis(k)];
    el.className = 'basis ' + cls; el.textContent = label; el.title = title;
  }

  function syncEditedUI() {
    for (const k of BENCH) {
      const has = defaults[k] !== null && defaults[k] !== undefined;
      const isEdited = has && edited.has(k) && String(defaults[k]) !== $(k).value;
      document.querySelector(`[data-field="${k}"]`).classList.toggle('is-edited', isEdited);
      const btn = document.querySelector(`[data-restore="${k}"]`);
      if (btn) {
        btn.hidden = !isEdited;
        if (has) btn.textContent = `Restore ${MONEY_FIELDS.has(k) ? '$' + Number(defaults[k]).toLocaleString('en-US') : defaults[k]}`;
      }
      setBasis(k);
    }
  }

  function inputs() {
    return {
      state: $('state').value, employees: Math.min(100000, num('employees')), wage: num('salary'),
      suta: num('suta'), wc: num('wc'), enrollment: num('enrollment'), health: num('health'),
      pepm: num('pepm'), currentAdmin: num('currentAdmin'), adminAvoided: num('adminAvoided'),
      peoSuta: optNum('peoSuta'), peoWc: optNum('peoWc'), peoHealth: optNum('peoHealth')
    };
  }

  let touched = false;            // set by the first visitor edit; drives one calc_used event
  function draw() {
    if (!R) return;
    const i = inputs();
    if (touched) window.peoTrack && window.peoTrack('calc_used', { state: i.state, industry: $('industry').value, employees: i.employees }, { once: true });
    let r;
    try { r = compute(R, i); } catch { return; }
    const st = R.states[i.state];

    const futaEst = (R.federal.futa_credit_reduction_confidence || {})[i.state] === 'low';
    const tagOf = k => BASIS[currentBasis(k)];
    const rows = [
      ['Employer FICA', 'stat', 'Statutory', r.cur.fica, r.peo.fica],
      ['FUTA', futaEst ? 'est' : 'stat', futaEst ? 'Estimate' : 'Statutory', r.cur.futa, r.peo.futa],
      ['State unemployment (SUTA)', tagOf('suta')[0].slice(6), tagOf('suta')[1], r.cur.suta, r.peo.suta],
      ["Workers' comp", tagOf('wc')[0].slice(6), tagOf('wc')[1], r.cur.wc, r.peo.wc],
      ['Employer health', tagOf('health')[0].slice(6), tagOf('health')[1], r.cur.health, r.peo.health],
      ['Internal HR/payroll admin', 'user', 'Your input', r.cur.admin, r.peo.admin],
      ['PEO admin fee', 'user', 'Your input', r.cur.fee, r.peo.fee]
    ];
    const body = $('resultRows');
    body.replaceChildren();
    for (const [label, cls, basisLabel, a, b] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row';
      th.append(label);
      const tag = document.createElement('span'); tag.className = `basis basis-${cls} row-basis`; tag.textContent = basisLabel;
      th.append(tag);
      const ta = document.createElement('td'); ta.textContent = money(a);
      const tb = document.createElement('td'); tb.textContent = money(b);
      if (Math.abs(a - b) >= 0.5) tb.className = 'changed';
      tr.append(th, ta, tb); body.append(tr);
    }

    const perEE = (tot) => r.N > 0 ? `${money(tot / r.N)} per employee / yr` : '';
    $('currentTotal').textContent = money(r.currentTotal); $('currentPer').textContent = perEE(r.currentTotal);
    $('peoTotal').textContent = money(r.peoTotal); $('peoPer').textContent = perEE(r.peoTotal);
    $('delta').textContent = signed(r.delta);
    $('deltaPer').textContent = r.N > 0 ? `${signed(r.delta / r.N / 12)} per employee / month` : '';

    const drivers = [
      ['PEO fee', r.peo.fee],
      ['Admin cost replaced', -r.avoided],
      ['SUTA rate difference', r.peo.suta - r.cur.suta],
      ["Workers' comp rate difference", r.peo.wc - r.cur.wc],
      ['Health cost difference', r.peo.health - r.cur.health]
    ].filter(([, v]) => Math.abs(v) >= 0.5);
    const ul = $('drivers'); ul.replaceChildren();
    for (const [label, v] of drivers) {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = label;
      const b = document.createElement('span'); b.textContent = signed(v);
      li.append(a, b); ul.append(li);
    }
    const abs = money(Math.abs(r.delta));
    $('deltaNote').textContent = Math.abs(r.delta) < 0.5
      ? 'Both scenarios cost the same under these inputs.'
      : r.delta > 0
        ? `Under these inputs the PEO scenario costs ${abs} more per year. The lab assumes no PEO savings you haven't entered.`
        : `Under these inputs the PEO scenario costs ${abs} less per year — entirely from the values you entered above.`;

    const company = $('company').value.trim();
    $('resultCompany').textContent = company ? company.slice(0, 40) : '';
    const ind = $('industry').selectedOptions[0] ? $('industry').selectedOptions[0].textContent : '';
    const asm = $('resultAssumption'); asm.replaceChildren();
    for (const t of [st ? st.name.toUpperCase() : '', `${r.N.toLocaleString('en-US')} EMPLOYEES`, `AVG WAGE ${money(r.W)}`, ind.toUpperCase()]) {
      const s = document.createElement('span'); s.textContent = t; asm.append(s);
    }

    // admin guardrails
    const over = i.adminAvoided > i.currentAdmin;
    $('adminAvoided').setCustomValidity(over ? 'Cannot exceed current admin cost.' : '');
    $('avoidedHint').textContent = over
      ? `Capped at your current admin cost (${money(i.currentAdmin)}). Raise that first if you spend more today.`
      : 'Only spending you would actually stop. Capped at your current admin cost.';
    const ref = adminReferencePepy(R, r.N);
    if (ref && r.N > 0) {
      $('adminHint').textContent = `Default $0 — nothing is assumed. Reference: ${money(ref.pepy)} per employee/yr for your size (PwC 2011 study, CPI-adjusted${ref.confidence === 'low' ? '; extrapolated estimate' : ''}) = ${money(ref.pepy * r.N)}.`;
      $('applyAdminRef').hidden = false;
      $('applyAdminRef').dataset.value = String(Math.round(ref.pepy * r.N));
    }
    syncEditedUI();
  }

  /* ---------- lookup ---------- */
  function status(msg, kind) {
    const el = $('lookupStatus');
    el.textContent = msg;
    el.className = 'status-msg' + (kind ? ' ' + kind : '');
  }

  const FIELD_LABEL = { company: 'company', state: 'state', industry: 'industry', employees: 'approx. headcount' };

  function markFilled(keys) {
    document.querySelectorAll('.lab-form .field.is-filled').forEach(el => el.classList.remove('is-filled'));
    for (const k of keys) {
      const el = document.querySelector(`[data-field="${k}"]`);
      if (el) el.classList.add('is-filled');
    }
  }

  function setState(code) {
    $('state').value = code;
    edited.delete('suta'); edited.delete('wc');   // rates are state law: always rebase. Wage/health/enrollment keep your edits.
    setDefaults();
  }

  async function lookup(e) {
    if (e) e.preventDefault();
    const email = $('businessEmail').value.trim().toLowerCase();
    const m = email.match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/);
    if (!m) { status('Enter a full business email address, like you@yourcompany.com.', 'err'); return; }
    if (PERSONAL.has(m[1])) { status("Use a company address — personal domains (Gmail, Outlook, Yahoo, iCloud…) can't identify a business. The calculator works without it.", 'err'); return; }

    const btn = $('lookupBtn');
    btn.disabled = true;
    status('Researching ' + m[1] + '… this can take up to 20 seconds.');
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, page: 'cost-lab' })
      });
      const d = await res.json().catch(() => ({}));
      window.peoTrack && window.peoTrack('lookup_submitted', { outcome: res.ok && d.ok ? (d.stateGuess || d.company ? 'prefilled' : 'no_match') : (d.error || 'error') });
      if (!res.ok || !d.ok) {
        const msg = {
          business_email_required: "Use a company address — personal or invalid domains can't identify a business.",
          log_not_configured: 'Company lookup is offline while we finish connecting it. Nothing was recorded. Enter your details below — the calculator works the same.',
          log_unavailable: "The lookup couldn't be recorded, so it didn't run. Enter your details below — the calculator works the same.",
          rate_limited: 'Too many lookups from this connection. Try again in a few minutes, or enter details manually.'
        }[d.error] || 'Lookup is unavailable right now. Enter your details below — the calculator works the same.';
        status(msg, 'err');
        return;
      }
      const filled = [];
      if (d.company) { $('company').value = d.company; filled.push('company'); }
      if (d.stateGuess && R.states[d.stateGuess]) { setState(d.stateGuess); filled.push('state'); }
      if (d.industryGuess && [...$('industry').options].some(o => o.value === d.industryGuess)) {
        $('industry').value = d.industryGuess; edited.delete('wc'); if (R.states[$('state').value]?.sui_rate_by_industry) edited.delete('suta'); setDefaults(); filled.push('industry');
      }
      if (Number.isFinite(d.employeesGuess) && d.employeesGuess > 0) { $('employees').value = Math.min(100000, Math.round(d.employeesGuess)); filled.push('employees'); setDefaults(); }
      markFilled(filled);
      draw();
      status(filled.length
        ? `Prefilled ${filled.map(k => FIELD_LABEL[k]).join(', ')} from public information about ${d.domain}. Check each highlighted field — every one is editable.`
        : `We couldn't find public details for ${d.domain}. Enter them below.`, filled.length ? 'ok' : '');
    } catch {
      status('Lookup is unavailable right now. Enter your details below — the calculator works the same.', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- wiring ---------- */
  function resetAssumptions() {
    // Restores cost assumptions; keeps company, state, industry, headcount and an edited wage.
    for (const k of ['suta', 'wc', 'health', 'enrollment']) edited.delete(k);
    for (const [id, v] of [['pepm', defaults.pepm], ['currentAdmin', 0], ['adminAvoided', 0], ['peoSuta', ''], ['peoWc', ''], ['peoHealth', '']]) $(id).value = v;
    setDefaults(); draw();
  }

  async function init() {
    try {
      const res = await fetch('/data/rates-2026.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('dataset ' + res.status);
      R = await res.json();
    } catch {
      $('datasetLabel').textContent = 'Rate dataset unavailable — the lab cannot calculate right now. Please reload.';
      return;
    }
    const sel = $('state'); sel.replaceChildren();
    for (const [code, s] of Object.entries(R.states).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
      const o = document.createElement('option'); o.value = code; o.textContent = s.name; sel.append(o);
    }
    // ?state=XX (from state pages) preselects the HQ / Main Worksite State; still editable.
    let want = 'MD';
    try { const q = new URLSearchParams(location.search).get('state'); if (q && R.states[q.toUpperCase()]) want = q.toUpperCase(); } catch { /* ignore */ }
    sel.value = R.states[want] ? want : sel.options[0].value;

    const meta = R.meta || {};
    const lab = $('datasetLabel'); lab.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = 'Model data: ';
    const link = document.createElement('a'); link.href = '/data-library#sources'; link.textContent = 'Sources';
    lab.append(strong, `${meta.tax_year || '?'} reference data · v${meta.version || '?'} · reviewed ${meta.lastReviewed || '?'}. 2026 tax and unemployment rules; latest published wages (2025), health costs (2025) and workers' comp index (2024). `, link, ' →');

    const pa = R.peo_admin || {};
    defaults.pepm = (pa.pepm_low && pa.pepm_high) ? Math.round((pa.pepm_low + pa.pepm_high) / 2) : 150;
    $('pepm').value = defaults.pepm;
    $('pepmHint').textContent = (pa.pepm_low && pa.pepm_high)
      ? `Default $${defaults.pepm} is the midpoint of a $${pa.pepm_low}–$${pa.pepm_high} practitioner-observed range for 10–100 employees (not a published survey). Use the fee from your actual quote.`
      : 'Use the fee from your actual quote.';

    setDefaults();
    draw();

    for (const id of ['company', 'employees', 'pepm', 'currentAdmin', 'adminAvoided', 'peoSuta', 'peoWc', 'peoHealth']) {
      $(id).addEventListener('input', () => { document.querySelector(`[data-field="${id}"]`)?.classList.remove('is-filled'); if (id === 'employees') setDefaults(); draw(); });
    }
    for (const id of BENCH) {
      $(id).addEventListener('input', () => { edited.add(id); draw(); });
    }
    $('state').addEventListener('change', () => { document.querySelector('[data-field="state"]').classList.remove('is-filled'); setState($('state').value); draw(); });
    $('industry').addEventListener('change', () => { document.querySelector('[data-field="industry"]').classList.remove('is-filled'); edited.delete('wc'); if (R.states[$('state').value]?.sui_rate_by_industry) edited.delete('suta'); setDefaults(); draw(); });
    document.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.restore; edited.delete(k); $(k).value = defaults[k]; draw();
    }));
    $('applyAdminRef').addEventListener('click', () => { $('currentAdmin').value = $('applyAdminRef').dataset.value || 0; draw(); });
    $('resetBtn').addEventListener('click', resetAssumptions);
    $('printReport').addEventListener('click', () => window.print());
    $('labForm').addEventListener('submit', e => e.preventDefault());
    $('labForm').addEventListener('input', () => { touched = true; }, { capture: true });
    $('labForm').addEventListener('change', () => { touched = true; draw(); }, { capture: true });
    $('lookupForm').addEventListener('submit', lookup);
  }

  init();
})();
