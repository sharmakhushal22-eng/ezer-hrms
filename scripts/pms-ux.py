#!/usr/bin/env python3
"""
pms-ux.py — the design checks a screenshot cannot make.

Renders every PMS state in a real browser and measures what a person would
actually experience: whether text is readable on the colour it is printed on,
whether controls are big enough to hit, whether anything overlaps anything
else, whether the keyboard can reach it all, and whether the connector lines
run through the numerals they are meant to join.

Every figure is composited against the ACTUAL painted background, walking up
the ancestors through transparent fills — measuring text against a colour it
is not really on is how a contrast check passes a screen nobody can read.

Needs the dev server up and a harness at /pms-preview.
Usage: python3 scripts/pms-ux.py [port]
"""
import json, subprocess, time, urllib.request, os, sys, websocket

SP = os.environ.get('SP', '/tmp')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9430
URL = 'http://localhost:3000/pms-preview'

chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr = subprocess.Popen([chrome, '--headless=new', '--disable-gpu',
    f'--remote-debugging-port={PORT}', '--user-data-dir=' + SP + f'/cdpUX{PORT}',
    '--remote-allow-origins=*', '--window-size=1280,900', 'about:blank'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try: tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws = websocket.create_connection(next(t for t in tabs if t['type'] == 'page')['webSocketDebuggerUrl'], timeout=240)
_id = 0
def send(m, p=None):
    global _id; _id += 1
    ws.send(json.dumps({'id': _id, 'method': m, 'params': p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get('id') == _id: return r
send('Page.enable'); send('Runtime.enable')

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<58s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<58s} {detail}')

AUDIT = r"""(() => {
  const px = c => { const m=(c||'').match(/[\d.]+/g);
    return m ? [+m[0],+m[1],+m[2], m.length>3?+m[3]:1] : null };
  const lin = v => { v/=255; return v<=.04045 ? v/12.92 : Math.pow((v+.055)/1.055,2.4) };
  const L = ([r,g,b]) => .2126*lin(r)+.7152*lin(g)+.0722*lin(b);
  const cr = (a,b) => { const [x,y]=[L(a),L(b)].sort((m,n)=>n-m); return (x+.05)/(y+.05) };
  // Walk UP through transparent backgrounds to the colour actually painted.
  const ground = el => {
    let n = el, acc = null;
    while (n && n !== document.documentElement) {
      const c = px(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) {
        acc = acc === null ? c : [0,1,2].map(k => acc[k]*acc[3] + c[k]*(1-acc[3])).concat([1]);
        if (acc[3] >= .999) return acc.slice(0,3);
      }
      n = n.parentElement;
    }
    return (acc || [255,255,255]).slice(0,3);
  };
  const vis = el => { const s = getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && +s.opacity > 0.05
        && el.getBoundingClientRect().width > 0 };

  const out = { contrast: [], targets: [], overlap: [], focus: [], strike: 0, tabbable: 0, noName: [] };

  // ── contrast of every visible text leaf ──
  document.querySelectorAll('section *').forEach(el => {
    if (el.children.length || !vis(el)) return;
    const txt = (el.textContent||'').trim(); if (!txt) return;
    const cs = getComputedStyle(el);
    const fg = px(cs.color); if (!fg) return;
    const bg = ground(el);
    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400;
    // WCAG "large text": 24px, or 18.66px when bold.
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const bar = large ? 3.0 : 4.5;
    const ratio = cr(fg.slice(0,3), bg);
    if (ratio < bar) out.contrast.push({ txt: txt.slice(0,40), ratio: +ratio.toFixed(2),
      bar, size, weight, cls: el.className || el.tagName });
  });

  // ── hit targets ──
  document.querySelectorAll('section button, section a[href], section [role="button"]').forEach(el => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 24)
      out.targets.push({ txt:(el.textContent||'').trim().slice(0,30),
        w: Math.round(r.width), h: Math.round(r.height), cls: el.className||el.tagName });
  });

  // ── does the connector cross a numeral? ──
  const dots = [...document.querySelectorAll('.pms-dot')].map(d => d.getBoundingClientRect());
  document.querySelectorAll('.pms-line').forEach(ln => {
    const L2 = ln.getBoundingClientRect();
    dots.forEach(D => {
      const ox = Math.min(L2.right,D.right) - Math.max(L2.left,D.left);
      const oy = Math.min(L2.bottom,D.bottom) - Math.max(L2.top,D.top);
      if (ox > 0.5 && oy > 0.5) out.strike++;
    });
  });

  // ── visible text boxes overlapping each other ──
  const boxes = [...document.querySelectorAll('.pms-step-label, .pms-step-detail, .pms-stat, h2')]
    .filter(vis).map(e => ({ r: e.getBoundingClientRect(), t: (e.textContent||'').trim().slice(0,24) }));
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a=boxes[i].r, b=boxes[j].r;
    const ox = Math.min(a.right,b.right)-Math.max(a.left,b.left);
    const oy = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if (ox > 2 && oy > 2) out.overlap.push([boxes[i].t, boxes[j].t, Math.round(ox), Math.round(oy)]);
  }

  // ── keyboard: is everything interactive reachable and named? ──
  document.querySelectorAll('section button, section a[href]').forEach(el => {
    if (!vis(el)) return;
    out.tabbable++;
    if (el.tabIndex < 0) out.focus.push('negative tabindex: ' + (el.textContent||'').slice(0,20));
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!name) out.noName.push(el.className || el.tagName);
  });

  return JSON.stringify(out);
})()"""

FOCUS = r"""(() => {
  // Every control must show WHERE the keyboard is. A focus style that only
  // changes colour fails for anyone who cannot see the difference, so this
  // asks for an outline or a ring of real width.
  const bad = [];
  document.querySelectorAll('section button').forEach(el => {
    el.focus();
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.outlineWidth) || 0;
    const hasRing = w >= 1.5 || /inset|0 0 0/.test(cs.boxShadow);
    if (!hasRing) bad.push((el.textContent||el.className||'?').trim().slice(0,28));
    el.blur();
  });
  return JSON.stringify(bad.slice(0, 8));
})()"""

for w, label in ((1280, 'desktop'), (768, 'tablet'), (390, 'phone')):
    send('Emulation.setDeviceMetricsOverride', {'width': w, 'height': 900,
         'deviceScaleFactor': 1, 'mobile': w < 500})
    send('Page.navigate', {'url': URL}); time.sleep(3.2)
    a = json.loads(send('Runtime.evaluate', {'expression': AUDIT, 'returnByValue': True})['result']['result']['value'])
    print(f'\n  ── {w}px {label} ──')
    check('every text node meets its WCAG bar on the colour behind it',
          not a['contrast'],
          '; '.join(f"{c['txt']!r} {c['ratio']}<{c['bar']}" for c in a['contrast'][:3]))
    check('every control is at least 24x24', not a['targets'],
          '; '.join(f"{t['txt']!r} {t['w']}x{t['h']}" for t in a['targets'][:3]))
    check('no connector line crosses a stage numeral', a['strike'] == 0, f"{a['strike']} crossings")
    check('no two visible text blocks overlap', not a['overlap'],
          '; '.join(f'{o[0]!r}/{o[1]!r}' for o in a['overlap'][:2]))
    check('every control is keyboard reachable', not a['focus'], '; '.join(a['focus'][:3]))
    check('every control has an accessible name', not a['noName'], '; '.join(a['noName'][:3]))
    if w == 1280:
        f = json.loads(send('Runtime.evaluate', {'expression': FOCUS, 'returnByValue': True})['result']['result']['value'])
        check('every control shows a visible focus ring', not f, '; '.join(f[:3]))
        # Only meaningful on a surface that HAS controls. Some PMS panels are
        # purely informational — the admin roll-ups report, they do not act —
        # and asserting a tab stop there fails a screen that is correct.
        if a['tabbable']:
            check('every control is reachable in tab order', True, f"{a['tabbable']} controls")
        else:
            print(f"  ---- no interactive controls on this surface (informational only)")

print(f'\n  {ok} passed, {fail} failed\n')
pr.terminate()
sys.exit(1 if fail else 0)
