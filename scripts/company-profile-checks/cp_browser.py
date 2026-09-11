import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9349
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdpH','--remote-allow-origins=*','--window-size=1440,1200','about:blank'],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: t=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws=websocket.create_connection(next(x for x in t if x['type']=='page')['webSocketDebuggerUrl'],timeout=180)
mid=0
def send(m,p=None):
    global mid; mid+=1
    ws.send(json.dumps({'id':mid,'method':m,'params':p or {}}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==mid: return r
send('Page.enable'); send('Runtime.enable'); send('Log.enable')
send('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1200,'deviceScaleFactor':1,'mobile':False})

logs=[]
def drain(sec):
    end=time.time()+sec; ws.settimeout(0.4)
    while time.time()<end:
        try: m=json.loads(ws.recv())
        except Exception: continue
        if m.get('method')=='Runtime.consoleAPICalled':
            logs.append((m['params']['type'],' '.join(str(a.get('value','')) for a in m['params'].get('args',[]))))
        elif m.get('method')=='Log.entryAdded':
            e=m['params']['entry']; logs.append((e['level'], e.get('text','')))
        elif m.get('method')=='Runtime.exceptionThrown':
            d=m['params']['exceptionDetails']
            logs.append(('exception', d.get('text','')+' '+str(d.get('exception',{}).get('description',''))))
    ws.settimeout(180)

send('Page.navigate',{'url':'http://localhost:3000/zz-preview-cp'})
drain(7)
# The company row is a div with an onClick and the class cp-head, not a
# <button> — clicking "the first button" landed on Edit and expanded nothing,
# which is why every tab first reported EMPTY.
send('Runtime.evaluate',{'expression':
 "(()=>{const h=document.querySelector('.cp-head'); if(!h) return 'no-head'; h.click(); return 'clicked'})()"})
drain(2.5)

TABS = ['Basic','Registration','Location','Contact','Banking','Structure','Payroll','Statutory','People','Brand']
print('\n  tab                content?  headings  fields')
ok=True
for name in TABS:
    send('Runtime.evaluate',{'expression':
      "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(%s));"
      "if(!b) return 'nobutton'; b.click(); return 'clicked'})()" % json.dumps(name)})
    drain(0.9)
    r=json.loads(send('Runtime.evaluate',{'expression':
      "(()=>{const p=document.querySelector('.cp-in');"
      "if(!p) return JSON.stringify({found:false});"
      "const txt=p.innerText.trim();"
      "return JSON.stringify({found:true,len:txt.length,"
      "heads:p.querySelectorAll('div,h2,h3').length,"
      "labels:[...p.querySelectorAll('div')].filter(d=>/^[A-Z][A-Z /&'-]{3,}$/.test(d.textContent.trim())).length})})()",
      'returnByValue':True})['result']['result']['value'])
    good = r.get('found') and r.get('len',0) > 40
    if not good: ok=False
    print('  %-18s %-9s %-9s %s' % (name, 'yes' if good else 'EMPTY',
                                     r.get('heads','-'), r.get('labels','-')))

errs=[(l,t) for l,t in logs if l in ('error','exception') or 'hydrat' in t.lower()]
print('\n  console errors / hydration warnings: %d' % len(errs))
for l,t in errs[:6]: print('     [%s] %s' % (l, t[:160]))
pr.terminate()
sys.exit(0 if (ok and not errs) else 1)
