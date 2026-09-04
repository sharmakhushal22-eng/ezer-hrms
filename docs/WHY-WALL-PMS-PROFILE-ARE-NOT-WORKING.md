# Why the Wall of Fame, PMS and Profile are not behaving as expected

**For:** Nayan Ahuja  ·  **Written:** 4 September 2026

Every claim in this document was measured against the live database on the day
of writing, and the command that produced it is shown. Nothing here is
inferred from reading the migration files.

---

## Contents

1. [The one root cause behind most of it](#1-the-one-root-cause)
2. [Wall of Fame — eight separate problems](#2-wall-of-fame)
3. [PMS — why nothing could be edited](#3-pms)
4. [Profile 360 — a bug I introduced in 091](#4-profile-360)
5. [What is still open, and what I need from you](#5-still-open)

---

<a name="1-the-one-root-cause"></a>
## 1. The one root cause behind most of it

Three modules — Wall of Fame, Fun Zone, and parts of Profile — were built on a
pattern that **cannot work through PostgREST**. It is worth understanding once,
because it explains most of what follows.

The functions identify their caller like this:

```sql
create function wof_current_employee() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_employee_id', true), '')::uuid;
$$;
```

The caller is read from a **session setting**. For that to work, something must
set `app.current_employee_id` before the function runs. Nothing can:

* **`set_config` is not exposed over the API.** It lives in `pg_catalog`, and
  PostgREST only exposes `public`. The app tried to call it and got
  *"Could not find the function public.set_config"*.
* **Even if it were exposed, it would not survive.** `set_config(..., true)` is
  transaction-scoped, and **PostgREST runs one transaction per request**.
  Setting it in one request and reading it in the next is impossible by design.

So `wof_current_employee()` returned **null on every call the application ever
made**. The same is true of `funzone_current_employee()`.

### Why this was invisible for so long

The gate fails **closed**, so nothing leaked — `wof_can(null, …)` is false for
every permission. It looked like a permissions problem rather than a plumbing
one, and the reads fail *soft*: `get_company_feed` returns `[]` and
`get_inbox_counts` returns zeros rather than erroring. Only writes produced a
visible message, and that message —

```
No acting employee in session.
```

— appears in exactly **one** place in the whole schema (`086:185`, inside
`create_shoutout`), so it surfaced only when somebody pressed send.

### The fix, and why it is a wrapper

`094` (wall) and `096` (Fun Zone) add a thin `*_as` wrapper per function:

```sql
create function create_shoutout_as(p_actor uuid, …) returns jsonb
language plpgsql security definer as $$
begin
  perform wof_act_as(p_actor);          -- sets the GUC for THIS transaction
  return create_shoutout(…);            -- same transaction, so it is visible
end $$;
```

A wrapper and the function it calls run in the **same transaction**, so
`set_config(..., is_local => true)` reaches the inner call and nothing else.
The originals are left byte-for-byte as applied — adding a parameter would have
meant `DROP` and `CREATE` on each, copying hundreds of lines of body into the
new migration where they would drift the first time a rule was fixed in one and
not the other.

**These wrappers are service-role only, and that is the entire security model.**
Each takes the actor as an *argument*, so anyone who can call one can act as
anybody. They are revoked from `anon` and `authenticated`; the app reaches them
through server routes that resolve the person from their session. Please do not
add a grant to `anon` to make them work from the browser — that would be
strictly worse than the bug they fix.

---

<a name="2-wall-of-fame"></a>
## 2. Wall of Fame — eight separate problems

These were genuinely independent. Fixing any one alone would not have made the
wall work.

### 2.1 Nothing could ever be posted — **still blocked**

The root cause above. `094` is applied and correct, but posting still fails:

```
$ curl -X POST .../rpc/create_shoutout_as -d '{"p_actor":"…", …}'
{"code":"42501","message":"permission denied for function create_shoutout_as"}
```

```
recognitions          0 rows
wall_messages         0 rows
recognition_comments  0 rows
```

**Nothing has ever been posted successfully, in the entire life of the module.**

`094` is applied and its `REVOKE` demonstrably ran — calling a wrapper with the
publishable key returns `42501` rather than `PGRST202`, which means the function
exists and the default `PUBLIC` execute right was removed. The `GRANT` is one
line later in the same loop body. Yet the server, which connects with the secret
key, is refused too.

Two causes fit, and **`098` addresses both**: either the grant did not survive,
or PostgREST is serving a schema cache built before it (it decides what a role
may see from a cached catalogue snapshot, so a later grant is invisible until it
reloads — hence `notify pgrst, 'reload schema'`).

**One thing I could not check from here, and it may be the whole answer.** This
project uses Supabase's **new API key format** — `sb_publishable_…` and
`sb_secret_…`, about 40 characters — rather than the old 200-character `eyJ…`
JWTs. Every `GRANT` in `094`, `096` and `098` targets the role literally named
`service_role`. If your secret key resolves to a different role on this project,
that is the entire explanation and no amount of re-granting to `service_role`
will help. The `SELECT` at the end of `098` prints the actual ACL — please send
me that output.

### 2.2 The wall inbox raised an error for every user — **fixed by 093**

`get_wall_inbox` declares `returns table (id uuid, …)`, which makes `id` a
**variable for the entire function body**. The unqualified `id` in its query was
then ambiguous between the OUT parameter and the table column:

```
42702  column reference "id" is ambiguous
```

It failed *before* the permission check, so **nobody had ever seen their wall
inbox**. Now returns `[]` correctly.

### 2.3 A locked panel captioned "Allowed." — **fixed by 095**

The admin console asks two questions: `wof_can()` decides whether a panel is
locked, `wof_explain_access()` supplies the reason. They were written separately
and drifted. The explainer was missing **five** of the gate's tests:

* all five feature switches
* the employee-has-left check
* the per-location override
* the super-admin branch
* the RBAC fall-through

So it fell through to `'Allowed.'` for things the gate refuses — and would also
have told a separated employee, and anyone at a branch where the wall is off,
that they were allowed.

`095` makes the explainer **call `wof_can()`** for the verdict and only choose
the wording, so the two cannot disagree by construction. Re-deriving the tests
is what caused this; a second copy would rot the same way.

### 2.4 "Screens" is locked for everyone, including the Wall Owner — **needs a data fix**

Not a permission problem. `wall_config.board_enabled` is `false` for all three
companies, and `wof_can()` tests the feature switch **before** it looks at the
administrator grant:

```sql
if p_permission = 'wof.board.manage' and not v_cfg.board_enabled
   then return false; end if;
```

So no grant will ever open it. Verified: for the Wall Owner, `wof.configure`,
`wof.badge.manage`, `wof.admin.grant` and `wof.report.view` all return **true**,
while `wof.board.manage` alone returns **false**.

Fix: `data-fixes/enable-wall-boards.sql`, only if wall TVs are wanted. It is not
a plain `UPDATE` — `wall_config` has a `BEFORE UPDATE` trigger that raises 42501
without a session actor, so the script sets `app.current_employee_id` for the
transaction, which satisfies the guard *and* gives the audit trigger a real name
to record.

### 2.5 Only one person can administer the wall — **by data, not by bug**

`wall_admins` holds exactly **three rows, all the same employee** (Kiran Reddy,
`wall_owner` in each of the three companies, seeded by `085` at activation).
Nobody else has a grant, so every admin-only area is locked for everyone else.

That is correct behaviour. It becomes a problem only because of the next two
items.

### 2.6 The Administrators panel is read-only

It lists `wall_admins` and has **no `grant_wall_admin` call anywhere in the
component**. So even the Wall Owner cannot appoint anybody through the UI, and
the first grant to a new person has to be made in SQL
(`data-fixes/grant-wall-admin.sql`). Note `grant_wall_admin` also refuses to
grant to yourself, so the script acts as the existing owner.

### 2.7 The console reads the *portal owner's* permissions, not the viewer's

`EmployeePortal.tsx` renders `<WallOfFame employeeId={emp.id} />`, and `emp`
comes from `loadEmployeeDetail(employeeId)` — the employee **whose portal is
open**. So an administrator looking at a colleague's ESS portal sees *that
person's* wall rights, all locked, even when their own account is a Wall Owner.

This is not a bug so much as a surprise, but it wasted real debugging time and
is worth knowing.

### 2.8 The Awards panel rendered nothing — **fixed**

The console selected `recognition_awards.cadence`. The column is `frequency`.
A wrong column name fails the **whole** `select` with `42703`, so the panel
showed nothing at all rather than one blank column.

---

<a name="3-pms"></a>
## 3. PMS — why nothing could be edited

### 3.1 The dashboard module had no write path at all

Every component under `components/pms/` **read**, and none of them wrote — zero
`insert`, `update`, `upsert` or write RPC across the whole folder. The database
had the entire admin surface all along and none of it was reachable:

```
pms_hr_kra_action   pms_lock_kras       pms_finalise
pms_generate_periods  pms_open_period
pms_policies   pms_kra_master   pms_rating_scale
```

This is now built: `/api/pms/admin` plus a **Setup & Controls** tab with policy
rules, KRA library, rating scale, cycle control and finalisation.

### 3.2 The Config tab looked editable and silently discarded changes

Worse than a missing feature. The tab offered a **frequency dropdown**, but its
`onChange` only set React state — it redrew the period preview and saved
nothing. Somebody could change the cycle frequency, see the periods below
regenerate, and believe they had configured the system.

It is now labelled *"Frequency (preview only)"* with a pointer to the control
that saves.

### 3.3 Three schema facts that shape what can be offered

Worth recording because they look like missing features:

* **`payout_linkage_enabled` is locked `false` by a CHECK constraint** in `066`.
  A toggle for it could only ever fail, so the panel explains instead of
  offering one. Performance is not linked to pay, and that is enforced in the
  database rather than by convention.
* **`periods_per_year` is `GENERATED ALWAYS`** — Postgres rejects any write to
  it. It follows from frequency.
* **KRAs deactivate rather than delete.** A `pms_kra_master` row may already be
  referenced by an employee's goals for a live period; deleting it would orphan
  them mid-cycle.

### 3.4 Opening a period is irreversible, and now says so

`pms_open_period` enrols every eligible employee and writes a row each. There is
**no `close_period`** — reversing an accidental open means deleting those rows
by hand. I opened a period by mistake earlier in this project while believing I
was calling a read, so the new UI requires the period's name to be typed exactly
and the route refuses without an explicit confirm flag.

### 3.5 Current PMS state — healthy, but unused

```
pms_overall_rating    395 rows, 395 distinct (employee, period) — no duplicates
pms_periods           12 (3 open in KRA_SETTING, 9 scheduled)
pms_kra_master        120 rows
pms_employee_goals    0 rows      <-- nobody has set any KRAs yet
```

Scoring is verified correct: `pms_rating_from_score` maps all 15 bands and every
boundary on the 1.0–5.0 scale, and returns nothing for out-of-range input.

The KRA window is open for all three companies and **no employee has saved a
single KRA**. Given that the employee-side flow has been reachable, this is
worth a look from your side — it may simply be that nobody has used it yet.

---

<a name="4-profile-360"></a>
## 4. Profile 360 — a bug I introduced in 091

Found today while starting the Profile UI. **This one is mine, not the
vendor's.**

```
$ curl -X POST .../rpc/get_employee_profile -d '{"p_employee_id":"…","p_viewer_id":"…"}'
{"code":"42703","message":"column ur.employee_id does not exist"}
```

`get_employee_profile` is the single entry point for the whole Profile module,
and it **fails for every caller**. When I adapted the vendor's `085` into `091`,
their code read a table called `employee_roles` which does not exist here. I
redirected it to `ess_user_roles` — correctly — but assumed that table keys on
`employee_id`. It does not; it keys on **`ess_account_id`**:

```
ess_user_roles: id, ess_account_id, role_id, assigned_by, assigned_at, is_active
```

The correct path is the one `lib/rms/server.ts` already uses:

```
employees.id → ess_accounts.employee_id → ess_accounts.id
             = ess_user_roles.ess_account_id → ess_roles
```

…filtered on `ur.is_active`, which my version also omitted.

A second, smaller error in the same block: the role list includes
`'SUPER_ADMIN'`, which is **not a real role code** in this database. The actual
codes are `ADMIN_SUPER` and `ALL_ACCESS`. It was harmless — a dead entry in an
`IN` list — but it would have silently failed to recognise a super admin.

`099` replaces the function with only that block corrected. Everything else in
`get_employee_profile` is left exactly as applied.

---

<a name="5-still-open"></a>
## 5. What is still open, and what I need from you

### 5.1 Run `098` — the wall's last blocker

It re-grants EXECUTE to `service_role` on every wrapper and reloads PostgREST's
schema cache. If the wall still cannot post afterwards, **please send me the
`SELECT` output from the end of that file** — it prints `proacl`, which names
the role that actually holds EXECUTE. `service_role=X` means the grant is there
and the problem is which role your secret key resolves to.

### 5.2 Run `099` — the profile's only blocker

Without it, no profile page can load anything at all.

### 5.3 RLS on `091`'s tables — **answered, and one real hole found**

I asked about this three times and could not answer it. While building the
Profile UI I found the probe that settles it: PostgREST answers *"no grant at
all"* with `42501 permission denied for table`, which is unambiguous — unlike
an empty result set, which could be RLS or could be an empty table.

**The good news.** All twelve tables `091` creates are properly locked. Every
one returns `42501` to the publishable key:

```
employee_family_members   employee_insurance      employee_nominations
employee_documents        employee_education      employee_experience
employee_assets           profile_change_requests profile_field_config
employee_certifications   employee_trainings      employee_app_access
```

My earlier concern about those was wrong, and I would rather say so than leave
you chasing it.

**The bad news — this one is real.** `v_employee_profile_360` is *not* locked.
With the publishable key that ships in every browser, an unauthenticated
caller can read, for **398 employees**:

```
pan   ifsc   bank_name   bank_last4   uan   date_of_birth
personal_email   mobile   annual_ctc   gross_monthly
```

and the view also carries `passport_no`, `aadhar_last4`, `pf_number`,
`esic_ip_number`, `driving_licence`, `voter_id`, both addresses, the emergency
contacts, and father/mother/spouse names.

This is worse than any single table, because joining it all into one row is
exactly what the view is for. A Postgres view runs with its **owner's**
privileges unless it is declared `security_invoker`, so RLS on the underlying
tables does not protect it.

`get_employee_profile()` already strips these per viewer role, exactly as
designed. The view simply sat beside it, ungated, and querying it directly
walks straight past the masking.

**`100_close_profile_view.sql` fixes it** — revokes the view from `anon` and
`authenticated`, and sets `security_invoker` where the server supports it.
Nothing legitimate breaks: `get_employee_profile` is `SECURITY DEFINER`, so it
keeps reading the view on the caller's behalf, and that function is how the
application reads profiles. Reaching the view directly was never part of the
design.

**Please run this one first**, ahead of `098` and `099`. Those two restore
function; this one closes an open door.

### 5.4 Optional, only if wanted

* `enable-wall-boards.sql` — unlocks the Screens panel (wall TVs).
* `grant-wall-admin.sql` — lets somebody besides Kiran administer the wall.

---

## Appendix — what is already applied

Verified live on 4 September, not assumed:

| | |
|---|---|
| 090 Fun Zone multiplayer | applied |
| 091 ESS Profile 360 | applied (with the `099` bug above) |
| 092 Digital ID card | applied |
| 093 Wall inbox fix | applied |
| 094 Wall actor wrappers | applied — 13 wrappers, correctly revoked from anon |
| 095 Explainer alignment | applied |
| 096 Fun Zone wrappers | applied — 3 wrappers, 3 originals revoked |
| 097 Endorse / shortlist | applied |
| **098 Grant repair** | **pending** |
| **099 Profile RPC fix** | **pending** |
| **100 Close the profile view** | **pending — run this first** |
