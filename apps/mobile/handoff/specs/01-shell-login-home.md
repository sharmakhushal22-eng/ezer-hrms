# 01 — ESS Login, Portal Shell, Home (Today)

Source of truth: repo `/Users/girish/Documents/ezer-hrms`, branch `feat/mobile-app` (read 19 Oct 2026).
Everything below is quoted from source. Where the web app has a quirk or bug, it is called out as **QUIRK** so the RN team can decide whether to reproduce or fix it.

Colour names are tokens from `lib/ui` (`C.brand`, `C.positive`, …). Today's CSS uses the same tokens as CSS vars (`var(--ez-positive)` = `C.positive`) plus three Today-only colours: `--gold:#D4A017` / `--gold-soft:#FBEBB5` (dark: `#F2C14E` / `#3A2E0F`).

---

## 0. Files in scope

| Area | Files |
|---|---|
| Login page | `app/ess-login/page.tsx` |
| Auth routes | `app/api/ess-auth/status/route.ts`, `login/route.ts`, `set-password/route.ts`, `change-password/route.ts` (`admin/generate` is HR-side, out of scope) |
| Auth libs | `lib/ess-auth.ts` (resolveEmployee, scrypt hash/verify), `lib/ess-session.ts` (token issue/verify, server), `lib/ess-session-client.ts` (client token read + expiry), `lib/auth-headers.ts`, `lib/rms/client.ts` (`authToken`, `readEssSession`), `lib/ess/api.ts`, `lib/api-auth.ts` (`requireDashboardUser`), `lib/ess/session.ts` (`essCaller`, `essContext`, `essRoute`), `lib/ess/asked.ts`, `lib/session.ts` (`getSessionEmployee`) |
| Portal route | `app/ess/page.tsx` → `components/ess/PortalPage.tsx` → `components/ess/EmployeePortal.tsx` |
| Nav / menu | `SECTIONS`, `NAV_GROUPS`, `MOBILE_PRIMARY`, `VIEW_KEYS` inside `EmployeePortal.tsx`; `useEssMenu` in `components/ess/RoleTabs.tsx`; `app/api/ess/menu/route.ts`; `lib/rms/nav.ts` (admin groups, excluded) ; `lib/ess/routes.ts` (URL ↔ view) |
| Bell | `NotificationBell`, `Notifications` in `EmployeePortal.tsx`; `app/api/ess/notifications/route.ts`; `app/api/ess/inbox/route.ts` (unread only) |
| Theme | `lib/ui/ThemeToggle.tsx`, `lib/ui/theme-resolve.ts`, `lib/today/prefs-client.ts`, `app/api/ess/preferences/route.ts` |
| Home | `components/ess/today/*` (Today, HeroPanel, PunchDial, StatTiles, WeekStrip, PendingList, QuickActions, Journey, TeamToday, HolidayCard, Celebrations, NewJoiners, RecognitionCard, Announcements, Toast, hooks, icons, today.css), `lib/today/*` (types, schema, format, prefs-client), `app/api/ess/today`, `app/api/ess/punch`, `app/api/ess/announcements`, `app/api/ess/celebrations`, `app/api/ess/preferences`, `lib/attendance/punch.ts`, SQL `ess_today_payload` (latest body: `supabase/migrations/154_ess_leave_total_excludes_unquota.sql`), `ess_team_presence`/`ess_attendance_streak`/`ess_shift_window` (`111_ess_today.sql`), `ess_new_joiners_feed` (`120_new_joiners_group_wide.sql`), `ess_punch` (`036_shift_attendance.sql`) |
| Dead code (not rendered) | `Home`, `PunchButton`, `TransferAckCard` in `EmployeePortal.tsx` (old Home, replaced by `<Today/>`), `components/ess/Celebrations.tsx`, `PendingOnYou` (RoleTabs) and therefore `GET /api/ess/home`, `AdminEntry` (defined, never rendered). `GET /api/ess/session` exists but **no client calls it**. |

---

## 1. Authentication model

### 1.1 Identity
- ESS employees are **not** Supabase-auth users. Login is against table `ess_accounts` (scrypt hash + salt).
- Identifier = **email OR employee code**. Resolution (`lib/ess-auth.ts → resolveEmployee`):
  1. Trim. If it matches `/^[A-Za-z]{2,6}-?\d{3,6}$/` (looks like an emp code) → `employees` `ilike('emp_code', id)`.
  2. If no rows: `employees.or('personal_email.ilike.<lower>,office_email.ilike.<lower>')`.
  3. Prefer the row whose `employment_status` lower-cased is `'active'`, else first row. Columns: `id, full_name, emp_code, employment_status, personal_email, office_email`.
- Password hashing: `crypto.scryptSync(password, salt, 64)` hex, salt 16 random bytes hex. Server-only.

### 1.2 Session token (`lib/ess-session.ts`)
- Format: `<base64url(JSON {sub: employeeId, exp: epochMillis})>.<base64url(HMAC-SHA256(body, secret))>`.
- TTL **12 hours** (`TTL_HOURS = 12`). No refresh endpoint; no sliding renewal.
- Secret = `ESS_SESSION_SECRET || SUPABASE_SERVICE_ROLE_KEY`; if none, `issueEssToken` returns `null` (response then has `token: null, session_available: false`).
- Server reads **only** `Authorization: Bearer <token>`; an `employee_id` in body/query never establishes identity (it is only a "view-as" request, see 1.5).

### 1.3 Client storage — `localStorage['ezer_ess_session']`
Exact JSON written by the login page (`finish()`):
```json
{ "employee_id": "<uuid>", "name": "<full_name from response>", "email": "<identifier as typed, trimmed, lower-cased>", "token": "<token string> | null" }
```
Note `email` holds whatever the user typed (could be an emp code, lower-cased e.g. `"srs0001"`).
Other key used: `localStorage['ezer_theme']` = `'light' | 'dark' | 'system'` (theme choice, see §4.7).

Client token helpers:
- `lib/ess-session-client.ts → essToken()`: returns the token only if parseable and `Date.now() + 30_000 < payload.exp` (30 s skew); `null` for absent / malformed / expired. `essSessionExpired()` = a token exists but `essToken()` is null. `essAuthHeaders()` → `{ Authorization: 'Bearer …' }` or `{}`.
- `lib/auth-headers.ts → authHeaders()`: `{ 'Content-Type': 'application/json', Authorization }` using the live ESS token, else the Supabase session token (legacy admin), else no Authorization.
- `lib/rms/client.ts → authToken()`: **QUIRK** returns the stored ESS token **without** checking expiry, else Supabase access token. Used by `lib/ess/api.ts` (menu, week strip) and old PunchButton.
- `lib/ess/api.ts → api(path, employeeId, init?)`: fetches `${path}${?|&}employee_id=<employeeId>` with `cache:'no-store'`, `Content-Type: application/json`, bearer from `authToken()`. On non-2xx throws `Error(body.error || 'HTTP <status>')` with `.status` and `.body`.

### 1.4 Server auth errors common to every `/api/ess/*` route (via `requireDashboardUser` → `essCaller`)
| Case | Status | Body |
|---|---|---|
| No bearer | 401 | `{ "error": "Sign in first. This endpoint needs a dashboard session." }` |
| Bearer present but invalid/expired (and not a Supabase JWT) | 401 | `{ "error": "Your session has expired. Sign in again." }` |
| ESS user asks for another employee_id without admin access | 403 | `{ "error": "You can only open your own portal." }` |
| Legacy dashboard login with no employee_id | 400 | `{ "error": "employee_id is required for the dashboard login." }` |
| `essRoute` context failure | 500 | `{ "error": "ess_menu: <msg>. Has migration 071 been run?" }` (or other message) |

Routes using `getSessionEmployee` (today, preferences, announcements POST) instead return `401 {"error":"unauthenticated"}` and `403 {"error":"access ended"}` when `employees.date_of_leaving` is in the past.

### 1.5 View-as (EXCLUDE from RN)
`essCaller` lets an ESS user with admin access (or the legacy Supabase dashboard login) pass `?employee_id=<other>` (query, or `employee_id` in a JSON body for writes) to read someone else's portal; `viewAs=true`, audited to `ess_access_audit`. The RN app should always act as self; sending `employee_id=<own id>` (as `lib/ess/api.ts` does) is harmless.

---

## 2. Screen: ESS Login (`/ess-login`)

### 2.1 On mount
- If `localStorage['ezer_ess_session']` parses and has `employee_id` → `window.location.replace('/ess')` (login form never shown to a signed-in person). **QUIRK**: this ignores token expiry, so an expired session bounces straight back to the portal (where API calls 401) — the user must press Sign out to reach the form. RN recommendation: on launch, treat `essToken()===null` as signed-out.

