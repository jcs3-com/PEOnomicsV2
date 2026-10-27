/* POST /api/report-request
   body: {"email","snapshot":{...Cost Lab inputs},"turnstileToken","requestId":uuid}

   Emails the visitor a PDF + editable XLSX of THEIR Cost Lab scenario.
   - Business email only (same rules as /api/enrich: functions/lib/validate.js).
   - Cloudflare Turnstile verified server-side, bound to this site's hostnames.
   - Client totals are never trusted: inputs are range-checked and the model
     is recomputed here (functions/lib/report-model.js) from /data/rates-2026.json.
   - The request is logged BEFORE sending; the outcome (accepted/failed) after.
     No log -> no email. Provider acceptance is reported as "accepted for
     delivery", never as "delivered".
   - Resend Idempotency-Key = requestId, so a retried request sends once.

   Env (Cloudflare Pages secrets, never in Git): RESEND_API_KEY, REPORT_FROM
   (e.g. "PEOnomics <reports@peonomics.com>", domain verified in Resend),
   TURNSTILE_SECRET, USAGE_WEBHOOK_URL (usage-log-v2.gs web app).
   Missing any -> 503 report_unconfigured, before any third-party call. */
import { parseSnapshot, calculate, reportLines } from '../lib/report-model.js';
import { makeReportPdf, base64Bytes } from '../lib/simple-pdf.js';
import { makeReportXlsx } from '../lib/simple-xlsx.js';
import { parseBusinessEmail } from '../lib/validate.js';
import { rateLimited } from '../lib/ratelimit.js';

const RESP = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});

const SITE_HOSTS = h => h === 'peonomics.com' || h === 'www.peonomics.com' ||
  h === 'peonomicsv2.pages.dev' || h.endsWith('.peonomicsv2.pages.dev') || h === 'localhost';

function originAllowed(origin, self) {
  try { return !!origin && new URL(origin).origin === self; } catch { return false; }
}

async function verifyTurnstile(secret, token, ip) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    return j.success === true && (!j.hostname || SITE_HOSTS(String(j.hostname)));
  } catch { return false; }
}

async function record(url, obj) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(obj), redirect: 'follow', signal: AbortSignal.timeout(9000) });
    const j = await r.json().catch(() => null);
    return r.ok && j?.ok === true;
  } catch { return false; }
}

/** Compact, human-readable record of the inputs used for the report (what the visitor last edited). */
export function scenarioString(i) {
  const v = x => (x === null || x === undefined ? 'same' : String(x));
  return [i.state, i.industry, 'N=' + i.employees, 'W=' + i.wage, 'SUTA%=' + i.suta, 'WC=' + i.wc,
    'Enroll%=' + i.enrollment, 'Health=' + i.health, 'PEPM=' + i.pepm, 'Admin=' + i.currentAdmin,
    'Replaced=' + i.adminAvoided, 'PEO_SUTA%=' + v(i.peoSuta), 'PEO_WC=' + v(i.peoWc), 'PEO_Health=' + v(i.peoHealth)].join(' | ');
}

export function reportConfigured(env) {
  return !!(env.RESEND_API_KEY && env.REPORT_FROM && env.USAGE_WEBHOOK_URL && env.TURNSTILE_SECRET);
}

export async function onRequestPost({ request, env }) {
  if (!originAllowed(request.headers.get('origin'), new URL(request.url).origin)) return RESP({ ok: false, error: 'origin' }, 403);
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) return RESP({ ok: false, error: 'json_required' }, 415);
  if (!reportConfigured(env)) return RESP({ ok: false, error: 'report_unconfigured' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await rateLimited('report', ip, { limit: 6, windowMs: 60 * 60 * 1000, origin: new URL(request.url).origin })) {
    return RESP({ ok: false, error: 'rate_limited' }, 429);
  }

  const bodyText = await request.text();
  if (bodyText.length > 12000) return RESP({ ok: false, error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(bodyText); } catch { return RESP({ ok: false, error: 'bad_json' }, 400); }

  const parsed = parseBusinessEmail(body && body.email);
  if (!parsed) return RESP({ ok: false, error: 'business_email_required' }, 400);
  const requestId = String(body.requestId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return RESP({ ok: false, error: 'bad_request_id' }, 400);

  // Validate the scenario before spending a Turnstile verification on it.
  let rates, i, result;
  try {
    const resp = await env.ASSETS.fetch(new Request(new URL('/data/rates-2026.json', request.url)));
    if (!resp.ok) throw new Error('rates unavailable');
    rates = await resp.json();
    i = parseSnapshot(body.snapshot, rates);
    result = calculate(rates, i);
  } catch { return RESP({ ok: false, error: 'invalid_snapshot' }, 400); }

  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip))) {
    return RESP({ ok: false, error: 'challenge_failed' }, 403);
  }

  const base = {
    event: 'report_requested', timestamp: new Date().toISOString(), email: parsed.email, domain: parsed.domain,
    company: i.company, state: i.state, industry: i.industry, employees: i.employees, page: 'cost-lab',
    source: `model ${result.taxYear} v${result.version}`, requestId,
    // The final, edited scenario exactly as the server recomputed it (no personal data beyond the row's email).
    scenario: scenarioString(i), annualCurrent: Math.round(result.currentTotal),
    annualPeo: Math.round(result.peoTotal), annualDelta: Math.round(result.delta)
  };
  if (!(await record(env.USAGE_WEBHOOK_URL, base))) return RESP({ ok: false, error: 'log_unavailable' }, 503);

  let pdf, xlsx;
  try { pdf = makeReportPdf(reportLines(i, result)); xlsx = makeReportXlsx(i, result, rates); }
  catch {
    await record(env.USAGE_WEBHOOK_URL, { ...base, event: 'report_failed', timestamp: new Date().toISOString(), summary: 'render_failed' });
    return RESP({ ok: false, error: 'render_failed' }, 500);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `PEOnomics_Employer_Cost_${i.state}_${stamp}.pdf`;

  let response = null;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'peonomics-report-' + requestId },
      body: JSON.stringify({
        from: env.REPORT_FROM, to: [parsed.email],
        subject: 'Your PEOnomics employer cost report',
        text: 'Attached are the PDF and editable Excel workbook you requested from the PEOnomics Cost Lab.\n\n' +
          'They reflect the assumptions you entered and the PEOnomics ' + result.taxYear + ' reference data (v' + result.version + '; each default is a published reference value with its own year and source). ' +
          'They are planning estimates, not a quote, and no PEO savings are assumed unless you entered them.\n\n' +
          'We may send one optional survey invitation about 30 days from now; it will include a way to opt out. ' +
          'We do not sell or forward your details to PEO providers.\n\nPEOnomics - https://peonomics.com/',
        attachments: [
          { filename, content: base64Bytes(pdf) },
          { filename: filename.replace(/\.pdf$/, '.xlsx'), content: base64Bytes(xlsx) }
        ]
      })
    });
  } catch { response = null; }

  const sent = response?.ok === true;
  const sendJson = sent ? await response.json().catch(() => ({})) : {};
  await record(env.USAGE_WEBHOOK_URL, { ...base, event: sent ? 'report_accepted' : 'report_failed',
    timestamp: new Date().toISOString(), providerMessageId: sendJson.id || '', summary: sent ? '' : 'provider_status_' + (response ? response.status : 'network') });
  if (!sent) return RESP({ ok: false, error: 'email_unavailable' }, 502);
  return RESP({ ok: true, status: 'accepted_for_delivery', requestId });
}

export async function onRequestGet() {
  return RESP({ ok: false, error: 'method_not_allowed' }, 405);
}
