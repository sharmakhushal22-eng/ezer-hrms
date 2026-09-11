"""Frame-pacing test for the rail's fold. Every section, both directions.

Jank is not "does it look smooth in a screenshot" — it is whether frames
land inside the 16.7ms budget while the animation runs. This drives the
real CSS and counts the frames the browser actually produced.
"""
import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9336
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdp4','--remote-allow-origins=*','--window-size=290,1000',
 '--force-device-scale-factor=1','about:blank'],
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
send('Page.navigate',{'url':'file://'+SP+'/fold-light.html'}); time.sleep(2.0)

HARNESS = r"""
window.__perf = async function(sel, ms){
  const btn = document.querySelector(sel);
  const times = [];
  let stop = false;
  const tick = t => { times.push(t); if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const longs = [];
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) longs.push(Math.round(e.duration)); });
  try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  await new Promise(r => setTimeout(r, 90));
  const t0 = performance.now();
  btn.click();
  await new Promise(r => setTimeout(r, ms));
  stop = true; po.disconnect();
  const win = times.filter(t => t >= t0 && t <= t0 + ms - 60);
  const d = [];
  for (let i = 1; i < win.length; i++) d.push(win[i] - win[i-1]);
  d.sort((a,b) => a-b);
  const p = q => d.length ? d[Math.min(d.length-1, Math.floor(d.length*q))] : 0;
  return {
    frames: win.length,
    span: Math.round(ms - 60),
    median: +p(.5).toFixed(1),
    p95: +p(.95).toFixed(1),
    max: d.length ? +d[d.length-1].toFixed(1) : 0,
    dropped: d.filter(x => x > 20).length,
    bad: d.filter(x => x > 33).length,
    longtasks: longs,
  };
};
window.__sections = [...document.querySelectorAll('.ez-group-head')].map(b => b.dataset.g);
window.__isOpen = g => document.querySelector(`.ez-group-head[data-g="${g}"]`).closest('.ez-group').classList.contains('ez-open');
'true'
"""
send('Runtime.evaluate',{'expression':HARNESS})
secs=json.loads(send('Runtime.evaluate',{'expression':'JSON.stringify(window.__sections)','returnByValue':True})['result']['result']['value'])
counts={'People':7,'Time & Attendance':3,'Money':5,'Compliance & Docs':4,'Setup':5,'Help':2}

def run(expr, ms=620):
    r=send('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True})
    v=r.get('result',{}).get('result',{}).get('value')
    if v is None: print('   eval failed:', json.dumps(r)[:300]); sys.exit(2)
    return v

print('\n  section                rows  dir     frames  median  p95    max    >20ms  >33ms')
print('  ' + '-'*82)
rows=[]
for g in secs:
    for _ in range(2):                       # once each way
        openNow = run(f'JSON.stringify(window.__isOpen({json.dumps(g)}))')
        direction = 'close' if json.loads(openNow) else 'open'
        sel = json.dumps('.ez-group-head[data-g="%s"]' % g)
        m = run('window.__perf(%s, 620)' % sel)
        rows.append((g, direction, m))
        print('  %-22s %-4d  %-6s  %-6d  %-6.1f  %-5.1f  %-5.1f  %-5d  %d'
              % (g, counts.get(g,0), direction, m['frames'], m['median'], m['p95'], m['max'], m['dropped'], m['bad']))

# every section at once — the worst case the rail can be put in
STRESS = """(async () => {
  const times=[]; let stop=false;
  const tick=t=>{times.push(t); if(!stop) requestAnimationFrame(tick)};
  requestAnimationFrame(tick);
  await new Promise(r=>setTimeout(r,90));
  const t0=performance.now();
  document.querySelectorAll('.ez-group-head').forEach(b=>b.click());
  await new Promise(r=>setTimeout(r,620));
  stop=true;
  const w=times.filter(t=>t>=t0&&t<=t0+560); const d=[];
  for(let i=1;i<w.length;i++) d.push(w[i]-w[i-1]);
  d.sort((a,b)=>a-b);
  return JSON.stringify({frames:w.length, median:+d[Math.floor(d.length/2)].toFixed(1),
    max:+d[d.length-1].toFixed(1), dropped:d.filter(x=>x>20).length, bad:d.filter(x=>x>33).length});
})()"""
s=json.loads(run(STRESS))
print('  ' + '-'*82)
print('  %-22s %-4s  %-6s  %-6d  %-6.1f  %-5s  %-5.1f  %-5d  %d'
      % ('ALL SIX AT ONCE', 26, 'both', s['frames'], s['median'], '-', s['max'], s['dropped'], s['bad']))

# does folding move anything outside the rail?
GEO = """(() => {
  const rail=document.querySelector('.rail');
  const before=rail.getBoundingClientRect();
  document.querySelectorAll('.ez-group-head').forEach(b=>b.click());
  const after=rail.getBoundingClientRect();
  return JSON.stringify({widthBefore:before.width, widthAfter:after.width,
                         xBefore:before.x, xAfter:after.x});
})()"""
geo=json.loads(run(GEO))
pr.terminate()

alldrops=sum(m['dropped'] for _,_,m in rows)+s['dropped']
allbad=sum(m['bad'] for _,_,m in rows)+s['bad']
worst=max([m['max'] for _,_,m in rows]+[s['max']])
print('\n  rail width/position unchanged by folding: %s (%.0f->%.0f px, x %.0f->%.0f)'
      % (geo['widthBefore']==geo['widthAfter'] and geo['xBefore']==geo['xAfter'],
         geo['widthBefore'],geo['widthAfter'],geo['xBefore'],geo['xAfter']))
print('  totals: %d frames over budget (>20ms), %d badly late (>33ms), worst frame %.1fms'
      % (alldrops, allbad, worst))
json.dump({'rows':[(g,d,m) for g,d,m in rows],'stress':s}, open(SP+'/perf.json','w'))
sys.exit(0 if allbad==0 else 1)
