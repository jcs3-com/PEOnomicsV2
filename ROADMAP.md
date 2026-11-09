# ROADMAP.md — PEOnomics canonical backlog

This file is the **only** source of truth for what is done, open, dropped, or pending a decision.
Not chat history. Not artifacts. When you finish or add work, update this file in the same commit.

**Last updated:** 2026-11-09 (privacy notice final + indexable; /quote → 301. Earlier today: real 404 page; unknown URLs no longer serve the homepage as a 200. 2026-11-06: Search Console + Bing verified; Analytics Engine `EVENTS` bound + Crawler Hints on via the Cloudflare API connector; traffic baseline recorded. 2026-11-03: Maryland FAMLI calculator page + FAMLI rule correction + first-payment countdown posts + Bing/Crawler Hints owner steps; earlier today: Comparator report sends with incomplete quotes + owner copy; earlier today: drag-and-drop quote files parsed in the browser + emailed comparison report. Report delivery LIVE in production 2026-11-03. Prior: Homepage first screen simplified to email box + slider Cost Lab. Prior: auto-post feed for the LinkedIn page; DMV Employer Cost Index; VA SUI 2.73%. Prior: activation release: health check, shared rate limiter, scenario logging, Turnstile key via env; data/unification/analytics releases follow)

---

## ✅ Done — shipped & live

- Quote builder (`quote.html` + `assets/js/engine.js`) — vanilla JS, working.
- Site structure & navigation; "financial print" design system (`assets/css/tokens.css`).
- 51 state pages generated from `data/rates-2025.json` via `tools/build_states.py` (+ `states/index.html`).
- Core content pages + ranking pages (best-peo-*).
- Pages Function code for `/api/enrich` and `/api/lead`; Apps Script lead-capture in repo.
- Cloudflare Pages ↔ GitHub `main` auto-deploy pipeline.
- Operating model: `AI_GUIDE.md`; Claude ships and deploys from the Claude app (owner, 2026-11-03), Path A only as fallback.
- **P0 — SEO floor (this batch):**
  - `rel="canonical"` added to all 13 non-state pages (state pages already had it).
  - Open Graph added to index, quote, hidden-costs (the 3 that lacked it).
  - JSON-LD added to index (Organization+WebSite), quote (WebApplication), hidden-costs +
    methodology (Article), about (Organization), contact (ContactPage), insights (CollectionPage).
  - **Fixed broken OG images site-wide**: existing pages referenced `assets/images/og-*.png`
    that never existed. Created branded `assets/images/og-default.png` (1200×630) and pointed
    every page's `og:image` at it.
  - `robots.txt` + `sitemap.xml` (65 URLs) created; `build_states.py` now regenerates the
    sitemap on every run (`build_sitemap()`).
- **Styling bug fixed (broken nav/footer on 10 pages).** Root cause: `content.css`/`ranking.css`
  are additive and carry no chrome, but the 6 article + 4 ranking pages linked a role sheet
  *without* `site.css`. Resolved by linking `site.css` on all 13 pages; the role sheets share
  zero selectors with `site.css`, so load order is safe. `AI_GUIDE.md` §3 rewritten so it can't recur.
- **Upload fallout fixed:** `og-default.png` relocated from repo root to `assets/images/`
  (og:image no longer 404s); duplicate root `build_states.py` removed — `tools/build_states.py`
  is the single canonical generator (with `build_sitemap()`).

