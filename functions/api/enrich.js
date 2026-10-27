/* POST /api/enrich   body: {"email":"name@company.com","page":"cost-lab"}

   One server-side flow for the Cost Lab's optional business-email lookup:
     1. Validate a BUSINESS email (personal domains rejected).
     2. Validate the domain as a public hostname (SSRF guard), then resolve it
        over DNS-over-HTTPS and refuse private / reserved addresses.
     3. Enrich from the DOMAIN ONLY (the mailbox name never leaves this
        function): Tier 2 Claude Haiku + web search when ANTHROPIC_API_KEY is
        set, Tier 1 hardened homepage scraper as fallback / gap filler.
     4. Record the lookup (email, domain, company profile, timestamp) to the
        private usage log via USAGE_WEBHOOK_URL (Google Apps Script).
     5. Return the profile ONLY if the usage log confirmed the write.
        Fail closed: no log, no enrichment. The calculator works without it.

   Not a sales lead. Nothing here creates a CRM record or contacts a PEO.
   Secrets (ANTHROPIC_API_KEY, USAGE_WEBHOOK_URL) live in Cloudflare Pages
   environment variables, never in this repository.

   Optional env: ENRICH_MODEL (default claude-haiku-4-5). */

const STATE_NAMES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO',
  'connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID',
  'illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA',
  'maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
  'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA',
  'west virginia':'WV','wisconsin':'WI','wyoming':'WY','district of columbia':'DC'
};
const ABBRS = new Set(Object.values(STATE_NAMES));

const INDUSTRIES = ['clerical_professional','retail_services','hospitality_food',
  'light_manufacturing','transportation_logistics','construction_trades'];

const INDUSTRY_KEYWORDS = [
  ['construction_trades', /constructi|roofing|hvac|plumbing|electrical contract|excavat|remodel|general contractor|builder/i],
  ['hospitality_food', /restaurant|catering|hospitality|hotel|brewer|bakery|cafe|food service/i],
  ['transportation_logistics', /trucking|logistics|freight|transportation|shipping|fleet|courier|warehouse/i],
  ['light_manufacturing', /manufactur|fabricat|machin|assembly|industrial|production facility/i],
  ['retail_services', /retail|store|salon|cleaning|landscap|repair|staffing|e-commerce|ecommerce/i],
  ['clerical_professional', /consulting|software|technology|law firm|accounting|marketing|agency|financial|insurance|engineering|architec|medical practice|dental/i]
];

/* Personal / consumer mailbox providers. Exact-domain match. */
export const PERSONAL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com',
  'hotmail.com','hotmail.co.uk','outlook.com','live.com','msn.com','passport.com',
  'aol.com','aim.com','icloud.com','me.com','mac.com','mail.com','email.com','usa.com',
  'proton.me','protonmail.com','pm.me','gmx.com','gmx.net','zoho.com','zohomail.com',
  'yandex.com','yandex.ru','tutanota.com','tuta.io','fastmail.com','hey.com',
  'comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','cox.net',
  'charter.net','earthlink.net','optonline.net','frontier.com','windstream.net',
  'juno.com','netzero.net','mailinator.com','duck.com','qq.com','163.com'
]);

/* Suffixes that are never public company websites, or that resolve to
   caller-chosen IPs (wildcard-DNS services) — classic SSRF vectors. */
const BLOCKED_SUFFIXES = [
  'localhost','local','localdomain','internal','intranet','lan','home','corp','private',
  'test','example','invalid','arpa','onion','alt','home.arpa',
  'nip.io','sslip.io','xip.io','localtest.me','lvh.me','traefik.me','readme.localhost',
  'workers.dev','pages.dev' /* no reason to research Cloudflare dev hosts */
];

const MAX_HTML_BYTES = 300000;
const MAX_REDIRECTS = 3;

/* ---------- validation ---------- */

/** Returns a normalized public hostname or null. Pure function — unit tested. */
export function validateDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (d.length < 4 || d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  for (const l of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) return null;      // no numeric TLD => no IPv4 literal
  if (/(?:^|[.-])\d{1,3}[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/.test(d)) return null; // embedded IPv4 (1-2-3-4.host)
  if (/(?:^|\.)0x[0-9a-f]+(?:\.|$)/.test(d)) return null;                     // hex host labels
  for (const s of BLOCKED_SUFFIXES) {
    if (d === s || d.endsWith('.' + s)) return null;
  }
  return d;
}

/** Returns {email, domain} for a business address, or null. Unit tested. */
export function parseBusinessEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  if (email.length > 254) return null;
  const m = email.match(/^([a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([^@\s]+)$/);
  if (!m) return null;
  const domain = validateDomain(m[2]);
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null;
  return { email, domain };
}

/** True for addresses a public company website must never resolve to. */
export function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase();
  if (s.includes(':')) {                              // IPv6
    if (s === '::' || s === '::1') return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;    // ULA, link-local
    if (/^ff/.test(s)) return true;                               // multicast
    if (/^::ffff:/.test(s)) return isPrivateAddress(s.slice(7));  // v4-mapped
    if (/^(64:ff9b|2001:db8|2001:0db8|100::)/.test(s)) return true;
    return false;
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0);
}

async function resolvesPublic(host) {
  const ips = [];
  for (const type of ['A', 'AAAA']) {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) continue;
      const j = await r.json();
      for (const a of j.Answer || []) if (a.type === 1 || a.type === 28) ips.push(a.data);
    } catch { /* treat as unresolved */ }
  }
  return ips.length > 0 && ips.every(ip => !isPrivateAddress(ip));
}

