/* GET /api/report-status -> {"ok":true,"available":boolean,"siteKey":string|null}
   Lets the Cost Lab show an honest state for "Email this to me" without
   attempting a send. Reveals only whether all report secrets are present, plus
   the PUBLIC Turnstile site key (env TURNSTILE_SITE_KEY — public by design: it is
   embedded in every page that renders the widget). No secret value is returned. */
import { reportConfigured } from './report-request.js';

export const PUBLIC_SITE_KEY = /^0x[0-9A-Za-z_-]{10,100}$/;

export async function onRequestGet({ env }) {
  const e = env || {};
  const key = String(e.TURNSTILE_SITE_KEY || '').trim();
  return new Response(JSON.stringify({ ok: true, available: reportConfigured(e), siteKey: PUBLIC_SITE_KEY.test(key) ? key : null }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