### 2.2 Layout
- Desktop (>880px): left brand panel (gradient `C.brand → C.brandDeep → C.brand`, text `C.onAccent`), right form card. ≤880px: brand panel hidden; small Logo (34px) above the card.
- Brand panel copy (decorative, optional in RN): Logo with tagline; headline "Your workday,\nin one place."; sub "Payslips, leave, attendance, flexi benefits & more, all self-service, secure, and always with you."; three rows: "Payslips & tax" / "Download anytime"; "Leave & attendance" / "Apply and track"; "Flexi & reimbursements" / "Submit bills in a tap"; footer "Bank-grade security · Your data stays private".
- Card (bg `C.surface`, radius 20): 2-segment progress bar (segment filled `C.brand` when `i <= stepIndex`; stepIndex = 0 on `email` step, 1 otherwise; unfilled `C.brandTint`), title (h1 21px/800), subtitle (14px `C.muted`), step form, divider, link **"Admin login"** → `/` (EXCLUDE in RN or keep as web link). Below card: "Need help? Contact your HR team." (12px `C.faint`).
- Field style: label 11px/700 uppercase `C.brandDeep`; input bg `C.brandTint`, 2px border (`C.brand` focused, `C.brandTint` idle), radius 10, left icon (`C.brand` focused / `C.faint` idle). Text field has `autoCapitalize="characters"` (**note**: also applied to the email/code field on web). Password fields have eye toggle (aria "Show password"/"Hide password").
- Primary button full width: label/loadingLabel; disabled while loading (bg `C.brandTint`). Error box: bg `C.criticalTint`, text `C.critical`, alert icon. Info box: bg `C.canvas`, border `C.brandEdge`, text `C.brandDeep`.

### 2.3 Steps (state machine `'email' | 'login' | 'setpw' | 'changepw'`)

Titles: email → **"Employee Sign In"**; login → **"Enter Password"**; setpw → **"Create Password"**; changepw → **"New Password"**.
Subtitles (`first` = first word of `name`):
- email: "Sign in with your email or employee code"
- login: name ? `Welcome back, {first} 👋` : "Enter your password"
- setpw: name ? `Hi {first}, create your password` : "Create your password"
- changepw: name ? `Hi {first}, set a new password` : "Set a new password"

**Step `email`**
- Field: label "Email or Employee Code", placeholder "you@company.com · SRS0001", user icon, autofocus.
- Button "Continue →" / loading "Checking…".
- Validation: empty trimmed → "Please enter your email or employee code."
- Call: `POST /api/ess-auth/status` body `{ "identifier": "<trimmed>" }` (no auth header).
  - Response found: `{ "found": true, "employee_id": "<uuid>", "name": "<full_name>", "has_password": <bool> }` (`has_password` = an `ess_accounts` row exists with non-null `password_hash`).
  - Not found: `{ "found": false }` → error "No employee found. Check your email / code or contact HR."
  - 400 `{ "error": "Email or employee code required" }` / `{ "error": "Invalid request" }` (client then shows the not-found message since `data.found` is falsy).
  - Network/parse failure → "Something went wrong. Try again."
- Success → store name/employee_id; go to `login` if `has_password` else `setpw`.

**Step `login`**
- Field: "Password", placeholder "Enter your password", autofocus. Button "Log in →" / "Signing in…". Back link "Use a different email / code" (→ step email, clears error + password).
- Validation: empty → "Please enter your password."
- Call: `POST /api/ess-auth/login` body `{ "identifier": "<trimmed>", "password": "<pw>" }`.
  - 200: `{ "ok": true, "employee_id": "<uuid>", "name": "<full_name>", "must_change_password": <bool>, "token": "<token>|null", "session_available": <bool> }`. Side effect: `ess_accounts.last_login_at = now`, `first_login_at = now` only if `login_count` was 0/null, `login_count += 1`.
  - 401 `{ "error": "Invalid email/employee code or password" }` (unknown employee, no account/hash/salt, or wrong password).
  - 403 `{ "error": "Account inactive. Contact HR." }` (`ess_accounts.status !== 'ACTIVE'`).
  - 400 `{ "error": "Invalid request" }`.
  - Client: `!r.ok` → shows `data.error || 'Login failed.'`.
  - If `must_change_password` → set name (`data.name || name`) and go to `changepw` (session **not** stored yet; the typed password is kept as `current_password`).
  - Else → `finish(data)`.

**Step `setpw`** (first-time, no password yet)
- Info: "First time here? Create a password (min 6 characters) for your ESS account."
- Fields: "New Password" (placeholder "At least 6 characters", autofocus), "Confirm Password" (placeholder "Re-enter password"). Button "Set password & continue →" / "Saving…". Back link (clears password + confirm).
- Validation order: `password.length < 6` → "Password must be at least 6 characters."; mismatch → "Passwords do not match."
- Call: `POST /api/ess-auth/set-password` body `{ "identifier": "<trimmed>", "password": "<pw>" }`.
  - 200 `{ "ok": true, "employee_id": "<uuid>", "name": "<full_name>" }` — **no token**. Creates or updates `ess_accounts` (`password_hash, password_salt, status:'ACTIVE', must_change_password:false, first_login_at:now`).
  - 400 `{ "error": "Password must be at least 6 characters" }`; 404 `{ "error": "No employee found with this email/employee code" }`; 409 `{ "error": "Password already set. Use login." }`; 500 `{ "error": "<db message>" }`.
  - Client `!r.ok` → `data.error || 'Could not set password.'`; success → `finish(data)`.
  - **QUIRK / BUG**: because no token is returned, the stored session has `token: null`; every `/api/ess/*` call then 401s ("Sign in first…") until the user signs out and logs in again. RN fix: after a successful set-password, immediately call `/api/ess-auth/login` with the same credentials and store that token.

**Step `changepw`** (forced; HR-issued temp password)
- Warning box (bg `C.warningTint`, text `C.warning`): "You logged in with a temporary password. Set your own password to continue."
- Fields: "New Password" (placeholder "At least 6 characters"), "Confirm New Password" (placeholder "Re-enter password"). Button "Set new password & continue →" / "Saving…". No back link.
- Validation: `newPw.length < 6` → "New password must be at least 6 characters."; mismatch → "Passwords do not match."
- Call: `POST /api/ess-auth/change-password` body `{ "identifier": "<trimmed>", "current_password": "<pw typed on login step>", "new_password": "<newPw>" }`.
  - 200 `{ "ok": true, "employee_id", "name", "token", "session_available" }`; clears `must_change_password`.
  - 400 `{ "error": "New password must be at least 6 characters" }` / `{ "error": "New password must be different from the current one" }`; 404 `{ "error": "Account not found" }` / `{ "error": "No account to update" }`; 403 `{ "error": "Account inactive. Contact HR." }`; 401 `{ "error": "Current password is incorrect" }`; 500.
  - Client `!r.ok` → `data.error || 'Could not change password.'`; success → `finish(data)`.

**finish(data)**: writes the session JSON (§1.3) and `window.location.replace('/ess')` (no back-navigation to login).

Every step clears `error` on submit; catch → "Something went wrong. Try again."

There is **no voluntary change-password UI inside the portal** (the route supports it, nothing calls it except the forced step). No forgot-password flow (copy says contact HR).

---

## 3. Portal bootstrap (`/ess` → `PortalPage` → `EmployeePortal`)

### 3.1 PortalPage
- On mount: read `ezer_ess_session`; if missing/unparseable/no `employee_id` → `window.location.replace('/ess-login')`.
- Until then: full-screen "Loading your portal…" (14px `C.muted` on `C.canvas`).
- Renders `<EmployeePortal employeeId={session.employee_id} onExit={onExit} urlSync headerExtra={viewOthers} exitLabel="Sign out" />`.
- **Sign out** (`onExit`): `localStorage.removeItem('ezer_ess_session')` then `window.location.replace('/ess-login')`. Nothing else is cleared (theme key, Supabase session untouched). No server call.
- EXCLUDE: `loadAccessScope()` + "View team member" button/picker + the dark "{SCOPE} VIEW · Viewing <name> · code · designation — Back to my portal" banner. For reference, its direct Supabase queries (anon key): `ess_accounts.select('id').eq('employee_id',id).maybeSingle()`; `ess_user_roles.select('role_id').eq('ess_account_id',acct.id).eq('is_active',true)`; `ess_roles.select('role_name, scope').in('id',roleIds)`; `employees.select('company_id, department_id, location_id').eq('id',id)`; `employees.select('id, emp_code, full_name, designation, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)').eq('employment_status','Active').neq('is_test',true).order('emp_code')` + scope filter, `.limit(5000)`.

### 3.2 Loading the employee record — DIRECT SUPABASE (anon key) — `lib/supabase-ess.ts → loadEmployeeDetail(employeeId)`
Queries, in order:
1. `supabase.from('employees').select(EMP_FIELDS).eq('id', employeeId).maybeSingle()` where `EMP_FIELDS` is verbatim:
```
id, emp_code, common_code, full_name, first_name, last_name, designation, grade,
gender, date_of_birth, blood_group, marital_status, nationality, religion, birth_place,
father_name, mother_name, spouse_name,
mobile, alternate_mobile, personal_email, office_email,
res_address1, res_city, res_state, res_pin,
perm_address1, perm_city, perm_state, perm_pin,
emergency_name, emergency_relation, emergency_mobile,
emergency2_name, emergency2_relation, emergency2_mobile,
pan_number, aadhar_last4, uan_number, group_doj, company_doj, confirmation_status,
employment_status, employment_type, collar_type, employee_function, employee_category,
notice_period_days, intern_pay, consultant_pay, contract_pay,
company_id, l1_manager_id, hr_manager_id,
pf_applicable, esic_applicable, pt_applicable, lwf_applicable,
bank_name, account_type, bank_account_last4, ifsc_code,
date_of_resignation, last_working_date, rehire_eligible, blacklisted,
departments!employees_department_id_fkey(dept_name), companies!employees_company_id_fkey(company_name), locations!location_id(location_name, city)
```
   If null → portal shows "Employee not found." (`C.critical`, centered).
