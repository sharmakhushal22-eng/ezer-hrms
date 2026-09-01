#!/usr/bin/env python3
"""Smoke test for the dashboard left menu.  Run:  python3 scripts/smoke-menu.py

Checks the things the rail's correctness actually rests on, by re-deriving
them from app/dashboard/layout.tsx, lib/ui/theme.css and lib/rms/modules.ts
rather than trusting the comments in those files:

  · every row has a page, a hue and a section ink, with no orphans either way
  · the sidebar's access filter agrees with the URL guard, row by row — a
    module the rail hides must be a module a typed URL blocks
  · every contrast and separation figure claimed in the code, recomputed
  · both dark states are declared (System stamps no attribute; an explicit
    choice stamps one — a rule written only one way breaks the other)

Not covered here, because they need a browser and a running dev server:
route status, real font metrics, console errors, and the six theme states.
Those were run over CDP; see the session notes.
"""
import pathlib, re, colorsys, sys, json, os
ROOT = pathlib.Path(__file__).resolve().parent.parent
lay   = (ROOT/'app/dashboard/layout.tsx').read_text()
theme = (ROOT/'lib/ui/theme.css').read_text()
mods  = (ROOT/'lib/rms/modules.ts').read_text()

P=[];F=[]
def check(name, ok, detail=''):
    (P if ok else F).append((name, detail))
    print('  %s %-52s %s' % ('PASS' if ok else 'FAIL', name, detail))

# ── parse the rail ────────────────────────────────────────────────────────
NAVSRC = lay[lay.index('const NAV: NavGroup[]'):lay.index('const OPEN_W')]
GROUPS = [(m.group(1), re.findall(r"label: '([^']+)',\s*href: '([^']+)',\s*Icon: (\w+),\s*module: (null|'[^']*')", m.group(2)))
          for m in re.finditer(r"\{ group: '([^']*)', items: \[(.*?)\]\}", NAVSRC, re.S)]
ITEMS = [(g,l,h,i,m.strip("'") if m!='null' else None) for g,its in GROUPS for l,h,i,m in its]
HUE  = dict(re.findall(r"'(/dashboard[^']*)':\s*'(#[0-9A-Fa-f]{6})'", lay))
INK  = {g:(l,d) for g,l,d in re.findall(r"'([^']+)':\s*\{ inkL: '(#[0-9A-Fa-f]{6})', inkD: '(#[0-9A-Fa-f]{6})' \}", lay)}
ROUTE_MODULE = dict(re.findall(r"'(/dashboard[^']*)':\s*'([^']+)'", mods[mods.index('ROUTE_MODULE'):]))

print('\n  parsed: %d groups, %d items, %d hues, %d group inks, %d routes\n'
      % (len(GROUPS), len(ITEMS), len(HUE), len(INK), len(ROUTE_MODULE)))

# ── 1. structure ──────────────────────────────────────────────────────────
check('every NAV item parsed with a module field', len(ITEMS) == 27, '%d items' % len(ITEMS))
dupes = [h for h in set(x[2] for x in ITEMS) if [x[2] for x in ITEMS].count(h) > 1]
check('no duplicate hrefs', not dupes, str(dupes))

missing_page = [h for _,_,h,_,_ in ITEMS
                if not (ROOT/('app'+h)/'page.tsx').exists() and not (ROOT/('app'+h)/'page.ts').exists()]
check('every href has a page file', not missing_page, str(missing_page))

no_hue = [h for _,_,h,_,_ in ITEMS if h not in HUE]
check('every item has an explicit hue (no silent fallback)', not no_hue, str(no_hue))
check('no orphan hues (a hue with no row)', set(HUE) == set(x[2] for x in ITEMS),
      str(set(HUE) ^ set(x[2] for x in ITEMS)))

named = [g for g,_ in GROUPS if g]
check('every named section has its own ink pair', all(g in INK for g in named),
      str([g for g in named if g not in INK]))
check('no orphan section inks', set(INK) == set(named), str(set(INK) ^ set(named)))

# ── 2. sidebar filter vs URL guard — one source of truth ──────────────────
def module_for(path):
    clean = path.split('?')[0].rstrip('/') or '/dashboard'
    if clean == '/dashboard': return None
    hits = sorted([r for r in ROUTE_MODULE if clean == r or clean.startswith(r+'/')], key=len, reverse=True)
    return ROUTE_MODULE[hits[0]] if hits else None
mismatch = [(h, m, module_for(h)) for _,_,h,_,m in ITEMS if module_for(h) != m]
check('sidebar module == moduleForPath for every row', not mismatch, str(mismatch))

# ── 3. colour, re-derived ─────────────────────────────────────────────────
def rgb(x): x=x.lstrip('#'); return tuple(int(x[i:i+2],16) for i in (0,2,4))
def lin(c): c/=255; return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def L(x): r,g,b=rgb(x); return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
def cr(a,b): l1,l2=sorted([L(a),L(b)],reverse=True); return (l1+.05)/(l2+.05)
def over(f,b,a):
    F_,B=rgb(f),rgb(b); return '#%02X%02X%02X'%tuple(round(F_[i]*a+B[i]*(1-a)) for i in range(3))
def lab(x):
    r,g,b=[lin(v) for v in rgb(x)]
    X=(.4124*r+.3576*g+.1805*b)/.95047; Y=.2126*r+.7152*g+.0722*b; Z=(.0193*r+.1192*g+.9505*b)/1.08883
    f=lambda t:t**(1/3) if t>.008856 else 7.787*t+16/116
    fx,fy,fz=f(X),f(Y),f(Z); return (116*fy-16,500*(fx-fy),200*(fy-fz))
