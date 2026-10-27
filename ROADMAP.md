# ROADMAP.md — PEOnomics canonical backlog

This file is the **only** source of truth for what is done, open, dropped, or pending a decision.
Not chat history. Not artifacts. When you finish or add work, update this file in the same commit.

**Last updated:** 2026-10-27 (activation release: health check, shared rate limiter, scenario logging, Turnstile key via env; data/unification/analytics releases follow)

---

## ✅ Done — shipped & live

- Quote builder (`quote.html` + `assets/js/engine.js`) — vanilla JS, working.
- Site structure & navigation; "financial print" design system (`assets/css/tokens.css`).
- 51 state pages generated from `data/rates-2025.json` via `tools/build_states.py` (+ `states/index.html`).
- Core content pages + ranking pages (best-peo-*).
- Pages Function code for `/api/enrich` and `/api/lead`; Apps Script lead-capture in repo.
- Cloudflare Pages ↔ GitHub `main` auto-deploy pipeline.
- Operating model: `AI_GUIDE.md` + Path A handoff.
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
    tested). Stored only if the owner binds Analytics Engine `EVENTS`; otherwise discarded.
  - Sitemap (66 URLs) and every canonical/og:url verified extensionless and 200 in production.

## 🔲 Open — prioritized

### P0.1 — owner-only setup (credentials; Claude must not handle them) — step-by-step in `docs/OWNER_SETUP.md`
- [ ] **Usage/event log:** paste `apps-script/usage-log-v2.gs` into the sheet "PEOnomics — Cost Lab
      Usage Log" (Drive › 34.02 Website › PEOnomics 2.0 — Site Build), deploy as web app, add the URL
      as Pages secret `USAGE_WEBHOOK_URL`. Unlocks business-email prefill AND is required for reports.
- [ ] **Resend:** account + verify sending domain `peonomics.com` (DNS records in Cloudflare), API key →
      Pages secret `RESEND_API_KEY`; sender → Pages secret `REPORT_FROM` (e.g. `PEOnomics <reports@peonomics.com>`).
- [ ] **Turnstile:** widget for peonomics.com (+ www); **public** site key → Pages variable `TURNSTILE_SITE_KEY`;
      secret → Pages secret `TURNSTILE_SECRET`. Check `/api/health`.
- [ ] **WAF rate-limit rule** on `/api/enrich` and `/api/report-request` (in-code limiter is per-isolate).
- [ ] **Analytics Engine binding** `EVENTS` (dataset `peonomics_events`) so product events are stored; then a
      saved SQL query for weekly counts. **Search Console** domain property via DNS TXT + submit sitemap.
      (No Search Console connector exists for Claude; owner step in `docs/OWNER_SETUP.md` §6.)
- [ ] **Real inbox test** to the owner's own business mailbox once all four secrets exist: PDF + XLSX
      arrive, Excel recalculates, double-click sends once, sheet shows requested/accepted rows.

### P1 — reports, data integrity, positioning
- [ ] **Delivery webhooks** (Resend `email.delivered/bounced`) → log true delivery status, not just acceptance.
- [ ] **Finalize privacy notice** (owner): confirm the proposed 12-month retention and the request
      channel actually work, then drop the Draft label and `noindex`. Build deletion/suppression handling.
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

### P2 — hygiene & polish
- [ ] **Per-page OG images.** All pages currently share `og-default.png`. Page-specific cards
      (e.g. "Best PEOs for Construction 2026") convert better — generate per template later.
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
- **Legacy lead endpoint** — delete `/api/lead` + lead sheet webhook, or keep for another use?
- **Security:** rotate any credentials pasted in past chats (Cloudflare token, R2 keys, GitHub
  PATs). Treat all as burned.
