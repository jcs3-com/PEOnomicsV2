/* GET /api/report-status -> {"available": boolean}
   Lets the Cost Lab show an honest state for "Email this to me" without
   attempting a send. Reveals only whether all report secrets are present. */
import { reportConfigured } from './report-request.js';

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ ok: true, available: reportConfigured(env || {}) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