/* ---------- best-effort per-isolate rate limit ----------
   Not a substitute for a Cloudflare WAF rate-limiting rule (see ROADMAP). */
const hits = new Map();
function rateLimited(key, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > limit;
}

function allowedOrigin(origin, selfOrigin) {
  if (!origin) return true; // non-browser clients; still subject to every other check
  try {
    const h = new URL(origin).hostname;
    return origin === selfOrigin || h === 'peonomics.com' || h === 'www.peonomics.com' ||
      h === 'peonomicsv2.pages.dev' || h.endsWith('.peonomicsv2.pages.dev') ||
      h === 'localhost' || h === '127.0.0.1';
  } catch { return false; }
}

/* ---------- safe fetch for the scraper ---------- */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function readCapped(res, cap) {
  const reader = res.body && res.body.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const buf = new Uint8Array(Math.min(size, cap)); let off = 0;
  for (const c of chunks) { const take = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, take), off); off += take; if (off >= buf.length) break; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function safeFetchPage(url, ms = 6000) {
  const deadline = Date.now() + ms;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u;
    try { u = new URL(current); } catch { return ''; }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return '';
    const host = validateDomain(u.hostname);
    if (!host || !(await resolvesPublic(host))) return '';
    const left = deadline - Date.now();
    if (left <= 0) return '';
    let res;
    try {
      res = await fetch(u.toString(), { redirect: 'manual', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(left) });
    } catch { return ''; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return '';
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) return '';
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(type)) return '';
    return readCapped(res, MAX_HTML_BYTES);
  }
  return '';
}

