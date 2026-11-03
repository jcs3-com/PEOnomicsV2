/* Small, standards-based, dependency-free XLSX for Cloudflare Pages Functions.
   Two editable sheets: Inputs and Model. Formulas refer to Inputs and recalc in Excel.
   ZIP stored entries only; files are tiny. No arbitrary user HTML is evaluated. */
const te=new TextEncoder();
const xt=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const row=(n, cells)=>`<row r="${n}">${cells.join('')}</row>`;
const str=(r,v,style=0)=>`<c r="${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xt(v)}</t></is></c>`;
const num=(r,v,style=0)=>`<c r="${r}" s="${style}"><v>${Number(v)}</v></c>`;
const fx=(r,formula,val,style=2)=>`<c r="${r}" s="${style}"><f>${xt(formula)}</f><v>${Number(val)}</v></c>`;
const xmlSheet=(rows,widths)=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(entries){const pieces=[],central=[];let offset=0;
  const put16=(v,o,n)=>new DataView(v.buffer).setUint16(o,n,true);
  const put32=(v,o,n)=>new DataView(v.buffer).setUint32(o,n,true);
  for(const [name,content] of entries){
    const fn=te.encode(name),data=te.encode(content),crc=crc32(data);
    const local=new Uint8Array(30);put32(local,0,0x04034b50);put16(local,4,20);put16(local,8,0);put32(local,14,crc);put32(local,18,data.length);put32(local,22,data.length);put16(local,26,fn.length);
    pieces.push(local,fn,data);
    const cent=new Uint8Array(46);put32(cent,0,0x02014b50);put16(cent,4,20);put16(cent,6,20);put32(cent,16,crc);put32(cent,20,data.length);put32(cent,24,data.length);put16(cent,28,fn.length);put32(cent,42,offset);
    central.push(cent,fn);
    offset+=local.length+fn.length+data.length;
  }
  const centralSize=central.reduce((a,c)=>a+c.length,0);
  const end=new Uint8Array(22);put32(end,0,0x06054b50);put16(end,8,entries.length);put16(end,10,entries.length);put32(end,12,centralSize);put32(end,16,offset);
  const full=[...pieces,...central,end],out=new Uint8Array(full.reduce((a,p)=>a+p.length,0));let cursor=0;for(const part of full){out.set(part,cursor);cursor+=part.length;}return out;
}
const WB_RELS=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const CONTENT_TYPES=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const ROOT_RELS=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const STYLES=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E6B52"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
export function makeReportXlsx(i,r,rates){
  const f=rates.federal,st=rates.states[i.state];
  const bookInputs=[
    ['PEOnomics — Editable Model Inputs',''],
    ['Company',i.company||'Not specified'],['HQ / Main Worksite State',i.state],
    ['Employees',i.employees],['Average annual wage',i.wage],['SUTA taxable wage base',st.sui_wage_base],
    ['Social Security wage base',f.fica_ss_wage_base],['SS employer rate',f.fica_ss_rate],['Medicare employer rate',f.fica_medicare_rate],
    ['FUTA net rate',f.futa_net_rate],['FUTA wage base',f.futa_wage_base],['FUTA credit-reduction add',(f.futa_credit_reduction_states||{})[i.state]||0],
    ['SUTA standalone (%)',i.suta],['SUTA PEO (%) — =standalone unless quoted',i.peoSuta??{f:'B13',v:i.suta}],
    ['WC standalone ($ per $100)',i.wc],['WC PEO ($ per $100) — =standalone unless quoted',i.peoWc??{f:'B15',v:i.wc}],
    ['Healthcare enrollment (%)',i.enrollment],['Employer annual health / covered EE',i.health],['PEO annual health / covered EE — =standalone unless quoted',i.peoHealth??{f:'B18',v:i.health}],
    ['Annual current internal admin',i.currentAdmin],['Annual internal admin avoided',Math.min(i.currentAdmin,i.adminAvoided)],
    ['PEO fee PEPM',i.pepm],['Reference data year',r.taxYear],['Reference data version',r.version],
    ['Data note','Defaults are published reference values (sources: peonomics.com/data-library); your own rates differ']
  ];
  const inputsRows=bookInputs.map(([label,value],ix)=>{
    const n=ix+1,style=n===1?1:0;
    const st=[8,9,10,12,13,14,15,16,17].includes(n)?0:2;
    const cellB=value&&typeof value==='object'?fx('B'+n,value.f,value.v,st):typeof value==='number'?num('B'+n,value,st):str('B'+n,value,style);
    return row(n,[str('A'+n,label,style),cellB]);
  });
  const sh1=xmlSheet(inputsRows,'<col min="1" max="1" width="38" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/>');
  const I=(cell)=>`'Inputs'!${cell}`;
  const rows=[row(1,[str('A1','Annual employer costs',1),str('B1','Standalone',1),str('C1','With PEO',1)])];
  const formulas=[
    ['Employer FICA',`${I('B4')}*(MIN(${I('B5')},${I('B7')})*${I('B8')}+${I('B5')}*${I('B9')})`,`${I('B4')}*(MIN(${I('B5')},${I('B7')})*${I('B8')}+${I('B5')}*${I('B9')})`,'fica'],
    ['FUTA',`${I('B4')}*MIN(${I('B5')},${I('B11')})*(${I('B10')}+${I('B12')})`,`${I('B4')}*MIN(${I('B5')},${I('B11')})*(${I('B10')}+${I('B12')})`,'futa'],
    ['SUTA',`${I('B4')}*MIN(${I('B5')},${I('B6')})*${I('B13')}/100`,`${I('B4')}*MIN(${I('B5')},${I('B6')})*${I('B14')}/100`,'suta'],
    ["Workers' comp",`${I('B4')}*${I('B5')}*${I('B15')}/100`,`${I('B4')}*${I('B5')}*${I('B16')}/100`,'wc'],
    ['Employer health',`${I('B4')}*${I('B17')}/100*${I('B18')}`,`${I('B4')}*${I('B17')}/100*${I('B19')}`,'health'],
    ['Internal admin',`${I('B20')}`,`MAX(0,${I('B20')}-${I('B21')})`,'admin'],
    ['PEO administration fee','0',`${I('B4')}*${I('B22')}*12`,'fee']
  ];
  for(let j=0;j<formulas.length;j++){
    const n=j+2,[label,a,b,key]=formulas[j];
    rows.push(row(n,[str('A'+n,label),fx('B'+n,a,r.cur[key]),fx('C'+n,b,r.peo[key])]));
  }
  rows.push(row(9,[str('A9','ANNUAL TOTAL',1),fx('B9','SUM(B2:B8)',r.currentTotal,3),fx('C9','SUM(C2:C8)',r.peoTotal,3)]));
  rows.push(row(10,[str('A10','PEO - standalone',1),fx('B10','C9-B9',r.delta,3)]));
  rows.push(row(12,[str('A12','Source note'),str('B12','2026 SUTA/FICA/FUTA; 2025 BLS wages and AHRQ health; 2024 WC index x estimate multiplier')]));
  rows.push(row(13,[str('A13','Model behavior'),str('B13','No default PEO savings; edit the Inputs sheet')]));
  const sh2=xmlSheet(rows,'<col min="1" max="1" width="38" customWidth="1"/><col min="2" max="3" width="22" customWidth="1"/>');
  const wb=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/><sheet name="Model" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  return zip([['[Content_Types].xml',CONTENT_TYPES],['_rels/.rels',ROOT_RELS],['xl/workbook.xml',wb],['xl/_rels/workbook.xml.rels',WB_RELS],['xl/styles.xml',STYLES],['xl/worksheets/sheet1.xml',sh1],['xl/worksheets/sheet2.xml',sh2]]);
}

