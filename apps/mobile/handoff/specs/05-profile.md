# 05 — Profile section (ESS): My Details, Letter Requests, My Letters, ID card, Reporting line

Source of truth: repo `/Users/girish/Documents/ezer-hrms`, branch `feat/mobile-app`, read on 2026-10-19.
Everything below is quoted or paraphrased from source. File:line references are given so the RN engineer can re-check.

---

## 0. Where this section lives

`components/ess/EmployeePortal.tsx` — `SECTIONS` (~line 3158):

```ts
{ k:'profile', label:'Profile', short:'Profile', icon:'', status:'ready',
  desc:'Your personal details, documents and letters',
  items:[
    { k:'profile',     label:'My Details' },
    { k:'documents',   label:'Letter Requests' },
    { k:'letters',     label:'My Letters' },
  ]},
```

- Section header (`TabHeader`): icon `IconUser`, `<h1>Profile</h1>`, `<p>Your personal details, documents and letters</p>`.
- Sub-tab control (`SubTabs`): a segmented control with three buttons, "My Details" / "Letter Requests" / "My Letters". The selected one has `data-on="1"` and scrolls sideways on a phone.
- Render switch (~line 4001):
  - `case 'profile': return <Profile360 code={emp.emp_code} employeeId={emp.id} />`
  - `case 'documents': return <Documents emp={emp} notify={notify} />`
  - `case 'letters': return <MyLetters emp={emp} />`
- `Profile360` is lazy-loaded with `dynamic(() => import('@/components/profile/Profile360'), { ssr:false, loading: SectionLoading })`.

**Dead code.** EmployeePortal.tsx also holds a function `Profile` (line 848), with `ProfileHero`, `Field`, `Panel`, `MyReportingLine`, `EmployeeProfileSections`, `ESS_RECORD_TABS` and `RecordQuickStats`. The comment at lines 818–847 says it is **NOT WIRED** and cannot be reached. Section 7 describes it so nothing is missed, but **parity target = Profile360**. `components/profile/ProfileShell.tsx` is also not imported anywhere. `/api/ess/profile/[code]` and `/api/ess/profile/request` are not called by the live UI (ProfileShell calls `/request`).

---

## 1. Auth and transport (applies to every call below)

- ESS login → signed token. On the web it is stored in `localStorage['ezer_ess_session']` as JSON `{ token }`. `lib/ess-session-client.ts#essToken()` decodes the first `.`-segment (base64url JSON) and rejects it if `exp` (epoch **ms**) is under `now + 30s`.
- `lib/auth-headers.ts#authHeaders()` → `{ 'Content-Type':'application/json', Authorization:'Bearer <token>' }`. For a Supabase dashboard session it falls back to the Supabase access_token.
- `uploadAuthHeaders()` → the same headers **without** `Content-Type`. Use it for multipart bodies, so the boundary is set by the runtime.
- Server side, every `/api/ess/*` route runs `essRoute(req)` → `essCaller` (`lib/ess/session.ts`). The caller's employee comes from the token. `?employee_id=` (or `employee_id` in a non-GET JSON body) only matters for "view as". If it equals your own id, or is absent, `viewAs:false`.
- `lib/profile/client.ts` appends `employee_id=<portalOwner>` to every profile call. Profile360 calls `setProfileOwner(employeeId)`. With an ESS token this has no effect. **RN can omit it.**
- Generic auth failures (`lib/api-auth.ts`), all with HTTP status 401 and body `{ error }`:
  - `'Sign in first. This endpoint needs a dashboard session.'`
  - `'Your session has expired. Sign in again.'`
- Other `essCaller` refusals:
  - 403 `'You can only open your own portal.'`
  - 400 `'employee_id is required for the dashboard login.'`
- `essContext` failures give 500 `{ error: 'ess_menu: <msg>. Has migration 071 been run?' }`.

Supabase browser client: `lib/supabase.ts` is `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)`, the **anon key** with no user JWT. Tables queried directly from the browser rely on `allow_all` RLS policies (anon + authenticated).

---

## 2. My Details → `components/profile/Profile360.tsx` (768 lines)

### 2.1 Data load

`loadProfile(code)` → **`GET /api/ess/profile?code=<emp_code>&employee_id=<id>`**. Headers come from `authHeaders()`. The UI passes its own `emp_code`, so the result is the caller's own profile. RN can call `GET /api/ess/profile` with no query.

Client wrapper (`lib/profile/client.ts#call`):
- Non-2xx → `{ data:null, error:{ message: body.error ?? 'Request failed (<status>).', status } }`
- Network throw → `'Could not reach the server.'`

Screen states:
- Error: `<div class="note bad">{message}</div>` inside a card. Colour `critical` on `criticalTint`.
- Loading (payload null): card with `<div class="empty">Loading…</div>`.
- The payload is refetched **only** on mount and after a successful edit or request (`load()`).

#### Route `app/api/ess/profile/route.ts` GET

1. `essRoute`. `me = ctx.caller.employeeId`.
2. If `code` is given: `sb.from('employees').select('id').eq('emp_code', code).maybeSingle()`. If nothing matches → **404 `{error:'No employee with that code.'}`**.
3. `sb.rpc('get_employee_profile', { p_employee_id: subject, p_viewer_id: me })` (service role).
   - PGRST202/PGRST205 → **503** `'The profile module is not installed yet (migration 091).'`
   - 42703 on `ur.employee_id` → **503** `'The profile service needs migration 099. Ask your administrator to run it.'`
   - Any other DB error → 500 `{error: message}`.
4. Errors the RPC reports inside its payload:
   - `employee_not_found` → 404 `'No such employee.'`
   - `viewer_not_found` → 403 `'Your record could not be found.'`
   - `viewer_inactive` → 403 `'Your record is marked as having left.'`
5. Side blocks (`sideBlocks(subject)`), all service role:
   - `pms_overall_rating.select('final_rating, final_rating_code, final_score, finalised_at, employee_ack, period_id').eq('employee_id',id).order('finalised_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle()`
   - `salary_structures.select('gross_monthly, gross_annual, basic_monthly, hra_monthly, conveyance, employee_pf, employer_pf, gratuity_monthly, effective_date, fy').eq('employee_id',id).order('effective_date',{ascending:false}).limit(1).maybeSingle()`
   - `recognitions.select('id, message, kind, cycle_label, created_at, badge_ref, giver_employee_id').eq('is_archived', false).order('created_at',{ascending:false}).limit(6)`. **NB: not filtered by employee.** It returns the 6 newest recognitions company-wide. This is a bug in the web app; decide whether to copy it.
   - Count queries: `pms_employee_goals` and `pms_one_to_one`, each `select('id',{count:'exact',head:true}).eq('employee_id',id)`.
   - If there is a rating with `period_id`: `pms_periods.select('period_name, status, period_start, period_end').eq('id', period_id).maybeSingle()`.
6. Photo: `employees.select('photo_path').eq('id',subject)`. If a path exists → `storage.from('employee-photos').createSignedUrl(path, 28800)` (8 h). The bucket is **private**.
7. `isSelf = subject === me`.
8. Response: `{ ...rpcPayload, performance, salary, recognition, photoUrl, isSelf }`.

#### Response shape (`lib/profile/types.ts#ProfilePayload`)

```ts
{
  employee: Employee            // to_jsonb(v_employee_profile_360 row) MINUS stripped keys (see 2.2)
  viewer_role: 'self'|'manager'|'hr'|'peer'
  completeness: { score: number /*0-100 int*/, pending: string[] }
  family: Row[]; nominations: Row[]; insurance: Row[]; documents: Row[]; assets: Row[]
  education: Row[]; experience: Row[]; certifications: Row[]; trainings: Row[]; app_access: Row[]
  performance: null | { final_rating, final_rating_code, final_score, finalised_at, employee_ack, period_id,
                        period: null | { period_name, status, period_start, period_end },
                        kra_count: number, one_to_one_count: number }
  salary: null | { gross_monthly, gross_annual, basic_monthly, hra_monthly, conveyance,
                   employee_pf, employer_pf, gratuity_monthly, effective_date, fy }
  recognition: { id, message, kind, cycle_label, created_at, badge_ref, giver_employee_id }[]
  photoUrl: string | null       // 8-hour signed URL
  isSelf: boolean
}
```

The lists are always arrays (`coalesce(..., '[]')`). Each is the full table row via `to_jsonb`, so it includes ids, company_id and audit columns. Source tables and ordering (migration 099):

| key | table / filter / order |
|---|---|
| family | `employee_family_members` where employee_id, order created_at |
| nominations | `employee_nominations`, order scheme |
| insurance | `employee_insurance` where `is_active` |
| documents | `employee_documents`, order created_at desc |
| assets | `employee_assets`, order issued_on desc |
| education | `employee_education`, order to_year desc |
| experience | `employee_experience`, order from_date desc |
| certifications | `employee_certifications`, order issued_on desc |
| trainings | `employee_trainings`, order due_date |
| app_access | `employee_app_access` where `revoked_on is null` |

`employee` keys come from the view `v_employee_profile_360` (migration 091 §8):

