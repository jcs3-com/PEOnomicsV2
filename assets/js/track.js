/* PEOnomics — privacy-conscious event counter. window.peoTrack(name, props).
   Sends only an allowlisted event name plus coarse context (state code, industry
   key, headcount band, outcome code, page path) to /api/event. No cookies, no
   identifiers, no email or typed values. Honors Global Privacy Control and
   Do Not Track by sending nothing. Page views come from Cloudflare Web Analytics. */
(() => {
  'use strict';
  const off = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const band = n => !(n > 0) ? '' : n < 10 ? '1-9' : n < 50 ? '10-49' : n < 100 ? '50-99' : n < 500 ? '100-499' : '500+';
  const sent = new Set();
  function peoTrack(name, props = {}, { once = false } = {}) {
    if (off) return;
    if (once) { if (sent.has(name)) return; sent.add(name); }
    const p = { path: location.pathname.slice(0, 80) };
    if (props.state) p.state = String(props.state).toUpperCase();
    if (props.industry) p.industry = String(props.industry);
    if (props.employees) p.band = band(Number(props.employees));
    if (props.outcome) p.outcome = String(props.outcome).toLowerCase().replace(/[^a-z_]/g, '').slice(0, 32);
    const body = JSON.stringify({ name, props: p });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch { /* never break the page */ }
  }
  window.peoTrack = peoTrack;
  // Clicks from any page into the Cost Lab (state pages, guides, CTA panels).
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (location.pathname !== '/' && (href.startsWith('/#cost-lab') || href.startsWith('/?state='))) {
      const m = href.match(/state=([A-Za-z]{2})/);
      peoTrack('cost_lab_cta', { state: m ? m[1] : '' });
    }
  }, { capture: true });
})();
