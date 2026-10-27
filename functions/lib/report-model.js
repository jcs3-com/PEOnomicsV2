/* Shared server-side report calculation. Never trust submitted result totals. */
const within = (x, lo, hi, allowNull=false) => {
  if (allowNull && (x === null || x === '' || x === undefined)) return null;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi) throw new Error('invalid input');
  return x;
};
export function parseSnapshot(raw, rates) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid snapshot');
  const state = String(raw.state || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(rates.states, state)) throw new Error('invalid state');
  return {
    state,
    employees: Math.floor(within(raw.employees, 1, 100000)), wage: within(raw.wage, 0, 5000000),
    suta: within(raw.suta, 0, 30), wc: within(raw.wc, 0, 100), enrollment: within(raw.enrollment, 0, 100),
    health: within(raw.health, 0, 100000), pepm: within(raw.pepm, 0, 10000),
    currentAdmin: within(raw.currentAdmin, 0, 1000000000), adminAvoided: within(raw.adminAvoided, 0, 1000000000),
    peoSuta: within(raw.peoSuta, 0, 30, true), peoWc: within(raw.peoWc, 0, 100, true),
    peoHealth: within(raw.peoHealth, 0, 100000, true),
    industry: /^[a-z_]{1,45}$/.test(raw.industry || '') ? raw.industry : 'not_specified',
    company: String(raw.company || '').slice(0, 100).replace(/[\x00-\x1f<>]/g, '').trim()
  };
}
export function calculate(rates, i) {
  const f = rates.federal, st = rates.states[i.state], N=i.employees, W=i.wage;
  const fica = N * (Math.min(W,f.fica_ss_wage_base)*f.fica_ss_rate + W*f.fica_medicare_rate);
  const cr = (f.futa_credit_reduction_states || {})[i.state] || 0;
  const futa = N*Math.min(W,f.futa_wage_base)*(f.futa_net_rate+cr);
  const sutaBase = N * Math.min(W,st.sui_wage_base);
  const enrolled = N*i.enrollment/100, payroll = N*W;
  const cur={fica,futa,suta:sutaBase*i.suta/100,wc:payroll*i.wc/100,health:enrolled*i.health,admin:i.currentAdmin,fee:0};
  const avoided = Math.min(i.currentAdmin,i.adminAvoided);
  const peo={fica,futa,suta:sutaBase*(i.peoSuta??i.suta)/100,wc:payroll*(i.peoWc??i.wc)/100,
    health:enrolled*(i.peoHealth??i.health),admin:i.currentAdmin-avoided,fee:N*i.pepm*12};
  const total=o=>Object.values(o).reduce((a,b)=>a+b,0);
  return {cur,peo,payroll,enrolled,avoided,currentTotal:total(cur),peoTotal:total(peo),delta:total(peo)-total(cur),taxYear:rates.meta.tax_year,version:rates.meta.version};
}
export function reportLines(i,r) {
  const money=v=>'$'+Math.round(v).toLocaleString('en-US');
  const lines=[
    {t:'PEONOMICS  |  EMPLOYER COST REPORT',type:'title'},
    {t:'Generated '+new Date().toISOString().slice(0,10)+' (UTC)  |  Model tax year '+r.taxYear+', dataset v'+r.version,type:'small'},
    {t:'Company: '+(i.company||'Not specified')+'  |  HQ / Main Worksite State: '+i.state,type:'body'},
    {t:'Industry: '+i.industry.replaceAll('_',' ')+'  |  Employees: '+i.employees+'  |  Average annual wage: '+money(i.wage),type:'body'},
    {t:'Planning estimate from your inputs. Not a quote, not insurance pricing, not advice.',type:'small'},
    {t:'One state per model (HQ / main worksite). Multi-state payroll is not modeled.',type:'small'},
    {t:'',type:'space'},
    {t:'ANNUAL EMPLOYER COSTS',type:'heading'},
    {t:'Line item                        Standalone          With PEO',type:'mono'}
  ];
  const names={fica:'Employer FICA',futa:'FUTA',suta:'State unemployment',wc:'Workers compensation',health:'Employer healthcare',admin:'Internal administration',fee:'PEO administration fee'};
  for(const [k,label] of Object.entries(names)){
    lines.push({t:label.padEnd(29,' ')+money(r.cur[k]).padStart(16,' ')+money(r.peo[k]).padStart(19,' '),type:'mono'});
  }
  lines.push({t:'TOTAL'.padEnd(29,' ')+money(r.currentTotal).padStart(16,' ')+money(r.peoTotal).padStart(19,' '),type:'monoBold'});
  lines.push({t:'PEO additional cost (+) / reduction (-): '+(r.delta<0?'-':'')+money(Math.abs(r.delta)),type:'heading'});
  lines.push({t:'',type:'space'},{t:'EDITED MODEL ASSUMPTIONS',type:'heading'});
  for(const [key,label,val] of [
    ['suta','SUTA rate',i.suta+'%'],['wc','WC rate',i.wc.toFixed(4)+' per $100 payroll'],
    ['health','Annual employer health per covered employee',money(i.health)],['enrollment','Enrollment',i.enrollment+'%'],
    ['pepm','PEO fee per employee per month',money(i.pepm)],['currentAdmin','Internal annual admin',money(i.currentAdmin)],
    ['adminAvoided','Internal admin replaced',money(r.avoided)],
    ['peoSuta','PEO quoted SUTA',i.peoSuta==null?'Same as standalone':i.peoSuta+'%'],
    ['peoWc','PEO quoted WC',i.peoWc==null?'Same as standalone':i.peoWc.toFixed(4)+' / $100'],
    ['peoHealth','PEO annual health per covered employee',i.peoHealth==null?'Same as standalone':money(i.peoHealth)]
  ]) lines.push({t:label+': '+val,type:'body'});
  lines.push({t:'',type:'space'}, {t:'DATA & LIMITATIONS',type:'heading'},
    {t:'Defaults: 2026 SUTA from state agencies / U.S. DOL; wages BLS QCEW 2025; health AHRQ MEPS-IC 2025 (state, by firm size);',type:'body'},
    {t:'workers comp = Oregon DCBS 2024 state index x a PEOnomics industry multiplier (estimate). Sources: peonomics.com/data-library',type:'body'},
    {t:'New-employer SUTA is not your experience rate. Health uses single-coverage cost for every enrollee.',type:'body'},
    {t:'Actual employer experience rates, class codes, enrollment, and insurance quotes will vary.',type:'body'},
    {t:'No PEO savings assumed unless explicitly entered by the user.',type:'body'},
    {t:'Formulas: https://peonomics.com/#the-math',type:'small'},
    {t:'State reference data: https://peonomics.com/states/',type:'small'},
    {t:'PEOnomics does not sell or send your information to PEO providers.',type:'small'});
  return lines;
}
