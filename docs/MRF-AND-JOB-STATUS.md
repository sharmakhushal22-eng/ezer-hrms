# MRF & Job Status — Change Log and Reference

Covers the Manpower Requisition (MRF) rework and the new Job Status tab in
**Recruitment & ATS** (`app/dashboard/recruitment/page.tsx`).

**Last updated:** 17 August 2026

---

## 1. Migrations — run these first

| File | Adds | Required? |
|---|---|---|
| `supabase/migrations/047_mrf_columns.sql` | 29 columns on `manpower_requisitions` | **Yes** — the form cannot save without them |
| `supabase/migrations/048_mrf_lookups.sql` | Business Unit / Cost Center / Currency master values | Optional — those three dropdowns read "No options configured" until run |

Both are applied on the current database. Both are idempotent and end with a
verify block. Run the **whole file** — the Supabase SQL Editor executes only the
highlighted text if there is a selection, which is the usual reason a migration
appears to do nothing.

### Columns added by 047

```
§1 Meta          raised_by_name, raised_by_role
§2 Position      job_title, business_unit, grade, job_code,
                 reporting_manager_id, reports_to_designation
§3 Employment    work_mode, shift_schedule
§4 Budget        cost_center, is_budgeted, headcount_ref, currency,
                 compensation_type, pay_period, duration_months, duration_end
§5 Justification outgoing_employee_id, exit_reason, business_justification
§6 Timeline      target_joining_date, validity_date
§7 Requirements  good_to_have_skills, ctq_questions (JSONB)
§8 Approval      approval_chain (JSONB)
§9 Sourcing      sourcing_channels (JSONB), sourcing_mode
§10 Attachments  attachments (JSONB)
```

Reused as-is, not duplicated: `mrf_number` (requisition ID), `created_at`
(date raised), `urgency` (priority), `hiring_type` (requisition type),
`employment_type`, `budget_min/max`, `skills_required`, `job_description`,
`status`, `remarks`, `assigned_recruiter`.

---

## 2. MRF — what changed

### 2.1 Approval was unreachable (fixed)

`ApprovalModal`, `approveMRF()` and `rejectMRF()` existed but nothing ever
opened the modal — `setApprovalModal` was only ever called with `null`. A
submitted MRF showed the text *"Awaiting HR Head approval"* with no way to act
on it, so requisitions could be raised and never approved.

Submitted and on-hold cards now carry a **✅ Review & Approve** button.

### 2.2 Approval is a single click

Approving marks the requisition `APPROVED` immediately. Any configured chain is
stamped complete by the same approver, with their name, comments and timestamp,
so the recorded trail matches the decision instead of leaving steps `PENDING`
on an MRF that is already open for hiring. Steps approved earlier keep their
original approver.

The modal also offers **⏸ Hold** and **❌ Reject**; reject requires a reason.

### 2.3 The form follows the ten-section spec

Restructured to `mrf-module-spec.md` §2:

1. Requisition Meta · 2. Position Details · 3. Employment Details ·
4. Budget & Cost · 5. Justification · 6. Timeline · 7. Candidate Requirements ·
8. Approval Workflow · 9. Sourcing · 10. Attachments

Quick Hire deliberately hides sections 7 and 9 — those are Full MRF concerns.

### 2.4 Compensation follows employment type

Budget & Cost relabels itself rather than calling everything "Salary":

| Employment type | Paid as | Quoted | Duration |
|---|---|---|---|
| Employee | Salary | per annum | — |
| Intern | Stipend | per month | **required** |
| NAPS / NATS | Stipend | per month | **required** |
| Live Project | Stipend | per month | **required** |
| Contract | Fees | per month | **required** |
| Consultant | Fees | per month | optional |

`compensation_type` and `pay_period` are **stored**, not re-derived, so a
requisition keeps the basis it was raised on if the mapping later changes.

Fixed-term engagements show **Internship / Engagement Duration (months)** plus a
read-only **Expected End Date** derived from target joining date + duration.
Month-end is clamped: 31 Jan + 1 month → 28 Feb, not 3 March.

### 2.5 Quick Hire and Full MRF do not overlap

```
Quick Hire   CTC ≤ ₹6,00,000
Full MRF     CTC >  ₹6,00,000
```

Enforced in both directions, live as the budget is typed, with a one-click
**Switch to …** button. Monthly stipends and fees are **annualised** first
(×12) so the same ₹6L boundary means the same thing whatever the employment
type — ₹50,000/mo (₹6.0L/yr) stays Quick Hire, ₹60,000/mo (₹7.2L/yr) does not.

