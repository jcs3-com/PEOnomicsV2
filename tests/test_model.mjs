import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = {};
await import(new URL('../assets/js/cost-lab.js', import.meta.url));
const { compute, adminReferencePepy } = window.PEOLab;
const R = JSON.parse(fs.readFileSync(new URL('../data/rates-2026.json', import.meta.url),'utf8'));
let pass=0; const t=(n,f)=>{try{f();pass++;}catch(e){console.error('FAIL',n,e.message);process.exitCode=1;}};
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<0.01,`${msg}: ${a} vs ${b}`);
const base={state:'MD',employees:25,wage:65000,suta:R.states.MD.sui_new_employer_rate*100,wc:R.states.MD.wc_index_per_100*0.35,enrollment:60,health:7580,pepm:160,currentAdmin:0,adminAvoided:0,peoSuta:null,peoWc:null,peoHealth:null};

t('51 jurisdictions',()=>assert.equal(Object.keys(R.states).length,51));
t('MD 25 @ 65k independent check',()=>{
  const r=compute(R,base), md=R.states.MD;
  // hand computation
  const fica=25*(65000*0.062+65000*0.0145);           // 65k < SS base
  const futa=25*7000*0.006;
  const suta=25*Math.min(65000,md.sui_wage_base)*md.sui_new_employer_rate;
  const wc=25*65000*(md.wc_index_per_100*0.35)/100;
  const health=25*0.6*7580;
  const fee=25*160*12;
  near(r.cur.fica,fica,'fica'); near(r.cur.futa,futa,'futa'); near(r.cur.suta,suta,'suta'); near(r.cur.wc,wc,'wc'); near(r.cur.health,health,'health');
  near(r.currentTotal,fica+futa+suta+wc+health,'current'); near(r.peoTotal,fica+futa+suta+wc+health+fee,'peo'); near(r.delta,fee,'delta = fee only');
  console.log('  MD 25@65k: FICA',Math.round(fica),'FUTA',futa,'SUTA',Math.round(suta),'WC',Math.round(wc),'Health',health,'Fee',fee,'Current',Math.round(r.currentTotal),'PEO',Math.round(r.peoTotal));
});
t('no hidden PEO savings: every non-fee line identical by default, in every state & industry',()=>{
  for(const s of Object.keys(R.states)) for(const [ind,m] of Object.entries(R.wc_industry_multipliers)){ if(typeof m!=='number')continue;
    const r=compute(R,{...base,state:s,suta:R.states[s].sui_new_employer_rate*100,wc:R.states[s].wc_index_per_100*m});
    for(const k of ['fica','futa','suta','wc','health','admin']) assert.equal(r.cur[k],r.peo[k],`${s}/${ind}/${k}`);
    near(r.delta,r.peo.fee,`${s} delta`);
  }
});
t('SS wage base cap',()=>{const r=compute(R,{...base,wage:250000});near(r.cur.fica,25*(R.federal.fica_ss_wage_base*0.062+250000*0.0145),'capped');});
t('CA FUTA credit reduction applied',()=>{const r=compute(R,{...base,state:'CA',suta:3.4,wc:1});near(r.cur.futa,25*7000*(0.006+R.federal.futa_credit_reduction_states.CA),'ca futa');});
t('zero enrollment -> zero health',()=>{const r=compute(R,{...base,enrollment:0});assert.equal(r.cur.health,0);assert.equal(r.peo.health,0);});
t('enrollment capped at 100%',()=>{const r=compute(R,{...base,enrollment:150});near(r.cur.health,25*7580,'cap');});
t('avoided admin capped at current admin',()=>{const r=compute(R,{...base,currentAdmin:20000,adminAvoided:50000});assert.equal(r.avoided,20000);assert.equal(r.peo.admin,0);near(r.delta,r.peo.fee-20000,'delta');});
t('avoided admin reduces PEO side only',()=>{const r=compute(R,{...base,currentAdmin:60000,adminAvoided:30000});assert.equal(r.cur.admin,60000);assert.equal(r.peo.admin,30000);});
t('PEO-side quoted rates only change the PEO column',()=>{const r=compute(R,{...base,peoSuta:1.0,peoWc:0.2,peoHealth:7000});
  near(r.peo.suta,25*Math.min(65000,R.states.MD.sui_wage_base)*0.01,'peo suta');near(r.peo.wc,25*65000*0.2/100,'peo wc');near(r.peo.health,25*0.6*7000,'peo health');
  near(r.cur.suta,25*Math.min(65000,R.states.MD.sui_wage_base)*R.states.MD.sui_new_employer_rate,'cur suta untouched');});
t('PEO-side blank (null) or 0 handled distinctly',()=>{const a=compute(R,{...base,peoWc:null}),b=compute(R,{...base,peoWc:0});assert.equal(a.peo.wc,a.cur.wc);assert.equal(b.peo.wc,0);});
t('negative inputs clamp to zero',()=>{const r=compute(R,{...base,wage:-5,pepm:-10,suta:-1,currentAdmin:-100});assert.equal(r.currentTotal,r.cur.health);assert.equal(r.cur.fica+r.cur.futa+r.cur.suta+r.cur.wc+r.cur.admin,0);assert.equal(r.peo.fee,0);});
t('fractional employees floored',()=>{const r=compute(R,{...base,employees:10.9});assert.equal(r.N,10);});
t('unknown state throws (UI guards)',()=>assert.throws(()=>compute(R,{...base,state:'ZZ'})));
t('admin reference tiers',()=>{assert.equal(adminReferencePepy(R,25).pepy,2950);assert.equal(adminReferencePepy(R,5).pepy,3450);assert.equal(adminReferencePepy(R,999999).pepy,2010);});
console.log(`calc: ${pass} passed`);
