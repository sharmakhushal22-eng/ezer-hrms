# PMS — how it works

The Performance module, end to end: what it does, the sub-modules it is made
of, every rule it enforces, and the arithmetic behind a rating.

**Written 2026-11-06.** Every number below is read from the live database or
the source, not recalled. This replaces a 151-line version that predated
approval chains, the HR Head, and KPIs.

---

## 1. What this module is

It runs an appraisal cycle for ~400 employees across three companies sharing
one database. An employee writes KRAs, agrees them with their manager, rates
themselves; the appraisal then travels an approval chain; somebody finalises a
rating; HR writes feedback and publishes it.

**It is developmental.** `payout_linkage_enabled` is pinned `false` by a CHECK
constraint — no screen, admin or API call can turn it on. Ratings are not
linked to increment, variable pay, bonus or CTC.

### The one rule everything else hangs off

> **ENGINE COMPUTES, SQL DECIDES.**
>
> Every function in `lib/pms/` is a *prediction* about what the database will
> do, used to decide which buttons appear and what the refusal will say —
> before anybody presses anything. The database re-checks all of it in
> triggers and functions and cannot be talked out of it by a client.
>
> **When the two disagree, the TypeScript is wrong.**

### Live, at the time of writing

| | |
|---|---|
| Active employees | 398 |
| Appraisals (`pms_overall_rating`) | 395 |
| KRAs · KPIs · ratings | 48 · 48 · 92 |
| Published · acknowledged | 5 · 3 |
| **Never submitted** | **388** |
| Logic modules · test files · tests | 27 · 52 · **1,045 passing** |
| Migrations | through **220** |

The cycle has barely begun: 123 of 133 people in the current period have not
written a KRA. The module is build-complete and **has never run a full cycle
at scale.**

---

## 2. Sub-modules

### Logic — `lib/pms/`, 27 files, no I/O anywhere

Every module is pure: no Supabase import, no `Date.now()`. `today` is always
passed in, because a rule that reads the clock is untestable and differs
between server and browser render.

| Module | What it owns |
|---|---|
| `hierarchy.ts` | Who may do what (§1, §2); the role matrix; chain presets |
| `chain.ts` | Where an appraisal sits and which way it moves |
| `chainBuilder.ts` | Composing a custom chain, and refusing a bad one |
| `scoring.ts` | Ratings → score → meaning; bands, gaps, tone |
| **`kpi.ts`** | **KPIs under a KRA, and the weightage they share** |
| `kra.ts` | The KRA set (§3.2) |
| `cycle.ts` | Where the cycle is and what you owe it |
| `team.ts` | The two manager queues (§4.1, §5.1) |
| `policy.ts` | Which policy covers an employee |
| `employment.ts` | The four employment flags (§8) |
| `publishGate.ts` | What stops a result going out |
| `authority.ts` | What the HR Head may do, from the policy |
| `hrFinal.ts` · `hrDirect.ts` | Settling a rating; building one outside the chain |
| `hrQueue.ts` · `bulkPublish.ts` · `upload.ts` | HR's queues and bulk actions |
| `oneToOne.ts` | The discussion log and the two gates it controls |
| `pip.ts` | The PIP state machine (§7) |
| `training.ts` · `trainingAi.ts` | Training recommendations and AI suggestion |
| `postFinal.ts` · `rollup.ts` · `status.ts` · `language.ts` · `csv.ts` · `adminClient.ts` | Ownership after settlement, roll-ups, vocabularies, wording, CSV, the admin API client |

### Screens

| Surface | File | Lines |
|---|---|---|
| HR dashboard (11 tabs) | `app/dashboard/pms/page.tsx` | 1,794 |
| Employee + manager (ESS) | `components/ess/Performance.tsx` | ~2,870 |
| HR tab bodies | `components/pms/AdminTabs.tsx` | 3,187 |
| Manager review surfaces | `components/pms/ManagerTabs.tsx` | 2,973 |
| **Setup & Controls (the only writing tab)** | `components/pms/AdminEditor.tsx` | 1,577 |
| Employee KRA/rating tabs | `components/pms/EmployeeTabs.tsx` | 1,229 |
| Cycle header · stepper · stats · next action · overview | `components/pms/*.tsx` | ~1,160 |
| Styles, scoped under `.pms` | `components/pms/pms.css` | ~2,020 |

### API — two routes

- **`/api/pms/admin`** — `GET` returns everything the editor renders;
  `POST` performs one write from a 15-action allowlist.
