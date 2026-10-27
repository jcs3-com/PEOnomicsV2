import re,json,sys
L=[l.lstrip('\f') for l in open(sys.argv[1]).read().split('\n')]
NAMES={'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','United States':'US'}
def table(title):
  start=next(i for i,l in enumerate(L) if l.startswith(title))
  out={}
  for l in L[start+3:start+82]:
    m=re.match(r'^([A-Z][A-Za-z .]+?)\s{2,}(.*)$',l.strip())
    if not m or m.group(1) not in NAMES: continue
    toks=re.findall(r'--|[\d,.]+%?(?:\s\*)?',m.group(2))
    if len(toks)!=8: raise SystemExit(f'bad row {l!r}')
    v=[None if t=='--' else (float(t.replace(' *','').rstrip('%')) if '%' in t else int(t.replace(' *','').replace(',',''))) for t in toks]
    unrel=[t.endswith('*') for t in toks]
    out[NAMES[m.group(1)]]={'total':v[0],'lt50':v[6],'ge50':v[7],'unreliable':[k for k,i in (('total',0),('lt50',6),('ge50',7)) if unrel[i]]}
  assert len(out)==52,(title,len(out))
  return out
res={'singlePremium':table('Table II.C.1 Average total single premium'),
     'singleEmployee':table('Table II.C.2 Average total employee contribution'),
     'familyPremium':table('Table II.D.1 Average total family premium'),
     'familyEmployee':table('Table II.D.2 Average total employee contribution'),
     'enrolledPct':table('Table II.B.2.b Percent of private-sector employees that are enrolled')}
json.dump(res,open(sys.argv[2],'w'))
for s in ['US','DC','MD','VA','CA','TX','FL','NY','OH']:
  p=res['singlePremium'][s];c=res['singleEmployee'][s]
  print(s,p,c,{k:(p[k]-c[k] if p[k] is not None and c[k] is not None else None) for k in ('total','lt50','ge50')})
print('suppressed lt50 single:',[s for s in res['singlePremium'] if res['singlePremium'][s]['lt50'] is None or res['singleEmployee'][s]['lt50'] is None or 'lt50' in res['singlePremium'][s]['unreliable']+res['singleEmployee'][s]['unreliable']])
print('suppressed ge50 single:',[s for s in res['singlePremium'] if res['singlePremium'][s]['ge50'] is None or res['singleEmployee'][s]['ge50'] is None])