2. If `l1_manager_id`/`hr_manager_id`: `employees.select('id, full_name').in('id', mgrIds)`.
3. `ess_accounts.select('status, password_reset_allowed').eq('employee_id', employeeId).maybeSingle()`.
4. `employees.select('profile_photo').eq('id', employeeId).maybeSingle()` (base64 JPEG data URL or null).

`EmployeeDetail` = every raw column above spread, plus derived: `dept_name` (departments.dept_name), `company_name`, `location_name`, `city` (locations.city), `l1_manager_name`, `hr_manager_name`, `profile_photo`, `account_status` (ess_accounts.status), `password_reset_allowed` (`!== false`). Shell uses: `id, emp_code, full_name, first_name, designation, profile_photo`.
While loading: "Loading portal…" (`C.brand`, centered). Reload function exists (`reload`) but only the dead Home used it.

### 3.3 `/api/ess/session` (blocked state) — NOT CALLED BY THE WEB PORTAL
`GET /api/ess/session` (bearer). Response:
```json
{ "blocked": <bool>, "reason": "<string|null>", "source": "account|employee|location|default|null", "view_as": <bool>,
  "employee": { "id", "emp_code", "full_name", "designation", "company_id", "dept_name" } }
```
`blocked = !fn_ess_enabled(employee).enabled`. `fn_ess_enabled` reasons (verbatim): no account → "No ESS account" (source account); `ess_enabled_override` set → override value with `ess_override_reason` or "Set for this employee" (employee); account status ≠ ACTIVE → `deactivation_reason` or "Account <status lower>" (account); location policy disabled → `reason` or "ESS is switched off for this location" (location); employment_status ≠ Active → "Employment status: <status>" (employee); else enabled (default). Errors: 500 `fn_ess_enabled: <msg>. Has migration 071 been run?`, 404 `Employee not found`. The web shows no blocked screen at all; if RN wants one, it would be new UI (decision for product).

### 3.4 `/api/ess/menu` — `useEssMenu(emp.id)`
- Called after `emp` loads: `api('/api/ess/menu', emp.id)` → `GET /api/ess/menu?employee_id=<id>`.
- Response (from `app/api/ess/menu/route.ts`):
```json
{
  "tabs": [{ "id": "home", "label": "Home" }, { "id": "approvals", "label": "Approvals" }, { "id": "company", "label": "Company" }, { "id": "reports", "label": "Reports" }],
  "is_rm": false, "direct_reports": 0, "is_hod": false, "hod_departments": ["<dept>"],
  "roles": [{ "code": "HR_HEAD", "name": "HR Head", "scope": "ORG" }],
  "functional_scope": "SELF|TEAM|DEPT|BRANCH|ORG",
  "approval_types": ["LEAVE", "..."],
  "modules": { "<Module name>": "NONE|VIEW|EDIT|FULL" },
  "can": { "approvals": <bool>, "company": <bool>, "reports": <bool> },
  "screens": { "allow": { "<screen key>": true }, "configured": { "<module key>": true } },
  "super_admin": <bool>, "view_as": <bool>
}
```
- Server rules (`essContext`): `ess_menu` RPC (retried once after 350 ms) + RMS grant. `can.company` = super admin or grant module `'Company Dashboard'` ≥ VIEW; `can.reports` = super admin or `'ESS Reports'` ≥ VIEW; `can.approvals` = `is_rm || is_hod || approval_types.length>0 || super_admin`.
- Default before load / on error: `EMPTY_MENU` = all false, `tabs:[home]`, modules `{}`.
- Error display (desktop rail only): red box (bg `C.criticalTint`, text `C.critical`, 11px) "Could not load your access: {error}".

### 3.5 Who sees what (sidebar sections)
`sections = SECTIONS.filter(s => s.k==='company' ? menu.can.company : s.k==='reports' ? menu.can.reports : true)`.
Everything else is shown to every employee. `canRaiseMrf = menu.is_rm || menu.is_hod || menu.can.approvals` (only used to filter a `raise-mrf` item, which no section lists any more, and passed to HrisShell). `Tasks & Approvals` is shown to everyone (HrisShell receives `canApprove = menu.can.approvals` and renders an empty state for non-approvers — see HRIS spec).

`SECTIONS` (order as defined; `status` drives "Soon" tags):

| key | label | short (mobile) | status | desc (shown under page title) | items `k: label` |
|---|---|---|---|---|---|
| home | Home | Home | ready | The landing dashboard: everything at a glance | home: Home |
| profile | Profile | Profile | ready | Your personal details, documents and letters | profile: My Details · documents: Letter Requests · letters: My Letters |
| team | Team | Team | ready | Your manager, your peers and the people who report to you | team: Team |
| orgchart | Org Chart | Org | ready | See how the whole company fits together | orgchart: Org Chart |
| payroll | Payroll | Payroll | partial | Salary, benefits, tax declarations and claims | payslip: Salary Slip *(phase 3, "Payslip generation")* · flexi: Flexi Benefits · proofs: Investment Proofs · flexiclaims: Flexi Claims · vpf: Voluntary PF · nps: Corporate NPS · loans: Loans · claims: Travel Claims · statutory: Statutory *(phase 3, "Payroll")* |
| attendance | Attendance | Attend | ready | Your punches, working hours and monthly calendar | attendance: Attendance |
| leave | Leave | Leave | ready | Apply for leave, track your requests and plan around holidays | leave: Leave |
| inbox | Inbox | Inbox | ready | Messages from colleagues and teams, and every notification in full | inbox: Inbox |
| expenses | Travel & Expenses | T&E | ready | Trips, legs, bills and claims: travel from planning to payout | expenses: Travel & Expenses (`href: '/ess/travel'` — separate page) |
| hris | HR Services | HR | partial | Directory, requests, approvals and the exit process | directory: Team Directory · requests: Raise a Request · approvals: Tasks & Approvals · exit: Exit Process |
| company | Company | Company | ready | Headcount, attrition and tax-regime trends across the company | company: Company *(gated: can.company)* |
| reports | Reports | Reports | ready | Attrition, regime comparison, declaration status, TDS register, span of control | reports: Reports *(gated: can.reports)* |
| performance | Performance | PMS | ready | Your goals (KRAs) and the reviews you owe | performance: Performance |
| social | Social | Social | ready | Birthdays, work anniversaries, new joiners and the Wall of Fame | social: Social |
| rnr | RNR | RNR | **soon** | Reward and recognise great work with points you can redeem | rnr: RNR (renders FeatureGrid) |
| funzone | Fun Zone | Fun | ready | Take a break: play a quick game with your team | funzone: Fun Zone |

`declaration` (Investment Declaration) has a render case but is intentionally not in nav (reachable only by key/URL).

Rail grouping `NAV_GROUPS` (order = rail order; empty groups dropped; unplaced sections appended to the last group):
1. *(no label)*: home, inbox
2. **Time & pay**: attendance, leave, payroll, expenses
3. **You & your team**: profile, team, orgchart, performance
4. **Workplace**: hris, company, reports
5. **Community**: social, rnr, funzone

Icons (`ESS_ICON`, from `lib/ui`): home IconHome, profile IconUser, team IconEmployees, payroll IconPayroll, inbox IconMail, attendance IconCalendar, leave IconLeave, hris IconLetters, performance IconPerformance, orgchart IconOrgChart, company IconBuilding, reports IconReports, social IconHeart, rnr IconAward, funzone IconGame, expenses IconReceipt.

### 3.6 View key → screen (renderView)
If the active section is `soon` with features → `FeatureGrid`. Else:

| view key | renders (other specs) |
|---|---|
| home | `<Today onOpenTab={go}/>` (§5) |
| profile | `Profile360 code={emp.emp_code} employeeId={emp.id}` |
| leave | `LeaveSection` |
| inbox | `InboxShell employeeId firstName={emp.first_name || first word of full_name} onUnread={setUnread}` |
| vpf / nps / loans | `VpfSection` / `NpsSection` / `LoansSection` |
| flexi | `FlexiTdsCalculator employeeId empName empCode` |
| declaration | `InvestmentDeclaration` |
| proofs | `InvestmentProofs` |
| flexiclaims | `FlexiClaims` |
| claims | `TravelClaims` |
| expenses | never reached (go() opens `/ess/travel`); fallback `GoneToItsOwnPage` "Opening Travel and Expenses… Continue" |
| attendance | `AttendanceModule` |
| documents | `Documents` (Letter Requests) |
| letters | `MyLetters` |
| team | `MyTeam emp isMobile` |
| orgchart | `AdminModuleHost moduleKey="org-chart"` (the dashboard Org Chart page embedded) |
| directory, requests, approvals, raise-mrf, exit | `HrisShell employeeId tab={view} go canApprove canRaiseMrf adminMode notify` |
| company | `CompanySection` (API 403s "You do not hold a role that opens this." if not permitted — shown as red note) |
| reports | `ReportsSection` |
| performance | `Performance` |
| social | `Social` |
| funzone | `FunZone` |
| anything else (payslip, statutory) | `Placeholder` |

