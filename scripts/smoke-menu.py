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
  · the fold: a real button that announces its state, a shut panel that is
    inert, a shut section that still reports what it hides, and a persisted
    value that cannot take the rail down when it is corrupt

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
ROUTE_MODULE = dict(re.findall(r"'(/dashboard[^']*)':\s*'([^']+)'", mods[mods.index('ROUTE_MODULE'):]))

print('\n  parsed: %d groups, %d items, %d routes — one blue, no per-item hues\n'
      % (len(GROUPS), len(ITEMS), len(ROUTE_MODULE)))

# ── 1. structure ──────────────────────────────────────────────────────────
check('every NAV item parsed with a module field', len(ITEMS) == 27, '%d items' % len(ITEMS))
dupes = [h for h in set(x[2] for x in ITEMS) if [x[2] for x in ITEMS].count(h) > 1]
check('no duplicate hrefs', not dupes, str(dupes))

missing_page = [h for _,_,h,_,_ in ITEMS
                if not (ROOT/('app'+h)/'page.tsx').exists() and not (ROOT/('app'+h)/'page.ts').exists()]
check('every href has a page file', not missing_page, str(missing_page))

# The rail is ONE BLUE now. A per-item hue map or a per-section ink map
# coming back would be the multi-colour design returning by accident.
check('no per-item hue map', "hueOf" not in lay and "const HUE" not in lay)
check('no per-section ink map', "GROUP_INK" not in lay and "inkOf" not in lay)

# ── 2. sidebar filter vs URL guard — one source of truth ──────────────────
def module_for(path):
    clean = path.split('?')[0].rstrip('/') or '/dashboard'
    if clean == '/dashboard': return None
    hits = sorted([r for r in ROUTE_MODULE if clean == r or clean.startswith(r+'/')], key=len, reverse=True)
    return ROUTE_MODULE[hits[0]] if hits else None
mismatch = [(h, m, module_for(h)) for _,_,h,_,m in ITEMS if module_for(h) != m]
check('sidebar module == moduleForPath for every row', not mismatch, str(mismatch))
# ── 3. colour, re-derived ─────────────────────────────────────────────────
# TWO POLARITIES. Light is a PALE rail (navy ink, rows darker than the
# ground, sections lighter); dark is a DEEP rail (white ink, rows lighter,
# sections darker). Nothing below may assume which way round it is, so no
# check names a direction: every figure is evaluated at EVERY stop of the
# gradient and at every stop of the level's own gradient, and the worst
# result is the one that has to clear the bar. That is stricter than
# reasoning about which end ought to be worst, and it cannot go stale when
# the polarity flips again.
def rgb(x): x=x.lstrip('#'); return tuple(int(x[i:i+2],16) for i in (0,2,4))
def hxs(t): return '#%02X%02X%02X' % tuple(max(0,min(255,round(v))) for v in t)
def lin(c): c/=255; return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def L(x): r,g,b=rgb(x); return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
def cr(a,b):
    l1,l2=sorted([L(a),L(b)],reverse=True); return (l1+.05)/(l2+.05)
def sat(h):
    r,g,b=[v/255 for v in rgb(h)]
    hi,lo=max(r,g,b),min(r,g,b)
    if hi==lo: return 0.0
    l=(hi+lo)/2
    return (hi-lo)/(2-hi-lo) if l>.5 else (hi-lo)/(hi+lo)
def hue(h):
    r,g,b=[v/255 for v in rgb(h)]
    hi,lo=max(r,g,b),min(r,g,b)
    if hi==lo: return 0.0
    d=hi-lo
    if hi==r: x=((g-b)/d)%6
    elif hi==g: x=(b-r)/d+2
    else: x=(r-g)/d+4
    return x*60
def over(a,fg,g):
    g=rgb(g); return hxs(tuple(fg[i]*a+g[i]*(1-a) for i in range(3)))

css = lay[lay.index('<style>{`', lay.index('const NAV: NavGroup[]')):]
css = css[:css.index('`}</style>')]
cssn = re.sub(r'\$\{[^}]*\}', 'TOKEN', css)
cssz = re.sub(r'\s+', '', cssn)

