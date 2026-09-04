# What changed, and what each migration unlocks

For Nayan Ahuja · 3 September 2026 · branch `TusharPanwar` at `126093f`

Everything described here is built, tested and pushed. It is waiting on the
database, not on more code.

---

## The short version

| Migration | Unlocks | Skip it and… |
|---|---|---|
| **074** | PMS "not found" guards | PMS screens throw instead of showing an empty state |
| **075** | ESS notification catalogue | notifications have no types to send |
| **079** | Group profile | the group/company hierarchy screen stays empty |
| **082** | `can()`, and `explain_access()` for completeness | **084 fails closed — every Wall of Fame check denies everyone** |
| **084** | Wall of Fame core: 20 tables, badges, board, access | the whole module renders "not switched on yet" |
| **085** | Per-company provisioning + long-service job | no company can be activated; no milestone badges |
| **086** | Shoutout categories, `create_shoutout()`, company feed | nobody can give a shoutout; the feed has nothing |
| **087** | Comments, mentions, direct appreciation, inbox streams | no comments, no notes, no Wall of Fame inbox |

Run **082 before 084**. Nothing else about the order is negotiable either,
but that one is the trap: 084 calls `can()` at five sites and fails closed
without it.

---

## 082 — the access floor

**New file. It exists because a migration 083 was assumed and does not exist.**

The Wall of Fame bundle calls `can(uuid,text,text)` at **five sites in 084**,
and it was supposed to arrive in an 083 that is in neither this repository
nor the database.

I first wrote "sixteen times" here. That was wrong: the grep behind it
counted `wof_can(` as `can(`. Comment-stripped, the real figures across
084–087 are `can()` **5** and `explain_access()` **0** — the latter is
provided because the brief named it, not because anything calls it.
`wof_explain_access()`, which 084 defines itself, is the one actually used.
Correcting it here rather than leaving a number you might plan around.

082 provides them **without inventing a second permission system**. One
already exists and is populated:

```
ess_accounts      an employee's login
ess_roles         named roles, with a stable role_code
ess_user_roles    which account holds which role
role_permissions  (role_id, module, access_level NONE/VIEW/EDIT/FULL)
```

`can()` is a reading of that model. Two sources of truth about who may do
what is the worst possible thing to have two of.

Four decisions in it worth knowing:

- **An unknown permission is DENIED.** A typo in a route must fail shut, or
  the route silently checks nothing.
- **An unrecognised access level ranks 0**, so a typo in `role_permissions`
  can only ever grant *less* than intended, never more.
- **Somebody past their leaving date holds no permissions at all.**
- **EZER staff are matched on `role_code = 'ADMIN_SUPER'`**, not on a display
  name — `'Admin (Super)'` is a label somebody may reasonably retitle, and an
  access check that breaks when a label is edited is a trap. *This is the one
  assumption that would silently widen access if wrong. Please confirm it.*

### The bug this file created, and how it was caught

`wof_can()` ends like this for an everyday permission:

```sql
if to_regprocedure('can(uuid,text,text)') is not null then
  return coalesce((select can(p_employee, p_permission, 'self')), true);
end if;
return true;
```

The module was built to work **without** 083: no `can()`, everyday
permissions allowed. Adding 082 makes `can()` exist — and mine denies an
unmapped name. So introducing the access floor did not leave unmapped
permissions alone: **it flipped them from allowed to denied.**

Four permissions were unmapped — `wof.comment`, `wof.mention`,
`wof.message.send`, `wof.inbox.view`. Commenting, mentions, the inbox and
direct appreciation would all have been dead the day 082 was applied, for
everyone, with no error anywhere. All four are now mapped as *everyday*:
saying thank you to a colleague is not a privilege that needs granting.

**Introducing 082 can only ever narrow access, never widen it.** That is now
a checked invariant — every code in `wall_permissions` must appear in 082's
map, or 082 is worse than not having it.

---

## 084–087 — the Wall of Fame

Five files from a v7 implementation bundle, **adapted to this schema**. The
bundle's own instruction was to verify its assumptions against the live
database and report mismatches rather than adapt silently. I verified every
one. Four were wrong:

| The bundle assumed | This database has |
|---|---|
| `employees.employee_code` | `emp_code` |
| `employees.date_of_joining` | `company_doj` |
| `employees.reports_to` | `l1_manager_id` |
| `departments.department_name` | `dept_name` |
| `branches` table, `branch_id`, `branch_name` | **no such table** — `locations`, `location_id`, `location_name` (33 uses) |
| `companies.is_active` | **does not exist** |
| migration `083` for `can()` | **does not exist** → written as 082 |

Every rename was checked against the running database, not inferred from
code. A diff then proved each adapted file is byte-exact against
original-plus-renames — which caught my own blunt `is_active` regex having
truncated a line in a *comment*: the nightly cron snippet you follow in
INSTRUCTIONS section 3. Every `is_active` in the bundle is on the module's
own tables, not on `companies`, so nothing needed changing there and my
header had claimed a change I had not made.

