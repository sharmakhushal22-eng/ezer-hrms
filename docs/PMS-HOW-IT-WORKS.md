# PMS — how it works

**For:** Nayan Ahuja
**Date:** 4 September 2026
**Branch:** `TusharPanwar`
**Covers:** migrations `066`, `067`, `068`, `074`, `076` and the v2 rebuild on them

---

## 1. The headline: there is nothing to run

Every PMS migration is **already applied**. I verified each one against the
live database rather than carrying the previous list forward:

| Migration | Evidence |
|---|---|
| `066_pms_module` | all 15 `pms_*` tables and all **10 views** readable |
| `067_pms_org_chain_resolution` | `departments.hod_employee_id` selectable |
| `068_pms_setup_data` | 15 rating bands, **120 KRA library rows** |
| `074_pms_not_found_guards` | all three functions answer when called |
| `076_pms_persist_scores` | `pms_overall_rating.self_score` selectable |

**`074` was previously reported as undetermined. It is applied.** The earlier
handover said PostgREST cannot tell "no such function" from "wrong arguments",
which is true — but calling each function with its *documented* arity settles
it, and all three returned real answers.

Live data today: **3 policies · 12 periods · 15 rating bands · 120 KRA library
rows · 524 enrolment rows.** No KRAs, one-to-ones or reviews yet — see §5.

---

## 2. What v2 changed, and why none of it needed schema

The whole PMS was rebuilt against `EZER-PMS-MODULE-SPEC-v2`. It reads and
writes only columns `066` already created, so **no migration accompanies it.**

**The one rule that must never move:**

```sql
payout_linkage_enabled boolean NOT NULL DEFAULT false
                       CHECK (payout_linkage_enabled = false)
```

The PMS is developmental. The rating has no link to increment, variable pay,
bonus or CTC, and additional benefits stay recognition-only — certificate,
nomination, award, no cash component. Turning it on would take a migration
that drops the constraint, which is a product decision rather than a config
one.

---

## 3. The four rules that carry real risk

Built as pure, tested logic rather than conditions inside a screen:

**Policy overlap** — the narrowest match wins: `location > grade > department
> all`, so a Sales person at the Pune plant follows Pune, not Sales. Rule 14
says exactly one active policy, so **a tie is refused rather than guessed** —
two policies of equal narrowness is a configuration mistake, and silently
picking one only surfaces when an appraisal routes to the wrong manager.

**Employment flags** — `EXITED` is decided **before** `NOTICE_PERIOD`, because
somebody who has already left also has a resignation date; checking notice
first leaves a departed employee in the active queue counting down to a date
that has passed. Notice rows sort **above** exited ones — theirs is the
deadline that cannot move.

**Bulk rating upload** — all four blocking errors, and the commit is refused
while any row fails. A half-applied upload leaves some people on the system's
rating and some on the spreadsheet's, with nothing on screen to say which. An
override reason is owed only where the rating actually **changes**; demanding
one on an unchanged row trains people to type "n/a".

**PIP** — an RM raises a request and **cannot initiate**, enforced in the model
rather than by hiding a button. The PIP is the documentation trail that
answers a claim under the Industrial Disputes Act, and HR gatekeeping is what
keeps it consistent enough to rely on.

---

## 4. Where each surface lives

**Performance** in the main menu is the **HR Admin** side — the six tabs of
spec §6: Cycle setup · Policies · Who has filled · Rating upload · PIP ·
Reports.

**ESS portal → Performance** is the employee's own side, and grows RM and HOD
tabs when the org chart says somebody holds those roles. Roles are *derived*
from the org columns rather than read from `user_roles`, which has no rows —
somebody is an RM because people report to them, which is more truthful than a
flag that can disagree with the hierarchy.

Whose appraisals belong to a manager comes from the **frozen chain** on
`pms_overall_rating` (`rm_l1_id`, `rm_l2_id`, `hod_id`), not a live lookup: a
reorg mid-cycle must not move half-rated appraisals between managers.

---

## 5. Two numbers not to misread

**`pms_employee_goals` is 0.** Nobody has written a KRA yet — and that was
partly a bug of mine: the INSERT was missing `period_id`, so every other query
(which filters on it) could never find what was saved. It went in and
vanished. Fixed on the branch. Read the zero as "not started", not as "not
working".

**`pms_overall_rating` is 524, and 129 of those are mine.** See §7.

---

## 6. What is NOT built

- **The AI layer** (§13) and **notifications** (§12) — both Phase 6 in the
  spec's own sequence
- **The 14 reports** — the catalogue renders; the exports are not wired
- **Analytics widgets** for RM and HOD beyond the distribution and category
  bars
- **Rate-a-reportee and HOD feedback saves** — the screens render and validate
  correctly, but their write handlers are stubs. I would rather wire them
  against real rows than guess at the shapes.

---

## 7. Something I got wrong, and the fix

While probing which functions existed, I called `pms_open_period()`. I treated
it as a read because I was testing for the function's *existence*, and did not
check what it does first. It opens a period and enrols everybody eligible.

It opened **Q1 FY2026-27 for one company** (`SCHEDULED → KRA_SETTING`) and
created **129 `pms_overall_rating` rows**.

Nothing else changed — all 129 are `NOT_STARTED` with null scores, that period
had zero rows beforehand, and goals and reviews are still empty company-wide.

`fix/UNDO-accidental-open-period.sql` reverses it, filtered by the period id
and the timestamp of my call so nothing of yours is caught. **Running it is
your call** and it is defensible either way — Q1 is a period that has already
passed, so an open period with nothing filled in is wrong but harmless.

---

## 8. Do not run these

- **`055`, `056`, `057`** — an old, already-rolled-back RMS attempt holds those
  numbers on this branch. The PMS module was renumbered `055 → 066`,
  `056 → 067`, `057 → 068`. Running them would apply a superseded schema on
  top of a live one.
- **`079_pms_module_v2.sql`** from the PMS spec folder — same 15 tables as
  `066`, which is applied. On this branch `079` is `group_profile`.
