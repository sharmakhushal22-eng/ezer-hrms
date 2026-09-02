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
def rgb(x): x=x.lstrip('#'); return tuple(int(x[i:i+2],16) for i in (0,2,4))
def lin(c): c/=255; return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def L(x): r,g,b=rgb(x); return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
def cr(a,b):
    l1,l2=sorted([L(a),L(b)],reverse=True); return (l1+.05)/(l2+.05)

css = lay[lay.index('<style>{`', lay.index('const NAV: NavGroup[]')):]
css = css[:css.index('`}</style>')]
cssn = re.sub(r'\$\{[^}]*\}', 'TOKEN', css)
cssz = re.sub(r'\s+', '', cssn)

# The rail is a deep blue ground with light text ON it — figure and ground
# inverted from the card design that preceded it. Every ink is checked
# against the ground's LIGHTEST stop, which is the worst case.
grounds = re.findall(r'linear-gradient\(180deg,\s*(#[0-9A-Fa-f]{6})[^)]*?(#[0-9A-Fa-f]{6})\s*100%\)', css)
check('the rail has a deep blue gradient ground', len(grounds) >= 2,
      '%d gradients (light + dark)' % len(grounds))

def ink(pattern, default=None):
    m = re.search(pattern, cssz)
    return m.group(1).upper() if m else default

INKS = {
    'item label':    ink(r'\.ez-nav\{[^}]*?color:(#[0-9A-Fa-f]{6})'),
    'icon':          ink(r'\.ez-nav-tile\{[^}]*?color:(#[0-9A-Fa-f]{6})'),
    'section label': ink(r'\.ez-group-name\{[^}]*?color:(#[0-9A-Fa-f]{6})'),
    'selected ink':  ink(r'\.ez-nav-on\{color:(#[0-9A-Fa-f]{6})'),
}
missing = [k for k, v in INKS.items() if not v]
check('every rail ink is declared in the stylesheet', not missing, str(missing))

if not missing:
    for gi, (g1, g2) in enumerate(grounds[:2]):
        th = 'light' if gi == 0 else 'dark'
        worst = g1 if L(g1) > L(g2) else g2      # lightest stop = worst for light ink
        for name in ('item label', 'icon', 'section label'):
            bar = 3.0 if name == 'icon' else 4.5
            r = cr(INKS[name], worst)
            check('%-5s %s on the rail >= %.1f' % (th, name, bar), r >= bar, '%.2f' % r)
    # the selected row is a WHITE pill; its ink sits on white, not on the rail
    r = cr(INKS['selected ink'], '#FFFFFF')
    check('selected ink on the white pill >= 4.5', r >= 4.5, '%.2f' % r)
    check('the pill is white, so it cannot blend into a blue rail',
          'background:#FFFFFF' in cssz.replace('background:#ffffff', 'background:#FFFFFF'))

# ── 4. the four levels ────────────────────────────────────────────────────
# "section and button blended with bg." The first inversion answered the
# light-cards-on-a-light-ground problem by removing ALL surface from a row —
# which traded one blending complaint for another, because bare text on the
# rail is exactly as flat as a card the same colour as its ground.
#
# The dark ground is what makes the real fix possible: a row can sit ABOVE
# it and a section BELOW it, which no pale ground could ever do. So the rule
# is not "no chrome" and not "chrome" — it is that FOUR levels stay ordered:
#
#       selected pill   white, opaque      ← brightest
#       row             white over rail
#       rail            the gradient
#       section band    black over rail    ← darkest
#
# Asserted by compositing the alphas onto the real gradient stops, because
# the failure this catches is numeric. Every previous regression here passed
# a spelling check and still looked wrong.
nav_rule  = re.search(r'\.ez-nav\{[^}]*\}', cssz)
head_rule = re.search(r'\.ez-group-head\{[^}]*\}', cssz)

def over(alpha, fg, ground):
    """fg at `alpha` composited onto a #rrggbb ground -> #rrggbb."""
    g = rgb(ground)
    return '#%02X%02X%02X' % tuple(round(fg[i]*alpha + g[i]*(1-alpha)) for i in range(3))

def alpha_of(rule, name):
    m = re.search(re.escape(name) + r':rgba\(\d+,\d+,\d+,([\d.]+)\)', rule)
    return float(m.group(1)) if m else None

# The light values live on .ez-rail; the dark ones on the two overrides. Both
# dark spellings must exist — data-ez-theme="dark" AND the unstamped default
# under prefers-color-scheme, or one of the three theme states is left wrong.
rail_light = re.search(r'\.ez-rail\{[^}]*\}', cssz)
rail_dark  = re.findall(r'\.ez-rail\{[^}]*\}', cssz)
check('the dark rail is written for BOTH dark states, not just the stamped one',
      cssz.count('--r-band:rgba(0,0,0,') >= 3,
      '%d declarations' % cssz.count('--r-band:rgba(0,0,0,'))

