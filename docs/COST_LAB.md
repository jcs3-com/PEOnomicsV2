# Cost Lab — implementation notes

**Shipped:** 2026-10-27 (P0). **Backlog lives in `/ROADMAP.md`, not here.**
This file documents how the Cost Lab works so the next agent doesn't reverse-engineer it.

## Files

| File | Role |
|---|---|
| `index.html` | Homepage = hero + Cost Lab + formula section + reading guide + privacy note. Uses `site.css` chrome. |
| `assets/css/cost-lab.css` | Lab-only classes. Tokens only — no hard-coded colors, fonts, radii. |
| `assets/js/cost-lab.js` | Model (`compute`, pure) + UI wiring. `window.PEOLab.compute` is exposed for tests. |
| `functions/api/enrich.js` | `POST /api/enrich` — business-email lookup: validate → enrich (domain only) → log → respond. |
| `apps-script/usage-log.gs` | Google Apps Script web app that appends one row per lookup to the private usage sheet. |
| `quote.html` | Redirect stub → `/#cost-lab` (noindex; excluded from sitemap). 148 internal links still point here. |
| `assets/js/engine.js` | **Legacy, unreferenced.** Old model with built-in PEO savings (−12% health, −10% WC, −80% admin). Do not re-wire. |
| `functions/api/lead.js`, `apps-script/lead-capture.gs` | **Legacy, unreferenced** sales-lead path from the old quote page. Not used by the Cost Lab. |

## The model (no automatic PEO savings)

N = employees, W = average wage, one state per model.

```
FICA   = N × [min(W, SS base) × 6.2% + W × 1.45%]
FUTA   = N × min(W, $7,000) × (0.6% + state credit reduction)
SUTA   = N × min(W, state wage base) × SUTA%
WC     = N × W / 100 × rate per $100        (default: state index × industry multiplier)
Health = N × enrollment% × employer cost per enrollee
Admin  = current: A      PEO: A − min(AV, A)
Fee    = PEO only: N × PEPM × 12
```

Both columns use identical FICA/FUTA/SUTA/WC/health unless the visitor fills the optional
**PEO-side rates** (SUTA, WC, health — blank = same). With defaults, `delta == PEO fee`
exactly; a test asserts this for all 51 jurisdictions × 6 industries.

Defaults and their labels:

| Input | Default | Basis tag | Source |
|---|---|---|---|
| SUTA % | state `sui_new_employer_rate` | Benchmark / **Estimate** if `sui_confidence=low` | rates-2025.json |
| WC $/100 | `wc_index_per_100 × wc_industry_multipliers[industry]` | Benchmark / **Estimate** if low | rates-2025.json |
| Health $/enrollee | `health.employer_annual_single_avg` (7,580) | Benchmark | KFF small-firm single, national |
| Enrollment | 60% | Your input (illustrative) | none — user should set |
| Avg wage | $65,000 | Your input (illustrative) | none — not a benchmark |
| PEPM | midpoint of `peo_admin.pepm_low/high` | Your input | practitioner range |
| Internal admin | $0 | Your input | optional "Use reference" = PwC 2011 CPI-adjusted PEPY tier |
| Admin avoided | $0 | Your input | capped at internal admin |

Override rules: editing SUTA/WC/health marks the field edited (shows **Restore**). Changing
state (by hand or via lookup) rebases SUTA and WC; changing industry rebases WC; health
overrides survive state changes. "Reset cost assumptions" restores all cost defaults but keeps
company/state/industry/headcount/wage.

Rounding: defaults keep 4 decimals (3 decimals lost $8 on MD/office WC: 0.3675 → 0.367).

## `POST /api/enrich`

Request `{"email":"name@company.com","page":"cost-lab"}`, `content-type: application/json`.

| Status | `error` | Meaning |
|---|---|---|
| 200 | — | `{ok, recorded:true, domain, source, company, stateGuess, industryGuess, employeesGuess, summary}` |
| 400 | `business_email_required` / `invalid_json` | personal domain, malformed, or unsafe host |
| 403 | `forbidden_origin` | browser Origin not peonomics.com / *.peonomicsv2.pages.dev / localhost |
| 415 | `json_required` | wrong content type (also blocks simple cross-site form posts) |
| 429 | `rate_limited` | >8 lookups / 10 min per IP per isolate (best effort) |
| 502 | `log_unavailable` | usage log did not confirm → **no profile returned** |
| 503 | `log_not_configured` | `USAGE_WEBHOOK_URL` unset → returns before any research spend |
| 405 | — | GET is retired (was an open, unlogged enrichment proxy) |

Order: validate → (fail closed if no log URL) → Haiku research with **domain only** →
scraper fallback/gap-fill → append row → return. The mailbox name never leaves the function
except to the private log.

SSRF controls on every scraper fetch (`safeFetchPage`): strict hostname grammar; no IP
literals, numeric TLDs, embedded-IPv4 or hex labels; blocked suffixes (`localhost`, `.local`,
`.internal`, `.corp`, `.test`, `.arpa`, `nip.io`, `sslip.io`, `*.pages.dev`, …); DNS-over-HTTPS
A/AAAA resolution with private/reserved ranges refused (RFC1918, loopback, link-local
169.254/metadata, CGNAT, ULA, v4-mapped); manual redirects (max 3), each hop re-validated;
no ports or userinfo; HTML content-type only; 300 KB read cap; 6 s budget.

Env (Cloudflare Pages › peonomicsv2 › Settings › Variables and Secrets, Production):
- `ANTHROPIC_API_KEY` — set (verified 2026-10-27: live lookups returned `source:"research"`).
- `USAGE_WEBHOOK_URL` — **required for lookups**; see `apps-script/usage-log.gs` header for setup.
- `ENRICH_MODEL` — optional; default `claude-haiku-4-5`.

## Usage log row

`Timestamp (UTC) | Event | Business Email | Domain | Company | HQ State | Industry |
Employees (approx) | Summary | Enrichment Source | Page | User Agent`. No IP address.
Formula-injection guarded. Not a CRM, not shared with PEOs.

## Tests

Run from a scratch dir (no package.json in repo by design):
- Function tests: copy `functions/api/enrich.js` to `*.mjs`, import, mock `fetch` — validators,
  SSRF (rebinding, inward redirects, ports/userinfo), fail-closed log, domain-only AI payload,
  rate limit. 18 cases on 2026-10-27.
- Model tests: `globalThis.window={}`, import `assets/js/cost-lab.js`, assert against
  hand-computed MD 25 @ $65k (FICA 124,313 · FUTA 1,050 · SUTA 5,525 · WC 5,972 · health
  113,700 · fee 48,000). 15 cases.
- Browser: Playwright at 1440 and 360 px — 51 states, single geo selector, no Apollo
  request, no overflow, live recalculation, overrides, lookup success/503/personal email,
  disabled email CTA, quote redirect. 54 checks.
