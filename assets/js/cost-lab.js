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
  const CONF = { high: 'verified', med: 'likely', low: 'estimate' };

  const PERSONAL = new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com','hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com','mail.com','email.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','zoho.com','yandex.com','tutanota.com','fastmail.com','hey.com','comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','cox.net','charter.net','earthlink.net','duck.com']);

  let R = null;
  const edited = new Set();          // benchmark fields the visitor has overwritten
  const defaults = {};               // current dataset value per benchmark field

  function setDefaults() {
    const code = $('state').value, st = R.states[code];
    if (!st) return;
    const mult = R.wc_industry_multipliers[$('industry').value];
    const m = typeof mult === 'number' ? mult : 1;
    defaults.suta = +(st.sui_new_employer_rate * 100).toFixed(4);
    defaults.wc = +((st.wc_index_per_100 || 0) * m).toFixed(4);
    defaults.health = R.health.employer_annual_single_avg;
    for (const k of ['suta', 'wc', 'health']) {
      if (!edited.has(k)) $(k).value = defaults[k];
    }
    const sutaConf = st.sui_confidence, wcConf = st.wc_confidence;
    $('sutaHint').textContent = `${st.name} 2025 new-employer rate on a $${st.sui_wage_base.toLocaleString('en-US')} wage base (${CONF[sutaConf] || 'unrated'}). Your experience rate will differ.`;
    $('wcHint').textContent = `2025 state index ${st.wc_index_per_100} × industry ${m} — a proxy, not a class-code rate (${CONF[wcConf] || 'unrated'}).` +
      (st.wc_monopolistic ? ' Monopolistic state fund: coverage comes from the state, PEO or not.' : '');
    $('healthHint').textContent = `2025 KFF small-firm employer share, single coverage, national — not ${st.name}-specific.`;
    setBasis('sutaBasis', sutaConf); setBasis('wcBasis', wcConf);
    syncEditedUI();
  }

  function setBasis(id, conf) {
    const el = $(id);
    const est = conf === 'low';
    el.className = 'basis ' + (est ? 'basis-est' : 'basis-bench');
    el.textContent = est ? 'Estimate' : 'Benchmark';
    el.title = est ? 'Flagged low-confidence in the 2025 dataset; pending primary-source verification.' : 'Published reference value from the 2025 dataset.';
  }

  function syncEditedUI() {
    for (const k of ['suta', 'wc', 'health']) {
      const isEdited = edited.has(k) && String(defaults[k]) !== $(k).value;
      document.querySelector(`[data-field="${k}"]`).classList.toggle('is-edited', isEdited);
      const btn = document.querySelector(`[data-restore="${k}"]`);
      btn.hidden = !isEdited;
      btn.textContent = `Restore ${k === 'health' ? '$' + Number(defaults[k]).toLocaleString('en-US') : defaults[k]}`;
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

  function draw() {
    if (!R) return;
    const i = inputs();
    let r;
    try { r = compute(R, i); } catch { return; }
    const st = R.states[i.state];

    const rows = [
      ['Employer FICA', 'stat', 'Statutory', r.cur.fica, r.peo.fica],
      ['FUTA', 'stat', 'Statutory', r.cur.futa, r.peo.futa],
      ['State unemployment (SUTA)', 'bench', 'Benchmark', r.cur.suta, r.peo.suta],
      ["Workers' comp", 'bench', 'Benchmark', r.cur.wc, r.peo.wc],
      ['Employer health', 'bench', 'Benchmark', r.cur.health, r.peo.health],
      ['Internal HR/payroll admin', 'user', 'Your input', r.cur.admin, r.peo.admin],
      ['PEO admin fee', 'user', 'Your input', r.cur.fee, r.peo.fee]
    ];
    const body = $('resultRows');
    body.replaceChildren();
    for (const [label, cls, basis, a, b] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th'); th.scope = 'row';
      th.append(label);
      const tag = document.createElement('span'); tag.className = `basis basis-${cls} row-basis`; tag.textContent = basis;
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
    edited.delete('suta'); edited.delete('wc');
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
        $('industry').value = d.industryGuess; edited.delete('wc'); setDefaults(); filled.push('industry');
      }
      if (Number.isFinite(d.employeesGuess) && d.employeesGuess > 0) { $('employees').value = Math.min(100000, Math.round(d.employeesGuess)); filled.push('employees'); }
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
    edited.clear();
    for (const [id, v] of [['enrollment', 60], ['pepm', defaults.pepm], ['currentAdmin', 0], ['adminAvoided', 0], ['peoSuta', ''], ['peoWc', ''], ['peoHealth', '']]) $(id).value = v;
    setDefaults(); draw();
  }

  async function init() {
    try {
      const res = await fetch('/data/rates-2025.json', { cache: 'no-cache' });
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
    sel.value = R.states.MD ? 'MD' : sel.options[0].value;

    const meta = R.meta || {};
    const lab = $('datasetLabel'); lab.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = 'Model data: ';
    lab.append(strong, `tax year ${meta.tax_year || '?'} · dataset v${meta.version || '?'} · preliminary. Historical reference figures, not current 2026 rates.`);

    const pa = R.peo_admin || {};
    defaults.pepm = (pa.pepm_low && pa.pepm_high) ? Math.round((pa.pepm_low + pa.pepm_high) / 2) : 150;
    $('pepm').value = defaults.pepm;
    $('pepmHint').textContent = (pa.pepm_low && pa.pepm_high)
      ? `Default $${defaults.pepm} is the midpoint of a $${pa.pepm_low}–$${pa.pepm_high} practitioner-derived range for 10–100 employees (2025 dataset). Use the fee from your actual quote.`
      : 'Use the fee from your actual quote.';

    setDefaults();
    draw();

    for (const id of ['company', 'employees', 'salary', 'enrollment', 'pepm', 'currentAdmin', 'adminAvoided', 'peoSuta', 'peoWc', 'peoHealth']) {
      $(id).addEventListener('input', () => { document.querySelector(`[data-field="${id}"]`)?.classList.remove('is-filled'); draw(); });
    }
    for (const id of ['suta', 'wc', 'health']) {
      $(id).addEventListener('input', () => { edited.add(id); draw(); });
    }
    $('state').addEventListener('change', () => { document.querySelector('[data-field="state"]').classList.remove('is-filled'); setState($('state').value); draw(); });
    $('industry').addEventListener('change', () => { document.querySelector('[data-field="industry"]').classList.remove('is-filled'); edited.delete('wc'); setDefaults(); draw(); });
    document.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.restore; edited.delete(k); $(k).value = defaults[k]; draw();
    }));
    $('applyAdminRef').addEventListener('click', () => { $('currentAdmin').value = $('applyAdminRef').dataset.value || 0; draw(); });
    $('resetBtn').addEventListener('click', resetAssumptions);
    $('printReport').addEventListener('click', () => window.print());
    $('labForm').addEventListener('submit', e => e.preventDefault());
    $('lookupForm').addEventListener('submit', lookup);
  }

  init();
})();