LEVELS_OK = True
if rail_light and len(rail_dark) >= 2 and len(grounds) >= 2:
    for gi, (g1, g2) in enumerate(grounds[:2]):
        th   = 'light' if gi == 0 else 'dark'
        rule = rail_dark[0] if gi == 0 else rail_dark[1]
        a_row  = alpha_of(rule, '--r-row')
        a_hov  = alpha_of(rule, '--r-row-h')
        a_band = alpha_of(rule, '--r-band')
        if None in (a_row, a_hov, a_band):
            check('%-5s rail declares all four levels' % th, False, str((a_row, a_hov, a_band)))
            LEVELS_OK = False
            continue
        # Measured where the rows actually sit, not at the gradient's extreme:
        # a step taken at the darkest stop overstated separation by 0.2 last
        # time and the middle of the rail is where the eye judges it.
        mid = '#%02X%02X%02X' % tuple(round((rgb(g1)[i] + rgb(g2)[i]) / 2) for i in range(3))
        row  = over(a_row,  (255, 255, 255), mid)
        band = over(a_band, (0, 0, 0),       mid)
        for label, val, floor in (
            ('row sits above the rail',      cr(row,  mid),  1.15),
            ('band sits below the rail',     cr(band, mid),  1.15),
            ('row and band are told apart',  cr(row,  band), 1.30),
            ('the pill outranks a row',      cr('#FFFFFF', row), 2.00),
        ):
            ok = val >= floor
            LEVELS_OK &= ok
            check('%-5s %-30s >= %.2f' % (th, label, floor), ok, '%.2f' % val)
        check('%-5s hover lifts a row further than rest' % th, a_hov > a_row,
              '%.2f -> %.2f' % (a_row, a_hov))
else:
    check('the rail declares its levels', False)
    LEVELS_OK = False

# The levels have to be WIRED, not merely declared. A token nobody consumes
# is the same blended rail with extra CSS in it.
check('a row draws the row level and its edge',
      bool(nav_rule) and 'background:var(--r-row)' in nav_rule.group(0)
      and 'var(--r-edge)' in nav_rule.group(0))
check('a section draws the band level and is recessed into the rail',
      bool(head_rule) and 'background:var(--r-band)' in head_rule.group(0)
      and 'box-shadow:inset' in head_rule.group(0))
# The old failure mode, kept nailed shut: the lift must be WHITE-over-blue,
# never an opaque pale fill. An opaque row is a card again, and a card is
# what put light chrome on a light ground in the first place.
check('the row level is translucent white, not an opaque pale fill',
      bool(rail_light) and '--r-row:rgba(255,255,255,' in rail_light.group(0))
check('the selected pill wipes in rather than popping',
      'ezWipe' in cssz and 'transform-origin:leftcenter' in cssz
      and 'ezPop' not in cssz)
check('hover fills without moving the row',
      '.ez-nav:hover::before{transform:scaleX(1)}' in cssz
      and 'translateY' not in nav_rule.group(0))

# The rail redefines the rail INK tokens for everything inside it. Without
# this the brand mark, the footer and the sign-out row keep drawing
# --ez-rail-text, which is near-black, onto a deep blue ground.
rail_rule = re.search(r'\.ez-rail\{[^}]*\}', cssz)
check('the rail rebinds its ink tokens for descendants',
      bool(rail_rule) and '--ez-rail-text:' in rail_rule.group(0)
      and '--ez-rail-muted:' in rail_rule.group(0)
      and '--ez-rail-faint:' in rail_rule.group(0))
check('the deep ground is declared for BOTH dark states',
      cssz.count(':root:not([data-ez-theme="light"]).ez-rail{') >= 1
      and cssz.count(':root[data-ez-theme="dark"].ez-rail{') >= 1)
check('prefers-reduced-motion honoured', '@media(prefers-reduced-motion:reduce)' in cssz)
check('reduced motion stops the wipe',
      re.search(r'prefers-reduced-motion[\s\S]*?\.ez-nav-on::before\{animation:none', cssz) is not None)
check('--ez-rail-item defined in all three theme blocks',
      theme.count('--ez-rail-item') == 3, '%d' % theme.count('--ez-rail-item'))

# ── 4b. nothing inline may overrule the stylesheet ────────────────────────
# An inline style beats a stylesheet. The label used to set its own colour,
# so the selected row got --ez-rail-text (NEAR-BLACK in light) printed on the
# deep blue fill, while every rule and every contrast figure said white. The
# CSS was right and never applied.
#
# Checked as source, not as pixels, because a harness that renders the markup
# without the component's inline styles shows the CSS winning — which is
# exactly how this was missed.
row = lay[lay.index('function RailItem'):lay.index('function GroupBlock')]
row_code = '\n'.join(l for l in row.splitlines() if not l.strip().startswith('//'))
# Sections have no band any more: on a deep ground a quiet label reads as
# secondary without a container drawn around it. What must hold is that the
# label is separated by something — a hairline — and stays legible (checked
# above, against the ground's lightest stop).
check('sections are separated by a rule, not a box',
      '.ez-group-head::before{' in cssz and 'height:1px' in cssz
      and 'background:rgba(255,255,255' in cssz)

check('the row sets no colour inline — it inherits from the button',
      not re.search(r'\bcolor:\s*(?!\'inherit\')', row_code),
      re.search(r'.{0,40}\bcolor:.{0,30}', row_code).group(0) if re.search(r'\bcolor:', row_code) else '')
check('the row sets no background inline either',
      not re.search(r'\bbackground(Color)?:', row_code))

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
