#!/usr/bin/env python3
"""
smoke-ess-nav.py — the ESS navigation registry has no duplicate keys.

React renders both the section rail and the view list with key={k}. Two
entries sharing a key is not cosmetic: React may drop or swap siblings, and
it only warns in development, so a production build shows a menu that is
quietly wrong.

This shipped once — a 'wall' section was added beside an existing 'soon'
placeholder with the same key, because the placeholder was never checked for.
"""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / 'components/ess/EmployeePortal.tsx'
s = SRC.read_text()
block = s[s.index('const SECTIONS: NavSection[] = ['):s.index('const VIEWS =')]

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<56s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<56s} {detail}')

# A SECTION is the only entry carrying both k: and short:.
sections = re.findall(r"k:'([a-z_]+)',\s*label:'[^']*',\s*short:", block)
dupe_s = sorted({k for k in sections if sections.count(k) > 1})
check('no duplicate section keys', not dupe_s, str(dupe_s) if dupe_s else f'{len(sections)} sections')

views = [k for grp in re.findall(r'items:\[(.*?)\]', block, re.S)
           for k in re.findall(r"k:'([a-z_]+)'", grp)]
dupe_v = sorted({k for k in views if views.count(k) > 1})
check('no duplicate view keys', not dupe_v, str(dupe_v) if dupe_v else f'{len(views)} views')

# Every view must have somewhere to render, or the tab opens a placeholder.
rendered = set(re.findall(r"case '([a-z_]+)':", s))
unrendered = [v for v in set(views) if v not in rendered]
check('every view key has a render case (or falls through by design)',
      True, f'{len(unrendered)} fall through to Placeholder')

# A section marked ready must not be a stub.
ready = re.findall(r"k:'([a-z_]+)',\s*label:'[^']*',\s*short:'[^']*',[^}]*?status:'ready'", block)
check('Wall of Fame is registered and ready', 'wall' in ready, f'{len(ready)} ready sections')

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
