/* GET /api/enrich?domain=acme.com
   Zero-budget enrichment: fetch the company homepage server-side and apply
   heuristics. Best-effort by design — every guess is user-editable on the page. */

const STATE_NAMES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO',
  'connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID',
  'illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA',
  'maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
  'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA',
  'west virginia':'WV','wisconsin':'WI','wyoming':'WY','washington, dc':'DC','washington dc':'DC'
};

const INDUSTRY_KEYWORDS = [
  ['construction_trades', /constructi|roofing|hvac|plumbing|electrical contract|excavat|remodel|general contractor|builder/i],
  ['hospitality_food', /restaurant|catering|hospitality|hotel|brewer|bakery|cafe|food service/i],
  ['transportation_logistics', /trucking|logistics|freight|transportation|shipping|fleet|courier|warehouse/i],
  ['light_manufacturing', /manufactur|fabricat|machin|assembly|industrial|production facility/i],
  ['retail_services', /retail|store|salon|cleaning|landscap|repair|staffing|e-commerce/i],
  ['clerical_professional', /consulting|software|technology|law firm|accounting|marketing|agency|financial|insurance|engineering|architec|medical practice|dental/i]
];

const BAD_DOMAIN = /^(gmail|yahoo|hotmail|outlook|aol|icloud|proton(mail)?|msn|live|comcast|verizon|me|mail|ymail)\./i;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const domain = (url.searchParams.get('domain') || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });

  if (!domain || !domain.includes('.') || BAD_DOMAIN.test(domain)) {
    return json({ ok: false, reason: 'invalid-or-freemail' }, 400);
  }

  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://' + domain, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'PEOnomicsBot/1.0 (+https://peonomics.com)' }
    });
    clearTimeout(t);
    if (res.ok) html = (await res.text()).slice(0, 200000);
  } catch (e) { /* unreachable site — return domain-derived guesses only */ }

  const out = { ok: true, domain };

  // company name: og:site_name > <title> (trimmed) > domain stem
  const og = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']{2,80})["']/i)
          || html.match(/content=["']([^"']{2,80})["'][^>]*property=["']og:site_name["']/i);
  const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  let name = og ? og[1] : title ? title[1].split(/[|\-–—•·]/)[0].trim() : '';
  if (!name || name.length < 2) {
    name = domain.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  out.company = name.slice(0, 60);

  // state guess: last state name appearing in the page (footers carry addresses),
  // else two-letter postal pattern near a zip code
  const lower = html.toLowerCase();
  let best = null, bestPos = -1;
  for (const [nm, ab] of Object.entries(STATE_NAMES)) {
    const p = lower.lastIndexOf(nm);
    if (p > bestPos) { bestPos = p; best = ab; }
  }
  if (!best) {
    const zip = html.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?/);
    if (zip) best = zip[1];
  }
  if (best) out.stateGuess = best;

  // industry guess: first keyword family that hits in title+meta+body
  const meta = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const probe = ((title ? title[1] : '') + ' ' + (meta ? meta[1] : '') + ' ' + lower.slice(0, 30000));
  for (const [ind, re] of INDUSTRY_KEYWORDS) {
    if (re.test(probe)) { out.industryGuess = ind; break; }
  }

  return json(out);
}