- **Cost Lab P0 (2026-10-27)** — homepage rebuilt around an interactive, email-optional calculator.
  Details: `docs/COST_LAB.md`.
  - Usable immediately; business email optional; personal domains rejected (client + server).
  - Exactly one geographic control, **HQ / Main Worksite State**; every inferred field editable;
    results recalculate on every input.
  - Neutral model: no default PEO discounts (old engine's −12% health / −10% WC / −80% admin
    removed). Both columns identical except the PEO fee, admin cost the visitor says a PEO
    replaces, and optional PEO-quoted SUTA/WC/health. Delta = fee by default (tested, 51×6).
  - Every line tagged **Statutory / Benchmark / Estimate / Your input**; dataset year/version
    shown; 2025 figures labeled historical, never "2026". Formulas published on-page (`#the-math`).
  - `POST /api/enrich` rebuilt: business-email validation, Haiku research on **domain only**,
    scraper fallback, SSRF hardening (DoH private-range check, per-hop redirect validation,
    blocked suffixes, no ports/userinfo, HTML-only, size cap), origin check, best-effort rate
    limit, **fail-closed usage logging** (no log → no enrichment). Old open GET proxy retired.
  - Usage log Apps Script (`apps-script/usage-log.gs`, since replaced by `usage-log-v2.gs`): email, domain, company, state, industry,
    approx. headcount, summary, source, page, UA, timestamp. Not a CRM; nothing to PEOs.
  - **Apollo tracker removed** from the homepage.
  - "Email this to me" CTA present and **disabled** with an honest note (P1). Print view works.
  - `quote.html` → redirect stub to `/#cost-lab` (noindex; generator now skips noindex pages
    in `sitemap.xml`).
  - Unsourced hero stats (4.5M / $28,700 / 14%) removed from the homepage with the old hero.
  - Shared mobile nav fix in `site.css` (hidden links' flex gaps no longer squeeze the CTA).
  - **Verified 2026-10-27:** `ANTHROPIC_API_KEY` is set in production — live `/api/enrich`
    returned `source:"research"` before this release (closes the old P1 "verify enrich live").

- **P1/P2 consolidated build (2026-10-27, second release)** — details in `docs/COST_LAB.md`.
  - **Emailed report pipeline (code live, delivery OFF until secrets exist):** `POST /api/report-request`
    validates business email (shared `functions/lib/validate.js`), verifies Cloudflare Turnstile
    (hostname-bound), **recomputes the scenario server-side** (`functions/lib/report-model.js`;
    parity with the Cost Lab tested on 1,224 randomized scenarios across 51 states × 6 industries),
    logs `report_requested` before sending and `report_accepted`/`report_failed` after, and sends a
    PDF + editable two-sheet XLSX via Resend with `Idempotency-Key = requestId`. Unconfigured → 503
    before any third-party call. UI says "accepted for delivery", never "delivered".
    `GET /api/report-status` returns only `{available: bool}`; the button and Turnstile stay off
    until it is true AND a public site key is set.
  - PDF: Courier-aligned table, word-wrapped notes, data year/version, limitations. XLSX: Inputs +
    Model sheets with live formulas; blank PEO-side rates are formulas pointing at the standalone
    cell; verified by editing inputs and recalculating in LibreOffice (matches the Cost Lab).
  - **Event log v2** (`apps-script/usage-log-v2.gs`, replaces v1): append-only "Usage Log" + deduped
    "Contacts" (counts, first/last seen, survey-eligibility date, suppression flag). No pipeline.
  - **Quote Comparator** (`/compare.html`): three proposals, PEPM or % payroll, blank ≠ $0 ("Incomplete"),
    first-year + three-year totals, CSV export, browser-only.
  - **Data Library** (`/data-library.html`): 51-jurisdiction table rendered from `rates-2025.json`
    (labeled historical), filter + CSV; **2026 national benchmarks** rendered from
    `data/benchmarks-2026.json`: SSA wage base $184,500; KFF EHBS 2026 single $9,804 / worker $1,672,
    family $28,303 / worker $7,471 (+ derived employer shares). Each checked at the primary source on
    2026-10-27. Not blended into the Cost Lab's 2025 state defaults.
  - **Privacy notice** (`/privacy.html`) published as a labeled **draft**, `noindex`, out of sitemap.
  - State pages: real `<h1>`; CTA deep-links `/?state=XX#cost-lab` (lab preselects the state);
    "verified" labels replaced — FICA "statutory", FUTA "statutory" or "estimate" (credit-reduction
    states), dataset flags shown as "high/medium confidence" or "estimate" (also in the Cost Lab).
  - 148 internal `/quote.html` links re-pointed to `/#cost-lab` (content pages + generator).
  - Fixed: report CTA was unclickable under the sticky results ledger (moved below the grid).
  - Tests now live in `tests/` (no deps): `node tests/test_enrich.mjs`, `test_model.mjs`,
    `test_report.mjs`; `python3 tests/test_browser.py [URL --live]`. 127 checks on release.
  - Package correction: the handoff's `test_browser.py` expected $48,000 admin for 25 × $150 PEPM;
    correct is $45,000 (its code was right, its assertion wrong).

---

- **Activation release (2026-10-27, third release)** — owner checklist in `docs/OWNER_SETUP.md`.
  - `GET /api/health`: booleans only (which secrets production sees) so the owner can confirm setup without exposing values.
  - Turnstile public site key now read from Pages variable `TURNSTILE_SITE_KEY` via `/api/report-status` — no code change
    needed after creating the widget (the `[[TODO]]` meta placeholder is gone; the meta tag still overrides if set).
  - Shared limiter `functions/lib/ratelimit.js` (in-isolate + per-data-center Cache API, hashed IP, fails open):
    enrich 8/10 min, reports 6/hour per IP. WAF rule remains the authoritative control (owner).
  - Report events now log the **final edited scenario** (all inputs) + annual current / with-PEO / delta; Contacts keep
    the last report scenario. Apps Script v2.1 (`usage-log-v2.gs`) — extends existing headers in place.
  - `tests/test_apps_script.mjs`: runs the real Apps Script in a VM behind the real endpoints — lookup → report →
    dedupe (mixed-case email = one contact), counters, survey date, scenario columns, PDF totals, XLSX recalculated
    in LibreOffice, rate limits.

- **2026 sourced dataset release (2026-10-27, fourth release)** — `data/rates-2026.json`, generated by
  `tools/build_rates_2026.py` from `data/src/` (each file carries source URL + review date); `tests/test_data.py` (466 checks).
  - SUTA 2026, all 51: wage bases + new-employer base rates from **U.S. DOL Significant Provisions (July 2026)**,
    transcription cross-checked against the PDF text. **Priority states checked at the agency** (DC, MD, VA, CA, TX, FL,
    NY, OH) incl. surcharges DOL excludes: DC 2.7%+0.2% AFA; CA 3.4%+0.1% ETT; NY 4.025%+0.075% RSF; OH 2.7%+0.15%
    TCSF (construction 5.85%); MD 2.6%; TX 2.7%; FL 2.7%; VA 2.5% base (add-ons unpublished → medium confidence).
    7 industry-average states (LA MN MT NM UT WA WY) have no single 2026 rate → 2025 value, labeled 2025/estimate.
  - Federal 2026: SS base $184,500 (SSA); FUTA 0.6%/$7,000; CA credit reduction 1.5% = statutory next step,
    **labeled estimate** until DOL's November determination (2025 final 1.2%, Federal Register 2026-00342).
  - Wages: **BLS QCEW 2025 annual**, private, state × 6 industries (300/306 cells; suppressed sectors averaged from
    disclosed subsectors ≥2,000 jobs and labeled "partial"; 6 cells blank → visitor's own number).
  - Health: **AHRQ MEPS-IC 2025 state tables** — employer share of single (and family) coverage = premium − employee
    contribution, by firm size (<50 / 50+); enrollment % (II.B.2.b). AHRQ-flagged unreliable/suppressed cells unused.
  - Workers' comp: **Oregon DCBS 2024 premium rate ranking** index (replaces the old unsourced index); × the
    unsourced industry multiplier, so WC is always labeled **Estimate**.
  - Cost Lab: same single HQ / Main Worksite State control; wage, health, enrollment, SUTA, WC defaults now sourced
    with a link under each field; edits persist and show Restore; 50-employee band switch; server report recomputes
    on the same file. Neutral model unchanged (delta = fee by default, 51×6 test).
  - Data Library rebuilt (state table, wage-by-industry table, sources section, CSV of every field); 51 state pages
    + index regenerated with 2026 figures, sources, real `<h1>`, OG + JSON-LD, unified nav/footer (`tools/site_chrome.py`).
  - **SEO bug fixed:** every canonical/og:url/sitemap URL ended in `.html`, which Cloudflare 308-redirects → all
    66 URLs were "page with redirect". Now extensionless site-wide (`tools/normalize_urls.py`); internal links too.

- **Site unification + measurement release (2026-10-27, fifth release)**
  - All 15 hand-authored pages + 52 generated pages share one nav/footer (`tools/site_chrome.py`,
    `tools/unify_pages.py`). Old v1 chrome was rendering broken (raw mobile link list, unstyled bullet footer,
    oversized SVG arrows, dark hard-coded gradient blocks).
  - **Removed false funnel claims** on ranking/content pages ("run real carrier rates… 60 seconds… advisor
    follow-up 1d", "reply with a structured breakdown"): replaced with one tokens-only Cost Lab panel.
    Per-ranking-page Formspree lead forms ("Compare my options") removed — the contact page form remains.
    "Get a Quote"/"quote builder" wording → Cost Lab. About page no longer names CFOs/brokers as the audience.
  - **Disclosure preserved and extended:** every page footer now carries the XcelHR paid-referral disclosure
    (owner's existing wording, condensed) plus the statement that the tools favor no provider. Ranking-page top
    "Sponsored analysis" banners and the methodology disclosure are unchanged.
  - Measurement: `assets/js/track.js` + `POST /api/event` (allowlisted events: calc_used, lookup_submitted,
    report_requested, comparator_used, comparator_csv, data_csv, cost_lab_cta; GPC/DNT honored; no PII —
    tested). Stored in Analytics Engine `EVENTS` (dataset `peonomics_events`, bound 2026-11-06).
  - Sitemap (66 URLs) and every canonical/og:url verified extensionless and 200 in production. /contact had lost its
    canonical, og:image and JSON-LD (restored). `tests/test_seo.py` now enforces §4 on all 66 indexable pages.
- **DMV Employer Cost Index** (2026-10-28): `/dmv-employer-cost-index` — flagship citable data page. Statutory
  employer cost per employee in DC, MD and VA (FICA, FUTA, new-employer SUI, DC Paid Family Leave, MD FAMLI from
  2027), minimum-wage floor by jurisdiction (incl. Montgomery tiers, Howard, Prince George's), tipped cash wage,
  enacted 2027–2028 changes, methodology, citation block. Federal + SUI figures read from `rates-2026.json`;
  paid-leave, wage-floor and 2027 wage base from new sourced file `data/dmv-index-2026.json`. Calculator:
  `assets/js/dmv-cost-index.js` (pure `window.PEODmv.compute`). Tests: `tests/test_dmv_index.py` (every static
  figure equals a fresh computation) and `tests/test_dmv_index.mjs` (model). Footer link added site-wide.
  - VA 2026 new-employer SUI corrected to **2.73%** (2.50% base + 0.20% fund-building + 0.03% pool-cost),
    owner-confirmed; source file updated, confidence stays `med` until checked against a VEC page.

- **Auto-post feed — LinkedIn page** (2026-10-28): `GET /api/feed` (RSS) serves templated posts at their go-live
  time (9:00 ET), so posting runs with no deploys or cron; Zapier (free plan) publishes each new item to the
  PEOnomics page. Two formats: **Countdown** (days to a dated change) and **Data release** (dormant until the
  owner sets its date). Templates in `data/posts/series.json` carry no typed numbers: every figure is a ref into
  rates-2026 / dmv-index-2026 / benchmarks-2026. `tools/build_posts.py` renders `data/post-schedule.json` + one
  1200×627 card per post in the tokens.css palette and site faces. Schedule: 20 posts, Oct 30 2026 – Dec 2 2027
  (DMV index launch; FUTA determination; MD FAMLI; SS wage base; VA minimum wage; Jan 1 renewals; Jan 1 DMV
  reset; 2028 VA $15 and FAMLI benefits). Audit view `/api/feed?audit=1`. Tests: `tests/test_posts.py` (228,
  independent numeral provenance; refuses unflagged low-confidence figures and unready releases) and
  `tests/test_feed.mjs` (8). Owner Zap setup: `docs/OWNER_SETUP.md` §7.
  - **Two posts a week (2026-10-28):** `cadence` in series.json tops every week up to 2 posts (Tue/Thu 9:00 ET,
    US holidays skipped) from data-note **rotations**, each limited to its data edition's shelf life:
    *state cost note* (avg private pay, employer FICA, employer share of single health coverage at firms <50; 44
    states, DMV first then by employment; 7 skipped where AHRQ flags the <50 cell unreliable) through 2027-06-30, and
    *DMV industry pay* (14 of 18 DC/MD/VA × industry cells; suppressed/partial cells skipped) through 2027-08-31.
    78 posts scheduled Oct 28 2026 – Dec 2 2027. Rotation posts link to the state pages. The DMV launch post went out
    manually on 2026-10-28 (LinkedIn share 7521407288482484225); its release date is set to that day.

- **Post calendar v2 (2026-10-29, owner rules):** countdowns post only on exact milestones (60 days, 30 days,
  1 month, 1 week; `milestones` in series.json; the builder refuses day offsets and refuses a milestone on a
  weekend/no-post day). Otherwise a post is *dated* ("Tuesday, Nov. 10: …", label "Key date"). No-post days:
  Thanksgiving + eve, Dec 7, Dec 23–Jan 1, federal holidays; one post a week Dec 7–Jan 1. New: binders countdown
  (1 month to the early-December binder deadline for Jan. 1 renewals; date from the owner, `data/posts/owner-dates.json`,
  copy says "early December"). FUTA moved to Nov 5 as a dated post; FUTA "today" and the two renewal countdowns
  retired (duplicates); FAMLI dated Dec 15; DMV Jan. 1 roundup Dec 22 + Jan 5. Rotations alternate; weak posts
  pulled (31 smaller-state notes; DMV transportation/manufacturing pay). Open slots are listed in
  `data/post-schedule.json` meta.gaps (77 from Mar 9, 2027).

- **Homepage simplified (2026-11-02, owner request: "way too busy"):** first screen is now only the headline,
  one email box (the existing domain prefill, `#businessEmail`) and a slider Cost Lab — state, industry, and
  sliders for employees / avg. wage / PEO fee (PEPM) with the three totals. Each slider mirrors its number field
  (number stays the source of truth; typed values beyond the slider range are kept exactly). Everything else moved
  below the fold under `#breakdown`: company, SUTA/WC/health/enrollment, admin, PEO-side rates, sources for the
  first-screen defaults, the itemized ledger, report/print. Removed from the homepage: the "What the model uses"
  hero ledger, the "Three kinds of number" reading guide, and the "More free tools" block (tools stay in nav/footer;
  the per-line basis tags and `#the-math` carry the same information). `#the-math` and `#privacy` (disclosure text
  unchanged) remain. `/#cost-lab` now lands on the first screen. Model, IDs and defaults unchanged ($346,665 /
  +$48,000 MD default). `tests/test_browser.py` adds first-screen checks (email + totals above the fold on desktop,
  slider ↔ field sync).

- **Quote Comparator: drop quote files + full report (2026-11-03, owner request):**
  - `/compare` takes up to three quote files (drop zone, "Choose files", or drop/load per proposal card). PDF (pdf.js
    3.11.174 from jsDelivr, SRI-pinned, `isEvalSupported:false`, lazy-loaded only when a PDF is dropped), XLSX/XLSM and
    DOCX (own ZIP + XML reader; % cell formats honored), CSV/TSV/TXT. **Files are read in the browser and never
    uploaded.** Scans/images and legacy .xls/.doc are refused with a reason; nothing is invented.
  - `quote-parse.js` `extractQuote()`: deterministic label/unit rules, no LLM. Each filled field shows **From file** +
    the source line, or **Check** + the conversion (per-check fee × pay dates ÷ 12, monthly × 12, group EPLI ÷ headcount,
    contribution % × employee-only premium, payroll-weighted WC across class codes). Several WC class rates without
    payroll → no fill + warning (never averaged). Bundled ("all-inclusive") pricing → warning, rate not put in the admin
    fee. FUTA/FICA/experience-mod/termination-fee figures are excluded. Blank = not stated still holds.
  - Files fill common assumptions (employees, wage from payroll ÷ headcount, enrollment, SUTA wage base) only where the
    visitor hasn't typed; files are applied in order (A first) and a quote priced on a different census is flagged.
  - **"Want the full report?"** below the table: live teaser (gap in year one / three years and the line driving it),
    business email + Turnstile → `POST /api/report-request` `kind:"compare"`. Server recomputes (`functions/lib/compare-model.js`,
    parity-tested vs the page on 600 random scenarios), needs ≥2 complete proposals, logs before sending, emails a PDF
    (line table, years 1–3, all-in PEPM, gap driver, terms with file/check/edited provenance, **questions to put to each
    provider** generated from what each quote leaves unstated, limitations) + an XLSX with live formulas (a blank term
    shows "Incomplete"; recalculated in LibreOffice in tests). Same delivery switches as the Cost Lab report — **off in
    production until the P0.1 secrets exist** (`/api/report-status` returned `available:false` on 2026-11-03); the UI says so.
  - Event `quote_parsed` (outcome + file kind only) added to the `/api/event` allowlist. Privacy draft updated (file
    handling, jsDelivr). Download CSV demoted to a secondary button; the report is the primary action.
  - Tests: `tests/test_quote_parse.mjs` (14, incl. LibreOffice-made XLSX/DOCX), `tests/test_compare_report.mjs` (10),
    `tests/test_browser.py` +23 (real PDF/XLSX/TXT through the page, scan/image refusals, report payload). Fixtures in
    `tests/fixtures/` are text; PDF/XLSX are generated at test time.

- **Comparator report — incomplete quotes allowed + owner copy (2026-11-03, owner request):** the send button no longer
  needs every field. Any quote with at least one figure can be sent; each line prices on its own term ("Not stated"
  otherwise, on screen, CSV, PDF and the XLSX formulas), totals and ranking appear only for complete quotes, and the
  report lists what each quote is missing as questions. Opt-in checkbox "Help me fill in what's missing — reply to me
  by email". If Pages variable `REPORT_COPY_TO` is set, a copy of every comparison report goes there with
  Reply-To = the visitor and "HELP REQUESTED" in the subject when ticked; the Usage Log summary records
  "n of m complete; HELP REQUESTED; copy_sent". Privacy draft discloses the copy. `/api/health` adds `ownerCopy`.
- **Owner setup done 2026-11-03:** `USAGE_WEBHOOK_URL`, `RESEND_API_KEY`, `REPORT_FROM`, `TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET` live in production (`/api/health` all true); first real report logged requested → accepted.

- **Maryland FAMLI calculator (2026-11-03, traffic strategy):** `/maryland-famli-calculator` — a deadline page aimed at
  the December–January search spike before contributions start Jan 1, 2027. Inputs: employees in all locations (the
  15-employee test counts out-of-state staff), Maryland employees, average wage or a pasted wage column (exact, per-person
  cap), share of the employee half the employer covers, pay frequency. Outputs: employer cost, withholding, total remitted,
  quarterly payment, per-employee cost, per-paycheck deduction. Also a salary table, a dated to-do list (private-plan
  declaration Nov 15, 2026; registration; employee notice one pay period before deductions; first payment Apr 30, 2027;
  July 2027 notices; benefits by Jan 3, 2028), FAQ (`FAQPage` JSON-LD), citation block, sources. Model
  `assets/js/famli-calc.js` (pure `window.PEOFamli`); every rate, cap and date is read from `data/dmv-index-2026.json`.
  Event: existing `calc_used` (state MD, band, outcome `average_wage`/`pasted_wages`; no typed values).
  - **Data correction:** Maryland Labor's own page says employers under 15 still remit the 0.45% employee share (employees
    can't opt out). The old note and the Dec 15 post said they remit only "what they withhold." Fixed in
    `dmv-index-2026.json` (new fields: `employeeRate`, `maxTotalRate`, `firstRemittanceDue`, `headcountRule`, notice and
    private-plan dates, MD Labor sources), the DMV index timeline and the post copy. Index figures unchanged (employer share only).
  - Wiring: footer link site-wide (`site_chrome.py` → `unify_pages.py` + `build_states.py`), FAMLI note on `/states/md`,
    link from the DMV index timeline. Dec 15 FAMLI post now links to the calculator; new countdown
    `md-famli-first-payment-2027` (Mar 30 and Apr 23, 2027 → 38 posts). Per-page OG card `assets/images/og-famli.png` from
    new `tools/build_og.py` (figures read from data, same look as the post cards).
  - Tests: `tests/test_famli.py` (62: every static figure, FAQ ↔ JSON-LD, og:description re-derived from data),
    `tests/test_famli.mjs` (27: model incl. small-employer, out-of-state headcount, cap, cover share, paste parsing),
    `tests/test_browser.py` +12 (desktop + mobile).

- **2026-11-09 — Real 404 page (Search Console "Alternate page with proper canonical tag").** The repo had no
  `404.html`, so Cloudflare Pages served the homepage with HTTP 200 and `canonical=/` for every unknown URL
  (e.g. `/states/maryland`, `/best-peo`). Google read each one as a duplicate of `/`. Added `404.html` (noindex, no
  canonical, shared chrome, links to Cost Lab / comparator / states / data library); Pages now returns a true 404.
  Sitemap unchanged (generator skips noindex pages). The other notice, "Excluded by 'noindex' tag", is intended:
  `/quote` (redirect stub) and `/privacy` (draft until the owner finalizes it, see P1).

- **2026-11-09 — Privacy notice final; `/quote` is a server redirect.** Owner confirmed the terms (12-month retention,
  request channel via /contact). `privacy.html`: Draft label, "Proposed" tags and `noindex` removed; now in the sitemap
  (69 URLs). Footer link "Privacy (draft)" → "Privacy" site-wide via `site_chrome.py` (+ `unify_pages.py`,
  `build_states.py`). `quote.html` stub deleted; `_redirects` 301s `/quote` and `/quote.html` → `/#cost-lab`.
  `tests/test_browser.py` privacy check now asserts indexable and no draft label.

## 🔲 Open — prioritized

### P0.1 — owner-only setup (credentials; Claude must not handle them) — step-by-step in `docs/OWNER_SETUP.md`
- [x] **Usage/event log:** paste `apps-script/usage-log-v2.gs` into the sheet "PEOnomics — Cost Lab
      Usage Log" (Drive › 34.02 Website › PEOnomics 2.0 — Site Build), deploy as web app, add the URL
      as Pages secret `USAGE_WEBHOOK_URL`. Unlocks business-email prefill AND is required for reports.
- [x] **Resend:** account + verify sending domain `peonomics.com` (DNS records in Cloudflare), API key →
      Pages secret `RESEND_API_KEY`; sender → Pages secret `REPORT_FROM` (e.g. `PEOnomics <reports@peonomics.com>`).
- [x] **Turnstile:** widget for peonomics.com (+ www); **public** site key → Pages variable `TURNSTILE_SITE_KEY`;
      secret → Pages secret `TURNSTILE_SECRET`. Check `/api/health`.
- [ ] **WAF rate-limit rule** on `/api/enrich` and `/api/report-request` (in-code limiter is per-isolate).
- [x] **Analytics Engine binding** `EVENTS` → dataset `peonomics_events`, production only (2026-11-06, via the
      Cloudflare API connector after the owner enabled Analytics Engine for the account; preview builds don't log).
      Verified: deploy succeeded and a test row landed (`outcome = setup_test`, `path = /setup-test`; exclude it from
      counts). Query: `POST /accounts/{id}/analytics_engine/sql`, `SELECT blob1 AS name, count() ... FROM
      peonomics_events`. Note: if Analytics Engine is ever disabled, Functions deploys fail until the binding is removed.
- [x] **Cloudflare Crawler Hints** on (IndexNow), 2026-11-06 via the API connector (zone flag `cache.crawlhints_enabled`).
- [x] **Search Console** (2026-11-06): Domain property verified by DNS TXT, added via Cloudflare sign-in. An older
      `google-site-verification` TXT from 2026-06-12 also exists; leave it, a separate property may depend on it.
      Owner to submit the sitemap and request indexing for the priority pages (FAMLI first) if not already done.
- [x] **Bing Webmaster Tools** (2026-11-06): verified by CNAME `0fc090dd0067a9b3075fc9240144958e` → `verify.bing.com`
      (DNS only; keep it, Bing re-checks). Sitemap via the Search Console import.
- [ ] **Traffic checks from the Claude app:** the Cloudflare API connector (`https://mcp.cloudflare.com/mcp`, custom
      connector) reads Web Analytics (GraphQL `rumPageloadEventsAdaptiveGroups`, siteTag
      `9be7a568b8c3435cad1f9d72335ab181`). Exclude `userAgentBrowser = ChromeHeadless` (Claude's test runs) and filter
      `requestHost_like: "%peonomics.com"`. Baseline week Oct 31 – Nov 6, 2026: 45 pageviews, roughly 10–15 from real
      outside visitors, 0 from Google. Re-check 2–3 weeks after Search Console is live.
- [ ] **Zapier Zap for the LinkedIn page** (`docs/OWNER_SETUP.md` §7): RSS `https://peonomics.com/api/feed` →
      LinkedIn *Create Company Update* on the PEOnomics page. First post goes live Oct 30, 2026 9:00 ET. Don't run
      Zapier's action test early (it publishes).
- [ ] **Real inbox test** to the owner's own business mailbox once all four secrets exist: PDF + XLSX
      arrive, Excel recalculates, double-click sends once, sheet shows requested/accepted rows.

### P1 — reports, data integrity, positioning
- [ ] **DMV index refresh schedule:** Jan 1 (SS base, SUI rates, VA wage, MD FAMLI live) and Jul 1 (DC + MD county
      minimum wages). Update `data/dmv-index-2026.json` / `data/src/`, re-derive the page's static figures,
      `tests/test_dmv_index.py` lists every figure that moved. Check VA's 0.20%/0.03% add-ons against a VEC page.
- [ ] **Delivery webhooks** (Resend `email.delivered/bounced`) → log true delivery status, not just acceptance.
- [ ] **Privacy deletion/suppression handling** — the notice is final (2026-11-09); requests arrive via
      /contact with "privacy request" in the subject. Build the handling behind it.
- [ ] **30-day survey invite** — separate, disclosed permission; CAN-SPAM identification, postal
      address, working unsubscribe. Owner enables; don't automate before compliance is settled.
- [ ] **SUTA surcharge pass for the other 43 states** — DOL base rates exclude surcharges (e.g. MA workforce
      training, NJ workforce/SDI-adjacent, PA, IL, etc.). Add each to `data/src/state-ui-verified-2026.json` from
      the agency page; rebuild. Also find VA's 2026 add-ons (VEC) and the 7 industry-average states' tables.
- [ ] **CA FUTA credit reduction:** replace the 1.5% estimate with DOL's figure after Nov 10, 2026 (and any
      other state DOL names).
- [ ] **WC industry multipliers** are unsourced: replace with NCCI/state bureau class-rate relativities per
      state, or a published loss-cost source; until then WC stays "Estimate".
- [ ] **Family coverage mix:** model single vs. family enrollment (MEPS-IC has single/family premium and
      enrollment) instead of single cost for every enrollee.
- [ ] **Annual refresh:** QCEW 2026 annual (~Sept 2027), MEPS-IC 2026 (~mid-2027), DOL Significant Provisions
      (Jan/Jul), Oregon 2026 study (~2027). Re-run extractors in `tools/data2026/`, bump version.
- [ ] **Reconcile positioning across pages.** `methodology.html` is a *ranking* methodology with a
      referral-fee disclosure (XcelHR); the homepage promises no PEO hand-off from the lab. Both
      can be true, but the site needs one coherent story. Owner-only factual claims.

- [ ] **Auto-post upkeep:** (a) after DOL's Nov 10 determination, update CA FUTA in `data/src/`, mark it `high`,
      set a date on release `futa-credit-reduction-2026-final`, rebuild posts. (b) Add countdowns as figures get
      published: Jul 1, 2027 DC + MD county wage floors (once announced), 2028 SS wage base (SSA, Oct 2027), 2027
      SUI rates. (c) Add a release for each dataset refresh (rates-2027, QCEW 2026, MEPS-IC 2026). (d) Weekly
      audit at `/api/feed?audit=1`. Corrections must be rebuilt before the affected go-live day.
- [ ] **2 CFR 200 final rule (dormant release `uniform-guidance-final`):** OMB's rewrite (proposed 2026-05-29, FR 2026-10817)
      is barred from finalization through 2026-12-11. When it's published: update `data/posts/regulatory-watch.json`
      (status final, effective date, final FR doc), check the release copy against the final text, set the release date.
- [ ] **NAPEO amplification (manual):** owner sends NAPEO post links; Claude drafts a quote-repost with added context
      (or a plain repost), tags NAPEO, posts on approval. Needs NAPEO's LinkedIn company page URL for the mention.
- [ ] **Fill the 77 open post slots (Mar 9 – Dec 2027)** with owner-directed material; `meta.gaps` lists each week.
- [ ] **Refill the 2027 queue as data lands** (the feed thins to countdowns only from Aug 2027): add a *state SUI
      2027* rotation after the DOL Significant Provisions January 2027 edition and the DMV agency rate pages are
      sourced; extend the state cost note when MEPS-IC 2026 (~mid-2027) and QCEW 2026 (~Sept 2027) are rebuilt
      (bump each rotation's validFrom/validUntil). The audit view lists what's queued.
- [ ] **Earned links (manual, owner):** ask DMV resource pages to list the FAMLI calculator and DMV index — Maryland SBDC,
      DC SBDC (Howard), Virginia SBDC, DC / Montgomery County / Northern Virginia chambers, Restaurant Association
      Metropolitan Washington; data pitches to local business press (one sourced figure, link to the citation block);
      journalist-request services (Qwoted, Featured, Source of Sources). Claude can draft pitches; the owner sends.
- [ ] **FAMLI page upkeep:** Maryland Labor announces each year's rate from Nov 2027 (ceiling 1.2%) and the 2028 headcount
      test switches to a four-quarter average; add the 2028 Social Security base when SSA publishes it (Oct 2027). Update
      `data/dmv-index-2026.json` (or its 2027 successor), re-derive the page, `tests/test_famli.py` lists what moved.
      Confirm the private-plan Declaration of Intent date against a Maryland Labor page (currently Jackson Lewis).
- [ ] **Answer-site distribution (manual only):** Reddit, Quora, forums, Facebook groups — answer specific questions
      and link the relevant page. Never automate it (bans; low-quality signal). Personal LinkedIn profile is out of scope by owner direction.

### P2 — hygiene & polish
- [ ] **Per-page OG images.** `tools/build_og.py` now draws page cards from data (first: `og-famli.png`). Add the DMV
      index, `/compare` and the state pages next; everything else still shares `og-default.png`.
- [ ] **Verify JSON-LD `datePublished`.** New Article/Org blocks use the site's existing
      convention (`2026-01-15`) with `dateModified` = today. Correct if real publish dates are known.
- [ ] **Content-page body styling**: chrome is unified, but article/ranking bodies still carry ~150 inline
      `style=` attributes from v1 (forms on /contact, ranking stat strips). Move to classes in content.css/ranking.css.
- [ ] **Owner decision:** keep or drop the remaining /contact Formspree form; re-add ranking-page contact
      forms only if wanted (they were removed in the unification release).
- [ ] **P3 (from strategy):** provider directory with independently sourced fields only; source-refresh
      pipeline; 3-year Cost Lab sensitivity.
- [ ] **Audit/remove legacy code:** `assets/js/engine.js` (biased savings model),
      `functions/api/lead.js` + `apps-script/lead-capture.gs` (sales-lead path). Unreferenced
      since 2026-10-27; `/api/lead` is still a live endpoint. Owner decides delete vs. keep.
- [ ] **Multi-state / wage-distribution modeling** (FICA above SS base, SUTA per state) — P2+.
- [ ] **Comparator v2:** multi-year fee escalators, per-quote SUTA base, link a quote into the Cost Lab.
- [ ] **Quote parsing — measure, then tune:** read `quote_parsed` outcomes (complete / partial / none_found / no_text by
      file kind). Add real (redacted) proposal layouts to `tests/fixtures/` before changing any rule.
- [ ] **Scanned quotes (OCR):** image-only PDFs and photos are refused today. In-browser OCR (tesseract.js, several MB,
      slow on phones) is possible; only worth it if `no_text` outcomes are common.
- [ ] **Owner decision — LLM-assisted extraction:** would read messy proposals better, but file text would leave the
      browser (breaks the stated promise; needs a privacy update). Not built; deterministic parser only.
- [ ] Decide keep/remove `CNAME` (GitHub Pages fossil; harmless on Cloudflare).
- [ ] Delete stray `/og-default.png` at repo root (leftover from the upload; unreferenced, harmless).

---

## 🗑️ Dropped / obsolete — DO NOT rebuild

- **Standalone Cloudflare Worker for enrichment** — superseded by `functions/api/enrich.js`.
- **Broker-group lead sharing** + third-party-disclosure complexity — deferred by owner. Site
  fulfills leads as PEOnomics directly; don't reintroduce broker routing without an owner decision.
- **R2 / object storage** — no usage in application code; the $0 enrichment needs no storage.
  Vestigial → confirm and **decommission the R2 access/secret keys**.
- **Apollo — all of it.** Homepage tracker removed 2026-10-27; `APOLLO_API_KEY` referenced in
  zero code files. Owner direction: no Apollo. Decommission the key; never re-add the tracker.
- **The old email-gated quote funnel** ("Send me the full analysis / drafted PEO quote") —
  replaced by the open Cost Lab. Don't rebuild a lead gate or route lab users into a pipeline.
- **Default PEO savings factors** in the calculator — removed by owner direction. Don't re-add.
- **GitHub Pages hosting** — replaced by Cloudflare Pages. The `CNAME` file is the last fossil.

---

## 🧑‍⚖️ Needs a human decision (only the owner can resolve)

- **Scope/budget of the rate-data verification pass** (federal = an afternoon; the 51-state SUI/WC
  grind is the real cost — full pass now vs. ship preliminary + verify incrementally).
- **Methodology / disclosure wording** — reconcile the public methodology + any "#1 ranking"
  language with the current PEOnomics-direct fulfillment model **and** the Cost Lab's
  "no PEO hand-off" promise. Owner-only factual claim.
  - 2026-10-28 (resolved by owner): no paid or referral relationship with any PEO and no employment
    connection. Disclosure removed site-wide; methodology states no paid relationship. Rankings left as
    scored. Possible removal of the ranking pages is for the next site-wide strategy update.
- **Legacy lead endpoint** — delete `/api/lead` + lead sheet webhook, or keep for another use?
- **Security:** rotate any credentials pasted in past chats (Cloudflare token, R2 keys, GitHub
  PATs). Treat all as burned.
