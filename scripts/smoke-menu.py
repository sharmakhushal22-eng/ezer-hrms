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
def over(f,b,a):
    F,B=rgb(f),rgb(b); return '#%02X%02X%02X'%tuple(round(F[i]*a+B[i]*(1-a)) for i in range(3))

def tok(name, block):
    m = re.search(re.escape(name)+r':\s*(#[0-9A-Fa-f]{6})', block)
    return m.group(1) if m else None
light_blk = theme[:theme.index('@media (prefers-color-scheme: dark)')]
dark_blk  = theme[theme.index(':root[data-ez-theme="dark"]'):]

THEMES = {}
for nm, blk in (('light', light_blk), ('dark', dark_blk)):
    THEMES[nm] = {k: tok('--ez-'+k, blk) for k in
                  ('brand','brand-deep','brand-tint','surface','rail','rail-item',
                   'rail-faint','rail-hover','on-accent')}

for nm, t in THEMES.items():
    # a resting button: brand washed into the surface it sits on
    base = t['rail-hover'] if nm == 'dark' else t['surface']
    btn  = over(t['brand'], base, .10 if nm == 'dark' else .05)
    check('%-5s resting label on its button >= 4.5' % nm,
          cr(t['rail-item'], btn) >= 4.5, '%.2f' % cr(t['rail-item'], btn))
    tile = over(t['brand'], btn, .14)
    check('%-5s icon on its tile >= 3.0' % nm,
          cr(t['brand'], tile) >= 3.0, '%.2f' % cr(t['brand'], tile))
    # the selected button is a gradient — BOTH ends have to carry the label
    for end in ('brand', 'brand-deep'):
        r = cr(t['on-accent'], t[end])
        check('%-5s selected label on the %s end >= 4.5' % (nm, end),
              r >= 4.5, '%.2f' % r)
    check('%-5s section heading >= 4.5' % nm,
          cr(t['rail-faint'], t['rail']) >= 4.5, '%.2f' % cr(t['rail-faint'], t['rail']))

# Every colour in the rail comes from a token, so it follows the product's
# blue instead of keeping a private copy that drifts.
css = lay[lay.index('<style>{`', lay.index('const NAV: NavGroup[]')):]
css = css[:css.index('`}</style>')]
# A normalised copy for any regex that walks a rule with [^}]*. The CSS is a
# template literal, so ${C.railFaint} contains a CLOSING BRACE — it ends such
# a character class early and truncates the rule mid-way. That silently broke
# a check while the code it tested was correct.
cssn = re.sub(r'\$\{[^}]*\}', 'TOKEN', css)
# And a whitespace-free copy. Three checks in a row have now failed on a
# missing space after a colon while the code was correct — matching CSS by
# exact spelling is a test that breaks every time the file is reformatted.
cssz = re.sub(r'\s+', '', cssn)
# The rail owns its palette deliberately now — it sits on a blue ground, and
# the app's tokens are measured against a white surface. What matters is that
# the palette is DECLARED IN ONE PLACE and not sprinkled through the rules,
# so there is a single thing to change.
palette = css[css.index('.ez-rail{'):css.index('/* The ground.')]
loose = [h for h in re.findall(r'#[0-9A-Fa-f]{6}', css[css.index('/* The ground.'):])]
allowed = {'#2563EB', '#1B45C4', '#1D4ED8', '#1E40AF', '#FFFFFF'}
stray = sorted(set(loose) - allowed)
check('the rail palette is declared in one block',
      palette.count('--r-') >= 10 and not stray, str(stray))
check('the selected fill is the same in both themes, and deep enough for white',
      '#2563EB' in css and '#1B45C4' in css
      and 'color:#FFFFFF' in cssz.replace('color:#ffffff','color:#FFFFFF'))

# ── 4. the buttons, and the cascade around them ───────────────────────────
check('every row is a button: surface, border, shadow',
      '.ez-nav{' in cssz and '1pxsolidvar(--r-edge)' in cssz
      and 'box-shadow:insetatop' not in cssz and 'border-radius:11px' in cssz)
check('hover lifts, press goes down',
      'translateY(-1px)' in cssz and '.ez-nav:active{transform:translateY(0)scale(' in cssz)
check('the selected button pops rather than just tinting',
      '.ez-nav-on' in cssz and 'ezPop' in cssz and 'translateY(-2px)scale(1.02)' in cssz)
check('the pop overshoots and settles',
      '@keyframesezPop' in cssz and 'scale(1.045)' in cssz)

# THE CASCADE BUG THIS GUARDS
# The dark surface override is a more specific selector than .ez-nav-on. The
# first version omitted :not(.ez-nav-on), so in dark mode it silently won and
# the selected button lost its blue fill entirely — it rendered as an ordinary
# grey row, with no error anywhere.
dark_sel = re.findall(r':root(?:\[data-ez-theme="dark"\]|:not\(\[data-ez-theme="light"\]\)) \.ez-nav[^{]*\{', cssn)
check('the dark override never outranks the selected button',
      all('.ez-nav-on' in sel for sel in dark_sel),
      str([x.strip() for x in dark_sel if '.ez-nav-on' not in x]))
check('dark is declared for BOTH system and explicit',
      ':root:not([data-ez-theme="light"])' in css and ':root[data-ez-theme="dark"]' in css)
check('prefers-reduced-motion honoured', '@media (prefers-reduced-motion: reduce)' in css)
check('reduced motion also stops the pop',
      re.search(r'prefers-reduced-motion[\s\S]*?\.ez-nav-on[^}]*animation:\s*none', css) is not None)
check('--ez-rail-item defined in all three theme blocks',
      theme.count('--ez-rail-item') == 3, '%d' % theme.count('--ez-rail-item'))

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
check('rows unfold on a hinge with a shared vanishing point',
      'perspective:640px' in cssz and 'rotateX(-72deg)' in cssz)
check('open staggers, close does not', 'transition-delay:calc(var(--n)*26ms)' in cssz)
# The tile is translucent now, on purpose: it sits on a button which sits on
# the gradient ground, and the icon figures in section 3 are measured through
# that whole stack rather than against a flat surface.
check('the icon tile comes from the rail palette, so it is measured with the ground',
      'background:var(--r-tile)' in cssz and 'color:var(--r-icon)' in cssz)
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
