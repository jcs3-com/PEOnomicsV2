/**
 * PEOnomics — Cost Lab usage log (Google Apps Script web app).
 *
 * Receives one row per business-email lookup from POST /api/enrich.
 * This is a TOOL-USAGE log. It is NOT a lead list, CRM, or marketing list,
 * and nothing in it is shared with PEO providers.
 *
 * SETUP (one time, ~5 minutes):
 * 1. Open the private sheet "PEOnomics — Cost Lab Usage Log" in
 *    Drive › 34 PEOnomics › 34.02 Website › PEOnomics 2.0 — Site Build
 *    (or any private sheet you control).
 * 2. Extensions › Apps Script. Delete the starter code, paste this file, Save.
 * 3. Deploy › New deployment › type "Web app".
 *      Execute as: Me        Who has access: Anyone
 *    (Cloudflare calls it anonymously; the unguessable URL is the shared secret.)
 * 4. Copy the Web app URL.
 * 5. Cloudflare › Workers & Pages › peonomicsv2 › Settings › Variables and Secrets
 *    › Add › Type: Secret › Name: USAGE_WEBHOOK_URL › Value: that URL
 *    (Production environment). Then Deployments › latest › Retry deployment.
 * 6. Test on peonomics.com: enter a business email in the Cost Lab. One row
 *    should appear and the form should prefill.
 *
 * Do NOT reuse LEAD_WEBHOOK_URL / lead-capture.gs — different purpose and schema.
 * If the URL leaks: Deploy › Manage deployments › archive it, deploy a new one,
 * update the Cloudflare secret.
 */

const SHEET_NAME = 'Usage Log';
const HEADERS = ['Timestamp (UTC)', 'Event', 'Business Email', 'Domain', 'Company',
  'HQ State', 'Industry', 'Employees (approx)', 'Summary', 'Enrichment Source', 'Page', 'User Agent'];

function doPost(e) {
  const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  const lock = LockService.getScriptLock();
  try {
    const v = JSON.parse(e.postData.contents);
    if (v.event !== 'lookup_requested' || !v.email || !v.domain) return out({ ok: false, error: 'invalid_event' });

    lock.waitLock(10000);
    const book = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = book.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = book.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    // Neutralise spreadsheet-formula injection; cap length.
    const safe = (x) => String(x == null ? '' : x).slice(0, 250).replace(/^[=+\-@\t\r]/, "'$&");
    sheet.appendRow([
      safe(v.timestamp), safe(v.event), safe(v.email), safe(v.domain), safe(v.company),
      safe(v.state), safe(v.industry), safe(v.employees), safe(v.summary), safe(v.source),
      safe(v.page), safe(v.userAgent)
    ]);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: 'write_failed' });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** GET returns a liveness flag only — never sheet contents. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'peonomics-usage-log' }))
    .setMimeType(ContentService.MimeType.JSON);
}
