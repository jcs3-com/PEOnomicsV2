# AI_GUIDE.md — Operating manual for PEOnomics

**Audience:** any AI agent (Claude or otherwise) asked to create, edit, debug, or audit this
site in any chat. Read this file *first*, before touching anything.
**Last updated:** 2026-10-28 (auto-post feed for the LinkedIn page; prior: 2026 sourced dataset, extensionless URLs, shared chrome)

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
   to `main` deploys to production — run every suite in `tests/` first, push a feature branch,
   check its `*.peonomicsv2.pages.dev` preview, then fast-forward `main`. If either
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
  `POST /api/enrich` (business-email lookup — validates, enriches by domain, logs, fails closed),
  `POST /api/report-request` (Turnstile → server recompute → log → Resend PDF+XLSX),
  `GET /api/report-status` (`{available, siteKey}` — public Turnstile key only), `GET /api/health` (booleans:
  which secrets production sees, never values), `POST /api/event` (allowlisted, PII-free product events →
  Analytics Engine binding `EVENTS` if present), `GET /api/feed` (auto-post RSS for the LinkedIn page; `?audit=1` = weekly
  audit text) and `/api/lead` (legacy, unreferenced).
  Shared code lives in `functions/lib/` (no route handlers there). No standalone Workers.
- **Secrets** (`ANTHROPIC_API_KEY`, `USAGE_WEBHOOK_URL`, `RESEND_API_KEY`, `REPORT_FROM`,
  `TURNSTILE_SECRET`, legacy `LEAD_WEBHOOK_URL`) live as **Cloudflare Pages secrets**. An agent must not
  type, paste or read them into any field or file — setup is owner-only (`docs/COST_LAB.md`). Apollo is not used anywhere — never re-add it. They are injected into `env` at runtime. They NEVER appear in
  the repo or in any chat. If a chat transcript contains a real key, that key is burned — tell
  the user to rotate it; do not use it.
- **Analytics:** page views = Cloudflare Web Analytics (injected by Pages, cookieless). Product events =
  `window.peoTrack` → `/api/event`, allowlisted names + coarse props (state, industry key, headcount band,
  outcome code, path). **Never send an email, company, typed value or identifier to analytics.**
- **Event log (not a lead list):** lookups and report events → Google Sheet via `USAGE_WEBHOOK_URL`
  (`apps-script/usage-log-v2.gs`: "Usage Log" + deduped "Contacts"). No CRM, nothing to PEOs, no survey sent.
