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
- [ ] **Real inbox test** to the owner's own business mailbox once all four secrets exist: PDF + XLSX
      arrive, Excel recalculates, double-click sends once, sheet shows requested/accepted rows.

### P1 — reports, data integrity, positioning
- [ ] **Delivery webhooks** (Resend `email.delivered/bounced`) → log true delivery status, not just acceptance.
- [ ] **Finalize privacy notice** (owner): confirm the proposed 12-month retention and the request
      channel actually work, then drop the Draft label and `noindex`. Build deletion/suppression handling.
- [ ] **30-day survey invite** — separate, disclosed permission; CAN-SPAM identification, postal
      address, working unsubscribe. Owner enables; don't automate before compliance is settled.
- [ ] **Rate-data primary-source pass** → 2026 dataset with per-figure `value/year/effectiveDate/
      sourceName/sourceUrl/lastReviewed`. Federal first (SSA wage base, FUTA, DOL credit
      reductions), then 51 SUTA bases/new-employer rates (+ surcharges), then WC. Only then drop
      the "historical 2025" warning. Regenerate state pages from the same file.
- [ ] **State × industry wage defaults** from BLS QCEW (NAICS-mapped, year + source shown); fall
      back to the visitor's own number when no verified benchmark exists.
- [ ] **State-level health benchmark** (single vs. family employer share, enrollment mix) from a
      named source/year. KFF national ≠ state.
- [ ] **Reconcile positioning across pages.** `methodology.html` is a *ranking* methodology with a
      referral-fee disclosure (XcelHR); the homepage promises no PEO hand-off from the lab. Both
      can be true, but the site needs one coherent story. Owner-only factual claims.

### P2 — hygiene & polish
- [ ] **Per-page OG images.** All pages currently share `og-default.png`. Page-specific cards
      (e.g. "Best PEOs for Construction 2026") convert better — generate per template later.
- [ ] **Verify JSON-LD `datePublished`.** New Article/Org blocks use the site's existing
      convention (`2026-01-15`) with `dateModified` = today. Correct if real publish dates are known.
- [ ] **Content/ranking pages use v1 nav markup**; at 360 px their CTA wraps to ~100 px tall.
      Port them to the `site.css` `.nav` markup.
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