**Placeholder** (card, centered, padding 48/24): 56px rounded tile (bg `C.brandTint`, fg `C.brand`, border `C.brandEdge`) with IconCalendar; title **"{label} is coming soon"** (17px/700) e.g. "Salary Slip is coming soon", "Statutory is coming soon"; body (13.5px `C.muted`) **"We’re getting this ready for you. It will appear here as soon as your HR team switches it on."**

**FeatureGrid** (RNR): auto-fit grid (min 220px) of tiles (bg `C.surface`, border `C.line`, radius R.lg): 38px icon tile (bg `C.brandTint`, fg `C.brand`; icon = ESS_ICON[f.icon] else IconAward), name (13.5px/700), note (12px `C.muted`). RNR features: Nominate — "Pick a category, write why" (icon social); Approval — "Manager / HR reviews" (hris); Points — "Credited on approval" (rnr); Redeem — "Vouchers, leave, merch" (payroll); Leaderboard — "Top recognized employees" (performance). Footer note (bg `C.brandTint`, border `C.brandEdge`, `C.brandDeep`): **"This is on its way. Above is what it will let you do. It isn’t switched on yet."**

### 3.7 Navigation behaviour
- `go(k)`: if `k` is a page of its own (`expenses` → `/ess/travel`): close bell/More, `window.open(url,'_blank','noopener,noreferrer')`, fallback `location.href` if blocked. Else clear admin module, close bell + More, set view, push URL `/ess/<k>` (`/ess` for home).
- `goSection(s)`: stays on current view if it belongs to the section, else the section's **first item** (so tapping Payroll lands on **Salary Slip** placeholder).
- Sub-tabs (`SubTabs`): segmented control shown only when the section has ≥2 items (Profile, Payroll, HR Services — but HRIS draws its own); phased items carry a "Soon" chip.
- Page header (`TabHeader`, every non-Home section except HRIS and Fun Zone, which draw their own): icon tile + h1 `label` + p `desc`; `soon` sections add chip "Coming soon". Home has no header.
- Breadcrumb (desktop top bar): Home → `["Home"]`; multi-item section → `[section.label, item.label]` (e.g. "Payroll › Salary Slip"); single → `[section.label]`; admin module → `["Manage", module label]`.
- URL/deep links (`lib/ess/routes.ts`, pure): `/ess` = home, `/ess/<view>`; legacy `/ess?tab=<view>` rewritten. Special: `/ess?tab=claims&ref=<id>` → `/ess/travel?tab=claims&ref=<id>`. Unknown → home. In RN map these to screens (notification `link`s use them).
- Layout padding: mobile `16px 14px`, desktop `24px 28px 40px`. Inbox is full-bleed.

### 3.8 Desktop layout (window width ≥ 1024)
- **Left rail**: Logo (26px) + "ESS" tag; grouped section buttons (icon + label + "Soon" tag for rnr + "↗" for the external T&E link which is an `<a target="_blank">`); menu error box; bottom "me" card: avatar 36 (photo or initials, bg `C.brandTint`, fg `C.brand`, border `C.brandEdge`), `full_name`, `emp_code · designation`, logout icon button (title/aria "Sign out").
- **Top bar** (sticky, 64px): breadcrumb, compact **FeatureSearch**, spacer, ("← My portal" only when an admin module is open — excluded), `headerExtra` (view-as button — excluded), **ThemeToggle** (3-segment), **NotificationBell**.
- Row 2 "Manage" (EXCLUDE): only if the person holds admin modules.

### 3.9 Mobile layout (width < 1024, `isMobile = innerWidth < 1024`, re-checked on resize)
- **Top bar** (56px): Logo 22px; spacer; ThemeToggle `compact` (single cycling button); NotificationBell; avatar 32 (non-interactive). No breadcrumb, no search in the bar.
- Home on mobile starts with a full-width FeatureSearch (placeholder "Search a feature (Leave, Payslip, Approvals…)").
- Content gets `paddingBottom: 76`.
- **Bottom tab bar** `MOBILE_PRIMARY = ['home','payroll','attendance','leave']` with labels from `short`: **Home, Payroll, Attend, Leave**, plus **More** (IconMore). Active = current section (and More not open); the More button is active when the sheet is open. Tapping a tab closes More and calls `goSection`.
- **More sheet** (bottom sheet, backdrop `rgba(15,23,42,0.45)`, top radius 20, max 80vh, scroll; tap backdrop closes):
  1. Grab handle.
  2. Header: avatar 40, `full_name` (14px/700), `emp_code · designation` (12px `C.muted`), **Sign out** button (outline, text `C.critical`, IconLogout).
  3. `headerExtra` (view-as button — EXCLUDE).
  4. Every visible section, grouped exactly like the rail (group label 10.5px/700 uppercase `C.faint`), 2-column tiles: icon + label + "Soon" tag; active tile highlighted. Tap → `goSection`.
  5. "Manage" + admin module groups (EXCLUDE).
  - The `AdminEntry` "🛠️ Admin" button (→ `/dashboard`) is defined but **not rendered** anywhere.

### 3.10 Feature search (`FeatureSearch`)
- Entries = for each visible non-`soon` section, each item without `needs` (so Salary Slip / Statutory excluded; RNR excluded): `{ label: item.label, crumb: section has >1 item ? "<Section> › <Item>" : "My portal", icon: section.k, keywords: "<section label lower> " + ESS_KEYWORDS[item.k] }`, run = `go(item.k)`. (Admin module/tab entries — EXCLUDE.)
- `ESS_KEYWORDS` (verbatim): home 'dashboard today landing'; profile 'my details personal info bank address'; documents 'letter request certificate'; letters 'my letters offer letter appointment'; team 'reportees manager my team'; orgchart 'org chart hierarchy reporting tree'; flexi 'flexi benefits tax'; declaration 'investment declaration 80c tax'; proofs 'investment proofs tax'; flexiclaims 'flexi claims bills reimbursement'; vpf 'voluntary pf provident fund'; nps 'corporate nps pension'; loans 'loan advance'; claims 'travel claims expense reimbursement'; attendance 'attendance punch regularise regularize'; leave 'leave apply holiday time off'; inbox 'messages notifications mail'; directory 'team directory people colleagues employees'; requests 'raise request helpdesk ticket'; approvals 'tasks approvals pending approve leave travel resignation offers interviews'; exit 'resign resignation exit separation'; company 'company headcount attrition'; reports 'reports export'; performance 'pms performance goals kra appraisal review'; social 'social wall fame appreciate'; funzone 'games fun zone'.
- Scoring (`scoreEntry`, q lower-cased trimmed): hay = `label + crumb + keywords`; all whitespace words must be in hay else 0; label===q 100; label startsWith q 80; any label word (split `[\s&/-]+`) startsWith first word 60; label includes q 45; any keyword startsWith first word 30; else 15. Sort score desc then label asc; top 8.
- UI: input placeholder compact "Search features…" / full "Search a feature (Leave, Payslip, Approvals…)"; "/" kbd hint or "×" clear. Result rows: icon tile, label with match highlighted (bg `C.brandTint`, `C.brandDeep`), crumb (12px `C.muted`), "Open ↵" on active. Empty: **“No feature matches “{q}”, or it isn’t part of your access.”** Footer hints "↑ ↓ to move", "↵ to open", "esc to close". Keyboard: "/" or Ctrl/⌘K focuses; arrows/Enter/Escape (web only).

### 3.11 Notification bell
- **Badge** (`refreshUnread`, on mount and after the panel loads): parallel
  - `GET /api/ess/notifications?employee_id=<id>` (headers: ESS bearer, else Supabase token)
  - `GET /api/ess/inbox?employee_id=<id>` (errors ignored)
  - total = `notifications.unread` + (`inbox.installed ? inbox.unread : 0`). If notifications call fails → badge unchanged. No polling.
  - Badge: shown when >0, `"9+"` above 9, bg `C.critical`, text `C.onAccent`, pill at top-right. Bell button 34×34, border `C.brand`/bg `C.brandTint` when open, else `C.line`/`C.surface`, icon `C.muted`.
  - **QUIRK**: while the Inbox screen is open, `InboxShell` calls `onUnread` which *replaces* the badge with the inbox message count only.
- **Panel** (fixed, top 70/right 22 desktop, top 60 full-width-16 mobile; width 380; max 70vh scroll; dismiss on outside press). Content `Notifications`:
  - Header "NOTIFICATIONS" (eyebrow) + outline button **"Mark all read"** → `POST /api/ess/notifications` `{ "action": "read_all" }` then reload.
  - Loading "Loading…"; empty **"You're all caught up. 🎉"** (12px `C.faint`).
  - Group **"For you to action"** (`role` list) then **"About you"** (`personal` list).
  - Row: unread → `C.brand` "● " prefix, full opacity, pointer; read → opacity .6. Left stripe 3px `C.critical` when `high`. Title 13px/600; body 12px `C.muted`; meta 10px `C.faint`: `"{label} · {created_at as en-IN medium date + short time}"`.
  - Tap unread row → `POST /api/ess/notifications` `{ "action": "read", "id": "<id>" }` then reload. **Rows do NOT navigate** (the `link` field is ignored by the web bell).
- `GET /api/ess/notifications` response:
```json
{ "personal": [Row], "role": [Row], "unread": <int>, "synced": <int> }
Row = { "id", "category": "<code>", "title", "body": "<string|null>", "link": "<string|null>", "is_read": <bool>, "created_at": "<iso>",
        "label": "<catalogue label or category>", "high": <bool>, "role_scoped": <bool> }
```
  Server first syncs derived notifications (insert missing by `link`, refresh changed summary titles), then returns latest 100 (`created_at desc`). POST errors: 400 `{"error":"action must be 'read' or 'read_all'"}`, 500 db message; success `{ "ok": true }`.
