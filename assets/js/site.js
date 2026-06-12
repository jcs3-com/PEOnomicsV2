/* PEOnomics — shared site JS
   Handles:
   - mobile nav toggle
   - hidden source-page injection on Formspree forms
   - referrer + UTM capture
*/
(function () {
  'use strict';

  // ── Mobile nav ────────────────────────────────────────────────
  const toggle = document.querySelector('.nav-toggle');
  const navEl  = document.querySelector('.nav');
  if (toggle && navEl) {
    toggle.addEventListener('click', () => {
      navEl.classList.toggle('nav-mobile-open');
    });
  }

  // ── Source tracking ──────────────────────────────────────────
  // Attach hidden fields to every Formspree form so we know which page
  // a lead came from, what referred them, and any UTM params.
  const params = new URLSearchParams(window.location.search);
  const utm = {
    source:   params.get('utm_source')   || '',
    medium:   params.get('utm_medium')   || '',
    campaign: params.get('utm_campaign') || '',
    content:  params.get('utm_content')  || '',
    term:     params.get('utm_term')     || '',
  };

  const sourcePage = (location.pathname.replace(/^\/+|\/+$/g, '') || 'home').replace(/\.html$/, '');
  const referrer = document.referrer || 'direct';

  document.querySelectorAll('form[action*="formspree"]').forEach((form) => {
    const inject = (name, value) => {
      if (!value) return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    inject('_source_page', sourcePage);
    inject('_referrer', referrer);
    inject('_landed_at', new Date().toISOString());
    Object.entries(utm).forEach(([k, v]) => inject('utm_' + k, v));
  });
})();
