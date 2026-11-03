/* Maryland FAMLI calculator (/maryland-famli-calculator).
   Every rate, threshold, cap and date comes from /data/dmv-index-2026.json (paidLeave.MD and the
   2027 Social Security wage base). Nothing is hard-coded here.
   Pure model: window.PEOFamli.compute(input, dmv) and window.PEOFamli.parseWages(text). */
(function () {
  'use strict';

  /* input: { totalEmployees, wages: [annual wage per Maryland employee], coverShare (0..1 of the
     employee share the employer pays itself), payPeriods } */
  function compute(input, D) {
    var md = D.paidLeave.MD, base = D.federal.socialSecurityWageBase2027.value;
    var wages = (input.wages || []).map(function (w) { return Math.max(0, Number(w) || 0); });
    var n = wages.length;
    var total = Math.max(n, Math.round(Number(input.totalEmployees) || 0));
    var cover = Math.min(1, Math.max(0, Number(input.coverShare) || 0));
    var periods = Math.max(1, Math.round(Number(input.payPeriods) || 26));
    var small = total < md.smallEmployerThreshold;
    var capped = 0, overCap = 0;
    wages.forEach(function (w) { capped += Math.min(w, base); if (w > base) overCap += 1; });
    var employerShare = small ? 0 : md.employerRate * capped;
    var employeeShare = md.employeeRate * capped;
    var employerPaysOfEmployee = cover * employeeShare;
    var withheld = employeeShare - employerPaysOfEmployee;
    var employerCost = employerShare + employerPaysOfEmployee;
    var remitted = employerShare + employeeShare;
    return {
      n: n, total: total, small: small, base: base, capped: capped, overCap: overCap,
      employerShare: employerShare, employeeShare: employeeShare,
      employerPaysOfEmployee: employerPaysOfEmployee, withheld: withheld,
      employerCost: employerCost, remitted: remitted, quarterly: remitted / 4,
      employerCostPerEmployee: n ? employerCost / n : 0,
      withheldPerPaycheck: n ? withheld / n / periods : 0,
      employerRateApplied: small ? 0 : md.employerRate
    };
  }

  /* One wage per line (or tab/semicolon separated). "$60,000" and "60000.00" both read as 60000.
     Commas are thousands separators, never list separators. Returns { wages, ignored }. */
  function parseWages(text) {
    var wages = [], ignored = 0;
    String(text || '').split(/[\r\n\t;]+/).forEach(function (raw) {
      var t = raw.trim();
      if (!t) return;
      var clean = t.replace(/[$,\s]/g, '');
      if (/^\d+(\.\d+)?$/.test(clean)) wages.push(parseFloat(clean));
      else ignored += 1;
    });
    return { wages: wages, ignored: ignored };
  }

  window.PEOFamli = { compute: compute, parseWages: parseWages };

  var copyBtn = document.getElementById('famli-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var el = document.getElementById('famli-cite-text');
      var select = function () {
        var r = document.createRange(); r.selectNodeContents(el);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        copyBtn.textContent = 'Selected — press copy';
      };
      try {
        navigator.clipboard.writeText(el.textContent).then(function () {
          copyBtn.textContent = 'Copied';
          setTimeout(function () { copyBtn.textContent = 'Copy citation'; }, 1800);
        }, select);
      } catch (e) { select(); }
    });
  }

  var root = document.getElementById('famli-calc');
  if (!root) return;

  var $ = function (id) { return document.getElementById(id); };
  var usd0 = function (v) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); };
  var usd2 = function (v) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var D = null, cover = 0, touched = false;

  function inputs() {
    var paste = parseWages($('famli-paste').value);
    var usePaste = paste.wages.length > 0;
    var nMd = Math.max(0, Math.round(parseFloat($('famli-md').value) || 0));
    var avg = Math.max(0, parseFloat($('famli-avg').value) || 0);
    var wages = usePaste ? paste.wages : Array.apply(null, Array(nMd)).map(function () { return avg; });
    return {
      usePaste: usePaste, ignored: paste.ignored,
      totalEmployees: Math.max(0, Math.round(parseFloat($('famli-total').value) || 0)),
      wages: wages, coverShare: cover, payPeriods: parseInt($('famli-freq').value, 10)
    };
  }

  function render() {
    var i = inputs(), r = compute(i, D), md = D.paidLeave.MD;
    $('famli-employer').textContent = usd0(r.employerCost);
    $('famli-withheld').textContent = usd0(r.withheld);
    $('famli-remitted').textContent = usd0(r.remitted);
    $('famli-quarter').textContent = usd0(r.quarterly);
    $('famli-per-ee').textContent = usd0(r.employerCostPerEmployee);
    $('famli-paycheck').textContent = usd2(r.withheldPerPaycheck);

    var notes = [];
    if (i.usePaste) {
      notes.push('Using ' + r.n + ' pasted wage' + (r.n === 1 ? '' : 's') + (i.ignored ? ' (' + i.ignored + ' line' + (i.ignored === 1 ? '' : 's') + ' ignored: not a number)' : '') +
        '. Clear the box to go back to headcount × average wage.');
    }
    if (i.totalEmployees < r.n) notes.push('Total headcount was below the number of Maryland employees, so ' + r.n + ' is used for the size test.');
    notes.push(r.small
      ? 'With ' + r.total + ' employees you are under the ' + md.smallEmployerThreshold + '-employee line: no employer share. You still remit the ' + (md.employeeRate * 100).toFixed(2) + '% employee share.'
      : 'With ' + r.total + ' employees you owe the ' + (md.employerRate * 100).toFixed(2) + '% employer share. Count employees in every state, not just Maryland.');
    if (r.overCap) notes.push(r.overCap + ' employee' + (r.overCap === 1 ? ' earns' : 's earn') + ' above the ' + usd0(r.base) + ' wage cap; contributions stop at the cap.');
    if (!i.usePaste && r.overCap) notes.push('Headcount × average treats everyone as earning the average; if pay is uneven around the cap, paste each wage for an exact figure.');
    $('famli-note').textContent = notes.join(' ');
  }

  function setCover(v) {
    cover = v;
    ['0', '50', '100'].forEach(function (k) { $('famli-cover-' + k).setAttribute('aria-pressed', String(Number(k) / 100 === v)); });
    edited();
  }

  function edited() {
    render();
    if (!touched) {
      touched = true;
      var i = inputs();
      window.peoTrack && window.peoTrack('calc_used', { state: 'MD', employees: i.totalEmployees, outcome: i.usePaste ? 'pasted_wages' : 'average_wage' }, { once: true });
    }
  }

  fetch('/data/dmv-index-2026.json').then(function (res) { return res.json(); }).then(function (data) {
    D = data;
    ['famli-total', 'famli-md', 'famli-avg', 'famli-paste', 'famli-freq'].forEach(function (id) {
      $(id).addEventListener(id === 'famli-freq' ? 'change' : 'input', edited);
    });
    ['0', '50', '100'].forEach(function (k) { $('famli-cover-' + k).addEventListener('click', function () { setCover(Number(k) / 100); }); });
    root.classList.add('is-ready');
    render();
  }).catch(function () {
    $('famli-note').textContent = 'The calculator could not load its rate data. The figures shown are for 20 Maryland employees at $60,000, paid biweekly.';
  });
})();
