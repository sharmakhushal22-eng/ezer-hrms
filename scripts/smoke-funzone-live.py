#!/usr/bin/env python3
"""
smoke-funzone-live.py — two real browsers, one Realtime channel.

Everything else about multiplayer can be unit-tested: the rules are pure and
the packets are validated by a function. What CANNOT be is whether two
independent clients actually reach each other — that depends on the channel
name matching, the payload surviving JSON, self:false suppressing echo, and
Supabase Realtime being reachable at all.

So this opens two headless pages, subscribes both to the same session channel
with the same protocol the components use, and plays a game between them.

Usage: python3 scripts/smoke-funzone-live.py
"""
import json, subprocess, time, urllib.request, os, websocket, sys

SP = os.environ['SP']
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<56s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<56s} {detail}')

class Page:
    def __init__(self, port, tag):
        self.tag = tag
        self.pr = subprocess.Popen(
            [chrome, '--headless=new', '--disable-gpu', f'--remote-debugging-port={port}',
             '--user-data-dir=' + SP + f'/cdpLV{port}', '--remote-allow-origins=*',
             '--window-size=900,700', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                t = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')); break
            except Exception: time.sleep(.5)
        self.ws = websocket.create_connection(
            next(x for x in t if x['type'] == 'page')['webSocketDebuggerUrl'], timeout=240)
        self.mid = 0
        self.send('Page.enable'); self.send('Runtime.enable')

    def send(self, m, p=None):
        self.mid += 1
        self.ws.send(json.dumps({'id': self.mid, 'method': m, 'params': p or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get('id') == self.mid: return r

    def js(self, expr, wait=True):
        r = self.send('Runtime.evaluate',
                      {'expression': expr, 'returnByValue': True, 'awaitPromise': wait})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            return {'__error': str(res['exceptionDetails'])[:180]}
        return res.get('result', {}).get('value')

    def goto(self, url):
        self.send('Page.navigate', {'url': url}); time.sleep(3)

    def kill(self): self.pr.kill()

print('  opening two browsers…')
a = Page(9471, 'A'); b = Page(9472, 'B')
# The harness page already imports the Supabase client, so both pages have a
# configured client on the same project as the real app.
for p in (a, b):
    p.goto('http://localhost:3000/funzone-preview')

SESSION = 'smoke-' + str(int(time.time()))

SETUP = """(async () => {
  const mod = await import('/_next/static/chunks/node_modules_%40supabase_ddd25a19._.js')
    .catch(() => null);
  return 'skip';
})()"""

# Rather than reach into the bundle, drive Realtime through a fresh client
# built from the same public env the browser already ships.
BOOT = """(async () => {
  if (window.__rt) return 'ready';
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const url = %s, key = %s;
  const sb = createClient(url, key);
  window.__sb = sb; window.__got = [];
  const ch = sb.channel(%s, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'g' }, ({ payload }) => window.__got.push(payload));
  await new Promise((res, rej) => {
    ch.subscribe(s => { if (s === 'SUBSCRIBED') res(); 
                        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') rej(s); });
    setTimeout(() => rej('timeout'), 12000);
  });
  window.__rt = ch;
  return 'ready';
})()"""

# The two PUBLIC values, read straight from .env.local. Both already ship to
# every browser in the page bundle, so nothing secret is involved — and
# neither is printed here regardless.
def public_env():
    out = {}
    try:
        with open('.env.local') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line: continue
                k, v = line.split('=', 1)
                if k.strip() in ('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'):
                    out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out

_env = public_env()
URL = _env.get('NEXT_PUBLIC_SUPABASE_URL')
KEY = _env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if not URL or not KEY:
    print('  .env.local has no public Supabase settings; skipping'); sys.exit(0)

chan = json.dumps(f'funzone:game:{SESSION}')
boot = BOOT % (json.dumps(URL), json.dumps(KEY), chan)

print('  subscribing both to', f'funzone:game:{SESSION}')
ra = a.js(boot); rb = b.js(boot)
check('both browsers subscribed to the same channel',
      ra == 'ready' and rb == 'ready', f'A={ra} B={rb}')
if ra != 'ready' or rb != 'ready':
    a.kill(); b.kill(); print(f'\n  {ok} passed, {fail} failed\n'); sys.exit(1)

def send(p, packet):
    return p.js(f"window.__rt.send({{type:'broadcast',event:'g',payload:{json.dumps(packet)}}})")

# ── a move crosses ───────────────────────────────────────────────────────
send(a, {'t': 'move', 'from': 'A', 'move': {'n': 0, 'by': 'X', 'cell': 4}})
time.sleep(2)
got = b.js("window.__got")
check('a move sent by A arrives at B', isinstance(got, list) and len(got) == 1,
      json.dumps(got)[:60])
check('and it arrives intact', isinstance(got, list) and got
      and got[0].get('move', {}).get('cell') == 4, json.dumps(got)[:60] if got else '')

# ── the sender does not hear itself ──────────────────────────────────────
mine = a.js("window.__got")
check('the sender does not receive its own broadcast (self:false)',
      isinstance(mine, list) and len(mine) == 0, f'{len(mine or [])} echoed')

# ── both directions ──────────────────────────────────────────────────────
send(b, {'t': 'move', 'from': 'B', 'move': {'n': 1, 'by': 'O', 'cell': 0}})
time.sleep(2)
back = a.js("window.__got")
check('a move sent by B arrives at A', isinstance(back, list) and len(back) == 1,
      json.dumps(back)[:60])

# ── a whole game, and the sync that recovers a reload ───────────────────
a.js("window.__got = []"); b.js("window.__got = []")
for i, (by, cell) in enumerate([('X', 1), ('O', 3), ('X', 2)]):
    send(a if by == 'X' else b, {'t': 'move', 'from': by,
                                 'move': {'n': i + 2, 'by': by, 'cell': cell}})
    time.sleep(.7)
time.sleep(1.5)
gotb = b.js("window.__got"); gota = a.js("window.__got")
check('every move in a rally is delivered',
      len(gotb or []) == 2 and len(gota or []) == 1,
      f'B got {len(gotb or [])}, A got {len(gota or [])}')

send(b, {'t': 'sync', 'from': 'B', 'moves': []})
time.sleep(1.5)
sync = a.js("window.__got")
check('a sync packet survives the wire with its array',
      any(p.get('t') == 'sync' and isinstance(p.get('moves'), list) for p in (sync or [])),
      json.dumps(sync)[-70:] if sync else '')

# ── a third party on another session hears nothing ──────────────────────
c = Page(9473, 'C')
c.goto('http://localhost:3000/funzone-preview')
other = json.dumps('funzone:game:someone-elses-game')
rc = c.js(BOOT % (json.dumps(URL), json.dumps(KEY), other))
if rc == 'ready':
    a.js("window.__got = []")
    send(a, {'t': 'move', 'from': 'A', 'move': {'n': 9, 'by': 'X', 'cell': 8}})
    time.sleep(2)
    leaked = c.js("window.__got")
    check('a different session hears nothing (channels are isolated)',
          leaked == [], json.dumps(leaked)[:60])
else:
    check('a third browser could subscribe', False, str(rc)[:60])
c.kill()

a.kill(); b.kill()
print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