- **Model data = `data/rates-2026.json`, GENERATED** by `tools/build_rates_2026.py` from `data/src/*.json`
  (each source file records its URL and review date). Never hand-edit it — edit/add a source file and
  rebuild; `tests/test_data.py` enforces this. Every figure keeps its own edition year (SUTA 2026; BLS
  wages 2025; MEPS-IC health 2025; Oregon WC 2024); never relabel an older edition as 2026. Where no
  2026 figure exists the field says so (`sui_year: 2025`, confidence `low`). `data/rates-2025.json` is
  the historical prior edition. Confidence flags display as "high/medium confidence" or "estimate" —
  never "verified".
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
assets/css/cost-lab.css         Cost Lab classes (tokens only). Linked after site.css on index + tool pages.
assets/css/compare.css          Comparator / data library / privacy classes (tokens only).
compare.html data-library.html  Quote Comparator; Data Library. privacy.html = noindex DRAFT notice.
assets/js/report-client.js      Report button: /api/report-status + Turnstile + POST /api/report-request.
assets/js/quote-compare.js      Comparator (pure evaluateQuotes on window.PEOCompare).
assets/js/data-library.js       Renders rates-2026.json (state tables, sources) and benchmarks-2026.json.
data/benchmarks-2026.json       Sourced 2026 federal/national figures (not used by the Cost Lab model).
functions/lib/                  validate.js, report-model.js, simple-pdf.js, simple-xlsx.js (shared code).
functions/api/report-*.js       report-request (POST) and report-status (GET).
tests/                          node + Playwright suites; run before every push (see docs/COST_LAB.md).
assets/js/cost-lab.js           Cost Lab model + UI. Pure compute() exposed as window.PEOLab.
assets/js/engine.js             LEGACY, unreferenced (biased savings model). Do not re-wire.
assets/js/site.js               Site-wide JS.
assets/js/track.js              window.peoTrack(): PII-free events → /api/event. Honors GPC/DNT. On every page.
functions/api/event.js health.js  Event sink (allowlist) and owner config check (booleans).
tools/unify_pages.py            Applies shared nav/footer/disclosure + Cost Lab CTA to hand-authored pages.
docs/OWNER_SETUP.md             Owner-only activation checklist (secrets, Resend, Turnstile, WAF, Search Console).
data/rates-2025.json            HISTORICAL prior edition (not used by the model). data/rates-2026.json = model data (generated).
functions/api/enrich.js         POST /api/enrich — lookup: validate, enrich, log, fail closed.
functions/api/lead.js           LEGACY /api/lead (old quote page lead → sheet). Unreferenced.
apps-script/usage-log-v2.gs     Apps Script for the event-log sheet (USAGE_WEBHOOK_URL).
apps-script/lead-capture.gs     LEGACY Apps Script for the old lead sheet.
docs/COST_LAB.md                Cost Lab implementation notes: model, endpoint contract, tests.
tools/build_states.py           Generator for the 51 state pages + sitemap from rates-2026.json.
tools/build_rates_2026.py       Builds data/rates-2026.json from data/src/*.json (sourced inputs).
tools/site_chrome.py            Canonical nav + footer markup.  tools/normalize_urls.py  extensionless URLs.
data/src/                       Sourced inputs (DOL, state agencies, BLS QCEW, AHRQ MEPS-IC, Oregon DCBS).
data/posts/series.json          Auto-post templates (hand-authored): countdowns + releases, figures by ref only.
tools/build_posts.py            Builds data/post-schedule.json + assets/images/posts/*.png (GENERATED; needs Pillow + npm for fonts).
functions/api/feed.js           GET /api/feed — RSS of posts whose go-live time has passed (Zapier → LinkedIn page).
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
7. Internal links use root-relative, **extensionless** paths (`/compare`, `/states/md`, `/#cost-lab`).
   Cloudflare Pages 308-redirects `/x.html` → `/x`, so canonical, `og:url`, JSON-LD and sitemap URLs
   must be extensionless too (`https://peonomics.com/compare`). `python3 tools/normalize_urls.py`
   fixes any page that regresses; `build_states.py` writes the sitemap that way.
8. A `robots.txt` and a `sitemap.xml` must exist at the root and stay in sync with the page set
   (generate the sitemap from the same source as the state pages).
9. Nav and footer come from `tools/site_chrome.py` (generator + `tools/unify_pages.py`). Don't hand-roll a variant.

> Current compliance gaps are tracked in `ROADMAP.md`. Do not assume a page is compliant — check it.

---

## 5. Content & data rules

- **State pages are generated.** Do **not** hand-edit `states/<xx>.html`. To change them, edit
  `data/src/*` (then `tools/build_rates_2026.py`) and/or `tools/build_states.py`, re-run the generator
  and commit the regenerated output.
- The rate dataset is **versioned with per-figure source, year and confidence**. Low-confidence figures
  render as `estimate`. Workers' comp is always an estimate (sourced state index × unsourced industry multiplier).
- Any user-facing statistic must be **sourced or flagged**. No invented numbers, ever.
- **Auto-posts (LinkedIn page).** Never type a number into `data/posts/series.json`: every figure is a ref into a
  data file (or `mul`/`sub`/`add` of refs). Low-confidence figures need `"estimate": true` and the word "estimate"
  in the post. Rebuild with `python3 tools/build_posts.py`; `tests/test_posts.py` re-derives every numeral. Countdowns run only on exact
  milestones (60d, 30d, 1m, 1w); anything else is a dated post. `cadence` (no-post days, quiet periods) caps each
  week and fills it from `rotations`; a rotation's `validUntil` must not pass its data edition's replacement, so the
  feed goes quiet rather than posting stale figures. A post
  goes live when its time arrives — no deploy needed — so a data correction must be rebuilt *before* its go-live
  day. Posts target the **PEOnomics LinkedIn page only**, never the owner's personal profile. Q&A sites, forums and
  groups are **manual only**: never automate posting there.

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
