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
    ['PEO fee PEPM',i.pepm],['State tax dataset year',r.taxYear],['Rate dataset version',r.version],
    ['State tax data note','Historical, preliminary; actual rates differ by employer']
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
  rows.push(row(12,[str('A12','Source note'),str('B12','2025 historical state inputs unless separately verified')]));
  rows.push(row(13,[str('A13','Model behavior'),str('B13','No default PEO savings; edit the Inputs sheet')]));
  const sh2=xmlSheet(rows,'<col min="1" max="1" width="38" customWidth="1"/><col min="2" max="3" width="22" customWidth="1"/>');
  const wb=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/><sheet name="Model" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const rels=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const contentTypes=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E6B52"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([['[Content_Types].xml',contentTypes],['_rels/.rels',rootRels],['xl/workbook.xml',wb],['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',sh1],['xl/worksheets/sheet2.xml',sh2]]);
}