- `GET /api/ess/inbox` relevant fields: `{ "installed": <bool>, "unread": <int>, ... }` (`installed:false` when migration 080 absent).

### 3.12 Toast (`notify`)
`notify(msg, type='success'|'error')`: one toast at a time (replaces), auto-hides after **3000 ms**. Fixed bottom-right (bottom 88 mobile / 24 desktop, right 24), radius 12, bg `C.positive` (success) or `C.critical` (error), text `C.onAccent` 13px/600, IconCheck / IconAlert. Passed to child screens (Leave, Loans, VPF…). Home uses its own toast (§5.15).

### 3.13 Theme toggle (`lib/ui/ThemeToggle.tsx`)
- Choices `light | dark | system`; default **light**. Stored in `localStorage['ezer_theme']`; applied as resolved `data-ez-theme="light|dark"` on `<html>` (system → OS `prefers-color-scheme`).
- Desktop: 3-segment group (Sun "Light theme", Moon "Dark theme", half-disc "Follow my system"); active segment filled: light `#F59E0B` ink `#1F2937`, dark `#4F46E5` ink `#FFFFFF`, system `#0F766E` ink `#FFFFFF`.
- Mobile (`compact`): one 34px button filled with the current mode colour; tap cycles light → dark → system → light; title "Theme: {Current}. Switch to {Next}".
- On pick: apply + notify subscribers + if a live ESS token exists `PUT /api/ess/preferences` body `{ "theme": "light|dark|auto" }` (system ↔ `auto` via `toTodayTheme`). Best-effort, errors ignored.

### 3.14 Excluded admin surfaces (list only)
- "Manage" band (desktop row 2) / "Manage" section in More sheet: `ADMIN_NAV_GROUPS` from `lib/rms/nav.ts`, filtered to modules the employee holds (`menu.super_admin || menu.modules[module] ≥ VIEW`): **People** (Recruitment, Onboarding, Performance, Employees, Org Chart, Bulk Uploader, Transfer), **Time & Attendance** (Attendance & Leave, Attendance Reports, Leave & Holiday Config), **Money** (Payroll, Finance Department, Flexi Claims, Travel Claims, Travel & Expenses, Loans), **Compliance & Docs** (Compliance, HR Letters, Company Policies, Reports), **Setup** (ESS & Role Management, Admin Setup, Configuration, Flexi Policy, Company Profile, Database Export), **Help** (Ezer AI, Support). Rendered via `AdminModuleHost` at `/ess/<module>[-admin]/<tab>`; feature search also offers module tabs (`MODULE_TABS`, gated by `menu.screens`).
- `AdminEntry` (🛠️ Admin → `/dashboard`) — not rendered.
- View-as: PortalPage picker/banner; `adminMode` chip "Viewing {first_name}" and "Exit Admin" button.

---

## 4. Home — `GET /api/ess/today` and the Today payload

### 4.1 Fetch
- `GET /api/ess/today`, headers `authHeaders()` (bearer, Content-Type), `cache:'no-store'`. No query params.
- Fetched on mount and again silently every time the document becomes visible (`visibilitychange` → visible); a refetch error is ignored (only the first load shows an error).
- On the first successful load, `update(j.prefs)` is called (applies the saved theme/time/date formats **and PUTs them back** to `/api/ess/preferences` — harmless round-trip). **QUIRK**: for an employee with no `ess_user_preferences` row the payload defaults theme to `'auto'`, so the first Home load switches the app to "system" theme and saves it.
- Loading: one skeleton card (height 320, opacity .5). Error: card "Could not load Today: {error}" (e.g. "unauthenticated", "access ended", "Your session has expired. Sign in again.", or 503 "The Today tab is not installed yet (migration 111). Ask your administrator to run it.").

### 4.2 Route logic (`app/api/ess/today/route.ts`)
1. `getSessionEmployee` → 401 `{"error":"unauthenticated"}`; past `date_of_leaving` → 403 `{"error":"access ended"}`.
2. RPC `ess_today_payload(p_employee_id)` (service role). Missing function → 503 `{ "error": "The Today tab is not installed yet (migration 111). Ask your administrator to run it.", "installed": false }`; other error → 500 `{ "error": "<message>" }`.
3. Overrides (each best-effort, keeps RPC value on failure):
   - `leave` ← leave ledger (`lib/leave/ledger.ledgerFor`): `{ total: ledger.headlineTotal, accrued_this_month: 0, by_type: { <headline type name>: available ?? 0 } }` (same numbers as the Leave tab).
   - `today` ← `punchState(me)` (IST date, from `attendance_punches`): `{ punch_in: first_in, punch_out: open ? null : last_out, open, last_in, work_mode: null }`.
   - `week[].is_off` ← date ∈ RPC `resolve_weekly_offs(p_employee_id, p_from, p_to)` (`off_date`) ∪ `resolve_holidays(p_employee_id)` (`holiday_date`).
   - `pending` += approvals from `buildPending(ctx)` when `ctx.canApprovals`: `{ kind:'approval', id, type: a.kind.toLowerCase() (leave|leave_cancel|regularisation|travel|resignation), title: a.what, description: a.who, due_on: null, cta_label: a.mine ? (a.actions[0] ?? 'Review') : 'View', cta_route: a.link ?? '/dashboard/ess?tab=approvals' }`.
4. Response header `Cache-Control: no-store`.

### 4.3 Payload shape (`lib/today/types.ts → TodayPayload`, built by SQL in migration 154 + overrides)
```ts
{
  employee: { id, code, name, first_name /* first_name or first word of full_name */, initials /* first letters of words 1–2, upper */,
              designation|null, department|null, location|null /* location_name */, date_of_joining /* company_doj */, reports_to|null /* L1 manager full_name */ },
  shift: { start: 'HH:MM', end: 'HH:MM' },          // ess_shift_window(): constant 09:30–18:30 company-wide
  prefs: { theme: 'auto'|'light'|'dark', time_format: '12'|'24', date_format: 'long'|'short'|'dmy'|'mdy'|'iso' }, // default {auto,24,long}
  today: { punch_in, punch_out, work_mode: null, open?, last_in? } | null,
  week: Array<{ date, punch_in, punch_out, is_late, is_off, hours }>, // Mon..Sun of current week (DB current_date, UTC), from attendance_records
  week_hours: number,                               // sum(total_minutes)/60 for Mon..Sun, 1 decimal
  streak: number,                                   // ess_attendance_streak: consecutive most-recent present days (last 120) with late_minutes=0
  attendance_month: { present, working_days /* Mon–Fri from 1st to today */, late, pct /* round(present*100/working) */, prev_pct /* last month present/records */ },
  leave: { total, accrued_this_month: 0, by_type: Record<name, number> },
  payroll: { month: 'Mon YYYY', net, tds, pf, paid_on: null, on_time: false } | null,   // delivered but NOT displayed on Home
  pending: Array<{ kind: 'action'|'approval', id, type, title, description|null, due_on|null, cta_label, cta_route }>,
             // actions = ess_action_items where status='open', ordered due_on nulls last; approvals appended by route
  team: { members: Array<{ id, name, initials, status: 'in'|'wfh'|'leave'|'out' }>, in, wfh /* always 0 */, leave, out, total },
             // ess_team_presence: up to 40 colleagues sharing my L1 manager OR reporting to me; leave = approved leave covering today; in = attendance work_in today
  next_holiday: { date, name /* holiday_entries.description */, days_away, long_weekend /* holiday is Mon or Fri */ } | null, // non-optional holidays only
  celebrations: Array<{ id, name, initials, kind: 'birthday'|'anniversary', on: 'YYYY-MM-DD', years? }>,
             // next 30 days, excludes self, active employees, anniversaries ≥1 yr, sorted by date, LIMIT 6 (all companies — no company filter)
  recognition: { badge|null, from, message|null, tags: string[]|null, at } | null,   // latest Wall-of-Fame `recognitions` row for me
  recognitions: Array<{ id, source: 'wall'|'kudos', badge, from, from_id, message, tags, at }>, // in payload, NOT used by the web card
  new_joiners?: Array<{ id, name, initials, code, designation, department, photo, joined_on, code_issued_at, days_since_joining, already_congratulated }>,
             // ess_new_joiners_feed: group-wide, within announce_days (default 30) of code issue, excludes self
  announcements: {
    pinned: { id, title, body|null, cta_label|null, cta_route|null, published_at } | null,  // latest pinned, my company, not expired
    items: Array<{ id, title, body|null, published_at, unread }>                         // latest 5 non-pinned, my company, not expired
  }
}
```
If the employee is missing, the RPC returns `{ "error": "employee not found" }` with 200.

---

## 5. Home screen (components/ess/today)

Container `.ezt > .page`. Order: **HeroPanel (contains PunchDial)** → **StatTiles** → two columns (`1.35fr 1fr`): left = WeekStrip, PendingList, QuickActions, Journey; right = TeamToday, HolidayCard, Celebrations, NewJoiners, RecognitionCard, Announcements. At container width ≤900 everything is one column (left column cards first, then right). Cards fade/rise in with stagger (`--i` index) — decorative. Confetti canvas overlay + Toast at the end.