- Identity and job: `id, company_id, employee_code, full_name, display_name, photo_path, designation, sub_department, grade, job_level, employment_type, employee_category, cost_centre, business_unit, workstation, status, date_of_joining, confirmation_date, probation_months, notice_period_days, date_of_leaving, weekly_off, attendance_mode`
- Personal: `date_of_birth, gender, blood_group, marital_status, marriage_date, nationality, place_of_birth, domicile_state, father_name, mother_name, spouse_name, languages, is_disabled, is_international_worker`
- Contact: `official_email, personal_email, mobile, alt_mobile, extension, whatsapp_optin, present_address, permanent_address, emergency_contact_1, emergency_contact_2`
- Statutory: `pan, aadhar_last4, uan, pf_number, pf_applicable, vpf_amount, eps_status, esic_ip_number, esic_dispensary, pt_state, lwf_state, passport_no, driving_licence, voter_id`
- Bank: `bank_name, bank_last4, ifsc, bank_holder_name, payment_mode`
- Reporting ids: `reports_to_l1, reports_to_l2, hod_id, dotted_line_manager_id, md_id`
- Org names: `company_name, department_name, location_name, branch_code`
- Chain: `rm_l1_name, rm_l1_code, rm_l2_name, rm_l2_code, hod_name, hod_code, md_name, md_code`
- Pay: `annual_ctc, gross_monthly`
- Derived: `reportee_count, tenure_years, tenure_months, age_years`

`present_address` = `concat_ws(', ', res_address1, res_address2)`. `permanent_address` is built the same way from `perm_address1/2`.

### 2.2 Masking: what is removed for whom (server; `get_employee_profile`, migration 099)

The viewer role is **positional**:

1. **hr**: the viewer holds an active ESS role (`ess_accounts → ess_user_roles(is_active) → ess_roles`) with `role_code IN (HR_MANAGER, HR_HEAD, HR_EXECUTIVE, BRANCH_HR, CHRO, PAYROLL, PAYROLL_ADMIN, ADMIN_COMPANY, ADMIN_SUPER, ALL_ACCESS)`. This wins even on your own record.
2. **manager**: viewer = subject's `reports_to_l1`, `reports_to_l2`, `hod_id` or `md_id`.
3. **self**: viewer = subject.
4. **peer**: anyone else.

Keys are **removed from the JSON** (not blanked):

- role ≠ hr: `pan, passport_no, bank_holder_name`
- role ∉ {hr, self}: `aadhar_last4, bank_last4, ifsc, bank_name, personal_email, mobile, alt_mobile, present_address, permanent_address, emergency_contact_1, emergency_contact_2, date_of_birth, father_name, mother_name, spouse_name, uan, pf_number, esic_ip_number, driving_licence, voter_id`
- role = peer: `annual_ctc, gross_monthly`

So an ordinary employee viewing themselves (`self`) does **not** receive `pan`, `passport_no` or `bank_holder_name`. Those fields show **"Restricted"**. An HR-role employee viewing themselves gets `viewer_role:'hr'` and sees everything.

**Client rule (`maySee`, `lib/profile/types.ts`)**: ranks are `peer 0, self 1, manager 2, hr 3`.
- `min` absent → visible.
- `min === 'self'` → visible only if viewer is `self` or `hr`.
- Otherwise visible if `rank(viewer) >= rank(min)`.

A field renders "Restricted" when `!maySee(...)` OR the key is missing from `employee`. When the key is present but the value is null or empty, it renders `-`.

`side blocks` (salary, performance) are **not** masked by the route.

### 2.3 Value formatting helpers (Profile360 top)

- `val(v)`: null, undefined or '' → `'-'`. Boolean → `'Yes'`/`'No'`. Otherwise `String(v)`.
- `pretty(v)`: if it matches `^\d{4}-\d{2}-\d{2}` → `toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})` (e.g. `05 Sep 2026`). Otherwise `val`.
- `money(v)`: if finite → `'₹' + n.toLocaleString('en-IN')`, otherwise `val`.
- `titleise(k)`: `_` becomes a space, each word is capitalised, and the first standalone `No` becomes `No.` (e.g. `policy_no` → `Policy No.`).
- `ini(n)`: first letters of the first two words, upper-cased; `'?'` fallback.

### 2.4 Layout, top to bottom

Wrapper `.ezp`.

0. **Flash** (when set): `note good` (positive on positiveTint), `role="status"`. It clears after 4500 ms.
1. **Cover** (gradient brandTint → surface) with three buttons at the top right:
   - `Records` → tab `records`
   - `Digital ID` → tab `statutory` (it does not scroll to the ID card)
   - `Print` → `window.print()`
2. **Identity card** (`.idcard`):
   - **Face**: `<img src={photo}>` if `photo` (initially `payload.photoUrl`), otherwise `ini(full_name)`. If `self`, a camera button sits over it, with aria-label `'Change your profile photo'` or `'Add a profile photo'` and title `'Change photo'`/`'Add photo'`. It opens PhotoUploader (§2.9).
   - `h2` = `full_name`.
   - Role line: `designation` + (if `department_name`) ` · <b>department_name</b>`.
   - Chips:
     - pill brand `employee_code`
     - pill good `status`
     - if `grade`: pill `grade` + (` · job_level` if present)
     - if `employment_type`: pill `employment_type`
     - if `!self`: pill warn `Viewing as {viewer_role}`
   - Facts, each shown only if present: `Company {company_name}`, `Location {location_name}`, `Joined {pretty(date_of_joining)}`, `Tenure {tenure_years}y {tenure_months}m` (when `tenure_years !== undefined`), `Seat {workstation}`.
   - Actions (only if `self`):
     - `Edit profile` (primary) → tab `personal`
     - `Request an update` (ghost) → opens ChangeModal for `firstRequestable()`. That walks MODEL in tab order and returns the first `state==='request'` field, which is **always "Spouse name"**.
     - link `Change history` → tab `records`. The real change-request list is below the shell (§2.7).
   - `self = payload.isSelf ?? payload.viewer_role === 'self'`
3. **KPI strip**: 4 tiles, each with a label, value + small unit, and a bar at `pc%`.

   | k | value | unit | bar pc |
   |---|---|---|---|
   | Tenure | `tenure_years ?? '-'` | yrs | min(100, years*10) |
   | Profile score | `completeness.score` | % | score |
   | Reportees | `reportee_count ?? 0` | people | min(100, n*20) |
   | Open items | `completeness.pending.length` | pending | min(100, n*20) or 0 |

4. **Two-column shell**: rail 296px plus main. It collapses to one column at ≤1040px.

   **Rail**

   a. Card **"Profile completeness"**. Right side: if pending, pill warn `{n} pending`. Inside: Ring (76px, stroke brand on sunken, `{score}%` / `complete`) and the text "Finishing these keeps payroll and statutory records clean." Then the `pending` list. Each item has a **`Fix`** button, and every Fix also opens ChangeModal("Spouse name") via `firstRequestable()`.
      - Pending strings come from `profile_completeness()`, migration 091. There are 12 checks, and score = floor(got/12*100). The strings:
        - `Upload a passport size photo` (photo_path)
        - `Add your PAN` (pan_number)
        - `Add your Aadhaar` (aadhar_last4)
        - `Add your UAN`
        - `Add your salary account` (bank_account_last4)
        - `Add your present address` (res_address1)
        - `Add your permanent address`
        - `Add an emergency contact`
        - `Add your blood group`
        - `Add a provident fund nominee` (nominations scheme='pf')
        - `Add a gratuity nominee — the shares must total 100%`
        - `Upload your onboarding documents` (any employee_documents status 'verified')

   b. Card **"Reporting chain"**. Right side: `{reportee_count} reportees`. The rows are those of `[rm_l1_name 'Reporting Manager L1', rm_l2_name 'Reporting Manager L2', hod_name 'Head of Department', md_name 'Managing Director']` that are present. Each row shows initials, name and label. A final "me" row shows initials, full_name, and `You · {designation}` (or `Subject · ...`). If no chain rows exist → `No reporting chain recorded.`

   c. If `self`: **IdCard** (§2.10) followed by **IdCardDownload** (§2.11). Otherwise a static `.dig` card: brandline `EZ` + company_name, initials, name and designation, and the note "A gate code can only be issued for your own card."

   **Main**

   - Tab strip (`TABS`, `lib/profile/model.ts`): `overview Overview`, `personal Personal`, `job Employment`, `statutory Statutory`, `payroll Payroll`, `time Time & Leave`, `growth Growth`, `records Records`. Default `overview`.
   - Legend: **Direct**: change it yourself · **Request**: goes for approval · **Locked**: HR maintains it · **Event**: starts another workflow.
   - Render order for every tab: tab-specific "overview" block (overview only) → field groups `MODEL[tab]` → tab-specific extras → RecordTables for `RECORD_CARDS` whose `tab` matches.

5. **ChangeRequests** (§2.7), shown when `self`.
6. **ChangeModal** (§2.6) and **PhotoUploader** (§2.9), as overlays.

