# Owner-only setup — activating lookup, event log, emailed reports, abuse controls

Everything in the code is live. These steps need the owner's own accounts and secrets,
which never pass through Claude, chat or Git. Do them in order; each ends with a check.
Total time: about 30 minutes plus DNS propagation for Resend.

**Check at any point:** `https://peonomics.com/api/health` returns booleans only (no values)
showing which settings production can see. Secrets added in Cloudflare only take effect
after a new deployment (Deployments → latest → ⋯ → Retry deployment).

## 1. Event log (unblocks the business-email lookup)

1. Open the Google Sheet **PEOnomics — Cost Lab Usage Log**
   (Drive › 34 PEOnomics › 34.02 Website › PEOnomics 2.0 — Site Build).
2. Extensions › Apps Script › replace everything with `apps-script/usage-log-v2.gs` › Save.
3. Deploy › New deployment › type **Web app** › Execute as **Me** › Who has access **Anyone** ›
   Deploy › authorize with your Google account › copy the **Web app URL**.
   (Updating later: Deploy › Manage deployments › ✎ › Version: New version — the URL stays the same.)
4. Cloudflare dashboard › Workers & Pages › **peonomicsv2** › Settings › Variables and Secrets ›
   Add › type **Secret** › name `USAGE_WEBHOOK_URL` › value = the URL › Production › Save.
5. Retry the latest deployment.

✔ `/api/health` → `"lookup":{"ready":true,...}`. Then on peonomics.com enter your own business email
in the Cost Lab prefill; a `lookup_requested` row appears in **Usage Log** and one row in **Contacts**.

The web-app URL is a credential: never commit it or paste it into chat. If it leaks: Manage
deployments › Archive, deploy a new one, update the secret.

## 2. Resend (email delivery)

1. Create a Resend account › Domains › Add `peonomics.com`.
2. Add the DNS records Resend lists (SPF/DKIM `TXT`, and `MX` for the `send` subdomain) in
   Cloudflare › peonomics.com › DNS. Set them **DNS only** (grey cloud). Wait for **Verified**.
3. API Keys › Create › permission **Sending access**, domain `peonomics.com` › copy.
4. Pages secrets (Production): `RESEND_API_KEY` = the key; `REPORT_FROM` =
   `PEOnomics <reports@peonomics.com>` (must be on the verified domain).

✔ `/api/health` → `"resendKey":true,"sender":true`.

## 3. Turnstile (abuse protection on report requests)

1. Cloudflare › Turnstile › Add widget › name `peonomics-reports` › hostnames `peonomics.com`,
   `www.peonomics.com` (add `peonomicsv2.pages.dev` only while testing previews) › mode **Managed**.
2. Pages **variable** (plain text is fine — it is public) `TURNSTILE_SITE_KEY` = the site key (starts `0x`).
   No code change needed: `/api/report-status` hands the public key to the page.
3. Pages **secret** `TURNSTILE_SECRET` = the secret key.
4. Retry the latest deployment.

✔ `/api/health` → `"reports":{"ready":true,...}` and `/api/report-status` → `"available":true`.
The "Email this to me" button then shows the verification widget.

## 4. WAF rate-limiting rule (authoritative limit)

The code limits per isolate and per data center (`functions/lib/ratelimit.js`): 8 lookups / 10 min
and 6 report requests / hour per IP. Those are approximate. Add the real control:

Cloudflare › peonomics.com › Security › WAF › Rate limiting rules › Create rule
- If incoming requests match: URI Path **starts with** `/api/` (add Request Method equals `POST` if your plan offers that field)
- Characteristics: IP · Period **10 seconds** (the Free plan allows 10 s) · Requests **5**
- Action: **Block** for 10 seconds (or Managed Challenge on paid plans) › Deploy.

✔ Ten rapid `POST /api/enrich` calls from one machine start returning Cloudflare's block page.

## 5. Owner inbox test (the only test Claude cannot run)

On peonomics.com: enter your **business** email in the prefill, change several inputs (e.g.
employees, wage, PEPM, one PEO-quoted rate), verify the widget, click **Email this to me**.
Confirm:
- The email arrives with a PDF and an `.xlsx`; the PDF totals match the on-screen totals.
- In Excel, change Inputs › Employees; Model totals recalculate.
- Usage Log shows `report_requested` (with the Scenario Inputs and Annual columns) and `report_accepted`.
- Contacts shows ONE row for your address with Lookup Count, PDF Requested/Accepted counts and a
  Survey Eligibility Date.
- Double-clicking the button sends once (same Request ID → Resend idempotency).

## 6. Search Console + analytics (traffic measurement)

1. Google Search Console › Add property › **Domain** › `peonomics.com` › copy the `TXT` record ›
   Cloudflare DNS › add it (DNS only) › Verify. (Domain properties cover www and http variants.)
2. Sitemaps › submit `https://peonomics.com/sitemap.xml`.
3. Cloudflare › Web Analytics is already injected by Pages (cookieless). Product events
   (calculator use, lookup, comparator, report requests) are counted by `/api/event` into
   Cloudflare Workers Analytics Engine **only if** you bind a dataset: Pages › peonomicsv2 ›
   Settings › Bindings › Add › Analytics Engine › variable `EVENTS` › dataset `peonomics_events`.
   Without the binding the endpoint accepts and discards events (no error, no personal data).

## 7. Auto-posting to the PEOnomics LinkedIn page (Zapier, free plan)

The feed runs itself: `https://peonomics.com/api/feed` lists each post from its go-live time (9:00 ET on
its date) onward. Zapier publishes each new item once. You set this up once; Claude cannot (it needs your
LinkedIn sign-in).

1. Zapier › **Create Zap**. Trigger: **RSS by Zapier** › *New Item in Feed* › Feed URL
   `https://peonomics.com/api/feed` › "What triggers a new feed item": *Different Guid/URL*.
2. Action: **LinkedIn** › *Create Company Update* › Company: **PEOnomics** (the page, not your profile).
   Map: Comment = *Description*; Content URL = *Link*; Content Title = *Title*; Image URL = the
   enclosure / media URL field (`…/assets/images/posts/<id>.png`). Visibility: Anyone.
3. **Do not run Zapier's action test before Oct 30**: the test publishes for real. Skip the test, turn the Zap
   on, and check the page after the first post (Oct 30, 9:00–9:15 ET).
4. **Weekly audit (5 minutes):** open `https://peonomics.com/api/feed?audit=1`. It shows what is live and
   everything going live in the next 35 days, with the full text. To change or stop a post, edit
   `data/posts/series.json`, run `python3 tools/build_posts.py`, commit. Pause everything: turn the Zap off.
5. **Cadence:** two posts a week, Tuesday and Thursday at 9:00 ET. Countdowns and releases come first; data notes
   fill the rest. To change the days or rate, edit `cadence` in `data/posts/series.json` and rebuild.
6. **Mark a data release:** set its `date` in `data/posts/series.json` (dormant releases are listed in the audit),
   rebuild, commit. The builder refuses a release whose data is not ready (e.g. the 2026 FUTA final needs
   California's credit reduction updated and marked `high` confidence first).

## Credentials to rotate (from earlier chats)

Any Cloudflare API token, R2 access keys, GitHub PATs or webhook URLs ever pasted into a chat are
burned: revoke them. R2 is unused — delete its access keys. Apollo is unused — revoke its key.