Navigation helper `nav(r)` used by all cards:
1. `r` starts with `http` → `window.open(r,'_blank','noopener')`.
2. `tabTarget(r)` (`lib/today/schema.ts`): `'tab:<k>'` → `k`; or `?tab=<k>`/`&tab=<k>` in the string → `k` lower-cased → `onOpenTab(k)` = portal `go(k)`.
3. Else if starts with `/` → Next `router.push(r)`.
4. Else nothing. **QUIRK**: Travel approvals carry `cta_route: 'claims'` (no prefix) → the "Open claim" button does nothing on Home.

`ROUTES` (`lib/today/schema.ts`): applyLeave `tab:leave`, payslip `tab:payslip`, regularise `tab:attendance`, ticket `tab:inbox`, team `tab:team`, form16 `tab:documents`, inbox `tab:inbox`, attendance `tab:attendance`, calendar `tab:company`, wall `tab:social`, appreciate `tab:social`, profile `tab:profile`.

Formatting helpers (`lib/today/format.ts`, pure): `fmtTime(h,m,tf)` → 24h `HH:MM`, 12h `h:MM AM|PM`; `fmtClock(date,tf)`; `fmtHHMM('HH:MM',tf)`; `fmtISO(iso,tf)` ('' for null); `fmtDate(d,df)`: long `toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})`, short `"{Wkd}, {d} {Mon} {yyyy}"`, dmy `DD/MM/YYYY`, mdy `MM/DD/YYYY`, iso `YYYY-MM-DD`; `fmtDateCompact(iso,df)` (long→short); `dayMonth`, `weekday`; `inr(n)` `₹` + en-IN grouping; `tenure(doj)` → `{years, months, totalMonths}` (month decremented if day-of-month not reached); `greeting(h)`: <12 "Good morning", <17 "Good afternoon", else "Good evening". All Home times use the **device clock** (`new Date()`), not IST.

### 5.1 HeroPanel
- Re-renders every 15 s (`useNow(15000)`). Tone class: evening (h≥17 or h<6), afternoon (12–17), morning (default) — background art only; a sun/moon orb moves along an arc 06:00→20:00 (decorative).
- **Clock**: big `HH:MM` (24h) or `h:MM` + small "AM/PM" (12h); below it `fmtDate(now, prefs.date_format)`.
- **Tools**: (Search pill only if `onSearch` is passed — it is not, so hidden) ; **Format picker** pill: clock icon + "`{24|12}h`".
  - Popover (closes on outside click / Escape): heading "Time" → two buttons "24-hour" (sub "18:30") / "12-hour" (sub "6:30 PM"); heading "Date" → buttons "Long" (example `d MMMM`, e.g. "19 October"), "Short" (`fmtDate(now,'short')`), "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD" each with today's example. Active option has class `on`.
  - Selecting calls `update({time_format})` / `update({date_format})` → state updates immediately and `PUT /api/ess/preferences` with the **full** merged prefs `{ "theme", "time_format", "date_format" }` (errors ignored).
- **Greeting row**: avatar circle with `employee.initials` and a status dot (class `live` when `today.punch_in && !today.punch_out`); h1 "`{greeting(h)}, {first_name}`"; sub line: designation (if any), chip `employee.code`, chip `employee.location` (if any).
- **Brief** (hidden on containers ≤520px): composed exactly:
  - `pend>0` ? "You have **{pend} thing|things** waiting on you" : "Nothing is waiting on you"
  - + if first upcoming birthday in `celebrations`: ", {its first name}'s birthday is coming up"
  - + ", and **{leave.total ?? 0} days** of leave in the bank."
  - + if `team.total>0`: " {team.in} of your team is|are in office today." (`is` when exactly 1)
- **Meta row**: "Shift" **`{fmtHHMM(start)} – {fmtHHMM(end)}`**; "This week" **`{floor(week_hours)}h {MM}m logged`** (minutes = round(fraction×60), 2-digit); if next_holiday: "Next holiday" **`{name}, {d MMM}`**.
- Child: PunchDial.

### 5.2 PunchDial (the punch UI on Home)
State derivation each render from `data.today` (no own copy):
- `isOpen = today.open ?? (punch_in && !punch_out)`; `inAt = isOpen && punch_in ? Date(punch_in)` (**first IN of the day**); `outAt = !isOpen && punch_out ? Date(punch_out)`.
- **Ring**: shift progress `p = clamp((nowHours − startHours)/(endHours − startHours), 0, 1)` (device time, shift 09:30–18:30); gradient stroke, 9 decorative ticks, a cap dot at the progress angle. Starts at 0 for 350 ms then animates.
- **Face** (aria-live):
  - Working (inAt): eyebrow "● Working", timer `HH:MM:SS` = now − inAt (ticks every 1 s), small "since {fmtClock(inAt)}".
  - Day done (outAt): eyebrow "Day done", big `"{h}h {MM}m"` = outAt − punch_in (or "-"), small "out at {fmtClock(outAt)}".
  - Neither: eyebrow "Not punched in", big current time `fmtClock(now)`, small `"shift {start}–{end}"` (raw HH:MM strings, not formatted).
- **Two buttons** (only the applicable one enabled; both disabled while busy):
  - **Punch in** — disabled when `inAt`. Sub-label: inAt "in since {time}" / outAt "start again" / else "start your day". Title: "Already punched in at {time}" / "Punch in again" / "Start your day".
  - **Punch out** — disabled when `!inAt`. Sub-label: inAt "end your day" / outAt "out at {time}" / else "punch in first". Title: "End your day" / "Punch in first".
- Line under buttons: inAt → "Punched in at **{time}** · {employee.location}" (location only if set); outAt → "Punched out at **{time}**"; else "Not punched in yet".
- Streak (if `streak > 0`): flame icon + "{streak}-day on-time streak" (warning-tint chip).
- **Action** `punch(kind)`:
  - Guards: `in` while inAt → toast "You are already punched in"; `out` while !inAt → toast "Punch in first".
  - `POST /api/ess/punch`, headers `authHeaders()`, body **`{ "kind": "in" | "out" }`** only (web sends **no lat/lng, no selfie, no photo, no device info**).
  - If response has `state` → `onState(state)` (Today rewrites `today` = `{punch_in: first_in, punch_out: open?null:last_out, open, last_in, work_mode}`).
  - `!ok` → toast `j.error || 'Punch failed'`.
  - Success `in`: pulse animation + confetti burst (90 particles from the button, colours `#2563EB #60A5FA #7DD3FC #34D399 #FCD34D #FFFFFF`, 1.3 s; skipped under reduced motion) + toast **"Punched in at {fmtClock(at)}"**; Today sets `today = { punch_in: existing ?? at, punch_out: null, open: true, last_in: at, work_mode: 'office' }`.
  - Success `out`: toast **"Punched out · {h}h {MM}m logged"** (at − inAt, i.e. from first IN of the day); Today sets `punch_out = at, open = false`.
  - Network/other exceptions → toast with the error message.
- WeekStrip re-fetches after any punch (key on punch_in/punch_out/liveIn).

### 5.3 `/api/ess/punch` (route + `lib/attendance/punch.ts`)
- **GET** → `{ "state": PunchState }` (`Cache-Control: no-store`). Not used by Home (Home takes state from `/api/ess/today`); used by the dead PunchButton.
- **POST** body `{ "kind": "in"|"out", "lat"?: number, "lng"?: number }`.
- `PunchState` = `{ date: 'YYYY-MM-DD' (IST), open: bool, first_in: iso|null, last_in: iso|null, last_out: iso|null, punches: [{ punch_time, punch_type: 'IN'|'OUT', source, geofence_status }] }` from `attendance_punches` where `punch_date = IST today`, ordered by `punch_time`.
- **Business rules**: punches alternate. IN refused while an IN is open; OUT refused when nothing is open; IN after OUT allowed (multiple stretches per day; record spans first IN → last OUT). "Today" = IST date (`now + 5h30`).
- Geo-fencing: **recorded, never enforced**. Server passes the employee's `location_id` as `p_branch_id` to `ess_punch(p_employee_id, p_punch_type 'IN'|'OUT', p_latitude, p_longitude, p_branch_id)`; the RPC computes distance to `locations.latitude/longitude` vs `geofence_radius_m` and stores `geofence_status` `INSIDE|OUTSIDE|UNKNOWN` (UNKNOWN when lat/lng absent — always the case from web), `source = 'ESS_APP'`, then runs `process_daily_attendance`. No selfie, no device binding.
- Responses:
  - 200 `{ "ok": true, "at": "<punch_time iso>", "result": { "punch_id", "punch_time", "punch_type", "geofence", "processed": true }, "state": PunchState }`
  - 400 `{ "error": "kind must be in|out" }`
  - 409 `{ "error": "You are already punched in (since {h:mm am/pm IST}). Punch out first.", "state": … }`
  - 409 `{ "error": "You already punched out at {h:mm am/pm IST}. Punch in first.", "state": … }` or `{ "error": "Punch in first.", "state": … }`
  - 400 `{ "error": "<RPC error message>" }` (no state)
  - 403 view-as: "Your ESS session is not active, so there is nobody to punch for. Sign in again with your own ESS account." / "A punch lands on your own day, so it cannot be made while you are viewing somebody else's portal. Open your own portal to punch."
  - 401 `{ "error": "unauthenticated" }` (no employee row), 403 `{ "error": "access ended" }`, plus the generic auth errors (§1.4).
  - Time strings in errors use `en-IN`, `hour12: true`, `Asia/Kolkata` (e.g. "09:42 am").