### 2.5 Tabs in detail

#### Overview

- Section "At a glance". Subtitle: "The things you would otherwise open four screens to find." It holds two cards.
  - **Coming up**:
    - 🎉 `Work anniversary` — `{pretty(date_of_joining)} · {tenure_years} years` (if DOJ)
    - 🎂 `Birthday` — `{pretty(date_of_birth)}` (if DOB)
    - 💰 `Payroll cut-off` — `25th of every month` (static)
  - **Employment** (plain fields):
    - `Employment type` = employment_type
    - `Category` = employee_category
    - `Notice period` = `{notice_period_days} days` or `-`
    - `Weekly off` = weekly_off
- Block "Attendance and leave": "Kept in Time & Attendance and the Leave section of ESS, which owns it. Named here so the profile does not look as though it is missing something it never held."

#### Field card (all field-group tabs)

Each card shows:
- Top-right state text, coloured by state: Locked = `muted`, Direct = `positive`, Request = `warning`, Event = `info`.
- `k` = label, `v` = value. `mono` fields use a monospace font. A `hint` line shows when the field has one.
- `wide` fields span 2 columns of the 3-column grid.
- The value is `money()` if the key matches `/ctc|gross/`, otherwise `pretty()`.
- **Mask**: if `f.mask` and the value is not `-`, it shows `'•'.repeat(min(12,max(4,len)))` and a `Reveal` button. After revealing, the value shows with a `Hide` button.
- **Actionable** = `maySee && keyPresent && viewer_role==='self' && state!=='locked'`. Actionable cards get the class `act` and title `'Click to edit'` (direct) or `'Click to request a change'`. Clicking opens ChangeModal.
- Quirk: this uses `viewer_role`, not `isSelf`, so an HR-role employee can't click-edit their own fields.

#### Field model (`lib/profile/model.ts#MODEL`)

state: L = locked, D = direct, R = request, E = event. `column` = the actual employees column written for direct edits.

**Personal**

| group | label | key | state | min | flags / column / hint |
|---|---|---|---|---|---|
| Identity | Full name | full_name | L | | |
| | Preferred name | display_name | D | | column display_name |
| | Employee code | employee_code | L | | mono |
| | Date of birth | date_of_birth | L | self | |
| | Gender | gender | L | | |
| | Blood group | blood_group | D | | column blood_group |
| | Marital status | marital_status | E | | hint "Opens family, nominee and insurance steps" |
| | Anniversary | marriage_date | D | | column marriage_date |
| Background | Father's name | father_name | L | self | |
| | Mother's name | mother_name | L | self | |
| | Spouse name | spouse_name | R | self | |
| | Nationality | nationality | L | | |
| | Place of birth | place_of_birth | L | | |
| | Domicile state | domicile_state | L | | |
| | Languages | languages | D | | column languages |
| | Differently abled | is_disabled | R | | hint "Drives Section 80U relief" |
| | International worker | is_international_worker | L | | hint "Drives PF Form 11 treatment" |
| Contact | Official email | official_email | L | | |
| | Personal email | personal_email | D | self | column personal_email |
| | Mobile | mobile | D | self | column mobile |
| | Alternate number | alt_mobile | D | self | column **alternate_mobile** |
| | Extension | extension | L | | mono |
| | WhatsApp alerts | whatsapp_optin | D | | column whatsapp_optin |
| Address and emergency | Present address | present_address | R | self | wide, hint "Changes PT state and HRA exemption" |
| | Permanent address | permanent_address | R | self | wide |
| | Emergency contact 1 | emergency_contact_1 | D | self | wide, column emergency_contact_1 |
| | Emergency contact 2 | emergency_contact_2 | D | self | wide, column emergency_contact_2 |

**Employment (`job`)**

| group | label | key | state | flags |
|---|---|---|---|---|
| Position | Designation | designation | L | |
| | Department | department_name | L | |
| | Sub department | sub_department | L | |
| | Grade | grade | L | |
| | Job level | job_level | L | |
| | Employment type | employment_type | L | |
| | Employee category | employee_category | L | |
| | Cost centre | cost_centre | L | mono |
| | Company | company_name | L | |
| | Business unit | business_unit | L | |
| | Work location | location_name | L | hint "Changed through the Transfer module" |
| | Branch code | branch_code | L | mono |
| | Seat | workstation | D | column workstation |
| Dates and terms | Date of joining | date_of_joining | L | |
| | Confirmation date | confirmation_date | L | |
| | Probation | probation_months | L | |
| | Notice period | notice_period_days | L | |
| | Employment status | status | L | |
| Reporting | Reporting Manager L1 | rm_l1_name | L | |
| | Reporting Manager L2 | rm_l2_name | L | |
| | HOD | hod_name | L | |
| | Managing Director | md_name | L | |
| | Dotted line | dotted_line_manager_id | L | (renders raw UUID) |
| | Reportees | reportee_count | L | |
| Working pattern | Weekly off | weekly_off | L | |
| | Attendance mode | attendance_mode | L | |

After the groups comes **"Movement history"**, subtitle "What the employee record itself holds.":
- ✓ `Confirmed in service` — `{pretty(confirmation_date)} · probation closed` (if present)
- → `Joined {company_name}` — `{pretty(date_of_joining)} · {designation}` (if DOJ)
- If there is no DOJ: `No dates recorded.`

**Statutory**

| group | label | key | state | min | flags |
|---|---|---|---|---|---|
| Tax identity | PAN | pan | L | hr | mono, **mask** |
| | Aadhaar last 4 | aadhar_last4 | L | self | mono |
| Provident fund | UAN | uan | L | self | mono |
| | PF number | pf_number | L | self | mono |
| | PF applicability | pf_applicable | L | | |
| | Voluntary PF | vpf_amount | D | | column vpf_amount |
| | Pension (EPS) | eps_status | L | | |
| Other statutory | ESIC | esic_ip_number | L | self | |
| | ESIC dispensary | esic_dispensary | L | | |
| | Professional tax | pt_state | L | | |
| | Labour welfare fund | lwf_state | L | | |
| Other identity documents | Passport | passport_no | R | hr | mono, **mask** |
| | Driving licence | driving_licence | D | self | mono, column driving_licence |
| | Voter ID | voter_id | D | self | mono, column voter_id |

After the groups comes a `note warn`: "Full PAN and passport are readable only by HR, Payroll and Admin. Everybody else sees the last four digits, in reports and exports too, not just on this screen." The real behaviour is different: non-HR viewers get "Restricted".

**Payroll**

| group | label | key | state | min | flags |
|---|---|---|---|---|---|
| Salary account | Bank name | bank_name | R | self | |
| | Account last 4 | bank_last4 | L | self | mono |
| | IFSC | ifsc | R | self | mono |
| | Account holder | bank_holder_name | R | hr | |
| | Payment mode | payment_mode | L | | |
| Compensation | Annual CTC | annual_ctc | L | manager | money |
| | Monthly gross | gross_monthly | L | manager | money |

Note: for `self`, the `manager`-min fields evaluate `rank(self)=1 < 2`, so **Annual CTC and Monthly gross show "Restricted" to the employee** even though the server sends them.

After the groups:
- If `payload.salary`: section "Salary structure", subtitle `Head wise, effective {pretty(effective_date)}{ · FY {fy}}.` It contains a table with columns Head | Monthly | Annual. Rows appear only when the value is non-null:
  - Basic (`basic_monthly`)
  - House rent allowance (`hra_monthly`)
  - Conveyance (`conveyance`)
  - Gratuity (`gratuity_monthly`)
  - Provident fund (employee) (`employee_pf`)
  - Provident fund (employer) (`employer_pf`)

  Annual = monthly × 12. The final bold row is **Gross**: `gross_monthly` and `gross_annual`.
- Otherwise: Elsewhere "Salary structure" — owner "the Payroll section of ESS".

**Time & Leave**: only Elsewhere "Attendance, punches and leave", owner "Time & Attendance".

**Growth**

- Section "Performance", subtitle "From the PMS cycle, not entered here.". If null → `No appraisal recorded yet.`. Otherwise a 3-column grid:
  - Cycle = `period.period_name`
  - Stage = `period.status`
  - Rating = `final_rating_code · final_rating` or `Not finalised`
  - Score = `final_score`
  - KRAs = `kra_count`
  - One to one = `one_to_one_count`
  - Acknowledged = `Yes` / `Not yet`
  - Finalised = `pretty(finalised_at)`
- Section "Recognition", subtitle "Shoutouts and awards from the Wall of Fame.". Empty → `Nothing on the wall yet.`. Each card shows 🏆, `{kind}{ · cycle_label}`, `message.slice(0,110)` or `-`, a pill `pretty(created_at)`, and a pill brand `badge_ref`.
- RecordTables: Education, Previous experience, Skills and certifications, Training.

**Records**

- If `app_access` has rows: section "Application access", subtitle "What this person can sign in to.". Each card shows a `Locked` state, `app_name`, `access_role`, and `Since {pretty(granted_on)}`.
- RecordTables: Family, Nominations, Insurance, Documents, Assets issued (app_access is excluded from the tables).

