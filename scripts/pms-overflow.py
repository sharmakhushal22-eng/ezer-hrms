#!/usr/bin/env python3
"""
pms-overflow.py — hunt for cut-off words and sideways scroll.

Renders the PMS surfaces at 14 viewport widths from 320px to 1440px and
reports two faults a reader would experience identically but which have
different causes:

    clipped   text wider than its own box, with overflow hidden — words
              are silently cut off, and nothing in the source looks wrong
    hscroll   the page itself scrolls sideways, which is a layout break

Screen-reader-only text is excluded: it is SUPPOSED to be a clipped 1x1
box, and counting it buried the one real finding under 34 false ones.

Needs the dev server up and a harness page at /pms-preview.
Usage: python3 scripts/pms-overflow.py [port]
"""
import json,subprocess,time,urllib.request,os,websocket,sys
SP=os.environ['SP']; PORT=int(sys.argv[1]) if len(sys.argv)>1 else 9416
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr=subprocess.Popen([chrome,'--headless=new','--disable-gpu',f'--remote-debugging-port={PORT}',
 '--user-data-dir='+SP+f'/cdpOF{PORT}','--remote-allow-origins=*','--window-size=1400,1000','about:blank'],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: t=json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws=websocket.create_connection(next(x for x in t if x['type']=='page')['webSocketDebuggerUrl'],timeout=240)
mid=0
def send(m,p=None):
    global mid; mid+=1
    ws.send(json.dumps({'id':mid,'method':m,'params':p or {}}))
    while True:
        r=json.loads(ws.recv())
        if r.get('id')==mid: return r
send('Page.enable'); send('Runtime.enable')
PROBE = r"""(() => {
  const bad = [], seen = new Set();
  const srOnly = el => { const cs = getComputedStyle(el);
    return (el.clientWidth<=1 && el.clientHeight<=1) || cs.clipPath==='inset(50%)'
        || (cs.clip && cs.clip!=='auto'); };
  document.querySelectorAll('section *').forEach(el => {
    if (el.children.length) return;
    const txt = (el.textContent||'').trim(); if (!txt || srOnly(el)) return;
    const cs = getComputedStyle(el);
    const c = (el.closest('section')||{}).dataset?.case || '?';
    const k = c+'|'+txt.slice(0,40); if (seen.has(k)) return;
    const hid = cs.overflowX==='hidden'||cs.overflow==='hidden'||cs.textOverflow==='ellipsis';
    if (hid && el.scrollWidth > el.clientWidth+1) {
      bad.push({case:c, by:el.scrollWidth-el.clientWidth, cls:el.className||el.tagName, txt:txt.slice(0,44)});
      seen.add(k); }
  });
  const de=document.documentElement, over=[];
  if (de.scrollWidth-de.clientWidth>1) {
    document.querySelectorAll('section *').forEach(el=>{
      const r=el.getBoundingClientRect();
      if (r.right>de.clientWidth+0.5 && r.width>0)
        over.push({cls:el.className||el.tagName, right:Math.round(r.right),
                   w:Math.round(r.width), txt:(el.textContent||'').trim().slice(0,32)}); });
  }
  return JSON.stringify({bad:bad.slice(0,20), hscroll:Math.max(0,de.scrollWidth-de.clientWidth), over:over.slice(0,5)});
})()"""
WIDTHS=[(1440,'desktop wide'),(1180,'desktop'),(1024,'small laptop'),(900,'tablet wide'),
        (860,'tablet'),(820,'tablet'),(768,'tablet narrow'),(720,'breakpoint'),
        (640,'phablet'),(560,'large phone'),(430,'phone'),(390,'phone'),(360,'small'),(320,'smallest')]
faults=0
for w,label in WIDTHS:
    send('Emulation.setDeviceMetricsOverride',{'width':w,'height':1000,'deviceScaleFactor':1,'mobile':w<500})
    send('Page.navigate',{'url':'http://localhost:3000/pms-preview'}); time.sleep(2.6)
    r=json.loads(send('Runtime.evaluate',{'expression':PROBE,'returnByValue':True})['result']['result']['value'])
    ok = not r['bad'] and not r['hscroll']
    if not ok: faults+=1
    print('  %-22s hscroll %-5s clipped %-3d  %s'%(f'{w}px {label}', r['hscroll'] or '—', len(r['bad']), 'ok' if ok else 'FAULT'))
    for b in r['bad'][:4]: print(f"        clipped +{b['by']}px {str(b['cls'])[:22]:22s} {b['txt']!r}")
    for o in r['over'][:3]: print(f"        spills x={o['right']} w{o['w']}  {str(o['cls'])[:22]:22s} {o['txt']!r}")
print('\n  widths with faults:', faults, 'of', len(WIDTHS))
pr.terminate()