/* ---------- Tier 2: Claude Haiku + web search (domain only) ---------- */
async function llmEnrich(domain, apiKey, model) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: 'You are a B2B firmographic researcher. Respond with ONLY a JSON object, no prose, no markdown fences. If you cannot verify a field, use null.',
        messages: [{
          role: 'user',
          content: `Research the company at the domain "${domain}". Use web search if needed (max 2 searches). Return ONLY this JSON:
{"company": "official company name or null",
 "stateGuess": "two-letter US state (or DC) of headquarters, or null if non-US/unknown",
 "employeesGuess": approximate US employee headcount as integer, or null,
 "industryGuess": one of ${JSON.stringify(INDUSTRIES)} or null,
 "summary": "one short sentence on what they do, or null"}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const out = { source: 'research' };
    if (j.company && typeof j.company === 'string') out.company = clean(j.company, 80);
    if (j.stateGuess && ABBRS.has(String(j.stateGuess).toUpperCase())) out.stateGuess = String(j.stateGuess).toUpperCase();
    if (Number.isFinite(j.employeesGuess) && j.employeesGuess > 0) out.employeesGuess = Math.min(Math.round(j.employeesGuess), 100000);
    if (INDUSTRIES.includes(j.industryGuess)) out.industryGuess = j.industryGuess;
    if (j.summary && typeof j.summary === 'string') out.summary = clean(j.summary, 200);
    return (out.company || out.stateGuess) ? out : null;
  } catch { return null; }
}

/* ---------- Tier 1: hardened scraper ---------- */
const clean = (s, n) => String(s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function parseJsonLd(html) {
  const out = {};
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks.slice(0, 5)) {
    try {
      const raw = b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
      const j = JSON.parse(raw);
      const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      for (const n of nodes) {
        const type = String(n['@type'] || '');
        if (/Organization|LocalBusiness|Corporation/i.test(type)) {
          if (!out.company && n.name) out.company = clean(n.name, 80);
          const addr = n.address && (Array.isArray(n.address) ? n.address[0] : n.address);
          if (!out.stateGuess && addr && addr.addressRegion) {
            const r = String(addr.addressRegion).toUpperCase().trim();
            if (ABBRS.has(r)) out.stateGuess = r;
            else if (STATE_NAMES[r.toLowerCase()]) out.stateGuess = STATE_NAMES[r.toLowerCase()];
          }
          if (!out.employeesGuess && n.numberOfEmployees) {
            const v = parseInt(n.numberOfEmployees.value || n.numberOfEmployees, 10);
            if (Number.isFinite(v) && v > 0) out.employeesGuess = Math.min(v, 100000);
          }
        }
      }
    } catch { /* malformed ld+json is common; skip */ }
  }
  return out;
}

function findState(html) {
  const zip = html.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?/);
  if (zip && ABBRS.has(zip[1])) return zip[1];
  const lower = html.toLowerCase();
  let best = null, bestPos = -1;
  for (const [nm, ab] of Object.entries(STATE_NAMES)) {
    const p = lower.lastIndexOf(nm);
    if (p > bestPos) { bestPos = p; best = ab; }
  }
  return best;
}

async function scrapeEnrich(domain) {
  let html = await safeFetchPage('https://www.' + domain);
  if (!html) html = await safeFetchPage('https://' + domain);
  const out = { source: 'site' };
  Object.assign(out, html ? parseJsonLd(html) : {});

  if (!out.company && html) {
    const og = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']{2,80})["']/i)
            || html.match(/content=["']([^"']{2,80})["'][^>]*property=["']og:site_name["']/i);
    const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
    const name = og ? og[1] : title ? title[1].split(/[|–—•·]/)[0].split(/[.:]\s/)[0].trim() : '';
    if (name && name.length >= 2) out.company = clean(name, 80);
  }
  if (!out.stateGuess && html) out.stateGuess = findState(html) || undefined;
  if (!out.stateGuess && html) {
    for (const path of ['/contact', '/about']) {
      const page = await safeFetchPage('https://www.' + domain + path, 4000);
      if (page) { const s = findState(page); if (s) { out.stateGuess = s; break; } }
    }
  }
  if (html) {
    const title = html.match(/<title[^>]*>([^<]{2,160})<\/title>/i);
    const meta = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const probe = (title ? title[1] : '') + ' ' + (meta ? meta[1] : '') + ' ' + html.slice(0, 30000);
    for (const [ind, re] of INDUSTRY_KEYWORDS) { if (re.test(probe)) { out.industryGuess = ind; break; } }
  }
  return (out.company || out.stateGuess || out.industryGuess) ? out : null;
}

/* ---------- usage log ---------- */
async function recordLookup(env, record) {
  try {
    const res = await fetch(env.USAGE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      redirect: 'follow',                 // Apps Script answers via a googleusercontent redirect
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return !!(j && j.ok === true);
  } catch { return false; }
}

/* ---------- handlers ---------- */
const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});

export async function onRequestPost({ request, env }) {
  const self = new URL(request.url).origin;
  if (!allowedOrigin(request.headers.get('origin'), self)) return respond({ ok: false, error: 'forbidden_origin' }, 403);
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) return respond({ ok: false, error: 'json_required' }, 415);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (rateLimited(ip)) return respond({ ok: false, error: 'rate_limited' }, 429);

  let body;
  try { body = JSON.parse((await request.text()).slice(0, 4000)); } catch { return respond({ ok: false, error: 'invalid_json' }, 400); }

  const parsed = parseBusinessEmail(body && body.email);
  if (!parsed) return respond({ ok: false, error: 'business_email_required' }, 400);

  // Fail closed before spending anything on research.
  if (!env.USAGE_WEBHOOK_URL) return respond({ ok: false, error: 'log_not_configured' }, 503);
  // Every outbound fetch to the company's own site goes through safeFetchPage,
  // which re-validates the host and its DNS answers on each redirect hop.

  let profile = null;
  if (env.ANTHROPIC_API_KEY) profile = await llmEnrich(parsed.domain, env.ANTHROPIC_API_KEY, env.ENRICH_MODEL || 'claude-haiku-4-5');
  if (!profile) {
    profile = await scrapeEnrich(parsed.domain);
  } else if (!profile.stateGuess || !profile.industryGuess) {
    const scraped = await scrapeEnrich(parsed.domain);
    if (scraped) profile = { ...scraped, ...profile, source: 'research' };
  }
  profile = profile || { source: 'none' };

  const record = {
    timestamp: new Date().toISOString(),
    event: 'lookup_requested',
    email: parsed.email,
    domain: parsed.domain,
    company: profile.company || '',
    state: profile.stateGuess || '',
    industry: profile.industryGuess || '',
    employees: profile.employeesGuess || '',
    summary: profile.summary || '',
    source: profile.source,
    page: clean((body && body.page) || 'cost-lab', 40),
    userAgent: clean(request.headers.get('user-agent') || '', 150)
  };
  if (!(await recordLookup(env, record))) return respond({ ok: false, error: 'log_unavailable' }, 502);

  return respond({
    ok: true, recorded: true, domain: parsed.domain, source: profile.source,
    company: profile.company || null, stateGuess: profile.stateGuess || null,
    industryGuess: profile.industryGuess || null, employeesGuess: profile.employeesGuess || null,
    summary: profile.summary || null
  });
}

export async function onRequestGet() {
  return respond({ ok: false, error: 'method_not_allowed', hint: 'POST {"email":"you@company.com"}' }, 405);
}