**Personal extras** (after the Personal field groups):

- **Family**, subtitle "A family member has to be verified before insurance or a nomination can point at them.". Empty → `No family members recorded.`. Each card shows initials of `member_name`, the name, `relation{ · pretty(date_of_birth)}`, then pills:
  - `is_verified` ? good **Verified** : warn **Proof pending**
  - `is_insured` ? brand **Insured** : plain **Not insured**
  - `is_dependent` → **Dependent**
- **Nominations**, subtitle "Each record is separate and must total exactly 100% before it can be filed.". Empty → `No nominee recorded. PF and gratuity both need one.`. Rows are grouped by `scheme` (fallback `Other`). Each group card shows:
  - the scheme name
  - `nominee_name share_percent%` joined by ` · `
  - the total %. Colour is positive if exactly 100, otherwise warning
  - a meter
  - footer `Ready to file` or `Adds up to {total}%, not 100%`
- **Insurance**, subtitle "Enrolment is separate from adding a family member.". Empty → `No active policy recorded.`. Each card shows 🛡️, `policy_type`, `money(sum_insured)`, pill `policy_name`, and pill good `to {pretty(valid_to)}`.

**RecordTable** (`RECORD_CARDS` + `CARD_COLUMNS`). Header = `titleise(col)`. Cells use `money()` if the column matches `/sum_insured|amount/`, otherwise `pretty()`.

| key | title | tab | empty text | columns |
|---|---|---|---|---|
| family | Family | records | No family members recorded. | relation, member_name, date_of_birth, is_dependent, is_insured |
| nominations | Nominations | records | No nominee recorded. PF and gratuity both need one. | scheme, nominee_name, relation, share_percent |
| insurance | Insurance | records | No active policy recorded. | policy_type, policy_name, policy_no, sum_insured, valid_to |
| documents | Documents | records | Nothing uploaded yet. | doc_type, doc_name, status, expiry_date |
| assets | Assets issued | records | No company assets issued. | category, asset_name, asset_code, issued_on, returned_on |
| app_access | (cards, not table) | records | — | app_name, access_role, granted_on |
| education | Education | growth | No qualifications recorded. | qualification, institute, specialisation, to_year, score |
| experience | Previous experience | growth | No previous employment recorded. | company, designation, from_date, to_date, location |
| certifications | Skills and certifications | growth | No certifications recorded. | cert_name, issuer, issued_on, expires_on |
| trainings | Training | growth | No training assigned. | training_name, status, due_date, completed_on |

`employee_documents.status` enum values: `pending, uploaded, verified, rejected, expired, superseded`. The Records tab has no document upload or view action; it is read-only.

### 2.6 ChangeModal (edit or request one field)

Opened by clicking an actionable field, "Request an update", or "Fix". `direct = field.state === 'direct'`. Event and request fields both use the request flow.

- Title: `Edit {label}` or `Request a change to {label}`.
- Subtitle: `This saves straight away.` or `Nothing changes yet. Somebody reviews this first.`
- Requests only: `note warn` with `routeNote(key)`:
  - `/^bank|ifsc/` → "Goes to Payroll, not HR. It applies from the next salary batch, and they may ask for a cancelled cheque in the same name."
  - `/address/` → "Goes to HR. An address change also moves your Professional Tax state and HRA exemption from the next payroll month."
  - `/marital|spouse/` → "Goes to HR. It opens the family, nominee and insurance steps behind it. A nomination must total exactly 100% before it can be filed."
  - `/passport/` → "Goes to HR. Passport details are readable only by HR and Payroll."
  - otherwise → "Goes to HR. You will see the outcome in your change history."
- Input `New value`: a plain text input, starting empty (not prefilled), autofocus. **No per-type control**: dates, booleans (`whatsapp_optin`, `is_disabled`) and numbers (`vpf_amount`) are all free text. **No format validation**: no regex for mobile, email, IFSC, address, etc.
- Requests only: textarea `Reason`, placeholder "Why is this changing? The approver reads this."
- `hint` (if any), shown as `note warn`.
- Error: `note bad` showing the server's `error` string.
- Buttons: `Cancel` (ghost), and primary `Save` / `Send request` / `Sending…` while busy. Primary is disabled while busy, when the value is blank, or (for requests) when the reason is blank.
- Tapping the scrim closes it.
- Success: closes, sets flash (`{label} saved.` for direct; `Sent. You will see the outcome in your change history.` for requests), calls `load()`, and clears the flash after 4.5 s. **ChangeRequests is not refreshed**: the new request appears only after a remount. RN should refresh it.

#### `POST /api/ess/profile` (same route file)

Body for a direct edit: `{ action:'edit', key, value }`. Body for a request: `{ action:'request', key, value, reason }`. Optional `code` is checked to be your own.

Server checks, in order:
1. `fieldSpec(key)` looks the field up in MODEL. Not found → 400 `'That is not a field on this profile.'`
2. `ALLOWED_BY_STATE`: `direct→'edit'`, `request→'request'`, `event→'request'`, `locked→null`.
   - locked → 403 `'{label} is maintained elsewhere and cannot be changed here.'`
   - Wrong action: edit on a request field → 400 `'{label} needs approval, so it has to go through a request.'`; request on a direct field → 400 `'{label} is yours to change directly.'`
3. If `code` is sent and is not yours → 403 `'You can only change your own profile here.'`
4. `viewAs` → 403. With no actor: "This session is the shared dashboard login, which is not attached to an employee record. Sign in with your own ESS account to change a profile." Otherwise: "You are viewing somebody else's portal, so this would be recorded as them. Open your own portal to change your details."
5. **edit**:
   - Blank → 400 `'{label} cannot be emptied here.'`
   - No `column` → 400 `'{label} cannot be edited directly.'`
   - Otherwise `sb.from('employees').update({ [column]: value }).eq('id', me)`. DB error → 500 `{error: msg}`.
   - **200 `{ ok:true, saved: '<label>' }`**
6. **request**:
   - Blank value → 400 `'What should it be changed to?'`
   - Blank reason → 400 `'A reason is required. HR sees it when they review this.'`
   - Otherwise `sb.rpc('raise_profile_change_request', { p_employee_id: me, p_requested_by: me, p_field_key: key, p_field_label: label, p_new_value: value.trim(), p_reason: reason })`.
   - "not configured" error → 503 `'{label} has no approval route configured yet. HR needs to add it to profile_field_config before requests can be raised against it.'`. Other errors → 500.
   - **200 `{ ok:true, request_id: '<uuid>' }`**

`raise_profile_change_request` (migration 105):
- Reads `profile_field_config` (company row first, else the global row).
- Locked → exception.
- `route = cfg.route_to ?? (bank%|ifsc ? 'payroll' : 'hr')`.
- Reads the old value from `employees.<source_column>::text`.
- Inserts into `profile_change_requests` with status `pending_payroll` (payroll route), `pending_l1` (hr route and the employee has an L1), or `pending_hr`.

Seeded config (migration 101), giving field_key → route and source column:
- `marital_status`, `spouse_name`, `is_disabled`, `present_address` (→ `res_address1`), `permanent_address` (→ `perm_address1`), `passport_no` → hr
- `bank_name`, `ifsc` (→ `ifsc_code`), `bank_holder_name` → payroll

Approval writes the new value to that column. Address requests therefore overwrite only `*_address1`.

### 2.7 Change requests panel (`components/profile/ChangeRequests.tsx`)

Rendered below the shell when `canSee=self`. On mount it calls both lists in parallel:

- **`GET /api/ess/profile/requests?scope=mine`** → `{ ok:true, scope:'mine', requests: MyRequest[] }`

  ```ts
  MyRequest { id, field_key, field_label, old_value: string|null, new_value: string, reason: string|null,
              status: 'pending_l1'|'pending_hr'|'pending_payroll'|'approved'|'rejected'|'cancelled',
              stage_label: string, remarks: string|null, requested_at: ISO, decided_at: ISO|null }
  ```

  `stage_label` (from `profile_change_mine`):
  - pending_l1 `With your line manager`
  - pending_hr `With HR`
  - pending_payroll `With Payroll`
  - approved `Approved and applied`
  - rejected `Not approved`
  - cancelled `Withdrawn`

  Ordered by created_at desc. `decided_at = coalesce(approved_at, rejected_at)`.

- **`GET /api/ess/profile/requests?scope=queue`** → `{ ok:true, scope:'queue', requests: QueueRequest[] }`

  ```ts
  QueueRequest { id, employee_id, emp_code, employee /*full_name*/, field_key, field_label, old_value, new_value,
                 reason, route_to, status, stage_label /*'Waiting on the line manager'|'Waiting on HR'|'Waiting on Payroll'*/,
                 requested_at, waiting_days: int }
  ```

  Errors on the queue call are ignored silently. Errors on `mine` show `reqmsg no`.
- Route errors: 500 `'The profile approval queue is not installed yet (migration 105).'` or `'The approval functions exist but are not granted to the service role. Re-run the grants at the bottom of migration 105.'`