/* Quote comparison workbook: "Inputs" (assumptions + each proposal's terms, blanks left blank)
   and "Comparison" (live formulas; a proposal with any blank term shows "Incomplete"). */
const fxv=(r,formula,val,style=2)=>typeof val==='string'
  ?`<c r="${r}" t="str" s="0"><f>${xt(formula)}</f><v>${xt(val)}</v></c>`
  :fx(r,formula,val,style);
export function makeCompareXlsx(c,evals,an){
  const cm=c.common, cols=c.quotes.map((_,i)=>'BCD'[i]);
  const inRows=[
    row(1,[str('A1','PEOnomics — Quote comparison inputs (edit any term; the Comparison sheet recalculates)',1)]),
    row(3,[str('A3','Employees'),num('B3',cm.employees)]),
    row(4,[str('A4','Average annual wage'),num('B4',cm.wage,2)]),
    row(5,[str('A5','Health enrollment (%)'),num('B5',cm.enrollment)]),
    row(6,[str('A6','SUTA taxable wage base'),num('B6',cm.sutaBase,2)]),
    row(7,[str('A7','Annual payroll'),fx('B7','B3*B4',cm.employees*cm.wage)]),
    row(9,[str('A9','Proposal terms',1),...c.quotes.map((q,i)=>str(cols[i]+'9',q.label,1))])
  ];
  const terms=[[10,'Fee basis (pepm or pct)','feeBasis'],[11,'Admin fee ($ PEPM or % of payroll)','fee'],[12,'One-time setup ($)','setup'],
    [13,'SUTA rate (%)','suta'],[14,"Workers' comp ($ per $100 payroll)",'wc'],[15,'Employer health $ / enrollee / yr','health'],
    [16,'EPLI $ per employee / month','epli'],[17,'Other recurring ($ / yr)','other']];
  for(const [n,lab,k] of terms){
    inRows.push(row(n,[str('A'+n,lab),...c.quotes.map((q,i)=>{const r=cols[i]+n;
      if(k==='feeBasis')return str(r,q.feeBasis);
      return q[k]===null?`<c r="${r}" s="0"/>`:num(r,q[k],0);})]));
  }
  inRows.push(row(18,[str('A18','Source of figures'),...c.quotes.map((q,i)=>str(cols[i]+'18',Object.entries(q.src).filter(([,v])=>v!=='typed').map(([k,v])=>k+': '+v).join(', ')||'typed'))]));
  inRows.push(row(20,[str('A20','Blank = not stated (not zero). Each line prices on its own; totals appear once rows 11–17 are all filled. Type a missing term and the Comparison sheet updates.')]));
  const sh1=xmlSheet(inRows,'<col min="1" max="1" width="40" customWidth="1"/><col min="2" max="4" width="24" customWidth="1"/>');

  const I=cell=>`'Inputs'!${cell}`;
  const inc=L=>`COUNTBLANK(${I(L+'11')}:${I(L+'17')})>0`;
  const IF=(L,expr)=>`IF(${inc(L)},"Incomplete",${expr})`;
  const val=(r,f)=>r.missing.length?'Incomplete':f(r);
  const lineExpr={
    'Admin':L=>`IF(${I(L+'10')}="pct",${I('$B$7')}*${I(L+'11')}/100,${I('$B$3')}*${I(L+'11')}*12)`,
    'SUTA':L=>`${I('$B$3')}*MIN(${I('$B$4')},${I('$B$6')})*${I(L+'13')}/100`,
    'Workers comp':L=>`${I('$B$7')}*${I(L+'14')}/100`,
    'Employer health':L=>`${I('$B$3')}*${I('$B$5')}/100*${I(L+'15')}`,
    'EPLI':L=>`${I('$B$3')}*${I(L+'16')}*12`,
    'Other':L=>`${I(L+'17')}`,
    'Year-one setup':L=>`${I(L+'12')}`
  };
  const rows=[row(1,[str('A1','Annual cost',1),...c.quotes.map((q,i)=>fxv(cols[i]+'1',I(cols[i]+'9'),q.label))])];
  const order=['Admin','SUTA','Workers comp','Employer health','EPLI','Other'];
  // each line prices on its own term; "Not stated" only when that term is blank
  const lineCell={'Admin':'11','SUTA':'13','Workers comp':'14','Employer health':'15','EPLI':'16','Other':'17','Year-one setup':'12'};
  const LINE=(L,k)=>`IF(ISBLANK(${I(L+lineCell[k])}),"Not stated",${lineExpr[k](L)})`;
  const lv=(r,k)=>r.parts[k]===null?'Not stated':r.parts[k];
  order.forEach((k,j)=>{const n=j+2;rows.push(row(n,[str('A'+n,k),...evals.map((r,i)=>fxv(cols[i]+n,LINE(cols[i],k),lv(r,k)))]));});
  rows.push(row(8,[str('A8','Recurring annual',1),...evals.map((r,i)=>fxv(cols[i]+'8',IF(cols[i],`SUM(${cols[i]}2:${cols[i]}7)`),val(r,x=>x.recurring),3))]));
  rows.push(row(9,[str('A9','Year-one setup'),...evals.map((r,i)=>fxv(cols[i]+'9',LINE(cols[i],'Year-one setup'),lv(r,'Year-one setup')))]));
  rows.push(row(10,[str('A10','Year one total',1),...evals.map((r,i)=>fxv(cols[i]+'10',IF(cols[i],`${cols[i]}8+${cols[i]}9`),val(r,x=>x.yearOne),3))]));
  rows.push(row(11,[str('A11','Year two'),...evals.map((r,i)=>fxv(cols[i]+'11',IF(cols[i],`${cols[i]}8`),val(r,x=>x.recurring)))]));
  rows.push(row(12,[str('A12','Year three'),...evals.map((r,i)=>fxv(cols[i]+'12',IF(cols[i],`${cols[i]}8`),val(r,x=>x.recurring)))]));
  rows.push(row(13,[str('A13','Three-year total',1),...evals.map((r,i)=>fxv(cols[i]+'13',IF(cols[i],`${cols[i]}8*3+${cols[i]}9`),val(r,x=>x.threeYear),3))]));
  rows.push(row(14,[str('A14','All-in per employee per month, year one'),...evals.map((r,i)=>fxv(cols[i]+'14',IF(cols[i],`${cols[i]}10/${I('$B$3')}/12`),val(r,x=>x.yearOne/cm.employees/12)))]));
  const rng=`$B$10:$${cols[cols.length-1]}$10`;
  rows.push(row(15,[str('A15','Above lowest, year one'),...evals.map((r,i)=>fxv(cols[i]+'15',IF(cols[i],`${cols[i]}10-MIN(${rng})`),val(r,x=>x.yearOne-Math.min(...evals.filter(e=>!e.missing.length).map(e=>e.yearOne)))))]));
  rows.push(row(17,[str('A17','Note'),str('B17','Years two and three repeat year-one pricing. Employer FICA/FUTA excluded (identical under every PEO).')]));
  const sh2=xmlSheet(rows,'<col min="1" max="1" width="40" customWidth="1"/><col min="2" max="4" width="22" customWidth="1"/>');
  const wb=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/><sheet name="Comparison" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  return zip([['[Content_Types].xml',CONTENT_TYPES],['_rels/.rels',ROOT_RELS],['xl/workbook.xml',wb],['xl/_rels/workbook.xml.rels',WB_RELS],['xl/styles.xml',STYLES],['xl/worksheets/sheet1.xml',sh1],['xl/worksheets/sheet2.xml',sh2]]);
}
