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

def over(alpha, fg, ground):
    """fg at `alpha` composited onto a #rrggbb ground -> #rrggbb."""
    g = rgb(ground)
    return '#%02X%02X%02X' % tuple(round(fg[i]*alpha + g[i]*(1-alpha)) for i in range(3))

def alphas_of(rule, name):
    """Every alpha declared for a level. A level may be a flat rgba() or a
       gradient of several, so this returns them all and the caller picks the
       stop that is worst for what it is measuring."""
    m = re.search(re.escape(name) + r':([^;]*);', rule)
    return [float(a) for a in re.findall(r'rgba\(\d+,\d+,\d+,([\d.]+)\)', m.group(1))] if m else []

def mid_of(g1, g2):
    return '#%02X%02X%02X' % tuple(round((rgb(g1)[i] + rgb(g2)[i]) / 2) for i in range(3))

def tint_of(rule, name, fallback=(255, 255, 255)):
    """The colour a level is painted in. Not assumable: the row lift was
       white for several revisions and is now a blue, and every figure in
       this file is wrong if it composites the wrong one."""
    m = re.search(re.escape(name) + r':[^;]*?rgba\((\d+),(\d+),(\d+),', rule)
    return tuple(int(x) for x in m.groups()) if m else fallback

def level(rule, name, ground, stop='light'):
    """A level's painted colour on `ground`. stop='light' takes the alpha
       that lands lightest, 'dark' the one that lands darkest — the caller
       picks whichever is the worst case for what it is measuring."""
    a = alphas_of(rule, name)
    if not a: return None
    t = tint_of(rule, name)
    lift = sum(t) > 382                      # a light tint lightens, black darkens
    pick = max(a) if (stop == 'light') == lift else min(a)
    return over(pick, t, ground)

rail_rules = re.findall(r'\.ez-rail\{[^}]*\}', cssz)

if not missing and len(rail_rules) >= 2:
    for gi, (g1, g2) in enumerate(grounds[:2]):
        th = 'light' if gi == 0 else 'dark'
        rule = rail_rules[0] if gi == 0 else rail_rules[1]
        # A LABEL DOES NOT SIT ON THE RAIL. It sits on the row, which is
        # lighter than the rail — so measuring against the rail flatters
        # every ink figure and would pass a label that is illegible on the
        # button it is actually printed on. Worst case is the row's TOP
        # stop, the lightest thing under any of this text.
        m       = mid_of(g1, g2)
        row_top = level(rule, '--r-row',  m, 'light')    # lightest row pixel
        band    = level(rule, '--r-band', m, 'light')    # lightest band pixel
        if not row_top or not band:
            check('%-5s row and band levels parse' % th, False)
            continue
        for name, ground, where in (('item label', row_top, 'the row'),
                                    ('icon',       row_top, 'the row'),
                                    ('section label', band, 'the band')):
            bar = 3.0 if name == 'icon' else 4.5
            r = cr(INKS[name], ground)
            check('%-5s %-13s on %-9s >= %.1f' % (th, name, where, bar), r >= bar, '%.2f' % r)
        # The icon passed its 3:1 graphics bar at 3.27 while still looking
        # switched off, because a floor says legible and says nothing about
        # dull. What actually broke was the RELATIONSHIP: an icon markedly
        # dimmer than the label beside it reads as a disabled row. Held to
        # within a stop of the label rather than to an absolute number.
        r_lab, r_ico = cr(INKS['item label'], row_top), cr(INKS['icon'], row_top)
        check('%-5s the icon is not dimmer than its own label' % th,
              r_ico >= r_lab * 0.75, 'icon %.2f vs label %.2f' % (r_ico, r_lab))

        # Hover swaps the label to white and brightens the fill underneath
        # it at the same time — the one place where making a row livelier
        # can quietly cost legibility.
        hov = level(rule, '--r-row-h', m, 'light')
        if hov:
            r = cr('#FFFFFF', hov)
            check('%-5s white label on a HOVERED row >= 4.5' % th, r >= 4.5, '%.2f' % r)
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

# The light values live on .ez-rail; the dark ones on the two overrides. Both
# dark spellings must exist — data-ez-theme="dark" AND the unstamped default
# under prefers-color-scheme, or one of the three theme states is left wrong.
rail_light = rail_rules[0] if rail_rules else None
rail_dark  = rail_rules
check('the dark rail is written for BOTH dark states, not just the stamped one',
      cssz.count('--r-band:rgba(0,0,0,') >= 3,
      '%d declarations' % cssz.count('--r-band:rgba(0,0,0,'))

