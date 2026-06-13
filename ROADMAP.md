# ROADMAP.md — PEOnomics canonical backlog

This file is the **only** source of truth for what is done, open, dropped, or pending a decision.
Not chat history. Not artifacts. When you finish or add work, update this file in the same commit.

**Last updated:** 2026-06-13 (initial grounded audit of repo @ `0ba54d9`)

---

## ✅ Done — shipped & live

- Quote builder (`quote.html` + `assets/js/engine.js`) — vanilla JS, working.
- Site structure & navigation; "financial print" design system (`assets/css/tokens.css`).
- 51 state pages generated from `data/rates-2025.json` via `tools/build_states.py`
  (+ `states/index.html`). State pages already carry **canonical** tags.
- Core content pages: about, contact, insights, methodology, hidden-costs,
  peo-pricing-explained, peo-vs-payroll.
- Ranking pages: best-peo-{construction, govcon, restaurants, small-business} — these already
  carry **OG + JSON-LD**.
- Pages Function code for `/api/enrich` and `/api/lead`; Apps Script lead-capture in repo.
- Cloudflare Pages ↔ GitHub `main` auto-deploy pipeline.
- **Operating model formalized**: `AI_GUIDE.md` (this repo) + Path A handoff. ← *this commit*

---

## 🔲 Open — prioritized

### P0 — SEO floor (cheap, high-leverage, quantified gaps)
- [ ] **Canonical tags** missing on **all 13 non-state pages**: index, quote, about, contact,
      insights, methodology, hidden-costs, peo-pricing-explained, peo-vs-payroll, and the 4
      best-peo pages. Add absolute `rel="canonical"` to each.
- [ ] **Open Graph** missing on **index.html, quote.html, hidden-costs.html** (homepage included —
      the most-shared surface). Add full OG block.
- [ ] **JSON-LD** missing on **index, quote, hidden-costs, about, contact, insights, methodology**.
      Add schema per §4 of AI_GUIDE (Organization+WebSite on home, Article/FAQ on content).
- [ ] **`robots.txt`** absent at root — create (declare sitemap).
- [ ] **`sitemap.xml`** absent — generate, ideally from `build_states.py` so it stays in sync with
      the full page set (states + content + landing).

### P1 — function & data integrity
- [ ] **Verify `/api/enrich` is actually live in production.** A prior chat was titled "Haiku API
      enrichment not deployed to production" — code-in-repo ≠ working-endpoint. Confirm
      `ANTHROPIC_API_KEY` + `APOLLO_API_KEY` are set on the Pages project and smoke-test the
      endpoint end-to-end (email in → enrichment out).
- [ ] **Rate-data primary-source pass.** `data/rates-2025.json` is `v2025.x-preliminary`. Federal
      lines (FICA/FUTA) are statutory and solid; the **51-jurisdiction SUI + workers'-comp figures
      need verification** against primary sources (state agencies, DOL credit-reduction list,
      Oregon DCBS WC study). Each correction is a one-line JSON edit + one generator run. *(Scope/
      budget is a human decision — see below.)*
- [ ] **Source or flag the hero stats** on index.html: "$28,700 avg benefits cost/employee",
      "14% of mid-size employers", "4.5M employed through a PEO". Unsourced figures on a
      "real numbers" site are a credibility leak. (NAPEO is the canonical source for PEO
      employment/ROI figures; ~$1,395/employee/yr fee, ~27% ROI are the common reference points.)

### P2 — hygiene & verification
- [ ] **Verify `content.css` layering.** Article pages link `tokens.css` + `content.css` but **not**
      `site.css` — confirm nav/footer/layout render correctly (either content.css is a complete
      self-contained base, or there's a latent gap).
- [ ] Decide keep/remove **`CNAME`** (GitHub Pages fossil; harmless on Cloudflare Pages).
- [ ] Add `og:image` asset(s) if none exist (needed for the OG work above).

---

## 🗑️ Dropped / obsolete — DO NOT rebuild

- **Standalone Cloudflare Worker for enrichment** — superseded by the Pages Function at
  `functions/api/enrich.js`. Don't recreate a separate Worker.

---

## 🧑‍⚖️ Needs a human decision (only the owner can resolve)

- **Scope/budget of the rate-data verification pass.** Federal = an afternoon. The 51-state
  SUI/WC grind is the real cost. Decide: full pass now, or ship preliminary-with-confidence-flags
  and verify incrementally.
- **Methodology / disclosure wording.** A prior chat noted the methodology page may still describe
  the *old* fulfillment model (XcelHR-routed) while the business now fulfills as PEOnomics directly.
  Reconcile the public methodology + any "#1 ranking" disclosure language to match reality. This is
  a factual claim about the business — owner-only.
- **Security:** rotate any credentials pasted in past chats (Cloudflare token, R2 keys, GitHub
  PATs). Treat all as burned.
