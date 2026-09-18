# EZER ESS — HRIS section

The fourth-from-bottom entry in the ESS rail, and the one that does the least
obvious thing: it is not a module, it is four unrelated screens that share a
heading. Directory, Raise a Request, Tasks & Approvals, Exit Process.

Written from the code on branch `TusharPanwar`, 14 September 2026. The
portal-wide map is `ESS-PORTAL-CURRENT-STATE.md`.

> **Read §6 before anything else if you are short of time.** The confidential
> POSH channel is not confidential, and the fix is a migration rather than a
> component change.

---

## 1. Where it lives

```
components/ess/EmployeePortal.tsx   Directory        (~line 1181)
                                    Requests         (~line 1000)
components/ess/RoleTabs.tsx         ApprovalsSection (~line 266)
                                    ExitSection      (~line 404)
```

Declared in `SECTIONS` as **partly available**:

```tsx
{ k:'hris', label:'HRIS', short:'HRIS', status:'partial',
  desc:'Directory, requests, approvals and the exit process',
  items:[
    { k:'directory', label:'Team Directory' },
    { k:'requests',  label:'Raise a Request' },
    { k:'approvals', label:'Tasks & Approvals' },
    { k:'exit',      label:'Exit Process' },
  ]}
```

Four sub-tabs, so the pill row is drawn. **Tasks & Approvals is conditional** —
it appears only when `/api/ess/menu` reports the login can approve, decided
from org data and the RMS grant rather than by comparing a role name in the
component.

---

## 2. Team Directory

`Directory` → `loadDirectory()` in `lib/supabase-ess.ts`.

A flat, searchable roster: name, code, designation, department, location,
mobile, office and personal email. Filters for department and location, and a
detail modal per person.

**The search takes several terms at once.** It splits on commas, semicolons and
newlines, so pasting a list of names or codes out of a spreadsheet works and
matches any of them. Each term is matched against name, designation,
department, code, location and office email.

**Two exclusions, applied client-side after the fetch:** anybody blacklisted,
and anybody whose `last_working_date` is before today. So a leaver disappears
the day after they go, without a status column to maintain.

**A failed query throws rather than returning `[]`.** That is deliberate and
commented — an empty array rendered as a silently empty directory, which reads
identically to "no colleagues found". Now it surfaces the error.

### What this screen actually does on the wire

```ts
supabase.from('employees').select('id, emp_code, full_name, designation,
  mobile, office_email, personal_email, blacklisted, last_working_date, …')
```

Straight from the browser on the anon key. **No company filter, no scope
filter, no limit.** Every employee in every company, with contact details, in
one response. Confirmed live: an anon-key read of `employees` returns all 398
rows.

Whether that is acceptable is a policy question — an internal directory is
often meant to be open. It is recorded here because it is not obvious from the
screen, which is framed as *your* team directory.

---

## 3. Raise a Request

`Requests` → `createServiceRequest()` → `ess_service_requests`.

A fixed catalogue of eight, defined in `REQ_TYPES`:

| Key | Label | Routed to |
|---|---|---|
| `LOAN` | Loan / Advance Salary | HR |
| `RESIGNATION` | Exit / Resignation | HR |
| `NOMINEE` | Nominee Update | HR |
| `INSURANCE_CHANGE` | Insurance Family Change | HR |
| `MARRIAGE` | Marriage Detail Update | HR |
| `EMERGENCY` | Emergency / SOS | HR |
| `BLOOD_DONATION` | Blood Donation Request | HR |
| `POSH` | POSH Complaint (Confidential) | **IC** — the Internal Committee |

Pick a type, write a detail, submit. The list below shows what you have filed
with a status pill: `PENDING` → `IN_REVIEW` → `APPROVED` / `REJECTED` /
`COMPLETED`.

