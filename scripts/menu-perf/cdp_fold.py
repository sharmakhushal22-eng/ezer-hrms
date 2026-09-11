import json, subprocess, time, urllib.request, os, sys, base64, websocket
SP=os.environ['SP']; PORT=9335
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp3','--remote-allow-origins=*','--window-size=290,760','about:blank'],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: t=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws=websocket.create_connection(next(x for x in t if x['type']=='page')['webSocketDebuggerUrl'],timeout=60)
mid=0
def send(m,pr_=None):
    global mid; mid+=1
    ws.send(json.dumps({'id':mid,'method':m,'params':pr_ or {}}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==mid: return r
send('Page.enable'); send('Runtime.enable')
send('Page.navigate',{'url':'file://'+SP+'/fold-light.html'}); time.sleep(1.5)

def shot(tag):
    r=send('Page.captureScreenshot',{'format':'png'})
    open(f'{SP}/shots/frame-{tag}.png','wb').write(base64.b64decode(r['result']['data']))

# PEOPLE starts shut; click it and watch it unfold
send('Runtime.evaluate',{'expression':"document.querySelector('.ez-group-head[data-g=\"People\"]').click()"})
frames=[]
t0=time.time()
for i in range(6):
    shot('u%d'%i)
    frames.append(round((time.time()-t0)*1000))
    time.sleep(0.055)
time.sleep(.6); shot('settled')

# geometry proof: the panel really animates height, and rows really rotate
JS = """(() => {
  const g=[...document.querySelectorAll('.ez-group')].find(x=>x.querySelector('.ez-group-head[data-g="People"]'));
  const panel=g.querySelector('.ez-group-panel');
  const rows=[...g.querySelectorAll('.ez-group-items > a')];
  return JSON.stringify({
    open: g.classList.contains('ez-open'),
    gridRows: getComputedStyle(panel).gridTemplateRows,
    panelH: Math.round(panel.getBoundingClientRect().height),
    rowTransforms: rows.slice(0,3).map(r=>getComputedStyle(r).transform),
    delays: rows.map(r=>getComputedStyle(r).transitionDelay),
    aria: g.querySelector('.ez-group-head').getAttribute('aria-expanded'),
    inert: panel.hasAttribute('inert'),
  });
})()"""
after=json.loads(send('Runtime.evaluate',{'expression':JS,'returnByValue':True})['result']['result']['value'])
send('Runtime.evaluate',{'expression':"document.querySelector('.ez-group-head[data-g=\"People\"]').click()"})
time.sleep(.75); shot('reshut')
before=json.loads(send('Runtime.evaluate',{'expression':JS,'returnByValue':True})['result']['result']['value'])
pr.terminate()
print('  frame times (ms):', frames)
print('  OPEN  grid=%s  height=%dpx  aria=%s  inert=%s' % (after['gridRows'],after['panelH'],after['aria'],after['inert']))
print('        row transforms:', after['rowTransforms'][:2])
print('        stagger delays:', after['delays'])
print('  SHUT  grid=%s  height=%dpx  aria=%s  inert=%s' % (before['gridRows'],before['panelH'],before['aria'],before['inert']))
ok = (after['panelH']>200 and before['panelH']==0 and after['aria']=='true'
      and before['aria']=='false' and before['inert'] and not after['inert']
      and after['delays'][-1]!=after['delays'][0])
print('  fold behaves: %s' % ('PASS' if ok else 'FAIL'))
sys.exit(0 if ok else 1)
