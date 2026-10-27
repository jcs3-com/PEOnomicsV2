import csv,glob,json,sys
src=sys.argv[1]
FIPS={'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'}
SECT={'all_private':(['10'],None),'construction_trades':(['23'],lambda c:c[:2]=='23'),
 'light_manufacturing':(['31-33'],lambda c:c[:2] in('31','32','33')),
 'retail_services':(['44-45'],lambda c:c[:2] in('44','45')),
 'transportation_logistics':(['48-49'],lambda c:c[:2] in('48','49')),
 'clerical_professional':(['54'],lambda c:c[:2]=='54'),
 'hospitality_food':(['722'],lambda c:c[:3]=='722')}
NAME={'10':'Total, all private industries','23':'Construction (NAICS 23)','31-33':'Manufacturing (NAICS 31-33)','44-45':'Retail trade (NAICS 44-45)','48-49':'Transportation and warehousing (NAICS 48-49)','54':'Professional, scientific, and technical services (NAICS 54)','722':'Food services and drinking places (NAICS 722)'}
out={}
for fn in sorted(glob.glob(src+'/*000.csv')):
  f=fn.split('/')[-1][:2]
  rows=[r for r in csv.DictReader(open(fn)) if r['own_code']=='5']
  by={r['industry_code']:r for r in rows}
  st={}
  for k,(codes,sub) in SECT.items():
    r=by.get(codes[0])
    if r and r['disclosure_code']!='N' and int(r['avg_annual_pay'] or 0)>0:
      st[k]={'value':int(r['avg_annual_pay']),'naics':codes[0],'series':NAME[codes[0]],'employment':int(r['annual_avg_emplvl']),'method':'sector'}
      continue
    if sub is None: st[k]=None;continue
    # partial: disclosed 3-digit subsectors (agglvl 55)
    parts=[r for r in rows if r['agglvl_code']=='55' and sub(r['industry_code']) and r['disclosure_code']!='N' and int(r['annual_avg_emplvl'] or 0)>0]
    emp=sum(int(r['annual_avg_emplvl']) for r in parts); wages=sum(int(r['total_annual_wages']) for r in parts)
    if emp>=2000:
      st[k]={'value':round(wages/emp),'naics':codes[0],'series':NAME[codes[0]]+' — disclosed 3-digit subsectors only','employment':emp,'method':'disclosed_subsectors','subsectors':sorted(r['industry_code'] for r in parts)}
    else: st[k]=None
  out[FIPS[f]]=st
json.dump(out,open(src+'/qcew2025_by_state.json','w'),indent=0)
print('missing:',[(s,k) for s,v in out.items() for k,x in v.items() if x is None])
print('partial:',[(s,k,v[k]['employment']) for s,v in out.items() for k in v if v[k] and v[k]['method']!='sector'])
for s in ['DC','MD','VA','CA','TX','FL','NY','OH']: print(s,{k:(v['value'] if v else None) for k,v in out[s].items()})
