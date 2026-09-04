import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9338
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp6','--remote-allow-origins=*','--window-size=290,1100','about:blank'],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: t=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws=websocket.create_connection(next(x for x in t if x['type']=='page')['webSocketDebuggerUrl'],timeout=90)
mid=0
def send(m,p=None):
    global mid; mid+=1
    ws.send(json.dumps({'id':mid,'method':m,'params':p or {}}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==mid: return r
send('Page.enable'); send('Runtime.enable')
send('Page.navigate',{'url':'file://'+SP+'/fold-light.html'}); time.sleep(1.8)
def run(e):
    r=send('Runtime.evaluate',{'expression':e,'awaitPromise':True,'returnByValue':True})
    v=r.get('result',{}).get('result',{}).get('value')
    if v is None: print('  eval failed:',json.dumps(r)[:300]); sys.exit(2)
    return json.loads(v)

JS = r"""
window.__probe = async function(g){
  const sel = '.ez-group-head[data-g="' + g + '"]';
  const btn = document.querySelector(sel);
  const grp = btn.closest('.ez-group');
  const panel = grp.querySelector('.ez-group-panel');
  const rows = [...grp.querySelectorAll('.ez-group-items > a')];
  const settle = () => new Promise(r => setTimeout(r, 700));
  const snap = () => ({
    open: grp.classList.contains('ez-open'),
    aria: btn.getAttribute('aria-expanded'),
    h: Math.round(panel.getBoundingClientRect().height),
    inert: panel.hasAttribute('inert'),
    // a shut panel must not leave its links reachable by keyboard
    focusable: rows.filter(a => a.offsetParent !== null || panel.getBoundingClientRect().height > 0).length,
    chev: getComputedStyle(grp.querySelector('.ez-fold svg')).transform,
  });
  // normalise to open, then measure both states
  if (!grp.classList.contains('ez-open')) { btn.click(); await settle(); }
  const opened = snap();
  btn.click(); await settle();
  const shut = snap();
  btn.click(); await settle();
  const reopened = snap();
  return JSON.stringify({ g, rows: rows.length, opened, shut, reopened });
};
window.__secs = [...document.querySelectorAll('.ez-group-head')].map(b => b.dataset.g);
'ok'
"""
send('Runtime.evaluate',{'expression':JS})
secs=run('JSON.stringify(window.__secs)')
print('\n  section                rows  open h   shut h  reopen h  aria o/s  inert o/s  chevron turns')
print('  '+'-'*92)
fails=[]
for g in secs:
    r=run('window.__probe(%s)' % json.dumps(g))
    o,s_,ro = r['opened'], r['shut'], r['reopened']
    turns = o['chev'] != s_['chev']
    ok = (o['h']>0 and s_['h']==0 and ro['h']==o['h']
          and o['aria']=='true' and s_['aria']=='false'
          and (not o['inert']) and s_['inert'] and turns)
    if not ok: fails.append(g)
    print('  %-22s %-4d  %-7d  %-6d  %-8d  %-9s %-10s %-5s  %s'
          % (g, r['rows'], o['h'], s_['h'], ro['h'],
             o['aria']+'/'+s_['aria'], str(not o['inert'])+'/'+str(s_['inert']),
             turns, 'PASS' if ok else 'FAIL'))
pr.terminate()
print('  '+'-'*92)
print('  sections behaving: %d of %d' % (len(secs)-len(fails), len(secs)))
sys.exit(1 if fails else 0)
