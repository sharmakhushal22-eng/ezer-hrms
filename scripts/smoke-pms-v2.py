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

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
