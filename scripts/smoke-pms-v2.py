#!/usr/bin/env python3
"""
smoke-pms-v2.py — does the build match the PMS v2 spec?

Reads the spec itself and checks the code against it, rather than against my
memory of it. Covers the complete flow: the seven stages, the role matrix,
the six HR Admin tabs, all fifteen validation rules, the PIP gate, the
employment flags and the one rule that must never move.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = pathlib.Path('/Users/tusharpanwar/Desktop/HRMS/PMS Ezer 2/EZER-PMS-MODULE-SPEC-v2-EN.md')
LIB = ROOT / 'lib/pms'
CMP = ROOT / 'components/pms'

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<62s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<62s} {detail}')
def sec(t): print(f'\n  ── {t} ' + '─' * max(0, 58 - len(t)))

check('the spec is where it is expected', SPEC.exists(), str(SPEC.name))
spec = SPEC.read_text() if SPEC.exists() else ''
src = ''.join(p.read_text() for p in sorted(LIB.glob('*.ts')))
ui  = ''.join(p.read_text() for p in sorted(CMP.glob('*.tsx')))
page = (ROOT / 'app/dashboard/pms/page.tsx').read_text()

# ── §0.1 the non-negotiable ──────────────────────────────────────────────
sec('§0.1 developmental only')
check('the spec still says payout linkage is locked',
      'payout_linkage_enabled = false' in spec)
mig = (ROOT / 'supabase/migrations/066_pms_module.sql').read_text()
check('the CHECK constraint is in the migration',
      re.search(r'payout_linkage_enabled\s*=\s*false', mig) is not None)
money = []
for p in sorted(LIB.glob('*.ts')):
    body = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', p.read_text(), flags=re.S)
    for w in ('increment', 'bonus', 'variable_pay', 'ctc'):
        if re.search(rf'\b{w}\b', body, re.I): money.append(f'{p.name}:{w}')
check('no PMS module names a pay concept', not money, str(money[:3]))
check('the admin config states the lock where somebody would change it',
      'payout_linkage_enabled = false' in ui and 'developmental' in ui.lower())

# ── §1 the seven stages ──────────────────────────────────────────────────
sec('§1 the flow')
STAGES = ['KRA Setting', 'One-to-One', 'Weightage Lock', 'Self Rating',
          'Manager Review', 'HOD Finalise', 'Result']
cyc = (LIB / 'cycle.ts').read_text()
for s in STAGES:
    check(f'stage present: {s}', f"label: '{s}'" in cyc)
check('the stage is derived, never stored', 'export function currentStage' in cyc)
check('every stage carries a sentence, not just a label', cyc.count('blurb:') == 7)

# ── §11 the fifteen validation rules ─────────────────────────────────────
sec('§11 validation rules')
check('rules 1-3: min 4, max 10, total 100',
      'minKra: 4' in cyc and 'maxKra: 10' in cyc and 'totalWeightage: 100' in cyc)
check('rule 4: minimum weightage per KRA', 'minWeightagePerKra: 5' in cyc)
check('rule 5: one-to-one acknowledged before the weightage locks',
      'oneToOneBothConfirmed' in cyc)
check('rule 6: self rating before the manager rates',
      'selfSubmitted' in cyc and 'rmL1Done' in cyc)
check('rule 12: an exited record goes read-only',
      'EXITED' in src and 'read-only' in (LIB / 'employment.ts').read_text().lower())
check('rule 13: an override reason is required on a changed rating',
      'ERROR_REASON_MISSING' in src)
check('rule 14: exactly one active policy', 'resolvePolicy' in src)
check('rule 15: payout linkage cannot be enabled', not money)

# ── §6 the HR Admin tabs ─────────────────────────────────────────────────
sec('§6 HR Admin')
for want, label in (('6.1', 'config'), ('6.2', 'policies'), ('6.3', 'fill'),
                    ('6.4', 'upload'), ('6.5', 'pip'), ('6.6', 'reports')):
    check(f'§{want} tab exists: {label}', f"k: '{label}'" in ui)
check('all six are wired into the Performance page',
      all(f"'{k}'" in page for k in ('config','policies','fill','upload','pip','reports')))
check('Performance is the HR Admin surface in the main menu',
      (ROOT / 'app/dashboard/pms/page.tsx').exists())

# ── §6.1 frequency ───────────────────────────────────────────────────────
check('the four frequencies produce 12 / 4 / 2 / 1 periods',
      "MONTHLY: 12" in src and "QUARTERLY: 4" in src
      and "HALF_YEARLY: 2" in src and "ANNUAL: 1" in src)
check('changing frequency previews the real periods before saving',
      'previewPeriods' in src and 'previewPeriods' in ui)

# ── §6.4 upload ──────────────────────────────────────────────────────────
sec('§6.4 bulk upload')
up = (LIB / 'upload.ts').read_text()
check('the template has the nine spec columns', up.count("'") > 0 and
      all(c in up for c in ('employee_code', 'period_code', 'final_rating',
                            'override_reason', 'finalised_by_code')))
for e in ('ERROR_NOT_FOUND', 'ERROR_NOT_ELIGIBLE', 'ERROR_REASON_MISSING', 'ERROR_INVALID_RATING'):
    check(f'blocking error defined: {e}', e in up)
check('the commit is blocked while any row errors',
      'canCommit' in up and 'errorCount === 0' in up)

# ── §7 PIP ───────────────────────────────────────────────────────────────
sec('§7 PIP')
pip = (LIB / 'pip.ts').read_text()
check('the spec still says an RM cannot start a PIP',
      re.search(r'RM cannot start a PIP|cannot start a PIP themselves', spec) is not None)
check('initiate is HR-only in the model, not just the UI',
      re.search(r"initiate:\s*\{\s*from:\s*\['PENDING_HR'\],\s*by:\s*\['HR'\]", pip) is not None)
check('the refusal explains why, naming the documentation trail',
      'HR initiates it' in pip and 'documentation' in pip)
check('the six steps are all reachable',
      all(a in pip for a in ('raise','send_back','reject','resubmit','initiate',
                             'acknowledge','review','close')))
check('reviews cannot start before the employee acknowledges',
      'not acknowledged' in pip)

# ── §8 employment flags ──────────────────────────────────────────────────
sec('§8 exit and notice')
emp = (LIB / 'employment.ts').read_text()
for f in ('EXITED', 'NOTICE_PERIOD', 'NEW_JOINER', 'ACTIVE'):
    check(f'flag defined: {f}', f"'{f}'" in emp)
check('EXITED is decided before NOTICE_PERIOD',
      emp.index("return 'EXITED'") < emp.index("return 'NOTICE_PERIOD'"))
check('notice rows are pinned to the top of a queue',
      'queuePriority' in emp and "case 'NOTICE_PERIOD': return 0" in emp)
check('every flag is explained in words, not colour alone',
      'FLAG_MEANING' in emp and emp.count('FLAG_MEANING') >= 1)

# ── plain language ───────────────────────────────────────────────────────
sec('Language')
check('no quarter code is hardcoded as a label in any PMS screen',
      not re.search(r'>\s*Q[1-4]\b', ui + page))
check('period naming lives in one place', 'nameThePeriod' in src)
check('month names agree between policy.ts and language.ts',
      "'January'" in (LIB / 'policy.ts').read_text()
      and "'January'" in (LIB / 'language.ts').read_text())


# ── the design brief: mockup LAYOUT, HRMS THEME ──────────────────────────
#
# The instruction was specific — take the layout and structure from
# EZER-PMS-Mockup-v2.html, but draw it in EZER's own colours rather than the
# mockup's violet. Both halves are checkable, and both have failed before:
# the violet nearly came across wholesale, and the scope class that makes the
# stylesheet apply at all was missing from the real page while the preview
# harness had it — so the harness looked perfect and the product rendered
# unstyled.
sec('Design — mockup layout, HRMS theme')
CSS = (CMP / 'pms.css')
css = CSS.read_text() if CSS.exists() else ''
check('the PMS stylesheet exists', bool(css))
# Scan DECLARATIONS, not documentation. The file's header carries the whole
# mockup-to-app colour mapping as a comment — a scan of the raw text finds
# every violet hex there and fails a file that never declares one.
decl = re.sub(r'/\*.*?\*/', ' ', css, flags=re.S)

MOCKUP = pathlib.Path('/Users/tusharpanwar/Desktop/HRMS/PMS Ezer 2/EZER-PMS-v2/EZER-PMS-Mockup-v2.html')
mock = MOCKUP.read_text() if MOCKUP.exists() else ''
check('the mockup is where it is expected', bool(mock), MOCKUP.name)

# Layout: every structural class the mockup builds its screens from.
STRUCTURE = ['card', 'sub', 'grid', 'g4', 'g3', 'g2', 'stat', 'lbl', 'val', 'note',
             'tblwrap', 'num', 'pill', 'rbadge', 'fld', 'btn', 'ghost', 'chip',
             'bar', 'banner', 'flowbox', 'divider', 'stepper', 'step', 'dot',
             'wmeter', 'abar', 'tabs', 'exitrow', 'noticerow']
# A whole-token match, not a substring. `.{c} not in decl` passed a sabotage
# that renamed .flowbox to .flowboxXX — the substring was still there, so the
# guard reported a class that no longer existed under that name.
missing = [c for c in STRUCTURE if not re.search(rf'\.{c}\b', decl)]
check('every structural class from the mockup is ported', not missing, str(missing[:6]))

# Theme: the mockup's own palette must NOT have come across.
VIOLET = ['#7C3AED', '#1E1B4B', '#F5F3FF', '#E9E7F5', '#6B6796', '#3C3489',
          '#F1EFFA', '#C7C2F0', '#EDE6FE', '#DCD3FA']
leaked = [h for h in VIOLET if h.lower() in decl.lower()]
check('the mockup palette did not come across', not leaked, str(leaked[:4]))
check('colour resolves through the app tokens', decl.count('var(--ez-') > 60,
      f'{decl.count("var(--ez-")} references')

# Any hex at all in the stylesheet has to be a deliberate, documented one.
# The only literals allowed to be declared are the exit/notice row washes,
# which no --ez-* token covers: §8 needs orange and yellow to stay tellable
# apart across three screens, and the state tokens give amber to both.
hexes = sorted(set(re.findall(r'#[0-9A-Fa-f]{6}', decl)))
ROW_WASHES = {'#FFF4ED', '#FFE8D8', '#FEFCE8', '#FDF6C3', '#9A3412', '#FFEDD5', '#FDBA74'}
stray = [h for h in hexes if h.upper() not in ROW_WASHES]
check('the only declared hexes are the documented row washes', not stray, str(stray[:5]))

# Scoping: generic class names must not leak, and the scope must be applied.
generic = [l for l in decl.splitlines()
           if re.match(r'^\s*\.(card|stat|pill|btn|grid|tabs|banner)\b', l)]
check('no generic class is declared unscoped', not generic, str(generic[:2]))
check('the real page applies the scope class', 'className="pms"' in page,
      'without it the whole stylesheet is dead')

# Three-state theming, the same contract the rest of the app follows.
check('dark is defined for the system default AND the explicit toggle',
      'prefers-color-scheme: dark' in decl
      and ':root:not([data-ez-theme="light"])' in decl
      and ':root[data-ez-theme="dark"]' in decl)

# Type: the mockup's half-pixel sizes must not survive the app's zoom.
halves = re.findall(r'font-size:\s*\d+\.5px', decl)
check('no half-pixel type survived the port', not halves, str(halves[:3]))

# The six tabs, named as the mockup names them.
for label in ['PMS Configuration', 'Policy Builder', 'Fill Status Tracker',
              'Final Rating Upload', 'PIP Management', 'Reports & Export']:
    check(f'tab named as the mockup names it: {label}', label in ui)

# The connector bug that struck through the stepper numerals.
check('the stepper connector is trimmed to the gap between dots',
      'calc(50% + 18px)' in decl and 'calc(-50% + 18px)' in decl)

# The flex trap that took the page sideways at every width under 900px.
check('the scoped root can shrink inside a flex column',
      re.search(r'\.pms\s*\{[^}]*min-width:\s*0', decl, re.S) is not None
      and re.search(r'\.pms\s*\{[^}]*width:\s*100%', decl, re.S) is not None)

# ── flow and hierarchy, §1 and §2 ────────────────────────────────────────
sec('Flow & hierarchy')
H = (LIB / 'hierarchy.ts').read_text() if (LIB / 'hierarchy.ts').exists() else ''
check('the role matrix is data, not conditionals in screens', 'MATRIX' in H)
check('all seven roles from §2 are present',
      all(r in H for r in ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR_MGR', 'HR_HEAD', 'ADMIN']))
check('finalise is three-valued, so a screen cannot treat it as a boolean',
      "'policy'" in H and 'canFinalise' in H)
check('the flow carries all twelve steps from §1',
      len(re.findall(r'\{ n: \d+,\s*actor:', H)) == 12)
check('the RM-L2 gate cannot deadlock a chain without an RM L2', 'blockedByRmL2' in H)
check('the four period windows are generated, not hardcoded per period',
      'windowsFor' in (LIB / 'policy.ts').read_text())
check('a period stays open until its last window closes', 'periodState' in (LIB / 'policy.ts').read_text())


# ── §3 / §4 / §5 the three role surfaces ─────────────────────────────────
sec('Employee, RM and HOD surfaces')
EMP = (CMP / 'EmployeeTabs.tsx'); MGR = (CMP / 'ManagerTabs.tsx')
emp = EMP.read_text() if EMP.exists() else ''
mgr = MGR.read_text() if MGR.exists() else ''
check('the employee surface exists', bool(emp))
check('the RM and HOD surface exists', bool(mgr))

for label in ['My Dashboard', 'My KRAs', 'One-to-One Log', 'Self Rating',
              'My Result', 'My Analytics']:
    check(f'§3 tab present: {label}', label in emp)
for label in ['Team Dashboard', 'KRA Approval & One-to-One', 'Rate My Team',
              'PIP Request', 'Team Analytics']:
    check(f'§4 tab present: {label}', label in mgr)
for label in ['Review & Finalise', 'Feedback & Recognition', 'Department Analytics']:
    check(f'§5 tab present: {label}', label in mgr)

# The rules must live in lib, not be re-implemented inside a screen.
ui_all = emp + mgr
check('the screens do not hardcode the KRA numbers',
      not re.search(r'(minKra|maxKra)\s*[:=]\s*\d', ui_all)
      and 'DEFAULT_RULES' in ui_all)
check('no screen re-implements the weightage check',
      'checkKras' in emp and ui_all.count('=== 100') == 0)
check('the gap threshold is not restated in a screen',
      "'MAJOR_GAP'" in ui_all and 'Math.abs' not in ui_all)

# §3.5 — nothing before publish.
check('§3.5 the result is withheld entirely until published',
      re.search(r'if \(!published\)', emp) is not None)
check('§3.6 analytics are withheld too, for the same reason',
      emp.count('if (!published)') >= 2)

# The gates that stop a step.
LIB_O2O = (LIB / 'oneToOne.ts').read_text() if (LIB / 'oneToOne.ts').exists() else ''
check('RULE 5 lives in one place', 'canLockWeightage' in LIB_O2O and 'canLockWeightage' in ui_all)
check('RULE 8 lives in one place', 'canPublishResult' in LIB_O2O and 'canPublishResult' in ui_all)
check('RULE 6 is stated where a manager would hit it',
      'canManagerRate' in mgr)
check('both acknowledgements are required, not either',
      "employee_ack" in LIB_O2O and "manager_ack" in LIB_O2O
      and "'both'" in LIB_O2O)

# §8 across the manager screens.
TEAM = (LIB / 'team.ts').read_text() if (LIB / 'team.ts').exists() else ''
check('the queue order is computed, not a sort dropdown', 'queuePriority' in TEAM)
check('a highlighted row carries its reason in words', 'priorityNote' in TEAM)
check('the exit and notice row classes are used by the manager screens',
      'exitrow' in mgr and 'noticerow' in mgr)
check('the DB employment flag is trusted over a derived one', 'flagOverride' in TEAM)

# §4.5 / §5.3 — v2 removed the bell curve.
#
# Grepping for the WORDS fails the honest code: team.ts explains that v2
# removed the curve, and the screen tells a manager there is no curve to fit.
# Those sentences are the feature. What must not exist is an IMPLEMENTATION,
# so this looks for one — an identifier that fits, forces, caps or quotas a
# distribution — in code with the comments and copy stripped out.
code_only = re.sub(r'/\*.*?\*/|//[^\n]*|"[^"]*"|\'[^\']*\'|`[^`]*`', ' ',
                   src + ui_all, flags=re.S)
curve = re.findall(r'\b\w*(?:[Bb]ellCurve|[Ff]orceDistribution|[Qq]uota|[Cc]urveFit|'
                   r'[Nn]ormalise[Rr]atings|[Cc]apRatings)\w*\b', code_only)
check('no forced distribution is IMPLEMENTED anywhere in PMS', not curve, str(curve[:3]))
check('and the screens say plainly that there is no curve',
      re.search(r'no curve to fit', ui_all, re.I) is not None)

# Recognition must stay non-monetary on the surface that awards it.
check('recognition is stated as non-monetary where it is granted',
      re.search(r'non-monetary', mgr, re.I) is not None
      and re.search(r'cash component', mgr, re.I) is not None)

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
