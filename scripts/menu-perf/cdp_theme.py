import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9334
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
p=subprocess.Popen([chrome,'--headless','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp2','--remote-allow-origins=*','--window-size=300,900','about:blank'],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: t=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws=websocket.create_connection(next(x for x in t if x['type']=='page')['webSocketDebuggerUrl'],timeout=60)
mid=0
def send(m,pr=None):
    global mid; mid+=1
    ws.send(json.dumps({'id':mid,'method':m,'params':pr or {}}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==mid: return r
send('Page.enable'); send('Runtime.enable')

JS = """(() => {
  const q=s=>document.querySelector(s);
  const cs=e=>getComputedStyle(e);
  const lbl=q('.ez-nav .lb'), head=q('.ez-group-name'), tile=q('.ez-nav:not(.ez-nav-on) .ez-nav-tile');
  return JSON.stringify({
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light',
    attr: document.documentElement.getAttribute('data-ez-theme'),
    rail: cs(q('.rail')).backgroundColor,
    label: cs(lbl).color,
    heading: cs(head).color,
    tileInk: cs(tile).color,
    tileBg: cs(tile).backgroundColor,
  });
})()"""
out={}
for name,dark in (('system + OS light',False),('system + OS dark',True)):
    send('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-color-scheme','value':'dark' if dark else 'light'}]})
    send('Page.navigate',{'url':'file://'+SP+'/rail-system.html'}); time.sleep(1.6)
    r=send('Runtime.evaluate',{'expression':JS,'returnByValue':True})
    out[name]=json.loads(r['result']['result']['value'])
# Explicit choice must beat the OS in BOTH directions. Light-while-OS-is-dark
# is the case a media-query-only implementation gets wrong.
for name,f,osdark in (('explicit dark (OS light)','rail-dark.html',False),
                      ('explicit light (OS light)','rail-light.html',False),
                      ('explicit dark (OS dark)','rail-dark.html',True),
                      ('explicit light (OS DARK)','rail-light.html',True)):
    send('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-color-scheme','value':'dark' if osdark else 'light'}]})
    send('Page.navigate',{'url':'file://'+SP+'/'+f}); time.sleep(1.6)
    r=send('Runtime.evaluate',{'expression':JS,'returnByValue':True})
    out[name]=json.loads(r['result']['result']['value'])
p.terminate()

DARK_LABEL='rgb(229, 231, 235)'; LIGHT_LABEL='rgb(65, 75, 90)'
DARK_RAIL='rgb(23, 27, 33)';     LIGHT_RAIL='rgb(255, 255, 255)'
print()
fails=0
for k,v in out.items():
    want_dark = k.startswith('system + OS dark') or k.startswith('explicit dark')
    ok = (v['label']==(DARK_LABEL if want_dark else LIGHT_LABEL)
          and v['rail']==(DARK_RAIL if want_dark else LIGHT_RAIL))
    if not ok: fails+=1
    print('  %-26s attr=%-6s rail=%-18s label=%-18s heading=%-18s  %s'
          %(k, v['attr'], v['rail'], v['label'], v['heading'], 'PASS' if ok else 'FAIL'))
# the ink must actually differ between the two system states
same = out['system + OS light']['label']==out['system + OS dark']['label']
print('  %-26s %s' % ('system state responds to OS', 'FAIL — identical' if same else 'PASS'))
sys.exit(1 if (fails or same) else 0)
