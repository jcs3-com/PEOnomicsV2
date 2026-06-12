/* GET /api/enrich?domain=acme.com
   Tiered enrichment:
     Tier 2 — if env.ANTHROPIC_API_KEY is set: Claude Haiku + web search,
              returns researched company facts as strict JSON (~1-2¢/lookup).
     Tier 1 — hardened scraper fallback: browser UA, www fallback, JSON-LD
              Organization parsing, /contact page fallback. Always free.
   Every guess is user-editable on the quote page; this is prefill, not truth. */

const STATE_NAMES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO',
  'connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID',
  'illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA',
  'maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
  'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA',
  'west virginia':'WV','wisconsin':'WI','wyoming':'WY'
};
const ABBRS = new Set(Object.values(STATE_NAMES).concat(['DC']));

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

const BAD_DOMAIN = /^(gmail|yahoo|hotmail|outlook|aol|icloud|proton(mail)?|msn|live|comcast|verizon|me|mail|ymail)\./i;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchPage(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: BROWSER_HEADERS });
    clearTimeout(t);
    if (!res.ok) return '';
    return (await res.text()).slice(0, 250000);
  } catch { clearTimeout(t); return ''; }
}

/* ---------- Tier 2: Claude Haiku + web search ---------- */
async function llmEnrich(domain, apiKey) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: 'You are a B2B firmographic researcher. Respond with ONLY a JSON object, no prose, no markdown fences.',
        messages: [{
          role: 'user',
          content: `Research the company at the domain "${domain}". Use web search if needed (max 2 searches). Return ONLY this JSON:
{"company": "official company name or null",
 "stateGuess": "two-letter US state of HQ, or null if non-US/unknown",
 "employeesGuess": approximate US employee headcount as integer, or null,
 "industryGuess": one of ${JSON.stringify(INDUSTRIES)} or null,
 "summary": "one short sentence on what they do, or null"}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]
      })
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const out = { source: 'research' };
    if (j.company && typeof j.company === 'string') out.company = j.company.slice(0, 60);
    if (j.stateGuess && ABBRS.has(String(j.stateGuess).toUpperCase())) out.stateGuess = String(j.stateGuess).toUpperCase();
    if (Number.isFinite(j.employeesGuess) && j.employeesGuess > 0) out.employeesGuess = Math.min(Math.round(j.employeesGuess), 100000);
    if (INDUSTRIES.includes(j.industryGuess)) out.industryGuess = j.industryGuess;
    if (j.summary && typeof j.summary === 'string') out.summary = j.summary.slice(0, 160);
    return (out.company || out.stateGuess) ? out : null;
  } catch { clearTimeout(t); return null; }
}

/* ---------- Tier 1: hardened scraper ---------- */
function parseJsonLd(html) {
  const out = {};
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks.slice(0, 5)) {
    try {
      const raw = b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
      let j = JSON.parse(raw);
      const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      for (const n of nodes) {
        const type = String(n['@type'] || '');
        if (/Organization|LocalBusiness|Corporation/i.test(type)) {
          if (!out.company && n.name) out.company = String(n.name).slice(0, 60);
          const addr = n.address && (Array.isArray(n.address) ? n.address[0] : n.address);
          if (!out.stateGuess && addr && addr.addressRegion) {
            const r = String(addr.addressRegion).toUpperCase().trim();
            if (ABBRS.has(r)) out.stateGuess = r;
            else if (STATE_NAMES[r.toLowerCase()]) out.stateGuess = STATE_NAMES[r.toLowerCase()];
          }
          if (!out.employeesGuess && n.numberOfEmployees) {
            const v = parseInt(n.numberOfEmployees.value || n.numberOfEmployees);
            if (Number.isFinite(v) && v > 0) out.employeesGuess = Math.min(v, 100000);
          }
        }
      }
    } catch { /* malformed ld+json is everywhere; skip */ }
  }
  return out;
}

function findState(html) {
  const lower = html.toLowerCase();
  let best = null, bestPos = -1;
  for (const [nm, ab] of Object.entries(STATE_NAMES)) {
    const p = lower.lastIndexOf(nm);
    if (p > bestPos) { bestPos = p; best = ab; }
  }
  if (best) return best;
  const zip = html.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?/);
  return zip && ABBRS.has(zip[1]) ? zip[1] : null;
}

async function scrapeEnrich(domain) {
  let html = await fetchPage('https://www.' + domain);
  if (!html) html = await fetchPage('https://' + domain);

  const out = { source: 'site' };
  const ld = html ? parseJsonLd(html) : {};
  Object.assign(out, ld);

  if (!out.company && html) {
    const og = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']{2,80})["']/i)
            || html.match(/content=["']([^"']{2,80})["'][^>]*property=["']og:site_name["']/i);
    const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
    let name = og ? og[1] : title ? title[1].split(/[|–—•·]/)[0].split(/[.:]\s/)[0].trim() : '';
    if (name && name.length >= 2) out.company = name.slice(0, 60);
  }
  if (!out.company) {
    out.company = domain.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  if (!out.stateGuess && html) out.stateGuess = findState(html) || undefined;
  if (!out.stateGuess) {
    // addresses live on contact/about pages far more often than homepages
    for (const path of ['/contact', '/about']) {
      const page = await fetchPage('https://www.' + domain + path, 4000);
      if (page) { const s = findState(page); if (s) { out.stateGuess = s; break; } }
    }
  }

  if (html) {
    const title = html.match(/<title[^>]*>([^<]{2,160})<\/title>/i);
    const meta = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const probe = ((title ? title[1] : '') + ' ' + (meta ? meta[1] : '') + ' ' + html.slice(0, 30000));
    for (const [ind, re] of INDUSTRY_KEYWORDS) {
      if (re.test(probe)) { out.industryGuess = ind; break; }
    }
  }
  return out;
}

/* ---------- handler ---------- */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const domain = (url.searchParams.get('domain') || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });

  if (!domain || !domain.includes('.') || BAD_DOMAIN.test(domain)) {
    return json({ ok: false, reason: 'invalid-or-freemail' }, 400);
  }

  // Tier 2 first when configured; Tier 1 fills any gaps it leaves.
  let result = null;
  if (env.ANTHROPIC_API_KEY) result = await llmEnrich(domain, env.ANTHROPIC_API_KEY);
  if (!result) {
    result = await scrapeEnrich(domain);
  } else if (!result.stateGuess || !result.industryGuess) {
    const scraped = await scrapeEnrich(domain);
    result = { ...scraped, ...result };
  }

  return json({ ok: true, domain, ...result });
}
