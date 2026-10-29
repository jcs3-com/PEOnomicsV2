# Cost Lab — implementation notes

**Shipped:** 2026-10-27 (P0), extended same day with reports, comparator, data library (P1/P2).
**Backlog lives in `/ROADMAP.md`, not here.**
This file documents how the Cost Lab works so the next agent doesn't reverse-engineer it.

## Files

| File | Role |
|---|---|
| `index.html` | Homepage = hero + Cost Lab + report CTA + formula section + reading guide + tools + privacy note. Uses `site.css` chrome. |
| `assets/css/cost-lab.css` | Lab classes (tokens only). Also linked by compare/data-library/privacy for `.basis`, `.lab-textlink`, `.lab-dataset`. |
| `assets/css/compare.css` | Comparator, data library, privacy classes (tokens only). |
| `assets/js/cost-lab.js` | Model (`compute`, pure) + UI. `window.PEOLab.compute` for tests. `?state=XX` preselects the state. |
| `assets/js/report-client.js` | "Email this to me": checks `/api/report-status` + public Turnstile key, renders Turnstile, posts the snapshot. |
| `assets/js/quote-compare.js` | Quote Comparator (pure `window.PEOCompare.evaluateQuotes`). |
| `assets/js/data-library.js` | Renders `rates-2026.json` (state + wage tables, source list) and `benchmarks-2026.json`. |
| `functions/lib/validate.js` | Shared: personal-domain list, business-email parse, SSRF hostname + private-IP rules. |
| `functions/lib/report-model.js` | Server snapshot validation + the same model as `compute` + PDF line content. |
| `functions/lib/simple-pdf.js`, `simple-xlsx.js` | Dependency-free PDF (Helvetica/Courier) and XLSX (Inputs + Model, live formulas). |
| `functions/api/enrich.js` | `POST /api/enrich` — lookup: validate → enrich (domain only) → log → respond. |
| `functions/api/report-request.js` | `POST /api/report-request` — Turnstile → recompute → log → Resend → log outcome. |
| `functions/api/report-status.js` | `GET /api/report-status` → `{available}` only. |
| `apps-script/usage-log-v2.gs` | Sheet web app: "Usage Log" events + deduped "Contacts". Setup in its header. |
| `data/rates-2026.json` | **The model dataset** (generated). Every state figure with year + source. |
| `data/src/*.json`, `tools/build_rates_2026.py`, `tools/data2026/` | Sourced inputs and the builder/extractors that produce rates-2026.json. |
| `data/benchmarks-2026.json` | Sourced 2026 federal/national figures (Data Library context). |
| `compare.html`, `data-library.html`, `privacy.html` | New pages (privacy is a noindex draft). |
| `tests/` | `test_enrich.mjs`, `test_model.mjs`, `test_report.mjs` (node, no deps), `test_browser.py` (Playwright). |
| `quote.html` | Redirect stub → `/#cost-lab` (noindex; excluded from sitemap). |
| `assets/js/engine.js` | **Legacy, unreferenced.** Old model with built-in PEO savings. Do not re-wire. |
| `functions/api/lead.js`, `apps-script/lead-capture.gs` | **Legacy, unreferenced** sales-lead path. |

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
| SUTA % | `sui_rate_by_industry[industry]` else `sui_new_employer_rate` (incl. verified surcharges) | Benchmark; **Estimate** where new employers pay an industry average (2025 fallback) | rates-2026.json ← state agencies (8 priority states) / U.S. DOL July 2026 |
| WC $/100 | `wc_index_per_100 × wc_industry_multipliers[industry]` | **Estimate** (sourced index × unsourced multiplier) | Oregon DCBS 2024 index |
| Health $/enrollee | `health.single_employer_share[lt50 or ge50]`, else `total`, else U.S. | Benchmark | AHRQ MEPS-IC 2025 state tables (premium − employee contribution) |
| Enrollment | `health.enrolled_pct[band]` | Benchmark | AHRQ MEPS-IC 2025 Table II.B.2.b |
| Avg wage | `wages[industry].value` (else the visitor's number) | Benchmark / Your input | BLS QCEW 2025 annual, private |
| PEPM | midpoint of `peo_admin.pepm_low/high` | Your input | practitioner range |
| Internal admin | $0 | Your input | optional "Use reference" = PwC 2011 CPI-adjusted PEPY tier |
| Admin avoided | $0 | Your input | capped at internal admin |

Override rules: editing wage/SUTA/WC/health/enrollment marks the field edited (basis becomes
**Your input**, **Restore** appears). Changing state always rebases SUTA and WC (state law);
changing industry rebases WC (and SUTA where the state publishes an industry rate); wage, health
and enrollment keep your edits across state/industry/headcount changes. Headcount crossing 50
rebases un-edited health and enrollment (MEPS-IC firm-size bands). "Reset cost assumptions"
restores SUTA/WC/health/enrollment and fee/admin fields; keeps company/state/industry/headcount/wage.

Data: `data/rates-2026.json` is **generated** by `tools/build_rates_2026.py` from `data/src/*.json`
(DOL table, agency-verified priority states, QCEW, MEPS-IC, Oregon). Never hand-edit it; edit the
source file (with its URL/date) and rebuild. `tests/test_data.py` fails if the committed file
differs from a fresh build. `data/rates-2025.json` is kept as the historical prior edition.

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
- `USAGE_WEBHOOK_URL` — **required for lookups and reports**; see `apps-script/usage-log-v2.gs` header.
- `RESEND_API_KEY`, `REPORT_FROM`, `TURNSTILE_SECRET` — required for reports (see below).
- `ENRICH_MODEL` — optional; default `claude-haiku-4-5`.

## `POST /api/report-request`

Body `{email, snapshot, turnstileToken, requestId}` (requestId = UUID from `crypto.randomUUID()`).
Order: origin = self → JSON → all 4 secrets present (else **503 `report_unconfigured`, zero outbound calls**)
→ size ≤ 12 KB → business email → UUID → snapshot range-check + server recompute (client totals ignored)
→ Turnstile siteverify (hostname must be a PEOnomics host) → log `report_requested` (fail → 503, nothing sent)
→ render PDF + XLSX → Resend with `Idempotency-Key: peonomics-report-<requestId>` → log
`report_accepted` (provider message id) or `report_failed` (provider status) → 200 `accepted_for_delivery` / 502.
GET → 405. Snapshot ranges mirror the Cost Lab inputs (employees 1–100,000; wage 0–5M; SUTA 0–30%; WC 0–100).

## External setup (owner — credentials never go through Claude, chat, or Git)

1. **Event log** — sheet "PEOnomics — Cost Lab Usage Log" (Drive › 34.02 Website › PEOnomics 2.0 — Site
   Build) › Extensions › Apps Script › paste `apps-script/usage-log-v2.gs` › Deploy › Web app (Execute as Me,
   Anyone) › copy URL › Cloudflare Pages `peonomicsv2` › Settings › Variables and Secrets › Secret
   `USAGE_WEBHOOK_URL` (Production).
2. **Resend** — create account, add domain `peonomics.com`, add the DNS records it lists in Cloudflare DNS,
   wait for "Verified", create a sending-only API key → secret `RESEND_API_KEY`; secret `REPORT_FROM` =
   `PEOnomics <reports@peonomics.com>` (must be on the verified domain).
3. **Turnstile** — Cloudflare › Turnstile › Add widget, hostnames `peonomics.com`, `www.peonomics.com`
   (add `peonomicsv2.pages.dev` only for preview testing), mode Managed. Put the **site key** (public, starts
   `0x`) in `index.html` `<meta name="peonomics-turnstile-site-key">`; **secret** → `TURNSTILE_SECRET`.
4. Redeploy (Deployments › Retry, or any push). `GET /api/report-status` must return `available: true`.
5. Owner inbox test; confirm rows in "Usage Log" and "Contacts".

## Usage log row

"Usage Log": `Timestamp (UTC) | Event | Business Email | Domain | Company | HQ State | Industry |
Employees (approx) | Summary | Enrichment Source | Page | User Agent | Request ID | Provider Message ID`.
"Contacts": one row per email with lookup/report counts, first/last seen, survey-eligibility date
(report accepted + 30 days), suppression flag. No IP address.
Formula-injection guarded. Not a CRM, not shared with PEOs.

## Tests

In `tests/`, no dependencies beyond Node 22 and (for the browser suite) Python Playwright:
```
node tests/test_enrich.mjs     # 18: validators, SSRF, fail-closed log, domain-only AI payload
node tests/test_model.mjs      # 15: Cost Lab model vs hand calculations, 51 x 6 neutrality
node tests/test_report.mjs     # 20: server/client parity (1,224 scenarios), PDF/XLSX, every endpoint path, health, limiter
node tests/test_apps_script.mjs # 6: real Apps Script in a VM behind real endpoints; dedupe, scenario log, XLSX recalc
python3 tests/test_data.py     # 466: rates-2026.json rebuild + provenance checks
python3 tests/test_seo.py      # 926: AI_GUIDE §4 checklist on every indexable page + disclosure + tracker
node tests/test_event.mjs      # 5: /api/event allowlist, no PII
node tests/test_feed.mjs       # 8: /api/feed go-live timing, window, RSS escaping, audit
python3 tests/test_posts.py    # 228: every numeral in every scheduled post traced to a data file
python3 tests/test_browser.py  # 104 at 1440 + 360 px with mocked APIs and stubbed Turnstile
python3 tests/test_browser.py https://peonomics.com --live   # production, read-only
WRITE_SAMPLES=/some/dir node tests/test_report.mjs           # writes sample PDF + XLSX to inspect
```
