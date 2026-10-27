# ROADMAP.md — PEOnomics canonical backlog

This file is the **only** source of truth for what is done, open, dropped, or pending a decision.
Not chat history. Not artifacts. When you finish or add work, update this file in the same commit.

**Last updated:** 2026-10-27 (Cost Lab P0 shipped to production)

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
  - Usage log Apps Script (`apps-script/usage-log.gs`): email, domain, company, state, industry,
    approx. headcount, summary, source, page, UA, timestamp. Not a CRM; nothing to PEOs.
  - **Apollo tracker removed** from the homepage.
  - "Email this to me" CTA present and **disabled** with an honest note (P1). Print view works.
  - `quote.html` → redirect stub to `/#cost-lab` (noindex; generator now skips noindex pages
    in `sitemap.xml`).
  - Unsourced hero stats (4.5M / $28,700 / 14%) removed from the homepage with the old hero.
  - Shared mobile nav fix in `site.css` (hidden links' flex gaps no longer squeeze the CTA).
  - **Verified 2026-10-27:** `ANTHROPIC_API_KEY` is set in production — live `/api/enrich`
    returned `source:"research"` before this release (closes the old P1 "verify enrich live").

---

## 🔲 Open — prioritized

### P0.1 — blockers to finish what shipped (owner action, ~10 min)
- [ ] **Connect the usage log.** Until `USAGE_WEBHOOK_URL` exists, business-email lookup returns
      503 and the UI says "lookup is offline" (calculator unaffected). Steps: header of
      `apps-script/usage-log.gs`. The sheet "PEOnomics — Cost Lab Usage Log" was created in Drive
      › 34.02 Website › PEOnomics 2.0 — Site Build. Add as a **Secret**, Production env, redeploy.
- [ ] **Cloudflare WAF rate-limit rule** on `/api/enrich` (e.g. 10 req / 10 min / IP). The in-code
      limiter is per-isolate and best-effort only; each lookup can cost ~1–2¢ of Haiku.

### P1 — reports, data integrity, positioning
- [ ] **Email this to me** — real PDF from the visitor's final edited inputs: `POST /api/report-request`
      with a server-validated immutable snapshot, transactional email provider, idempotency key,
      real delivery status. Keep the button disabled until tested end-to-end. No fake success.
- [ ] **Privacy policy + retention schedule** before report email launches (homepage promises it).
      Name actual processors (Cloudflare, Google, Anthropic, email provider). Deletion/suppression.
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
- [ ] **Re-point 148 internal `/quote.html` links** (content pages + `tools/build_states.py` CTA
      "Run a {ST} quote") to `/#cost-lab`, then regenerate state pages. The stub covers it now.
- [ ] **Persistent contact identity / dedup** beyond the raw event log (contacts vs. events).

### P2 — hygiene & polish
- [ ] **Per-page OG images.** All pages currently share `og-default.png`. Page-specific cards
      (e.g. "Best PEOs for Construction 2026") convert better — generate per template later.
- [ ] **Verify JSON-LD `datePublished`.** New Article/Org blocks use the site's existing
      convention (`2026-01-15`) with `dateModified` = today. Correct if real publish dates are known.
- [ ] **State pages have no `<h1>`** (all 51, generated) — fix in `tools/build_states.py`.
- [ ] **Content/ranking pages use v1 nav markup**; at 360 px their CTA wraps to ~100 px tall.
      Port them to the `site.css` `.nav` markup.
- [ ] **Audit/remove legacy code:** `assets/js/engine.js` (biased savings model),
      `functions/api/lead.js` + `apps-script/lead-capture.gs` (sales-lead path). Unreferenced
      since 2026-10-27; `/api/lead` is still a live endpoint. Owner decides delete vs. keep.
- [ ] **Multi-state / wage-distribution modeling** (FICA above SS base, SUTA per state) — P2+.
- [ ] **Quote Comparator** (normalize user-entered PEO quotes) — P2 per product strategy.
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
