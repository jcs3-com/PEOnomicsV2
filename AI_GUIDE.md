# AI_GUIDE.md — Operating manual for PEOnomics

**Audience:** any AI agent (Claude or otherwise) asked to create, edit, debug, or audit this
site in any chat. Read this file *first*, before touching anything.
**Last updated:** 2026-10-27 (Cost Lab P0; push rule reconciled)

---

## 0. Prime directives (non-negotiable)

1. **The repo is the single source of truth.** Never reconstruct the site, its file list, or
   its render method from memory or from another chat's summary. Clone and read the real files
   first:
   ```
   git clone --depth 1 https://github.com/jcs3-com/PEOnomicsV2.git
   ```
   The repo is **public** — no token, no credential needed to read it.
2. **Never accept or use a pasted credential** (GitHub token, Cloudflare token, API key,
   webhook URL — anything). Do not ask the user for one. This is a hard rule.
   **Pushing:** default is **Path A** (§6). Push only when BOTH are true: (a) the owner explicitly
   authorizes pushing/deploying in the current request, and (b) the session has GitHub write
   access granted through the platform's own GitHub integration (not a pasted token). Pushing
   to `main` deploys to production — run the tests in `docs/COST_LAB.md` first. If either
   condition is missing, use Path A.
3. **Match, don't reinvent.** `assets/css/tokens.css` is law (§3). `index.html` (with
   `site.css` + `cost-lab.css`) is the reference implementation of the visual identity. New work must look like it.
4. **Record work in `ROADMAP.md`** in the same change set (§7). The roadmap — not chat history,
   not artifacts — is the canonical backlog.

---

## 1. What this site is

- **Pure static HTML.** Hand-authored pages. **No build step. No `package.json`. No framework.**
  Plain HTML + CSS + vanilla JS. Editing a page = editing its `.html` file directly.
- **Host:** Cloudflare Pages, project `peonomicsv2`, custom domain **peonomics.com**.
  **Auto-deploys on every push to `main`.** There is no separate deploy command.
- **Serverless:** Cloudflare **Pages Functions** in `functions/api/`. A file at
  `functions/api/<name>.js` becomes a live endpoint at `/api/<name>`. Current endpoints:
  `POST /api/enrich` (Cost Lab business-email lookup — validates, enriches by domain, logs to
  the usage sheet, fails closed) and `/api/lead` (legacy, unreferenced). No standalone Workers.
- **Secrets** (`ANTHROPIC_API_KEY`, `USAGE_WEBHOOK_URL`, legacy `LEAD_WEBHOOK_URL`) live as
  **Cloudflare Pages environment variables**. Apollo is not used anywhere — never re-add it. They are injected into `env` at runtime. They NEVER appear in
  the repo or in any chat. If a chat transcript contains a real key, that key is burned — tell
  the user to rotate it; do not use it.
- **Usage log (not a lead list):** `/api/enrich` → Google Sheet via `USAGE_WEBHOOK_URL`. Setup
  in the header of `apps-script/usage-log.gs`. Nothing creates CRM records or contacts a PEO.
- **Enrichment:** Claude Haiku + web search on the **domain only**, hardened scraper fallback
  with SSRF controls. Details: `docs/COST_LAB.md`.
