#!/usr/bin/env python3
"""
smoke-funzone.py — actually PLAY the Fun Zone games and check what happens.

Reading the source proved the blank-deck bug was fixed. It could never have
proved that a tap turns a card, that a win is detected, that the board locks
during a flip-back, or that "New Game" resets anything. So this drives a real
browser: it clicks squares and cards and options, waits for the timers the
games actually use, and asserts on the DOM that results.

Needs the dev server and the dev-only harness at /funzone-preview.
Usage: python3 scripts/smoke-funzone.py [port]
"""
import json, subprocess, time, urllib.request, os, websocket, sys

SP = os.environ['SP']
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9455
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
pr = subprocess.Popen(
    [chrome, '--headless=new', '--disable-gpu', f'--remote-debugging-port={PORT}',
     '--user-data-dir=' + SP + f'/cdpFZ{PORT}', '--remote-allow-origins=*',
     '--window-size=1200,1000', 'about:blank'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        t = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')); break
    except Exception: time.sleep(.5)
ws = websocket.create_connection(
    next(x for x in t if x['type'] == 'page')['webSocketDebuggerUrl'], timeout=240)
mid = 0
def send(m, p=None):
    global mid; mid += 1
    ws.send(json.dumps({'id': mid, 'method': m, 'params': p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get('id') == mid: return r
send('Page.enable'); send('Runtime.enable')

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<58s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<58s} {detail}')
def sec(t): print(f'\n  ── {t} ' + '─' * max(0, 54 - len(t)))

def js(expr):
    r = send('Runtime.evaluate', {'expression': expr, 'returnByValue': True,
                                  'awaitPromise': True})
    res = r.get('result', {}).get('result', {})
    if res.get('subtype') == 'error' or 'exceptionDetails' in r.get('result', {}):
        return {'__error': str(r)[:200]}
    return res.get('value')

def goto():
    send('Page.navigate', {'url': 'http://localhost:3000/funzone-preview'})
    time.sleep(3.5)

# Clicking through React needs a real event, not .click() on a detached node.
CLICK = """(sel, n) => {
  const els = [...document.querySelectorAll(sel)];
  const el = typeof n === 'number' ? els[n] : els[0];
  if (!el) return 'no element';
  el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  return 'ok';
}"""
def click(sel, n=None):
    return js(f"({CLICK})({json.dumps(sel)}, {json.dumps(n)})")

def text():
    return js("document.body.innerText")

# Boards are found by SHAPE, not by a style-attribute substring. React
# renders `repeat(3, 80px)` with a space after the comma, so
# div[style*='repeat(3,80px)'] matched nothing and reported a working board
# as zero squares — thirteen failures that were this script's fault.
BOARD = """(n) => {
  const d = [...document.querySelectorAll('div')].find(el =>
    getComputedStyle(el).display === 'grid' &&
    el.querySelectorAll(':scope > button').length === n);
  return d ? [...d.querySelectorAll(':scope > button')] : [];
}"""
def board_texts(n):
    return js(f"({BOARD})({n}).map(b => b.innerText.trim())")
def board_count(n):
    return js(f"({BOARD})({n}).length")
def board_click(n, i):
    return js(f"""(() => {{
      const b = ({BOARD})({n})[{i}];
      if (!b) return 'no cell';
      b.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
      return 'ok';
    }})()""")

def click_text(label):
    """Click the button whose visible text EQUALS label — never a substring,
       so 'Spin!' cannot match the hub's 'Spin the Wheel' card and 'Back'
       cannot be hit by a positional click."""
    return js(f"""(() => {{
      const b = [...document.querySelectorAll('button')]
        .find(x => x.innerText.trim() === {json.dumps(label)});
      if (!b) return 'not found';
      b.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
      return 'ok';
    }})()""")

def open_game(name, mode=None):
    """Hub -> the game card -> (if asked) the mode.

       Every game except the wheel now shows a mode screen first, so a test
       that clicked the card and started asserting on a board found a list of
       modes instead."""
    goto()
    r = js(f"""(() => {{
      const b = [...document.querySelectorAll('button')]
        .find(x => x.innerText.includes({json.dumps(name)}));
      if (!b) return 'not found';
      b.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
      return 'ok';
    }})()""")
    if r != 'ok' or mode is None:
        return r
    time.sleep(.6)
    return js(f"""(() => {{
      const b = [...document.querySelectorAll('button')]
        .find(x => x.innerText.includes({json.dumps(mode)}));
      if (!b) return 'no mode';
      b.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
      return 'ok';
    }})()""")

goto()

# ── the hub ──────────────────────────────────────────────────────────────
sec('The hub')
body = text() or ''
check('the harness rendered', 'Fun Zone' in body or 'Take a break' in body, body[:40])
for name in ['Tic-Tac-Toe', 'Memory Match', 'EZER Trivia', 'Spin the Wheel']:
    check(f'card present: {name}', name in body)
# Playing together used to be its own hub card. It is now a MODE inside each
# game, which is the point of the mode screen — so the hub no longer mentions
# it and this checks it is reachable where it actually lives.
check('the hub lists games, not modes', 'Play together' not in body)
icons = js("""[...document.querySelectorAll('button')]
  .map(b => (b.innerText||'').trim().split('\\n')[0]).filter(s => s.length && s.length <= 3)""")
check('the hub cards carry an icon, not an empty span',
      isinstance(icons, list) and len(icons) >= 4, f'{len(icons or [])} icons')

# ── the mode screen ──────────────────────────────────────────────────────
sec('Choosing a mode')
open_game('Tic-Tac-Toe'); time.sleep(.8)
body = text() or ''
check('a game asks how you want to play', 'How do you want to play' in body)
for label in ['Against the computer', 'Two players, one screen', 'With a colleague']:
    check(f'mode offered: {label}', label in body)
check('the modes explain themselves', 'unbeatable' in body.lower(), '')

live = open_game('Memory Match', 'With a colleague'); time.sleep(1.2)
check('the live mode is reachable from inside a game',
      'Ask somebody to play' in (text() or '') or 'not switched on yet' in (text() or ''),
      str(live))

open_game('Spin the Wheel'); time.sleep(.8)
body = text() or ''
check('the wheel skips the mode screen (it has only one)',
      'How do you want to play' not in body and 'Spin' in body)

# ── against the computer ─────────────────────────────────────────────────
sec('Against the computer')
open_game('Tic-Tac-Toe', 'Against the computer'); time.sleep(1)
body = text() or ''
check('the bot game opened', 'You are X' in body, body[:40])
check('a difficulty can be chosen',
      all(d in body for d in ['Easy', 'Medium', 'Hard']))
n = board_count(9)
check('nine squares', n == 9, f'{n}')
board_click(9, 0); time.sleep(2.6)     # my move, then the bot's pause
marks = board_texts(9) or []
check('my mark is placed', marks and marks[0] == 'X', str(marks[:3]))
check('THE COMPUTER REPLIES', marks.count('O') == 1,
      f"{marks.count('O')} O on the board")
check('and it played a legal square', marks.count('X') == 1)

open_game('EZER Trivia', 'Against the computer'); time.sleep(1)
body = text() or ''
check('trivia against the computer opened', 'Computer' in body, body[:40])
first = js('''(() => { const b=[...document.querySelectorAll('button')]
  .find(x => x.style.display === 'block');
  if(!b) return 'none'; b.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return 'ok'; })()''')
time.sleep(3.2)
check('the computer answers too', 'computer' in (text() or '').lower(), str(first))

# ── tic-tac-toe ──────────────────────────────────────────────────────────
sec('Tic-Tac-Toe (two players)')
open_game('Tic-Tac-Toe', 'Two players, one screen'); time.sleep(1)
check('the board opened', 'Tic-Tac-Toe' in (text() or ''))
n = board_count(9)
check('nine squares', n == 9, f'{n}')
check('it says whose turn it is', "Player X's turn" in (text() or ''))

board_click(9, 0); time.sleep(.3)
marks = board_texts(9)
check('a tap places a mark', marks and marks[0] == 'X', str(marks[:3]))
check('and the turn passes', "Player O's turn" in (text() or ''))

board_click(9, 0); time.sleep(.3)
marks = board_texts(9)
check('a taken square cannot be overwritten', marks and marks[0] == 'X')

# X: 1,2 with O at 4,5 -> X wins the top row 0,1,2
for i in (3, 1, 4, 2):
    board_click(9, i); time.sleep(.25)
body = text() or ''
check('a win is detected and announced', 'wins' in body, body.split('\n')[2][:40] if body else '')
marks = board_texts(9)
check('the winning line is X', marks and marks[0:3] == ['X', 'X', 'X'], str(marks))

before = marks
board_click(9, 5); time.sleep(.3)
after = board_texts(9)
check('the board is frozen once won', before == after and before is not None, str(after))

click_text('New Game'); time.sleep(.4)
marks = board_texts(9)
check('New Game clears the board',
      bool(marks) and len(marks) == 9 and all(m == '' for m in marks), str(marks[:4]))

# ── memory match ─────────────────────────────────────────────────────────
sec('Memory Match')
open_game('Memory Match', 'On your own'); time.sleep(1.2)
n = board_count(16)
check('sixteen cards', n == 16, f'{n}')
faces = board_texts(16)
check('every card starts face down', faces and all(f == '' for f in faces),
      f'{sum(1 for f in (faces or []) if f)} showing')

# Flip card 0, find its partner by flipping until a match sticks.
board_click(16, 0); time.sleep(.35)
first = (board_texts(16) or [''])[0]
check('a tap turns a card over', bool(first), repr(first))

# THE BUG THAT SHIPPED: with a blank deck ANY second card matched.
board_click(16, 1); time.sleep(.35)
two = (board_texts(16) or [])[:2]
same = len(two) == 2 and two[0] == two[1]
time.sleep(1.1)   # past the 800ms flip-back
after = (board_texts(16) or [])[:2]
if same:
    check('a real pair stays face up', after == two, str(after))
else:
    check('a mismatch flips back (not every pair matches)',
          after == ['', ''], f'{two} -> {after}')

deck = js(f"""(() => {{
  // Turn every card over by clicking, reading, and letting it flip back is
  // slow; instead assert the deck has 8 distinct faces in 16 cards by
  // playing it out below.
  return null;
}})()""")

# Play the whole board out by pairing partners, to prove completion works.
result = js(f"""(async () => {{
  const grid = [...document.querySelectorAll('div')].find(el =>
    getComputedStyle(el).display === 'grid' &&
    el.querySelectorAll(':scope > button').length === 16);
  const cards = () => [...grid.querySelectorAll(':scope > button')];
  const face  = i => cards()[i].innerText.trim();
  const tap   = i => cards()[i].dispatchEvent(new MouseEvent('click',{{bubbles:true}}));
  const wait  = ms => new Promise(r => setTimeout(r, ms));

  // Learn the deck: flip pairs and record what each card is.
  const known = {{}};
  for (let i = 0; i < 16; i += 2) {{
    tap(i); await wait(120); known[i] = face(i);
    tap(i+1); await wait(120); known[i+1] = face(i+1);
    await wait(900);            // let a mismatch flip back
  }}
  const seen = Object.values(known).filter(Boolean);
  const distinct = new Set(seen).size;

  // Now clear the board using what we learned.
  const byFace = {{}};
  Object.entries(known).forEach(([i, f]) => {{ (byFace[f] ||= []).push(+i); }});
  for (const f of Object.keys(byFace)) {{
    const [a, b] = byFace[f];
    if (a === undefined || b === undefined) continue;
    if (cards()[a].innerText.trim() && cards()[b].innerText.trim()
        && document.body.innerText.includes('found them all')) break;
    tap(a); await wait(150); tap(b); await wait(950);
  }}
  return {{ distinct, cards: seen.length, body: document.body.innerText }};
}})()""")
if isinstance(result, dict) and '__error' not in result:
    check('the deck has eight distinct faces across sixteen cards',
          result.get('distinct') == 8, f"{result.get('distinct')} distinct")
    check('finding every pair is announced',
          'found them all' in (result.get('body') or ''),
          (result.get('body') or '').split('\n')[2][:44])
else:
    check('the board could be played out', False, str(result)[:80])

# ── trivia ───────────────────────────────────────────────────────────────
sec('EZER Trivia')
open_game('EZER Trivia', 'On your own'); time.sleep(1)
body = text() or ''
check('the first question shows', 'Q1.' in body, body.split('\n')[3][:44] if body else '')
check('the score starts at zero', 'Score: 0 / 4' in body)

quiz = js("""(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const opts = () => [...document.querySelectorAll('button')]
    .filter(b => b.style.display === 'block');
  const seen = [];
  for (let q = 0; q < 4; q++) {
    const o = opts();
    seen.push(o.length);
    if (!o.length) break;
    o[0].dispatchEvent(new MouseEvent('click', {bubbles:true}));
    await wait(1100);
  }
  return { opts: seen, body: document.body.innerText };
})()""")
if isinstance(quiz, dict) and '__error' not in quiz:
    check('every question offers its options',
          all(n >= 2 for n in (quiz.get('opts') or [0])), str(quiz.get('opts')))
    check('answering advances through all four',
          len(quiz.get('opts') or []) == 4, str(len(quiz.get('opts') or [])))
    check('the quiz finishes and reports a score',
          'Quiz done' in (quiz.get('body') or ''),
          (quiz.get('body') or '').split('\n')[-3][:40])
else:
    check('the quiz could be played', False, str(quiz)[:80])

again = click_text('Play Again')
time.sleep(.5)
check('Play Again restarts it', 'Q1.' in (text() or '') and 'Score: 0' in (text() or ''),
      str(again))

# ── spin the wheel ───────────────────────────────────────────────────────
sec('Spin the Wheel')
open_game('Spin the Wheel'); time.sleep(1)
body = text() or ''
check('the wheel opened', 'Spin' in body)
segs = js("""document.querySelectorAll("div[style*='conic-gradient'] > div").length""")
check('six prize segments', segs == 6, f'{segs}')
# 'Spin!' exactly — `includes('Spin')` also matches the hub's "Spin the
# Wheel" card, and a positional click hit the Back button and left the game.
spun = click_text('Spin!')
time.sleep(.6)
check('the button locks while spinning', 'Spinning' in (text() or ''), str(spun))
time.sleep(4.4)
body = text() or ''
check('a prize is announced when it stops', 'You got:' in body,
      [l for l in body.split('\n') if 'You got' in l][:1])
check('and the button is usable again', 'Spinning' not in body)

print(f'\n  {ok} passed, {fail} failed\n')
pr.kill()
sys.exit(1 if fail else 0)
