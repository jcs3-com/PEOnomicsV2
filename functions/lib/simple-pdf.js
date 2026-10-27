/* Small, dependency-free, text-native PDF generator for Cloudflare Workers.
   Deliberately monochrome / financial-print. Text is ASCII-folded for the core PDF fonts.
   Not suitable for arbitrary rich user HTML; accepts trusted line objects only. */
const PUNCT={'\u2014':'-','\u2013':'-','\u2018':"'",'\u2019':"'",'\u201c':'"','\u201d':'"','\u2026':'...','\u00a0':' ','\u00d7':'x','\u2212':'-','\u00b7':'-'};
const ascii=s=>String(s).replace(/[\u2014\u2013\u2018\u2019\u201c\u201d\u2026\u00a0\u00d7\u2212\u00b7]/g,c=>PUNCT[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?');
const esc=s=>ascii(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
export function makeReportPdf(lines) {
  const pages=[], H=792, TOP=745, LEFT=48, BOTTOM=55;
  let parts=[],y=TOP;
  const newPage=()=>{if(parts.length)pages.push(parts.join('\n'));parts=[];y=TOP;};
  // Word-wrap instead of truncating; widths are conservative for 612pt Letter with 48pt margins.
  const wrap=(text,max)=>{const out=[];let cur='';for(const w of String(text).split(/\s+/)){if(!w)continue;
    if((cur+' '+w).trim().length>max&&cur){out.push(cur);cur=w;}else cur=(cur+' '+w).trim();}
    if(cur)out.push(cur);return out.length?out:[''];};
  for(const line of lines){
    const type=line.type||'body', size={title:17,heading:12,monoBold:9.7,mono:9.7,body:9.5,small:8,space:9}[type]||9.5;
    const leading={title:29,heading:24,monoBold:17,mono:17,body:16,small:13,space:9}[type]||16;
    const font=type==='monoBold'?'F4':['heading','title'].includes(type)?'F2':type==='mono'?'F3':'F1';
    const max=font==='F3'||font==='F4'?88:type==='small'?118:type==='heading'?70:type==='title'?52:100;
    const chunks=type==='space'?['']:(font==='F3'||font==='F4')?[String(line.t||'').slice(0,max)]:wrap(line.t||'',max);
    chunks.forEach((s,ix)=>{
      const lead=ix===chunks.length-1?leading:Math.round(size*1.35);
      if(y-lead<BOTTOM) newPage();
      if(type!=='space') parts.push(`BT /${font} ${size} Tf 1 0 0 1 ${LEFT} ${Math.round(y)} Tm (${esc(s)}) Tj ET`);
      y-=lead;
    });
  }
  if(parts.length)pages.push(parts.join('\n'));
  if(!pages.length) pages.push('');
  const objects=[''];
  const add=(s)=>{objects.push(s);return objects.length-1;};
  const catalogId=add(''),pagesId=add('');
  const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const mono=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const monoBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
  const pageIds=[];
  for(const content of pages){
    const streamId=add(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
    const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 ${H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R /F3 ${mono} 0 R /F4 ${monoBold} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';
  objects[pagesId]='<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] >>';
  let output='%PDF-1.4\n%PEOnomics report\n', offsets=[0];
  for(let id=1;id<objects.length;id++) { offsets.push(new TextEncoder().encode(output).length);output+=`${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const start=new TextEncoder().encode(output).length;
  output+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let id=1;id<objects.length;id++) output+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';
  output+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}
export function base64Bytes(bytes) {
  let out='';const chunk=16384;
  for(let i=0;i<bytes.length;i+=chunk) out+=String.fromCharCode(...bytes.slice(i,i+chunk));
  return btoa(out);
}
