/* GET /api/health — owner-facing configuration check. Returns booleans only:
   which settings are present, never their values. Use after adding Cloudflare
   Pages secrets (docs/OWNER_SETUP.md) to confirm a redeploy picked them up. */
import { reportConfigured } from './report-request.js';
import { PUBLIC_SITE_KEY } from './report-status.js';

export async function onRequestGet({ env }) {
  const e = env || {};
  const has = k => typeof e[k] === 'string' && e[k].trim().length > 0;
  const siteKey = PUBLIC_SITE_KEY.test(String(e.TURNSTILE_SITE_KEY || '').trim());
  const body = {
    ok: true,
    lookup: { ready: has('USAGE_WEBHOOK_URL'), usageLog: has('USAGE_WEBHOOK_URL'), research: has('ANTHROPIC_API_KEY') },
    reports: { ready: reportConfigured(e) && siteKey, usageLog: has('USAGE_WEBHOOK_URL'), resendKey: has('RESEND_API_KEY'),
      sender: has('REPORT_FROM'), turnstileSecret: has('TURNSTILE_SECRET'), turnstileSiteKey: siteKey }
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
