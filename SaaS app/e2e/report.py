import json,re,sys
r=json.load(open(sys.argv[1]))
def walk(s,path=''):
    for sp in s.get('specs',[]):
        for t in sp['tests']:
            for res in t['results']:
                if res['status']!='passed':
                    e=re.sub(r'\x1b\[[0-9;]*m','',res.get('error',{}).get('message',''))
                    print('FAIL',path+sp['title'],'|',e[:260].replace('\n',' '))
    for c in s.get('suites',[]): walk(c,path+s.get('title','')+' > ')
for s in r['suites']: walk(s)
print(r['stats'])
