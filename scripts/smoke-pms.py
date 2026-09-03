#!/usr/bin/env python3
"""
smoke-pms.py — does the PMS code actually line up with the PMS database?

WHY THIS EXISTS

The pms_* tables are not applied in any database the app can reach, so none
of this module can be exercised end to end. That makes every read a guess
until something proves otherwise, and the failure mode is SILENT: PostgREST
answers 200 with zero rows for a column that does not exist in a filter, and
the screen renders its empty state. Nothing throws. Nothing logs.

Three of these were already wrong on the first pass — a filter on
status='ACTIVE' against a column whose CHECK constraint has no such value,
which would have matched nothing forever.

So this reads migration 066 as the source of truth and asserts that every
table, column and status value the app names is one the schema actually has.

Run:  python3 scripts/smoke-pms.py
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIG  = ROOT / 'supabase/migrations/066_pms_module.sql'
SRC  = [ROOT / 'components/pms/CycleHeader.tsx',
        ROOT / 'components/ess/Performance.tsx',
        ROOT / 'app/dashboard/pms/page.tsx']

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<62s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<62s} {detail}')

sql = MIG.read_text()

# ── what the schema actually contains ────────────────────────────────────
def tables_and_columns(sql):
    out = {}
    for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\((.*?)\n\);', sql, re.S):
        name, body = m.group(1), m.group(2)
        cols = set()
        # Columns are NOT one per line. 066 declares pairs on a single line:
        #     kra_window_from date, kra_window_to date,
        # A line-first parser sees only kra_window_from and then reports the
        # other half of every pair as a column the app invented — which it
        # did, for three real columns, before this was fixed.
        # Comments must go BEFORE the split, not after. 066 has:
        #     weightage_changes  jsonb,   -- [{seq_no, old_wt, new_wt, reason}]
        # and those commas split the fragment, so the next real column got
        # glued to "reason}]" and vanished. Exactly one column was lost, which
        # is the kind of gap a hand-check never finds.
        body = re.sub(r'--[^\n]*', ' ', body)
        depth = 0
        buf = []
        for ch in body:
            if ch == '(': depth += 1
            elif ch == ')': depth -= 1
            if ch == ',' and depth == 0:
                buf.append(''); continue
            if not buf: buf.append('')
            buf[-1] += ch
        KEYWORDS = ('PRIMARY','FOREIGN','UNIQUE','CHECK','CONSTRAINT','REFERENCES','EXCLUDE')
        for frag in buf:
            frag = frag.strip()
            if not frag: continue
            c = re.match(r'([a-z_][a-z0-9_]*)\s+', frag)
            if c and c.group(1).upper() not in KEYWORDS:
                cols.add(c.group(1))
        out[name] = cols
    return out

SCHEMA = tables_and_columns(sql)
print(f'\n  migration 066: {len(SCHEMA)} tables\n')
check('migration 066 parses into tables', len(SCHEMA) >= 15, f'{len(SCHEMA)} found')

# Views are legitimate read targets too.
VIEWS = set(re.findall(r'CREATE (?:OR REPLACE )?VIEW (\w+)', sql))
FUNCS = set(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION (\w+)', sql))
READABLE = set(SCHEMA) | VIEWS

# ── every pms_ table the app reads must exist ────────────────────────────
used_tables = set()
for f in SRC:
    if not f.exists(): continue
    used_tables |= set(re.findall(r"\.from\('(pms_\w+)'\)", f.read_text()))
missing_t = sorted(t for t in used_tables if t not in READABLE)
check('every pms_ table the app reads exists in the schema', not missing_t,
      str(missing_t) if missing_t else f'{len(used_tables)} tables')

# ── every column selected or filtered must exist ─────────────────────────
# A column named in .select() that does not exist makes PostgREST 400 at
# runtime; one named in .eq() silently matches nothing. Both are invisible
# until somebody runs the migration, which is the whole problem.
bad_cols = []
for f in SRC:
    if not f.exists(): continue
    text = f.read_text()
    for m in re.finditer(r"\.from\('(pms_\w+)'\)\s*\n?\s*\.select\(([^)]*)\)", text, re.S):
        table, sel = m.group(1), m.group(2)
        if table not in SCHEMA: continue
        raw = ' '.join(re.findall(r"'([^']*)'", sel))
        for col in re.split(r'[,\s]+', raw):
            col = col.strip()
            if not col or col == '*' or '(' in col or ')' in col: continue
            if col not in SCHEMA[table]:
                bad_cols.append(f'{f.name}: {table}.{col}')
check('every column selected from a pms_ table exists', not bad_cols,
      '; '.join(bad_cols[:3]) if bad_cols else '')

# embedded relations, e.g. pms_policies(frequency)
embeds = []
for f in SRC:
    if not f.exists(): continue
    for m in re.finditer(r"(pms_\w+)\(([a-z_,\s]+)\)", f.read_text()):
        t, cols = m.group(1), m.group(2)
        if t not in SCHEMA: embeds.append(f'{t} (unknown table)'); continue
        for c in re.split(r'[,\s]+', cols):
            if c and c not in SCHEMA[t]: embeds.append(f'{t}.{c}')
check('every embedded relation column exists', not embeds, str(embeds[:3]) if embeds else '')

# ── status vocabularies ──────────────────────────────────────────────────
def allowed(col):
    m = re.search(r'CHECK\s*\(\s*%s\s+IN\s*\(([^)]*)\)' % col, sql)
    return set(re.findall(r"'([A-Z0-9_]+)'", m.group(1))) if m else set()

status_lists = [set(re.findall(r"'([A-Z0-9_]+)'", m.group(1)))
                for m in re.finditer(r'CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)', sql)]
period_status = next((s for s in status_lists if 'SCHEDULED' in s), set())
goal_status   = next((s for s in status_lists if 'DRAFT' in s and 'LOCKED' in s), set())
workflow      = allowed('workflow_status')

check('period status vocabulary found', len(period_status) >= 6, f'{len(period_status)} values')
check('goal status vocabulary found', len(goal_status) >= 5, f'{len(goal_status)} values')
check('workflow vocabulary found', len(workflow) >= 8, f'{len(workflow)} values')

# The exact bug that shipped: a value the app filters on that is not real.
check("'ACTIVE' is NOT a period status (the bug this file was written for)",
      'ACTIVE' not in period_status)
check("'SUBMITTED' / 'APPROVED' are NOT goal statuses",
      'SUBMITTED' not in goal_status and 'APPROVED' not in goal_status)

# every UPPER_SNAKE literal compared against a status column in the app
# Comments explain the bugs these constants prevent, and naming a bad value
# in prose is how you explain it. Scanning them found 'ACTIVE' inside the
# sentence describing why ACTIVE must never be used — a test failing on its
# own documentation.
st_raw = (ROOT / 'lib/pms/status.ts').read_text()
st = re.sub(r'/\*.*?\*/', ' ', st_raw, flags=re.S)
st = re.sub(r'//[^\n]*', ' ', st)
declared = set(re.findall(r"'([A-Z0-9_]{3,})'", st))
known = period_status | goal_status | workflow
strays = sorted(v for v in declared if v not in known)
check('every status constant in lib/pms/status.ts is a real schema value',
      not strays, str(strays[:5]) if strays else f'{len(declared)} constants')

# and the ladder must cover the whole workflow vocabulary
order = re.search(r'WORKFLOW_ORDER[^=]*=\s*\[(.*?)\]', st_raw, re.S)
ladder = set(re.findall(r"WORKFLOW\.(\w+)", order.group(1))) if order else set()
check('WORKFLOW_ORDER covers every workflow value the schema allows',
      workflow <= {l for l in ladder} or not workflow,
      str(sorted(workflow - ladder)) if workflow - ladder else '')

# ── the functions the module leans on ────────────────────────────────────
check('pms_generate_periods exists (periods are generated, not hand-entered)',
      'pms_generate_periods' in FUNCS)

# ── the non-negotiable ───────────────────────────────────────────────────
# The brief says this module is developmental: no payout, CTC, increment or
# variable-pay linkage, locked at the database. If that CHECK ever softens,
# the module has quietly changed what it is.
check('payout linkage is still locked FALSE at the database',
      re.search(r'payout_linkage_enabled\s*=\s*false', sql, re.I) is not None)

# ── language: no filing codes in what a person reads ─────────────────────
lang = (ROOT / 'lib/pms/language.ts').read_text()
check('period naming lives in one place, not scattered across screens',
      'nameThePeriod' in lang)
leaks = []
for f in SRC + [ROOT / 'components/pms/CycleHeader.tsx']:
    if not f.exists(): continue
    t = f.read_text()
    # a quarter code used as a literal label rather than read from data
    for m in re.finditer(r">\s*(Q[1-4]\b[^<{]*)<", t):
        leaks.append(f'{f.name}: {m.group(1)[:24]}')
check('no screen hard-codes a quarter label like "Q3"', not leaks, str(leaks[:3]) if leaks else '')

# ── the model's own guarantees, asserted at the source ───────────────────
cyc = (ROOT / 'lib/pms/cycle.ts').read_text()
check('the cycle stage is derived, never read from a stored column',
      'current_stage' not in cyc and 'currentStage' in cyc)
check('every stage carries a sentence, not just a label',
      cyc.count('blurb:') == 7, f"{cyc.count('blurb:')} blurbs")
check('settled() normalises progress so later evidence implies earlier',
      'export function settled' in cyc)
check('nextAction normalises before reading flags forwards',
      re.search(r'nextAction\([^)]*\)[^{]*\{\s*\n\s*const p = settled\(raw\)', cyc) is not None)
check('dates shown to a reader go through humanDate',
      'export function humanDate' in cyc)

# ── components ───────────────────────────────────────────────────────────
step = (ROOT / 'components/pms/CycleStepper.tsx').read_text()
act  = (ROOT / 'components/pms/NextAction.tsx').read_text()
stat = (ROOT / 'components/pms/StatCards.tsx').read_text()

check('the stepper draws a BLOCKED state distinctly from ACTIVE',
      "'blocked'" in step and 'pms-blocked' in step)
check('the tooltip is reachable from the keyboard, not hover-only',
      'aria-describedby' in step and 'focus-visible' in step)
check('stage state reaches a screen reader as words, not colour alone',
      'ez-sr' in step and 'label:' in step)
check('the tooltip is clamped at both ends of the rail',
      ':first-child .pms-blurb' in step and ':last-child .pms-blurb' in step)
check('the action card refuses to render an instruction without a reason',
      'why' in act and 'blockedBy' in act)
check('the action group wraps rather than pushing the page wide',
      "flexWrap: 'wrap'" in act)
check('count-up yields the final value under reduced motion',
      'calm ? to : 0' in stat and 'prefers-reduced-motion' in stat)
check('every animated component honours prefers-reduced-motion',
      all('prefers-reduced-motion' in f for f in (step, stat)))

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