### What 084 creates

20 tables, 3 views, and the access + badge engines. The ones you will care
about for RLS: `wall_config`, `wall_admins`, `recognitions`,
`recognition_comments`, `board_screens`, `wall_audit_log`.

Config tables carry **write triggers** (`enforce_wall_admin`) that reject
anyone without a current grant, so a stray route cannot bypass the
permission model. They depend on `app.current_employee_id` being set on the
connection — that is the cause of nearly every 42501 you will see while
testing, not a fault in the model. Service jobs pass by setting
`app.service_context` to `'true'`.

### The public board

`/board/[pairCode]` runs on a television in a corridor: no login, no
keyboard. `get_board_payload()` is the only query the page makes, and its
SELECT list has **no salary, no rating, no contact column in it at all** —
not filtered afterwards, never selected. A screen in a public corridor is
the last place to trust a client-side filter.

It also excludes anyone past their leaving date. A leaver comes off the board
and off the feed, but stays in the hall of legends: a thing somebody won is
still a thing they won.

`board_screens.pair_code` therefore grants read access to a public route.
Worth bearing in mind when you write its RLS.

---

## 074, 075, 079

Smaller, and all three predate the Wall of Fame work.

- **074** adds "not found" guards to the PMS functions so a missing row
  returns an empty result instead of raising. Without it the PMS screens
  surface a Postgres error where they should show "nothing yet".
- **075** creates the ESS notification catalogue — the list of notification
  types the app can send. Empty catalogue, no notifications.
- **079** creates `company_groups` and the group hierarchy. The group profile
  screen reads it.

---

## Code changes on the app side, for context

These need no database work, but they explain what you will see.

**The PMS was rebuilt to explain itself.** Seven cycle stages, each carrying
a sentence rather than a noun; the stage is *derived*, never stored, so
unlocking a KRA set for correction walks the cycle back on its own. Period
names now read "October to December 2026" instead of "Q3 2026-27" — the
dates were in the row all along, and the stored code is kept as a small chip
because reports are filed under it.

**Three status strings were simply wrong.** The loader filtered
`pms_periods` on `status = 'ACTIVE'`. There is no `ACTIVE` in that column's
CHECK constraint — the filter matched zero rows forever and never errored, so
the screen would have shown "no period configured" permanently. Same for
`SUBMITTED` and `APPROVED` on goals. A wrong status string is invisible:
PostgREST answers 200 with no rows. There is now a test that parses
migration 066's own CHECK constraints and asserts the app only uses values
the schema permits.

**`departments.name` does not exist** — it is `dept_name`. PostgREST fails
the *whole* select on an unknown column, so every department on the PMS
admin roll-up rendered as "Unknown department" on a screen that otherwise
looked perfectly loaded.

**Two dark-mode bugs**, both the same shape: a colour hardcoded for one
theme sitting on a ground that moves with the other. White on the brand fill
measured 2.54:1 — `tokens.ts` documents that exact trap beside `onAccent` and
I hardcoded white thirteen times anyway. And the Wall of Fame gold was three
fixed light hexes, so in dark mode a winner's name sat on pale gold at
**1.01:1**, invisible. Both fixed and both now checked.

---

## What is still not built

- **The certificate PDF.** It should reuse the existing HR letters generation
  path. Nothing in the database blocks it.
- **Real notifications** — in-app, email via Resend, WhatsApp via Interakt.
  075 gives them a catalogue; the senders are not written.
- **Feed pagination.** `get_company_feed()` already takes a `p_before`
  cursor; the UI does not use it yet.
- **The nightly cron** that calls `generate_service_milestones()`. See
  INSTRUCTIONS section 3 — and note the `companies.is_active` correction.
- **Writes from the admin console.** It is read-only, because a write needs a
  server route that proves who is asking, or the config triggers reject it
  with 42501. A Save button that always failed would be worse than none.

---

## How this was tested

Nothing here was run against your database. What could be verified without
it, was:

```
66/66   Wall of Fame — SQL parses, access model, data flow, the schema
        adaptation, coding conventions, both unbreakable rules,
        theme-awareness, the gold rule, inbox rules, board rules
118/118 unit tests — cycle logic, plain-language naming, shoutout rules,
        appreciation rules, comment threading, inbox streams
32/32   PMS data flow — every table, column and status value the code
        names is checked against migration 066 itself
83/83   sidebar · 4/4 ESS navigation
20/20   contrast, hit targets, keyboard reach, focus rings
0       overflow faults across 14 viewport widths, 320px to 1440px
5/5     migrations parse under libpg_query (PostgreSQL's own parser)
        tsc at its pre-existing 19-error baseline · production build clean
```

Every guard was sabotage-tested — deliberately broken to confirm it fails —
because a suite that only ever passes is worth nothing. Several of my own
checks turned out to be wrong before the code was, and those are noted in
the commit messages rather than quietly fixed.

Run `python3 scripts/smoke-wall.py` on the branch to reproduce the first
line yourself.
