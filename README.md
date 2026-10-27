# PEOnomics v2

**peonomics.com** — PEO cost intelligence. The homepage **Cost Lab** compares annual
employer cost standalone vs. with a PEO — FICA, FUTA, SUTA, workers' comp, health, internal
admin, and the PEO fee — with every assumption editable, no email required, and no built-in
PEO savings. An optional business-email lookup prefills company details.

Built as a static site + Cloudflare Pages Functions. No framework, no build step, no
client-side secrets. Operating manual: `AI_GUIDE.md`. Backlog: `ROADMAP.md`. Cost Lab
internals: `docs/COST_LAB.md`.

## Architecture

```
index.html               Homepage + Cost Lab (cost-lab.js/.css) + report button (report-client.js)
compare.html             Quote Comparator (browser-only, CSV export)
data-library.html        51-state reference table (2025, historical) + sourced 2026 national benchmarks
privacy.html             Draft privacy notice (noindex)
quote.html               Redirect stub -> /#cost-lab
states/                  51 generated state rate pages + index
data/rates-2025.json     State model dataset (tax year 2025, preliminary). Per-figure confidence flags.
data/benchmarks-2026.json Sourced 2026 federal/national figures
functions/api/enrich.js  POST - business-email lookup (Haiku on the domain + SSRF-safe scraper), logged
functions/api/report-request.js  POST - Turnstile, server recompute, PDF+XLSX via Resend, logged
functions/api/report-status.js   GET - {available}
functions/lib/           Shared validation, report model, PDF and XLSX writers
apps-script/usage-log-v2.gs  Event log + deduped contacts sheet (setup steps in its header)
tools/build_states.py    Regenerates /states/ and sitemap.xml from the dataset
tests/                   node + Playwright suites
Legacy, unreferenced:    assets/js/engine.js, functions/api/lead.js, apps-script/lead-capture.gs
```

Plus the editorial library carried forward from v1: pricing explainer, PEO vs
payroll, vertical buyer guides (construction, restaurants, govcon, small
business), methodology.

## Deploy (Cloudflare Pages, ~5 minutes)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**
   → select `jcs3-com/PEOnomicsV2`.
2. Build settings: **Framework preset: None. Build command: (empty). Output
   directory: `/`** — it's a static site; Functions in `/functions` deploy
   automatically.
3. Secrets (Pages → Settings → Variables and Secrets): `ANTHROPIC_API_KEY`, `USAGE_WEBHOOK_URL`
   (`apps-script/usage-log-v2.gs`), and for emailed reports `RESEND_API_KEY`, `REPORT_FROM`,
   `TURNSTILE_SECRET` plus the public Turnstile site key in `index.html`. Step-by-step:
   `docs/COST_LAB.md` → "External setup". Redeploy.
4. Custom domain: Pages → Custom domains → add `peonomics.com`. (The old site is
   on GitHub Pages with a CNAME — don't switch DNS until this deploy looks right.)

## The dataset (read this)

`data/rates-2025.json` is **version 2025.1-preliminary**. Federal figures (FICA,
FUTA) are statutory and verified. State SUI and WC figures were compiled from
knowledge of 2025 published rates and each carries a confidence flag:

- `high` — statutory or well-established
- `med`  — likely correct, verify against the state agency before calling it final
- `low`  — estimate pending primary-source verification

The verification pass (state workforce agency for each SUI line, the Oregon DCBS
Premium Rate Ranking study for WC indexes, current-year KFF EHBS for health)
upgrades flags to `high` and bumps the version. The site displays ranges and
flags rather than false precision, by design. After editing the dataset, run:

```
python3 tools/build_states.py
```

## Security notes

- No secrets in this repo. `ANTHROPIC_API_KEY` and `USAGE_WEBHOOK_URL` live only as
  Cloudflare Pages secrets.
- The enrichment function fetches third-party homepages behind SSRF controls (strict
  hostname rules, DNS-over-HTTPS check against private ranges, per-hop redirect
  re-validation, no ports/credentials, HTML-only, 300 KB cap, 6 s budget), accepts POST
  only from the site's own origins, and is rate-limited best-effort per isolate. Add a
  Cloudflare WAF rate-limiting rule on `/api/enrich` for real abuse protection.
- Any token that has ever appeared in a chat, email, or screenshot should be
  treated as compromised and rotated.

## Disclosure

The buyer guides and methodology page carry forward the disclosed commercial
relationship from v1. Keep the disclosure current with how leads are actually
fulfilled — it's a legal requirement (FTC endorsement guides), not a style choice.