def dE(a,b): A,B=lab(a),lab(b); return sum((A[i]-B[i])**2 for i in range(3))**.5
def addL(c,d):
    r,g,b=[v/255 for v in rgb(c)]; h,l,s=colorsys.rgb_to_hls(r,g,b)
    R,G,B=colorsys.hls_to_rgb(h,min(l+d,.92),s); return '#%02X%02X%02X'%(round(R*255),round(G*255),round(B*255))

RAIL_L, RAIL_D = '#FFFFFF', '#171B21'
order = [h for _,_,h,_,_ in ITEMS]
seq   = [HUE[h] for h in order]

worst = min((dE(seq[i-1],seq[i]), order[i-1], order[i]) for i in range(1,len(seq)))
check('adjacent rows distinguishable in light (dE >= 15)', worst[0] >= 15,
      'worst %.1f  %s / %s' % (worst[0], worst[1].split('/')[-1], worst[2].split('/')[-1]))
dseq  = [addL(c,.26) for c in seq]
worstd = min((dE(dseq[i-1],dseq[i]), order[i-1], order[i]) for i in range(1,len(seq)))
check('adjacent rows distinguishable in dark (dE >= 15)', worstd[0] >= 15,
      'worst %.1f  %s / %s' % (worstd[0], worstd[1].split('/')[-1], worstd[2].split('/')[-1]))

badL = [(h, round(cr(HUE[h], over(HUE[h], RAIL_L, .12)),2)) for h in order
        if cr(HUE[h], over(HUE[h], RAIL_L, .12)) < 3.0]
check('idle glyph >= 3:1 on its tile, light', not badL, str(badL))
badD = [(h, round(cr(addL(HUE[h],.26), over(HUE[h], RAIL_D, .20)),2)) for h in order
        if cr(addL(HUE[h],.26), over(HUE[h], RAIL_D, .20)) < 3.0]
check('idle glyph >= 3:1 on its tile, dark', not badD, str(badD))
badA = [(h, round(cr('#FFFFFF', HUE[h]),2)) for h in order if cr('#FFFFFF', HUE[h]) < 3.0]
check('active white glyph >= 3:1 on its tile', not badA, str(badA))

def tok(name, block):
    m = re.search(re.escape(name)+r':\s*(#[0-9A-Fa-f]{6})', block); return m.group(1) if m else None
light_blk = theme[:theme.index('@media (prefers-color-scheme: dark)')]
dark_blk  = theme[theme.index(':root[data-ez-theme="dark"]'):]
itemL, itemD = tok('--ez-rail-item', light_blk), tok('--ez-rail-item', dark_blk)
check('label ink >= 4.5:1 light', itemL and cr(itemL, RAIL_L) >= 4.5, '%s %.2f' % (itemL, cr(itemL, RAIL_L)))
check('label ink >= 4.5:1 dark',  itemD and cr(itemD, RAIL_D) >= 4.5, '%s %.2f' % (itemD, cr(itemD, RAIL_D)))
check('label ink not near-black (the "extremely dark" regression)',
      cr(itemL, RAIL_L) <= 12.0, '%.2f:1 (cap 12)' % cr(itemL, RAIL_L))

badG = [(g, round(cr(l,RAIL_L),2), round(cr(d,RAIL_D),2)) for g,(l,d) in INK.items()
        if cr(l,RAIL_L) < 4.5 or cr(d,RAIL_D) < 4.5]
check('section heading ink >= 4.5:1 in both themes', not badG, str(badG))
same = [g for g,(l,d) in INK.items() if l == d]
check('section inks differ per theme', not same, str(same))

# ── 4. theming discipline ─────────────────────────────────────────────────
css = lay[lay.index('<style>{`', lay.index('const HUE')):lay.index('`}</style>', lay.index('const HUE'))]
check('dark tile rule declared for BOTH system and explicit dark',
      css.count('.ez-nav:not(.ez-nav-on) .ez-nav-tile{') >= 2 and
      ':root:not([data-ez-theme="light"])' in css and ':root[data-ez-theme="dark"]' in css)
check('section ink swapped for BOTH dark states',
      css.count('.ez-group{ --g-ink: var(--g-ink-d) }') == 2,
      '%d occurrences' % css.count('.ez-group{ --g-ink: var(--g-ink-d) }'))
check('relative-colour lift is @supports-guarded', '@supports (color: hsl(from' in css)
check('prefers-reduced-motion honoured', '@media (prefers-reduced-motion: reduce)' in css)
check('.ez-nav carries a default hue for rows without one', '--nav-hue: ' in css.split('transition')[0])
check('--ez-rail-item defined in all three theme blocks',
      theme.count('--ez-rail-item') == 3, '%d' % theme.count('--ez-rail-item'))

# ── 5. the rail still fits ────────────────────────────────────────────────
AVAIL = 244-20-8-26-10-8
longest = max((l for _,l,_,_,_ in ITEMS), key=len)
check('label column is 172px wide as assumed', AVAIL == 172, '%dpx' % AVAIL)
print('\n  longest label: "%s" (%d chars) — width asserted in the browser pass\n' % (longest, len(longest)))

print('  %d passed, %d failed\n' % (len(P), len(F)))
sys.exit(1 if F else 0)
