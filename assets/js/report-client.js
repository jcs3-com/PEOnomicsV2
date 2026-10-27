/* PEOnomics — "Email this to me" for the Cost Lab.
   The button only enables when (1) the server says report delivery is fully
   configured (/api/report-status), (2) a public Turnstile site key is present,
   and (3) the visitor passes Turnstile. The server recomputes the scenario; the
   UI reports "accepted for delivery", never "delivered". */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const btn = $('emailReport'), note = $('emailNote'), form = $('labForm');
  if (!btn || !note || !form) return;
  const status = msg => { note.textContent = msg; };
  const OFF = 'Emailed reports (PDF + editable Excel) are being connected. Nothing is sent yet — use Print for now.';

  // Public Turnstile site key: from the page meta tag if set, otherwise from
  // /api/report-status (Pages env TURNSTILE_SITE_KEY) so no code change is needed.
  const KEY_RE = /^0x[0-9A-Za-z_-]{10,}$/;
  let key = (document.querySelector('meta[name="peonomics-turnstile-site-key"]')?.content || '').trim();

  const read = id => { const raw = $(id).value.trim(); return raw === '' ? null : Number(raw); };
  const snapshot = () => ({
    company: $('company').value.trim(), state: $('state').value, industry: $('industry').value,
    employees: read('employees'), wage: read('salary'), suta: read('suta'), wc: read('wc'),
    enrollment: read('enrollment'), health: read('health'), pepm: read('pepm'),
    currentAdmin: read('currentAdmin'), adminAvoided: read('adminAvoided'),
    peoSuta: read('peoSuta'), peoWc: read('peoWc'), peoHealth: read('peoHealth')
  });
  const PERSONAL = new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','mail.com','gmx.com','comcast.net','verizon.net','att.net']);
  const businessEmail = e => { const m = e.trim().toLowerCase().match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/); return !!(m && !PERSONAL.has(m[1])); };
  const ERR = {
    business_email_required: 'Enter a company email address in the lookup field above. Personal email providers are not supported.',
    invalid_snapshot: 'One of the inputs is out of range (check employees, wage and rates), so no report was sent.',
    challenge_failed: 'Verification failed or expired. Please verify again.',
    report_unconfigured: OFF,
    log_unavailable: "The request couldn't be recorded, so nothing was sent. Please try again later.",
    email_unavailable: 'The email service did not accept the request. Nothing was sent.',
    render_failed: "The report couldn't be generated. Nothing was sent.",
    rate_limited: 'Too many report requests from this connection. Please try again later. Nothing was sent.'
  };

  let token = '', sending = false, widgetId = null;
  const box = document.createElement('div');
  box.id = 'reportChallenge';
  box.className = 'lab-challenge';
  box.setAttribute('aria-label', 'Abuse-prevention verification');

  async function send() {
    if (sending) return;
    const email = $('businessEmail').value.trim();
    if (!businessEmail(email)) { status(ERR.business_email_required); $('businessEmail').focus(); return; }
    if (!token) { status('Complete the verification first.'); return; }
    sending = true; btn.disabled = true;
    status('Building your PDF and Excel workbook…');
    try {
      const res = await fetch('/api/report-request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, snapshot: snapshot(), turnstileToken: token, requestId: crypto.randomUUID() })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { status(ERR[j.error] || 'Report could not be sent. Nothing was sent.'); return; }
      status(`Accepted for delivery to ${email}. It usually arrives within a few minutes — check spam if not.`);
    } catch {
      status('Network error. The report may not have been sent; please try again.');
    } finally {
      token = ''; sending = false; btn.disabled = true;
      if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
    }
  }

  function mount() {
    if (!window.turnstile) { status('Verification could not load, so email reports are unavailable right now.'); return; }
    widgetId = window.turnstile.render(box, {
      sitekey: key, action: 'report',
      callback: t => { token = t; btn.disabled = false; status('Verified. Email the scenario shown above to the business address in the lookup field.'); },
      'expired-callback': () => { token = ''; btn.disabled = true; status('Verification expired. Please verify again.'); },
      'error-callback': () => { token = ''; btn.disabled = true; status('Verification unavailable. Please try again.'); }
    });
  }

  async function init() {
    btn.disabled = true;
    let available = false;
    try {
      const j = await (await fetch('/api/report-status', { cache: 'no-store' })).json();
      available = j.available === true;
      if (!KEY_RE.test(key) && typeof j.siteKey === 'string') key = j.siteKey.trim();
    } catch { available = false; }
    if (!available || !KEY_RE.test(key)) { status(OFF); return; }
    status('Get this scenario as a PDF plus an editable Excel workbook, at the business email entered above. We may send one optional survey invitation about 30 days later, with an opt-out. No sales calls; nothing goes to PEOs.');
    note.after(box);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = mount;
    s.onerror = () => status('Verification could not load, so email reports are unavailable right now.');
    document.head.appendChild(s);
    btn.addEventListener('click', send);
  }
  init();
})();
