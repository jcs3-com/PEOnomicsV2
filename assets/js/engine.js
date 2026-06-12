/* PEOnomics quote engine.
   Loads /data/rates-2025.json and computes itemized employer burden,
   standalone vs PEO (favorable / midpoint / conservative scenarios). */

const PEO = (() => {
  let R = null;

  async function load() {
    if (R) return R;
    const res = await fetch('/data/rates-2025.json');
    R = await res.json();
    return R;
  }

  const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
  const pct = n => (n * 100).toFixed(3) + '%';

  /* inputs: { state, employees, avgWage, industry } */
  function compute(inp) {
    const f = R.federal, st = R.states[inp.state];
    const EMP = inp.employees, W = inp.avgWage;
    const mult = R.wc_industry_multipliers[inp.industry] ?? 1.0;

    // FICA: SS to wage base + Medicare uncapped (additional 0.9% ignored at these wage levels)
    const fica = EMP * (Math.min(W, f.fica_ss_wage_base) * f.fica_ss_rate + W * f.fica_medicare_rate);

    // FUTA net + credit reduction if applicable
    const crAdd = f.futa_credit_reduction_states[inp.state] || 0;
    const futa = EMP * Math.min(W, f.futa_wage_base) * (f.futa_net_rate + crAdd);

    // SUI at new-employer rate on state wage base
    const sui = EMP * Math.min(W, st.sui_wage_base) * st.sui_new_employer_rate;

    // WC: state index x industry multiplier per $100 payroll
    const wcRate = st.wc_index_per_100 * mult;
    const wc = EMP * W / 100 * wcRate;

    // Health: employer share of single coverage, +/- range
    const h = R.health;
    const healthMid = EMP * h.employer_annual_single_avg;
    const healthLo = healthMid * (1 - h.range_pct);
    const healthHi = healthMid * (1 + h.range_pct);

    // PEO admin fee range (PEPM tier)
    const a = R.peo_admin;
    const peoFeeLo = EMP * a.pepm_low * 12;
    const peoFeeHi = EMP * a.pepm_high * 12;

    // In-house HR administration burden (PwC TCO, CPI-adjusted).
    // PEPY rises as headcount falls — diseconomies of scale.
    const hb = R.hr_admin_burden;
    const tier = hb.pepy_by_headcount.find(t => EMP <= t.max_employees) || hb.pepy_by_headcount.at(-1);
    const adminPepy = tier.pepy;
    const adminBurden = EMP * adminPepy;             // standalone bears this in full
    const adminBurdenLo = adminBurden * (1 - hb.midpoint_band_pct);
    const adminBurdenHi = adminBurden * (1 + hb.midpoint_band_pct);
    // A PEO absorbs most of this; a residual ~20% stays as internal coordination time.
    const peoResidualAdmin = adminBurden * 0.20;

    // Standalone = statutory + WC + midpoint health + full in-house admin burden
    const standalone = fica + futa + sui + wc + healthMid + adminBurden;

    // PEO scenarios — fee replaces the admin burden, plus health/WC effects:
    // favorable  — master-plan health 12% better, WC managed 10% better, low fee
    // conservative — health parity, WC parity, high fee
    const peoLo = fica + futa + sui + wc * 0.90 + healthLo * 0.88 + peoFeeLo + peoResidualAdmin;
    const peoHi = fica + futa + sui + wc * 1.00 + healthHi * 1.00 + peoFeeHi + peoResidualAdmin;
    const peoMid = (peoLo + peoHi) / 2;

    return { st, f, mult, wcRate, crAdd,
      fica, futa, sui, wc, healthLo, healthMid, healthHi,
      peoFeeLo, peoFeeHi, adminPepy, adminBurden, adminBurdenLo, adminBurdenHi,
      adminConfidence: tier.confidence, peoResidualAdmin,
      standalone, peoLo, peoMid, peoHi, delta: standalone - peoMid };
  }

  function confBadge(level) {
    const t = { high: 'verified', med: 'likely', low: 'estimate' }[level] || level;
    return `<span class="conf ${level}">${t}</span>`;
  }

  /* Render the itemized ledger into a container. opts.showConf adds confidence badges. */
  function renderLedger(el, inp, opts = {}) {
    const c = compute(inp);
    const crNote = c.crAdd ? ` + ${(c.crAdd*100).toFixed(1)}% credit reduction` : '';
    const monoNote = c.st.wc_monopolistic ? ' — monopolistic state fund' : '';
    el.querySelector('.ledger-body').innerHTML = `
      <div class="lrow"><span class="label">FICA<small>Statutory — Social Security + Medicare</small></span>
        <span class="rate">7.650%</span><span class="amt">${fmt(c.fica)}</span></div>
      <div class="lrow"><span class="label">FUTA (net)<small>First $${c.f.futa_wage_base.toLocaleString()} per employee${crNote}</small></span>
        <span class="rate">${pct(c.f.futa_net_rate + c.crAdd)}</span><span class="amt">${fmt(c.futa)}</span></div>
      <div class="lrow"><span class="label">SUI — ${inp.state}${opts.showConf ? confBadge(c.st.sui_confidence) : ''}<small>New-employer rate on $${c.st.sui_wage_base.toLocaleString()} wage base</small></span>
        <span class="rate">${pct(c.st.sui_new_employer_rate)}</span><span class="amt">${fmt(c.sui)}</span></div>
      <div class="lrow"><span class="label">Workers' comp${opts.showConf ? confBadge(c.st.wc_confidence) : ''}<small>State index &times; industry mix${monoNote}</small></span>
        <span class="rate">$${c.wcRate.toFixed(2)}/$100</span><span class="amt">${fmt(c.wc)}</span></div>
      <div class="lrow range"><span class="label">Health (employer share)<small>National avg, single coverage</small></span>
        <span class="rate">range</span><span class="amt">${fmt(c.healthLo)}&ndash;${fmt(c.healthHi)}</span></div>
      <div class="lrow range"><span class="label">In-house HR admin${opts.showConf ? confBadge(c.adminConfidence) : ''}<small>Standalone only · $${c.adminPepy.toLocaleString()}/EE/yr · <a href="/hidden-costs.html" style="color:#8FA0B5;">PwC TCO &rarr;</a></small></span>
        <span class="rate">standalone</span><span class="amt">${fmt(c.adminBurdenLo)}&ndash;${fmt(c.adminBurdenHi)}</span></div>
      <div class="lrow range"><span class="label">PEO fee (replaces admin)<small>PEO only · $${R.peo_admin.pepm_low}&ndash;$${R.peo_admin.pepm_high} PEPM</small></span>
        <span class="rate">PEO</span><span class="amt">${fmt(c.peoFeeLo + c.peoResidualAdmin)}&ndash;${fmt(c.peoFeeHi + c.peoResidualAdmin)}</span></div>`;
    const set = (id, v) => { const n = el.querySelector(id); if (n) n.textContent = v; };
    set('.js-standalone', fmt(c.standalone));
    set('.js-peo', fmt(c.peoLo) + '–' + fmt(c.peoHi));
    set('.js-delta', (c.delta >= 0 ? 'saves ' : 'adds ') + fmt(Math.abs(c.delta)) + ' / yr (midpoint)');
    return c;
  }

  return { load, compute, renderLedger, fmt, get rates() { return R; } };
})();