UI:
- Messages: `reqmsg no` (critical) for an error, `reqmsg ok` (positive) for a note.
- **"To review"** (only if queue is non-empty). Right side: `{n} waiting on you`. Each item shows:
  - **employee**, code, field_label
  - age: `today` / `N day(s)`, in warning colour + bold when ≥7 days
  - Value row: `old` (or italic `empty`) → `new`
  - reason in quotes
  - Buttons `Reject` (ghost) and `Approve` (`Working…` while busy)
  - Reject opens a textarea labelled `Why is this not approved? {FirstName} will see this.` with `Back` and `Confirm rejection` (disabled until text is entered; `Sending…` while busy).
  - This is approver functionality. Include it in RN only if managers and HR use the app for approvals.
- **"My change requests"**. Right side shows the count if >0.
  - Empty: "Nothing pending. Fields marked **Request** go for approval when you change them."
  - Each item shows field_label, `stage_label` coloured by status (approved positive, rejected critical, cancelled muted, anything else warning), the old→new value row, `Asked {date}` + ` · answered {date}` (`toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})`), and `remarks`.
  - If `status.startsWith('pending')`, a **`Withdraw`** button (`Withdrawing…` while busy).

`POST /api/ess/profile/requests`:
- `{ action:'cancel', id }` → `profile_change_cancel(p_request,p_actor)` → `{ ok:true, status:'cancelled' }`. UI note `Withdrawn.`
- `{ action:'approve'|'reject', id, remarks? }` → `profile_change_decide` →
  - `{ok:true,status:'rejected',applied:false}`
  - `{ok:true,status:'pending_hr',applied:false,message:'Cleared. Now with HR.'}`
  - `{ok:true,status:'approved',applied:true,column}`
  - UI note: `'Approved. The record has been updated.'` if applied, otherwise `message ?? ('Rejected.'|'Approved.')`.

Validation messages:
- viewAs → 403 (shared login, or "…this decision would be recorded as them. Open your own portal to approve requests.")
- Bad action → 400 `'Action must be approve, reject or cancel.'`
- No id → 400 `'Which request?'`
- Reject without remarks → 400 `'A reason is required when rejecting. The employee sees it.'`
- RPC messages passed through:
  - 403: `'You are not the approver for this request at its current stage'`, `'Only the person who raised this can withdraw it'`
  - 409: `'This request was already <status>, so it cannot be decided again'`, `'This request was already <status>, so there is nothing to withdraw'`

**Pending indicators**: there is no badge on the field cards. Pending state appears only in this list, plus the completeness "pending" pill, which is unrelated: it refers to missing data, not open requests.

### 2.8 Unused profile endpoints (exist, not called by live UI)

- `GET /api/ess/profile/[code]` (`code='me'` allowed). Uses `lib/profile/access.ts`. Returns `{...payload, tabs: buildTabs(payload), photoUrl, isSelf}` with `Cache-Control: no-store`. Errors: 401 `{error:'not_authenticated'}`, 404 `{error:'not_found'}`, 403 `{error:'separated', message:'Access ended on your last working day.'}`, 500.
  - Bug: `resolveEmployeeId` filters `employees.employee_code`, but the real column is `emp_code`. Only `me` works.
- `POST /api/ess/profile/request` with body `{ code?, fieldKey, fieldLabel, newValue, reason }` → `{ ok:true, requestId }`. Errors: 400 `'fieldKey and newValue are required'`, 403 `{error:'forbidden', message:'You can only raise a request on your own profile.'}`, 400 `{error: rpcMsg}`.
  - It skips the MODEL state check. **RN should use `POST /api/ess/profile` instead.**

### 2.9 Photo upload (`components/profile/PhotoUploader.tsx` → `POST /api/ess/profile/photo`)

Mounted only while open (`self && photoOpen`), so every open starts fresh. The modal:

- Header `Profile photo`, text: "Drag to move, pinch or scroll to zoom, double-click to fill. Saved as a 768 by 768 square."
- **Stage** (square, ~260px CSS):
  - Empty state: "Drop an image here or [choose a file]". File input `accept="image/*,.heic,.heif"`. Drag-drop is also supported.
  - Loaded state: the image plus a circular ring mask (`ez-cring`) and a grid overlay.
- Gestures:
  - one-pointer pan
  - two-pointer pinch zoom, anchored at the midpoint
  - wheel / trackpad zoom (ctrl key → factor exp(-dy·0.01), otherwise 0.0015)
  - double-click: toggles between fit and 2.2× fit (when more than 1.6× it goes back to fit)
  - pan is always clamped so the image covers the square (`clampPan`)
- Tools: `⟲` rotate left 90°, `⟳` rotate right, `⇋` flip horizontal (toggle, primary when on), `Reset`.
- Sliders:
  - `Zoom` 100–500 (% of cover-fit), label `{n}%`
  - `Straighten` −45…+45 step 0.5, label `+n°` / `n°`
- Progress bar (`busy` %) and error note.
- Footer: `Choose a file` / `Choose a different photo` (always available), `Cancel`, and `Save photo` (`Saving…`). Save is disabled while busy, with no image, or before the image is ready.

Client validation and processing:
- File >40 MB → `That image is {N} MB, over the 40 MB limit.`
- Not an image and not HEIF (sniffed from the bytes: `ftyp` brand in heic/heix/hevc/hevx/heim/heis/hevm/hevs/mif1/msf1/avif) → `That file is not an image. Use JPG or PNG.`
- Decode failure → `That image could not be opened. Try a JPG or PNG.` HEIC falls back to `heic2any` → JPEG q0.92.
- Over 60 MP → `That image is {w}x{h}, too large to crop in the browser. Scale it down and try again.`
- Downscale to longest side 2048 (`workScale`) via canvas, JPEG q0.95.
- Save with no image → `Choose an image first.`
- Export: canvas 768×768, white fill, transform `translate → rotate(quarter*90+straight) → scale(eff·(flip?-1:1), eff)` using `exportTransform(pan, eff, box, 768)`. Output JPEG q0.92 (~120 KB).

Request: `POST /api/ess/profile/photo`, `multipart/form-data`, field **`file`** = `File([blob], 'avatar.jpg', {type:'image/jpeg'})`. Headers from `uploadAuthHeaders()` (Bearer, no Content-Type).

Route (`app/api/ess/profile/photo/route.ts`, runtime nodejs):
- Auth: `essViewerId` → 401 `{error:'not_authenticated'}`
- Missing file → 400 `{error:'no_file'}`
- Type not in `image/jpeg|image/png|image/webp` → 400 `{error:'bad_type', message:'Use JPG, PNG or WebP.'}`
- Size > 2 MB → 400 `{error:'too_large', message:'Image is over 2 MB.'}`
- Storage: `storage.from('employee-photos').upload(\`${viewerId}/avatar-${Date.now()}.jpg\`, buf, { contentType: file.type, upsert:true })`. Error → 500 `{error}`.
- `employees.update({ photo_path: path, photo_updated_at: nowISO }).eq('id', viewerId)`
- `createSignedUrl(path, 28800)`
- **200 `{ ok:true, path, url: signedUrl|null }`**
- Note: this route does not refuse `viewAs`.

Client shows `j.message ?? j.error ?? 'Upload failed (<status>).'`. On success it calls `onDone(j.url ?? objectURL)`, Profile360 sets the photo and flashes `Profile photo updated.`, and the modal closes after 250 ms.

**Two photo systems exist.** Profile360 uses `employees.photo_path` in the private bucket `employee-photos`. The portal header and Home avatar use `employees.profile_photo`, a base64 JPEG data URL. That one is written by `EditProfileModal` on Home: `supabase.from('employees').update({ profile_photo: dataUrl }).eq('id', employeeId)` with the anon key, resized to 256px, JPEG 0.82. Uploading in one does not update the other. Completeness counts `photo_path`.

Pure TS reusable in RN: `lib/profile/crop-math.ts` (no imports). Exports:
- `Pt`, `coverScale`, `rotatedCover`, `clampPan`, `frameInside`, `anchoredPan`, `Xform`, `exportTransform`, `WORK_MAX=2048`, `workScale`, `rad`
- Tests in `lib/profile/__tests__/crop-math.test.ts`.
- `import { rotatedCover, clampPan, anchoredPan, exportTransform, workScale, rad } from '@/lib/profile/crop-math'`

### 2.10 Digital ID card with live QR (`components/profile/IdCard.tsx`)

Rail card `.dig`, a brand gradient with on-accent text.
- Brandline: `EZ` mark + company.
- **Front**:
  - initials tile (no photo), name, designation
  - grid: `Employee code` = code; `Date of joining` = pretty(doj) (en-IN 2-digit/short/numeric); `Blood group` = blood or `-`; `Emergency` = last `·`-separated segment of `emergency_contact_1`, trimmed, or `-`
- **Back** (QR):
  - `Getting a code…` while loading
  - error text in a translucent note
  - otherwise a 172×172 QR image on white, `Valid for **Ns** · single use` (or `Refreshing…` at 0), and `Card {cardNo}{ · accessZones.join(', ')}`
