import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9339
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp7','--remote-allow-origins=*','--window-size=290,1100','about:blank'],
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
window.__stress = async function(clicks, gapMs){
  const btn=document.querySelector('.ez-group-head[data-g="People"]');
  const grp=btn.closest('.ez-group'), panel=grp.querySelector('.ez-group-panel');
  const times=[]; let stop=false;
  const tick=t=>{times.push(t); if(!stop) requestAnimationFrame(tick)};
  requestAnimationFrame(tick);
  await new Promise(r=>setTimeout(r,90));
  const startOpen = grp.classList.contains('ez-open');
  const t0=performance.now();
  for(let i=0;i<clicks;i++){ btn.click(); await new Promise(r=>setTimeout(r,gapMs)); }
  await new Promise(r=>setTimeout(r,800));
  stop=true;
  const w=times.filter(t=>t>=t0); const d=[];
  for(let i=1;i<w.length;i++) d.push(w[i]-w[i-1]);
  d.sort((a,b)=>a-b);
  const expected = (clicks % 2 === 0) ? startOpen : !startOpen;
  const landed = grp.classList.contains('ez-open');
  return JSON.stringify({
    clicks, gapMs, frames:w.length,
    median:+d[Math.floor(d.length/2)].toFixed(1),
    max:+d[d.length-1].toFixed(1),
    dropped:d.filter(x=>x>20).length, bad:d.filter(x=>x>33).length,
    landedOpen:landed, expectedOpen:expected, correct: landed===expected,
    finalH: Math.round(panel.getBoundingClientRect().height),
    aria: btn.getAttribute('aria-expanded'),
  });
};
'ok'
"""
send('Runtime.evaluate',{'expression':JS})
print('\n  clicks  gap     frames  median  max     >20ms  >33ms  lands correctly  final h  aria')
print('  '+'-'*88)
bad=0
for clicks,gap in ((2,100),(2,180),(4,90),(8,60),(12,35),(20,16)):
    r=run('window.__stress(%d,%d)'%(clicks,gap))
    ok = r['correct'] and r['bad']==0 and ((r['finalH']>0) == r['landedOpen'])
    if not ok: bad+=1
    print('  %-6d  %-6s  %-6d  %-6.1f  %-6.1f  %-5d  %-5d  %-15s  %-7d  %-5s %s'
          % (clicks, str(gap)+'ms', r['frames'], r['median'], r['max'], r['dropped'], r['bad'],
             r['correct'], r['finalH'], r['aria'], 'PASS' if ok else 'FAIL'))
pr.terminate()
print('  '+'-'*88)
print('  stress cases failing: %d of 6' % bad)
sys.exit(1 if bad else 0)
