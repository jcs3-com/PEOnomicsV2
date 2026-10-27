import assert from 'node:assert/strict';
import * as E from '../functions/api/enrich.js';
let pass=0; const t=(name,fn)=>{ return Promise.resolve().then(fn).then(()=>{pass++;},e=>{console.error('FAIL',name,e.message);process.exitCode=1;}); };

// ---- validateDomain / SSRF ----
const bad=['localhost','127.0.0.1','10.0.0.1','1.2.3.4.nip.io','10-0-0-1.sslip.io','foo.localhost','intranet.corp','x.internal','acme.local',
 'a..com','-acme.com','acme-.com','acme.123','0x7f.0x0.0x0.0x1','acme.com:8080','user@acme.com','[::1]','acme','metadata.google.internal',
 'foo.home.arpa','acme.test','example.example','abc.pages.dev','x.workers.dev','acme.com/evil','http://acme.com',''];
const good=['acme.com','xcelhr.com','sub.acme.co.uk','my-firm.io','xn--bcher-kva.de'];
await t('rejects unsafe hosts',()=>{for(const d of bad) assert.equal(E.validateDomain(d),null,d);});
await t('accepts public hosts',()=>{for(const d of good) assert.equal(E.validateDomain(d),d,d);});
await t('business email parse',()=>{
  assert.deepEqual(E.parseBusinessEmail(' Jane@Acme.COM '),{email:'jane@acme.com',domain:'acme.com'});
  for(const e of ['jane@gmail.com','x@outlook.com','x@icloud.com','nope','a@b','a@127.0.0.1','a@localhost','a@acme.com@evil.com','a b@acme.com'])
    assert.equal(E.parseBusinessEmail(e),null,e);
});
await t('private IPs',()=>{
  for(const ip of ['10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:10.0.0.1','224.0.0.1','999.1.1.1'])
    assert.equal(E.isPrivateAddress(ip),true,ip);
  for(const ip of ['8.8.8.8','104.16.1.1','172.32.0.1','2606:4700::1111']) assert.equal(E.isPrivateAddress(ip),false,ip);
});