- **`/api/pms/training-ai`** — AI training suggestions from anonymised
  rating context.

No component writes to Supabase for admin configuration: the actor must come
from the session, and the route allowlists which columns may be set.

---

## 3. The eleven HR tabs

| Tab | What you go there to do |
|---|---|
| This cycle | Where the whole organisation has got to |
| PMS Configuration | Frequency, windows, the KRA rules everyone is held to |
| **Setup & Controls** | The only tab that writes — 8 panels |
| Policy Builder | Different cycles for different groups |
| Fill Status Tracker | Live status for everyone, and who to chase |
| Publish Results | Settled ratings: feedback, recognition, release |
| Ratings Summary | Every rating and where the appraisal stands |
| Final Rating Upload | Bulk override from an offline calibration |
| PIP Management | Requests from managers, plans you have started |
| Reports & Export | Fourteen reports, Excel export |
| Flow & Hierarchy | The twelve steps, the reporting line, who may do what |

**Setup & Controls panels:** Policy rules · Approval chains · Rating scale ·
HR Head authority · KRA library · Training catalogue · Cycle control ·
Finalise.

---

## 4. Data model — 21 tables

All prefixed `pms_`, all carrying `company_id`. Three companies share this
database and employee codes repeat across them, so a query without a company
filter is a bug.

```
pms_policies ─┬─ pms_periods ──── pms_overall_rating      (the appraisal)
              ├─ pms_rating_scale                         (the bands)
              └─ pms_chain                                (composed chains)

pms_employee_goals  (the KRA)
      └── pms_goal_kpi  (its KPIs)  ←── pms_reviews  (one per KPI per rater)

pms_one_to_one · pms_feedback · pms_training_recommendation
pms_pip ─┬─ pms_pip_areas
         └─ pms_pip_reviews
pms_kra_master · pms_training_catalogue · pms_training_suggestion
pms_additional_benefits · pms_rating_upload_log · pms_audit_log
```

### The three that carry the work

**`pms_employee_goals`** — one row per KRA: title, category, **weightage**,
status, lock state, HR override fields.

