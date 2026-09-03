# EZER HRMS — what changed, and what it needs from the database

**For:** Nayan Ahuja
**From:** Tushar
**Date:** 4 September 2026
**Branch:** `TusharPanwar` @ `154928f`

---

## The short version

**No new migrations.** Everything built since the 3 September handover runs on
tables you already have. The eight files from last time are still waiting, and
they are the same eight — nothing has been added to the pile.

There is **one new question for you**, in §4: the ESS inbox tables exist but
`anon` cannot read them, and what the fix should be is your call, not mine.

---

## 1. What I verified in the live database today

I probed rather than assumed, because the previous handover's list was a month
of assumptions old and I had already written UI copy based on a wrong guess.

### Applied and working

| Migration | Evidence |
|---|---|
| `066_pms_module` | all 15 `pms_*` tables readable — **3 policies, 12 periods, 395 enrolment rows** |
| `067_pms_org_chain_resolution` | `departments.hod_employee_id` selectable |
| `068_pms_setup_data` | `pms_rating_scale` has **15 rows** |
| `076_pms_persist_scores` | `pms_overall_rating.self_score` selectable |
| `077_company_profile_full` | `company_contacts` readable |
| `078_company_documents_policies` | `company_documents` readable |
| `080_ess_inbox` | tables exist — **but see §4** |
| `081_registration_documents` | `registrations.document_path` selectable |

### Still not applied

`074` · `075` · `079` · `082` · `084` · `085` · `086` · `087`

Each confirmed by `PGRST205 — Could not find the table … in the schema cache`
on a table that file creates. Same eight as 3 September.

> **A caveat I owe you.** My first probe reported six of those eight as
> *applied*. It used `head: true` with `.limit(0)`, and that combination
> swallowed the error and returned a clean empty result. The second probe —
> a real `SELECT` alongside the count — showed `PGRST205` on all six. I am
> telling you this because if I had not re-run it, this document would have
> confidently told you the opposite of the truth. The numbers above come from
> the second method, cross-checked two ways.

### One thing I still cannot determine

**Is `074` applied?** It creates three functions (`pms_open_period`,
`pms_validate_kras`, `pms_lock_kras`) and no tables. PostgREST returns
`PGRST202` both for "no such function" and for "function exists but you called
it with the wrong arguments", so a probe cannot separate the two. Running `074`
again is harmless — it is `CREATE OR REPLACE` throughout — so the safe move is
to run it and not worry about which case it was.

---

## 2. What I built since 3 September

The whole PMS was rebuilt against `EZER-PMS-MODULE-SPEC-v2`. Three commits:

| Commit | What |
|---|---|
| `1a93d06` | policy resolution, employment flags, bulk upload, PIP state machine |
| `f44d76e` | HR Admin screens rebuilt to the mockup's layout in EZER's colours |
| `e8bc47d` | employee, RM and HOD sides — §3, §4 and §5 |
| `154928f` | two bugs found by probing your database (below) |

**None of it needs a schema change.** It reads and writes only columns that
`066` already created. The one write I corrected was an INSERT that was
missing `period_id` — see §3.

### Where each surface lives

- **Performance** in the main menu → HR Admin (six tabs, spec §6)
- **ESS portal → Performance** → employee, and the RM and HOD tabs when the
  org chart says somebody holds those roles

---

## 3. Two bugs your data exposed

Both were invisible in the code and obvious the moment I looked at real rows.

**The period was not necessarily the employee's.** Each company runs its own
policy and therefore its own periods — you currently have three open Q2 rows,
one per company. The query picked the open period with `limit(1)` and no
company filter, so it returned whichever sorted first. Two employees in three
would have seen a period belonging to another company, and the KRA set,
one-to-one log, self rating and result all hang off that choice. Now filtered
by the employee's `company_id`.

**KRAs were being inserted without `period_id`.** Every other query filters on
it, so a saved set could never be read back — it would have gone in and
vanished, and the employee would have written their KRAs a second time. This
is why `pms_employee_goals` has **0 rows** and everything else has data;
nobody has successfully saved a KRA set yet. Worth knowing before you conclude
that people simply have not started.

---

## 4. The one thing I need a decision on

`inbox_conversations` and `inbox_messages` exist, but reading them as `anon`
returns:

```
42501 — permission denied for table inbox_conversations
hint: Grant the required privileges to the current role with:
      GRANT SELECT ON public.inbox_conversations TO anon;
```

`080_ess_inbox.sql` issues **no GRANT and creates no RLS policy** — I checked
the file. So the tables were created without either, and PostgREST cannot
reach them. Every other table in the project is readable, so something grants
by default and these two missed it; I cannot tell from outside which.

**This is your call and I have not written a migration for it.** The house
rule is that a new table's RLS policy gets decided by you rather than copied
from an older file, and an inbox is exactly the table where "allow all" is the
wrong default — these rows are private messages between named employees.

Three options as I see them, worst to best:

1. `GRANT SELECT … TO anon` with no RLS. Every employee can read every
   conversation in the company. Please do not.
2. Grants plus RLS scoped to participants — a row is visible if the reader is
   its sender or recipient. This is what the feature assumes.
3. Route all inbox reads through a `SECURITY DEFINER` function and grant
   nothing directly. Tightest, most work.

Tell me which and I will write the file.

---

## 5. Two numbers that must never move

Restating these because they are the sort of thing a well-meaning change
breaks quietly.

**`payout_linkage_enabled` is pinned false by a CHECK constraint.** The PMS is
developmental — the rating has no link to increment, variable pay, bonus or
CTC. Turning it on would need a migration that drops the constraint, and that
is a product decision, not a config one. Additional benefits stay
recognition-only: certificate, nomination, award, no cash component.

**There is no `083`.** The number is deliberately skipped. If you see a gap in
the sequence, that is why, and nothing is missing.

---

## 6. Do not run these

- **`055`, `056`, `057`** — an old, already-rolled-back RMS attempt occupies
  those numbers on this branch. The PMS module was renumbered `055 → 066`,
  `056 → 067`, `057 → 068`. Running the 055-057 files would apply a
  superseded schema on top of a live one.
- **`079_pms_module_v2.sql`** from the PMS spec folder. It carries the same 15
  tables as `066`, which you have already applied. On this branch `079` is
  `group_profile`, an unrelated file. Adding the spec's copy as `079` would
  collide with it.