### 2.6 Requisition Overview

Above the list: **Total MRFs · Open Positions · Available to Hire · Pending
Approval · Approved**, plus **Expiring Soon** when something falls due within
14 days.

*Available to Hire* = openings on `APPROVED` MRFs minus candidates already at
`Offer Sent` or `Joined` — what a recruiter actually works from. Drafts and
rejected requisitions contribute nothing.

Also: a proportional status bar, clickable status chips with counts, and a
**▦ Cards / ☰ List** toggle. List view is a compact table with an inline
**Review** button on pending rows.

### 2.7 Detail drawer

Clicking a card opens a right-hand drawer: all ten sections, skills as chips,
the full JD, the approval chain with per-step approver and comments, linked
candidates grouped by pipeline stage, and an activity timeline from
`recruitment_audit_logs`.

### 2.8 Other additions

- **CTQ screening questions** — repeatable group with an auto-reject flag
- **Approval hierarchy editor** — ordered, reorderable, per requisition
- **Sourcing** — internal/external plus preferred channels (reuses the
  `candidate_source` master)
- **Attachments** — org chart, budget approval, other files, via
  `app/api/recruitment/upload-mrf-doc/route.ts`
- **Validation** — inline field errors that clear on edit; drafts stay lenient,
  submission enforces department, reason, budget, target date and skills-or-JD
- **Filters and sort** — company, department, location, position, status;
  newest / oldest / most openings / most urgent / earliest joining
- **Lookups** reuse the existing masters: `grade`, `shift_type`,
  `candidate_source`, `separation_reason`, plus the three added by 048

### 2.9 Bug fixed: currency dropdown showed blank

Options carried the **label** (`"INR - Indian Rupee"`) as their value while
`onChange` stored only the first token (`"INR"`). On re-render the select could
not match `"INR"` to any option and fell back to the empty placeholder — the
value saved correctly but never displayed.

`MasterSelect` now takes a `useCode` flag so the stored value and the option
value are the same thing — the currency field passes it, everything else keeps
labels. Storing the code is also correct for `money()` / `lakh()`, which look up
the symbol by code (`INR → ₹`). The other four master dropdowns pass their value
straight through and were never affected.

---

## 3. Job Status — new tab

Sits last in the Recruitment tab bar, after Pre-onboarding. Built for HR leads
and senior management to see whether hiring closes before requisitions lapse.

### 3.1 Built from the handoff, not pasted

The `094`/`095` handoff SQL targets an assumed `mrf` table. It does not match
this codebase and was **not** used — running it would have created a second,
empty `mrf` table beside `manpower_requisitions` and every metric would have
read zero. The mapping actually applied:

| Handoff assumed | This codebase |
|---|---|
| `mrf` | `manpower_requisitions` |
| `recruiter_id` UUID + `recruiters` table | `assigned_recruiter` (email text); no recruiters master exists |
| `expiry_date` | `validity_date` |
| `filled_at` / `first_shortlist_at` | derived from candidate `offer_sent_at` / `created_at` |
| `OPEN/FILLED/EXPIRED/CANCELLED` | `DRAFT/SUBMITTED/ON_HOLD/APPROVED/REJECTED/CLOSED` |

Lifecycle outcome is **derived on read**, not written by a nightly
`expire_overdue_mrfs()` job: `status` drives the approval workflow and must not
be overwritten by a cron, and a derived flag cannot drift stale if that cron
stops running.

### 3.2 Status flags

| Flag | Meaning |
|---|---|
| ✅ Filled | every opening has an offer out or a joiner |
| 🟢 On Track | live, more than 21 days to its deadline |
| 🟡 Watch | deadline within 21 days |
| 🟠 Critical | deadline within 7 days |
| 🔴 Breached | past validity and still unfilled |
| ⚪ No Deadline | live but no validity date set |
| ⏳ Awaiting Approval | not yet released to a recruiter |
| ⛔ Cancelled | rejected — excluded from performance |

### 3.3 Fill rate

```
Fill Rate = Filled ÷ (Filled + Breached) × 100
```

Live requisitions are **excluded from the denominator** — one still being
worked is neither a success nor a failure, and counting it would drag the rate
in whichever direction happens to have more volume. This is the handoff's
deliberate design decision, kept.

Colour bands: green ≥ 60%, amber 35–59%, red < 35%. The handoff calls these
arbitrary and asks HR to confirm them; they are named constants
(`FILL_STRONG`, `FILL_MID`) so changing them is a one-line edit.