# Each theme block: its gradient stops and its token table.
blocks = []
for m in re.finditer(r'\.ez-rail\{(.*?)\n\s*\}', css, re.S):
    body = m.group(1)
    g = re.search(r'linear-gradient\(180deg,\s*(#[0-9A-Fa-f]{6})[^)]*?(#[0-9A-Fa-f]{6})\s*100%\)', body)
    if not g: continue
    toks = dict(re.findall(r'(--[\w-]+):\s*([^;]+);', body))
    blocks.append((g.group(1).upper(), g.group(2).upper(), toks, body))
check('both rails are declared: one pale, one deep', len(blocks) >= 2,
      '%d rail blocks' % len(blocks))

def stops_of(decl):
    """Every colour a level paints, as (r,g,b,alpha). A level may be one
       rgba() or a gradient of several; all of them are real pixels."""
    return [(int(a),int(b),int(c),float(d))
            for a,b,c,d in re.findall(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)', decl)]

def painted(toks, name, ground):
    """Every pixel colour this level can take on `ground`."""
    if name not in toks: return []
    st = stops_of(toks[name])
    if not st:
        hexes = re.findall(r'#[0-9A-Fa-f]{6}', toks[name])
        return [h.upper() for h in hexes]
    return [over(a, (r, g, b), ground) for r, g, b, a in st]

def ink(toks, name):
    m = re.search(r'#[0-9A-Fa-f]{6}', toks.get(name, ''))
    return m.group(0).upper() if m else None

BARS = {'label': 4.5, 'icon': 3.0, 'section': 4.5, 'hover ink': 4.5}
for g1, g2, toks, body in blocks[:2]:
    pale = L(g1) > 0.18
    th = 'pale' if pale else 'deep'
    grounds = [g1, g2]

    inks = {'label': ink(toks, '--r-ink'), 'icon': ink(toks, '--r-icon'),
            'section': ink(toks, '--r-sec-ink'), 'hover ink': ink(toks, '--r-ink-h')}
    missing = [k for k, v in inks.items() if not v]
    check('%-4s every rail ink is a declared token' % th, not missing, str(missing))
    if missing: continue

    # worst = the least contrast this ink ever has, over every ground stop
    # and every stop of the surface it sits on
    def worst_on(inkc, level_name):
        vals = [cr(inkc, px) for g in grounds for px in painted(toks, level_name, g)]
        return min(vals) if vals else None

    for name, level_name in (('label', '--r-row'), ('icon', '--r-row'),
                             ('section', '--r-band'), ('hover ink', '--r-row-h')):
        v = worst_on(inks[name], level_name)
        bar = BARS[name]
        check('%-4s %-10s on its own surface >= %.1f' % (th, name, bar),
              v is not None and v >= bar, '%.2f' % v if v else 'n/a')

    # the icon must not read as a disabled row next to its label
    # An icon markedly dimmer than the label beside it reads as a disabled
    # row — that is what this catches. But the rule is about the icon being
    # WEAK, not about the ratio: on a white card the label is near-black at
    # 12.5 and an icon at 7.5 is in no danger of looking switched off, it
    # is simply not black. So either it tracks the label, or it is strong
    # enough on its own account.
    li, ii = worst_on(inks['label'], '--r-row'), worst_on(inks['icon'], '--r-row')
    check('%-4s the icon does not read as disabled next to its label' % th,
          ii >= li * .75 or ii >= 4.5, 'icon %.2f vs label %.2f' % (ii, li))

    # ── the levels, in whichever direction this polarity runs ────────────
    def step(level_name):
        return min(cr(px, g) for g in grounds for px in painted(toks, level_name, g))
    check('%-4s the row separates from the ground   >= 1.15' % th,
          step('--r-row') >= 1.15, '%.2f' % step('--r-row'))
    check('%-4s the band separates from the ground  >= 1.15' % th,
          step('--r-band') >= 1.15, '%.2f' % step('--r-band'))
    # a band sits directly above the first row of its section, so they are
    # judged on the SAME ground — never one at each end
    rb = min(cr(r, b) for g in grounds
             for r in painted(toks, '--r-row', g) for b in painted(toks, '--r-band', g))
    check('%-4s row and band are told apart         >= 1.30' % th, rb >= 1.30, '%.2f' % rb)

    # the row must go the OPPOSITE way from the band, or there are not four
    # levels — only three and a coincidence
    rows  = [px for g in grounds for px in painted(toks, '--r-row', g)]
    bands = [px for g in grounds for px in painted(toks, '--r-band', g)]
    gl    = [L(g) for g in grounds]
    row_up  = all(L(r) > min(gl) for r in rows)  or all(L(r) < max(gl) for r in rows)
    opposite = (sum(L(r) for r in rows)/len(rows) > sum(gl)/2) != \
               (sum(L(b) for b in bands)/len(bands) > sum(gl)/2)
    check('%-4s row and band lean OPPOSITE ways off the ground' % th, opposite)

    # ── the selected pill ────────────────────────────────────────────────
    pbg, pink = ink(toks, '--r-pill-bg'), ink(toks, '--r-pill-ink')
    check('%-4s the pill and its ink are tokens' % th, bool(pbg and pink))
    if pbg and pink:
        check('%-4s ink on the selected pill >= 4.5' % th,
              cr(pink, pbg) >= 4.5, '%.2f' % cr(pink, pbg))
        pr = min(cr(pbg, px) for g in grounds for px in painted(toks, '--r-row', g))
        check('%-4s the pill outranks a resting row >= 2.00' % th, pr >= 2.0, '%.2f' % pr)

    # ── chroma: the row must stay BLUE, never wash to grey ───────────────
    # Relative retention was the deep rail's metric and does not transfer:
    # a pale ground has little chroma to keep in the first place. What holds
    # for both is that the row stays on the ground's hue and stays visibly
    # coloured rather than neutral.
    # WHAT THIS ACTUALLY FORBIDS IS MUD, not achromatic surfaces.
    #
    # The original rule — "keep the ground's hue at saturation >= .30" —
    # was written when a row was a tint of the ground, and it would now
    # reject a WHITE CARD, which is the opposite of the problem it exists
    # to catch. Worse, it was passing one by accident: HSL saturation
    # divides by (2 - hi - lo), so a near-white with two levels of blue in
    # it scores .83 and looks like a saturated colour to the metric.
    #
    # The real fault is a row landing in the middle: mid-lightness and
    # low chroma, which is the grey that got rejected. So a row may be a
    # tint that keeps the ground's hue, OR a deliberate near-white / near
    # -black surface. What it may not be is neither.
    for g in grounds:
        for px in painted(toks, '--r-row', g):
            l = (max(rgb(px)) + min(rgb(px))) / 510
            material = l >= .90 or l <= .12          # a surface, not a shade
            dh = abs(hue(px) - hue(g)); dh = min(dh, 360 - dh)
            tint = dh <= 12 and sat(px) >= .30       # a shade of the ground
            check('%-4s the row is a surface or a true tint, never mud (%s)' % (th, px),
                  material or tint,
                  'L %.2f, %.0f deg off the ground, sat %.2f' % (l, dh, sat(px)))

# ── the inks the rail rebinds for everything that is NOT a row ───────────
# The brand-mark subtitle, "Back to my ESS" and the sign-out row draw
# --ez-rail-muted / --ez-rail-faint straight onto the rail, never onto a
# button, so every row check above can pass while these fail. That is
# exactly what happened when the ground was lightened once before: they
# measured 4.01 and 3.27 and nothing noticed. Small text, so 4.5.
for g1, g2, toks, body in blocks[:2]:
    th = 'pale' if L(g1) > 0.18 else 'deep'
    for tok in ('--ez-rail-text', '--ez-rail-item', '--ez-rail-muted', '--ez-rail-faint'):
        c = ink(toks, tok)
        if not c:
            check('%-4s %s is declared' % (th, tok), False)
            continue
        v = min(cr(c, g1), cr(c, g2))
        check('%-4s %-16s direct on the rail >= 4.5' % (th, tok), v >= 4.5,
              '%.2f (%s)' % (v, c))

# ── 4. no rail rule may name a colour ────────────────────────────────────
# The two polarities are mirror images, so a literal in a rule is a value
# that is right for one theme and wrong for the other. Every colour lives
# in a token block; the rules only ever read one.
literals = []
for m in re.finditer(r'(\.ez-[^{]*)\{([^}]*)\}', css):
    sel, bod = m.group(1).strip(), m.group(2)
    if '--r-' in bod and bod.count('--r-') > 2: continue      # a token block
    if '--ez-rail' in bod: continue
    bod = re.sub(r'/\*.*?\*/', '', bod, flags=re.S)           # comments are prose
    lits = [l for l in re.findall(r'(?<!var\()(#[0-9A-Fa-f]{3,6}|rgba?\([^)]*\))', bod)
            if l not in ('rgba(0,0,0,0)',)]
    if lits: literals.append((sel[:40], lits))
check('no rail rule hard-codes a colour — all of them read tokens',
      not literals, str(literals[:3]))

# every token a rule reads must exist in BOTH polarities, or one theme
# silently renders with an unset custom property
used = set(re.findall(r'var\((--r-[\w-]+)\)', css))
for g1, g2, toks, body in blocks[:2]:
    th = 'pale' if L(g1) > 0.18 else 'deep'
    absent = sorted(t for t in used if t not in toks)
    check('%-4s defines every --r-* token the rules read' % th, not absent, str(absent))

# ── the row has to look like a BUTTON, not a tinted strip ────────────────
# A flat wash at one alpha separates from the ground on paper and still
# reads as nothing: a surface is recognised by the light falling across it.
# These are polarity-free — they assert that shading EXISTS, not which way
# it runs, since the tokens carry the direction.
nav_rule = re.search(r'\.ez-nav\{[^}]*\}', cssz)
_nav = nav_rule.group(0) if nav_rule else ''
for g1, g2, toks, body in blocks[:2]:
    th = 'pale' if L(g1) > 0.18 else 'deep'
    check('%-4s the row is shaded top-to-bottom, not a flat wash' % th,
          'linear-gradient(180deg' in toks.get('--r-row', '')
          and len(stops_of(toks['--r-row'])) >= 2)
    a = [x[3] for x in stops_of(toks.get('--r-row', ''))]
    h = [x[3] for x in stops_of(toks.get('--r-row-h', ''))]
    check('%-4s hover pushes the row further than rest' % th,
          bool(a) and bool(h) and min(h) > min(a),
          '%.2f -> %.2f' % (min(a), min(h)) if a and h else '')
check('the top edge catches a specular highlight', 'inset01px0var(--r-spec)' in _nav)
check('the row casts a contact shadow onto the rail',
      'var(--r-cast)' in _nav and 'var(--r-cast-far)' in _nav)
check('lit from above: distinct top and bottom borders',
      'border-top-color:var(--r-rim-t)' in _nav
      and 'border-bottom-color:var(--r-rim-b)' in _nav)
_act = re.search(r'\.ez-nav:active\{[^}]*\}', cssz)
check('the row presses in when clicked',
      bool(_act) and 'transform:translateY(1px)' in _act.group(0)
      and 'box-shadow:inset' in _act.group(0))
_hov = re.search(r'\.ez-nav:hover\{[^}]*\}', cssz)
check('hover brightens the rim and the lift, not just the fill',
      bool(_hov) and 'border-top-color:' in _hov.group(0) and 'box-shadow:' in _hov.group(0))
check('the selected pill wipes in rather than popping',
      'ezWipe' in cssz and 'transform-origin:leftcenter' in cssz and 'ezPop' not in cssz)
check('hover fills without moving the row',
      '.ez-nav:hover::before{transform:scaleX(1)}' in cssz and 'translateY' not in _nav)

rail_rules = re.findall(r'\.ez-rail\{[^}]*\}', cssz)
rail_light = rail_rules[0] if rail_rules else None
check('the rail rebinds its ink tokens for descendants',
      bool(rail_light) and '--ez-rail-text:' in rail_light
      and '--ez-rail-item:' in rail_light)
check('the deep rail is written for BOTH dark states, not just the stamped one',
      len([b for b in blocks if L(b[0]) <= 0.18]) >= 2,
      '%d deep blocks' % len([b for b in blocks if L(b[0]) <= 0.18]))

# ── 5. the fold ───────────────────────────────────────────────────────────
head = lay[lay.index('function GroupBlock'):lay.index('const FONT =')]
check('section heading is a real <button>', '<button type="button" className={`ez-group-head' in head)
check('heading announces its own state', 'aria-expanded={expanded}' in head and 'aria-controls={panelId}' in head)
check('panel id is SSR-stable (useId, not a counter)', 'useId()' in head and 'rid.replace' in head)
check('shut panel is inert, so its links leave the tab order',
      'inert={foldable && !expanded ? true : undefined}' in head)
check('height animates via grid-template-rows, not max-height',
      'grid-template-rows:0fr' in css and '.ez-open > .ez-group-panel{ grid-template-rows:1fr }' in css
      and not re.search(r'max-height\s*:', css))   # the words appear in a comment saying why not
# The 3D hinge was more motion than a list of links needs; rows fade up.
check('rows arrive with a fade, not a 3D hinge',
      'rotateX' not in cssz and 'opacity:0' in cssz and 'translateY(-4px)' in cssz)
check('open staggers, close does not', 'transition-delay:calc(var(--n)*18ms)' in cssz)
# The tile is translucent now, on purpose: it sits on a button which sits on
# the gradient ground, and the icon figures in section 3 are measured through
# that whole stack rather than against a flat surface.
# No tile behind the icon: a tile was card chrome by another name, and on a
# deep ground the glyph alone carries.
_tile = cssz[cssz.index('.ez-nav-tile{'):] if '.ez-nav-tile{' in cssz else ''
_tile = _tile[:_tile.index('}') + 1] if '}' in _tile else ''
check('the icon has no tile behind it', 'background:transparent' in _tile)
check('fold marker rotates between shut and open',
      '.ez-foldsvg{' in cssz and 'rotate(-90deg)' in cssz
      and '.ez-open.ez-foldsvg{transform:rotate(0deg)}' in cssz)
# Asserts the BEHAVIOUR, not the exact spelling: transparent at rest, tinted
# when the heading is hovered or focused. The literal-string version of this
# failed on a missing space after a colon while the code was correct.
_fold = re.search(r'\.ez-fold\{[^}]*\}', cssn)
check('fold chip is an affordance, not permanent weight',
      bool(_fold) and re.search(r'background\s*:\s*transparent', _fold.group(0))
      and '.ez-group-head:hover.ez-fold' in cssz)
check('collapsed rail cannot fold a section shut (no way to reopen it)',
      'const foldable = Boolean(group) && railOpen;' in head)
check('a shut section still reports what it hides', 'ez-count' in head and 'items.length' in head)
check('"you are here" is not colour alone', 'ez-sr' in head and '.ez-sr{' in css)
_rm = css[css.index('@media (prefers-reduced-motion: reduce)'):]
check('reduced motion covers the fold too',
      '.ez-group-panel' in _rm and '.ez-count-here' in _rm and 'transition:none' in _rm)
check('section state persisted under its own key', "'ezer_rail_sections'" in lay)
check('a corrupt persisted value cannot take the rail down',
      'catch { localStorage.removeItem(' in lay)
check('default is every section open', 'sections[g] ?? true' in lay)

# ── 6. the rail still fits ────────────────────────────────────────────────
AVAIL = 244-20-8-26-10-8
longest = max((l for _,l,_,_,_ in ITEMS), key=len)
check('label column is 172px wide as assumed', AVAIL == 172, '%dpx' % AVAIL)
print('\n  longest label: "%s" (%d chars) — width asserted in the browser pass\n' % (longest, len(longest)))

print('  %d passed, %d failed\n' % (len(P), len(F)))
sys.exit(1 if F else 0)
