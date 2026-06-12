/* POST /api/lead
   Validates the lead and forwards it to the Google Sheet via an
   Apps Script webhook. The webhook URL lives in the Cloudflare Pages
   environment variable LEAD_WEBHOOK_URL — never in this repo. */

export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }

  const email = String(body.email || '').trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, reason: 'bad-email' }, 400);

  const lead = {
    timestamp: new Date().toISOString(),
    email,
    company: String(body.company || '').slice(0, 120),
    state: String(body.state || '').slice(0, 2).toUpperCase(),
    employees: Math.min(Math.max(parseInt(body.employees) || 0, 0), 100000),
    avgWage: Math.min(Math.max(parseInt(body.avgWage) || 0, 0), 5000000),
    industry: String(body.industry || '').slice(0, 40),
    standalone: parseInt(body.standalone) || 0,
    peoLow: parseInt(body.peoLow) || 0,
    peoHigh: parseInt(body.peoHigh) || 0,
    page: String(body.page || '').slice(0, 300),
    ua: (request.headers.get('User-Agent') || '').slice(0, 200)
  };

  if (!env.LEAD_WEBHOOK_URL) {
    // Not configured yet — fail loudly so the frontend shows the mailto fallback.
    return json({ ok: false, reason: 'webhook-not-configured' }, 503);
  }

  try {
    const res = await fetch(env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead)
    });
    if (!res.ok) throw new Error('webhook ' + res.status);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, reason: 'webhook-failed' }, 502);
  }
}
