/* DMV Employer Cost Index — calculator.
   Rates come from /data/rates-2026.json (federal FICA/FUTA, state unemployment insurance)
   and /data/dmv-index-2026.json (paid leave, 2027 wage base). Nothing is hard-coded here.
   Pure model: window.PEODmv.compute(state, wage, year, headcount, rates, dmv). */
(function () {
  'use strict';
  var STATES = ['DC', 'MD', 'VA'];
  var NAMES = { DC: 'District of Columbia', MD: 'Maryland', VA: 'Virginia' };

  function ssBase(year, R, D) {
    return year >= 2027 ? D.federal.socialSecurityWageBase2027.value : R.federal.fica_ss_wage_base;
  }

  function compute(st, wage, year, hc, R, D) {
    var w = Math.max(0, Number(wage) || 0);
    var f = R.federal, s = R.states[st], base = ssBase(year, R, D);
    var pl = D.paidLeave;
    var c = {
      ss: f.fica_ss_rate * Math.min(w, base),
      med: f.fica_medicare_rate * w,
      futa: f.futa_net_rate * Math.min(w, f.futa_wage_base),
      sui: s.sui_new_employer_rate * Math.min(w, s.sui_wage_base),
      pfl: st === 'DC' ? pl.DC.employerRate * w : 0,
      famli: (st === 'MD' && year >= 2027 && hc >= pl.MD.smallEmployerThreshold)
        ? pl.MD.employerRate * Math.min(w, base) : 0
    };
    c.total = c.ss + c.med + c.futa + c.sui + c.pfl + c.famli;
    c.share = w > 0 ? c.total / w : 0;
    return c;
  }

  window.PEODmv = { compute: compute, STATES: STATES };

  var copyBtn = document.getElementById('dmv-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var el = document.getElementById('dmv-cite-text');
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

  var root = document.getElementById('dmv-calc');
  if (!root) return;

  var usd = function (n) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); };
  var pct = function (n, d) { return (n * 100).toFixed(d == null ? 2 : d) + '%'; };
  var $ = function (id) { return document.getElementById(id); };
  var year = 2026, R = null, D = null;

  function rows() {
    var f = R.federal, s = R.states;
    return [
      ['ss', 'Social Security', '6.20% up to ' + usd(ssBase(year, R, D))],
      ['med', 'Medicare', pct(f.fica_medicare_rate) + ', no cap'],
      ['futa', 'Federal unemployment (FUTA)', pct(f.futa_net_rate, 1) + ' up to ' + usd(f.futa_wage_base)],
      ['sui', 'State unemployment insurance, new employer',
        STATES.map(function (k) { return k + ' ' + pct(s[k].sui_new_employer_rate) + ' to ' + usd(s[k].sui_wage_base); }).join(' · ')],
      ['pfl', 'DC Paid Family Leave', pct(D.paidLeave.DC.employerRate) + ' of all wages, DC only'],
      ['famli', 'Maryland FAMLI, employer share',
        year >= 2027 ? pct(D.paidLeave.MD.employerRate) + ' for 15+ employees, MD only' : 'Begins January 1, 2027']
    ];
  }

  function render() {
    var wage = parseFloat($('dmv-wage').value) || 0;
    var hc = Math.max(1, Math.round(parseFloat($('dmv-hc').value) || 1));
    var data = {};
    STATES.forEach(function (k) { data[k] = compute(k, wage, year, hc, R, D); });
    var maxT = Math.max.apply(null, STATES.map(function (k) { return data[k].total; }));

    var html = rows().map(function (r) {
      return '<tr><th scope="row">' + r[1] + '<small>' + r[2] + '</small></th>' + STATES.map(function (k) {
        var v = data[k][r[0]];
        return '<td class="num mono">' + (v > 0 ? usd(v) : '<span class="dmv-dash">&mdash;</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    html += '<tr class="dmv-total"><th scope="row">Total per employee</th>' + STATES.map(function (k) {
      return '<td class="num mono' + (data[k].total === maxT ? ' dmv-high' : '') + '">' + usd(data[k].total) + '</td>';
    }).join('') + '</tr>';
    html += '<tr class="dmv-share"><th scope="row">Share of wage</th>' + STATES.map(function (k) {
      return '<td class="num mono">' + pct(data[k].share) + '</td>';
    }).join('') + '</tr>';
    $('dmv-rows').innerHTML = html;

    var tot = STATES.map(function (k) { return { k: k, t: data[k].total * hc }; });
    var mx = Math.max.apply(null, tot.map(function (o) { return o.t; }).concat([1]));
    $('dmv-bars').innerHTML = '<div class="dmv-bars-head">Whole payroll &middot; ' + hc + ' employee' + (hc === 1 ? '' : 's') + ' &middot; ' + year + '</div>' +
      tot.map(function (o) {
        return '<div class="dmv-bar"><span class="dmv-bar-name">' + NAMES[o.k] + '</span><span class="dmv-track"><span class="dmv-fill' +
          (o.t === mx ? ' is-high' : '') + '" style="width:' + (o.t / mx * 100).toFixed(2) + '%"></span></span><span class="dmv-bar-val num mono">' + usd(o.t) + '</span></div>';
      }).join('');

    var sorted = tot.slice().sort(function (a, b) { return b.t - a.t; });
    var note = 'At ' + usd(wage) + ' a year, ' + NAMES[sorted[0].k] + ' costs ' + usd(sorted[0].t - sorted[2].t) + ' more than ' +
      NAMES[sorted[2].k] + ' across ' + hc + ' employee' + (hc === 1 ? '' : 's') + '.';
    if (year >= 2027 && hc < D.paidLeave.MD.smallEmployerThreshold) note += ' Maryland employers with fewer than 15 employees owe no FAMLI employer share.';
    if (year >= 2027) note += ' 2027 unemployment rates are not yet set, so 2026 rates are held.';
    $('dmv-note').textContent = note;
  }

  function setYear(y) {
    year = y;
    $('dmv-y2026').setAttribute('aria-pressed', String(y === 2026));
    $('dmv-y2027').setAttribute('aria-pressed', String(y === 2027));
    render();
  }

  Promise.all([fetch('/data/rates-2026.json').then(function (r) { return r.json(); }),
               fetch('/data/dmv-index-2026.json').then(function (r) { return r.json(); })])
    .then(function (res) {
      R = res[0]; D = res[1];
      $('dmv-y2026').addEventListener('click', function () { setYear(2026); });
      $('dmv-y2027').addEventListener('click', function () { setYear(2027); });
      ['dmv-wage', 'dmv-hc'].forEach(function (id) { $(id).addEventListener('input', render); });
      root.classList.add('is-ready');
      render();
    })
    .catch(function () {
      $('dmv-note').textContent = 'The calculator could not load its rate data. The tables below show the 2026 figures for a $60,000 salary.';
    });
})();
