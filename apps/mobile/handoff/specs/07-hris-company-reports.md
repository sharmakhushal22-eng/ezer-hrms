# 07 — HR Services (HRIS), Company, Reports

Spec for rebuilding the employee-facing **HR Services** sidebar section (Team Directory, Raise a Request, Tasks & Approvals, Exit Process, plus the deep-link-only Raise MRF pane), and the role-gated **Company** and **Reports** sections of the ESS portal, as a React Native (Expo) app with exact functional parity.

Everything below was read from source on branch `feat/mobile-app` (Oct 2026). Paths are relative to the repo root `/Users/girish/Documents/ezer-hrms`. UI copy is quoted exactly, curly quotes and en/em dashes included. Where the code has a quirk or a bug, the spec says so (marked **QUIRK** or **BUG**) and does not quietly fix it.

Primary sources:

- `components/ess/EmployeePortal.tsx` (SECTIONS, `renderView()`, gating)
- `components/ess/hris/{HrisShell,TeamDirectory,PersonModal,RaiseRequest,TasksApprovals,ExitProcess,ui,icons,types}.tsx|ts`, `hris.css`
- `components/ess/RoleTabs.tsx` (`useEssMenu`, `MrfApprovals`, `RaiseMrfSection`, `OfferApprovals`, `InterviewInvites`, `CompanySection`, `ReportsSection`, plus the legacy `PendingCard`/`ApprovalsSection`/`ExitSection`/`PendingOnYou`)
- `components/ess/OnboardingApprovals.tsx`, `components/onboarding/ReviewDrawer.tsx` (exports `SCHEMA`, `TEAM`, `SectionView`, `DocCard`, `SHEET_CSS`)
- `components/ess/MrfForm.tsx`, `components/recruitment/InterviewFeedbackForm.tsx`, `components/recruitment/RecruiterPicker.tsx`
- Routes: `app/api/ess/{menu,approvals,resignation,mrf,offer-approvals,onboarding-approvals,interview,company,reports,home}/route.ts`
- Server libs: `lib/ess/session.ts`, `lib/ess/pending.ts`, `lib/leave/workflow.ts`, `lib/onboarding/{approvals,review,checklists,salary-breakdown}.ts`, `lib/recruitment/{interview-decision,offer-approval-notify,confidential,job-code}.ts`
- SQL: `supabase/migrations/071_ess_access_reconciliation.sql` (resignation chain functions and `v_attrition_reasons`), `021_ess.sql` (`ess_service_requests`)
- Notification copy: `lib/config/workflow-templates.ts`

---

## 0. Cross-cutting

### 0.1 Where these sections sit in the portal

`SECTIONS` in `EmployeePortal.tsx`:

| Rail key | Label (short) | status | `desc` (TabHeader subtitle) | Items (view keys) |
|---|---|---|---|---|
| `hris` | **HR Services** (`HR`) | partial | "Directory, requests, approvals and the exit process" | `directory` "Team Directory", `requests` "Raise a Request", `approvals` "Tasks & Approvals", `exit` "Exit Process" |
| `company` | **Company** (`Company`) | ready | "Headcount, attrition and tax-regime trends across the company" | `company` |
| `reports` | **Reports** (`Reports`) | ready | "Attrition, regime comparison, declaration status, TDS register, span of control" | `reports` |

- Rail group: all three are in the group labelled **"Workplace"** (`keys: ['hris','company','reports']`).
- The rail key stays `'hris'` (routes and deep links read it); only the label says "HR Services".
- `raise-mrf` is a valid **view key** (`VIEW_KEYS` includes it, so `/ess/raise-mrf` deep-links work) but it is **not** a sidebar item and not an HRIS tab. See §6.
- `renderView()`:
  - `directory | requests | approvals | raise-mrf | exit` → `<HrisShell employeeId={emp.id} tab={view} go={go} canApprove={essMenu.can.approvals} canRaiseMrf={canRaiseMrf} adminMode={adminMode} notify={notify} />`
  - `company` → `<CompanySection employeeId={emp.id} />`
  - `reports` → `<ReportsSection employeeId={emp.id} />`
- For `section.k === 'hris'` the portal suppresses its own sub-tab row and page chrome; the shell draws its own header and tabs.
- Clicking a section lands on its first item (`directory` for HR Services).
- Feature search offers each item of each visible section (skips `raise-mrf` unless `canRaiseMrf`).

### 0.2 Gating (from `GET /api/ess/menu`)

`useEssMenu(employeeId)` (RoleTabs) calls `api('/api/ess/menu', employeeId)`. Until it resolves, the menu is `EMPTY_MENU`, so `can.approvals/company/reports` are all `false`. On error the menu stays empty and `error` holds the message.

`GET /api/ess/menu` response (verbatim fields):

```ts
{
  tabs: { id: string; label: string }[],         // 'home', + 'approvals' | 'company' | 'reports' when allowed
  is_rm: boolean, direct_reports: number,
  is_hod: boolean, hod_departments: string[],    // department UUIDs
  roles: { code: string; name: string; scope: string | null }[],
  functional_scope: 'SELF'|'TEAM'|'DEPT'|'BRANCH'|'ORG',
  approval_types: string[],                      // e.g. 'RESIGNATION', 'TRAVEL_CLAIM_FINANCE', ...
  modules: Record<string, 'NONE'|'VIEW'|'EDIT'|'FULL'>,
  can: { approvals: boolean; company: boolean; reports: boolean },
  screens: { allow: Record<string, boolean>; configured: Record<string, boolean> },
  super_admin: boolean,
  view_as: boolean,
}
```

Server rules (`lib/ess/session.ts` `essContext`):

- `canApprovals = menu.is_rm || menu.is_hod || menu.approval_types.length > 0 || grant.isSuperAdmin`
- `canCompany = grant.isSuperAdmin || modules['Company Dashboard'] >= VIEW`
- `canReports = grant.isSuperAdmin || modules['ESS Reports'] >= VIEW`
- `menu.*` comes from RPC `ess_menu(p_employee_id)` (retried once after 350 ms). On failure: 500 `ess_menu: <msg>. Has migration 071 been run?`

Client rules:

| What | Rule |
|---|---|
| Company section in rail | `essMenu.can.company` |
| Reports section in rail | `essMenu.can.reports` |
| HR Services section | always shown |
| "Tasks & Approvals" tab + pane | `canApprove = essMenu.can.approvals` |
| Raise MRF pane | `canRaiseMrf = essMenu.is_rm \|\| essMenu.is_hod \|\| essMenu.can.approvals` (matches the server's `create` rule exactly) |

**QUIRK:** a non-approver who deep-links to `/ess/approvals` gets the HR Services header with no tab selected and an empty main area. HrisShell renders no `approvals` pane when `canApprove` is false.

**QUIRK:** interviewers, onboarding heads (IT/Admin/Payroll) and HR Head/HR Manager offer reviewers only see their tasks if they also pass `can.approvals`. The task cards live inside the Tasks & Approvals pane.

### 0.3 Auth and the fetch helper

All `/api/ess/*` calls in these screens go through the same helper. `lib/ess/api.ts` `api(path, employeeId, init?)` and HrisShell's own `api(path, init?)` are byte-identical in behaviour; `MrfForm.tsx` has a private copy too.

```ts
const token = await authToken()        // lib/rms/client.ts: ESS token (essToken()) else Supabase session access_token
const sep = path.includes('?') ? '&' : '?'
fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
  ...init, cache: 'no-store',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
})
const body = await res.json().catch(() => ({}))
if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)   // lib/ess/api.ts also attaches { status, body }
return body
```

- `employee_id` is **always** appended, even for the employee's own portal.
- Every route starts with `essCaller` / `essRoute`. Common errors (all `{ error: string }`):
  - 401 `Sign in first. This endpoint needs a dashboard session.`
  - 401 `Your session has expired. Sign in again.`
  - 403 `You can only open your own portal.` (ESS user without admin roles asking for someone else's `employee_id`)
  - 400 `employee_id is required for the dashboard login.`
  - 500 `ess_menu: …`
- **viewAs**: `true` when the token's employee ≠ `employee_id`, or for a legacy dashboard login (then `actorEmployeeId === null`). Write routes refuse viewAs callers with 403. The exact messages are listed per route below.

### 0.4 Toasts and notifications in these screens

- `HrisShell` wraps everything in `ToastHost` (`components/ess/hris/ui.tsx`). A toast is shown for **2600 ms**, stacked bottom-right (`.hx-toasts`). Kinds: default (check icon, positive edge) or `'error'` (x icon, critical edge).
- Inside Tasks & Approvals, the RoleTabs task blocks are mounted with `notify={(m) => toast(m)}`. **QUIRK:** this drops the `'error'` type, so their error messages show as success-styled toasts.
- `CompanySection` / `ReportsSection` don't toast; errors render inline.
- The portal's own `notify(msg, type)` (3000 ms) is passed to HrisShell and used only by `RaiseMrfSection` / `MrfForm`.

### 0.5 Tokens and tone mapping

Colours come from `@/lib/ui` `C` tokens (`var(--ez-*)`):

- **HRIS (`.hx` classes in `hris.css`)**
  - pill `ok` = positiveTint/positive
  - pill `warn` = warningTint/warning
  - pill `dang` = criticalTint/critical
  - pill `info` = infoTint/info
  - pill `mut` = sunken/muted with a `line` border
  - note default = brand left border; `w` = warning; `d` = critical
  - `hx-btn` primary brand; `o` outline; `d` critical tint; `solidred` = critical fill with white text
  - chip pressed = brand fill + onAccent text
- **RoleTabs local `C`**
  - `purple=brand`, `purpleD=brandDeep`, `soft=brandTint`
  - `green=positive`/`greenBg=positiveTint`, `amber=warning`/`amberBg=warningTint`, `red=critical`/`redBg=criticalTint`, `blue=info`/`blueBg=infoTint`
  - `bg=canvas`, `border=line`, `card=surface`
  - `pill(tone)` uses the same mapping
  - table head `S.th` = `ink` background, `canvas` text, 10px uppercase
- Radii: cards 10, inputs/buttons 7, pills 99. The HRIS redesign uses `--r-md`.

### 0.6 Shared formatters

- `components/ess/hris/ui.tsx` (in a React client file; port the functions as-is):
  - `fmtDateTime(iso)` → `toLocaleString('en-IN', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})`; `''` for null; raw string if invalid
  - `fmtDate(iso)` → `toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'})`; `'-'` for null
  - `initials(name)` → first letters of the first two words, upper-cased
  - `hueOf(s)` → stable 0–359 hash: `h = charCode + ((h<<5) - h)`, then `abs % 360`. Used as the avatar hue (`--h`).
- `lib/ess/session.ts` (server-only file: imports `next/server`; copy the functions, don't import):
  - `fmtDate` → en-IN `2-digit/short/numeric`, `'-'`
  - `daysAgo(d)` → `'today' | 'yesterday' | 'N days ago'`
  - `fyOf(d)` → `'2026-27'` (April starts the FY)

---

## 1. HR Services shell — `HrisShell`

**Purpose:** one shell for the four HRIS screens. It draws its own header, search and sliding-indicator tab bar. **Navigation stays the portal's:** the active tab *is* the portal `view`, and picking a tab calls `go(k)`.

### Layout, in order

1. **Header** (`.hx-head`):
   - Icon tile (doc glyph).
   - `<h1>HR Services</h1>` with the line "Find colleagues, raise a request, act on approvals, or start your exit".
   - Right side: a search box (search glyph, placeholder `Search directory…`, aria "Search directory").
     - Typing sets the shared directory `query`.
     - If the current tab isn't `directory`, typing calls `go('directory')`.
     - Hidden at ≤560px.
2. **Tab bar** (`role=tablist`), in this order: `directory` "Team Directory", `requests` "Raise a Request", `approvals` "Tasks & Approvals" (only when `canApprove`), `exit` "Exit Process".
   - `raise-mrf` is filtered by `canRaiseMrf` but isn't in `TABS` at all (removed: "an MRF is now raised from Recruitment → MRF tab").
   - Count badges:
     - Requests: `reqCount` = number of the user's service requests (class `ct`, shown when >0).
     - Approvals: `apprCount` = items with `mine === true` from `/api/ess/approvals` (class `ct warn`, shown when >0).
   - A sliding underline is measured off the selected tab.
   - Left/Right arrow keys cycle tabs.
3. **Main**: panes are **mounted on first visit and kept mounted**. Hidden panes keep their state, such as a half-written request or a filtered roster. Panes:
   - `directory` → TeamDirectory (§2)
   - `requests` → RaiseRequest (§3)
   - `approvals` → TasksApprovals (§4), only if `canApprove`
   - `raise-mrf` → `RaiseMrfSection` (§6), only if `canRaiseMrf`
   - `exit` → ExitProcess (§5)
   - Each pane has class `hx-pane` and gets `on enter` when active.

---

## 2. Team Directory (`TeamDirectory.tsx` + `PersonModal.tsx`)

**Purpose:** search and contact colleagues.

### Data (direct Supabase, anon key, browser) — `lib/supabase-ess.ts loadDirectory()`

```ts
supabase.from('employees')
  .select('id, emp_code, full_name, designation, mobile, office_email, personal_email, blacklisted, last_working_date, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name), companies!employees_company_id_fkey(company_name)')
  .order('full_name')
// throws Error(error.message) on error (never returns [] on error)
// client filter: drop blacklisted, drop rows with last_working_date < today 00:00 (device local time)
// map → { id, emp_code, full_name, designation, dept_name, location_name, company_name, mobile, office_email, personal_email }
```

**QUIRK:** there is no company filter and no `employment_status` filter. The directory lists every non-blacklisted employee with no past LWD, across all companies. `company_name` is loaded but never shown.

### Layout

1. **Card**: users icon, title **"Employee Directory"**, count line:
   - while loading: `Loading colleagues…`
   - else `${filtered}${filtered !== total ? ` of ${total}` : ''} colleague${filtered===1?'':'s'}`
2. **Filters row**:
   - Text input (placeholder `Search name, code, designation, department or email`). It shares the same `query` as the header search.
   - Select "All departments" + the sorted distinct `dept_name` values.
   - Select "All locations" + the sorted distinct `location_name` values.
   - Button **"Clear filters"** (outline), shown only when query, dept or location is set; it clears all three.
3. **Grid** (`minmax(300px,1fr)`; 1 column at ≤560px):
   - Loading: 6 skeleton cards.
   - Error: a red note with the error message, or `Could not load the directory.`
   - Empty: search glyph, **"No colleagues match that search"**, then "Try a different name, code or department" + (dept or location set ? ", or clear the filters" : "") + ".".
   - **Person card** (tappable; Enter/Space opens it):
     - Row 1: avatar (initials, hue from name) + `full_name` + `designation || '-'`.
     - Tags row: `emp_code` (code tag); `dept_name` if set; pin glyph + `location_name` if set.
     - Contacts row (taps here don't open the card):
       - "Email" → `mailto:office_email`, shown if `office_email`
       - "Call" → `tel:mobile`, shown if `mobile`
       - "WhatsApp" → `https://wa.me/91${digits}`, where `digits = mobile.replace(/\D/g,'').slice(-10)` (new tab), shown if `digits` is non-empty
   - The staggered rise animation plays on first paint only.

### Filtering (client)

```ts
terms = query.split(/[,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
row passes if (!dept || dept_name===dept) && (!loc || location_name===loc)
  && (!terms.length || terms.some(t => full_name|designation|dept_name|emp_code|location_name|office_email includes t))   // case-insensitive
```

Any term may match, so a list pasted from a spreadsheet works.

### Person modal ("Colleague details")

- Header: 48px avatar, `full_name` (16/700), then `designation || '-'` · `emp_code`, and a close ✕ button.
- Rows (label / value, `'-'` if empty): Department, Location, Office email, Mobile.
- Buttons (flex, outline): Email / Call / WhatsApp, with the same conditions as the card.
- Behaviour: Esc or a tap on the scrim closes it; focus is trapped; on close, focus returns to the card.

---

## 3. Raise a Request (`RaiseRequest.tsx`)

**Purpose:** file a service request to HR, or a confidential POSH complaint to the Internal Committee.

### Catalogue (`REQ_TYPES`, in order)

| k | label | icon | confidential | assigned_to |
|---|---|---|---|---|
| LOAN | Loan / Advance Salary | cash | – | HR |
| RESIGNATION | Exit / Resignation | door | – | HR |
| NOMINEE | Nominee Update | user | – | HR |
| INSURANCE_CHANGE | Insurance Family Change | shield | – | HR |
| MARRIAGE | Marriage Detail Update | ring | – | HR |
| EMERGENCY | Emergency / SOS | sos | – | HR |
| BLOOD_DONATION | Blood Donation Request | heart | – | HR |
| POSH | POSH Complaint (Confidential) | lock | true | IC |

Default selection: LOAN. "Exit / Resignation" here is a plain service request; it does **not** start the resignation chain (§5).

### Layout

1. **Card "Raise a request"**:
   - Label `Pick a request type`, then a tile grid. Each tile shows the icon, the label and the subline `Routed to {assigned||'HR'}`. The selected tile is `aria-pressed`; the POSH tile uses critical styling.
   - When POSH is selected, a red note appears: lock glyph + "This is confidential and routes only to the Internal Committee, not regular HR."
   - Label **"Details"**, textarea (placeholder `Describe your request…`).
   - Button **"Submit request"** (shows `Submitting…` while busy).
2. **Card "My requests"**:
   - Right-side pill `{n} filed` (mut).
   - Empty: `No requests yet.`
   - Each row:
     - Title: `LABEL[request_type] || request_type`, plus a 🔒 (title "Confidential") when `is_confidential`.
     - Meta: `(request_data.detail || '').slice(0,60) || '-'` · `fmtDate(submitted_at)`.
     - Right-side status pill:

| status | text | tone |
|---|---|---|
| PENDING | Pending | warn |
| IN_REVIEW | In review | info |
| APPROVED | Approved | ok |
| COMPLETED | Completed | ok |
| REJECTED | Rejected | dang |
| other | raw | mut |

### Actions (direct Supabase, anon)

```ts
// load (on mount and after a submit)
supabase.from('ess_service_requests').select('*').eq('employee_id', employeeId).order('submitted_at', { ascending: false })
// submit
supabase.from('ess_service_requests').insert({
  employee_id, request_type: type, request_data: { detail: detail.trim() },
  is_confidential: def.confidential || false, assigned_to: def.assigned || 'HR',
})
```

Table columns (021): `id, employee_id, request_type, request_data jsonb, is_confidential, status (PENDING|IN_REVIEW|APPROVED|REJECTED|COMPLETED, default PENDING), assigned_to, submitted_at default now(), resolved_at, resolution_note`.

- Validation: empty or whitespace-only detail → toast error **`Please add details`**.
- Insert error → toast error `Failed: ${error.message}`.
- Success:
  - Detail is cleared.
  - Toast: `Confidential request sent to the Internal Committee.` (POSH) or `Request submitted.`
  - List reloads.
- The tab badge shows `rows.length`.
- **QUIRK:** confidentiality is a client-set flag only. RLS on the table is allow-all, and there is no notification or server route. This is noted in source and deliberately unchanged.

---

## 4. Tasks & Approvals (`TasksApprovals.tsx`)

**Purpose:** everything that waits on the user: MRF hiring requests, offer approvals, interview tasks, onboarding sign-offs, and the core leave / leave-cancellation / attendance-correction / travel / resignation queue.

### 4.0 Composition, top to bottom

Each block fetches its own data.

1. `MrfApprovals` (§4.1). It always renders its card once loaded, and shows a red note on error.
2. `OfferApprovals` (§4.2). Renders nothing unless the user is HR Head or HR Manager **and** there's something to show.
3. `InterviewInvites` (§4.3). Renders nothing if there are no invites.
4. `OnboardingApprovals` (§4.4). Renders nothing unless the user acts for IT/Admin/Payroll **and** items exist.
5. **KPI strip** + **Approvals card** (§4.5), from `GET /api/ess/approvals`:
   - error → red note with the message (replaces the KPIs and the list; blocks 1–4 have their own states)
   - loading → `Loading…` (faint, 12.5px)

### 4.1 MRF block — `MrfApprovals` (RoleTabs.tsx)

**GET `/api/ess/mrf`** → response:

```ts
{
  canRaise: boolean,                 // menu.is_rm || menu.is_hod || ctx.canApprovals
  toApprove: MRF[],                  // status SUBMITTED, latest 500 (all companies), filtered where the PENDING chain step's approver_id === me
  mine: MRF[],                       // requested_by = me, select('*, departments:department_id(dept_name)'), latest 60
  departments: { id, dept_name }[],  // caller's company, status Active
  hrOptions: { id, name, code, role: 'RECRUITER' }[],  // active RECRUITER role holders in caller's company, sorted by name
  companyPeople: { id, full_name, emp_code, designation }[], // active employees of caller's company, ≤1000
  raiser: { rm1: { name, code } | null, rm2: { name, code } | null },
  myAssignments: { id, designation, position, mrf_number, no_of_openings, openings, assigned_recruiter, acknowledged_recruiter_ids?, departments:{dept_name}, acknowledged: boolean }[]
    // status APPROVED and assigned_recruiter_ids contains me; latest 100
}
```

- `toApprove` columns: `id, mrf_number, designation, position, job_title, no_of_openings, openings, reason, reason_for_hire, urgency, status, approval_chain, raised_by_name, raised_by_role, department_id, company_id, location_id, created_at, requested_by, mrf_type, hiring_type, employment_type, work_mode, grade, job_code, business_unit, currency, budget_min, budget_max, wage_category, pay_period, compensation_type, target_joining_date, validity_date, business_justification, skills_required, good_to_have_skills, experience_min, experience_max, education_min, education_max, cost_center, is_budgeted, headcount_ref, sourcing_mode, ctq_questions, departments(dept_name), companies(company_name), locations(location_name)`.
- `approval_chain` is JSON: `[{ order, role: 'RM2'|'HR_HEAD'|'HIRING_MANAGER'|…, approver_id, approver_name, approver_code, status: 'PENDING'|'WAITING'|'APPROVED'|'REJECTED'|'REVISION', acted_at, comment }]`.

**Card layout** (section title **"Hiring Requests · MRF"**):

1. **"Assigned to you ({n})"** (green, 12/700). Shown if `myAssignments.length`. Each row:
   - Line 1: `{designation||position} · {no_of_openings||openings||1} opening(s)`.
   - Line 2: `{departments.dept_name||'-'} · You’ve been assigned to hire for this. Run it in Recruitment.`
   - Right side:
     - acknowledged → pill ok `Acknowledged ✓`
     - else green button **"Acknowledge"**. It calls `POST /api/ess/mrf {action:'acknowledge', id}`; on success it toasts `Acknowledged. This MRF is now in your Recruitment.` and reloads; on error it toasts the error.
2. **"Waiting on you ({n})"** (amber). Shown if `toApprove.length`. Each row is a warning-tint banner:
   - 📋 icon.
   - Line 1: `{designation||position} · {openings} opening(s)`.
   - Line 2 (amber): `Needs your approval · raised by {raised_by_name||'-'}{raised_by_role?` (${role})`:''} · {urgency||'Normal'}`.
   - Green link button **"Open MRF to review & approve →"** → `/ess/recruitment/mrf?mrfSub=approvals&mrf={id}` (the Recruitment module, outside this spec).
   - No approve/reject happens inline.
3. **"My requests ({mine.length})"** (muted). Empty: `You haven’t raised any MRF yet.` Each row:
   - Left: `{designation||position} · {openings}`, then `{dept_name||'-'}` below.
   - Right status text:
     - `NEEDS_REVISION` → `Sent back: needs changes` (critical)
     - APPROVED → `Approved` (positive)
     - REJECTED → `Rejected` (critical)
     - a PENDING chain step → `With HR Head · {approver_name}` or `With RM2 · {approver_name}` (warning). Role `HR_HEAD` maps to "HR Head"; any other role is labelled "RM2".
     - else the raw `status` (warning)
   - When `NEEDS_REVISION`: an amber box with `“{remarks}”` (if any) and an amber button **"✎ Edit & resubmit"**. It switches the whole block to the edit view.

**Edit & resubmit view** (replaces the card):

- Section "Edit & resubmit MRF", right side **"← Back"**.
- If `remarks`: warning note `Sent back for changes: “{remarks}”. Fix and resubmit below.`
- Then `<MrfForm employeeId initial={mrfToForm(m)} replaceId={m.id} onDone={back+reload} onCancel={back} notify>` (§6.2).

**Review modal (focus mode only):** `MrfApprovals` also contains a full review / approve / send-back / reject modal plus an HR-Head "Assign Hiring Manager(s)" step (`RecruiterPicker`). It opens **only** when `focusId` is passed, from `app/mrf-approve/[id]`. TasksApprovals never passes it, so it can't be reached from this screen. The API it calls is documented in §4.1.1 for completeness, because the Recruitment link lands on the same API.

#### 4.1.1 `POST /api/ess/mrf` actions

- **viewAs check (all actions):** 403 `MRF actions cannot be done while viewing as somebody else.`
- **`create`** (§6.2): body = MrfForm payload.
- **`approve` / `reject` / `revise`** — body `{ action, id, note?, assigned_hr_ids? }`
  - Errors:
    - 400 `id is required`
    - 404 `MRF not found`
    - 400 `This MRF is not awaiting approval.` (no PENDING step)
    - 403 `This MRF is not waiting on you.` (unless super admin)
  - `revise` on an **APPROVED** MRF (the hiring manager's send-back):
    - The caller must be in `assigned_recruiter_ids` (or super admin), else 403 `Only the assigned hiring manager can send this MRF back.`
    - `note` is required, else 400 `Add a remark explaining what to fix.`
    - Appends chain step `{role:'HIRING_MANAGER', status:'REVISION', comment}` and sets `status='NEEDS_REVISION', remarks=note`.
    - Notifies the raiser with `notify.mrf.sent_back_hm`: "{{mrf_label}} was sent back by {{actor_name}}: “{{note}}”. Open Tasks & Approvals to edit and resubmit it."
    - Returns `{ ok:true, sentBack:true }`.
  - `revise` (approver):
    - `note` required (same 400).
    - Current step becomes `REVISION`; MRF becomes `NEEDS_REVISION`, `remarks=note`.
    - Notifies the raiser with `notify.mrf.sent_back` (same body).
    - Returns `{ok:true}`.
  - `reject`:
    - Step becomes `REJECTED` with `comment=note||null`; MRF becomes `REJECTED`.
    - No notification. Returns `{ok:true}`.
  - `approve`:
    - Step becomes `APPROVED`. The next `WAITING` step becomes `PENDING`; if there isn't one, the MRF becomes `APPROVED`.
    - At the HR_HEAD step, `assigned_hr_ids` (at most 20) sets `assigned_recruiter_ids` and `assigned_recruiter` = `"Name (CODE), …"`, and each assignee is notified with `notify.mrf.assigned`: "You have been assigned to hire for {{mrf_label}}. Acknowledge it in Tasks & Approvals, then run the hiring in Recruitment."
    - Returns `{ok:true}`.
- **`acknowledge`** — body `{ action, id }`
  - Errors: 400 `id is required`; 404 `MRF not found`; 403 `This MRF is not assigned to you.`
  - Appends me to `acknowledged_recruiter_ids`.
  - Returns `{ok:true}`.
- Anything else → 400 `Unknown action`.
- Client toasts for the decisions: `MRF approved.` / `MRF rejected.` / `Sent back for changes.`

### 4.2 Offer approvals — `OfferApprovals`

**GET `/api/ess/offer-approvals`** → `{ isHrHead, isHrManager, pending, recent, awaiting, ready }`. Each array holds **shaped** rows:

```ts
{ id, status, company_id, offered_ctc, variable_pct, monthly_inhand, joining_bonus, joining_bonus_freq, retention_bonus,
  esop_value, esop_vesting, hike_pct, proposed_doj, days_to_join, notice_period_days, notice_buyout, notice_buyout_amount,
  prev_company_name, prev_company_address, prev_total_ctc, prev_fixed_ctc, prev_variable, prev_ta_da, prev_additional,
  hiring_manager_remark, recruiter_comments, template_content, submitted_at,
  actioned_at /* hr_head_actioned_at */, comment /* hr_head_comments */,
  candidate /* candidates.full_name || 'Candidate' */, designation, current_company, experience_years,
  mrf_number, raised_by, recruiter /* mrf.assigned_recruiter */, state, location_id, revision_note }
```

Who gets what:

- **isHrHead**: menu roles include `HR_HEAD`, or super admin.
  - `pending` = `offer_approval_requests` with `status SUBMITTED` in the caller's company, oldest first.
  - `recent` = status in `HR_HEAD_APPROVED | HR_HEAD_REJECTED | OFFER_SENT` with `hr_head_actioned_at` in the last 30 days, newest first, max 10.
- **isHrManager**: menu roles include `HR_MANAGER`.
  - `awaiting` = SUBMITTED.
  - `ready` = HR_HEAD_APPROVED (newest 20).
- No company, or neither role → all four arrays empty.
- `state` falls back to the MRF location's `locations.state`.
- On a GET error the client sets `{isHrHead:false, pending:[], recent:[]}` and so renders nothing.

Formatters:

- `rs(n)` = `₹${Math.round(n).toLocaleString('en-IN')}`
- `lakh(n)` = `₹${(n/100000).toFixed(2)}L`
- `day(v)` = en-IN `numeric/short/numeric`

**HR Manager view** (not HR Head). Hidden if both lists are empty.

- Section: `Offer letters · HR Manager{awaiting? ` · ${n} yet to be approved`:''}{ready? ` · ${n} ready to send`:''}`.
- Awaiting row (warning tint):
  - ⏳ icon.
  - Line 1: `{candidate} · {designation||'-'}`, plus an `mrf_number` chip.
  - Line 2: `This candidate's offer is yet to be approved by the HR Head · {lakh(offered_ctc)}{doj? ` · DOJ ${day}`:''} · submitted {day(submitted_at)}`.
  - Pill warn `Awaiting HR Head`.
  - Disabled button `Send offer` (title "Unlocks once the HR Head approves").
- Ready row (positive tint):
  - ✅ icon.
  - Line 2: `Approved by the HR Head on {day(actioned_at)} · {lakh} · the offer letter can be sent now`.
  - Green button **"Send offer →"** → navigates to `/ess/recruitment/sendoffer`.

**HR Head view.** Hidden if `pending` and `recent` are both empty.

- Section: `Offer approvals · HR Head{pending? ` · ${n} waiting`:''}`.
- "Waiting on you ({n})" rows (warning tint):
  - 💼 icon.
  - Line 1: `{candidate} · {designation}` + mrf chip.
  - Line 2: `{state? `${state} · `:''}Offer of {lakh}{variable_pct? ` (${v}% variable)`:''}{hike_pct? ` · ${hike.toFixed(1)}% hike`:''}{doj? ` · DOJ ${day}`:''} · needs your review & approval · submitted {day}`.
  - Green button **"Review & approve"**.
- "Decided recently ({n})" rows:
  - Line 1: `{candidate} · {designation}`.
  - Line 2: `{lakh} · {day(actioned_at)}{comment? ` · “${comment}”`:''}`.
  - Pill: `HR_HEAD_REJECTED` → dang `Rejected`; `OFFER_SENT` → ok `Approved · offer sent`; else ok `Approved`.

**Review modal** (full-screen scrim, card max 760px):

- Header: `Offer approval: {candidate}`.
- Subline: `{designation}{mrf_number? ` · …`}{raised_by? ` · MRF raised by …`}{recruiter? ` · recruiter …`}`.
- Button `Close` (or `← Back` in focus mode).
- 3 stat tiles:
  - Offered CTC: `{rs} p.a.`
  - Monthly in-hand (est.): `rs` or `-`
  - Hike: `x.x%` or `-`
- Section **Offered package**. Each line appears only if it has a value:
  - Variable: `{v}% · {rs(ctc*v/100)} p.a.`
  - Joining bonus: `{rs}{freq? ` (${freq})`}`
  - Retention bonus
  - ESOP: `{rs}{vesting? ` (${vesting})`}`
- Section **Joining**:
  - State
  - Proposed DOJ: `{day}{days_to_join!=null? ` · ${n} days from submission`}`
  - Notice period: `{n} days`
  - Notice buyout: `Yes · {rs}` or `Yes`
- Section **Previous employer** with the hint "(confidential, not shown to the candidate)":
  - Company: `prev_company_name || current_company`
  - Address
  - Previous total CTC: `{rs} p.a.`
  - Fixed / variable: `{rs|'-'} / {rs|'-'}`
  - TA / DA (monthly)
  - Additional
  - Experience: `{n} years`
- Section **Remarks** (if either exists): Hiring manager, Recruiter.
- Collapsible **"Approval request template (as submitted)"** with `template_content` (pre-wrap).
- Reject mode: label `Reason for rejection (goes to the recruiter)`, textarea (placeholder `e.g. CTC above the approved band for this grade. Revise and resubmit.`).
- Footer buttons:
  - View mode: **Reject** (switches to reject mode); link **"Open in Recruitment"** → `/ess/recruitment/hrhead?offer={id}`; **"Approve offer"** (green; `Approving…` while busy).
  - Reject mode: `← Back` and **"Confirm reject"** (red; disabled until the reason is non-empty; `Rejecting…` while busy).

**POST `/api/ess/offer-approvals`** — body `{ action:'approve'|'reject', request_id, comment }`:

- Client check: reject with empty reason → `A rejection reason is required`.
- Server errors:
  - 400 `request_id is required`
  - 400 `action must be approve or reject`
  - 400 `A rejection reason is required`
  - 403 `Only the HR Head can decide offer approvals`
  - 404 `Offer approval request not found`
  - 403 `This offer belongs to another company`
  - 409 `This request is already {status with _→space, lower-case}`
- Effect:
  - Sets `status = HR_HEAD_APPROVED|HR_HEAD_REJECTED`, `hr_head_action = APPROVED|REJECTED`, `hr_head_comments`, `hr_head_actioned_at`.
  - Writes audit `recruitment_audit_logs`.
  - `notifyDecided`:
    - Recruiters in the MRF's `assigned_recruiter_ids`, plus HR_MANAGER holders on approval, plus the MRF raiser on rejection.
    - Templates `notify.offer.approved` / `notify.offer.rejected`; links `/ess/recruitment/sendoffer` / `/ess/recruitment/offerapproval`.
- Response: `{ ok:true, status:'APPROVED'|'REJECTED', notified:number }`.
- Client toasts:
  - Approve: `Approved. {candidate}'s offer moves to Send Offers{notified? ` (${n} notified)`:''}.`
  - Reject: `Rejected. The recruiter has been told{… (n notified)}.`
  - Then the modal closes and the list reloads.
- No viewAs check on this route.

### 4.3 Interviews to conduct — `InterviewInvites`

**GET `/api/ess/interview`** → `{ invites: (interview_invites.* & { questions: string[] })[] }`:

- Rows where `interviewer_id = me`, ordered by `scheduled_at` ascending, nulls last.
- `questions` = the MRF's `ctq_questions`.
- Fields used: `id, candidate_name, round, role ('MAIN'|'PANELIST', default MAIN), status ('invited'|'acknowledged'|'submitted'), scheduled_at, scheduled_by_name, meet_link, meet_passcode, decision`.
- GET error → 500 `{error}`. The client treats any error as `[]`, so the block renders nothing.

**Layout** (hidden when there are no invites):

- Section `Interviews to conduct ({pending.length || invites.length})`.
  - `pending` = MAIN invites with status ≠ submitted, plus PANELIST invites with status = invited.
- Each row:
  - Line 1: `{candidate_name||'Candidate'}`, round chip `{round}`, then a pill: info `Main interviewer` or mut `Panelist`.
  - Line 2:
    - `when` = `scheduled_at` formatted `toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})`, or `time to be confirmed`.
    - Then `{when}{scheduled_by_name? ` · by ${name}`}`.
    - If `meet_link`: ` · ` + a **Join link** anchor (new tab).
    - If `meet_passcode`: ` · Passcode: ` + bold passcode.
  - Right side, by status:
    - `submitted` → green pill `Feedback submitted ✓` plus ` · On hold` / ` · Rejected` / ` · Shortlisted` from `decision` HOLD/REJECT/else.
    - `acknowledged` and panelist → muted pill `Acknowledged · panelist (feedback is the main interviewer's)`.
    - `acknowledged` and main → blue button **"Give feedback"**.
    - else → green button **"Acknowledge"** (`…` while busy).

**POST `/api/ess/interview`**:

- `{ action:'acknowledge', invite_id }`:
  - Sets `status='acknowledged', acknowledged_at` (only from `invited`).
  - Returns `{ok:true,status:'acknowledged'}`.
  - Toast: `Acknowledged. Record your feedback after the interview.`
- `{ action:'feedback', invite_id, feedback: Feedback }`:
  - Main interviewer only.
  - Patch: `status='submitted', feedback, submitted_at, acknowledged_at (kept or now), decision, decision_remark`.
  - Then `applyInterviewDecision` moves the candidate stage (§11).
  - Notifies `scheduled_by` with `notify.interview.feedback`: "{{interviewer_name}} submitted feedback for the {{round}} round{{#if score}} · {{score}}{{/if}}. Decision: {{decision}}{{#if decision_remark}} — {{decision_remark}}{{/if}}." where `score = "{total}/80 ({band})"`.
  - Returns `{ ok:true, status:'submitted', decision, stage: string|null }`.
  - Toast: `Feedback submitted. Thank you.`
- Errors:
  - 400 `invite_id is required`
  - 404 `No such interview task`
  - 403 `This interview task is not yours`
  - 403 `Only the main interviewer records feedback for this round`
  - 409 `Feedback for this round is already submitted`
  - 400 `feedback payload is required`
  - 400 `Choose Hold, Reject or Shortlist`
  - 400 `A remark is required for Hold / Reject`
  - 400 `Unknown action`
- No viewAs check.

**Feedback modal** (card max 1000px):

- Header: `{round} · Interview Feedback` + **Close**.
- Body: `InterviewFeedbackForm mode="fill"`, with `candidate={{name, sub: round}}` and `questions`.
- **Candidate strip**: initials tile, name, `round · sub`.
- **"Questions to ask (from the requisition)"**: info box with an ordered list, shown if there are questions.
- **"Rate all 8 parameters"** + ": score and remark are both mandatory" + chip `{done} of 8 rated`. The parameters, `FEEDBACK_PARAMS` (k / name / description):
  - TECH — Technical / Functional Knowledge — "Depth in the skills this role actually needs"
  - EXP — Relevant Experience — "How closely past work maps to this position"
  - PROB — Problem Solving & Analytical Ability — "How they break down and reason through a problem"
  - COMM — Communication & Articulation — "Clarity of expression, listening, structure of answers"
  - OWN — Ownership & Accountability — "Drives things to closure, owns outcomes and mistakes"
  - TEAM — Team Fit & Collaboration — "Works with others, aligns with how this team operates"
  - LEARN — Learning Agility & Adaptability — "Picks up new things, handles change and ambiguity"
  - STAB — Stability & Intent — "Job-change pattern, and genuine interest in this role"
- Each parameter:
  - 10 buttons, 1–10.
  - Value tone: ≥8 positive, ≥5 warning, else critical.
  - Score text `{v}/10`.
  - Remark input (placeholder `Remarks for this parameter (mandatory)`).
- **Overall assessment**: label "Detailed feedback (mandatory)", textarea (placeholder `Your full written assessment: what stood out, where the gaps are, and anything the next round should probe.`).
- **Decision**: label "Your decision (Hold and Reject need a remark)", buttons **Hold** (warning), **Reject** (critical), **Shortlist** (positive; `Submitting…` while busy), **Cancel**.
  - Hold or Reject opens a remark panel:
    - Title "Put the candidate on hold: add your remark" / "Reject the candidate: add your remark".
    - Placeholders: Hold → `Why on hold, and what would change the call (e.g. waiting on a comparison, notice period, budget)…`; Reject → `Why the candidate is not a fit for this role…`.
    - Buttons `Confirm Hold` / `Confirm Reject` and `Back`.
- **Validation** (before any decision):
  - `{n} parameter(s) not rated. All 8 must be rated.`
  - `Remarks are mandatory for every parameter: {n} missing: {names joined ", "}.`
  - `Detailed feedback is mandatory.`
  - On confirm without a remark: `A remark is required to put the candidate on hold` / `…to reject the candidate.`
- **Live score panel** (right column, 300px):
  - Total out of 80, the band chip, a progress bar.
  - `{pct}%{done<8? ` · ${8-done} to rate`}` or `Not started`.
  - Per-parameter values.
- **Payload** `Feedback`:

```ts
{ params: Record<k, 1..10>, remarks: Record<k,string>, overall: string, recommendation: string,
  total: number, pct: number, band: string, decision: 'HOLD'|'REJECT'|'SHORTLIST', decision_remark: string|null }
```

  - `recommendation` = HOLD `Borderline — needs another view` / REJECT `Do Not Recommend` / SHORTLIST `Recommend`.

### 4.4 Onboarding approvals — `OnboardingApprovals.tsx`

**Who:** `teamsFor(menu.roles, isSuperAdmin)` minus `HR_MANAGER`. Role → team mapping:

- `IT`: `IT`
- `ADMIN`: `ADMIN_COMPANY`
- `PAYROLL`: `PAYROLL`, `PAYROLL_ADMIN`

Super admin acts for all teams.

**GET `/api/ess/onboarding-approvals`** → `{ teams: ('IT'|'ADMIN'|'PAYROLL')[], items: Item[] }`:

- `onboarding_candidates` in the caller's company with status `HR_REVIEW|APPROVED`, ordered by `submitted_at`.
- Only those whose `HR_MANAGER` approval is `APPROVED` are included.
- `Item`:

```ts
{ id, full_name, designation, department, employment_type, date_of_joining, status, submitted_at, hr_notes,
  approvals: { team:'IT'|'ADMIN'|'PAYROLL'|'HR_MANAGER', status:'PENDING'|'APPROVED'|'RETURNED', acted_by_name, remark, acted_at }[],  // order IT, ADMIN, PAYROLL, HR_MANAGER
  waiting_on_me: team[] }   // my teams whose status is PENDING
```

- On a GET error the client uses `{teams:[], items:[]}` and renders nothing.

**Card:**

- Section `Onboarding approvals · {teams labels joined ' / '}{waiting? ` · ${n} waiting on you`}`. Labels: `IT`, `Admin`, `Payroll`, `HR Manager`.
- Waiting cards first (warning tint and edge), then the others.
- Each card:
  - Line 1: `{full_name}` + muted `· {designation||'—'}{department? ` · ${department}`}`.
  - Line 2: `Joining {day(doj)} · submitted {day}{waiting? ` · waiting on you for ${teams}`}`. `day` = en-IN `numeric/short/numeric`, `'—'` for null.
  - Pills per team: `{Team} · ✓|returned|pending`. Approved = positive, Returned = critical, else warning. The title tooltip is `acted_by_name · date · remark`.
  - Button **"Open approval form"** (primary, when waiting) or **"View"**.
- Footnote: "These forms are accepted by the HR Manager. Confirm your team's checklist and approve; once IT, Admin and Payroll have all approved, the HR Manager assigns the role and generates the employee code. Returning the form reopens the candidate's link for 48 hours."

**Open: GET `/api/ess/onboarding-approvals?open={id}`** → `{ teams, item, approvals, documents, hr_review, checklists, salary }`:

- `item`: `id, full_name, email, mobile, designation, department, employment_type, date_of_joining, offered_ctc, status, submitted_at, form_data, company_id, hr_notes, hr_review, token_expires_at, esic_applicable`. `magic_link_token` is stripped.
  - When the caller is not Payroll, `form_data.step_7.bank_account` is masked to `XXXX {last4}`.
- `documents[]`: `{ doc_code, label, file_name, mime_type, ai_status, hr_verified, note, hr_reviewed_at, uploaded_at, url }`. `url` is a **10-minute signed URL** from storage bucket `onboarding-docs`.
- `checklists`: `Record<'IT'|'ADMIN'|'PAYROLL', values>`. It starts from the `onboarding_candidates` column values, overridden by the team row's saved `checklist`.
  - Payroll: `annual_ctc` falls back to `salary.annual_ctc || offered_ctc`, and `basic_pct` to `salary.basic_pct`.
- `salary`: `SalaryBreakdown | null`, present only for a Payroll caller.
- Errors: 404 `Not found in your company`; any error → toast.
- Default acting team = `waiting_on_me[0] || teams[0]`.

**Approval sheet** (full-screen paper; Esc closes when not busy):

1. **Letterhead**:
   - Line: `Onboarding approval · {CHECKLISTS[team].title}`; **✕ Close**.
   - `full_name` (26px), then `designation · department`.
   - Then `{employment_type||'Employee'} · joining {day} · submitted {day}{email? ` · …`}{mobile? ` · …`}`.
   - Stamps per team: `{Team} ✓ {acted_by_name||'approved'}` / `↩ returned` / `· pending`.
2. If the user acts for more than one team: **"Acting as"** + team toggle buttons.
3. Status line:
   - If my team is approved: positive box `Approved for {Team} by {name||'—'} on {day}.`
   - Else: "Confirm your checklist, look through what the candidate filled in, then **approve for {Team}**. If something is wrong in the form, return it to the candidate with a remark."
4. **`01 {title} · your checklist`** (`Checklist`; read-only if already decided):
   - Blurb per team:
     - IT: "What the joiner walks in to on day one — tick each item once it is actually ready."
     - ADMIN: "What Admin has arranged for the joiner — tick each item once it is actually ready."
     - PAYROLL: "The structure the joiner will be paid on. Check the breakdown below; correct the CTC if the offer changed and the structure follows."
   - `{done} of {total} confirmed` (positive when complete) and a progress bar.
   - Inputs (text / number / select; `*` when required); a missing required field gets a warning border.
   - Bool tiles: tick plus `Ready` / `Click when ready` / `Not confirmed`.
   - Footer line: `To approve, still needed: {labels}.`
   - Fields (`lib/onboarding/checklists.ts`):
     - **IT readiness**
       - `it_email` "Official email ID" (text, required, hint `e.g. first.last@company.com`)
       - `it_email_created` "Email ID is created" (bool, required)
       - `it_laptop_issued` "Laptop is ready" (bool, required)
       - `it_laptop_tag` "Laptop asset tag" (text)
       - `it_access_done` "System access set up (HRMS, tools, VPN)" (bool, required)
     - **Admin readiness**
       - `admin_id_card` "ID card is ready" (bool, required)
       - `admin_access_card` "Access card number" (text)
       - `admin_seating` "Seating / desk allotted" (text, required, hint `e.g. 3rd floor, bay B, desk 14`)
       - `admin_welcome_kit` "Welcome kit / stationery ready" (bool)
     - **Payroll setup**
       - `annual_ctc` "Annual CTC (₹)" (number, required, >0)
       - `basic_pct` "Basic as % of CTC" (number, hint `from the breakdown`)
       - `pf_applicable` "PF applicable" (bool)
       - `pf_wage_type` "PF wage base" (select: BASIC_DA "Basic + DA", GROSS "Gross")
       - `tds_regime` "Tax regime" (select: NEW "New regime", OLD "Old regime")
       - `pt_state` "Professional tax state" (text)
       - `lwf_applicable` "LWF applicable" (bool)
       - `payroll_setup_done` "Salary structure entered in payroll" (bool, required)
5. **Payroll only** — `Salary structure` (`SalaryTable`):
   - `rebuildFor(salary, Number(check.PAYROLL.annual_ctc) || salary.annual_ctc)`.
   - Header: label, `{inr(annual)} a year · basic {inr} a month ({pct}%)`.
   - Source chip:
     - `negotiation` → From the negotiation (info)
     - `stipend` → Fees / stipend (info)
     - `offer_letter` → From the offer letter (info)
     - `computed` → Computed (warning)
   - `too_low` note in red.
   - Table: Component / Monthly / Annual. Rows of kind `head` / `note` span all three columns.
   - Note.
6. **Documents** (`{n} uploaded`): each `DocCard` shows an IMG/PDF tile, the label, `file_name · date`, "AI verified" when `ai_status==='VERIFIED'`, "accepted" when `hr_verified`, and an **Open ↗** link to the signed URL. Empty: `No documents uploaded.`
7. **Form sections** (`SCHEMA` from ReviewDrawer, for each `form_data[step]` present), numbered `02`, `03`…:
   - `step_3` Personal details
   - `step_4` Contact & addresses
   - `step_5` Emergency contacts, experience & education
   - `step_7` PAN, PF, bank & nominees

   Field lists are in `components/onboarding/ReviewDrawer.tsx` lines 104–126. Unknown keys appear under "Other" / "Foreign national". Display rules:
   - booleans → Yes / No
   - `YYYY-MM-DD` → en-IN date
   - empty → `—`
   - hidden keys: `bank_confirm, docs_uploaded, same_address`
8. **Decision bar**:
   - If `item.status==='EMPLOYEE_CREATED'` or decided: text `Already approved for {Team}.` / `The employee code is already generated.` + **Close**.
   - Return mode:
     - Title "Return to the candidate".
     - Textarea (placeholder `What should the candidate fix? e.g. the bank account number does not match the cancelled cheque.`).
     - **"Return with this remark"** (critical; disabled until there's text; `Sending…` while busy), **Cancel**.
     - Line: "The candidate is emailed your remark and the link, valid 48 hours."
   - Default:
     - **"✓ Approve for {Team}"** (positive; disabled and faint while required items are missing; `Saving…` while busy).
     - **"Save checklist"**.
     - **"Return to candidate…"**.
     - Right-hand status: `{n} item(s) still to confirm` (warning) or `Checklist complete`.

**POST `/api/ess/onboarding-approvals`** — body `{ onboarding_id, team, action:'approve'|'return'|'save', remark, checklist }`:

- Client checks:
  - Return with an empty remark → `Say what the candidate should fix.`
  - Approve with items missing → `Confirm the checklist first: {labels}.`
- Server errors:
  - viewAs → 403 `Your ESS session is not active, so there is nobody to record the approval for. Sign in again with your own ESS account.` or `An approval is recorded under your own name, so it cannot be actioned while you are viewing somebody else's portal. Open your own portal to approve.`
  - 400 `onboarding_id, team (IT | ADMIN | PAYROLL) and action are required`
  - 403 `You do not act for {team} approvals.`
  - 403 `This onboarding is not in your company.`
  - `decideApproval` errors (status in parentheses):
    - `Onboarding record not found` (404)
    - `The employee code is already generated.` (409)
    - `The candidate has not submitted the form yet.` (409)
    - `Say what the candidate should fix.` (400)
    - `The HR Manager has not accepted the form yet — it reaches IT, Admin and Payroll after that.` (409)
    - `Only IT, Admin and Payroll keep a checklist.` (400)
    - `Confirm the {title lower} first: {missing}.` (400, with `missing: string[]`)
    - DB error (500)
  - Error response: `{ error, missing }`.
- Server effects:
  - The checklist is normalised (bool / number / trimmed text). Column keys are written onto `onboarding_candidates`.
  - Payroll (not on return): the salary breakdown is recomputed for `checklist.annual_ctc`, `basic_pct` is overwritten from it, and a snapshot `salary_breakdown {source,label,annual_ctc,basic_monthly,basic_pct,rows,note}` is stored with the checklist.
  - `save` → updates `onboarding_approvals.checklist` only.
  - `approve` / `return` → updates the team row `status APPROVED|RETURNED, acted_by, acted_by_name, remark, acted_at, checklist`, plus `onboarding_audit_log`.
  - `return`:
    - Candidate `status='IN_PROGRESS'`, `hr_notes='{Team} returned the form: {remark}'`, `token_expires_at = now+48h`.
    - Corrections mail with the link `/onboarding/{magic_link_token}`, via Gmail SMTP when `GMAIL_USER` / `GMAIL_APP_PASSWORD` are set.
  - Third head approves → candidate `status='APPROVED'`, and every HR_MANAGER / HR_HEAD in the company gets a bell notification:
    - Title: "Approved by IT, Admin and Payroll — {name}"
    - Body: "{who} is approved by all three teams. Open Onboarding, press Role assignment on the card (L1, L2 and the ESS role), then generate the employee code."
    - Link `/ess/onboarding`, category ONBOARDING.
- Response: `{ ok:true, all_approved:boolean }`.
- Client toasts:
  - save → `Checklist saved.` (the sheet stays open)
  - all approved → `Approved for {Team} — IT, Admin and Payroll have all approved. The HR Manager now assigns the role and generates the employee code.`
  - approve → `Approved for {Team}.`
  - return → `Returned to the candidate with your remark.`
  - Then the sheet closes and the list reloads.

### 4.5 Core approvals queue

**GET `/api/ess/approvals`** → `{ items: PendingItem[], mine: number, chain?: ChainRow[] }`. Pass `?resignation_id=` to include `chain`.

```ts
PendingItem { kind:'LEAVE'|'LEAVE_CANCEL'|'REGULARISATION'|'TRAVEL'|'RESIGNATION', id, employee_id,
  who /* "Name · CODE" */, what, meta, stage, raised_at, surfaced_via /* 'stamped'|'RESIGNATION role'|'TRAVEL_CLAIM_FINANCE role'|'HOD scope' */,
  mine: boolean, actions: string[], tone?: 'w'|'d', link?: string, facts?: string[], alert?: string|null }
ChainRow { stage, action, note, proposed_lwd, actioned_at, approver: {full_name}|null, actor: {full_name}|null }
```

Built by `lib/ess/pending.ts buildPending(ctx)` (server-only).

**Part 1 — stamped to me** (`mine=true`, `surfaced_via='stamped'`):

- `leave_applications`: `current_approver_id = me`, `status PENDING`.
- `travel_claims`: `current_approver_id = me`, status in `PENDING_RM | PENDING_HR | PENDING_FINANCE`.
- `employee_resignation`: `current_approver_id = me`, status in `PENDING_RM_L1 | PENDING_RM_L2 | PENDING_HOD | PENDING_HR_MANAGER | RETENTION_HOLD`.
- `leave_applications` (cancellations): `cancel_approver_id = me`, `cancel_status REQUESTED`, `status APPROVED`.
- `attendance_regularisation`: `current_approver_id = me`, `status PENDING`. Grouped by `request_group || id`.

**Part 2 — scope extras** (`mine` = stamped to me):

- `approval_types` includes `RESIGNATION`, or super admin: **all** resignations in `PENDING_HR_MANAGER | RETENTION_HOLD`, with no company filter (`via 'RESIGNATION role'`).
  - `mine` is forced `true` for PENDING_HR_MANAGER rows. **BUG:** `fn_resignation_act` then refuses anyone who isn't the stamped approver: `This resignation is not waiting on you (stage …, approver …)`.
- `approval_types` includes `TRAVEL_CLAIM_FINANCE`, or super admin: all `PENDING_FINANCE` travel claims.
- `is_hod` with `hod_departments`: for active employees of those departments:
  - pending leave
  - pending travel claims
  - resignations with status `like PENDING_%`
  - pending regularisations (a group counts as `mine` only if every row is stamped to me)

Items are de-duplicated by `kind:id`. Sort order: `mine` first, then kind rank `RESIGNATION 0, TRAVEL 1, LEAVE 2, LEAVE_CANCEL 3, REGULARISATION 4`, then `raised_at` ascending.

**Item texts per kind** (`span(from,to)` = `fmtDate(from)` + ` – fmtDate(to)` when different; `plural(n,'day')`):

- **LEAVE**
  - what: `Leave request — {n day(s)}{half_day? ' (half day)'}, {span}`
  - meta: `[leave type name, reason, 'Requested {daysAgo(applied_at)}']` joined by ` · `
  - stage: `Approve — manager stage` (approval_stage L1) / `Approve — HR stage` (HR) / `Approve`
  - actions: mine ? `['Approve','Decline']` : `['View']`
  - facts (balance from `lib/leave/ledger.ledgersFor`, by policy):
    - UNLIMITED → `{short||name}: unpaid / no balance needed`
    - EARNED → `{short||name}: confirm the off-day worked before approving`
    - PER_OCCURRENCE → `{name}: up to {n day(s)} per occurrence`; alert `This is more than the {quota}-day entitlement.` when days > quota
    - else → `{short} balance {available} → {after} after approving{others>0? ` (another ${others} pending)`}`; alert when after < 0: `Not enough {short}: {available} left for a {days}-day request. Approving will be refused — decline, or ask for the extra days as LWP.`
  - team overlap (same L1 manager, APPROVED or PENDING leave on overlapping days):
    - `Also off: {first 3 joined ', '}{>3? ` +${n-3} more`}`, each item `Name (SHORT, 12 Oct[–14 Oct][, pending])`
    - or `Nobody else in the team is off on these dates`
  - if `from_date < today (IST)` and no alert yet: alert `These dates have already started or passed ({fmtDate}).`
- **LEAVE_CANCEL**
  - what: `Cancel approved leave — {n day(s)}, {span}`
  - meta: `[type, cancel_reason, 'Requested …']`
  - stage: `Cancellation`
  - actions: Approve/Decline or View
  - facts: `Approving gives {n day(s)} of {short||'leave'} back to the balance`
- **REGULARISATION**
  - what: `Attendance correction — {n day(s)}, {date or span}`
  - meta: `[reason, 'Requested …']`
  - stage: `Approve`
  - actions: Approve/Decline or View
  - facts: up to 5 lines `{dd Mon}: {recorded HH:MM–HH:MM (IST) | 'no punches recorded'} → {req_in}–{req_out}`, then `+{n} more day(s) with the same times`
  - alert `Some of these days are more than a month old — check payroll for that month has not closed.` when the oldest date is >30 days ago
- **TRAVEL**
  - what: `Travel claim: ₹{rounded en-IN}{claim_no? ' · '+no}`
  - meta: `[period 'from – to', 'Submitted …']`
  - stage: `RM approval` / `HR approval` / `Finance approval`
  - actions: `['Open claim']`, `link:'claims'`
- **RESIGNATION**
  - what: `Resignation: {label}`, using `RES_STAGE_LABEL`:
    - PENDING_RM_L1 → Acknowledge (RM L1)
    - PENDING_RM_L2 → Acknowledge (RM L2)
    - PENDING_HOD → Acknowledge (HOD)
    - PENDING_HR_MANAGER → HR Manager: set final LWD
    - RETENTION_HOLD → On retention hold
  - meta: `Submitted {date}`, `reason: {label}`, `notice {n|-} days`, `RM proposed LWD {date}`, `{n} days shortfall`, joined by ` · `, with empty parts omitted
  - stage: the same label
  - actions:
    - not mine → `['View full chain']`
    - RETENTION_HOLD → `['Resume chain','View full chain']`
    - HR stage → `['Set final LWD','View full chain']`
    - else → `['Acknowledge & forward','Accept with my date','Request retention']`
  - tone: HR stage → `w`; RETENTION_HOLD → `d`; else `w`

**Layout:**

1. **KPI strip** (4 tiles; values count up from 0 on first paint, skipped for >999 or reduced motion):
   - `Waiting on you` = mine (warn tone if >0, else ok)
   - `In your scope` = total − mine
   - `Resignations` = count of RESIGNATION
   - `Leave, attendance & travel` = count of the others
2. **Approvals card**: title **"Approvals"**, then filter chips:
   - `Waiting on me` (MINE, the default): `i.mine`
   - `Everything` (ALL)
   - `Leave`: LEAVE + LEAVE_CANCEL
   - `Attendance`: REGULARISATION
   - `Travel`
   - `Resignation`
   - Empty: `Nothing here: nothing is waiting on you.` (MINE) or `Nothing here: nothing in this view.`
3. **Footer note**: "Items stamped to you can be actioned here. Items in your wider scope (HOD department, HR / Finance role) are shown for oversight; the person they are stamped to acts on them. Approving an attendance correction updates the employee’s attendance for those days. Travel claims are actioned from the Travel Claims screen."

**PendingCard:**

- Left accent: brand gradient when mine; dashed when in scope.
- Top: `who` (14/700), then a kind chip (icon + label) and `what`. Kind labels: LEAVE clock "Leave", LEAVE_CANCEL x "Leave cancellation", REGULARISATION check "Attendance", TRAVEL plane "Travel", RESIGNATION door "Resignation".
- Right pill: mine → warn `{stage}`; else mut `{stage} · {surfaced_via}`.
- `meta` line (faint 11.5px), `facts` bullet list, `alert` warning note.
- **Action buttons**, in server order:
  - Style: index 0 and mine and not `View` → primary; matches `/decline|retention/i` → danger; else outline.
- **fire(a)**:
  - `Open claim` → `go(item.link || 'claims')`. The portal's Travel Claims view; no API call.
  - `View` → no-op.
  - `View full chain` → toggles; when opening, `GET /api/ess/approvals?resignation_id={id}` → `chain`.
  - Input-collecting actions open an inline form first: `Accept with my date`, `Request retention`, `Set final LWD`, `Decline`.
  - `Set final LWD` without a date → inline error `Pick the final last working day`.
  - Otherwise `POST /api/ess/approvals` with body `{ kind, id, action: a, note: note||null, lwd: lwd||null, regrettable: regret /* true|false|null */ }`.
  - Success → toast `{a}: done` and the list reloads. Error → red inline note with the message.
- **Inline form**:
  - Date input (`Accept with my date` → label "Proposed last working day"; `Set final LWD` → "Final last working day").
  - For Set final LWD: "Regrettable exit?" with toggles **Yes, regrettable** / **No**.
  - Note textarea:
    - Request retention → "What you plan to discuss"
    - Decline → "Reason (shown to the employee)"
    - else "Note (optional)"
  - None of these is mandatory.
  - Buttons `Confirm: {action}` and `Cancel` (Cancel clears the note and LWD but not `regret`).
- When `tone` is set and no form is open, a note shows: `w` → `Time-sensitive.`, `d` → `Needs a conversation, not just a click.`
- **Chain panel** ("Full chain"):
  - Empty: `No stage entries yet.`
  - Rows: **`{stage}`** · `{action lower, _→space}`{` · approver`}{` · LWD {proposed_lwd raw}`}, then `fmtDateTime(actioned_at)`, then `“note”` when present.

**POST `/api/ess/approvals`:**

- **viewAs errors (403):**
  - `Your ESS session is not active, so this decision has nobody to attribute it to. Sign in again with your own ESS account to approve or reject.`
  - `An approval is recorded under your own name, so it cannot be actioned while you are viewing somebody else's portal. Open your own portal to decide.`
- 400 `kind, id and action are required`.
- **LEAVE / LEAVE_CANCEL / REGULARISATION:**
  - `approve = /^approve/i`; `decline = /^decline|^reject/i`; anything else → 400 `Unknown action "{a}".`
  - `note` is trimmed and capped at 500 chars.
  - Calls `decideLeave | decideLeaveCancel | decideRegularisation` (`lib/leave/workflow.ts`). The response is the `Outcome` JSON: `{ ok:true, status, stage?, waiting_on?: {id,name,role}|null, message? }`.
  - Errors: `{error}` with `out.status`:
    - `That is not a leave request id.` (400)
    - `Leave request not found.` (404)
    - `Already {status lower}.` (409)
    - `You cannot decide your own request.` (403)
    - `This request is not waiting on you.` (403)
    - `Approving this would overdraw {short}: {n day(s)} left, request is {n day(s)}. Decline it, or ask {name} to re-apply with the extra days as Leave Without Pay.` (409)
    - Cancel: `There is no cancellation waiting on this leave.` (409)
    - Regularisation: `That is not a request id.` (400), `Attendance correction not found.` (404), `Could not update attendance for {day}: {msg}` (500)
  - Effects:
    - LEAVE with `leave_types.approval_by = 'BOTH'` at stage L1:
      - Approve moves `approval_stage` to `HR`.
      - The HR approver gets `notify.leave.awaiting_hr` "A {{leave_type}} request needs HR approval after the reporting manager signed off." plus mail `leave.request.approver`.
      - The employee gets `notify.leave.passed_to_hr` "Your manager approved {{days_label}} from {{from_date}}; it now needs HR approval."
      - Returns `{ok, status:'PENDING', stage:'HR', waiting_on}`.
      - This step is skipped if the next approver is the same person.
    - Otherwise:
      - Sets `status APPROVED|REJECTED, resolved_at, approver (name), approver_employee_id, remark`.
      - Balances re-sync.
      - Employee gets `notify.leave.approved` / `declined` ("{{days_label}} from {{from_date}} — approved|declined by {{approver_name}}{{#if note}}: {{note}}{{/if}}.") plus mail `leave.decision.employee`.
    - Cancel approve:
      - Sets `status CANCELLED, cancel_status APPROVED`.
      - Decline sets `cancel_status DECLINED`.
      - Notifies with `notify.leave.cancel_approved` / `cancel_declined`.
    - Regularisation approve:
      - Upserts `attendance_records` (PRESENT, `source REGULARISED`, worked = out − in − lunch, late vs shift start, OT past `max_out_punch`).
      - Sets the requests to `APPROVED|REJECTED`.
      - Notifies with `notify.attendance.reg_approved` / `reg_declined`.
      - Response `message: '{n} day(s) approved|declined.'`
  - Audit codes: `LEAVE_L1_APPROVED | LEAVE_APPROVED | LEAVE_REJECTED | LEAVE_CANCEL_APPROVED | LEAVE_CANCEL_DECLINED | REGULARISATION_APPROVED | REGULARISATION_REJECTED`.
- **RESIGNATION:**
  - Action label → code:
    - `Acknowledge & forward` → ACKNOWLEDGED
    - `Accept with my date` → ACCEPTED_WITH_DATE
    - `Request retention` → REQUESTED_RETENTION
    - `Resume chain` → RESUMED
    - `Set final LWD` → FINAL_LWD_SET
  - RPC `fn_resignation_act(p_resignation_id, p_actor_id=me, p_action, p_note, p_lwd, p_regrettable)` (§5.3).
  - Error → 409 `{error: message with the leading "xxx: " stripped}`.
  - Notifications by the new status:
    - `RETENTION_HOLD` → employee `notify.resignation.retention` "{{actor_name}} has asked to discuss your resignation before it moves ahead."
    - `PENDING_*`:
      - Employee `notify.resignation.moved` "{{actor_name}} acknowledged your resignation. It is now with {{next_stage}}." (`next_stage` = status minus `PENDING_`, first `_`→space)
      - The new approver `notify.resignation.awaiting` "A resignation in your chain needs your acknowledgement (stage {{stage}})." (link `/ess?tab=approvals`)
    - else if `final_lwd` → employee `notify.resignation.lwd` "HR has set your last working day as {{last_working_day}}."
  - Audit `RESIGNATION_{code}`.
  - Response: `{ ok:true, result: {status, stage?} | {status, final_lwd} }`.
- Any other kind (TRAVEL) → 400 `Travel claims are actioned from the Travel Claims screen.`

---

## 5. Exit Process (`ExitProcess.tsx`)

**Purpose:** the employee's own resignation: submit, follow the acknowledgement chain, withdraw.

### 5.1 GET `/api/ess/resignation`

Response: `{ current: ResignationRecord|null, chain: ChainRow[], reasons: {code,category,label}[], notice_period_days: number }`.

- `rows` = `employee_resignation.select('*, exit_reason_master(label, category)')` for me, `created_at` descending, limit 3.
- `current` = the first row with status in OPEN (`INITIATED, PENDING_RM_L1, PENDING_RM_L2, PENDING_HOD, PENDING_HR_MANAGER, RETENTION_HOLD, RECOVERY_PENDING`), else `rows[0]`, else null.
- `chain` = `resignation_stage_log` (`stage, action, note, proposed_lwd, actioned_at, approver(full_name, designation)`) ordered by `actioned_at`.
- `reasons` = `exit_reason_master` where `is_active`, ordered by `sort_order`. Seed values:

| code | category | label |
|---|---|---|
| CAREER_GROWTH | PUSH | Lack of career growth |
| MANAGER | PUSH | Relationship with manager |
| COMPENSATION | PUSH | Compensation below market |
| WORK_LIFE | PUSH | Workload / work-life balance |
| ROLE_FIT | PUSH | Role not as expected |
| BETTER_OPPORTUNITY | PULL | Better opportunity |
| HIGHER_STUDIES | PULL | Higher studies |
| RELOCATION | PERSONAL | Relocation |
| HEALTH_FAMILY | PERSONAL | Health / family |
| OTHER | PERSONAL | Other |

- `notice_period_days` = `employees.notice_period_days ?? 30`.
- Uses `essCaller` only (no menu).

`ResignationRecord` fields used: `id, status, submitted_at, created_at, notice_period_days, lwd_as_per_policy, proposed_lwd, final_lwd, reason_code, exit_reason_master.label, submitted_by_employee`.

States:

- error → red note
- loading → `Loading…`
- open = `current && status ∉ {SETTLED, WITHDRAWN}`. `INITIATED` and `RECOVERY_PENDING` count as open.

### 5.2 Screens

**A. Resigned (open)**

- **KPI strip**:
  - `Status`: `STAGE_LABEL[status] || status`, warn tone when RETENTION_HOLD. Labels:
    - INITIATED → Initiated by HR
    - PENDING_RM_L1 → With your reporting manager
    - PENDING_RM_L2 → With your L2 manager
    - PENDING_HOD → With your head of department
    - PENDING_HR_MANAGER → With HR: final last working day
    - RETENTION_HOLD → On hold: your manager wants to talk
    - RECOVERY_PENDING → Accepted: notice recovery pending
    - SETTLED → Settled
    - WITHDRAWN → Withdrawn
  - `Submitted`: `fmtDate(submitted_at || created_at)`
  - `Notice period`: `{notice_period_days ?? '-'} days`
  - `Last working day`: `fmtDate(final_lwd || proposed_lwd || lwd_as_per_policy)` or `-`, with a note `confirmed by HR` / `proposed by your manager` / `as per policy`
  - A value longer than 10 chars renders at 15px, else 18px.
- **Card "Your resignation"**:
  - `Reason: ` **`{exit_reason_master.label || reason_code || '-'}`**.
  - Sub-head **"Acknowledgement chain"**, then a vertical Timeline over `STAGE_ORDER = [PENDING_RM_L1, PENDING_RM_L2, PENDING_HOD, PENDING_HR_MANAGER]`:
    - Each node: label `STAGE_LABEL[stg]`.
    - Class:
      - on hold → `done` if a chain row exists
      - else `done` when i < index(status), `cur` when equal
    - Action line: chain row → `{action lower}{ · approver}{ · LWD fmtDate}`; else `pending acknowledgement` (current, not hold) or `upcoming`.
    - Time: `fmtDateTime(actioned_at)` or `waiting now`.
    - Note: `“note”`.
    - On hold, an extra `cur` node: "On hold: your manager wants to talk" / "chain paused: your manager wants to talk".
    - **BUG:** chain rows are keyed by `c.stage` (`RM_L1`, `RM_L2`, `HOD`, `HR_MANAGER`, `EMPLOYEE`) but looked up by `PENDING_*`, so a chain row never matches. Every past stage shows "upcoming" text with no time, and on hold no stage shows done. For INITIATED or RECOVERY_PENDING the index is −1, so every node is plain "upcoming". The legacy `ExitSection` (RoleTabs) instead listed raw chain rows: `{stage with first _→space} · {action} · approver`, a time, and notes except on STAMPED rows. Decide with the product owner which to reproduce.
  - **"Withdraw resignation"** (danger) if `status ∉ {RECOVERY_PENDING, SETTLED}` and `submitted_by_employee`.
    - Confirm dialog: `Withdraw your resignation? This closes the chain.`
    - Then `POST /api/ess/resignation {action:'WITHDRAW', id}`.
    - Toast `Resignation withdrawn`; reload. Error → toast error with the message.
  - Note: "Retention pauses the chain; only you can withdraw it. Your last working day becomes final at the HR stage."

**B. Form (no open resignation)**

- Card **"Resign"**.
- If a previous (closed) one exists: note `Your previous resignation is {label lower}.`
- Grid:
  - **Reason**: select with `Select…` plus the reasons. Changing it resets the confirm step.
  - **Date of resignation**: date input. Default = `new Date().toISOString().slice(0,10)`. **QUIRK:** that is the UTC date, so before 05:30 IST it is yesterday.
- **"Anything you want to say (optional)"**: textarea (placeholder `Share context for your manager and HR…`).
- Warning note: "Notice period on record: **{n|-} days**. Submitting starts the acknowledgement chain: your reporting manager first, then L2 / HOD, then HR sets the final last working day."
- Buttons:
  - **"Submit resignation"** (disabled until a reason is picked) → confirm step.
  - Confirm step: **"Yes, submit"** (solid red) and **"Not now"**.
- Submit:
  - `POST /api/ess/resignation {reason_code, date, remarks}`.
  - Toast `Resignation submitted`; reset the confirm step; reload. Error → toast error.

### 5.3 POST `/api/ess/resignation` and the chain (SQL, migration 071)

- **viewAs (403):**
  - `Your ESS session is not active, so this resignation has nobody to submit it. Sign in again with your own ESS account.`
  - `A resignation can only be submitted by the employee themself, so it cannot be done while you are viewing somebody else's portal.`
- **WITHDRAW** `{action:'WITHDRAW', id, note?}`:
  - RPC `fn_resignation_act(..., 'WITHDRAWN', note)`.
  - Error → 409 with the raw message (`Only the employee can withdraw a resignation`).
  - Response `{ok:true}`. Audit `RESIGNATION_WITHDRAWN`.
  - The SQL has no status guard: it sets `status='WITHDRAWN'`, clears the stage and approver, and logs `stage 'EMPLOYEE', action 'WITHDRAWN'`.
- **Submit**:
  - No `reason_code` → 400 `Pick a reason`.
  - RPC `fn_resignation_submit(p_employee_id, p_reason_code, p_date = body.date || today(UTC), p_remarks)`. Error → 409, e.g. `An open resignation already exists for this employee`. Any status other than SETTLED or WITHDRAWN blocks a new one.
  - Response `{ ok:true, id, status, stage }`.
  - Notifies the first approver with `notify.resignation.submitted`: "{{employee_name}}{{#if emp_code}} · {{emp_code}}{{/if}} has submitted a resignation. It is waiting on you ({{stage}})." (link `/ess?tab=approvals`).
  - Audit `RESIGNATION_SUBMITTED`.
- **Notice and LWD rules (`fn_resignation_submit`):**
  - `notice_period_days = COALESCE(employees.notice_period_days, 30)`
  - `lwd_as_per_policy = p_date + notice` (calendar days)
  - The row is inserted `INITIATED`, `submitted_by_employee=true`, `submitted_at=now()`, `initiated_by=employee`.
  - Then `fn_resignation_advance`.
- **Advance (`fn_resignation_advance`):**
  - Stages: `RM_L1 → RM_L2 → HOD → HR_MANAGER`.
  - Approver per stage (`fn_resignation_stage_approver`):
    - RM_L1 = `l1_manager_id`
    - RM_L2 = `l2_manager_id`
    - HOD = `employees.hod_id` or `departments.hod_employee_id`
    - HR_MANAGER = `hr_manager_id`, else the first active ESS role holder with a `RESIGNATION` `can_approve` right (by role `sort_order`)
  - A stage is SKIPPED (logged with a note) when its approver is null (`No approver resolved`), is the employee (`Resolves to the resigning employee`), or has already ACKNOWLEDGED / ACCEPTED_WITH_DATE (`Already acted at an earlier stage`).
  - Otherwise: `current_stage=s`, `current_approver_id=ess_effective_approver(appr)` (delegation), `status='PENDING_'||s`, logged STAMPED.
  - Chain exhausted → `status INITIATED`, stage and approver null (parked for HR).
- **Act (`fn_resignation_act`):**
  - `WITHDRAWN`: actor must be the employee.
  - Every other action: actor must equal `current_approver_id`, else `This resignation is not waiting on you (stage %, approver %)`.
  - `RESUMED`: needs `RETENTION_HOLD` (else `Not on retention hold`); sets `status 'PENDING_'||current_stage`.
  - While on RETENTION_HOLD, any other action → `On retention hold — log RESUMED first`.
  - `REQUESTED_RETENTION`: `status RETENTION_HOLD`, `retention_note = note`.
  - At HR_MANAGER:
    - Only `FINAL_LWD_SET` is allowed (`HR Manager stage expects FINAL_LWD_SET`); LWD is required (`final LWD required`).
    - Sets `final_lwd`, `lwd_confirmed_by_emp`, `notice_shortfall_days = max(0, lwd_as_per_policy − final_lwd)`, `recovery_required = shortfall>0`, `is_regrettable = coalesce(p_regrettable, …)`.
    - `status = shortfall>0 ? RECOVERY_PENDING : SETTLED`; stage and approver cleared.
  - `ACKNOWLEDGED` / `ACCEPTED_WITH_DATE` (else `Unknown action %`):
    - Logged with `proposed_lwd`.
    - `ACCEPTED_WITH_DATE` with an LWD also sets `employee_resignation.proposed_lwd`.
    - Then advance.
- **Status machine:** `INITIATED → PENDING_RM_L1 → PENDING_RM_L2 → PENDING_HOD → PENDING_HR_MANAGER → SETTLED | RECOVERY_PENDING`. Also `↔ RETENTION_HOLD` (paused at any PENDING stage) and `→ WITHDRAWN` (employee).

---

## 6. Raise MRF (`raise-mrf` view; deep link only) and `MrfForm`

### 6.1 `RaiseMrfSection` (RoleTabs)

- Reached via `/ess/raise-mrf`; there is no tab.
- `adminMode` (viewing someone else's portal):
  - Title "Raise a Manpower Requisition (MRF)".
  - Note: "You are viewing another employee's portal. An MRF is raised by the person themself, so it cannot be submitted from here — the server refuses it. Leave this portal (“Back to my portal” / “Exit Admin Mode” above) and raise it from your own."
- Else:
  - Title as above, then "Fill the form to open a hiring requisition. It routes through your reporting chain to the HR Head, company-scoped."
  - `GET /api/ess/mrf` → `canRaise`. A GET error treats it as `true`.
  - `canRaise === false` → note "Raising an MRF is available to reporting managers (RM1 / RM2) and heads of department. If you should have this, ask HR to set your reporting line."
  - Else `<MrfForm>`. `onDone` remounts a fresh form and scrolls to top; `onCancel` → `go('approvals')`.

### 6.2 `MrfForm` (also used by Edit & resubmit)

**Load (direct Supabase, anon)**, for `raiserId = employeeId` (or `viewRow.requested_by` in read-only review):

```ts
supabase.from('manpower_requisitions').select('id').eq('mrf_number', cand).maybeSingle()   // reserve MRF-YYYY-NNNNN, up to 6 tries (skipped if initial has mrf_number)
supabase.from('employees').select('id, full_name, emp_code, designation, company_id, department_id, hod_id, l1_manager_id, companies:companies!employees_company_id_fkey(company_name), departments:departments!employees_department_id_fkey(dept_name, dept_code)').eq('id', raiserId).maybeSingle()
supabase.from('employees').select('id, full_name, emp_code').in('id', [l1_manager_id, hod_id].filter(Boolean))
supabase.from('ess_accounts').select('id').eq('employee_id', raiserId).maybeSingle()
supabase.from('ess_user_roles').select('ess_roles(role_name, role_code)').eq('ess_account_id', acct.id).eq('is_active', true)
   // role = first non-EMPLOYEE role_name else designation; canConfidential = any role_code HR_HEAD
supabase.from('master_types').select('id, code').in('code', ['grade','shift_type','candidate_source','separation_reason','business_unit','cost_center','currency'])
supabase.from('master_values').select('type_id, code, label, is_active, sort_order').in('type_id', typeIds).order('sort_order')   // drop is_active === false
supabase.from('employees').select('id, full_name, emp_code, designation').eq('company_id', company_id).eq('employment_status', 'Active').order('full_name')
supabase.from('locations').select('id, location_name').eq('company_id', company_id).eq('status', 'Active').order('location_name')
supabase.from('skills').select('name').order('name')
supabase.from('skills').insert({ name })            // "+ Add custom" skill; errors ignored
```

- Loading state: `Loading form…`.
- `raised_by_name` / `raised_by_role` are pre-filled from the bundle.

**Lane toggle** (top): **Quick Hire (CTC ≤ ₹6L)** / **Full MRF (CTC > ₹6L)**.

- `annualMax = budget_max × (MONTHLY ? 12 : 1)`; the cap is `600000`.
- When `budget_max` is set and the lane differs: red banner `This budget suits **{lane}**.` + button `Switch to {lane}`.

**Step wizard.** One section at a time. The header reads `Step {i} of {n}` and `{done} of {required} required done`. Steps can be visited only up to the furthest seen.

**Next** is labelled `Next · {next title} →`. If the current step's gate fails it shows a lock badge with the message and toasts the error.

**Back**, **Save Draft** (any step) and **Cancel** are always available. **Submit for Approval** appears on the last step (`Submitting…` while busy).

Steps, gates and fields:

1. **Requisition Meta** (no gate):
   - Requisition Type: New Hire / Replacement / Temporary / Backfill
   - Priority: HIGH "High / Urgent", MEDIUM "Medium / Normal", LOW "Low"
   - Request Source: Not specified / Manual / Manpower plan (AOP) / Triggered by separation
   - Requisition ID (locked; hint `Reserved for this requisition` / `Reserving a number…`; text `Generating…`)
   - Raised By — Name (placeholder "Your name")
   - Raised By — Role (placeholder "e.g. Department Head")
   - HR Head only: checkbox **🔒 Confidential hiring**, with the long explainer text in the source (lines 46–56 of the JSX chunk)
2. **Position Details** (required; `Designation is required.`):
   - Locked: Company (`auto · your company`), Department / Function (`auto · your department`)
   - Business Unit (master)
   - Job Title (e.g. Backend Engineer II)
   - **Designation \*** (e.g. Senior Engineer)
   - No. of Openings (number, min 1)
   - Grade / Band (master)
   - Job Code (placeholder `{DEPT}-{ABBR}-## (auto)`; hint "Auto-generated on save — leave blank, or type your own" / "Custom code")
   - Locked: RM1 (`auto · you`), RM2 (`auto · your manager`), HOD (`auto · your HOD`)
3. **Employment Details**:
   - Employment Type: Employee / Intern / Contract / Consultant / NAPS / NATS / Live Project
   - Work Mode: Onsite / Hybrid / Remote
   - Work Location
   - Background Verification (Required / Not required)
   - BGV Package
   - Pre-employment Medical
4. **Budget & Cost** (gate `{Label} range minimum cannot be more than the maximum.`):
   - Info line `{employment_type} → paid as {salary|stipend|fees}, quoted {per annum|per month}`. Compensation by type:
     - Employee: Salary/ANNUAL
     - Intern / NAPS / NATS / Live Project: Stipend/MONTHLY, fixed-term
     - Contract: Fees/MONTHLY, fixed-term
     - Consultant: Fees/MONTHLY
   - Cost Center
   - Budgeted Position
   - Approved Headcount Ref.
   - Headcount Sanctioned / Actual / Open
   - Currency
   - `{Label} Range — Min / Max`
   - Worker / Skill Category: Unskilled / Semi Skilled / Skilled / Highly Skilled
   - Duration (months), when fixed-term or MONTHLY
   - Variable Pay (%)
   - Budget Code
   - Allowances: Joining Bonus + Cap, Relocation + Cap, Notice Buyout + Cap, ESOP / Retention + Detail. Each cap is disabled when its flag is "no".
   - Closure: Offered CTC, Actual Joining Date, Source
   - `LaneMeter` showing the annualised band against the ₹6L cap
5. **Justification** (required):
   - Gate: `Reason for hire is required.` / `Pick the outgoing employee for a replacement.`
   - Reason for Hire: New position / Replacement / Expansion / Attrition
   - Outgoing Employee (Replacement / Backfill only; company people)
   - Reason for Exit (separation_reason master)
   - Business Justification
6. **Timeline** (required; `Target joining date is required.`): Target Joining Date, Requisition Validity / Expiry
7. **Candidate Requirements** (Full MRF only; required; `Add mandatory skills or a job description.`):
   - Experience min/max
   - Education min/max: Any Graduate, Bachelors, B.Tech/B.E., MBA/PGDM, M.Tech, B.Com/M.Com, BCA/MCA, Diploma, 12th Pass, Any Post Graduate, Masters
   - Previous Company Preference (MNC / Startup)
   - Relevant experience min/max
   - Specialisation, Certifications, Industry Preference, Target Companies
   - Max Notice Period
   - Languages, Travel %
   - Relocation Required
   - Diversity Requisition
   - Licence / Vehicle
   - Role Summary, KRAs
   - Mandatory Skills / Good-to-have Skills (chip multi-select with "+ Add custom: “x”"; stored comma-joined)
   - Job Description
   - Questions to ask the candidate (`+ Add question` / Remove; hint "optional · every interviewer sees these on the feedback form")
8. **Approval Workflow**: info "On submit this routes through your reporting chain, company-scoped:" / `You ({code}) → RM2 · {rm2} → HR Head` (or `RM2 (if set)`)
9. **Sourcing** (Full MRF only): Internal vs External (External / Internal / Both), Agency / Vendor, Agency Fee %, Exclusivity (days), Candidate Ownership (days), Preferred Sourcing Channels (candidate_source chips; empty → "No sourcing channels configured.")
10. **Attachments**: "Files can be attached from the Recruitment module once the MRF is created."

When `replaceRef` is set: warning "**Editing / resubmitting.** When you submit, the previous requisition is scrapped and this corrected one goes for approval afresh."

**save(status)**:

- Client checks:
  - `Designation is required.`
  - min > max → `{Label} range minimum (₹x) cannot be more than the maximum (₹y).`
  - SUBMITTED also needs:
    - `Reason for hire is required to submit.`
    - `Target joining date is required to submit.`
    - Full MRF: `Add mandatory skills or a job description to submit a Full MRF.`
    - `Pick the outgoing employee for a replacement.`
- If `essSessionExpired()` (localStorage `ezer_ess_session` has a token but it's expired) → `Your ESS session has expired. Sign in again in another tab, then press save — your answers are kept.`
- `POST /api/ess/mrf` with body `{ action:'create', status:'DRAFT'|'SUBMITTED', designation, mrf_number, replace_id, mrf_type, hiring_type, urgency, is_confidential (only if canConfidential), raised_by_name, raised_by_role, job_title, business_unit, grade, job_code, openings, hod_id, employment_type, work_mode, location_id, cost_center, is_budgeted ('yes'|'no'|''), headcount_ref, currency, budget_min, budget_max, wage_category, compensation_type, pay_period, duration_months, reason, outgoing_employee_id, exit_reason, business_justification, target_joining_date, validity_date, experience_min/max, education_min/max, previous_company_preference, skills_required, good_to_have_skills, ctq_questions[], job_description, sourcing_mode, sourcing_channels[], + Field-Master fields (request_source, headcount_*, agency_*, bgv_*, medical_required, closure_*, role_summary, kras, specialisation, certifications, relevant_experience_*, industry_preference, target_companies, max_notice_period_days, languages, travel_percentage, relocation_required, diversity_flag, licence_requirement, variable_percentage, joining_bonus_*, relocation_allowance_*, notice_buyout_*, esop_*, budget_code) }`.
- **BUG:** `/api/ess/mrf` `create` does not read any of the Field-Master fields. They are silently dropped. The form's comments claim otherwise.
- Server `create`:
  - `!(is_rm || is_hod || canApprovals)` → 403 `You do not have rights to raise an MRF.`
  - 400 `Designation is required.`
  - Confidential without HR_HEAD → 403 `Only the HR Head can raise a confidential MRF.`
  - Status: DRAFT if requested; confidential → APPROVED; else SUBMITTED.
  - `replace_id`:
    - Not the raiser (and not super admin) → 403 `Only the raiser can edit this MRF.`
    - Deletes the old row if it is the raiser's and its status is SUBMITTED / DRAFT / NEEDS_REVISION.
  - Chain:
    - RM2 = the raiser's `l1_manager` (if not self), PENDING.
    - Then HR_HEAD of the company (if not self and not the RM2): WAITING, or PENDING if it's the first step.
    - Empty chain on SUBMITTED → 400 `No approver could be found: your company has no HR Head / manager set. Please contact HR.`
  - Budget order check → 400 `Budget minimum (₹x) cannot be more than the maximum (₹y).`
  - `job_code` is auto-generated (`DEPT-ABBR-NN`) if blank.
  - The reserved `mrf_number` is honoured if it matches `^MRF-\d{4}-\d{5}$` and is unused.
  - Company and department are locked to the raiser.
  - Defaults: `urgency MEDIUM`, `employment_type Employee`, `currency INR`; `raised_by_role` RM2/RM1.
  - Returns `{ ok:true, id, mrf_number, status, confidential }`.
- Success:
  - DRAFT → toast `MRF saved as draft.` + `onDone()`.
  - SUBMITTED → success panel:
    - ✓ icon and **"You have successfully raised the MRF"** (or "Confidential MRF raised and approved").
    - `Requisition ID: {n}`.
    - Text: "It’s been sent for approval through your reporting chain (RM2 → HR Head)." (or the confidential variant), followed by "You can raise another, or resubmit this one if you spotted a mistake (the one you just submitted will be scrapped)."
    - Buttons: **＋ Raise one more MRF** (fresh form with a new number), **↺ Resubmit (fix this one)** (`replace_id` = the new id), **Done**.

---

## 7. Company (`CompanySection`)

**Gate:** `can.company`; the server returns 403 `You do not hold a role that opens this.` and 400 `No company on this employee`.

**GET `/api/ess/company`** → response:

```ts
{ fy: '2026-27', quarter_from: 'YYYY-MM-01',
  kpis: { label, value: number }[],       // 'Total headcount','Departments','Locations','Open positions'
  departments: { dept, headcount, open_exits, push }[],     // sorted headcount desc
  reasons: { category, reason, exits, regrettable, depts: {} /* Set serialises to {} */, concentration: string }[],  // sorted exits desc
  attrition_note: string | null,
  regime: [{ regime:'Old Regime', employees, costlier }, { regime:'New Regime', employees, costlier }],
  regime_note: string | null }
```

Server queries, scoped to the caller's company (service role):

- Employees: Active, non-test, limit 10000 (`id, department_id`).
- Departments: `id, dept_name`.
- Locations: `status ≠ INACTIVE`.
- `manpower_requisitions` with status in OPEN / APPROVED / IN_PROGRESS, confidential ones excluded.
- `v_attrition_reasons` with `quarter_start ≥ start of the current quarter` (server clock, local time).
- `tds_declarations` for the FY (`regime, annual_tax_old, annual_tax_new`).
- Open resignations (status not SETTLED / WITHDRAWN) joined to `employees!inner` on company.

Calculations:

- Departments: headcount per `department_id` (null → "Unassigned"); `open_exits` per department from open resignations; `push` = sum of `exits` where category PUSH.
- Reasons: grouped by `category|reason`; sums `exits` and `regrettable`; `concentration` = department names joined ", ".
- Open positions = Σ `no_of_openings ?? openings ?? 1`.
- Regime: a declaration is OLD if `regime==='OLD'`, else NEW. It is "costlier" when OLD and `tax_old > tax_new`, or NEW and `tax_new > tax_old`.
- `attrition_note` (when there is a top PUSH department and at least one exit): `{top.push} of {exitsTotal} exits this quarter cite a push reason{top.push===pushTotal ? `, all in ${dept}` : `; ${dept} has the most`}. That is one organisational finding, not {exitsTotal} decisions.`
- `regime_note` (when the costlier total is >0): `{n} employees are on the costlier regime for their own numbers. The comparison is computed on every declaration, so nudging them costs nothing to surface.`

Layout:

- States: error → red note; loading → `Loading…`.
1. KPI tiles (auto-fit, min 140px; label 10px uppercase muted; value 20/800).
2. Two cards side by side (auto-fit, min 320px):
   - **"Headcount by department"** table: Department | Headcount (right) | Open exits (right; `-` when 0) | Push-reason (right; critical bold when >0, else `-`).
   - **"Why people are leaving, this quarter"**:
     - Empty: `No exits recorded with a reason this quarter.`
     - Table: Category (pill: PUSH dang, PULL info, else mut) | Reason | Exits | Regrettable | Concentration (muted 12px, `-` when empty).
     - `attrition_note` as a red note: the first sentence (up to the first ".") is bold, the rest plain.
3. **"Regime election: FY {fy}"** table: Regime elected | Employees | Costlier for how many (warning colour when >0). `regime_note` as a warning note.

There is no export, no filters and no charts: plain tables only.

---

## 8. Reports (`ReportsSection`)

**Gate:** `can.reports`. The server returns 403 `You do not hold a role that opens this.`; with a `report` param it also returns 400 `No company on this employee` and 400 `Unknown report`.

- **GET `/api/ess/reports`** (no param) → `{ reports: {key,title,desc}[] }`:

| key | title | desc |
|---|---|---|
| attrition | Attrition & exit reasons | Push / Pull / Personal breakdown, by department and quarter |
| regime | Regime comparison | Every employee, Old vs New, and what the wrong election costs them |
| declaration | Investment declaration status | Who has declared, who has proven, what the January cliff looks like |
| tds | TDS register | Month-wise TDS and additional TDS, company-wide |
| span | Span of control | Managers with an unusually high number of direct reports |

- **GET `/api/ess/reports?report={key}`** → `{ title: string, columns: string[], rows: (string|number|null)[][] }`.
  - `inr(n)` = `Math.round(Number(n||0))`.
  - FY = `fyOf()`, the current FY.

| key | title | columns | rows / sort |
|---|---|---|---|
| attrition | `Attrition & exit reasons` | Quarter, Department, Category, Reason, Exits, Regrettable, Open | `v_attrition_reasons` for the company, `quarter_start` desc: `[quarter, dept_name\|\|'-', category, reason, exits, regrettable, open_exits]` |
| regime | `Regime comparison: FY {fy}` | Code, Name, Elected, Tax (Old), Tax (New), Cost of election, Verdict, Status | `tds_declarations` + employees: `[code, name, regime, old, new, elected−min(old,new), >0?'Costlier':'Optimal', declaration_status]`, sorted by cost desc |
| declaration | `Investment declaration status: FY {fy}{window? ` (proof window closes ${proof_close})`}` | Code, Name, Declared ₹, Proven ₹, Sections, Verified, Status, At risk ₹ | per employee from `investment_declaration_lines`: declared Σ, proven Σ, lines = sections with declared>0, verified = those VERIFIED; Status = `Nothing declared` / `Proven` / `Partly proven` / `Unproven`; At risk = `declared − proven` if `lines && verified<lines`, else 0. Sorted by at-risk desc. Window from `tds_declaration_window` for the FY |
| tds | `TDS register: FY {fy}` | Month, Code, Name, Regime, TDS, Additional TDS, Total | `payroll_employee_snapshot` joined to `payroll_runs` (company, FY, not CANCELLED), limit 20000: `[period_label, employee_code, full_name, tds_regime_used\|\|'-', tds_monthly, tds_additional, sum]`, sorted by month then code (string compare) |
| span | `Span of control` | Code, Manager, Designation, Department, Direct reports, Band | counts of active non-test employees per `l1_manager_id`: `[code, name, designation\|\|'-', dept\|\|'-', n, n>8?'High': n<2?'Low':'Typical']`, sorted by n desc |

Layout:

- An error shows a red note at the top (and clears on the next run).
- Card **"Reports"**: one row per report with the title (13.5/700), `desc` (muted) and two outline buttons:
  - **Open** (shows `…` while this report is busy).
  - **Export CSV**.
  - Both are disabled while any report is busy.
- Open → results card:
  - Header `{title} · {rows.length} rows` + **Close**.
  - Scrollable table (max height 520). Header `S.th` (ink background).
  - Numbers are right-aligned and formatted `toLocaleString('en-IN')`; other values `String(v ?? '-')`.
  - Shows the first **500** rows; when there are more: note `Showing the first 500 rows. Export CSV for everything.`
- **Export CSV**:
  - Fetches the same endpoint again.
  - `toCsv(columns, rows)`: a cell is quoted when it contains `"`, `,` or a newline, with `"` doubled; lines joined with `\n`; no BOM.
  - Blob `text/csv`, filename `{title with every run of non-alphanumerics → '_'}.csv`.
  - Numbers stay raw, not locale-formatted. There is no XLSX export.

---

## 9. Every direct browser Supabase query (anon key) in scope

| # | Where | Query |
|---|---|---|
| 1 | Directory | `employees.select('id, emp_code, full_name, designation, mobile, office_email, personal_email, blacklisted, last_working_date, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name), companies!employees_company_id_fkey(company_name)').order('full_name')` |
| 2 | Requests load | `ess_service_requests.select('*').eq('employee_id', id).order('submitted_at', {ascending:false})` |
| 3 | Requests insert | `ess_service_requests.insert({employee_id, request_type, request_data:{detail}, is_confidential, assigned_to})` |
| 4–13 | MrfForm | the ten queries listed verbatim in §6.2 (MRF number reservation, raiser, managers, `ess_accounts`, `ess_user_roles`, `master_types`, `master_values`, company employees, locations, skills select and insert) |

Every other read and write in these screens goes through `/api/ess/*` with the service-role client server-side. There is no browser storage access except the signed onboarding document URLs, which are plain HTTPS links.

---

## 10. Reusable logic — what is pure

| Module | Pure? | Use in RN |
|---|---|---|
| `lib/onboarding/checklists.ts` (`CHECKLISTS, HEAD_TEAMS, isHeadTeam, missingItems, normaliseChecklist, checklistColumns, summariseChecklist`) | **Pure, no imports** | `import { CHECKLISTS, missingItems } from '@/lib/onboarding/checklists'` |
| `lib/onboarding/salary-breakdown.ts` (`rebuildFor, buildBreakdown, computedBreakdown, stipendBreakdown, offerLetterBreakdown`, type `SalaryBreakdown`) | Pure, except `loadSalaryBreakdown`, which takes an injected `sb`. It imports `lib/recruitment/ctc-model` (no imports) and `ctc-statement` → `engagement` → `compensation.ts` (all pure) | `import { rebuildFor, type SalaryBreakdown } from '@/lib/onboarding/salary-breakdown'` |
| `lib/recruitment/interview-decision.ts` (`DECISION_LABEL, DECISIONS, isDecision, stageForRound, roundOrdinal, distinctRounds`) | Pure; only a type import of `SupabaseClient` (`applyInterviewDecision` takes `sb`) | `import { DECISION_LABEL, type Decision } from '@/lib/recruitment/interview-decision'` |
| `lib/recruitment/job-code.ts` (`newMrfNumber, jobCodePrefix, nextJobCode`) | Pure | `import { jobCodePrefix, newMrfNumber } from '@/lib/recruitment/job-code'` |
| `lib/recruitment/min-wages.ts` (`WAGE_CATS`) | Pure | as is |
| `lib/recruitment/confidential.ts` | Pure | as is |
| `components/recruitment/InterviewFeedbackForm.tsx` → `FEEDBACK_PARAMS, scoreFeedback, bandOf` | Logic is pure but lives in a React DOM file that imports `@/lib/ui` | **Copy** into a `lib/` module. Bands: pct≥80 `Strong Hire` (positive), ≥65 `Hire` (info), ≥50 `Borderline` (warning), else `No Hire` (critical). `pct = round(total/80×100)` |
| `components/recruitment/RecruiterPicker.tsx` → `toPickerPeople` | Pure function in a DOM file | copy |
| `components/onboarding/ReviewDrawer.tsx` → `SCHEMA`, `TEAM`, `blocksFor` (not exported) | Data and logic in a DOM file | copy |
| `components/ess/MrfForm.tsx` → `mrfToForm`, `EMPTY`, `COMPENSATION`, `STEPS` gates | DOM file that imports `@/lib/supabase` | copy |
| `components/ess/hris/ui.tsx` → `hueOf, initials, fmtDate, fmtDateTime` | DOM file | copy |
| RoleTabs `toCsv` | inline | copy |
| `lib/ess/session.ts` (`fyOf, fmtDate, daysAgo`) | **Server-only** (`next/server`, `@/lib/rms/server`) | copy, don't import |
| `lib/ess/pending.ts`, `lib/leave/workflow.ts`, `lib/onboarding/approvals.ts` / `review.ts`, `lib/recruitment/offer-approval-notify.ts` | **Server-only** (service-role client, nodemailer) | don't import; call the API |
| `lib/ess/api.ts`, `lib/rms/client.ts` (`authToken`) | Browser: `lib/rms/client` uses `@/lib/supabase` and localStorage | re-implement with SecureStore |
| `lib/ess-session-client.ts` (`essSessionExpired`) | Browser localStorage | re-implement |

---

## 11. Notes on behaviour that must be kept

- Interview decision → candidate stage (`applyInterviewDecision`), server-side:
  - REJECT → `Rejected`
  - HOLD → `Hold`
  - SHORTLIST → the round's stage, by name (Telephonic / L1 / L2 / Optional Round) or else by ordinal (1st Telephonic, 2nd L1, 3rd L2, later Optional Round)
  - Never changes a candidate already at `Offer Sent` or `Joined`.
- The approvals list is a convenience, never the authorisation. Every action re-checks the stamping server-side. RN must render `item.actions` exactly as returned and must not compute actions itself.
- The core Approvals list reloads after each action. Nothing is updated optimistically.
- HRIS tab state is kept across tab switches: RN should keep the four screens mounted in a tab navigator (`lazy` but `unmountOnBlur: false`).
- Legacy, unreachable components (don't port): `ApprovalsSection`, `ExitSection` and `PendingOnYou` are imported by EmployeePortal. `PendingOnYou` is used only inside the unused legacy `Home`, and the other two aren't rendered at all. `/api/ess/home` feeds `PendingOnYou` (`{kpis, pending, pending_title}`); the current Home is "Today" (see spec 01).

---

## Implementation notes for React Native

1. **Auth and fetch:**
   - Port `api(path, employeeId, init)` exactly: always append `employee_id`, send `Authorization: Bearer <ESS token>`, read `{error}` on a non-2xx and throw it.
   - Store the token in SecureStore.
   - Use full base URLs (`https://ezer-hrms-chi.vercel.app`).
2. **Direct Supabase reads:**
   - The directory, service requests and MrfForm reference lists use the anon key. Use `@supabase/supabase-js` in RN with AsyncStorage, keeping the same queries verbatim (§9).
   - The browser `authToken()` fallback to the Supabase session has no RN equivalent unless Supabase auth is used. ESS token only is fine.
3. **Links and actions:**
   - `mailto:` / `tel:` / `https://wa.me/91…` → `Linking.openURL`.
   - Signed document URLs (10-min expiry) → `WebBrowser.openBrowserAsync`. Refetch `?open=` if the sheet has been open for longer than about 9 minutes.
   - Web-only destinations: `/ess/recruitment/mrf?mrfSub=approvals&mrf=…`, `/ess/recruitment/hrhead?offer=…`, `/ess/recruitment/sendoffer`, the `Open claim` → `claims` view. Map each to a native screen if one exists, else open the web URL in the in-app browser.
4. **CSV export:**
   - Build the CSV string with the same `toCsv`.
   - Write it to `FileSystem.cacheDirectory + {title_sanitised}.csv` with `expo-file-system`, then `expo-sharing` `shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' })`.
   - There is no XLSX in the source, so don't add one.
5. **Charts:**
   - Company and Reports are **tables only**; there are no charts in the source.
   - If a visual is wanted later, use `victory-native` or `react-native-gifted-charts`, but parity means tables.
   - The interview score bar and the checklist progress bar are simple Views with a percentage width.
6. **Wide tables on a phone:**
   - Company tables have 4–5 columns. Render each row as a card with label/value pairs, or put a horizontal `ScrollView` around a fixed-width table.
   - Reports have up to 8 columns × 500 rows. Use a `FlatList` of row cards: first column as the title, the rest as two-column key/value. Or use a horizontally scrollable `FlashList` with a sticky header.
   - Keep the 500-row display cap and its note.
   - Number formatting: `toLocaleString('en-IN')` needs Hermes Intl. Expo SDK 50+ ships with it; otherwise write a small en-IN grouping helper.
7. **Dates:**
   - Date pickers: `@react-native-community/datetimepicker`. Send `YYYY-MM-DD`.
   - Reproduce the UTC-today default for the resignation date only if strict parity is required. It is a quirk (§5.2).
   - Format with en-IN options as listed in §0.6.
8. **Modals and sheets:**
   - Offer review, interview feedback (a 2-column layout on web: stack the live-score panel above or below on a phone) and the onboarding sheet → full-screen `Modal` with a `ScrollView`.
   - Person modal → bottom sheet.
   - Confirm dialogs (`window.confirm`) → `Alert.alert` with the exact copy.
9. **Toasts:** one toast host per HRIS stack, 2.6 s. Keep the quirk that RoleTabs blocks inside Tasks & Approvals show errors as plain toasts, or fix it deliberately, but say which you did.
10. **Counts and badges:** the Requests badge is the filed count. The Approvals badge is `mine`. Both are fed from the child screens as they load.
11. **Keep the bugs flagged** (`Timeline` stage-key mismatch, RESIGNATION-role `mine` forced true, Field-Master MRF fields dropped by the route, the directory not company-scoped, POSH confidentiality client-only), unless the product owner signs off on fixes. Server behaviour won't change just because the client does.