- Toggle button: `Show QR` / `Show card`.

Token loop (only while the back is shown): `fetchToken()` immediately and then every 15 s, **only if `document.visibilityState==='visible'`**, plus an immediate fetch on `visibilitychange` → visible. The countdown ticks every 250 ms: `ceil((expiresAt - now)/1000)`.

QR content = `body.url`, rendered with `QRCode.toDataURL(url, { width:460, margin:1, errorCorrectionLevel:'M', color:{dark:'#0F172A', light:'#FFFFFF'} })` (npm `qrcode`).

**`GET /api/ess/id-card/token`** (Bearer) → `lib/profile/idcard.ts#issueToken`:

```ts
{ token: 'EZ1.<b64url payload>.<b64url sig>', url: '<base>/verify/<token>', expiresAt: number /*epoch ms*/,
  ttl: 30, refresh: 15, cardNo: string, validTill: string|null, accessZones: string[] }
```

- `base` = `NEXT_PUBLIC_APP_URL`, unless that is loopback, in which case the request origin from `x-forwarded-host/proto` or `host`. **RN must call the deployed host so the QR encodes a reachable URL.**
- Server: reads `id_card_credentials` (`secret, card_version, card_no, state, valid_till, access_zones`). It creates one via `rpc('issue_id_card')` if missing. More than 12 `id_card_tokens` in the last 60 s → rate limit. It registers through `rpc('register_id_token', {p_jti, p_employee_id, p_card_version, p_ttl_seconds:30})`.
- Errors `{error}`:
  - 403 viewAs: `'Your ESS session is not active, so there is no card to issue a code for. Sign in again with your own ESS account.'` or `'A gate code can only be issued for your own card. Open your own portal.'`
  - 503 `'The ID card is not configured on this server yet (ID_CARD_PEPPER).'`
  - 429 `'Too many codes requested. Wait a moment and try again.'`
  - 403 `'This card is <suspended|revoked|expired>. Ask HR to reissue it.'`
  - 500 `<msg>`
  - Client fallbacks: `Could not get a code (<status>).` and `Could not reach the server.`

**Verify page** `app/verify/[token]/page.tsx`: public and server-rendered. It **consumes** the token (`consume_id_token`) during the render. The guard scans the QR with any phone camera → the web page shows "Verified" (name, designation, Employee code, Card number, Access zones, Valid till, "This code has now been used and will not verify again.") or "Not verified" / "Do not let this through". It is not part of the employee app, and RN does not need to build it. Its colours are hardcoded `#065F46` / `#7F1D1D`.

`lib/idcard/*` (`authz.ts`, `card-data.ts`, `server.ts`) is the **admin bulk export** path (scopes, `id_card_downloads` audit). The ESS download does not use it and does not log a download.

### 2.11 Printable ID card PDF (`components/profile/IdCardDownload.tsx` + `lib/profile/id-card-pdf.ts`)

- Button `Download ID card (PDF)` (`Preparing…` while busy) with a download icon.
- Help text: "Two pages, front and back. Print at 100% and cut the rounded outline for a 54 × 85.6 mm card. For identification only. Scan at the gate from your digital ID above."
- Error line in critical colour: `e.message` or `Could not build the PDF.`

Data passed from Profile360: name, code, company, designation, department (`department_name`), location (`location_name`), doj, blood, photoUrl (the signed URL).
- **Not passed**: emergencyName / Relation / Phone, cardNo, validTill. So the back always prints `Not available` for the emergency contact, and `-` for card number and valid-till.

The photo URL is fetched and turned into a data URL (`FileReader`). If that fails, initials are used.