**POSH is the one that behaves differently.** Choosing it shows a red panel —
*"This is confidential and routes only to the Internal Committee — not regular
HR"* — the row is written with `is_confidential: true` and `assigned_to: 'IC'`,
it renders with a 🔒 in the list, and the success message names the IC rather
than HR.

That is the intent. §6 is about the gap between that intent and what the
database enforces.

**`RESIGNATION` here is a request type, not the exit chain.** Filing it creates
a service request for HR to pick up; it does not start the acknowledgement
chain that Exit Process runs. Two different things with the same word, and
worth knowing before wiring anything to either.

---

## 4. Tasks & Approvals

`ApprovalsSection` → `GET /api/ess/approvals` → `buildPending()` in
`lib/ess/pending.ts`.

The same builder feeds Home's "pending on you", so the two can never disagree.

### What lands in the list

Two parts, deliberately separate:

1. **Stamped to you.** Rows whose `current_approver_id` is this employee.
   Stamped at the stage transition, never recomputed at render.
2. **Surfaced by scope.** The HR Manager stage of every resignation for
   `RESIGNATION` approvers; `PENDING_FINANCE` claims for
   `TRAVEL_CLAIM_FINANCE`; the whole department queue for an HOD.

Every item records **`surfaced_via`** — `stamped`, `RESIGNATION role`,
`TRAVEL_CLAIM_FINANCE role`, `HOD scope` — so both the UI and the audit can
explain why a person is seeing it.

`mine` is the line between the two: **stamped means you can act, scope means
you can only look.** The footnote on the screen says exactly that, and the
action set follows it.

### Three kinds, three action sets

| Kind | Stamped to you | Oversight only |
|---|---|---|
| `LEAVE` | Approve · Decline | View |
| `TRAVEL` | Open claim → actioned on the Travel Claims screen | Open claim |
| `RESIGNATION` | RM: *Acknowledge & forward* · *Accept with my date* · *Request retention*<br>HR: *Set final LWD* · *View full chain*<br>On retention hold: *Resume chain* · *View full chain* | View full chain |

Actions that need input open a small form inline rather than a modal — a date
for the LWD ones, a note, and for HR a *regrettable exit?* toggle. Decline and
retention ask for a reason and say it will be shown to the employee.

Filters across the top: **Waiting on me** (the default), Everything, Leave,
Travel, Resignation. Four KPIs above: waiting on you, in your scope,
resignations, leave & travel.

### Authorization

The list is a convenience and never the authorization. `POST /api/ess/approvals`
re-checks on the server that the row is stamped to the caller, and resignation
actions go through `fn_resignation_act` (071), which enforces the stage itself.
So the screen cannot offer a button the server will then refuse — and if it
somehow did, the refusal happens in the database.

---

## 5. Exit Process

`ExitSection` → `/api/ess/resignation`. The chain itself —  stamping, stage
skipping, HR's final LWD — lives in 071's `fn_resignation_submit` /
`fn_resignation_advance` / `fn_resignation_act`.

### Two states

**No open resignation** → the resign form: a reason from `exit_reason_master`,
a date, optional remarks. The notice period on record is shown before you
commit, and submitting is two-step — *Submit resignation* arms it, then *Yes,
submit* / *Not now*. Reason is mandatory; the button is disabled without one.

**An open one** → status, submitted date, notice period, last working day, the
reason, and the full chain.

### The stages, in the employee's words

| Status | Shown as |
|---|---|
| `INITIATED` | Initiated by HR |
| `PENDING_RM_L1` | With your reporting manager |
| `PENDING_RM_L2` | With your L2 manager |
| `PENDING_HOD` | With your head of department |
| `PENDING_HR_MANAGER` | With HR — final last working day |
| `RETENTION_HOLD` | On hold — your manager wants to talk |
| `RECOVERY_PENDING` | Accepted — notice recovery pending |
| `SETTLED` | Settled |
| `WITHDRAWN` | Withdrawn |