### 5.4 StatTiles (3 tiles; 3 columns at container >900px, 2 columns ≤900)
Numbers count up from 0 (eased, 1.1 s after 450 ms; instant with reduced motion). Hover tilt is decorative. Tile accent hues: 1 `C.brand`, 2 `C.positive`, 3 `C.warning`.
1. **Leave balance** — ring fill `min(1, total/24)`, ring label `total`; label "Leave balance"; value `total` (1 decimal) + "days"; sub: `by_type` as `"{name} {value} · {name} {value}"`; plus "+{accrued_this_month}" up-badge when non-zero (always 0 now).
2. **Attendance, {current month long name}** — ring fill `pct/100` (class `pos`), ring label `"{pct}%"` or "-"; value `present` + "of {working_days} days"; sub: `late` ? "{late} late mark(s)" : "No late marks"; delta badge `round(pct − prev_pct)` shown when non-zero: `+N%` class up (positive) / `N%` class warn.
3. **Pending actions** — value `pending.length`; sub: dueThisMonth (items with `due_on` in the current calendar month) >0 → warn badge "{n} due this month"; else `pending.length===0` → "All clear"; else "No deadlines". Decorative sparkline.
(Net salary tile was removed; `payroll` is not shown anywhere on Home.)

### 5.5 WeekStrip — "This week"
- Header "This week" + link button **"Attendance"** → `tab:attendance`.
- Data: `api('/api/ess/attendance?from=<Mon>&to=<Sun>', employee.id)` → `GET /api/ess/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD&employee_id=<id>`; Monday–Sunday of the **device-local** current week. Uses `days: AttendanceDay[]` (`date, kind, work_in, work_out, total_minutes, late_minutes, note, leave: {name,…}|null, …`). Until it answers (or if it fails), cells come from `payload.week` (kind `WEEKLY_OFF` when `is_off`, else null).
- 7 cells: weekday short (en-IN), day-of-month, line1, line2, hours bar.
- Line text by `kind` (`t()` = `fmtISO` in the user's time format; `span(a,b)` = `"{in}–{out}"` only in 24h when out exists, else just in):
  - WEEKLY_OFF: "Weekly off" · HOLIDAY: "Holiday" / note · LEAVE: "On leave" / leave name or note · HALF_LEAVE: in ? (in, "Half-day leave") : ("Half-day leave", note) · ABSENT: "Absent" · MISS_OUT: in / "Missed out" · MISS_IN: out / "Missed in" · HALF_DAY: span / "Half day" · LATE: span / "Late" · PRESENT: span / "Present" · IN_PROGRESS: (live IN time or in) / "In progress" · UPCOMING: today ? "Not in yet" : "Upcoming" · fallback (no kind): in ? (in, out or (today ? "In progress" : "")) : (future ? "Upcoming" : today ? "Not in yet" : "").
- Cell title (tooltip) = `"{l1} · {l2}"`.
- Colour by kind (cell accent `--d`): PRESENT/IN_PROGRESS `C.positive`; LATE/HALF_DAY `C.warning`; MISS_IN/MISS_OUT/ABSENT `C.critical` (absent text coloured); LEAVE/HALF_LEAVE `C.brand`; HOLIDAY `C.info`; WEEKLY_OFF bg `C.sunken`, opacity .55; UPCOMING bg `C.surface`, faint date. **Today** overrides: bg `C.brandTint`, border `C.brandEdge`, date `C.brand`, bar `C.brand`.
- Hours bar width = `min(100, hours/9 × 100)%` where hours = live elapsed since `liveIn` for today when punched in, else `total_minutes/60`; 0 on HOLIDAY/WEEKLY_OFF/LEAVE/ABSENT.

### 5.6 PendingList — "Pending on you"
- Header "Pending on you" + count badge (when >0) + link **"Inbox"** → `tab:inbox`.
- Empty: "Nothing waiting on you right now." (`C.faint`).
- Each row: icon tile by type — `investment_declaration`/`investment_proof`: Doc on `C.warningTint`/`C.warning`; `policy_ack`: Shield `C.infoTint`/`C.info`; any `kind==='approval'`: Inbox `C.brandTint`/`C.brand`; unknown types fall back to policy_ack style. Title, description (if any). Due chip: `due_on` → "Due {fmtDateCompact(due_on, format; long→short) with leading 'Wkd, ' removed}", class **soon** (≤21 days away incl. overdue: `C.warningTint`/`C.warning`) or **ok** (`C.infoTint`/`C.info`); no due → "No deadline" (ok). CTA button `cta_label` → `nav(cta_route)`.
- **QUIRK**: at container ≤520px the CTA button is hidden (`.todo .go {display:none}`), so on phones rows are not actionable.
- Approval rows typically route to `go('approvals')` (via `?tab=approvals`).

### 5.7 QuickActions — "Quick actions" (grid of 6; 3 columns ≤900)
| Label | Icon | Target | Colours (bg / fg) |
|---|---|---|---|
| Apply leave | Calendar | tab:leave | default (brand) |
| Payslip | Download | tab:payslip (→ "Salary Slip is coming soon" placeholder) | `C.positiveTint` / `C.positive` |
| Regularise | Clock | tab:attendance | `C.warningTint` / `C.warning` |
| Raise ticket | Menu | tab:inbox | `C.infoTint` / `C.info` |
| My team | Users | tab:team | default |
| Form 16 | Layers | tab:documents (Letter Requests) | gold-soft / gold |

### 5.8 Journey — "My journey at the company"
- `t = tenure(date_of_joining)`, `yrs = totalMonths/12`. Track with 4 milestones at 12.5/37.5/62.5/87.5% for 0/1/3/5 years; fill + "you" marker at piecewise-linear position (capped at 87.5%). Milestone `done` when `yrs ≥ stop`; 5-yr milestone gold.
- Marker label: years>0 ? "You, {y} yr(s)[ {m} mo]" : "You, {m} mo".
- Grid: **Joined** `fmtDateCompact(doj)`; **1 year / 3 years / 5 years**: reached → anniversary date "MMM YYYY" (en-IN), else "Reached" (0 months left) / "{m} months to go" (<12) / "{y} yr {m} mo to go".
- Facts: "Designation" `designation ?? '-'`, "Reports to" `reports_to ?? '-'`, "Department" `department ?? '-'`.

### 5.9 TeamToday — "Team today" (hidden when `team.total === 0`)
- Header + link **"Team"** → `tab:team`.
- Avatar stack: first 5 members (initials; tints cycle default/positive/info/gold/warning), status dot: in `C.positive`, wfh `C.info`, leave `C.warning`, out `C.lineStrong`; "+{total−5}" chip if more. Tooltip "{name} · {status}".
- Text: "**{in} of {total}** in office".
- Legend: "{in} in office", "{wfh} working from home", "{leave} on leave", and "{out} not in yet" only when out>0.

### 5.10 HolidayCard (hidden when `next_holiday` null)
Date block (2-digit day + short month), name, "{weekday long}, today|tomorrow|in {n} days" + " · long weekend" when flagged; button **"Calendar"** → `tab:company`. **QUIRK**: Company is gated; for most employees this shows the Company page with the 403 note "You do not hold a role that opens this." (Holidays actually live on the Leave tab.)

### 5.11 Celebrations — "Birthdays & anniversaries"
- Empty: "No birthdays or anniversaries in the next 30 days."
- Row: avatar (initials; tints cycle brand/gold/positive/info; birthday shows cake badge, anniversary star badge), name, line: birthday → "Birthday {when}"; anniversary → "{years} year(s) {when}". `when`: diff days 0 "today", 1 "tomorrow", <7 "on {Weekday}, {d MMM}", else "on {d MMM}".
- Button **"Wish"** → `POST /api/ess/celebrations` body `{ "to_employee_id": "<id>", "kind": "BIRTHDAY" | "ANNIVERSARY" }` (no message). Success → button "Sent" disabled (local only; resets on reload) + toast **"Your wish is on their wall"**; failure → toast **"Could not send the wish"**.

### 5.12 NewJoiners — "New joiners" (hidden when empty)
- Source: `payload.new_joiners`; if the key is absent, fallback **DIRECT SUPABASE (anon)**: `supabase.rpc('ess_new_joiners_feed', { p_employee_id: employee.id })` (errors → card hidden).
- Row: initials avatar (tints positive/brand/info/gold), name, line `"{designation} · {department}"` (non-empty parts) else `joined_on` ? "Joined {d MMM}" : "Recently joined". (`photo` is not displayed.)
- Button **"Welcome"** / **"Welcomed"** (disabled when `already_congratulated` or sent this session) → `POST /api/ess/celebrations` `{ "to_employee_id": "<id>", "kind": "JOINING" }`. Success toast **"You welcomed {first name}"**; failure **"Could not send that"**.

### 5.13 `/api/ess/celebrations`
- **POST** body `{ to_employee_id: string, kind?: 'BIRTHDAY'|'ANNIVERSARY'|'KUDOS'|'JOINING' (default BIRTHDAY, case-insensitive), message?: string (trimmed, max 500) }`.
  - 400 `{ "error": "to_employee_id is required" }`, `{ "error": "kind must be one of BIRTHDAY, ANNIVERSARY, KUDOS, JOINING" }`, `{ "error": "You cannot send yourself a wish" }`; 404 `{ "error": "No such active employee" }`; 500 db message.
  - Duplicate (same sender→recipient since UTC midnight; JOINING: ever) → 200 `{ "ok": true, "duplicate": true, "message": "Already wished today" | "Already congratulated" }` (web treats as success).
  - Success 200 `{ "ok": true, "notified": <bool>, "to": "<recipient full_name>", "deliverable": <bool>, "warning": "<name> has no active ESS login yet, so this is saved but cannot be opened." | undefined }` (web ignores `warning`). Inserts `ess_kudos {from_employee_id, to_employee_id, message|null, badge: kind, points: 0}` and notifies recipient (`WISH_RECEIVED`/`KUDOS_RECEIVED`, titles "🎂 {sender} wished you a happy birthday", "🌟 {sender} congratulated you on your work anniversary", "🎉 {sender} congratulated you on joining", "👏 {sender} sent you kudos").
- **GET** (not used by Home; used by Social): `{ birthdays: Celebrant[], anniversaries: Celebrant[], new_joiners: [...], mine: { birthday: bool, anniversary: bool } }`, `Celebrant = { id, emp_code, full_name, designation, dept_name, years?, already_wished }` — today only (UTC month/day), same company.

### 5.14 RecognitionCard — "Recognition"
- Header link **"Wall of Fame"** → `tab:social`.
- If `recognition`: gold star badge; "**{badge ?? 'Appreciation'}** · from {from}, {today|yesterday|N days ago}"; message; tag chips.
- Else: "No kudos yet. Appreciation from colleagues will appear here." (Note: uses only the single Wall row, not `recognitions`/kudos.)
- Button **"Appreciate a colleague"** → `tab:social`.

### 5.15 Announcements — "Announcements"
- Empty (no pinned, no items): "No announcements right now."
- Pinned block: eyebrow "Pinned", title, body, CTA button `cta_label` → `nav(cta_route)` when both present.
- List (≤5): unread dot (`C.brand`, pulses) when `unread` and not tapped this session; title, body; right "when": same day "Today", 1 "Yesterday", <7 short weekday, else "d MMM".
- Tap item → optimistic read + `POST /api/ess/announcements` body `{ "id": "<announcement id>" }` (upserts `announcement_reads`), response `{ "ok": true }`; 401 `{"error":"unauthenticated"}`. Errors ignored. Pinned items cannot be marked read from Home.
- (`GET /api/ess/announcements?limit=n` exists — `{ announcements: [{id,title,body,pinned,cta_label,cta_route,published_at,unread}], unread, diagnostics:{noCompany,noAnnouncements} }`, default 20, max 50 — not used by Home; useful for RN.)

### 5.16 Home toast
`useToast().show(msg)` — single message, 2600 ms, bottom toast with a green check (`C.positive` circle) for **all** messages, including errors.

### 5.17 Preferences route `/api/ess/preferences`
- GET → `{ theme, time_format, date_format }` or default `{ "theme": "light", "time_format": "24", "date_format": "long" }`.
- PUT body any subset `{ theme?: 'auto'|'light'|'dark', time_format?: '12'|'24', date_format?: 'long'|'short'|'dmy'|'mdy'|'iso' }`; merges with stored row; invalid values fall back to stored/default. Response `{ "ok": true, "employee_id", "theme", "time_format", "date_format", "updated_at" }`; 500 db message; 401 unauthenticated.
- Today's prefs hook (`usePrefs`): starts `{light, 24, long}`; applies theme only after real prefs arrive; follows the top-bar toggle (and PUTs the merged prefs when the theme changes there).

---

## 6. Direct Supabase calls (anon key) in this scope — verbatim
1. `employees.select(EMP_FIELDS).eq('id', employeeId).maybeSingle()` (§3.2)
2. `employees.select('id, full_name').in('id', [l1_manager_id, hr_manager_id])`
3. `ess_accounts.select('status, password_reset_allowed').eq('employee_id', employeeId).maybeSingle()`
4. `employees.select('profile_photo').eq('id', employeeId).maybeSingle()`
5. `supabase.rpc('ess_new_joiners_feed', { p_employee_id })` — NewJoiners fallback only
6. View-as only (excluded): the five `loadAccessScope` queries (§3.1)
7. `supabase.auth.getSession()` — legacy admin header fallback only (excluded)

Everything else goes through `/api/*` with the bearer token. RN can replace 1–4 with direct anon queries exactly as above (RLS is permissive), or ask backend for an endpoint (recommended, since the anon key reads any employee row).

---

## 7. Pure TS modules an RN app can import directly
| Module | Exports used | Imports |
|---|---|---|
| `lib/today/types.ts` | `TodayPayload`, `Prefs`, `Theme`, `TimeFormat`, `DateFormat` | none |
| `lib/today/format.ts` | `fmtTime, fmtClock, fmtHHMM, fmtISO, fmtDate, fmtDateCompact, dayMonth, weekday, inr, tenure, greeting, two` | type-only `./types` (relies on `Intl` en-IN locale — ensure Hermes Intl support) |
| `lib/today/schema.ts` | `ROUTES`, `tabTarget`, `TODAY_RPC`, `TODAY_TABLES` | none |
| `lib/ui/theme-resolve.ts` | `readChoice, resolveTheme, toTodayTheme, fromTodayTheme, onThemeChange, notifyThemeChange, STORAGE_KEY, DEFAULT_CHOICE` | none |
| `lib/ess/routes.ts` | `parseEssPath, essPath, essHref, sameLocation, moduleTabFromPath` (skip `pushUrl`/`atEss`, which touch `window`) | none |
| `lib/rms/modules.ts` | `atLeast` | none |
| `lib/ess/asked.ts` | server-side, pure but not needed client-side | none |

Copy (not exported / browser-bound): `SECTIONS`, `NAV_GROUPS`, `MOBILE_PRIMARY`, `ESS_KEYWORDS`, `scoreEntry` (in `EmployeePortal.tsx`); `essToken` expiry logic from `lib/ess-session-client.ts` (uses `localStorage` + `atob`; port to SecureStore + a base64url decoder). Server-only (do not import): `lib/ess-session.ts`, `lib/ess-auth.ts` (node `crypto`), `lib/attendance/punch.ts`, `lib/ess/session.ts`, `lib/session.ts`.

---

## 8. Implementation notes for React Native
- **Storage**: replace `localStorage['ezer_ess_session']` with SecureStore (same JSON shape). Theme choice `ezer_theme` → AsyncStorage. Implement client expiry check (exp − 30 s) and route to Login when expired; the web does not, which causes the 401 loop noted in §2.1. No refresh token exists — re-login every 12 h.
- **Auth header**: send `Authorization: Bearer <token>` on every `/api/*` call; the base URL is the deployed web app (`NEXT_PUBLIC_APP_URL`). `employee_id` query param is optional (own id).
- **After set-password**, call login to obtain a token (web bug, §2.3).
- **Navigation**: web uses `window.location.replace` (login↔portal), `history.pushState/popstate` URL sync (`/ess/<view>`), `window.open` for Travel & Expenses (`/ess/travel`) and `http` links from Home, `router.push` for path CTAs. In RN use a stack + bottom tabs (Home, Payroll, Attend, Leave, More) and map `tab:<k>` / `?tab=<k>` / `/ess/<k>` strings to screens with `tabTarget` + `parseEssPath`. Notification `link` values (e.g. `/ess`, `/ess?tab=approvals`) can be deep-linked the same way (web bell ignores them).
- **Lifecycle**: Today refetches on `document.visibilitychange` → use `AppState` 'active'. Hero clock ticks every 15 s, punch timer every 1 s.
- **Location**: web never calls `navigator.geolocation`; the API accepts optional `lat`/`lng` numbers and only records geofence status. Sending device location from RN is an addition (would populate INSIDE/OUTSIDE) — product decision; no enforcement exists server-side. No camera/selfie in punch.
- **Animations / canvas**: confetti uses `<canvas>` + `requestAnimationFrame` + `getBoundingClientRect`; count-up and ring fills use rAF/CSS; tilt-on-hover and `matchMedia('(hover:hover)')`, `prefers-reduced-motion` (use `AccessibilityInfo.isReduceMotionEnabled`). All decorative.
- **Theme**: CSS custom properties on `<html data-ez-theme>`, `startViewTransition` cross-fade, `prefers-color-scheme` → RN `Appearance`; token values live in `lib/ui/theme.css`.
- **Layout**: web breakpoint `innerWidth < 1024` = mobile shell; Today uses container queries at 900 px and 520 px (≤520: hero brief hidden, smaller dial 150 px, Pending CTA hidden). RN phone = the ≤520 layout (consider keeping the Pending CTA visible).
- **Keyboard shortcuts** ("/", Ctrl/⌘K, arrows) in feature search are web-only.
- **Time zones**: Home displays device-local time; server punch logic uses IST; the SQL payload's week/month uses DB `current_date` (UTC). Keep device TZ = IST assumptions in mind.
- **Not used in this scope**: html2canvas, file downloads, FormData uploads (profile photo editing via canvas resize is in the Profile spec).
