/* Best-effort rate limiting for Pages Functions without extra bindings.

   Two layers, both approximate:
   1. In-memory per isolate (exact within one isolate, resets on eviction).
   2. Cloudflare Cache API per data center (caches.default): a counter stored
      under a synthetic URL keyed by SHA-256(bucket + IP), one entry per
      window. Not atomic — concurrent bursts can slip a few requests through —
      but it survives isolate churn, which the in-memory map does not.

   The authoritative control is a Cloudflare WAF rate-limiting rule on
   /api/* (owner setup, docs/OWNER_SETUP.md). The raw IP is never stored. */

const memory = new Map();

function memoryHit(key, limit, windowMs, now) {
  const arr = (memory.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  memory.set(key, arr);
  if (memory.size > 5000) memory.clear();
  return arr.length > limit;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function cacheHit(origin, bucket, ip, limit, windowMs, now) {
  const cache = globalThis.caches && globalThis.caches.default;
  if (!cache) return false;
  try {
    const slot = Math.floor(now / windowMs);
    // Key on this site's own origin (the Cache API is scoped to the zone).
    const key = new Request(`${origin}/__ratelimit/${bucket}/${await sha256(bucket + '|' + ip)}/${slot}`);
    const prev = await cache.match(key);
    const count = (prev ? parseInt(await prev.text(), 10) || 0 : 0) + 1;
    const ttl = Math.max(1, Math.ceil(windowMs / 1000));
    await cache.put(key, new Response(String(count), { headers: { 'cache-control': `max-age=${ttl}` } }));
    return count > limit;
  } catch {
    return false; // never block a real user because the limiter itself failed
  }
}

/** true when this request should be refused */
export async function rateLimited(bucket, ip, { limit, windowMs, origin = 'https://peonomics.com' }) {
  const now = Date.now();
  const id = ip || 'unknown';
  const local = memoryHit(bucket + '|' + id, limit, windowMs, now);
  const shared = await cacheHit(origin, bucket, id, limit, windowMs, now);
  return local || shared;
}

export function _resetForTests() { memory.clear(); }