The last working day is labelled by where it came from: *as per policy*, then
*proposed by your manager*, then *confirmed by HR*. Three different numbers
with three different weights, and the screen never presents a proposal as
settled.

### Withdrawing

Offered only when the employee submitted it themselves
(`submitted_by_employee`) and it has not reached `RECOVERY_PENDING` or
`SETTLED`. It asks for confirmation, because it closes the chain.

Retention pauses the chain rather than ending it, and **only the employee can
withdraw** — a manager asking to talk cannot cancel somebody's resignation for
them.

---

## 6. The confidential channel is not confidential

The POSH route is the most sensitive thing in this section, and today it is the
least protected. Three separate problems, compounding.

### 6.1 The table is open to the anon key

`021_ess.sql` enables RLS on `ess_service_requests` and then adds this:

```sql
CREATE POLICY "allow_all_ess_service_requests" ON ess_service_requests
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```

The migration is honest about it — *"project standard: permissive while auth is
not yet wired"*. But the anon key ships in every page load, so in practice
**any visitor can read every POSH complaint ever filed**, along with who filed
it. Verified live: an anon-key read of the table is permitted and returns rows
(it is currently empty, which is the only reason nothing leaks today).

### 6.2 The write comes from the browser, and the client sets the routing

```ts
supabase.from('ess_service_requests').insert({
  employee_id, request_type, request_data,
  is_confidential: opts.is_confidential || false,
  assigned_to:     opts.assigned_to || 'HR',
})
```

`is_confidential` and `assigned_to` are **sent by the client**. Nothing
server-side ties `request_type = 'POSH'` to `is_confidential = true` and
`assigned_to = 'IC'`. A crafted request can file a POSH complaint marked
non-confidential and addressed to HR, or mark anything as confidential.

`employee_id` is also client-supplied, so a complaint can be filed in somebody
else's name.

### 6.3 The rest of the section already knows better

Approvals and Exit go through `/api/ess/*`, resolve the caller from the session
with `essRoute()`, and re-check every action server-side. Requests is the one
screen in HRIS still using the old browser-insert pattern.

### What fixing it looks like

1. **A migration** replacing the blanket policy — at minimum: an employee reads
   only their own rows; confidential rows are readable only by the IC. Nayan's
   to apply.
2. **`POST /api/ess/requests`**, so `employee_id` comes from the session and
   the `POSH → {IC, confidential}` mapping is decided on the server, not sent
   by the client.
3. A check constraint or trigger, so the mapping holds even if a future caller
   forgets it.

Until (1) and (2), the red panel promising the Internal Committee is a promise
the system cannot keep. That is worth saying plainly to whoever owns the POSH
policy, because people will act on that promise.

---

## 7. Why the section is "partly available"

The `status:'partial'` flag is set on the section, but unlike Payroll — where
Salary Slip and Statutory carry explicit `phase` / `needs` markers and render as
blocked — **no HRIS sub-tab declares what is missing.** All four render fully.

So the flag is either stale, or it is standing in for the gaps above without
saying so. Worth resolving one way or the other: either drop it to `ready`, or
mark the specific sub-tab that is not finished, so the badge means something.

---

## 8. Quick reference

| Screen | Data path | Auth |
|---|---|---|
| Team Directory | `loadDirectory()` → browser → `employees` | anon key, unscoped |
| Raise a Request | `createServiceRequest()` → browser → `ess_service_requests` | anon key, **open policy** |
| Tasks & Approvals | `GET/POST /api/ess/approvals` → `buildPending()` | session, re-checked per action |
| Exit Process | `GET/POST /api/ess/resignation` → `fn_resignation_*` | session, stage enforced in the DB |

**Conventions this section keeps:** the list is never the authorization;
`surfaced_via` explains why a row is on your screen; stamped means act, scope
means look; a proposed last working day is never shown as a confirmed one.

**Conventions it breaks:** private data read and written from the browser, and
routing decided by the client.
