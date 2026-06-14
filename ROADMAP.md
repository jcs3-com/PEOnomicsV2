# ROADMAP.md — PEOnomics canonical backlog

This file is the **only** source of truth for what is done, open, dropped, or pending a decision.
Not chat history. Not artifacts. When you finish or add work, update this file in the same commit.

**Last updated:** 2026-06-13 (P0 SEO floor + styling/upload fixes shipped)

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

---

## 🔲 Open — prioritized

### P1 — function & data integrity
- [ ] **Verify `/api/enrich` is actually live in production.** A prior chat was titled "Haiku API
      enrichment not deployed to production." Confirm `ANTHROPIC_API_KEY` is set on the Pages
      project and smoke-test end-to-end (email in → enrichment out). Note: `enrich.js` uses
      Anthropic Haiku + scraper only — **no Apollo**.
- [ ] **Rate-data primary-source pass.** `data/rates-2025.json` is preliminary. Federal lines are
      solid; the 51-jurisdiction SUI + workers'-comp figures need verification (state agencies, DOL
      credit-reduction list, Oregon DCBS WC study). Each fix = one JSON edit + one generator run.
- [ ] **Source or flag the hero stats** on index.html ("$28,700 avg benefits cost/employee",
      "14% of mid-size employers", "4.5M employed through a PEO"). NAPEO is the canonical source.

### P2 — hygiene & polish
- [ ] **Per-page OG images.** All pages currently share `og-default.png`. Page-specific cards
      (e.g. "Best PEOs for Construction 2026") convert better — generate per template later.
- [ ] **Verify JSON-LD `datePublished`.** New Article/Org blocks use the site's existing
      convention (`2026-01-15`) with `dateModified` = today. Correct if real publish dates are known.
- [ ] Decide keep/remove `CNAME` (GitHub Pages fossil; harmless on Cloudflare).
- [ ] Delete stray `/og-default.png` at repo root (leftover from the upload; unreferenced, harmless).

---

## 🗑️ Dropped / obsolete — DO NOT rebuild

- **Standalone Cloudflare Worker for enrichment** — superseded by `functions/api/enrich.js`.
- **Broker-group lead sharing** + third-party-disclosure complexity — deferred by owner. Site
  fulfills leads as PEOnomics directly; don't reintroduce broker routing without an owner decision.
- **R2 / object storage** — no usage in application code; the $0 enrichment needs no storage.
  Vestigial → confirm and **decommission the R2 access/secret keys**.
- **`APOLLO_API_KEY`** — referenced in zero code files; `enrich.js` uses Anthropic Haiku +
  scraper, not Apollo. Vestigial → decommission the key and drop it from the README.
- **GitHub Pages hosting** — replaced by Cloudflare Pages. The `CNAME` file is the last fossil.

---

## 🧑‍⚖️ Needs a human decision (only the owner can resolve)

- **Scope/budget of the rate-data verification pass** (federal = an afternoon; the 51-state SUI/WC
  grind is the real cost — full pass now vs. ship preliminary + verify incrementally).
- **Methodology / disclosure wording** — reconcile the public methodology + any "#1 ranking"
  language with the current PEOnomics-direct fulfillment model. Owner-only factual claim.
- **Security:** rotate any credentials pasted in past chats (Cloudflare token, R2 keys, GitHub
  PATs). Treat all as burned.
