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
            '087_social_and_inbox.sql',
    # 089 adds the recognition catalogue and set_recognition_marks(). It is
    # part of the wall's surface, so its functions and tables belong in the
    # same sweep — otherwise this suite reports the wall calling an RPC that
    # nobody defined, when in fact the harness was not looking at the file.
    '089_recognition_catalogue.sql',
]
CODE = [ROOT / 'components/ess/WallOfFame.tsx',
        ROOT / 'components/wall/Spotlight.tsx',
        ROOT / 'components/wall/ShoutoutComposer.tsx',
        ROOT / 'components/wall/AppreciationComposer.tsx',
        ROOT / 'components/wall/CommentThread.tsx',
        ROOT / 'components/wall/WallInbox.tsx',
        ROOT / 'components/ess/InboxTabs.tsx',
        ROOT / 'components/wall/Badge.tsx',
        ROOT / 'components/wall/AdminConsole.tsx',
        ROOT / 'lib/wall/shoutout.ts',
        ROOT / 'lib/wall/appreciation.ts',
        ROOT / 'lib/wall/comments.ts',
        ROOT / 'lib/wall/inbox.ts',
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
# ONLY 082's map. 084 creates a wall_permissions catalogue and 087 seeds it
# with the same tuple shape, so a regex over all the SQL matched THOSE rows
# and reported every permission as mapped — including the four that were not.
# Two tables, one pattern, and the check quietly answered a different question
# from the one it was asked.
map_sql = strip_sql_comments((MIG / '082_access_foundation.sql').read_text())
map_block = map_sql[map_sql.index('access_permission_map'):] if 'access_permission_map' in map_sql else ''
mapped = set(re.findall(r"\('(wof\.[a-z.]+|company\.activate)',", map_block))

# THE INVARIANT THAT ACTUALLY MATTERS, and it is not obvious from the code.
#
# wof_can() is the gate, and for an everyday permission it ends:
#
#     if to_regprocedure('can(uuid,text,text)') is not null then
#       return coalesce((select can(p_employee, p_permission, 'self')), true);
#     end if;
#     return true;
#
# The module was built to work WITHOUT migration 083: no can(), everyday
# permissions allowed. Adding 082 makes can() exist — and mine denies an
# unmapped name, which is right for a standalone gate and disastrous here.
# Every wall_permissions code missing from 082's map flips from ALLOWED to
# DENIED the moment 082 is applied.
#
# So introducing the access floor can only ever narrow access, never widen it,
# and the map must cover the catalogue completely or 082 is worse than not
# having it at all.
catalogue = set()
for _m in re.finditer(r'insert into wall_permissions[^;]*;', sql_all, re.I | re.S):
    catalogue |= set(re.findall(r"\('(wof\.[a-z.]+)'", _m.group(0)))
check('082 covers every wall_permissions code (or it NARROWS access)',
      not sorted(c for c in catalogue if c not in mapped),
      str(sorted(c for c in catalogue if c not in mapped))
      if any(c not in mapped for c in catalogue) else f'{len(catalogue)} catalogue codes')

missing_perm = sorted(p for p in perms_ts if p not in mapped)
check('every permission the TypeScript names is in the permission map',
      not missing_perm, str(missing_perm[:4]) if missing_perm else f'{len(perms_ts)} permissions')

# THE CHECK ABOVE IS NOT ENOUGH, AND MISSING THAT COST FOUR PERMISSIONS.
# access.ts is a convenience for routes; the SQL is what actually ENFORCES.
# 087 gates commenting, mentions, the inbox and direct appreciation on four
# names that neither the bundle's union nor my first map contained — and
# can() denies an unmapped name, so all four would have denied everyone,
# silently, forever. What matters is what the database asks for.
# Every wof.* literal in the SQL, not just the ones a regex can tie to a
# wof_can( call — those calls wrap across lines and a [^)]*? stops at the
# first paren, which found 7 of 19 and let the very gap this check exists
# for slip through a second time.
enforced = set(re.findall(r"'(wof\.[a-z.]+)'", sql_all))
unmapped = sorted(p for p in enforced if p not in mapped)
check('every permission the SQL ENFORCES is in the permission map',
      not unmapped, str(unmapped) if unmapped else f'{len(enforced)} enforced')
untyped = sorted(p for p in enforced if p not in perms_ts)
check('every enforced permission is also in the TypeScript union',
      not untyped, str(untyped) if untyped else '')
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
# The files ADAPTED from the EZER-WallOfFame-v7 bundle, named rather than
# matched on an '08' prefix. The prefix was a stand-in for "came from the
# bundle", and it stopped meaning that the moment a file was written for this
# schema from scratch: 089 has no adaptation to document, and demanding the
# marker there would have meant either a false failure or a lie in its header.
ADAPTED = ['084_wall_of_fame.sql', '085_wall_of_fame_seed.sql',
           '086_shoutouts_and_feed.sql', '087_social_and_inbox.sql']
check('the adaptation is documented in every adapted file',
      all('ADAPTED FOR THIS DATABASE' in (MIG / f).read_text()
          for f in ADAPTED if (MIG / f).exists()))
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
# Comments NAME the forbidden affordances in order to explain why they are
# forbidden — the same trap as the money check, where a screen stating the
# rule failed for saying the word. Strip comments first; a file that
# describes the limit is upholding it, not breaking it.
code_nc = ''
for _p in CODE:
    if _p.exists():
        code_nc += re.sub(r'//[^\n]*|/\*.*?\*/', ' ', _p.read_text(), flags=re.S)
chat = []
for word in ('typing indicator', 'conversation view', 'continue this thread'):
    if word in code_nc.lower(): chat.append(word)
if re.search(r'create table (?:if not exists )?wall_message_replies', sql_all, re.I):
    chat.append('a replies table')
check('no open-thread affordance was added to the direct channel',
      not chat, str(chat) if chat else '')

ev = re.search(r'event_type[^)]*check[^)]*in\s*\(([^)]*)\)', sql_all, re.I | re.S)
types = set(re.findall(r"'([a-z_]+)'", ev.group(1))) if ev else set()
check('wall inbox event types exist and none is an approval',
      types and not any('approv' in t for t in types),
      f'{len(types)} types' if types else 'not found')

# ── 6b. the gold rule ────────────────────────────────────────────────────
sec('The gold rule')
# Gold appears in exactly three places across the module: the Spotlight
# winner's frame, the #1 podium card, and the board's award ribbon. Not on a
# header, not on a button, not on anything clickable. That restraint is what
# makes gold read as WON rather than as decoration, and it is the first thing
# to erode when somebody wants a section to "stand out".
GOLD_HEX = re.compile(r'#(?:B45309|FEF3C7|F5C86B|FCD34D|F59E0B|EAB308|D97706)', re.I)
# theme.ts DEFINES the token; Badge.tsx owns the gold metal tier; Spotlight
# owns the two sanctioned uses. The rule is about where gold is APPLIED, not
# where the palette declares it exists — flagging the token file would mean
# the only way to pass is to have no gold token at all.
SANCTIONED = {'Spotlight.tsx', 'Badge.tsx', 'theme.ts'}
offenders = []
for p_ in CODE + [ROOT / 'components/wall/Spotlight.tsx']:
    if not p_.exists() or p_.name in SANCTIONED: continue
    body = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', p_.read_text(), flags=re.S)
    if GOLD_HEX.search(body): offenders.append(p_.name)
check('gold is confined to the Spotlight and the badge metal',
      not offenders, str(offenders) if offenders else '')

spot = (ROOT / 'components/wall/Spotlight.tsx')
if spot.exists():
    sp = spot.read_text()
    # inside Spotlight.tsx it may only dress the winner and rank 1
    check('the podium gives gold to rank 1 only',
          'const first = rank === 1' in sp and 'first ? GOLD' in sp)
    # Gold literals may appear ONLY inside the palette block. Outside it,
    # every use must go through a CSS variable — that is what makes the light
    # and dark values move together. The old form of this check counted total
    # distinct hexes and capped them at three, which was right when gold was
    # light-only and became wrong the moment a dark palette was added: five
    # hexes is now correct, and the cap would have argued for deleting the
    # dark theme to satisfy the test.
    body_only = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', sp, flags=re.S)
    palette = body_only[body_only.index('GOLD_CSS'):body_only.index('const GOLD =')] \
              if 'GOLD_CSS' in body_only and 'const GOLD =' in body_only else ''
    outside = GOLD_HEX.findall(body_only.replace(palette, ' '))
    check('gold literals appear only inside the palette block',
          not outside, str(sorted(set(outside))) if outside else
          f'{len(set(GOLD_HEX.findall(palette)))} in the palette, 0 loose')
    check('a leaver stays in the hall of legends but not in the spotlight',
          'hasLeft' in sp and 'no longer here' in sp)

# ── theme-awareness ──────────────────────────────────────────────────────
sec('Theme-awareness')
# TWO REAL BUGS LIVED HERE, BOTH THE SAME SHAPE: a colour hardcoded for one
# theme, sitting on a ground that moves with the other.
#
#   White on the brand fill measured 2.54 in dark mode. tokens.ts documents
#   that trap right beside onAccent — "the brand blue lightens there and white
#   on it falls to 2.5:1" — and I hardcoded '#FFFFFF' thirteen times anyway.
#
#   Gold was three fixed light hexes. In dark mode the app's ink token
#   resolves LIGHT, so a near-white name sat on pale gold at 1.01:1.
hard_white = []
for p_ in CODE:
    if not p_.exists() or p_.name == 'Badge.tsx': continue    # Badge owns its metals
    body = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', p_.read_text(), flags=re.S)
    for m in re.finditer(r"color:\s*[^,;}]*'#(?:FFFFFF|FFF)'", body, re.I):
        hard_white.append(f'{p_.name}: {m.group(0)[:44]}')
check('no component hardcodes white ink (C.onAccent exists for this)',
      not hard_white, str(hard_white[:2]) if hard_white else '')

if spot.exists():
    check('the gold palette is declared for all THREE theme states',
          sp.count('--g-wash') >= 3 and 'prefers-color-scheme: dark' in sp
          and ':root[data-ez-theme="dark"]' in sp,
          f"{sp.count('--g-wash')} declarations")
    check('gold surfaces take ink from the gold palette, not the app token',
          '--g-text' in sp and 'GOLD.text' in sp)

# ── 6c. the inbox rules ──────────────────────────────────────────────────
sec('Inbox')
inbox_ts = (ROOT / 'lib/wall/inbox.ts')
tabs = (ROOT / 'components/ess/InboxTabs.tsx')
wall_inbox = (ROOT / 'components/wall/WallInbox.tsx')
check('the wall inbox exists as its own list', wall_inbox.exists() and tabs.exists())

if inbox_ts.exists():
    it = inbox_ts.read_text()
    evs = set(re.findall(r"^\s*(\w+):\s*'(?:appreciation|comments|replies)'", it, re.M))
    check('no event type in the stream map looks like an approval',
          not [e for e in evs if re.search(r'approv|endors|publish', e, re.I)],
          f'{len(evs)} event types')

if tabs.exists():
    tt = tabs.read_text()
    # The two counts must be held apart. A single number, or one added to the
    # other, is the exact failure the brief names: people triage the tab
    # instead of reading it and the appreciation goes unread first.
    check('the two unread counts are held in separate state',
          'msgUnread' in tt and 'wallUnread' in tt)
    body = re.sub(r'//[^\n]*|/\*.*?\*/', ' ', tt, flags=re.S)
    summed = re.search(r'(msgUnread|wallUnread)\s*\+\s*(msgUnread|wallUnread)', body)
    check('the counts are never summed', not summed,
          summed.group(0) if summed else '')
    check('the existing approvals inbox is rendered, not re-implemented',
          "from './Inbox'" in tt and 'supabase' not in body)

# ── 6d. the public board ─────────────────────────────────────────────────
sec('Public board')
board = ROOT / 'app/board/[pairCode]/page.tsx'
check('the board route exists', board.exists())
if board.exists():
    bd = board.read_text()
    check('it lives OUTSIDE /dashboard, so no auth gate can blank it',
          'app/board' in str(board) and '/dashboard/' not in str(board))
    check('get_board_payload is the only query it makes',
          bd.count('.rpc(') == 1 and 'get_board_payload' in bd and '.from(' not in bd)
    # A television in a corridor is the last place to trust a client-side
    # filter, so the restriction lives in the SQL. This asserts the client
    # never even names a sensitive field.
    leaky = [w for w in ('salary', 'ctc', 'rating', 'mobile', 'email', 'phone', 'bank')
             if re.search(r'\b%s\b' % w, re.sub(r'//[^\n]*|/\*.*?\*/', ' ', bd, flags=re.S), re.I)]
    check('no salary, rating or contact field is named in the client',
          not leaky, str(leaky) if leaky else '')
    check("it neutralises the app's interface zoom in CSS, not in an effect",
          'zoom: 1 !important' in bd)
    check('it hides the app chrome that has no use on a television',
          '.ez-zoom' in bd and 'display: none' in bd)
    check('the stylesheet is at module scope so every state renders it',
          'function BoardStyles' in bd and bd.count('<BoardStyles />') >= 3)
    check('a board never scrolls', 'overflow: hidden' in bd)

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


# ── the admin console's queries ──────────────────────────────────────────
#
# AdminConsole holds its queries in an ARRAY LITERAL, not .from().select(),
# so a sweep that looks for the usual call shape misses them entirely. That
# is how `recognition_awards.cadence` survived: the column does not exist,
# the real name is `frequency`, and a wrong name fails the whole select with
# 42703 — so the Awards panel rendered nothing rather than one blank column.
sec('Admin console columns')
console = ROOT / 'components' / 'wall' / 'AdminConsole.tsx'
csrc = console.read_text() if console.exists() else ''
pairs = re.findall(r"\['([a-z_]+)',\s*'([^']+)'", csrc)
check('the console queries were found', len(pairs) >= 5, f'{len(pairs)} panels')

for table, cols in pairs:
    block = re.search(rf'create table if not exists {table}\s*\((.*?)\n\);',
                      sql_all, re.S | re.I)
    if not block:
        check(f'{table}: table is defined in the migrations', False)
        continue
    defined = set(re.findall(r'^\s*([a-z_]+)\s', block.group(1), re.M))
    asked = [c.strip() for c in cols.split(',') if c.strip()]
    missing = [c for c in asked if c not in defined]
    check(f'{table}: every column the console asks for exists', not missing, str(missing))


# ── unqualified columns inside returns-table functions ───────────────────
#
# A function declared `returns table (id uuid, …)` has `id` as a variable for
# its whole body, so an unqualified `where id = …` is ambiguous against it.
# Postgres accepts the migration and raises 42702 at CALL time — which is how
# get_wall_inbox() shipped erroring for every user, before its permission
# check, so an admin and a stranger got the identical failure.
sec('Ambiguous OUT parameters')

ALL_WALL_SQL = ''
for f in WALL_SQL + ['093_wall_inbox_fix.sql']:
    p_ = MIG / f
    if p_.exists(): ALL_WALL_SQL += p_.read_text() + '\n'

# Split into per-function chunks FIRST. A single regex over the whole file
# spans function boundaries — the first version of this check reported
# access_level_rank, which returns int, quoting get_wall_inbox's line.
chunks = re.split(r'(?=create or replace function )', ALL_WALL_SQL)
latest = {}
for ch in chunks:
    m = re.match(r'create or replace function (\w+)', ch)
    if m: latest[m.group(1)] = ch      # a later file replaces an earlier one

offenders = []
for name, ch in latest.items():
    # Split on the dollar quote itself. Looking for ' as $$' finds nothing —
    # the SQL puts `as $$` on its own line after `language plpgsql stable`, so
    # the head fell back to 400 characters, truncated the returns-table block,
    # and the check silently matched nothing at all.
    dq = ch.find('$$')
    head = ch[:dq] if dq > 0 else ch
    tm = re.search(r'returns\s+table\s*\((.*?)\)\s*language', head, re.S | re.I)
    if not tm: continue
    out_names = set(re.findall(r'^\s*(\w+)\s+\w', tm.group(1), re.M))
    body = re.sub(r'--[^\n]*', ' ', ch[dq:] if dq > 0 else ch)
    for col in sorted(out_names):
        for hit in re.finditer(rf'(?<![.\w]){col}\s*=', body):
            frag = body[max(0, hit.start() - 34):hit.start() + 14].replace('\n', ' ')
            if re.search(r'\b(where|and|on)\b', frag, re.I):
                offenders.append(f'{name}.{col}')
                break

live = offenders
check('no returns-table function uses an unqualified OUT column name',
      not live, str(sorted(set(live))[:3]))
check('093 is present to replace the one that did',
      (MIG / '093_wall_inbox_fix.sql').exists())
check('and 093 qualifies the employees lookup',
      'from employees me where me.id = v_actor' in
      (MIG / '093_wall_inbox_fix.sql').read_text() if (MIG / '093_wall_inbox_fix.sql').exists() else False)

print(f'\n  {ok} passed, {fail} failed\n')
sys.exit(1 if fail else 0)