### 3.4 Sections

- **Headline tiles** — fill rate, filled, breached, at risk, avg days to fill
- **Deadline Board** — live requisitions, most urgent first, with days left or
  "12d over", fill progress and owning recruiter
- **Recruiter Performance** — sortable: MRFs, filled, breached, live, fill rate,
  avg days to fill, avg days to first CV. Rejected MRFs are excluded (nobody's
  failure); unassigned ones surface as their own row so the gap is visible
- **Drill-down** — click a recruiter for every requisition behind their numbers
- **Filters** — company, branch, department, raised-within period

### 3.5 Export Report

A format picker plus **⬇ Export Report** and **🔗 Share link**.

Excel gives four sheets:

| Sheet | Contents |
|---|---|
| Summary | generated timestamp, scope, headline metrics, counts per flag |
| Requisitions | 33 columns per MRF, including the derived job-status flag |
| Recruiter Performance | the rollup |
| Deadline Board | live requisitions by urgency |

Formats: `.xlsx`, `.xls` (97–2003), `.csv` (the Requisitions table, since CSV
is single-sheet). Filename `EZER_Job_Status_<date>.<ext>`.

The report exports **exactly what is on screen** — filters carry through and the
Summary sheet states the scope. A report silently covering a different set than
the dashboard would be worse than none. Exporting an empty scope is refused
rather than producing an empty workbook.

**Share link** uploads the report to the `onboarding-docs` bucket via
`app/api/recruitment/share-report/route.ts` and returns a signed URL valid for
**7 days**, copied to the clipboard. Anyone with the link can download it
without a login.

---

## 4. Files touched

```
app/dashboard/recruitment/page.tsx              MRF section + Job Status tab
app/api/recruitment/upload-mrf-doc/route.ts     MRF attachments (new)
app/api/recruitment/share-report/route.ts       shareable report links (new)
supabase/migrations/047_mrf_columns.sql         29 columns (new)
supabase/migrations/048_mrf_lookups.sql         BU / cost centre / currency (new)
```

---

## 5. Known issues

**AI "Generate JD" does nothing but reports success.**
`app/api/recruitment/generate-jd/route.ts` calls the Anthropic API with
`ANTHROPIC_API_KEY`, which is **not set** in `.env.local`. The route reads
`data.content?.[0]?.text || ''`, so an auth failure collapses to an empty
string and the UI still shows *"JD generated!"* over an untouched textarea.

Fix either by adding the key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

…or by having the route fail loudly (return `503` when the key is missing, map
upstream `401/403` to the same, and only report success when `jd` is non-empty).

**`app/api/recruitment/interview-ai/route.ts` has the identical problem** — it
uses the same key and the same swallow-the-error pattern, so AI interview
questions and feedback in the Pipeline tab fail just as quietly.

**Cross-field validation only fires on save.** Duration bounds, budget
min > max, experience min > max and validity-before-target are all caught
correctly, but only after pressing Save or Submit — editing a field clears its
error without re-validating. The ₹6L lane banner does update live, so the form
is inconsistent about it.

**Typed-but-uncommitted skills are discarded.** In `SkillsMultiSelect`, text
typed into the search box only becomes a skill on click, Enter, or "Add
custom". Submitting with text still sitting in the box drops it and validation
reports skills missing. Standard for the pattern, and the dropdown makes it
visible, but it is the most likely place for a user to think a field is filled
when it is not.

---

## 6. Test coverage

Driven through headless Chrome against the live database, with every assertion
cross-checked via an independent connection. `/dashboard` is auth-gated, so the
components were mounted on a temporary route for testing and it was removed
afterwards.

| Area | Result |
|---|---|
| Smoke — load, 11 tabs, 10 form sections | 16/16 |
| Functional — compensation, labels, dropdowns, CTQ, chain, sourcing | 20/22 |
| Boundary — ₹6L split, duration 0/1/60/61, cross-field | pass |
| Negative — required fields, HTML injection, SQL-ish strings, 600-char input | pass |
| Workflow — create → approve → Job Status, full persistence | 19/20 |
| Approval capture — approver, recruiter, comments, audit trail | 16/16 |
| Export — 3 formats verified by magic bytes, contents parsed, share link fetched with `curl` | pass |

Boundary evidence: ₹5,99,999 and ₹6,00,000 are Quick Hire; ₹6,00,001 is Full
MRF. One click on a 4-step chain produced `status=APPROVED`, chain 4/4, recruiter
assigned, one `MRF_APPROVED` audit row.
