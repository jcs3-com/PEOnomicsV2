# PEOnomics v2

**peonomics.com** — PEO cost intelligence. One business email in, an itemized
employer-cost estimate out: FICA, FUTA, SUI, workers' comp, health, and the PEO
fee itself, standalone vs. PEO, for all 50 states + DC.

Built as a static site + two Cloudflare Pages Functions. No framework, no build
step for the core site, no client-side secrets.

## Architecture

```
index.html              Landing — live sample ledger (MD/CA/TX/FL/NY)
quote.html              Quote engine — enrichment prefill, editable assumptions,
                        itemized ledger, lead capture
states/                 51 generated state rate pages + index (programmatic SEO)
data/rates-2025.json    The dataset. Every figure carries a confidence flag.
assets/js/engine.js     Computation engine (shared by index + quote)
functions/api/enrich.js Cloudflare Pages Function — $0 enrichment: fetches the
                        company homepage server-side, heuristics for name/state/industry
functions/api/lead.js   Cloudflare Pages Function — validates leads, forwards to
                        Google Sheet via Apps Script webhook (env var, not in repo)
tools/build_states.py   Regenerates /states/ from the dataset
apps-script/            The Google Apps Script for the lead sheet (setup inside)
```

Plus the editorial library carried forward from v1: pricing explainer, PEO vs
payroll, vertical buyer guides (construction, restaurants, govcon, small
business), methodology.

## Deploy (Cloudflare Pages, ~5 minutes)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**
   → select `jcs3-com/PEOnomicsV2`.
2. Build settings: **Framework preset: None. Build command: (empty). Output
   directory: `/`** — it's a static site; Functions in `/functions` deploy
   automatically.
3. Set up the lead webhook: follow the instructions at the top of
   `apps-script/lead-capture.gs` (3 minutes), then add the environment variable
   **`LEAD_WEBHOOK_URL`** in Pages → Settings → Environment variables. Redeploy.
4. Custom domain: Pages → Custom domains → add `peonomics.com`. (The old site is
   on GitHub Pages with a CNAME — don't switch DNS until this deploy looks right.)

## The dataset (read this)

`data/rates-2025.json` is **version 2025.1-preliminary**. Federal figures (FICA,
FUTA) are statutory and verified. State SUI and WC figures were compiled from
knowledge of 2025 published rates and each carries a confidence flag:

- `high` — statutory or well-established
- `med`  — likely correct, verify against the state agency before calling it final
- `low`  — estimate pending primary-source verification

The verification pass (state workforce agency for each SUI line, the Oregon DCBS
Premium Rate Ranking study for WC indexes, current-year KFF EHBS for health)
upgrades flags to `high` and bumps the version. The site displays ranges and
flags rather than false precision, by design. After editing the dataset, run:

```
python3 tools/build_states.py
```

## Security notes

- No secrets in this repo. The lead webhook URL lives only in the Cloudflare
  Pages environment variable.
- The enrichment function fetches third-party homepages; it sends an identified
  User-Agent, caps response size, and times out at 6s.
- Any token that has ever appeared in a chat, email, or screenshot should be
  treated as compromised and rotated.

## Disclosure

The buyer guides and methodology page carry forward the disclosed commercial
relationship from v1. Keep the disclosure current with how leads are actually
fulfilled — it's a legal requirement (FTC endorsement guides), not a style choice.