**`pms_goal_kpi`** *(migration 220)* — one row per KPI: `goal_id`, `seq_no`,
`kpi_metric`, `target_value`, **weightage** (a share of its KRA's).

**`pms_reviews`** — one row per **KPI** per rater:
`UNIQUE (period_id, employee_id, kpi_id, rater_role)`.
`rater_role` ∈ `SELF · RM_L1 · RM_L2 · HOD · MD · HR_HEAD · SITE_HR · REGIONAL_HEAD`.

### Three columns worth understanding

**`chain_stage` is nullable, and NULL is not `'EMPLOYEE'`.** NULL means *not
submitted*; `'EMPLOYEE'` means *sent back after a rejection*. On a queue those
look identical otherwise, and only one is somebody's fault.

**`chain_shape` + `chain_snapshot_at`** freeze the chain per appraisal at
submission, which is what lets an administrator edit a chain without
disturbing work in flight.

**`chain_final_rating` is not `final_rating`.** It holds what the *chain*
settled, so when the HR Head overrides, both numbers survive.

### Database functions

36 defined; **9 called from application code**:
`pms_chain_submit · pms_chain_approve · pms_chain_reject · pms_finalise ·
pms_open_period · pms_generate_periods · pms_lock_kras · pms_hr_kra_action ·
pms_commit_rating_upload`.

The other 27 are triggers and helpers enforcing the rules regardless of caller
— the "SQL DECIDES" half.

---

## 5. THE MATHEMATICS

### 5.1 Weightage — one number, one total

```
Across KRAs      Σ w_kra  =  100     exactly, to submit  (policy.total_weightage)
                 Σ w_kra  ≤  100     while still being typed
Within a KRA     each KPI gets  w_kra / n      — computed, never stored
Therefore        Σ shares =  100     across the whole appraisal, always
```

**There is only one number to balance.** 220 and 221 gave each KPI a stored
weightage that had to sum to its KRA's; 222 removed it. An equal share
*cannot* fail to add up, so the second rule stopped being a rule and became
arithmetic.

Going over 100 while typing is **allowed** — the total turns red and says by
how much, and the submit stays shut. A hard cap on the input would mean you
could not raise one KRA before lowering another.

Also enforced: `count` between `min_kra_count` and `max_kra_count` (4 and 10),
and every KRA ≥ `min_weightage_per_kra` (5).

**How many KPIs a KRA may hold is policy too** *(migration 221)* —
`min_kpi_per_kra` and `max_kpi_per_kra`, **1 and 5 by default**, edited in
Setup & Controls beside the KRA counts.

The two ends are enforced in different places, and the asymmetry is the point:

| | Where | Why there |
|---|---|---|
| **Maximum** | `trg_pms_kpi_count`, `BEFORE INSERT` on `pms_goal_kpi` | The sixth INSERT is the one to refuse, exactly and cheaply. |
| **Minimum** | `pms_validate_kpis`, read by `pms_lock_kras` | Nothing fires when a KRA has *no* KPIs — zero rows, zero trigger calls — so a floor can only be checked when somebody asserts the set is finished. |

> **A floor enforced per-INSERT would refuse the first KPI of every KRA**,
> because one is fewer than one until the row lands.

The trigger is **INSERT-only** so that lowering the maximum never bricks data:
a KRA already holding five KPIs keeps them and stays editable when the limit
drops to three — only a *sixth* is refused. `pms_policies_kpi_range` refuses an
inverted pair (min 5 / max 3), which would otherwise make every KRA
simultaneously too small and too large.

### 5.2 The appraisal score

For a given rater role, over **rated, submitted** KPIs only:

```
                Σ ( rating_kpi × share_kpi )                    weightage_kra
  score    =    ────────────────────────────   where  share  =  ─────────────
                      Σ share_kpi                               n_kpis_in_kra
```

Computed independently for `self`, `rm_l1`, `rm_l2`, `hod`, and `final`.

> **Unrated KPIs leave the denominator; they are not zero.** A half-rated
> appraisal shows the average of what has been rated, not a number dragged
> toward zero by work nobody has looked at yet. `null` when nothing is rated —
> *"not rated"* and *"rated badly"* are different answers.

**This formula did not change when KPIs arrived, nor when their weightage
left.** It is a weighted mean and cannot tell whether its weights came from 4
KRAs or 11 KPIs that add up the same.

- **220** gave every existing KRA one KPI carrying its whole weightage — every
  score on record stayed identical, verified across 23 appraisal/rater
  combinations, largest difference **0**.
- **222** replaced the stored `weightage_kpi` with `weightage_kra / n`. For a
  KRA with one KPI, `w/1 = w`, so the two are the same number and every score
  stayed identical again. Only a KRA somebody had built with *uneven* KPI
  weightages moves, and `222_pms_kpi_share_verify.sql` names each one.

> **A KPI has no weightage of its own.** Only KRAs do. `pms_goal_kpi.weightage`
> still exists and still holds whatever was written into it before 222 — it is
> **retired, not dropped**, and read by nothing. The share is computed afresh
> on every read, which is why it cannot fail to add up.

### 5.3 A KRA's own rating, rolled up from its KPIs

```
                      Σ rating_kpi
  rating_kra  =    ─────────────────      over that KRA's RATED KPIs
                   count of rated KPIs
```

A **plain mean**, because the KPIs under a KRA carry equal share — weighting
by an equal weight is the same as not weighting, and `(4w + 3w + 5w) / 3w`
reduces to `(4 + 3 + 5) / 3`.

**Worked example** — a 30% KRA with three KPIs:

| KPI | Share | Rating |
|---|---|---|
| Cycle-count variance | 10 | 4 |
| Shrinkage value | 10 | 3 |
| Count completion on time | 10 | 5 |

```
  (4 + 3 + 5) / 3  =  12 / 3  =  4.00
```

**Part-rated is an average, not a zero.** With the third KPI unrated, the KRA
shows `(4 + 3) / 2 = 3.50` — the unrated measure leaves the divisor. Counting
it as zero would show `2.33`, a verdict nobody gave.

> **The share is not rounded.** A 10% KRA across three KPIs is 3.333…% each;
> rounding to 3.33 would lose 0.01 of the KRA every time and the appraisal
> would stop totalling 100. Only the *display* rounds.

### 5.3a What stops a submission

Three rules, one gate — `submitGate()` in `lib/pms/kpi.ts`, and
`pms_chain_submit` / `pms_chain_approve` in SQL (222):

| | Rule | Refused by |
|---|---|---|
| 1 | Weightage totals **exactly 100**, KRA count within the policy, none below the minimum | `pms_validate_kras` → `pms_lock_kras` |
| 2 | Every KRA has its **minimum KPIs**, none over the maximum, each with a measure written | `pms_validate_kpis` → `pms_lock_kras`; `trg_pms_kpi_count` on the write |
| 3 | **Every KPI is rated** — by the employee to submit, and by each rung to approve | `pms_unrated_kpis` → both chain gates |

> **Every rung rates every KPI.** `pms_chain_submit` previously checked only
> that *some* self score existed, and `pms_chain_approve` checked nothing at
> all — a manager could pass an appraisal on having rated none of it, and the
> finaliser would average whatever happened to be there. HR is exempt,
> because HR's move at that stage is publication and changes no rating.

The screen shows **every** reason the button is off, in the order to fix them:
weightage and counts first, then KPIs, then ratings — rating a set you are
about to add a KRA to is wasted work.

### 5.3b The manager's rating stepper

A rater works through the set **one KRA at a time**; a reader gets the whole
record at once. Rating is not reading, and paginating a record away from
somebody who opened the panel to look is worse than a long page.

```
 3 of 5 rated · 2 to go  ▓▓▓▓▓▓░░░░   [1] [2] [✓]   2 need a reason

 KRA 1 of 2                                   1 of 2 KRAs done
 ┌─────────────────────────────────────────────────────────────┐
 │ 1  Close the month-end books in three days            60%   │
 ├─────────────────────────────────────────────────────────────┤
 │ Days to signed-off trial balance · target <=3 days    20%   │
 │ THEY SAID 4 Exceeds · Closed in 2.6 days on average         │
 │ YOUR RATING [5][4][3][2][1]                                 │
 │ [ why — they will read this                             ]   │
 └─────────────────────────────────────────────────────────────┘
 This KRA so far  4.00   3 of 3 measures rated
                                   [ ← Back ]  [ Next KRA → ]
```

The last step is a **review of every KRA with its rolled-up rating**, because
a stepper's real weakness is that you cannot compare KRA 1 against KRA 6 while
deciding. Any row there jumps back to that KRA.

> **The chips are the only progress control.** The first draft put a second
> row of dots inside the stepper, beside the panel's existing per-KRA chips —
> two controls for one position, each able to be right while the other was
> wrong. The chips drive the stepper; the stepper holds no position of its own.

Every count on the panel — the bar, the chips, the "needs a reason" pill, the
unsaved-work guard, the footer and the approval gate — is derived from **one**
`compareRatings` call over measures. They each derived their own before, and
the footer said *"2 still unrated"* while the bar said *"5 to go"*.

### 5.4 Score → rating band

The band is the row whose window contains the score:

```
  band  =  the row where   score_from  ≤  score  ≤  score_to
```

Live scale (Sharma Retail Solutions, 5-point):

| Value | Code | Label | Window | Min comment | Improvement | PIP | Recognition |
|---|---|---|---|---|---|---|---|
| 5 | O | Outstanding | 4.51 – 5.00 | 200 | — | — | ✓ |
| 4 | EE | Exceeds Expectations | 3.51 – 4.50 | 100 | — | — | ✓ |
| 3 | ME | Meets Expectations | 2.51 – 3.50 | 50 | — | — | — |
| 2 | NI | Needs Improvement | 1.51 – 2.50 | 200 | **✓** | **✓** | — |
| 1 | U | Unsatisfactory | 1.00 – 1.50 | 200 | **✓** | **✓** | — |

So the 4.00 from §5.3 lands in **EE — Exceeds Expectations**.

A score outside every window **clamps** rather than returning nothing: a
rounding artefact of 5.01 must not leave a rating nameless.

### 5.5 Self-versus-final gap (§3.6)

```
  δ  =  self_score − final_score          (signed, 2 dp)

  |δ|  <  1     ALIGNED
  1  ≤ |δ| < 2  MINOR_GAP
  |δ| ≥  2      MAJOR_GAP
```

> A `MAJOR_GAP` is **not** a judgement about who is right. It means the two
> are measuring the same work differently, and the next one-to-one is where
> that gets resolved. The wording deliberately avoids implying the employee
> over-rated themselves — the manager may be the one who has not seen the
> work.

### 5.6 The suggested weightage split

Spread a total across *n* rows as evenly as whole numbers allow, remainder on
the **first**:

```
  base    = floor(total / n)
  out[i]  = base                     for all i
  out[0] += total − base × n         the remainder
```

`suggestSplit(100, 3) = [34, 33, 33]`. Always sums to the total exactly.
Offered as a starting point, **never applied silently**.

> This applies to **KRAs only**. `suggestKpiSplit` went with 222: a KPI has
> no weightage to suggest, and its share is `w_kra / n` whether anybody asks
> for it or not.

### 5.7 Rung coverage

For each rung, how many employees have somebody in it:

```
  coverage  =  count(employees where <column> IS NOT NULL  AND  date_of_leaving IS NULL)
               ───────────────────────────────────────────────────────────────────────
                             count(active employees)
```

Measured 2026-11-06 over 398 active employees:

| Rung | Column | Coverage |
|---|---|---|
| HOD | `hod_id` | 398 / 398 |
| RM L1 | `l1_manager_id` | 395 / 398 |
| Site HR | `site_hr_id` | 395 / 398 |
| RM L2 | `l2_manager_id` | 261 / 398 |
| Regional head | `regional_head_id` | **0 / 398** |

---

## 6. The life of an appraisal

```
┌─ ADMIN ──────────────────────────────────────────────────────────────┐
│ 1  Policy built                Setup & Controls                      │
│ 2  Periods generated           pms_generate_periods                  │
│ 3  Period opened               pms_open_period                       │
│      └─ enrols every eligible employee: one pms_overall_rating each, │
│         with rm_l1_id / rm_l2_id / hod_id resolved and FROZEN.       │
│         Not undoable from the screen.                                │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─ EMPLOYEE ───────────────────────────────────────────────────────────┐
│ 4  Writes 4–10 KRAs, each with its KPIs                              │
│      └─ Σ w_kra = 100 exactly;  Σ w_kpi = w_kra for every KRA        │
│ 5  One-to-one                  BOTH must acknowledge                 │
│      └─ editing a locked weightage REOPENS this (migration 206)      │
│ 6  KRAs locked                 pms_lock_kras                         │
│ 7  Self rating, per KPI        pms_reviews, rater_role = SELF        │
│ 8  Submits                     pms_chain_submit                      │
│      └─ chain_shape + chain_snapshot_at FROZEN here                  │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─ THE CHAIN ──────────────────────────────────────────────────────────┐
│ 9  Each rung in turn rates every KPI, then                           │
│      approves  → chain_stage := nextRung(…)   ← SKIPS empty rungs    │
│      or rejects → chain_stage := prevRung(…)  ← reason mandatory     │
│                                                                      │
│ 10 The LAST reviewer finalises. approvalFinalises() is true when     │
│    nextRung() === 'HR', which is what makes the button read          │
│    "Approve & finalise" and ask for a rating.                        │
└──────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─ HR ─────────────────────────────────────────────────────────────────┐
│ 11 HR Head settles the rating   may KEEP or OVERRIDE the chain's     │
│                                 number; both are preserved           │
│ 12 Feedback written             appreciation + improvement           │
│ 13 Published                    publishFaults() must be empty        │
│ 14 Employee acknowledges        and can never be un-acknowledged     │
└──────────────────────────────────────────────────────────────────────┘
```

### The special case: an HR-direct appraisal

The HR Head can build an appraisal for somebody the cycle never picked up —
KRAs, ratings, a final rating, published — bypassing the chain. Three rules
bend, each discovered by *running the write* and hitting the next blocker:

| Migration | What it waived |
|---|---|
| 212 | `pms_block_unsigned_publish` — one line: `IF hr_direct THEN RETURN NEW` |
| 213 | `pms_check_self_first` — there is no self rating to require |
| 214 | `pms_reviews.rater_role` widened to accept `HR_HEAD` |

---

## 7. Read and write paths

### Read

```
HR dashboard      page.tsx  →  pms_policies + pms_chain(name, rungs)
                              pms_periods, pms_overall_rating ⨝ employees

ESS / manager     Performance.tsx  →  one query carrying the policy AND the
                  chain it points at, plus goals AND their KPIs in the same
                  round trip
```

> **A screen that knows the KRAs but not their KPIs can draw a form it cannot
> save.** Since 220 a rating names a KPI (`kpi_id` is NOT NULL), so the KPIs
> load with the goals.

### Write

```
Browser → lib/pms/adminClient.ts → POST /api/pms/admin
            └─ gate()                    permission
            └─ pick(body, <TABLE>_COLS)  column allowlist
            └─ validate                  refuse with a sentence
            └─ service client → triggers re-check everything
```

**The actor is never read from the body.** It comes from the bearer token;
`pms_hr_kra_action` and `pms_finalise` record who acted, and a
caller-supplied actor would make that record worthless.

### Three places a value can silently stop moving

Each has caused a reported bug here:

1. **The column allowlist.** A new `pms_policies` column is inert until named
   in `POLICY_COLS` — the screen saves into nothing. *Happened twice.*
2. **The read's select list.** A column not named in `.select()` is not there.
   Omit `pms_chain(rungs)` and every custom chain silently falls back to the
   preset — correctly, and uselessly.
3. **A control that only sets React state.** The Config tab's frequency
   dropdown redrew the preview and saved nothing.

---

## 8. The rules and gates

### Who may do what

`may(role, action)` returns **three** values — `yes` / `no` / **`policy`** —
over 7 roles × 17 actions. Only `finalise_rating` is `policy`.

> A screen that treats ⚙️ as ✅ lets an RM L1 finalise under a `HOD_ONLY`
> policy; treating it as ❌ hides the button from the person the policy
> appointed. Both wrong, so the type forces the caller to handle the third.

**Finalisation is deliberately not a role permission.** The authority to
finalise *one* appraisal is three things at once: the policy's
`who_can_finalise`, the role matrix, and **holding that employee's rung in the
frozen chain**. Only the third decides whether a particular HOD may settle a
particular person, and a role toggle cannot express it.

### The publish gate — one shared function, four screens

A result is blocked when **any** holds:

1. No final rating
2. No appreciation remark
3. Improvement feedback missing while the band requires it
4. The HR Head has not settled the rating (when the policy requires it)
5. The final-review one-to-one is not acknowledged — *waived for an
   HR-direct appraisal, where there is no manager who could have had it*

Returns the **list**, never a boolean, because every caller shows the reasons.

### HR Head authority — configuration, not code

| Power | Column | Default |
|---|---|---|
| Settle the final rating | `hr_head_final_rating` | true |
| Override the chain's number | `hr_head_can_override` | true |
| Build outside the chain | `hr_head_can_direct` | true |
| Commit a rating upload | `rating_upload_by` | `HR_ANY` |

**The role comes first; the policy only narrows it.** And every default is
*today's behaviour*:

> A permissions layer that fails closed sounds safer and is not: it would stop
> a cycle the moment a policy row could not be read, and the people it stops
> cannot fix it. Failing to the status quo is the honest default.

### Employment flags (§8)

`ACTIVE` · `NEW_JOINER` (within `new_joiner_cutoff_days` of period end → Not
Rated) · `NOTICE_PERIOD` · `EXITED` (read-only once finalised).

---

## 9. Approval chains

**Three presets** — `SELF_RM1_RM2_HOD`, `SELF_RM1_HOD`, `SELF_RM1` — or a
**composed chain** built in Setup & Controls (migrations 218/219).
`chain_id` is nullable; NULL falls back to the preset.

A rung must resolve to a *person* through a column on `employees`, which is
why the menu is five fixed choices and not free text.

### The rule that makes it work

> **An empty rung is stepped over, not blocked on.**

`pms_resolve_chain` drops RM L2 when it resolves to the same person as RM L1,
so **137 of 398** employees have `rm_l2_id = NULL` on a chain that names it.
Walking the chain without asking who fills each rung would park a third of the
company on a rung with nobody on it — a permanent deadlock on the first
approval. It matters *more* going backwards: a rejection that strands an
appraisal on nobody leaves the employee waiting for a correction that can
never be made.

**HR is always last**, appended if a composed chain omits it: nobody should be
able to build a chain whose results can never be published.

---

## 10. Where it stands

### Built and verified

Everything above. 1,117 PMS tests, migrations through 222, production build
compiles, `tsc` at the project's 39-error baseline.

### Not finished

| | |
|---|---|
| **Never run** | 388 of 395 appraisals never submitted. `pms_chain`, `pms_training_catalogue`, `pms_training_suggestion` and all three PIP tables are **empty** — the chain builder, the AI bin and the whole PIP flow have never been exercised on real data. |
| **Rule 6 is dead code** | `canManagerRate` ("a manager cannot rate before the self rating") is defined and called from nowhere. SQL enforces it, so a manager meets a raw database refusal instead of a disabled button with a sentence. |
| **A contradiction** | `EmployeeTabs` tells employees recognition is *"never a cash component"*, while `RECOGNITION_LABEL` offers raters **"Salary bonus"** and **"Out-of-cycle increment"**. One of the two is wrong — a product decision, not a bug to pick quietly. |
| **Contrast unverified** | The audit cannot parse `color(srgb …)`, how Chrome serialises `color-mix()`. Hand measurements passed; the module is not cleared. |
| **An unexplained anomaly** | Five `DISMISSED` training-suggestion rows appeared when one was dismissed by hand. Cause never found; migration 216 instrumented it so a recurrence is answerable. |