- **The homepage Cost Lab assumes no PEO savings.** Both scenarios carry identical statutory and
  insurance costs unless the visitor enters PEO-quoted rates. Do not reintroduce default
  discounts (the legacy `engine.js` had −12% health, −10% WC, −80% admin — that is why it's retired).
- **Positioning:** agnostic **PEO cost intelligence under the PEOnomics brand** — *not* XcelHR on
  the public site. The credibility promise is "real numbers." Every figure shown to a user must
  be sourced or visibly rendered as an estimate. **Never invent statistics.**

---

## 2. File map

```
index.html                      Homepage + Cost Lab. REFERENCE IMPLEMENTATION of the identity.
quote.html                      Redirect stub → /#cost-lab (noindex, not in sitemap).
about.html contact.html         Org / contact pages.
insights.html methodology.html  Editorial / methodology content.
hidden-costs.html               Content landing.
peo-pricing-explained.html      Content (long-form).
peo-vs-payroll.html             Content (comparison).
best-peo-*.html                 Ranking pages (construction, govcon, restaurants, small-business).
states/<xx>.html                51 state pages — GENERATED, do not hand-edit (see §5).
states/index.html               State directory page.
assets/css/tokens.css           Design tokens (variables). LAW. Always linked first.
assets/css/site.css             Base/components for landing/app/state pages.
assets/css/content.css          Base for article pages.
assets/css/ranking.css          Styles for best-peo ranking pages.
assets/css/cost-lab.css         Cost Lab classes (tokens only). Linked after site.css on index.
assets/js/cost-lab.js           Cost Lab model + UI. Pure compute() exposed as window.PEOLab.
assets/js/engine.js             LEGACY, unreferenced (biased savings model). Do not re-wire.
assets/js/site.js               Site-wide JS.
data/rates-2025.json            Versioned payroll-tax rate dataset w/ per-figure confidence flags.
functions/api/enrich.js         POST /api/enrich — lookup: validate, enrich, log, fail closed.
functions/api/lead.js           LEGACY /api/lead (old quote page lead → sheet). Unreferenced.
apps-script/usage-log.gs        Apps Script for the Cost Lab usage-log sheet (USAGE_WEBHOOK_URL).
apps-script/lead-capture.gs     LEGACY Apps Script for the old lead sheet.
docs/COST_LAB.md                Cost Lab implementation notes: model, endpoint contract, tests.
tools/build_states.py           Generator for the 51 state pages from rates-2025.json.
CNAME                           Fossil from the GitHub Pages era. Harmless on Cloudflare.
favicon.svg  README.md  .gitignore
```

---

## 3. Design system — LAW

Identity: **"financial print."** Editorial, engraved, precise. The point is to NOT look like an
AI-generated template.

- **Stylesheet order is LAW** (getting this wrong shipped a real bug — broken nav/footer on 10
  pages). `site.css` carries the shared chrome — `.nav`, `.footer`, `.btn*`, `.eyebrow`, `.hero` —
  so **every page links it**. Link in this exact order in `<head>`:
  1. `tokens.css` — design variables, always first.
  2. `site.css` — base + chrome, on EVERY page, no exceptions.
  3. the role sheet, if the page needs one: `content.css` for article pages (about, contact,
     insights, methodology, peo-pricing-explained, peo-vs-payroll), or `ranking.css` for the
     best-peo-* pages.
  `content.css` and `ranking.css` are *additive*: they define only their own content classes
  (`.prose`, `.model-card`, `.compare-grid`, ranking tables) and share **zero** selectors with
  `site.css`. A page that links a role sheet but NOT `site.css` renders with an unstyled nav and
  footer. When building a new page, copy the `<head>` from an **existing page of the same type**.
- **Never hard-code colors, fonts, border-radius, or spacing.** Use the CSS variables:
  `var(--accent)` (#1E6B52 engraved-currency green), `var(--text)`, `var(--bg)`, `var(--muted)`,
  `var(--warm)` (reserved for *ranges / uncertainty*), `var(--positive)` / `var(--negative)`, etc.
- **Type:** `--f-display` = Newsreader (serif), `--f-body` = Hanken Grotesk, `--f-mono` = IBM Plex
  Mono. All numerals/figures use `.num`/`.mono` (tabular numerals).
- **Geometry:** near-zero radius (`--r-*` = 2–4px) is intentional. **Do not round corners.**
- **Reuse component classes** from `site.css` (`.nav`, `.hero`, `.btn-go`, `.eyebrow`, `.quote-box`,
  `.hero-stats`, …) — match the markup in `index.html` rather than inventing new components.
- **Banned ("AI default look"):** Inter/Roboto body font, violet/indigo gradients, uniform large
  border-radius, emoji bullets, drop-shadow-heavy cards. None of these belong here.

---

## 4. SEO ship-checklist — every shippable HTML page MUST have

1. `<title>` — keyword-front-loaded, ~50–60 chars.
2. Exactly **one** `<h1>`.
3. `<meta name="description">` — ~150–160 chars.
4. `<link rel="canonical" href="https://peonomics.com/…">` — absolute URL.
5. Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:image`.
6. JSON-LD (`application/ld+json`) appropriate to the page:
   - homepage → `Organization` + `WebSite`
   - article/content → `Article` (and `FAQPage` where there's a Q/A block)
   - ranking pages → `ItemList` / `Article`
   - state pages → `Article` or `FAQPage` with the state in scope
7. Internal links use root-relative absolute paths (`/#cost-lab`, `/states/`).
8. A `robots.txt` and a `sitemap.xml` must exist at the root and stay in sync with the page set
   (generate the sitemap from the same source as the state pages).

> Current compliance gaps are tracked in `ROADMAP.md`. Do not assume a page is compliant — check it.

---

## 5. Content & data rules

- **State pages are generated.** Do **not** hand-edit `states/<xx>.html`. To change them, edit
  `data/rates-2025.json` and/or `tools/build_states.py`, then re-run the generator and commit the
  regenerated output.
- The rate dataset is **versioned with per-figure confidence flags**. Low-confidence figures must
  render as `estimate` on the page. Treat the current dataset as preliminary until a primary-source
  pass is done (see roadmap).
- Any user-facing statistic must be **sourced or flagged**. No invented numbers, ever.

---

## 6. Path A — how you return changes (default; see §0.2 for when pushing is allowed)

You make changes in your sandbox against the cloned repo, then hand them back. The user commits.
Cloudflare auto-deploys on push to `main`.

**Deliver, in order of priority:**
1. The **complete final contents** of every file you created or changed (not a diff). The user
   commits these via the GitHub web UI or the GitHub mobile app (Add file → Create/Edit → paste →
   Commit to `main`). This is the **universal** path and the only one that works from a phone.
2. For multi-file changes, **also** produce a git bundle so a user with a local clone can apply
   everything at once:
   ```
   git add -A && git commit -m "<message>"
   git bundle create peonomics-<short-desc>.bundle main
   ```
   Apply on the user's machine: `git pull --ff-only /path/to/peonomics-<short-desc>.bundle main && git push origin main`.
   Never assume a local clone exists — (1) is the default.
3. State the **exact** files to create vs. replace, and propose the commit message.

**Never:** accept/use a pasted credential; push without §0.2's two conditions; reconstruct files from memory;
weaken the disclosure/positioning language without the owner's explicit say-so (only the owner can
make factual claims about the business).

---

## 7. Where work is recorded

`ROADMAP.md` is the only backlog. When you finish an item or add one, edit `ROADMAP.md` in the same
change set and move/annotate the entry. This is what keeps parallel chats from drifting: the next
chat reads the repo (this guide + the roadmap), not a transcript.
