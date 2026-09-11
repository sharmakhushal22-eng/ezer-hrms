import json, subprocess, time, urllib.request, os, sys, websocket
SP=os.environ['SP']; PORT=9351
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+'/cdpJ','--remote-allow-origins=*','--window-size=1440,1400','about:blank'],
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
send('Page.enable'); send('Runtime.enable')
send('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1400,'deviceScaleFactor':1,'mobile':False})

AUDIT = r"""(() => {
  const px = c => { const m=(c||'').match(/[\d.]+/g); return m? [ +m[0],+m[1],+m[2], m.length>3?+m[3]:1 ] : [0,0,0,0] };
  const lin = v => { v/=255; return v<=.04045 ? v/12.92 : Math.pow((v+.055)/1.055,2.4) };
  const L = ([r,g,b]) => .2126*lin(r)+.7152*lin(g)+.0722*lin(b);
  const cr = (a,b) => { const [x,y]=[L(a),L(b)].sort((m,n)=>n-m); return (x+.05)/(y+.05) };
  const bgOf = el => { const st=[]; let n=el;
    while (n && n!==document.documentElement){ const s=getComputedStyle(n);
      // a gradient we cannot resolve: stop and treat this node as opaque-unknown
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c=px(s.backgroundColor);
      if (c[3]>0){ st.push(c); if(c[3]===1) break } n=n.parentElement }
    st.push([255,255,255,1]); let out=st[st.length-1];
    for(let i=st.length-2;i>=0;i--){ const f=st[i],a=f[3]; out=[0,1,2].map(k=>f[k]*a+out[k]*(1-a)) }
    return out };
  const bad=[], seen=new Set(); let checked=0, skipped=0;
  for (const el of document.querySelectorAll('.cp-in *, .cp-head *')) {
    const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
    if(!txt) continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) continue;
    const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
    const bg=bgOf(el); if(!bg){ skipped++; continue }
    checked++;
    const size=parseFloat(cs.fontSize), w=+cs.fontWeight||400;
    const need=(size>=24||(size>=18.66&&w>=700))?3.0:4.5;
    const ratio=cr(px(cs.color).slice(0,3), bg);
    const key=txt.slice(0,24)+'|'+cs.color+'|'+Math.round(size);
    if(ratio<need && !seen.has(key)){ seen.add(key);
      bad.push({txt:txt.slice(0,30), color:cs.color, size, w, ratio:+ratio.toFixed(2), need}) }
  }
  return JSON.stringify({checked, skipped, bad});
})()"""

TABS=['Basic','Registration','Location','Contact','Banking','Structure','Payroll','Statutory','People','Brand']
fails=0
for theme in ('light','dark'):
    send('Page.navigate',{'url':'http://localhost:3000/zz-preview-cp'}); time.sleep(6)
    send('Runtime.evaluate',{'expression':"document.documentElement.setAttribute('data-ez-theme','%s')"%theme})
    send('Runtime.evaluate',{'expression':"(()=>{const h=document.querySelector('.cp-head');h&&h.click();return 1})()"})
    time.sleep(2.5)
    tot=skip=0; allbad=[]
    for name in TABS:
        send('Runtime.evaluate',{'expression':
          "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(%s));b&&b.click();return 1})()"%json.dumps(name)})
        time.sleep(0.7)
        d=json.loads(send('Runtime.evaluate',{'expression':AUDIT,'returnByValue':True})['result']['result']['value'])
        tot+=d['checked']; skip+=d['skipped']; allbad+= [(name,b) for b in d['bad']]
    print('  %-5s  %4d elements checked, %d skipped (gradient ground), %d below AA'
          % (theme, tot, skip, len(allbad)))
    for n,b in allbad[:8]:
        print('      %-12s %5.2f (need %.1f) %2.0fpx/%d  "%s"' % (n,b['ratio'],b['need'],b['size'],b['w'],b['txt']))
    fails += len(allbad)
pr.terminate()
sys.exit(1 if fails else 0)