Built entirely in the browser:
- **canvas** at 12 px/mm, CR80 54×85.6 mm plus a 3 mm backdrop margin (`#E7E4F2`)
- converted to JPEG and embedded with **pdf-lib**, 2 pages
- Front:
  - company initial tile, company name, `EMPLOYEE IDENTITY CARD`
  - photo or initials on a gradient (#A5B4FC→#4F46E5)
  - name, designation
  - rows EMPLOYEE CODE / DEPARTMENT / BLOOD GROUP / LOCATION
  - a **deliberately blurred** QR (`qrcode` of the text `'EZER · live code available in ESS'`, canvas `filter: blur`), `Entry pass`, and `Open your digital ID in ESS to scan at the gate.`
  - footer `Property of {company}`
- Back:
  - `IN CASE OF EMERGENCY` / `Please contact the person below`
  - `EMERGENCY CONTACT` with name, relation and phone, or `Not available`
  - blood-group badge (red if present)
  - DATE OF JOINING, CARD NUMBER, VALID TILL
  - `IF FOUND, PLEASE RETURN TO` + company
  - drawn signature, `Authorised Signatory`, and `For identification only. This card does not grant entry.`
  - microtext `{company} · {code}`
- File name: `ID-Card_${code}_${name.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')}.pdf`, saved via Blob + `<a download>`.
- `id-card-pdf.ts` imports `pdf-lib` and dynamically imports `qrcode`. It uses `document.createElement('canvas')`, `Image` and `ctx.filter`, so it is **browser-only**. `idCardFileName` and `prettyDate` are pure.

---

## 3. Letter Requests → `Documents` (EmployeePortal.tsx line 1011)

Purpose: ask HR for a letter, and track it.

`LETTER_TYPES` = `['Salary Certificate','Experience Letter','Address/Employment Verification','Bonafide Certificate','NOC','Visa / Travel Letter','Bank Loan Letter','Relieving Letter','PF Transfer Letter','Custom Request']`

Layout:

1. Card, section heading `Request a Letter (HR generates on approval)`. A 2-column grid holds:
   - `Letter type` select (default `Salary Certificate`)
   - `Purpose` text input, placeholder `e.g. bank loan, visa…`

   Then button `Request letter` (`Sending…`, opacity .6 while busy). **No validation**: purpose is optional, and Custom Request has no details field (`custom_details` is sent as `''`).
2. Card `My Letter Requests`.
   - Empty or while loading: `No requests yet.` There is no separate loading state.
   - Each row: **letter_type**, then `{purpose || '-'} · {fmt(requested_at)}`; on the right, `StatusPill(status)` and, if `letter_url`, a `Download` link (`<a href target=_blank>`).
   - `rejection_reason` is **not displayed**.

Toasts (portal `notify`): success `Letter request sent to HR.`; error `Failed: <message>`. After success the purpose is cleared and the list reloaded.

**Direct Supabase (anon key)**, `lib/supabase-ess.ts`:

```ts
supabase.from('ess_letter_requests').select('*').eq('employee_id', employeeId).order('requested_at', { ascending: false })
supabase.from('ess_letter_requests').insert({ employee_id: employeeId, letter_type, purpose, custom_details })
```

Table (migration 021):
```
ess_letter_requests(id uuid, employee_id, letter_type text, purpose, custom_details,
  status TEXT DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','GENERATED','REJECTED')),
  requested_at, processed_by, processed_at, letter_url, rejection_reason)
```

RLS: allow_all for anon and authenticated.

No HR screen in the repo updates `status` or `letter_url` on this table. A grep finds no writer, so requests sit in `REQUESTED` unless someone edits the DB directly.

`StatusPill` colours (tokens):

| status | bg / fg |
|---|---|
| REQUESTED | warningTint / warning |
| APPROVED | positiveTint / positive |
| GENERATED | positiveTint / positive |
| REJECTED | criticalTint / critical |
| other | brandTint / brandDeep |

Shape: fontSize 10, padding 2×9, radius 99, weight 600. The raw status text is shown.

**Recommended RN transport (same tables, session-scoped): `/api/ess/requests`** (`app/api/ess/requests/route.ts`). It was written so the phone would not need anon writes.

`GET /api/ess/requests` →
```ts
{ letters: {
    issued:   { id, name /*letter_templates.name or 'Letter'*/, letter_date, file_url }[],     // generated_letters where published_to_ess_at not null, ≤50, letter_date desc
    requests: { id, letter_type, purpose, details /*custom_details*/, status /*default 'REQUESTED'*/,
                requested_at, letter_url, rejection_reason }[] },                              // ≤20, requested_at desc
  service:  { requests: { id, request_type, detail, status, confidential, assigned_to, submitted_at, resolved_at, resolution_note }[] },
  diagnostics: { noIssuedLetters, noLetterRequests, noServiceRequests } }
```

`POST /api/ess/requests`, body `{ kind:'letter', letter_type, purpose?, details? }`:
- `letter_type` is trimmed and capped at 80 chars; `purpose` at 500; `details` (or `custom_details`) at 1000.
- Missing type → 400 `'Say which letter you need.'`
- An open duplicate (status REQUESTED/APPROVED with the same type) → **409** `` `You already have a ${letterType.toLowerCase()} request waiting. HR will update it here.` ``
- viewAs → 403: `'Your ESS session is not active, so this request has nobody to raise it. Sign in again with your own ESS account.'` or `"A request is raised in your own name, so it cannot be submitted while you are viewing somebody else's portal. Open your own portal to raise one."`
- Success → `{ ok:true, kind:'letter', id, status:'REQUESTED' }` and an audit row `LETTER_REQUESTED`.
- Bad kind → 400 `"kind must be 'letter' or 'service'."`

The web has no duplicate guard, so using the API adds the 409 behaviour. That is acceptable, and arguably correct.

---

## 4. My Letters → `MyLetters` (EmployeePortal.tsx line 3066)

Purpose: download HR-issued letters that HR has published to ESS.

Layout: one card, heading `My Letters`.
- Loading: `Loading…`
- Empty: `No letters have been shared with you yet. HR-issued letters (offer, confirmation, etc.) will appear here.`
- Each row: an empty icon span, **letter_name**, `letter_date` formatted en-IN (2-digit, short, numeric), and a `⬇ Download` button.

**Direct Supabase (anon key)**:

```ts
supabase.from('my_generated_letters').select('*').eq('employee_id', emp.id).order('letter_date', { ascending: false })
// download:
supabase.storage.from('generated-letters').createSignedUrl(fileUrl, 300)   // 5-minute signed URL
  → if (data?.signedUrl) window.open(data.signedUrl, '_blank')            // silent no-op on failure
```

The view `my_generated_letters` is **not in `supabase/migrations`**. Its definition, found in a handoff transcript (`ezer-hrms-handoff/...jsonl`, "sql60"):

```sql
CREATE VIEW my_generated_letters AS
SELECT gl.id, gl.employee_id, gl.letter_date, gl.file_url, lt.name AS letter_name,
       gl.generated_at, gl.emailed_at, gl.published_to_ess_at
FROM generated_letters gl JOIN letter_templates lt ON lt.id = gl.template_id
WHERE gl.published_to_ess_at IS NOT NULL;
```

Files are generated server-side by `app/api/letters/generate/route.ts`:
- PDFs merged on the server and uploaded to the private bucket **`generated-letters`** at `${company_id}/${employee_id}/${template_id}_${Date.now()}.pdf` (`contentType: application/pdf`)
- `generated_letters.file_url` holds that storage path, not a URL
- HR publishes with `publishLetterToEss` (`lib/letters/actions.ts`): `generated_letters.update({ published_to_ess_at: now })`

There is no client-side PDF generation for letters; you only download the stored PDF.

RN options:
- (a) Replicate the anon calls with `@supabase/supabase-js` (already in apps/mobile). Requires the anon storage policy on `generated-letters` that the web relies on.
- (b) Use `GET /api/ess/requests` → `letters.issued`, which has the same data and `name` instead of `letter_name`. **No server endpoint signs `generated-letters` URLs for ESS.** Signing still has to be done with the anon client, or a new endpoint added.

---

## 5. Reporting line (`MyReportingLine` + `useManagerChain`)

- `MyReportingLine` (EmployeePortal.tsx 3400) is used **only** by the dead `Profile()`. Profile360's rail chain comes from the payload (`rm_l1_name`, `rm_l2_name`, `hod_name`, `md_name`; §2.4b).
- `useManagerChain` is also used by `components/ess/team/MyTeam.tsx` (Team spec).

`useManagerChain(employeeId)` (`lib/rms/client.ts:126`):

**`GET /api/rms/hierarchy?employee_id=<id>`**, header `Authorization: Bearer <authToken()>`, `cache:'no-store'` →

```ts
{ managers: ManagerSlot[], direct_report_count: number }
ManagerSlot { relationship_type: 'L1'|'L2'|'L3'|'L4'|'HOD', manager: null | ManagerRef }
ManagerRef  { id, emp_code, full_name, designation, department /*dept_name*/, office_email, personal_email }
```

- Source: `employee_relationships` where `employee_id = id` and `valid_to is null`, ordered L1, L2, L3, L4, HOD. Missing levels are absent. Manager details come from `employees` + `departments`.
- Hook returns `{ managers, reportCount, loading, error }`. Error strings: server `error`, otherwise `'Could not load the reporting line.'`, or on network failure `'Could not reach the server.'`.
- Route errors: 401 `'Sign in to continue.'`, 400 `'employee_id is required.'`, 403 `'You can only see your own reporting line.'` (another employee without Employees module access).
- Other views: `&view=reports[&type=L1|L2|…|any]` → `{ reports }`; `&view=tree` → `{ tree }`.

`MyReportingLine` rendering:
- Labels: `{L1:'Reporting manager', L2:'L2 manager', L3:'L3 manager', L4:'L4 manager', HOD:'Head of department'}`
- loading → `Reporting manager: …`
- No managers → `Reporting manager: {fallbackL1 (employees.l1_manager_id → full_name)}`
- Otherwise one row per slot: `full_name · designation`, icon 🏛️ for HOD and 👔 otherwise. If `reportCount>0`: `Reports to you: N person/people`.

Pure module RN can import: `lib/rms/hierarchy.ts` (no imports). It exports `RELATIONSHIP_TYPES`, `CHAIN_ORDER`, `ManagerSlot`, `ManagerRef`, `buildChain`, `isRelationshipType`, `findCycle`. Import with `import { CHAIN_ORDER, type ManagerSlot } from '@/lib/rms/hierarchy'`.

---

## 6. Validation inventory

- **The live Profile360 flow validates nothing about format.** Client-side, the only checks are non-empty value and (for requests) non-empty reason. Server-side, the only checks are field state, non-empty value and reason, and DB type casts at approval time. If a cast fails, the error is `Could not apply <label> to employees.<col> (<type>): <sqlerrm>`.
- No IFSC lookup and no account-number confirmation exist in Profile360. They exist only in the dead `Profile()`:
  - `fetch('https://ifsc.razorpay.com/<IFSC>')` → `{BANK, BRANCH}`
  - account number entered twice, with messages `'Account numbers do not match'`, `'Fill IFSC, account number and holder name'`, and `The two account numbers do not match.`
  - writes `ess_service_requests` type `PROFILE_UPDATE`, which is not the profile change-request table
  - The code comment calls the missing lookup and confirmation a real gap. RN may choose to add them but must still submit through `POST /api/ess/profile action:'request'`.
- Reusable regexes: **`lib/hr/validate.ts`** (pure TS, no imports, RN-safe). Import with `import { RULES, fieldError, UPPERCASE } from '@/lib/hr/validate'`.

  | rule key | regex | message |
  |---|---|---|
  | pan_number | `/^[A-Z]{5}[0-9]{4}[A-Z]$/` | Ten characters, like ABCDE1234F |
  | aadhaar_input | `/^[0-9]{12}$/` | Twelve digits |
  | ifsc_code | `/^[A-Z]{4}0[A-Z0-9]{6}$/` | Eleven characters, like HDFC0001234 |
  | uan_number, previous_uan | `/^[0-9]{12}$/` | Twelve digits |
  | bank_account_input | `/^[0-9]{9,18}$/` | Nine to eighteen digits |
  | res_pin, perm_pin | `/^[1-9][0-9]{5}$/` | Six digits |
  | mobile, alternate_mobile, emergency(2)_mobile, reference1/2_mobile | `/^[6-9][0-9]{9}$/` | Ten digits, starting 6-9 |
  | personal_email, emergency(2)_email | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | Looks like name@example.com |

  `fieldError(k, raw)` also checks dates: `date_of_birth` cannot be in the future, `Under 14. Check the year`, `Over 100. Check the year`; `marriage_date` and `spouse_dob` cannot be in the future. It upper-cases PAN and IFSC. Profile360 does **not** use it. Keys differ: profile keys are `mobile`, `alt_mobile`, `personal_email`, `ifsc`, so map them before calling.
- `lib/recruitment/blacklist.ts#validPan` = `/^[A-Z]{5}\d{4}[A-Z]$/`. That file imports DB code, so use `lib/hr/validate.ts` instead.

Module import safety for RN:

| module | safe in RN? | why |
|---|---|---|
| `lib/profile/types.ts` (ViewerRole, FieldState, ProfileField, ProfilePayload, `maySee`, `ROLE_RANK`) | yes | no imports |
| `lib/profile/model.ts` (TABS, FIELD_TABS, MODEL, RECORD_CARDS, CARD_COLUMNS) | yes | type-only import of ./types |
| `lib/profile/crop-math.ts` | yes | pure |
| `lib/hr/validate.ts` | yes | pure |
| `lib/rms/hierarchy.ts` | yes | pure |
| `lib/profile/client.ts` | **no** | imports `@/lib/auth-headers` → `@/lib/supabase` and `localStorage`; relative `fetch('/api/...')` URLs |
| `lib/profile/id-card-pdf.ts` | **no** | DOM canvas, Image, `ctx.filter`, pdf-lib; only `idCardFileName`/`prettyDate` are pure |
| `lib/profile/idcard.ts` | **no** | `node:crypto`, service-role client (server only) |
| `lib/profile/access.ts` | **no** | `next/headers`, service-role key |
| `lib/idcard/*` | **no** | server, admin export |
| `lib/supabase-ess.ts` | partial | imports `@/lib/supabase` (env via `process.env.NEXT_PUBLIC_*`); replace with an RN client |
| `lib/ess-session-client.ts`, `lib/auth-headers.ts` | **no** | `localStorage`, `atob`; reimplement with SecureStore |
| `lib/rms/client.ts` | **no** | React hooks + `localStorage` + Supabase |
| `lib/ui/tokens.ts` (`C`) | **no** (values are `var(--ez-*)`) | use the hex values from `lib/ui/theme.css` |

## 7. Status / state colours (tokens → light / dark hex from `lib/ui/theme.css`)

| token | light | dark | used for |
|---|---|---|---|
| brand | #2563EB | #60A5FA | primary buttons, pill brand, ring |
| brandDeep | #1D4ED8 | #93C5FD | gradient end, default StatusPill fg |
| brandTint | #EFF6FF | #172033 | cover wash, default StatusPill bg |
| brandEdge | #BFDBFE | #24344F | borders |
| positive / positiveTint | #047857 / #ECFDF5 | #34D399 / #10241D | Direct state, pill good, approved, nominations at 100% |
| warning / warningTint | #B45309 / #FFFBEB | #FBBF24 / #251C0D | Request state, pill warn, pending, waiting ≥7 days |
| critical / criticalTint | #C0201F / #FEF2F2 | #F87171 / #2A1414 | errors, rejected, Reject button |
| info / infoTint | #0369A1 / #F0F9FF | #7DD3FC / #10222B | Event state |
| muted | #4B5563 | #9CA3AF | Locked state, cancelled |
| faint | #626D80 | #828C9B | "Restricted", empty text |
| ink / surface / canvas / sunken / line | #111827 / #FFFFFF / #F3F5F8 / #F3F4F6 / #E5E7EB | #F3F4F6 / #171B21 / #0F1216 / #14181E / #262C35 | text, cards |
| onAccent | #FFFFFF | #0D1117 | text on the ID card gradient |

The ID card gradient is `linear-gradient(140deg, brandDeep, brand 60%, brandEdge)`. The PDF uses its own hardcoded hexes, listed in §2.11.

---

## 8. Dead `Profile()` (not reachable; for completeness only)

- `ProfileHero`: avatar from `profile_photo`; name; designation · dept; chips 🆔 code, 🏢 company, 📍 location+city, ⏳ tenure. Birthday and work-anniversary chips appear within 30 days. A ring scores 10 client checks (DOB, gender, blood, marital, mobile, personal email, PAN, Aadhaar, UAN, photo), with a "Still needed:" chip list.
- Tabs: `My Record` (default), `At a glance`, `Request a change`.
  - My Record = `RecordQuickStats` (Group DOJ, Company DOJ, Confirmation, Department, Location, Notice Period) + `ESS_RECORD_TABS` (Personal, Employment, Statutory, Bank, Documents, Salary, Onboarding, History) via `EmployeeProfileSections` (read-only; Aadhaar shown as `XXXX-XXXX-{last4}`, account as `XXXX XXXX XXXX {last4}`; the last four tabs delegate to `HRActionPanel`).
  - At a glance = panels "Where you sit", "Your people" (`MyReportingLine`, HR contact, Office email) and "Service". Copy buttons use `navigator.clipboard`.
  - Request a change = select from `['Personal Details','PAN Card','Aadhaar','Bank Account','Emergency Contact','Family / Dependents','Nominee','Education']` + details, or the bank form, then `ess_service_requests` insert `PROFILE_UPDATE`. Toasts: `Update request sent to HR for approval.` / `Bank account update request sent to HR for approval.` / `Describe what to update`.
- Data comes from `loadEmployeeDetail` (anon `employees` select with joins). **Do not port** unless the product owner asks.

---

## 9. Complete list of direct Supabase calls in this section (browser, anon key)

1. `supabase.from('ess_letter_requests').select('*').eq('employee_id', id).order('requested_at', { ascending:false })` (Letter Requests list)
2. `supabase.from('ess_letter_requests').insert({ employee_id, letter_type, purpose, custom_details: '' })` (Letter Requests submit)
3. `supabase.from('my_generated_letters').select('*').eq('employee_id', emp.id).order('letter_date', { ascending:false })` (My Letters list)
4. `supabase.storage.from('generated-letters').createSignedUrl(file_url, 300)` (My Letters download)
5. Portal-wide, not Profile360: `loadEmployeeDetail`, which supplies `emp.emp_code`/`emp.id` to this section, and `employees.update({ profile_photo })` from Home's EditProfileModal.

Profile360, ChangeRequests, PhotoUploader and IdCard make **no** direct Supabase calls; everything goes through `/api/ess/*`. Server-side service-role calls are listed inline in §2.

---

## 10. Implementation notes for React Native

- **Base URL and auth**: every web call uses a relative path (`/api/ess/...`). RN needs an absolute `API_BASE` (prod `https://ezer-hrms-chi.vercel.app`). Store the ESS token in `expo-secure-store` and send `Authorization: Bearer`. Reproduce the 30 s expiry skew from `essToken()`. Do not send `employee_id`.
- **Photo upload**:
  - Replace `<input type=file>`, drag-drop, canvas and `heic2any` with `expo-image-picker`. Use `allowsEditing:true, aspect:[1,1]` or a custom gesture cropper with reanimated + gesture-handler, reusing `lib/profile/crop-math.ts`.
  - Export through `expo-image-manipulator` (crop, rotate, flip, resize to 768, `SaveFormat.JPEG`, compress ~0.92). That module is not in apps/mobile yet, so add it. The picker already returns JPEG for HEIC on iOS when `quality` is set.
  - Send `FormData` with `{ uri, name:'avatar.jpg', type:'image/jpeg' }` under field `file`, **without** setting Content-Type. Keep the result ≤2 MB and JPEG/PNG/WebP.
  - There is no wheel or double-click on mobile. Map pinch, pan and double-tap.
- **Displayed photo**: `photoUrl` is an 8 h signed URL. Use `expo-image` and refetch the profile when it expires. The header/Home avatar uses the separate `profile_photo` data URL (§2.9); decide which one the app shows and keep both in mind.
- **`window.print()`** (cover "Print"): no equivalent. Drop it, or use `expo-print` with an HTML rendering.
- **ID card QR**: use `react-native-qrcode-svg` (needs `react-native-svg`, already present), or `qrcode` to an SVG string. Encode `body.url` exactly.
  - Replace `document.visibilityState` and `visibilitychange` with `AppState` ('active'). Pause the 15 s refresh in the background and fetch immediately on resume.
  - Optionally use `expo-keep-awake` and raise screen brightness while the QR is shown (not in the web).
- **ID card PDF**: `id-card-pdf.ts` needs DOM canvas, `ctx.filter` blur, `Image` and `FileReader`, so it cannot run in RN. Options:
  - (a) Render the two card faces as RN views → `react-native-view-shot` → assemble with `pdf-lib`, which runs in RN given a base64 image, or with `expo-print` HTML → `printToFileAsync` → `expo-sharing`
  - (b) Add a server endpoint that builds the PDF (e.g. with node-canvas)

  Replace `Blob` + `URL.createObjectURL` + `<a download>` with `expo-file-system` write + `expo-sharing.shareAsync`. Keep the file name from `idCardFileName()`, which is pure.
- **Letters download**: `window.open(signedUrl)` → `expo-web-browser.openBrowserAsync(url)`, or `FileSystem.downloadAsync(url, cacheDir + name + '.pdf')` + `Sharing.shareAsync`. The signed URL lasts 300 s, so create it on tap.
  - Letter request `letter_url` links (`target=_blank`) → `Linking.openURL` or WebBrowser.
  - For a native PDF viewer, `react-native-pdf` needs a dev build. Otherwise use the share sheet or the in-app browser.
- **Clipboard** (dead Profile() only): `expo-clipboard` is already installed.
- **Hover-only affordances** (copy-on-hover, the `title` tooltips "Click to edit") have no RN analogue. Show a visible edit or request chevron on actionable fields.
- **Masked Reveal / Hide**: plain local state. Optionally gate it behind `expo-local-authentication`.
- **Modals and scrims** (ChangeModal, PhotoUploader, reject box): use RN `Modal` or bottom sheets, and add keyboard avoidance for the text inputs.
- **Tabs**: the 8 Profile360 tabs should be a horizontally scrolling segmented control or top tabs. The 296px rail stacks above the main content, as in the web ≤1040px layout.
- **Dates**: `toLocaleDateString('en-IN', …)` depends on Hermes Intl. Hermes supports it on recent RN, but verify the output format `05 Sep 2026`, or format manually.
- **Parity quirks to reproduce or consciously fix**, noted in context above:
  1. "Request an update" and "Fix" always open Spouse name.
  2. Self sees CTC and gross as Restricted.
  3. Recognition is company-wide.
  4. ChangeRequests is not refreshed after a new request.
  5. HR-role users cannot click-edit their own fields.
  6. The PDF's emergency contact, card number and valid-till are always empty.
  7. Letter requests have no duplicate guard on the web (the API route adds a 409).
  8. `rejection_reason` is hidden.