// ---- handler with mocked network ----
const realFetch=globalThis.fetch;
function mock({dns={}, sites={}, webhook=()=>({ok:true}), anthropic=null}){
  const calls=[];
  globalThis.fetch=async(url,opts={})=>{
    url=String(url); calls.push({url,opts});
    if(url.startsWith('https://cloudflare-dns.com/')){
      const u=new URL(url); const name=u.searchParams.get('name'),type=u.searchParams.get('type');
      const ips=(dns[name]||[]).filter(ip=>type==='A'?!ip.includes(':'):ip.includes(':'));
      return new Response(JSON.stringify({Answer:ips.map(d=>({type:type==='A'?1:28,data:d}))}),{status:200});
    }
    if(url==='https://hook.example/exec'){ const r=webhook(JSON.parse(opts.body)); return new Response(JSON.stringify(r),{status:r.__status||200}); }
    if(url.startsWith('https://api.anthropic.com/')){ if(!anthropic) return new Response('{}',{status:500}); return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(anthropic)}]}),{status:200}); }
    const s=sites[url]; if(!s) throw new Error('blocked network: '+url);
    return new Response(s.body||'',{status:s.status||200,headers:s.headers||{'content-type':'text/html'}});
  };
  return calls;
}
const req=(body,headers={})=>new Request('https://peonomics.com/api/enrich',{method:'POST',headers:{'content-type':'application/json',origin:'https://peonomics.com','cf-connecting-ip':String(Math.random()),...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const call=async(r,env)=>{const res=await E.onRequestPost({request:r,env});return {status:res.status,body:await res.json()};};
const ENV={USAGE_WEBHOOK_URL:'https://hook.example/exec'};

await t('personal email -> 400, nothing logged',async()=>{const c=mock({});const r=await call(req({email:'a@gmail.com'}),ENV);assert.equal(r.status,400);assert.equal(c.length,0);});
await t('no webhook -> 503 before any research',async()=>{const c=mock({});const r=await call(req({email:'a@acme.com'}),{ANTHROPIC_API_KEY:'k'});assert.equal(r.status,503);assert.equal(r.body.error,'log_not_configured');assert.equal(c.length,0);});
await t('foreign origin -> 403',async()=>{mock({});const r=await call(req({email:'a@acme.com'},{origin:'https://evil.com'}),ENV);assert.equal(r.status,403);});
await t('non-json -> 415',async()=>{mock({});const r=await call(new Request('https://peonomics.com/api/enrich',{method:'POST',headers:{'content-type':'text/plain'},body:'x'}),ENV);assert.equal(r.status,415);});
await t('GET -> 405',async()=>{const res=await E.onRequestGet();assert.equal(res.status,405);});

await t('research path: logs full profile, sends only domain to AI',async()=>{
  let logged=null;
  const c=mock({anthropic:{company:'Acme Corp',stateGuess:'va',employeesGuess:42,industryGuess:'light_manufacturing',summary:'Makes widgets.'},webhook:b=>{logged=b;return{ok:true};}});
  const r=await call(req({email:'Jane.Doe@acme.com',page:'cost-lab'}),{...ENV,ANTHROPIC_API_KEY:'k'});
  assert.equal(r.status,200); assert.equal(r.body.recorded,true);
  assert.equal(r.body.company,'Acme Corp'); assert.equal(r.body.stateGuess,'VA'); assert.equal(r.body.employeesGuess,42); assert.equal(r.body.industryGuess,'light_manufacturing');
  for(const k of ['timestamp','email','domain','company','state','industry','employees','summary','source']) assert.ok(k in logged,k);
  assert.equal(logged.email,'jane.doe@acme.com'); assert.equal(logged.company,'Acme Corp');
  const ai=c.find(x=>x.url.startsWith('https://api.anthropic.com'));
  assert.ok(!ai.opts.body.includes('jane'),'local part leaked to AI');
});
await t('webhook not confirming -> 502 and no profile returned',async()=>{
  mock({anthropic:{company:'Acme',stateGuess:'MD'},webhook:()=>({ok:false})});
  const r=await call(req({email:'a@acme.com'}),{...ENV,ANTHROPIC_API_KEY:'k'});
  assert.equal(r.status,502); assert.equal(r.body.company,undefined);
});
await t('scraper path with JSON-LD',async()=>{
  const html='<html><head><title>Acme Widgets | Home</title><script type="application/ld+json">{"@type":"Organization","name":"Acme Widgets LLC","address":{"addressRegion":"Maryland"},"numberOfEmployees":{"value":"30"}}</script></head><body>construction general contractor</body></html>';
  mock({dns:{'www.acme.com':['93.184.216.34']},sites:{'https://www.acme.com/':{body:html}}});
  const r=await call(req({email:'a@acme.com'}),ENV);
  assert.equal(r.status,200); assert.equal(r.body.company,'Acme Widgets LLC'); assert.equal(r.body.stateGuess,'MD'); assert.equal(r.body.employeesGuess,30); assert.equal(r.body.industryGuess,'construction_trades'); assert.equal(r.body.source,'site');
});
await t('SSRF: domain resolving to private IP is never fetched',async()=>{
  const c=mock({dns:{'www.evil-rebind.com':['10.0.0.5'],'evil-rebind.com':['169.254.169.254']}});
  const r=await call(req({email:'a@evil-rebind.com'}),ENV);
  assert.equal(r.status,200); assert.equal(r.body.company,null);
  assert.ok(!c.some(x=>/^https?:\/\/(www\.)?evil-rebind\.com/.test(x.url)),'fetched a private-resolving host');
});
await t('SSRF: redirect to internal host is not followed',async()=>{
  const c=mock({dns:{'www.acme2.com':['93.184.216.34'],'internal.acme2.com':['192.168.0.10']},
    sites:{'https://www.acme2.com/':{status:302,headers:{location:'http://internal.acme2.com/admin'}},'https://acme2.com/':{status:302,headers:{location:'http://127.0.0.1/'}}}});
  const r=await call(req({email:'a@acme2.com'}),ENV);
  assert.equal(r.status,200);
  assert.ok(!c.some(x=>x.url.includes('internal.acme2.com/admin')||x.url.startsWith('http://127.')),'followed redirect inward');
});
await t('SSRF: redirect with port / credentials refused',async()=>{
  const c=mock({dns:{'www.acme3.com':['93.184.216.34'],'acme3.com':['93.184.216.34']},sites:{'https://www.acme3.com/':{status:301,headers:{location:'https://acme3.com:8443/'}},'https://acme3.com/':{status:301,headers:{location:'https://u:p@acme3.com/'}}}});
  await call(req({email:'a@acme3.com'}),ENV);
  assert.ok(!c.some(x=>x.url.includes(':8443')||x.url.includes('u:p@')));
});
await t('non-HTML responses ignored',async()=>{
  mock({dns:{'www.acme4.com':['93.184.216.34'],'acme4.com':['93.184.216.34']},sites:{'https://www.acme4.com/':{body:'{"name":"x"}',headers:{'content-type':'application/json'}},'https://acme4.com/':{body:'%PDF',headers:{'content-type':'application/pdf'}}}});
  const r=await call(req({email:'a@acme4.com'}),ENV); assert.equal(r.body.company,null);
});
await t('formula-ish company text stays text; HTML stripped',async()=>{
  let logged; mock({anthropic:{company:'<script>x</script>=HYPERLINK("e")',stateGuess:'MD'},webhook:b=>{logged=b;return{ok:true};}});
  const r=await call(req({email:'a@acme5.com'}),{...ENV,ANTHROPIC_API_KEY:'k'});
  assert.ok(!/[<>]/.test(r.body.company));
});
await t('rate limit kicks in',async()=>{
  mock({anthropic:{company:'A',stateGuess:'MD'}});
  let last; for(let i=0;i<10;i++){ last=await call(req({email:'a@acme6.com'},{'cf-connecting-ip':'1.1.1.1'}),{...ENV,ANTHROPIC_API_KEY:'k'}); }
  assert.equal(last.status,429);
});
globalThis.fetch=realFetch;
console.log(`functions: ${pass} passed`);
