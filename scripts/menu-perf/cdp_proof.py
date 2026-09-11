import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9337
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp5','--remote-allow-origins=*','--window-size=290,1000','about:blank'],
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
send('Page.enable'); send('Runtime.enable'); send('Performance.enable')
send('Page.navigate',{'url':'file://'+SP+'/fold-light.html'}); time.sleep(2.0)
def run(e,ap=True):
    r=send('Runtime.evaluate',{'expression':e,'awaitPromise':ap,'returnByValue':True})
    v=r.get('result',{}).get('result',{}).get('value')
    if v is None: print('  eval failed:',json.dumps(r)[:300]); sys.exit(2)
    return v
def metrics():
    m={x['name']:x['value'] for x in send('Performance.getMetrics')['result']['metrics']}
    return m

MEAS = r"""
window.__m = async function(jankMs){
  const times=[]; let stop=false;
  const tick=t=>{times.push(t); if(!stop) requestAnimationFrame(tick)};
  requestAnimationFrame(tick);
  await new Promise(r=>setTimeout(r,90));
  const t0=performance.now();
  document.querySelector('.ez-group-head[data-g="People"]').click();
  if (jankMs > 0) {
    // block the main thread mid-animation, the way a real expensive render would
    await new Promise(r=>setTimeout(r,120));
    const end = performance.now() + jankMs;
    while (performance.now() < end) { /* spin */ }
  }
  await new Promise(r=>setTimeout(r,620));
  stop=true;
  const w=times.filter(t=>t>=t0&&t<=t0+620); const d=[];
  for(let i=1;i<w.length;i++) d.push(w[i]-w[i-1]);
  d.sort((a,b)=>a-b);
  return JSON.stringify({frames:w.length, median:+d[Math.floor(d.length/2)].toFixed(1),
    max:+d[d.length-1].toFixed(1), dropped:d.filter(x=>x>20).length, bad:d.filter(x=>x>33).length});
};
'ok'
"""
send('Runtime.evaluate',{'expression':MEAS})

print('\n  === proving the instrument ===')
for jank in ():
    r=json.loads(run('window.__m(%d)'%jank))
    verdict = 'clean' if r['bad']==0 else 'JANK SEEN'
    print('  injected block %3dms -> frames %2d  max %6.1fms  >20ms %2d  >33ms %2d   %s'
          % (jank, r['frames'], r['max'], r['dropped'], r['bad'], verdict))
    run('window.__m(0)')   # settle back

print('\n  === real main-thread cost of one fold ===')
run('(()=>{document.querySelectorAll(".ez-group-head").forEach(b=>{if(!b.closest(".ez-group").classList.contains("ez-open"))b.click()});return "ok"})()', ap=False)
time.sleep(1.0)
a=metrics()
run('window.__m(0)')          # one People fold, animated to completion
b=metrics()
for k in ('LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration'):
    d=b.get(k,0)-a.get(k,0)
    unit='' if 'Count' in k else 's'
    print('  %-22s %s%s' % (k, round(d,4), unit))
lay=b.get('LayoutDuration',0)-a.get('LayoutDuration',0)
cnt=b.get('LayoutCount',0)-a.get('LayoutCount',0)
print('  --> %d layouts over ~%d animated frames, %.1fms of layout total (%.2fms per frame)'
      % (cnt, 34, lay*1000, (lay*1000)/max(cnt,1)))
pr.terminate()
