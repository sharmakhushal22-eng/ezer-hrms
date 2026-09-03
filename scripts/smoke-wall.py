#!/usr/bin/env python3
"""
smoke-wall.py — regression suite for the Wall of Fame module.

Covers the aspects a browser cannot see:

  1. SQL          every migration parses; objects are where the code expects
  2. Access       every permission the code names is in the permission map
  3. Data flow    every table, view, column and function the code calls exists
  4. Adaptation   no un-renamed column from the bundle survived
  5. Conventions  the brief's hard rules, checked rather than intended
  6. The two      recognition never touches pay; the direct channel is
     unbreakable  appreciation only, with no path to an open thread
     rules

The UI half — render, focus, contrast, overflow — is scripts/pms-ux.py and
scripts/pms-overflow.py, driven from a harness.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIG = ROOT / 'supabase/migrations'
WALL_SQL = ['082_access_foundation.sql', '084_wall_of_fame.sql',
            '085_wall_of_fame_seed.sql', '086_shoutouts_and_feed.sql',
            '087_social_and_inbox.sql']
CODE = [ROOT / 'components/ess/WallOfFame.tsx',
        ROOT / 'components/wall/ShoutoutComposer.tsx',
        ROOT / 'components/wall/Badge.tsx',
        ROOT / 'lib/wall/shoutout.ts',
        ROOT / 'lib/wall/access.ts',
        ROOT / 'lib/wall/theme.ts']

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1;  print(f'  PASS {label:<60s} {detail}')
    else:    fail += 1; print(f'  FAIL {label:<60s} {detail}')

def sec(t): print(f'\n  ── {t} ' + '─' * max(0, 56 - len(t)))

def strip_sql_comments(t):
    """Comments are prose and name the old columns on purpose — the adapted
       files document the very renames this suite checks for. Counting those
       mentions reported all six renames as incomplete when every one of them
       had been applied."""
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'--[^\n]*', ' ', t)

sql_raw = ''
for f in WALL_SQL:
    p = MIG / f
    if p.exists(): sql_raw += p.read_text() + '\n'
sql_all = strip_sql_comments(sql_raw)
code_all = ''.join(p.read_text() for p in CODE if p.exists())

# ── 1. SQL present and parseable ─────────────────────────────────────────
sec('SQL')
for f in WALL_SQL:
    check(f'{f} exists', (MIG / f).exists())
try:
    import pglast
    for f in WALL_SQL:
        p = MIG / f
        if not p.exists(): continue
        try:
            pglast.parse_sql(p.read_text()); check(f'{f} parses', True)
        except Exception as e:
            check(f'{f} parses', False, str(e)[:90])
except ImportError:
    check('pglast available to parse the SQL', False, 'pip install pglast')

TABLES = set(re.findall(r'create table (?:if not exists )?(\w+)', sql_all, re.I))
VIEWS  = set(re.findall(r'create (?:or replace )?view (\w+)', sql_all, re.I))
FUNCS  = set(re.findall(r'create (?:or replace )?function (\w+)', sql_all, re.I))
check('the module declares its tables', len(TABLES) >= 15, f'{len(TABLES)} tables')
# Three, and that is the real number: v_company_feed, v_wall_feed and
# v_wall_leaderboard. The 10-view figure in the bundle README belongs to a
# different migration, and my first threshold was copied from it.
check('the module declares its views',  len(VIEWS)  >= 3,  f'{len(VIEWS)} views')
check('the module declares its functions', len(FUNCS) >= 15, f'{len(FUNCS)} functions')

# ── 2. access model ──────────────────────────────────────────────────────
sec('Access model')
acc = (ROOT / 'lib/wall/access.ts').read_text()
perms_ts = set(re.findall(r"\|\s*'(wof\.[a-z.]+)'", acc)) | set(re.findall(r"=\s*'(wof\.[a-z.]+)'", acc))
mapped = set(re.findall(r"\('(wof\.[a-z.]+|company\.activate)',", sql_all))
missing_perm = sorted(p for p in perms_ts if p not in mapped)
check('every permission the code names is in the permission map',
      not missing_perm, str(missing_perm[:4]) if missing_perm else f'{len(perms_ts)} permissions')
check('can() and explain_access() are defined', 'can' in FUNCS and 'explain_access' in FUNCS)
check('an unknown permission is DENIED, not allowed',
      re.search(r'if not found then return false', sql_all, re.I) is not None)
check('a leaver holds no permissions',
      'date_of_leaving is null' in sql_all.lower())
check('an unrecognised access level ranks zero, so a typo can only grant less',
      re.search(r"else 0 end", sql_all, re.I) is not None)
check('EZER staff are matched on role_code, not a display name',
      "role_code = 'ADMIN_SUPER'" in sql_all and 'role_name' not in
      sql_all.split('is_ezer_staff')[1][:600] if 'is_ezer_staff' in sql_all else False)

# ── 3. data flow ─────────────────────────────────────────────────────────
sec('Data flow')
called = set(re.findall(r"\.rpc\('(\w+)'", code_all))
missing_fn = sorted(f for f in called if f not in FUNCS and f != 'set_config')
check('every RPC the code calls is defined in the migrations',
      not missing_fn, str(missing_fn) if missing_fn else f'{len(called)} calls')

read = set(re.findall(r"\.from\('(\w+)'\)", code_all))
BASE = {'employees', 'departments', 'companies', 'locations', 'ess_accounts'}
missing_tbl = sorted(t for t in read if t not in TABLES | VIEWS | BASE)
check('every table or view the code reads exists',
      not missing_tbl, str(missing_tbl) if missing_tbl else f'{len(read)} sources')

# columns selected from module tables
def cols_of(table):
    m = re.search(r'create table (?:if not exists )?%s\s*\((.*?)\n\);' % table, sql_all, re.S | re.I)
    if not m: return None
    body = re.sub(r'--[^\n]*', ' ', m.group(1))
    depth, buf = 0, ['']
    for ch in body:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ',' and depth == 0: buf.append(''); continue
        buf[-1] += ch
    out = set()
    for frag in buf:
        c = re.match(r'\s*([a-z_][a-z0-9_]*)\s+', frag)
        if c and c.group(1).upper() not in ('PRIMARY','FOREIGN','UNIQUE','CHECK','CONSTRAINT'):
            out.add(c.group(1))
    # columns added later by ALTER
    for a in re.findall(r'alter table %s(.*?);' % table, sql_all, re.S | re.I):
        out |= set(re.findall(r'add column (?:if not exists )?([a-z_][a-z0-9_]*)', a, re.I))
    return out

bad_cols = []
for m in re.finditer(r"\.from\('(\w+)'\)\s*\n?\s*\.select\(\s*'([^']*)'", code_all):
    t, sel = m.group(1), m.group(2)
    if t in BASE: continue
    known = cols_of(t)
    if known is None: continue
    for c in re.split(r'[,\s]+', sel):
        c = c.strip()
        if c and c not in known: bad_cols.append(f'{t}.{c}')
check('every column selected from a module table exists',
      not bad_cols, '; '.join(bad_cols[:3]) if bad_cols else '')

# ── 4. the adaptation held ───────────────────────────────────────────────
sec('Adaptation to this schema')
STALE = {'employee_code': 'emp_code', 'date_of_joining': 'company_doj',
         'reports_to': 'l1_manager_id', 'department_name': 'dept_name',
         'branch_id': 'location_id', 'branch_name': 'location_name'}
for old, new in STALE.items():
    n = len(re.findall(r'\b%s\b' % old, sql_all))
    check(f'no {old} survives (this schema uses {new})', n == 0, f'{n} left' if n else '')
n_branches = len(re.findall(r'\bbranches\b', sql_all))
check('no branches table reference survives', n_branches == 0, f'{n_branches} left' if n_branches else '')
check('the adaptation is documented in every adapted file',
      all('ADAPTED FOR THIS DATABASE' in (MIG / f).read_text()
          for f in WALL_SQL if f.startswith('08') and f != '082_access_foundation.sql'))
# And the header must still NAME the renames, or the next person has no
# record of what was changed or why.
check('the renames are still documented, not just applied',
      all(old in (MIG / '084_wall_of_fame.sql').read_text()
          for old in ('employee_code', 'branch_id')))

# ── 5. the brief's hard conventions ──────────────────────────────────────
sec("The brief's conventions")
ui = [p for p in CODE if p.suffix == '.tsx']
tw = []
for p in ui:
    for m in re.finditer(r'className="([^"]*)"', p.read_text()):
        if re.search(r'\b(bg|text|p|m|flex|grid|rounded|border)-[a-z0-9]', m.group(1)):
            tw.append(f'{p.name}: {m.group(1)[:30]}')
check('no Tailwind utility classes in any wall component', not tw, str(tw[:2]) if tw else '')
store = [p.name for p in CODE if re.search(r'localStorage|sessionStorage', p.read_text())]
check('no browser storage anywhere in the module', not store, str(store) if store else '')
nested = []
for p in ui:
    s = p.read_text()
    m = re.search(r'export default function (\w+)', s)
    if m and re.search(r'^\s+function [A-Z]', s[m.start():], re.M):
        nested.append(p.name)
check('no sub-component declared inside a component (the focus bug)',
      not nested, str(nested) if nested else '')

# ── 6. the two rules that must never break ───────────────────────────────
sec('The two unbreakable rules')
check('payout_linkage is pinned false by a CHECK',
      re.search(r'payout_linkage\s*=\s*false', sql_all, re.I) is not None)
# What is forbidden is a money OPERATION, not the word. A screen that tells
# somebody "this changes nothing about your salary" is stating the rule, not
# breaking it — and my first version of this check failed on exactly that
# sentence, which would have pushed me to delete a useful reassurance.
def money_ops(text):
    hits = []
    for pat, why in (
        (r'\b(salary|bonus|increment|ctc|payout)\s*[:=]', 'assigned to a variable'),
        (r'\b(points|badges?)\s*\*\s*\d', 'multiplied into an amount'),
        (r'\b(amount|rupees|inr)\b\s*[:=]', 'a money field'),
        (r'₹', 'a currency symbol'),
        (r'\bfunction \w*(bonus|payout|salary)\w*', 'a money function'),
    ):
        for m in re.finditer(pat, text, re.I): hits.append(f'{m.group(0).strip()} ({why})')
    return hits
money = []
for p in CODE:
    body = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', p.read_text(), flags=re.S)
    for h in money_ops(body): money.append(f'{p.name}: {h}')
check('no component performs a money operation on recognition',
      not money, str(money[:3]) if money else '')

# The direct channel is appreciation only. These are the affordances the
# brief names explicitly as things that must never be added.
chat = []
for word in ('typing indicator', 'conversation view', 'continue this thread'):
    if word in code_all.lower(): chat.append(word)
if re.search(r'create table (?:if not exists )?wall_message_replies', sql_all, re.I):
    chat.append('a replies table')
check('no open-thread affordance was added to the direct channel',
      not chat, str(chat) if chat else '')

ev = re.search(r'event_type[^)]*check[^)]*in\s*\(([^)]*)\)', sql_all, re.I | re.S)
types = set(re.findall(r"'([a-z_]+)'", ev.group(1))) if ev else set()
check('wall inbox event types exist and none is an approval',
      types and not any('approv' in t for t in types),
      f'{len(types)} types' if types else 'not found')

# ── 7. integration ───────────────────────────────────────────────────────
sec('Integration')
portal = (ROOT / 'components/ess/EmployeePortal.tsx').read_text()
check('Wall of Fame is registered in ESS exactly once',
      len(re.findall(r"k:'wall',\s*label:'Wall of Fame',\s*short:", portal)) == 1)
check('it renders through the portal switch', "case 'wall':" in portal)
wof = (ROOT / 'components/ess/WallOfFame.tsx').read_text()
check('a missing module renders a waiting state, not an error',
      'PGRST205' in wof and 'not switched on yet' in wof)
check('the composer is reachable from the wall', 'ShoutoutComposer' in wof)
check("Badge's keyframes are injected by the screen that mounts it",
      'BADGE_KEYFRAMES' in wof)

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
