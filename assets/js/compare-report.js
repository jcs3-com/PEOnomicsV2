/* PEOnomics — "Want the full report?" for the Quote Comparator.
   Same delivery rules as the Cost Lab report (report-client.js): the form only
   enables when /api/report-status says delivery is configured, a public Turnstile
   key exists, the visitor passes Turnstile, and at least two proposals are complete.
   Sends the typed inputs (never the files); the server recomputes everything.
   The UI reports "accepted for delivery", never "delivered". */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('reportForm'), btn = $('sendReport'), note = $('reportNote'), teaser = $('reportTeaser'), emailIn = $('reportEmail');
  if (!form || !btn || !note || !window.PEOCompare) return;
  const status = msg => { note.textContent = msg; };
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const OFF = 'Emailed reports are being connected. Nothing is sent yet — use Download CSV for now.';
  const KEY_RE = /^0x[0-9A-Za-z_-]{10,}$/;
  let key = (document.querySelector('meta[name="peonomics-turnstile-site-key"]')?.content || '').trim();
  const PERSONAL = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','mail.com','gmx.com','comcast.net','verizon.net','att.net']);
  const businessEmail = e => { const m = e.trim().toLowerCase().match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/); return !!(m && !PERSONAL.has(m[1])); };
  const ERR = {
    business_email_required: 'Use a company email address. Personal email providers are not supported.',
    invalid_compare: 'One of the inputs is out of range, so no report was sent. Check the highlighted fields.',
    need_two: 'Complete at least two proposals first.',
    challenge_failed: 'Verification failed or expired. Please verify again.',
    report_unconfigured: OFF,
    log_unavailable: "The request couldn't be recorded, so nothing was sent. Please try again later.",
    email_unavailable: 'The email service did not accept the request. Nothing was sent.',
    render_failed: "The report couldn't be generated. Nothing was sent.",
    rate_limited: 'Too many report requests from this connection. Please try again later. Nothing was sent.'
  };

  let available = false, token = '', sending = false, widgetId = null, ready = 0;
  const sync = () => { btn.disabled = !(available && token && ready >= 2 && !sending); };

  // Live teaser: what the report will say, computed from the comparison on screen.
  const LINES = ['Admin', 'SUTA', 'Workers comp', 'Employer health', 'EPLI', 'Other', 'Year-one setup'];
  function update(done) {
    ready = done.length;
    if (ready < 2) {
      teaser.textContent = ready === 1 ? 'One complete proposal so far. Complete a second to build the report.' : 'Complete at least two proposals to build the report.';
    } else {
      const hi = done.reduce((a, b) => (b.yearOne > a.yearOne ? b : a)), lo = done.reduce((a, b) => (b.yearOne < a.yearOne ? b : a));
      const gap = hi.yearOne - lo.yearOne;
      let driver = '', dv = -Infinity;
      for (const k of LINES) { const diff = hi.parts[k] - lo.parts[k]; if (diff > dv) { dv = diff; driver = k; } }
      const share = gap > 0.5 ? Math.round(dv / gap * 100) : 0;
      teaser.textContent = gap < 0.5
        ? `${ready} proposals, identical first-year cost. The report shows where the line items differ and what to ask each provider.`
        : `${ready} proposals, ${money(gap)} apart in year one (${money(hi.threeYear - lo.threeYear)} over three years). ${driver} accounts for ${share > 100 ? 'more than all' : share + '%'} of the gap between ${lo.label} and ${hi.label}.`;
    }
    sync();
  }
  document.addEventListener('peo:compare', e => update(e.detail ? e.detail.ready : []));
  update((window.PEOCompare.current() || []).filter(x => !x.missing.length));

  async function send(ev) {
    ev.preventDefault();
    if (sending) return;
    const email = emailIn.value.trim();
    if (!businessEmail(email)) { status(ERR.business_email_required); emailIn.focus(); return; }
    if (ready < 2) { status(ERR.need_two); return; }
    if (!token) { status('Complete the verification first.'); return; }
    sending = true; sync();
    status('Building your PDF and Excel workbook…');
    try {
      const snap = window.PEOCompare.snapshot();
      const res = await fetch('/api/report-request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'compare', email, compare: snap, turnstileToken: token, requestId: crypto.randomUUID() })
      });
      const j = await res.json().catch(() => ({}));
      window.peoTrack && window.peoTrack('report_requested', { outcome: res.ok && j.ok ? 'accepted' : (j.error || 'error'), employees: snap.common.employees });
      if (!res.ok || !j.ok) { status(ERR[j.error] || 'Report could not be sent. Nothing was sent.'); return; }
      status(`Accepted for delivery to ${email}. It usually arrives within a few minutes — check spam if not.`);
    } catch {
      status('Network error. The report may not have been sent; please try again.');
    } finally {
      token = ''; sending = false; sync();
      if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
    }
  }

  const box = document.createElement('div');
  box.className = 'lab-challenge'; box.setAttribute('aria-label', 'Abuse-prevention verification');
  function mount() {
    if (!window.turnstile) { status('Verification could not load, so email reports are unavailable right now.'); return; }
    widgetId = window.turnstile.render(box, {
      sitekey: key, action: 'report',
      callback: t => { token = t; sync(); status(ready >= 2 ? 'Verified. Enter your business email and send.' : 'Verified. Complete a second proposal, then send.'); },
      'expired-callback': () => { token = ''; sync(); status('Verification expired. Please verify again.'); },
      'error-callback': () => { token = ''; sync(); status('Verification unavailable. Please try again.'); }
    });
  }

  async function init() {
    sync();
    try {
      const j = await (await fetch('/api/report-status', { cache: 'no-store' })).json();
      available = j.available === true;
      if (!KEY_RE.test(key) && typeof j.siteKey === 'string') key = j.siteKey.trim();
    } catch { available = false; }
    if (!available || !KEY_RE.test(key)) { available = false; emailIn.disabled = true; status(OFF); sync(); return; }
    status('PDF + editable Excel to your business email. No sales calls; nothing goes to any PEO. We may send one optional survey invitation about 30 days later, with an opt-out.');
    note.after(box);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = mount;
    s.onerror = () => status('Verification could not load, so email reports are unavailable right now.');
    document.head.appendChild(s);
    sync();
  }
  form.addEventListener('submit', send);
  init();
})();
