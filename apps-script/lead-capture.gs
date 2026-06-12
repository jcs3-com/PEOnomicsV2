/**
 * PEOnomics lead capture — Google Apps Script webhook.
 *
 * SETUP (one time, ~3 minutes):
 * 1. Open the lead sheet:
 *    https://docs.google.com/spreadsheets/d/1QxxjMfweTAlF4HJ31G-fypUW0SjMI13pMlelmofxye8/edit
 * 2. Extensions → Apps Script. Delete any starter code, paste this file.
 * 3. Deploy → New deployment → type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. Copy the web app URL it gives you.
 * 5. In Cloudflare Pages → your project → Settings → Environment variables:
 *      add LEAD_WEBHOOK_URL = (that URL), then redeploy.
 *
 * The sheet gets a header row automatically on first lead.
 */

const HEADERS = [
  'Timestamp', 'Email', 'Company', 'State', 'Employees', 'Avg Wage',
  'Industry', 'Standalone Est', 'PEO Low', 'PEO High', 'Page', 'User Agent'
];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      d.timestamp || new Date().toISOString(),
      d.email || '', d.company || '', d.state || '',
      d.employees || '', d.avgWage || '', d.industry || '',
      d.standalone || '', d.peoLow || '', d.peoHigh || '',
      d.page || '', d.ua || ''
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
