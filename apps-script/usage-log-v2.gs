/**
 * PEOnomics — private event log + deduplicated contacts (Google Apps Script web app).
 * Replaces usage-log.gs (P0). Receives:
 *   lookup_requested  from POST /api/enrich         (Cost Lab business-email prefill)
 *   report_requested / report_accepted / report_failed  from POST /api/report-request
 * Sheets: "Usage Log" (append-only events) and "Contacts" (one row per business email,
 * counts, first/last seen, survey-eligibility date, suppression flag).
 * NOT a CRM or sales pipeline. Nothing here is shared with PEO providers. No survey is sent.
 *
 * SETUP (one time):
 * 1. Open the private sheet "PEOnomics — Cost Lab Usage Log" in Drive ›
 *    34 PEOnomics › 34.02 Website › PEOnomics 2.0 — Site Build.
 * 2. Extensions › Apps Script. Replace all code with this file. Save.
 * 3. Deploy › New deployment › Web app. Execute as: Me. Who has access: Anyone.
 *    (Already deployed v1? Deploy › Manage deployments › edit › Version: New version,
 *    which keeps the same URL.)
 * 4. Copy the Web app URL. Cloudflare › Workers & Pages › peonomicsv2 › Settings ›
 *    Variables and Secrets › Add › Secret › USAGE_WEBHOOK_URL (Production). Redeploy.
 * The URL is a credential: never commit it, paste it in chat, or put it in docs.
 * Leaked? Archive the deployment, create a new one, update the secret.
 */
const EVENTS='Usage Log',CONTACTS='Contacts';
const EH=['Timestamp (UTC)','Event','Business Email','Domain','Company','HQ State','Industry','Employees (approx)','Summary','Enrichment Source','Page','User Agent','Request ID','Provider Message ID'];
const CH=['Business Email','Domain','Company','HQ State','Industry','Employees (approx)','First Seen UTC','Last Seen UTC','Lookup Count','PDF Requested Count','PDF Accepted Count','Survey Eligibility Date','Survey Suppressed'];
function doPost(e){
  const out=x=>ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
  const lock=LockService.getScriptLock();
  try{
    const d=JSON.parse(e.postData.contents);
    if(!['lookup_requested','report_requested','report_accepted','report_failed'].includes(d.event)||!d.email)return out({ok:false,error:'bad_event'});
    lock.waitLock(15000);
    const book=SpreadsheetApp.getActiveSpreadsheet();
    function sheet(name,headers){let sh=book.getSheetByName(name);if(!sh)sh=book.insertSheet(name);
      if(!sh.getLastRow()){sh.appendRow(headers);sh.setFrozenRows(1);}else if(sh.getLastColumn()<headers.length){sh.getRange(1,sh.getLastColumn()+1,1,headers.length-sh.getLastColumn()).setValues([headers.slice(sh.getLastColumn())]);}return sh;}
    const ev=sheet(EVENTS,EH),co=sheet(CONTACTS,CH);
    const safe=v=>String(v??'').slice(0,220).replace(/^[=+\-@\t\r]/,"'$&");
    const email=String(d.email).trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return out({ok:false,error:'bad_email'});
    const stamp=safe(d.timestamp||new Date().toISOString());
    const existing=co.getLastRow()>1?co.getRange(2,1,co.getLastRow()-1,1).getValues():[];
    const ix=existing.findIndex(row=>String(row[0]).trim().toLowerCase()===email);
    const row=ix>=0?ix+2:co.getLastRow()+1;
    let state=ix>=0?co.getRange(row,1,1,CH.length).getValues()[0]:Array(CH.length).fill('');
    state[0]=safe(email);state[1]=safe(d.domain||email.split('@')[1]);
    state[2]=safe(d.company||state[2]);state[3]=safe(d.state||state[3]);state[4]=safe(d.industry||state[4]);
    state[5]=safe(d.employees||state[5]);if(!state[6])state[6]=stamp;state[7]=stamp;
    state[8]=(Number(state[8])||0)+(d.event==='lookup_requested'?1:0);
    state[9]=(Number(state[9])||0)+(d.event==='report_requested'?1:0);
    state[10]=(Number(state[10])||0)+(d.event==='report_accepted'?1:0);
    if(d.event==='report_accepted' && state[12]!==true){
      const due=new Date(Date.parse(stamp)+30*86400000);
      if(Number.isFinite(due.getTime()))state[11]=due.toISOString().slice(0,10);
    }
    co.getRange(row,1,1,CH.length).setValues([state]);
    ev.appendRow([stamp,safe(d.event),safe(email),safe(d.domain),safe(d.company),safe(d.state),safe(d.industry),safe(d.employees),safe(d.summary),safe(d.source),safe(d.page),safe(d.userAgent),safe(d.requestId),safe(d.providerMessageId)]);
    return out({ok:true});
  }catch(err){return out({ok:false,error:'write_failed'});}finally{try{lock.releaseLock();}catch(ignore){}}
}
function doGet(){return ContentService.createTextOutput(JSON.stringify({ok:true,service:'peonomics-event-log'})).setMimeType(ContentService.MimeType.JSON);}