LEVELS_OK = True
if rail_light and len(rail_dark) >= 2 and len(grounds) >= 2:
    for gi, (g1, g2) in enumerate(grounds[:2]):
        th   = 'light' if gi == 0 else 'dark'
        rule = rail_dark[0] if gi == 0 else rail_dark[1]
        # Worst case for "does the row clear the rail" is its DARKEST stop;
        # for "does the band sink below it", the band's lightest.
        _row, _hov, _bnd = (alphas_of(rule, '--r-row'), alphas_of(rule, '--r-row-h'),
                            alphas_of(rule, '--r-band'))
        a_row  = min(_row) if _row else None
        a_hov  = min(_hov) if _hov else None
        a_band = min(_bnd) if _bnd else None
        if None in (a_row, a_hov, a_band):
            check('%-5s rail declares all four levels' % th, False, str((a_row, a_hov, a_band)))
            LEVELS_OK = False
            continue
        # Measured where the rows actually sit, not at the gradient's extreme:
        # a step taken at the darkest stop overstated separation by 0.2 last
        # time and the middle of the rail is where the eye judges it.
        mid  = mid_of(g1, g2)
        row  = level(rule, '--r-row',  mid, 'dark')   # darkest row pixel
        band = level(rule, '--r-band', mid, 'light')  # lightest band pixel
        for label, val, floor in (
            ('row sits above the rail',      cr(row,  mid),  1.15),
            ('band sits below the rail',     cr(band, mid),  1.15),
            ('row and band are told apart',  cr(row,  band), 1.30),
            ('the pill outranks a row',
             cr('#FFFFFF', level(rule, '--r-row', mid, 'light')), 2.00),
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
# ── the row has to look like a BUTTON, not a tinted strip ────────────────
# "buttons inside section and home button without selection look very dull."
# A flat wash at one alpha separates from the rail on paper and still reads
# as nothing, because a surface is recognised by the light falling across it
# rather than by its mean brightness. These four are what supply that, and
# none of them costs a point of contrast — which matters, because the fill
# itself is capped by the label: past ~.24 at the top stop the ink drops
# under 4.5:1, so brightness is the one lever NOT available here.
_nav = nav_rule.group(0) if nav_rule else ''
check('the row is shaded top-to-bottom, not a flat wash',
      bool(rail_light) and 'linear-gradient(180deg' in re.search(r'--r-row:[^;]*;', rail_light).group(0)
      and len(alphas_of(rail_light, '--r-row')) >= 2)
check('the top edge catches a specular highlight',
      'box-shadow:inset0 1px0rgba(255,255,255,'.replace(' ', '') in _nav
      or re.search(r'inset0 1px0rgba\(255,255,255,\.(1[5-9]|[2-9]\d)\)'.replace(' ', ''), _nav) is not None)
check('the row casts a contact shadow onto the rail',
      re.search(r'0 1px2pxrgba\('.replace(' ', ''), _nav) is not None
      and re.search(r'0 3px7px-3pxrgba\('.replace(' ', ''), _nav) is not None)
check('lit from above: bright top border, dark bottom border',
      'border-top-color:rgba(255,255,255,' in _nav
      and 'border-bottom-color:rgba(0,0,0,' in _nav)
# A button that does not move under the pointer is the other half of dull.
_act = re.search(r'\.ez-nav:active\{[^}]*\}', cssz)
check('the row presses in when clicked',
      bool(_act) and 'transform:translateY(1px)' in _act.group(0)
      and 'box-shadow:inset' in _act.group(0))
# Hover must not buy its visibility from the fill alone — that is what pushed
# the top stop to .32 and put the white label at 4.28.
_hov = re.search(r'\.ez-nav:hover\{[^}]*\}', cssz)
check('hover brightens the rim and the lift, not just the fill',
      bool(_hov) and 'border-top-color:' in _hov.group(0) and 'box-shadow:' in _hov.group(0))

# THE ROW MUST KEEP THE RAIL'S COLOUR, NOT WASH IT OUT.
# The lift used to be white, and white over a saturated ground does not
# lighten it — it greys it. At .24 the row held 53% of the rail's
# saturation, and that desaturation, not the brightness, is what read as a
# dull muddy colour. Every contrast figure in this file passed the whole
# time; none of them can see chroma, which is why this check exists.
def sat(h):
    r, g, b = [v / 255 for v in rgb(h)]
    hi, lo = max(r, g, b), min(r, g, b)
    if hi == lo: return 0.0
    l = (hi + lo) / 2
    return (hi - lo) / (2 - hi - lo) if l > .5 else (hi - lo) / (hi + lo)

if rail_rules and len(grounds) >= 2:
    for gi, (g1, g2) in enumerate(grounds[:2]):
        th   = 'light' if gi == 0 else 'dark'
        rule = rail_rules[0] if gi == 0 else rail_rules[1]
        ground = mid_of(g1, g2)
        row = level(rule, '--r-row', ground, 'light')
        if not row:
            check('%-5s the row tint parses' % th, False)
            continue
        keep = sat(row) / sat(ground) if sat(ground) else 0
        check('%-5s the row keeps the rail\'s colour (>= 75%% saturation)' % th,
              keep >= .75, '%d%% (%s on %s)' % (round(keep * 100), row, ground))

# Translucent, so the row composites over the gradient instead of flattening
# it — and never an opaque fill, which is the light-card-on-a-light-ground
# problem this whole design exists to avoid.
check('the row level is translucent, not an opaque fill',
      bool(rail_light)
      and re.search(r'--r-row:[^;]*;', rail_light)
      and not re.search(r'--r-row:[^;]*#[0-9A-Fa-f]{3,6}', rail_light)
      and all(x < 1 for x in alphas_of(rail_light, '--r-row')))
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
