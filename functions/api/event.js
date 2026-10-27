/* POST /api/event — privacy-conscious product events (no cookies, no personal data).

   Accepts only allowlisted event names and coarse, allowlisted properties:
   two-letter state, industry key, headcount band, outcome code, page path.
   Never accepts or stores email, company, IP, user agent, free text or numbers
   a visitor typed. Stored as aggregate data points in Cloudflare Workers
   Analytics Engine when the owner binds a dataset as EVENTS (docs/OWNER_SETUP.md
   §6); without the binding the event is validated and discarded (204). */
import { rateLimited } from '../lib/ratelimit.js';

export const EVENTS = new Set([
  'calc_used',          // first edit of any Cost Lab input on a page view
  'lookup_submitted',   // business-email prefill attempted (outcome only)
  'report_requested',   // "Email this to me" clicked (outcome only)
  'comparator_used',    // first comparison with >= 1 complete proposal
  'comparator_csv',
  'data_csv',
  'cost_lab_cta'        // click from a content/state page into the Cost Lab
]);
const INDUSTRIES = new Set(['clerical_professional', 'retail_services', 'hospitality_food',
  'light_manufacturing', 'transportation_logistics', 'construction_trades']);
const BANDS = new Set(['1-9', '10-49', '50-99', '100-499', '500+']);
const STATES = /^[A-Z]{2}$/;
const OUTCOME = /^[a-z_]{2,32}$/;
const PATH = /^\/[a-z0-9\-/]{0,80}$/;

export function sanitize(body) {
  if (!body || typeof body !== 'object' || !EVENTS.has(body.name)) return null;
  const p = body.props && typeof body.props === 'object' ? body.props : {};
  return {
    name: body.name,
    state: STATES.test(p.state || '') ? p.state : '',
    industry: INDUSTRIES.has(p.industry) ? p.industry : '',
    band: BANDS.has(p.band) ? p.band : '',
    outcome: OUTCOME.test(p.outcome || '') ? p.outcome : '',
    path: PATH.test(p.path || '') ? p.path : ''
  };
}

const NO = s => new Response(null, { status: s, headers: { 'cache-control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== self) return NO(403);
  const text = await request.text();
  if (text.length > 600) return NO(413);
  let body; try { body = JSON.parse(text); } catch { return NO(400); }
  const ev = sanitize(body);
  if (!ev) return NO(400);
  if (await rateLimited('event', request.headers.get('cf-connecting-ip') || '', { limit: 120, windowMs: 10 * 60 * 1000, origin: self })) return NO(429);
  if (env && env.EVENTS && typeof env.EVENTS.writeDataPoint === 'function') {
    try {
      env.EVENTS.writeDataPoint({ indexes: [ev.name], blobs: [ev.name, ev.state, ev.industry, ev.band, ev.outcome, ev.path], doubles: [1] });
    } catch { /* analytics must never break the site */ }
  }
  return NO(204);
}

export async function onRequestGet() { return NO(405); }
