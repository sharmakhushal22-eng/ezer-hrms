#!/usr/bin/env python3
"""Smoke test for the company profile.  Run:  python3 scripts/smoke-company-profile.py

Re-derives what the screen rests on from components/company/*, the page, and
lib/company/authz.ts, rather than trusting the comments in them:

  · the section list, its accents and its tab blocks agree with each other
  · Documents and Policies are gone from every place they existed, not just
    the tab bar — a half-removed section renders as an empty pane
  · every accent clears contrast on the card surface in both themes
  · the write path is gated server-side before every verb

Not covered here (needs a browser and a dev server): the rendered page, the
ten tabs actually opening, console errors, theme states. Those run separately.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEC  = (ROOT/'components/company/Sections.tsx').read_text()
UI   = (ROOT/'components/company/ui.ts').read_text()
PAGE = (ROOT/'app/dashboard/company-profile/page.tsx').read_text()
AUTH = (ROOT/'lib/company/authz.ts').read_text()
API  = (ROOT/'app/api/company/profile/route.ts').read_text()
DATA = (ROOT/'lib/supabase-company-profile.ts').read_text()

P, F = [], []
def check(name, ok, detail=''):
    (P if ok else F).append(name)
    print('  %s %-56s %s' % ('PASS' if ok else 'FAIL', name, detail))

# ── the section list ──────────────────────────────────────────────────────
tabs = re.findall(r"\{ id: '(\w+)',\s*label: '([^']+)' \}", SEC)
ids  = [t[0] for t in tabs]
print('\n  sections: %s\n' % ', '.join(ids))
check('ten sections', len(ids) == 10, '%d found' % len(ids))
check('no duplicate ids', len(set(ids)) == len(ids))

blocks = set(re.findall(r"\{tab === '(\w+)' &&", SEC))
check('every section has a tab block', set(ids) <= blocks,
      str(sorted(set(ids) - blocks)) if set(ids) - blocks else '')
check('no tab block without a section', blocks <= set(ids),
      str(sorted(blocks - set(ids))) if blocks - set(ids) else '')

# Scoped to the ACCENT object. Scraping the whole file picked up a `color:`
# property from an unrelated style and reported it as a section with 1:1
# contrast — a test failing on something that is not a section.
_acc = UI[UI.index('export const ACCENT'):]
_acc = _acc[:_acc.index('\n}')]
accents = dict(re.findall(r"^\s*(\w+):\s*'(#[0-9A-Fa-f]{6})',", _acc, re.M))
check('every section has an accent', set(ids) <= set(accents),
      str(sorted(set(ids) - set(accents))) if set(ids) - set(accents) else '')
check('no orphan accents', set(accents) <= set(ids) | {'basic'},
      str(sorted(set(accents) - set(ids))) if set(accents) - set(ids) else '')

# ── the two removed sections, gone everywhere ─────────────────────────────
# A section removed from the tab bar but left in the completeness switch or
# the accent map renders as a pane nobody can reach; removed from the render
# but left in the tab bar renders as an empty pane. Both are checked.
GONE = ['documents', 'policy']
where = {
    'the tab list':        [i for i in GONE if i in ids],
    'the tab blocks':      [i for i in GONE if i in blocks],
    'the accent map':      [i for i in GONE if i in accents],
    'the completeness switch': [i for i in GONE if ("case '%s':" % i) in SEC],
}
for place, found in where.items():
    check('removed sections are not in %s' % place, not found, str(found))
check('the policy bundle is not imported by Sections', 'PolicyBundle' not in SEC)
check('the policy bundle is not loaded by the page', 'loadPolicyBundle' not in PAGE)
check('DOC_TYPES is not imported by Sections', 'DOC_TYPES' not in SEC)

# the loader is kept on purpose — so it must SAY so, or it reads as dead code
check('the now-callerless loader is documented as such',
      'NO CALLERS' in DATA and 'loadPolicyBundle' in DATA)

# ── contrast, recomputed ──────────────────────────────────────────────────
def rgb(x): x=x.lstrip('#'); return tuple(int(x[i:i+2],16) for i in (0,2,4))
def lin(c): c/=255; return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def L(x): r,g,b=rgb(x); return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
def cr(a,b):
    l1,l2=sorted([L(a),L(b)],reverse=True); return (l1+.05)/(l2+.05)
SURF_L, SURF_D = '#FFFFFF', '#171B21'
# The accents are used as a dot and as a selected-tab fill, i.e. as graphics
# and as a background behind white — 3:1 is the bar for both.
weak = [(k, round(cr(v, SURF_L),2)) for k, v in accents.items() if cr(v, SURF_L) < 3.0]
check('every accent >= 3:1 on the light card', not weak, str(weak))
weak_w = [(k, round(cr('#FFFFFF', v),2)) for k, v in accents.items() if cr('#FFFFFF', v) < 3.0]
check('white label >= 3:1 on a selected tab', not weak_w, str(weak_w))

# ── the gender chips ──────────────────────────────────────────────────────
# These print a coloured label on a 12% tint of the same colour. Using the
# slice colour directly measured 4.37 / 3.84 / 2.33 on white and worse on the
# dark card — the label is 11px semibold, so the bar is 4.5.
GS = (ROOT/'components/company/GenderSplit.tsx').read_text()
_sl = GS[GS.index('const SLICE'):]; _sl = _sl[:_sl.index('}')]
SLICE = dict(re.findall(r"(\w+):\s*'(#[0-9A-Fa-f]{6})'", _sl))
_ik = GS[GS.index('const INK'):]; _ik = _ik[:_ik.index('\n}')]
INKS = dict(re.findall(r"(\w+):\s*\{ l: '(#[0-9A-Fa-f]{6})', d: '(#[0-9A-Fa-f]{6})' \}",
                       _ik.replace("'", "'")) and
            [(m[0], (m[1], m[2])) for m in
             re.findall(r"(\w+):\s*\{ l: '(#[0-9A-Fa-f]{6})', d: '(#[0-9A-Fa-f]{6})' \}", _ik)])
def over(f, b, a):
    F, B = rgb(f), rgb(b)
    return '#%02X%02X%02X' % tuple(round(F[i]*a + B[i]*(1-a)) for i in range(3))
check('every gender has its own label ink', set(INKS) == set(SLICE),
      str(set(SLICE) ^ set(INKS)) if set(SLICE) ^ set(INKS) else '')
weak_g = []
for k, (il, idk) in INKS.items():
    if cr(il, over(SLICE[k], SURF_L, .12)) < 4.5: weak_g.append((k, 'light'))
    if cr(idk, over(SLICE[k], SURF_D, .12)) < 4.5: weak_g.append((k, 'dark'))
check('gender chip label >= 4.5:1 on its own tint, both themes', not weak_g, str(weak_g))
check('the chip label does not use the slice colour as text',
      "color: 'var(--gi)'" in GS and "color: SLICE[k]" not in GS)
check('the chip ink switches in all three theme states',
      GS.count('.cp-gi{') >= 1 and ':root:not([data-ez-theme="light"]) .cp-gi' in GS
      and ':root[data-ez-theme="dark"]  .cp-gi' in GS)

# ── the write path ────────────────────────────────────────────────────────
check('edit roles are a closed list', 'COMPANY_EDIT_ROLES' in AUTH and 'as const' in AUTH)
check('identity columns are immutable', 'IMMUTABLE' in AUTH and "'id'" in AUTH)
verbs = re.findall(r'export async function (GET|POST|PATCH|DELETE)', API)
ungated = [v for v in verbs
           if 'grantForRequest' not in API.split('export async function %s' % v)[1].split('export async function')[0]]
check('every API verb resolves the grant first', not ungated,
      'ungated: %s' % ungated if ungated else '%d verbs' % len(verbs))
check('deletes are soft', "status: 'Inactive'" in API or "'Inactive'" in API)

# ── who may change the company master ─────────────────────────────────────
# The brief: nobody from the customer's own organisation. ADMIN_COMPANY was on
# this list and was removed; if it comes back, a company admin can rewrite
# their own PAN and statutory numbers again.
_roles = AUTH[AUTH.index('COMPANY_EDIT_ROLES'):]
_roles = _roles[:_roles.index('] as const')]
check("the customer's own admin cannot edit the company master",
      'ADMIN_COMPANY' not in _roles, 'ADMIN_COMPANY is back on the list' if 'ADMIN_COMPANY' in _roles else '')
check('EZER support can', 'IMPL_MANAGER' in _roles and 'ADMIN_SUPER' in _roles)

# ── the certificate route ─────────────────────────────────────────────────
DOC = (ROOT/'app/api/company/registration-doc/route.ts').read_text()
for verb in ('POST', 'DELETE'):
    body = DOC.split('export async function %s' % verb)[1].split('export async function')[0]
    check('%s on a certificate is gated' % verb,
          'right.canEdit' in body and 'status: 403' in body)
check('viewing a certificate needs a session but not an edit role',
      "status: 401" in DOC.split('export async function GET')[1].split('export async function')[0])
check('only PDF and DOCX are accepted',
      "'application/pdf'" in DOC and 'wordprocessingml.document' in DOC and 'ALLOWED' in DOC)
check('the file size limit matches the CHECK in 081',
      '15 * 1024 * 1024' in DOC and '15728640' in (ROOT/'supabase/migrations/081_registration_documents.sql').read_text())
check('certificates are served by signed URL, never a public link',
      'createSignedUrl' in DOC and 'getPublicUrl' not in DOC)

# ── registrations are no longer written from the browser ──────────────────
# Looks for a CALL and an IMPORT, not the word — the page comments explain
# why it stopped calling this, and a bare substring match flags that comment.
check('the profile page does not write registrations with the anon key',
      'await upsertRegistration(' not in PAGE
      and not re.search(r'import\s*\{[^}]*upsertRegistration', PAGE))
check('the anon-writing helper is marked as no longer used here',
      'NO LONGER USED BY THE COMPANY PROFILE' in DATA)

print('\n  %d passed, %d failed\n' % (len(P), len(F)))
sys.exit(1 if F else 0)
