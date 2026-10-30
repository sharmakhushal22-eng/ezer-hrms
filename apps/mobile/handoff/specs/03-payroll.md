# 03 — Payroll section (ESS) — functional spec for the React Native rebuild

Source of truth: `components/ess/EmployeePortal.tsx` (SECTIONS ~line 3174, render switch ~line 3990–4058) plus the component and route files cited under each screen. Everything below was read from source; nothing is inferred unless it is marked **(inferred)** or **(note)**.

---

## 0. Section shell

### 0.1 Nav definition (verbatim from `SECTIONS`)

```ts
{ k:'payroll', label:'Payroll', short:'Payroll', icon:'', status:'partial',
  desc:'Salary, benefits, tax declarations and claims',
  items:[
    { k:'payslip',     label:'Salary Slip',            phase:3, needs:'Payslip generation' },
    { k:'flexi',       label:'Flexi Benefits' },
    // 'declaration' (InvestmentDeclaration) is not listed. The nav entry was removed on request.
    { k:'proofs',      label:'Investment Proofs' },
    { k:'flexiclaims', label:'Flexi Claims' },
    { k:'vpf',         label:'Voluntary PF' },
    { k:'nps',         label:'Corporate NPS' },
    { k:'loans',       label:'Loans' },
    { k:'claims',      label:'Travel Claims' },
    { k:'statutory',   label:'Statutory',              phase:3, needs:'Payroll' },
  ]},
```

- **Order of sub-tabs:** Salary Slip, Flexi Benefits, Investment Proofs, Flexi Claims, Voluntary PF, Corporate NPS, Loans, Travel Claims, Statutory.
- **Rail group:** `'Time & pay'` → `['attendance','leave','payroll','expenses']`. Rail icon `IconPayroll`.
- **Mobile thumb bar:** `MOBILE_PRIMARY = ['home','payroll','attendance','leave']`, so Payroll is one of the four bottom-bar tabs on a phone.
- **Clicking the section** lands on the item you are already on if it belongs to this section. Otherwise it lands on the first item: `go(s.items.some(i => i.k === view) ? view : s.items[0].k)`. That first item is **Salary Slip** (a placeholder).
- **Page header (`TabHeader`):** the icon, then `<h1>Payroll</h1>`, then `<p>Salary, benefits, tax declarations and claims</p>`. There is no "Coming soon" chip, because status is `'partial'`, not `'soon'`.
- **Sub-tab row (`SubTabs`):** a segmented control with one button per item. An item that has `phase` (payslip, statutory) shows an extra `<span className="ess-seg-soon">Soon</span>` after its label. The selected tab gets `aria-selected` and `data-on="1"`.
- **Breadcrumb in the top bar:** `['Payroll', <item label>]`, for example "Payroll › Salary Slip".
- **Feature search:** items that have `needs` are **excluded** (payslip, statutory). The other items are searchable, with crumb `Payroll › <label>` and these keywords (`ESS_KEYWORDS`):
  - `flexi`: 'flexi benefits tax'
  - `declaration`: 'investment declaration 80c tax'
  - `proofs`: 'investment proofs tax'
  - `flexiclaims`: 'flexi claims bills reimbursement'
  - `vpf`: 'voluntary pf provident fund'
  - `nps`: 'corporate nps pension'
  - `loans`: 'loan advance'
  - `claims`: 'travel claims expense reimbursement'

  The search label is prefixed with `payroll` (the lowercased section label).

### 0.2 Permission gating

- The Payroll section is **not** filtered by `/api/ess/menu`. Only `company` and `reports` are filtered: `SECTIONS.filter(s => s.k === 'company' ? essMenu.can.company : s.k === 'reports' ? essMenu.can.reports : true)`.
- Every ESS employee therefore sees every Payroll sub-tab. No sub-tab has role, grade or regime gating in the nav.
- Gating inside individual screens is data-driven (regime, CTC presence, policy configured, window open, and so on). It is described under each screen.

### 0.3 Deep links (`lib/ess/routes.ts`)

- **Canonical path:** `/ess/<view>`. For example: `/ess/payslip`, `/ess/flexi`, `/ess/proofs`, `/ess/flexiclaims`, `/ess/vpf`, `/ess/nps`, `/ess/loans`, `/ess/claims`, `/ess/statutory`, and `/ess/declaration` (reachable only by link).
- **Legacy form:** `/ess?tab=<view>`. It is rewritten to the canonical form on arrival.
- **Collision:** `loans` (and `payroll`) are also admin module keys. The admin module form is `/ess/loans-admin` and `/ess/payroll-admin`, so `/ess/loans` always means the employee screen.
- **Special forward:** `/ess?tab=claims&ref=<id>` (with no `module`) is **forwarded whole** to the Travel & Expenses v2 page (`/ess/travel?tab=claims&ref=…`). That link is **not** the legacy Travel Claims tab. A notification link carrying `ref` therefore never opens the legacy `claims` sub-tab.
- `VIEW_KEYS` includes `payslip`, `statutory`, `declaration`, `flexi`, `proofs`, `flexiclaims`, `vpf`, `nps`, `loans` and `claims`.

### 0.4 Render switch (verbatim)

```tsx
case 'vpf':           return <VpfSection emp={emp} notify={notify} />
case 'nps':           return <NpsSection emp={emp} notify={notify} />
case 'loans':         return <LoansSection emp={emp} notify={notify} />
case 'flexi':         return <FlexiTdsCalculator employeeId={emp.id} empName={emp.full_name} empCode={emp.emp_code} />
case 'declaration':   return <InvestmentDeclaration employeeId={emp.id} empName={emp.full_name} empCode={emp.emp_code} />
case 'proofs':        return <InvestmentProofs employeeId={emp.id} />
case 'flexiclaims':   return <FlexiClaims employeeId={emp.id} />
case 'claims':        return <TravelClaims employeeId={emp.id} />
default:              return <Placeholder title={m.label} phase={m.phase || 4} needs={m.needs || '-'} />
```

- `payslip` and `statutory` have no case, so they fall through to `default` and render the **Placeholder**.
- FlexiTdsCalculator, FlexiClaims, InvestmentDeclaration, InvestmentProofs and TravelClaims are `next/dynamic` imports with `ssr:false`. While they load, `SectionLoading` shows: centred text "Loading…" in `C.muted`.
- **(note)** `EmployeePortal.tsx` line ~2947 also defines `function FlexiSection(...)`, a read-only flexi-policy viewer. It is **never rendered** (dead code). Do not port it.

### 0.5 Portal toast (`notify`) used by VPF, NPS and Loans

```ts
const notify = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }
```

- **Position:** fixed. On mobile it sits at bottom 88 (above the thumb bar); otherwise at bottom 24. It is right-aligned at 24 and uses `zIndex: Z.toast`.
- **Colour:** background `C.positive` for success and `C.critical` for error. Text is `C.onAccent`.
- **Shape:** radius 12, padding 12×18, 13px, weight 600.
- **Icon:** `IconCheck` (success) or `IconAlert` (error).
- **Lifetime:** 3 s.

FlexiTdsCalculator, InvestmentProofs, FlexiClaims and TravelClaims use their **own** inline messages or toasts. They do not use this one.

### 0.6 Auth reality for this section (important for RN)

| Screen | Transport | Auth header sent? | Server checks identity? |
|---|---|---|---|
| VPF, NPS, Loans, Loan agreement | `fetch('/api/ess/vpf' …)` etc. | **No header at all** | **No.** It trusts `employee_id` in the query or body. The service-role client (or anon fallback) is used. |
| Flexi Benefits (calculator) | Direct Supabase (anon key) | n/a | RLS "allow all" (inferred) |
| Investment Proofs | Direct Supabase + RPC | n/a | RLS |
| Flexi Claims | Direct Supabase + `/api/flexi/claims` (no header) + Storage | No | No (`/api/flexi/claims` trusts `employee_id`) |
| Travel Claims | `/api/travel/*` with `Authorization: Bearer <ESS token>` (fallback: Supabase session token) | **Yes** | **Yes** (`resolveActor`). Writes are `selfOnly`. |

- The ESS token lives in `localStorage['ezer_ess_session']` as JSON `{ employee_id, token, … }`.
- `essAuthHeaders()` returns `{ Authorization: 'Bearer <token>' }` only while the token's base64url payload `exp` (epoch ms) is more than 30 s in the future.
- **For RN:** send `Authorization: Bearer <token>` on **every** call, even where the server ignores it today. Keep passing `employee_id` exactly as the web does.

---

## 1. Salary Slip (`payslip`) → Placeholder

### 1.1 Placeholder component (verbatim behaviour)

```tsx
function Placeholder({ title }: { title: string; phase: number; needs: string }) {
  return (
    <div style={{ ...T.card, textAlign:'center', padding:'48px 24px' }}>
      <div style={{ width:56, height:56, borderRadius:16, margin:'0 auto 14px', display:'grid', placeItems:'center',
                    background:C.brandTint, color:C.brand, border:`1px solid ${C.brandEdge}` }}>
        <IconCalendar size={26} strokeWidth={1.7} />
      </div>
      <div style={{ fontSize:17, fontWeight:700 }}>{title} is coming soon</div>
      <div style={{ fontSize:13.5, color:C.muted, marginTop:6, lineHeight:1.6, maxWidth:420, marginInline:'auto' }}>
        We’re getting this ready for you. It will appear here as soon as your HR team switches it on.
      </div>
    </div>
  )
}
```

- **`T.card`:**

  ```ts
  { background:C.surface, borderRadius:R.lg, border:`1px solid ${C.line}`, padding:'14px 16px', marginBottom:S.md, boxShadow:E.raised }
  ```

  The padding is overridden to `48px 24px`.
- **What the screen shows:**
  - A 56×56 rounded tile (radius 16) with fill `brandTint`, a `brandEdge` border, and a calendar icon in `brand`.
  - The title **"Salary Slip is coming soon"** at 17px, bold.
  - The body text **"We’re getting this ready for you. It will appear here as soon as your HR team switches it on."** It uses a curly apostrophe (U+2019).
- `phase` and `needs` are **not displayed**.
- No network calls, no actions, no loading state.

### 1.2 `/api/ess/payslips`: exists, but is used nowhere

- Grep across `app/`, `components/`, `lib/` and `apps/mobile/src` finds **no caller**. The only reference is the route file itself.
- For parity, the RN Salary Slip tab is the Placeholder above.
- The route is documented here so a future payslip screen can use it.

`GET /api/ess/payslips?limit=<n>&month=YYYY-MM`:

- **Auth:** `essRoute(req)`, so an `Authorization: Bearer` token is required.
- **Scope:** the employee comes from the session. A legacy dashboard login needs `?employee_id=`. An ESS user with admin access may pass `?employee_id=` (audited "view as"). Otherwise the server returns 403 `"You can only open your own portal."`.
- **`limit`:** default 12, max 36.
- **`month`:** optional. When it matches `^\d{4}-\d{2}$`, results are filtered to that year and month.
- **Query:** `payslips` with these columns:

  ```
  id, payroll_month, payroll_year, net_pay, basic, hra, other_allowance, statutory_bonus,
  employee_pf, employee_esic, professional_tax, lwf, tds_monthly, loan_deduction, advance_deduction
  ```

  It filters `employee_id = me` and orders by `payroll_year` desc, then `payroll_month` desc.
- **Response:**

  ```json
  {
    "payslips": [{
      "id": "uuid",
      "payroll_month": 10, "payroll_year": 2026, "label": "October 2026",
      "earnings":   [{ "label": "Basic", "amount": 25000 }],
      "deductions": [{ "label": "Provident fund", "amount": 1800 }],
      "gross": 50000, "total_deductions": 4200,
      "net": 45800, "net_computed": 45800
    }],
    "diagnostics": { "noPayslips": false }
  }
  ```

  - **Earnings labels**, in this order (each shown only when it is non-zero): Basic, House rent allowance, Other allowances, Statutory bonus.
  - **Deductions labels**, in this order: Provident fund, ESIC, Professional tax, Labour welfare fund, Income tax, Loan recovery, Advance recovery.
  - `net` is payroll's `net_pay`, and it is the authoritative figure. `net_computed` is gross minus deductions.
- **Error:** 500 `{ error }`.

---

## 2. Statutory (`statutory`) → Placeholder

- This is the same Placeholder as section 1.
- The title is **"Statutory is coming soon"** and the body is identical.
- No data, no actions.

---

## 3. Flexi Benefits (`flexi`) → `components/ess/FlexiTdsCalculator.tsx` (1,033 lines)

**Props:** `{ employeeId: string; empName?: string; empCode?: string }`, passed from `emp.id`, `emp.full_name` and `emp.emp_code`.

**Purpose:** a 4-step wizard. The employee:
- plans a flexi-benefit declaration for both regimes,
- enters HRA, investments and other income,
- compares Old and New regime tax for FY 2026-27, and
- **submits a regime**, which is then locked.

The submission also writes the TDS declaration. The calculation is embedded in the component (not in `lib/`).

### 3.1 Constants (port verbatim; FY is hard-coded)

```ts
const FY = '2026-27'
const SLAB_LABELS = ['≤5 LPA','5.1–7.99 LPA','8–11.99 LPA','12–17.99 LPA','18–24.99 LPA','25–29.99 LPA','30–39.99 LPA','40–49.99 LPA','50+ LPA']
const OLD: Record<string, number>[] = [
  {},
  { pda: 18000, fuel: 60000, meal: 55000, attire: 40000, childEdu: 36000, hostel: 84000 },
  { pda: 24000, device: 50000, fuel: 96000, meal: 55000, attire: 48000, childEdu: 36000, hostel: 84000 },
  { pda: 30000, tel: 18000, device: 50000, fuel: 144000, meal: 55000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 36000, tel: 18000, device: 90000, lta: 1, car: 216000, driver: 144000, fuel: 144000, meal: 80000, attire: 60000, childEdu: 36000, hostel: 84000 },
  { pda: 48000, tel: 18000, device: 130000, lta: 1, car: 300000, driver: 192000, fuel: 160000, meal: 96000, attire: 78000, childEdu: 36000, hostel: 84000 },
  { pda: 54000, tel: 18000, device: 150000, lta: 1, car: 360000, driver: 240000, fuel: 192000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 420000, driver: 240000, fuel: 240000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
  { pda: 60000, tel: 18000, device: 200000, lta: 1, car: 600000, driver: 240000, fuel: 300000, meal: 96000, attire: 96000, childEdu: 36000, hostel: 84000 },
]
const NEW: Record<string, number>[] = [
  {}, {},
  { device: 50000, fuel: 96000, meal: 55000 },
  { tel: 18000, device: 50000, fuel: 144000, meal: 55000 },
  { tel: 18000, device: 90000, car: 216000, driver: 144000, fuel: 144000, meal: 80000 },
  { tel: 18000, device: 130000, car: 300000, driver: 192000, fuel: 160000, meal: 96000 },
  { tel: 18000, device: 150000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
  { tel: 18000, device: 200000, car: 360000, driver: 240000, fuel: 192000, meal: 96000 },
]
const COMPS = [
  { k:'pda', l:'Professional Dev. Allowance' }, { k:'tel', l:'Telephone / WiFi Bill' },
  { k:'device', l:'Device Leasing' }, { k:'lta', l:'Leave Travel Allowance' },
  { k:'car', l:'Car Lease', perq:true }, { k:'driver', l:'Driver Allowance', perq:true },
  { k:'fuel', l:'Fuel Reimbursement' }, { k:'meal', l:'Meal Coupon (Zaggle)' },
  { k:'attire', l:'Corporate Attire' }, { k:'childEdu', l:"Children's Education" }, { k:'hostel', l:'Hostel Allowance' },
]
const PERQ_ANN = (7000 + 3000) * 12   // 1,20,000
const MONTHS = ['April 2026','May 2026','June 2026','July 2026','August 2026','September 2026','October 2026','November 2026','December 2026','January 2027','February 2027','March 2027']  // option values 1..12
const R = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const N = (v) => parseFloat(v) || 0
```

### 3.2 Pure calculation functions (copy verbatim into a shared TS module; no dependencies)

```ts
const getSlab = (c: number) => { const l = c / 1e5; if (l <= 5) return 0; if (l <= 7.99) return 1; if (l <= 11.99) return 2; if (l <= 17.99) return 3; if (l <= 24.99) return 4; if (l <= 29.99) return 5; if (l <= 39.99) return 6; if (l <= 49.99) return 7; return 8 }   // c = ANNUAL CTC (not fixed)
const oldTax = (t: number) => { if (t <= 250000) return 0; if (t <= 500000) return (t - 250000) * .05; if (t <= 1000000) return 12500 + (t - 500000) * .2; return 112500 + (t - 1000000) * .3 }
const newTax = (t: number) => { if (t <= 400000) return 0; if (t <= 800000) return (t - 400000) * .05; if (t <= 1200000) return 20000 + (t - 800000) * .1; if (t <= 1600000) return 60000 + (t - 1200000) * .15; if (t <= 2000000) return 120000 + (t - 1600000) * .2; if (t <= 2400000) return 200000 + (t - 2000000) * .25; return 300000 + (t - 2400000) * .3 }
function finalize(base: number, inc: number, isNew: boolean) {
  const r = isNew ? (inc <= 1200000 ? base : 0) : (inc <= 500000 ? Math.min(base, 12500) : 0)   // 87A rebate
  const a = Math.max(0, base - r)
  const sc = inc > 5e7 ? (isNew ? .25 : .37) : inc > 2e7 ? .25 : inc > 1e7 ? .15 : inc > 5e6 ? .1 : 0  // surcharge, no marginal relief
  return Math.round((a + a * sc) * 1.04)   // 4% cess
}
function hraCalcPeriod(monthlyHRA: number, basic: number /*annual*/, rentM: number, fromM: number, toM: number, metro: boolean) {
  if (!rentM || fromM > toM) return 0
  const mo = toM - fromM + 1
  const hraP = monthlyHRA * mo, rentP = rentM * mo, basicP = (basic / 12) * mo
  return Math.min(hraP, Math.max(0, rentP - basicP * .1), basicP * (metro ? .5 : .4))
}
```

### 3.3 State

**Form fields (`f`).** All values are strings. Initial values:

```
ctc:'', variable:'', doj:'',
rentM:'', hra1From:'1', hra1To:'12', cityType:'nonmetro', landlordPAN:'',
showHra2:'', rentM2:'', hra2From:'7', hra2To:'12', cityType2:'nonmetro', landlordPAN2:'',
lic:'', ppf:'', elss:'', tuit:'', hlP:'',
medSelf:'', medParents:'', hlInt:'', hlLoanNo:'',
npsSelf:'0', emplrNpsOld:'0', emplrNpsNew:'0',
eduLoan:'', eduLoanNo:'', dep80dd:'0', dis80ddb:'', pmFund:'',
oi:'', bon:'', iinc:'', varEx:'', iInc:''
```

**Other state:**
- `oFlexi` and `nFlexi`: `Record<compKey, number>`, the chosen annual amount per component.
- `child`: `{ count: 0|1|2, c1:{school,hostel}, c2:{school,hostel} }`.
- `step`: 1–4.
- `chosenRegime`: `'OLD' | 'NEW' | null`.
- `status`: `'NEW' | 'DRAFT' | 'SUBMITTED'`.
- `editMode`: `null | 'flexi' | 'all'`.
- `userPicked`, `defaultedNew`, `defaultedByRule`, `saving`, `saved`, `draftMsg`.
- `real`: a `SalaryStructure` from `loadSalary`, where `rd = real?.detail`.

**Read/write gates.** Once submitted, everything locks. **Edit** then unlocks Old → flexi + investments, or New → flexi only. The regime itself never changes after submission.

```ts
isSubmitted = status==='SUBMITTED'
flexiRW  = !isSubmitted || editMode==='flexi' || editMode==='all'   // step 2 editable
investRW = !isSubmitted || editMode==='all'                         // step 3 editable
basicRW  = !isSubmitted || editMode==='all'                         // step 1 editable
regimeLocked = isSubmitted
viewLocked = isSubmitted && !editMode
```

- Steps 1–3 are wrapped in `<fieldset disabled={!xxxRW}>`, so every input inside becomes non-editable.
- The step navigation buttons sit outside the fieldsets. A locked employee can still page through all the steps.

### 3.4 On mount: direct Supabase reads (verbatim)

The four reads run in parallel:

```ts
supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1)
supabase.from('employees').select('company_id, company_doj, group_doj, tds_regime').eq('id', employeeId).maybeSingle()
supabase.from('tds_declarations').select('regime, declaration_status').eq('employee_id', employeeId).eq('fy', '2026-27').maybeSingle()   // errors swallowed → {data:null}
supabase.from('flexi_tds_forms').select('regime, status, form_data').eq('employee_id', employeeId).eq('fy', '2026-27').maybeSingle()     // errors swallowed
```

Then the following logic runs in order:
1. `companyId = emp.company_id`. `doj = emp.company_doj || emp.group_doj`.
2. **If a saved form exists (`flexi_tds_forms.form_data`):**
   - Restore `f` (merged), `oFlexi`, `nFlexi` and `child` from `form_data`.
   - If `regime` is set, set `chosenRegime = norm(regime)` and `userPicked = true`. `norm` returns NEW if the uppercased string includes 'NEW', otherwise OLD.
   - Set `status` to SUBMITTED if `form.status === 'SUBMITTED'`, otherwise DRAFT. A submitted form also sets `saved = true`.
   - Backfill blank `ctc`, `variable` and `doj`: `ctc = String(Math.round(cm.annual_ctc||0))`, `variable = String(Math.round(cm.annual_variable||0))`, `doj = doj.slice(0,10)`. **Stop here.**
3. **Otherwise (no saved form):**
   - Prefill ctc, variable and doj the same way.
   - If `decl.declaration_status==='SUBMITTED' && decl.regime`, set `chosenRegime = norm(decl.regime)` and `userPicked = true`, then stop.
   - If `decl.declaration_status==='DEFAULTED'`, set `defaultedByRule = decl.updated_at || decl.created_at || 'the 5th'`. **(note)** `updated_at` and `created_at` are not selected, so the value is always `'the 5th'`, and the date suffix in the banner never renders.
   - If `emp.tds_regime` is set, use `chosenRegime = norm(...)` and `userPicked = true`, then stop.
   - If `doj` falls after 1 Apr 2026 and on or before 31 Mar 2027 (UTC), set `chosenRegime = 'NEW'` and `defaultedNew = true`.
4. **In parallel:** `loadSalary(employeeId)` from `lib/employees/hr-actions.ts`, which sets `real`. This import chain pulls in `@/lib/supabase`, so the RN app re-implements it. `loadSalary`:
   - reads `onboarding_candidates (candidate_id, offered_ctc)` by `employee_id`, latest first. If found, it reads `ctc_negotiations *` by `candidate_id`, latest first, and returns **no `detail`**, so `rd` is null.
   - Otherwise it calls `loadSalaryFromMaster`. That reads `employees (employment_type, intern_pay, consultant_pay, contract_pay)`, `ctc_master *` (order `effective_from` desc) and `salary_structures *` (order `effective_date` desc), and builds `detail: SalaryBreakup`:

     ```
     { payType, basic, hra, statBonus, conveyance, special, gross, specialGross, flexiMonthly,
       erPf, erEsic, gratuity, eePf, eeEsic, pt, lwf, net, fixedMonthly, variableAnnual,
       annualCtc, totalCtc, simpleKind?, stipend?, gst?, tds? }
     ```

     Port the field derivation verbatim from `lib/employees/hr-actions.ts` lines 106–200.
5. **Auto-select:** whenever `recRegime` (the lower-tax regime) changes, the screen sets `chosenRegime = recRegime`, unless the user has already picked a regime or the form is submitted.

### 3.5 Derived salary (`sal`)

```ts
ctc = N(f.ctc); vari = N(f.variable); fixed = ctc - vari
if (rd) { basic = rd.basic*12; hra = rd.hra*12; epf = rd.erPf*12; other = Math.round((rd.specialGross || rd.special)*12); lta8 = Math.round(basic*.0833) }
else    { basic = fixed*.5; hra = basic*.5; epf = Math.min((basic/12)*.12, 1800)*12; lta8 = Math.round(basic*.0833); other = Math.max(0, fixed - basic - hra - epf) }
si = getSlab(ctc)
```

`other` is the **annual flexi wallet budget**.

### 3.6 Joining pro-ration (`join`)

```ts
full = { pr:1, months:12, mid:false }
if no doj / unparseable → full
doj = Date.UTC(y, mo-1, day); fyStart = Date.UTC(2026,3,1); fyEnd = Date.UTC(2027,2,31)
if (doj <= fyStart || doj > fyEnd) → full
totalDays = round((fyEnd-fyStart)/864e5)+1; workedDays = round((fyEnd-doj)/864e5)+1
fyMonth = mo>=4 ? mo-3 : mo+9
→ { pr: min(1, workedDays/totalDays), months: max(1, 13 - fyMonth), mid: true }
```

### 3.7 Flexi limits

```ts
schoolCount = (count>=1 && c1.school ?1:0) + (count>=2 && c2.school ?1:0)
hostelCount = (count>=1 && c1.hostel ?1:0) + (count>=2 && c2.hostel ?1:0)
getOldLimit(k): b = OLD[si]; 'lta' → b.lta ? sal.lta8 : 0; 'childEdu' → schoolCount>0 ? b.childEdu*schoolCount : 0; 'hostel' → hostelCount>0 ? b.hostel*hostelCount : 0; else b[k]||0
getNewLimit(k): NEW[si][k] || 0
setFlexi(rg,k,v): sets k=v; if k==='car' → driver = v>0 ? limit('driver') : 0; if k==='driver' → car = v>0 ? limit('car') : 0   // Car and Driver always move together
oTot = sum(oFlexi), nTot = sum(nFlexi)
```

### 3.8 HRA exemption

```ts
hraExempt = !sal.basic ? 0 :
  hraCalcPeriod(sal.hra/12, sal.basic, N(f.rentM), +f.hra1From, +f.hra1To, f.cityType==='metro')
  + (f.showHra2 ? hraCalcPeriod(sal.hra/12, sal.basic, N(f.rentM2), +f.hra2From, +f.hra2To, f.cityType2==='metro') : 0)
```

This is period-based and is **not** multiplied by `pr`.

### 3.9 Tax computation `T` (null when `!sal.ctc`)

```ts
pr = join.pr; months = join.months
eBasic=basic*pr; eHra=hra*pr; eEpf=epf*pr; eOther=other*pr; eVari=vari*pr; earnedCtc=ctc*pr
hE = hraExempt
c80 = min(N(lic)+N(ppf)+N(elss)+eEpf+N(tuit)+N(hlP), 150000)
medS = min(N(medSelf),25000); medP = min(N(medParents),50000); hlI = min(N(hlInt),200000)
npsS = N(npsSelf)
eNpsO = emplrNpsOld==='on' ? round(eBasic*.1) : 0
eNpsN = emplrNpsNew==='on' ? round(eBasic*.14) : 0
eduLoan = min(N(eduLoan),200000); dep80dd = N(dep80dd); dis80ddb = min(N(dis80ddb),100000); pmFund = min(N(pmFund),200000)
addI = N(oi)+N(bon)+N(iinc)+N(varEx)+N(iInc)
oClaim = round(oTot*pr); nClaim = round(nTot*pr); ltaAmt = round((oFlexi.lta||0)*pr)
oPerq = oFlexi.car>0 ? round(PERQ_ANN*pr) : 0;  nPerq = nFlexi.car>0 ? round(PERQ_ANN*pr) : 0
walBalO = max(0, eOther-oClaim); walBalN = max(0, eOther-nClaim)
grossO = eBasic + (eHra-hE) + walBalO + eVari + addI + oPerq          // display only
grossN = eBasic + eHra + walBalN + eVari + addI + nPerq               // display only
extraOldDed = eduLoan + dep80dd + dis80ddb + pmFund
gO = earnedCtc + addI + oPerq
dO = 50000 + hE + ltaAmt + oClaim + c80 + medS + medP + hlI + npsS + eNpsO + eEpf + extraOldDed
tO = max(0, gO-dO); bO = oldTax(tO); fO = finalize(bO, tO, false)
gN = earnedCtc + addI + nPerq
dN = 75000 + nClaim + eNpsN + eEpf
tN = max(0, gN-dN); bN = newTax(tN); fN = finalize(bN, tN, true)
denom = earnedCtc || ctc
moO = round(fO/months); efO = (fO/denom*100).toFixed(2); moN, efN likewise
recRegime = fO <= fN ? 'OLD' : 'NEW'
```

**(note)** `eEpf` is counted both inside `c80` and as a separate deduction. This is ported as implemented, not corrected.

### 3.10 Layout: header (always shown)

- **Title:** "Flexi & TDS Calculator" (17px/700, `C.ink`).
- **Subtitle:** "Plan your flexi benefit declaration and compare Old vs New tax regime · FY 2026-27" (12px muted).
- **Save Draft button:** shown at top-right when not submitted (ghost style).
- **`draftMsg` banner (when non-empty):** text in green on `positiveTint`. **(note)** The code checks `draftMsg.startsWith('')`, which is always true, so the banner actually renders in the red/critical colours (`C.critical` text, `criticalTint` background, `critical` border) for both success and error. The intent was red only for messages that start with "⚠".
- **`defaultedByRule` banner (when not submitted):** amber, with the text **"New Regime applied by default**: no regime was chosen by the 4th of the month. Payroll is taxing you on the New Regime. You can still submit your own choice here; submitting replaces the default." (The date suffix never renders; see 3.4.)
- **`viewLocked` banner:** brandTint, with the text "This declaration is submitted & locked. Go to **Step 4** and press **Edit** to change {OLD ? 'flexi or investments' : 'your flexi'}."
- **Stepper:** `['Employee & Salary','Flexi Declaration','Investments','TDS Report']`, shown as pills with connector bars.
  - Active pill: brand fill, numbered circle.
  - Done pill: brandTint fill, and the circle shows an empty string (the check glyph was stripped).
  - A pill is clickable only when `n <= step`.

**Bottom navigation buttons:**
- Step 1: "Next: Flexi Declaration →". Shown only when `sal.ctc > 0`.
- Step 2: "Back" | "Next: Investments →".
- Step 3: "Back" | "Calculate TDS →".
- Step 4: has its own "Back" button, which goes to step 3.

### 3.11 Step 1: Employee & Salary

**Card "Employee Information"**, with the subtitle "Prefilled from your record. Adjust CTC / variable if needed." The fields sit in a 2-column grid:

| Label | Input |
|---|---|
| Employee Name | read-only, `empName` |
| Employee Code | read-only, `empCode` |
| Annual CTC (₹) | number, `f.ctc`, placeholder "e.g. 1500000" |
| Date of Joining | date, `f.doj` |
| Annual Variable Pay (₹) | number, `f.variable`, placeholder "0 if none" |

**Card "Your Salary Structure" (only when `rd`):**
- **Header badges:**
  - "✓ as per your record" (positiveTint / positive).
  - `rd.payType` as a brandTint badge, when it is set and not `'Regular'`.
- **3 tiles:**
  - "Annual CTC" = `rd.totalCtc || rd.annualCtc` (brand, on canvas).
  - "Net Take-home / mo" = `rd.net` (positive).
  - "Fixed / mo" = `rd.fixedMonthly`.
- **Table** with a dark header (`TK.dark` background, `TK.onDark` text): COMPONENT | MONTHLY | ANNUAL. Annual = monthly × 12. Rows in this order:
  1. Basic
  2. HRA
  3. Statutory Bonus (if > 0)
  4. Conveyance (if > 0)
  5. Special Allowance (if > 0)
  6. Flexi (declared) (`flexiMonthly`, if > 0)
  7. **Gross** (sub)
  8. Employer PF (if > 0)
  9. Employer ESIC (if > 0)
  10. Gratuity (if > 0)
  11. A "DEDUCTIONS" band (criticalTint), shown if any employee deduction > 0
  12. Employee PF, Employee ESIC, Professional Tax, LWF (each if > 0)
  13. **Net Take-home** (net style: positiveTint / positive)
  14. **Fixed** (sub)
  15. Variable (`round(variableAnnual/12)`, if > 0)
  16. **Total CTC** (`round(totalCtc/12)`, total style: canvas / brand)

  Row styles: total → canvas background and brand text; net → positiveTint background and positive text; sub → sunken background; all three are bold.
- **Footnote (faint, 10px):** "FY 2026-27 salary structure: the same figures shown in your HR record. Monthly amounts are pro-rated on actual paid days during payroll."

**Card "Flexi Wallet Basis" (when `rd`) or "Salary Breakup" (otherwise), shown when `sal.ctc > 0`:**
- Badge "Slab: {SLAB_LABELS[si]}".
- **Brand gradient box:**
  - Label "Flexi Wallet (funded by Special Allowance)" when `rd`, otherwise "(Other Reimbursement)".
  - With `rd`: `R(rd.specialGross||rd.special)` "per month" | `R(sal.other)` "per year". Then: "Your full Special Allowance: ₹X/month." If `flexiMonthly > 0`, it adds "₹Y/month already declared, ₹Z left."
  - Without `rd`: `R(sal.other)` and "Fixed − Basic − HRA − PF".
- **Amber note:**
  - With `rd`: "**Source:** full Special Allowance **₹X/month** × 12 = **₹Y annual wallet**. Declared flexi is deducted from the Special Allowance paid as salary."
  - Without `rd`: "**Formula:** ₹fixed − ₹basic (Basic) − ₹hra (HRA) − ₹epf (PF) = **Flexi Wallet ₹other**".

**Joining date note:**
- If `join.mid`, an info card appears with the title "Mid-year joining: pro-rata applies" and the text: "You are with the company for **N month(s)** of FY 2026-27, so your salary income is earned for ≈**P%** of the year. Tax is computed on this pro-rated income and the **monthly TDS is spread over the N remaining pay month(s)**. (Employees who joined on/before 1 Apr 2026 are taxed on the full 12 months.)"
- Otherwise, if a DOJ is set, a muted line reads: "Joined on/before 1 Apr 2026: taxed on the full financial year."

### 3.12 Step 2: Flexi Declaration

**Perquisite card.** When car is selected in either regime, an amber card appears with the title "Car Lease + Driver: Perquisite Tax Applied" and 3 tiles:
- "Car Lease Perq", "₹7,000", "per month"
- "Driver Perq", "₹3,000", "per month"
- "Total Perquisite", "₹10,000", "₹1,20,000/yr → taxable"

The footnote reads "Car lease is tax-exempt; Car + Driver are always selected together."

**Card "👨‍👩‍👧 Children Details (Old Regime only)":**
- Subtitle: "Affects Children's Education & Hostel Allowance limits".
- "Number of Children" select: "0 children", "1 child", "2 children (max)".
- Per child (Child 1, Child 2): the checkboxes "Going to school?" and "Staying in hostel?".

**Two WalletBars:** "Old Regime Wallet" (`used = oTot`) and "New Regime Wallet" (`used = nTot`).
- Budget = `sal.other`.
- Over = `used > bud + 1`.
- Colour: over → critical; above 80% → warning; Old wallet → warning; New → positive.
- Right-hand text: "EXCEEDED!" when over, otherwise "₹X left".
- Bar fill = `min(used/bud*100, 100)`.
- Footer: "Used: ₹X" | "Budget: ₹Y".
- When over, the box shows "Flexi wallet limit exceeded. Remove some allowances."
- **(note)** There is no hard block on exceeding the wallet anywhere, including at submit.

**Component table** (ink header): Component | Old Regime | New Regime.
- One row per COMPS item. Perq rows have a warningTint background and a badge "Perquisite Tax".
- Each cell is a select with two options, ₹0 and `R(limit)`, when the limit is greater than 0. Otherwise the cell shows "Not eligible".
- Footer row "Total Selected": the Old total turns red when over the wallet, otherwise warning; the New total turns red when over, otherwise positive.

### 3.13 Step 3: Investments (two columns)

**Old Regime Declaration** (left border `#C05621`, title in critical):
- Subtitle: "Std Deduction ₹50,000 | 80C max ₹1,50,000".
- **HRA box** (if `sal.hra > 0`): "Your HRA: Annual ₹X · Monthly ₹Y". The button "Apply suggested rent →" sets `rentM = round(hra/12)`, `hra1From = '1'` and `hra1To = '12'`.
- **Section "HRA Exemption (Old Regime only)" → "Period 1: Rent Paid":**
  - From Month and To Month (MONTHS selects).
  - "Monthly Rent Paid (₹)".
  - City Type: "Non-Metro (40% of Basic)" / "Metro (50% of Basic)".
  - "Landlord PAN (required if annual rent > ₹1,00,000)", uppercased, placeholder "ABCDE1234F". It is **not validated**.
- **Checkbox** "Changed residence mid-year? Add second HRA period". It sets `showHra2 = 'y'` or `''`, which reveals Period 2: From and To, rent, and City Type ("Non-Metro (40%)" / "Metro (50%)"). `landlordPAN2` exists in state but **has no input**.
- When `rentM > 0`: "Total HRA Exempt: **₹X**".
- **Section "Section 80C (Max ₹1,50,000)":**
  - A row "Employee PF (auto)" showing `R(sal.epf)`.
  - Inputs: LIC Premium, PPF, ELSS / Mutual Funds, Tuition Fees, Home Loan Principal.
  - A total row "Total 80C ₹X / ₹1,50,000", green when at or above 1.5 L, otherwise amber. Here `c80Total = min(lic+ppf+elss+sal.epf+tuit+hlP, 150000)`, which uses the **un-pro-rated** `sal.epf`.
- **Section "80D, Home Loan & NPS":**
  - "80D Self + Family (max ₹25,000)"
  - "80D Parents (max ₹50,000)"
  - "Home Loan Interest Sec 24(b) (max ₹2,00,000)"
  - "NPS Self 80CCD(1B) (max ₹50,000)" select: "0" → "₹0: Not investing"; "50000" → "₹50,000: Max benefit"
  - "Employer NPS 80CCD(2): 10% of Basic (fully exempt)" select: "0" → "₹0: Not applicable"; "on" → "₹{round(basic*.1)} (Basic × 10%)"
- **Section "Other Deductions (80E · 80DD · 80DDB · 80G)":**
  - "80E: Education Loan Interest (max ₹2,00,000)"
  - "80DD: Dependent Disability (fixed)" select: "0" → "₹0: Not applicable"; "75000" → "₹75,000: 40–80% (Normal)"; "125000" → "₹1,25,000: 80%+ Severe"
  - "80DDB: Specified Disease (max ₹1,00,000)"
  - "80G: PM Relief / PM CARES (100%, max ₹2,00,000)"
- Number inputs use placeholder "0". `hlLoanNo` and `eduLoanNo` exist in state but have no input.

**New Regime Declaration** (left border positive):
- Subtitle: "Std Deduction ₹75,000 | No HRA / 80C / 80D".
- A green box: "Standard Deduction (auto) ₹75,000", and below it "HRA · LTA · 80C · 80D · Home Loan: Not applicable".
- "Employer NPS 80CCD(2): 14% of Basic (fully exempt)" select: "0" / "on" → "₹{round(basic*.14)} (Basic × 14%)".
- **Section "Additional Income (FY 2026-27)":** Other Income (rental, freelance); Bonus / Commission; Incentive / Award; Variable Pay Expected (rest of year); Interest Income (FD / Savings).
- "Total Additional Income ₹X".
- **(note)** Additional income feeds both regimes.

### 3.14 Step 4: TDS Report

If `!T`, the step shows a card "Complete Steps 1–3 first." Otherwise it shows, in order:

**1. Recommendation hero.**
- Gradient: OLD `linear-gradient(135deg,#B45309,#C2410C)`; NEW `linear-gradient(135deg,#059669,#047857)`.
- Text: "Recommended: {Old|New} Regime", then "You save **₹|fO−fN|** annually".
- Right side: the annual tax of the recommended regime, then "Annual Tax · Monthly TDS ₹X".

**2. Card "Save & Submit: Tax Regime".**
- **Status chips:**
  - "Submitted & locked" (green), when submitted and not editing.
  - "Editing {flexi + investments | flexi only}" (amber), while in edit mode.
  - "Draft saved" (info), when the status is DRAFT.
- **Pre-select note** (when the user has not picked, the form is not submitted, and `recRegime` exists): "We've pre-selected the **{Old|New} Regime**. It gives you the **lower annual tax**. You can change it below before submitting."
- **Locked note:** "You submitted the **X Regime**. Your regime is locked." Then, for Old: "Use Edit to change your flexi & investment declarations." For New: "Use Edit to change your flexi declaration (investment sections don’t apply to the New Regime)."
- **Two regime radio buttons**, OLD and NEW:
  - Each shows "Old Regime" or "New Regime", plus a "Recommended" badge on the recommended one.
  - Below that: "Annual tax **₹X** · Monthly TDS **₹Y**".
  - Clicking one (when not locked) sets `chosenRegime`, `userPicked = true` and `saved = false`.
  - When locked, the unselected button drops to opacity 0.45.
- **Buttons:**
  - When not submitted, or while editing: the primary button "Submit {chosenRegime} declaration", or "Save & re-submit" while editing, or "Saving…" while saving. It is disabled when there is no regime or a save is in progress, and then shows at opacity 0.6. It calls `submitRegime()`.
  - When not submitted: "Save Draft" (ghost) → `saveDraft()`.
  - When submitted and not editing: "Edit flexi & investments" (Old) or "Edit flexi" (New). It sets `editMode = 'all'` or `'flexi'`.
  - When submitted and not editing: "⬇ Download PDF" → `downloadDeclarationPdf()`, and "⬇ Excel" → `downloadDeclaration()`.
  - While editing: "Cancel edit". It sets `editMode = null` and `status = 'SUBMITTED'`. It does **not** revert in-memory changes.

**3. Mid-year note** (if `T.mid`): "📅 **Pro-rated for mid-year joining:** salary income taxed for **N of 12 months** (≈P%). Annual tax above is spread over the **N remaining pay month(s)**Monthly TDS = Annual Tax ÷ N. Standard deduction & your actual investment declarations are counted in full." (The missing space before "Monthly" is in the source.)

**4. Eight metric tiles:**

| Label | Value | Subtitle |
|---|---|---|
| Annual CTC | `R(ctc)` | slab label |
| Earned Salary (if mid) / Flexi Wallet | `R(ctc*pr)` / `R(other)` | `"N mo · P%"` / "Other Reimb." |
| Old Regime Tax | `R(fO)` | "Eff x%" |
| New Regime Tax | `R(fN)` | "Eff x%" |
| HRA Exemption | `R(hE)` | "Old only" / "No rent" |
| Tax Savings | `R(save)` | "{rec} wins" |
| Monthly TDS | recommended regime's monthly TDS | "Recommended" |
| Best Regime | rec | "For you" |

**5. Two regime cards** (Old has border `#C05621`; New has border positive; the recommended one gets a 2px brand ring):
- Title: "Old Regime" or "New Regime", plus a "Recommended" badge where it applies.
- The big tax figure, then "Effective x% · Monthly TDS ₹Y".
- Rows: Gross Income (`gO`/`gN`), (–) Deductions (`dO`/`dN`), = Net Taxable (`tO`/`tN`), Annual Tax, Monthly TDS.

**6. Table "Taxable Income Breakup (Component-wise)".** Subtitle: "What is taxable, what is exempt, and how TDS is computed". Columns: Component | Old (₹) | New (₹). Rows:
- **INCOME section header.** When mid-year: "📌 INCOME (N months · pro-rated P%)".
  - Basic Salary (100% taxable)
  - "HRA Received (₹eHra)" (blank values)
  - "✓ HRA Exemption" `(hE)` / N/A (if hE > 0)
  - "= Net Taxable HRA"
  - "Flexi Wallet: Total ₹eOther"
  - "✓ Flexi Claimed (exempt on bills)" (if any)
  - "= Wallet Balance (taxable)"
  - Variable Pay (if > 0)
  - Additional Income (if > 0)
  - "Car+Driver Perquisite (₹10,000/mo)" "+₹X" (if any)
  - **Gross Taxable Income** (`grossO`/`grossN`, warningTint / critical)
- **DEDUCTIONS section header.**
  - Standard Deduction "(₹50,000)" / "(₹75,000)"
  - Leave Travel Allowance
  - 80C: EPF + Investments
  - 80D Self + Family
  - 80D Parents
  - Home Loan Interest 24(b)
  - 80DD
  - 80DDB
  - 80G: PM Relief Fund
  - 80E: Education Loan
  - NPS Self 80CCD(1B)
  - Employer NPS 80CCD(2)

  Each deduction row is shown only if it is greater than 0. Old shows "(₹x)"; New shows "N/A" except Employer NPS. Then **Net Taxable Income** (brandTint).
- **TAX section header.**
  - Tax on income (slab) `bO`/`bN`
  - "Rebate u/s 87A": Old shows `(min(bO,12500))` if `tO <= 5 L`, else "-"; New shows `(bN)` if `tN <= 12 L`, else "-"
  - "Add: 4% Health & Edu Cess" = `round(f/1.04*.04)`
  - **TOTAL ANNUAL TAX** (ink background, surface text)
  - **MONTHLY TDS (÷months)**

  Exempt rows have a positiveTint background and positive text. Labels are rendered as HTML (`&nbsp;` indents).

**7. Amber card "Important Disclaimer":** "This is an **estimate** for comparison & investment planning only. Actual TDS may vary with final proofs, payroll processing, mid-year changes or tax-law amendments. Please confirm with your HR / Finance team and file your full investment declaration on the HRMS portal for accurate TDS. Not tax or financial advice. FY 2026-27 (AY 2027-28)."

**8.** "Back" button.

### 3.15 Writes (verbatim)

**Save Draft** (`persistForm('DRAFT')`):

```ts
supabase.from('flexi_tds_forms').upsert({
  employee_id, company_id: companyId, fy: '2026-27', regime: chosenRegime, status: 'DRAFT',
  form_data: { f, oFlexi, nFlexi, child }, submitted_at: null, updated_at: new Date().toISOString(),
}, { onConflict: 'employee_id,fy' })
```

- **Success:** `status = 'DRAFT'`, and `draftMsg` = **"Draft saved. You can leave and return anytime"** for 3.5 s.
- **Error:** `draftMsg = '⚠ ' + error.message`, which persists until the next action.
- While saving, the buttons are disabled.

**Submit** (`submitRegime()`): requires `chosenRegime` and `T`.

1. **Confirm dialog.** `window.confirm(msg)`, where `msg` is:

   ```
   [if emplrNpsOld==='on' || emplrNpsNew==='on':] "You have chosen Employer NPS that will reduce your in-hand.\n\n" +
   "Are you sure you want to select the {Old|New} Regime?\n\nYour regime will be locked after submission and your declaration will be downloaded."
   + "\n\nYes → submit & download   ·   No → go back and choose"
   ```

   Cancel aborts the submit.
2. `supabase.from('employees').update({ tds_regime: chosenRegime }).eq('id', employeeId)`. This error is the **only** one that is checked.
3. `persistForm('SUBMITTED')`. This is the same upsert, with `status 'SUBMITTED'` and `submitted_at` set to now. Errors are ignored.
4. The structured TDS declaration (errors ignored):

   ```ts
   supabase.from('tds_declarations').upsert({
     employee_id, company_id: companyId, fy: '2026-27', regime: chosenRegime,
     sec_80c: T.c80, sec_80d: T.medS + T.medP, sec_80e: T.eduLoan, sec_24b: T.hlI,
     hra_claimed: T.hE, lta_claimed: T.ltaAmt, nps_80ccd1b: T.npsS,
     employer_nps_80ccd2: isOld ? T.eNpsO : T.eNpsN,
     total_declared: T.c80 + T.medS + T.medP + T.hlI + T.eduLoan + T.npsS,
     annual_tax_old: T.fO, annual_tax_new: T.fN, monthly_tds: isOld ? T.moO : T.moN,
     monthly_rent: N(f.rentM), is_metro: f.cityType === 'metro',
     landlord_pan: f.landlordPAN ? String(f.landlordPAN).toUpperCase() : null,
     sec_80d_self: T.medS, sec_80d_parents: T.medP,
     declaration_status: 'SUBMITTED', submitted_at: new Date().toISOString(),
   }, { onConflict: 'employee_id,fy' })
   ```

5. The itemised lines (errors ignored):

   ```ts
   const lines = [['80C_LIC',N(f.lic)],['80C_PPF',N(f.ppf)],['80C_ELSS',N(f.elss)],['80C_TUITION',N(f.tuit)],
     ['80C_PRINCIPAL',N(f.hlP)],['80CCC',N(f.pmFund)],['80CCD_1B',N(f.npsSelf)],
     ['80D_SELF',N(f.medSelf)],['80D_PARENTS',N(f.medParents)],['80E',N(f.eduLoan)],['24B_SELF',N(f.hlInt)]]
   supabase.from('investment_declaration_lines').upsert(
     lines.map(([section_code, declared_amount]) => ({ employee_id, fy:'2026-27', section_code, declared_amount, source:'calculator', updated_at: now })),
     { onConflict: 'employee_id,fy,section_code' })
   ```

   **(note)** `pmFund` (80G) is written under the code `80CCC`. This is ported as implemented.
6. **If the employees update failed:** `alert('Could not save your regime: ' + error.message)`, then return.
7. **Otherwise:** `saved = true`, `defaultedNew = false`, `status = 'SUBMITTED'`, `editMode = null`, then `downloadDeclarationPdf()` runs automatically.

### 3.16 Downloads

- **Excel (`downloadDeclaration`)** builds a workbook with `xlsx` and calls `XLSX.writeFile(wb, 'EZER_Flexi_TDS_Declaration_${empCode||'employee'}.xlsx')`. It has four sheets:
  - **"Summary":** rows ['EZER HRMS: Flexi & TDS Declaration'], Financial Year 'FY 2026-27 (AY 2027-28)', Employee 'name (code)', Submitted On (now, en-IN), Chosen Regime 'OLD Regime'/'NEW Regime', a blank row, then SALARY: Annual CTC, Variable Pay (annual), Fixed Salary (annual), Basic (monthly), HRA (monthly), Employer PF (annual), Flexi Wallet (monthly) (**note:** this value is `sal.other`, which is annual), Salary Slab, and 'Months in FY (worked)' = `"N of 12 (P%)"`.
  - **"Flexi Declaration":** ['Component','Old Regime (₹/yr)','New Regime (₹/yr)'], then the non-zero components, then TOTAL.
  - **"Investments":** ['Deduction / Investment','Amount (₹)','Applies to'], with rows:
    - Monthly Rent Declared
    - HRA Exemption
    - 80C: LIC / PPF / ELSS / Mutual Funds / Tuition Fees / Home Loan Principal / Employee PF (auto)
    - 80C Total (capped ₹1.5L)
    - 80D: Self + Family
    - 80D: Parents
    - Home Loan Interest 24(b)
    - NPS Self 80CCD(1B)
    - Employer NPS 80CCD(2) (Both)
    - 80E, 80DD, 80DDB, 80G
    - Additional Income (Both)

    All rows are tagged 'Old' unless marked.
  - **"TDS Report":** ['', 'Old Regime', 'New Regime'], then Gross Taxable Income (`grossO`/`grossN`), Total Deductions, Net Taxable Income, Annual Tax, Monthly TDS, Effective Rate %, a blank row, Recommended Regime, Your Chosen Regime, Annual Tax Saving (best) and Payable Monthly TDS (chosen).
- **PDF (`downloadDeclarationPdf`)** builds an HTML string and opens it with `window.open('', '_blank')` + `document.write(html)`. The page runs `window.print()` after 250 ms, so the user uses "Save as PDF".
  - Contents: EZER HRMS brand header, "FLEXI & TDS / DECLARATION · FY 2026-27", the Employee and Submitted On rows, and a Chosen Regime badge (OLD warning / NEW positive).
  - Sections:
    - **Salary:** CTC, Variable, Fixed, Basic (monthly), HRA (monthly), Flexi Wallet (monthly), Slab, Months.
    - **Flexi Declaration (annual):** the table plus a Total row, or "None declared".
    - **Investments & Deductions:** the non-zero rows from HRA Exemption, 80C (capped ₹1.5L), 80D Self+Family, 80D Parents, Home Loan Interest 24(b), NPS Self 80CCD(1B), Employer NPS 80CCD(2), 80E Education Loan, 80DD Dependent Disability, 80DDB Disease, 80G Donations and Additional Income.
    - **TDS Report:** Gross Taxable, Deductions, Net Taxable, Annual Tax, Monthly TDS.
  - The summary line reads "**Recommended:** X Regime (lower tax) · **Your choice:** Y · **Payable Monthly TDS:** ₹Z".
  - Footnote: "System-generated declaration for FY 2026-27 (AY 2027-28). Figures are estimates for planning; actual TDS may vary with final proofs and payroll processing. Not tax advice."
  - The template uses hard-coded hex colours: `#1E1B4B`, `#2563EB`, `#F5F3FF`, and so on.
- **RN:** generate the HTML, then use `expo-print` (`printToFileAsync`) and `expo-sharing`. For the Excel file, the `xlsx` library works in RN (write base64 → `expo-file-system` → share).

---

## 4. Investment Proofs (`proofs`) → `components/ess/InvestmentProofs.tsx` (233 lines)

**Props:** `{ employeeId }`. `FY = '2026-27'`.

**Purpose:** prove each declared (Old-regime) investment line by entering the proof amount and a text reference. HR approves or rejects. There is **no file upload** on this screen.

### 4.1 Load (direct Supabase, in sequence)

```ts
supabase.from('employees').select('date_of_leaving, last_working_date, relieving_date').eq('id', employeeId).maybeSingle()
  // leaving = date_of_leaving || last_working_date || relieving_date || null
supabase.from('tds_declarations').select('regime').eq('employee_id', employeeId).eq('fy', '2026-27').maybeSingle()
  // hasDecl = !!row ; regime = row.regime || ''
supabase.from('investment_proofs').select('*').eq('employee_id', employeeId).eq('fy', '2026-27').order('section')
  // error → throw → err shown
```

- **Proof row shape:** `{ id, section, declared_item, declared_amount, submitted_amount, proof_reference, status, rejection_reason, deadline }`.
- **Draft map:** `{ [id]: { amt: submitted_amount ? String(submitted_amount) : '', ref: proof_reference || '' } }`.
- **Loading state:** "Loading…" (padding 24, muted).

### 4.2 Layout

The container has `maxWidth 780`.

- **Title** "Investment Proofs" (20px, weight 800), with the subtitle "FY 2026-27: bills for what you declared".
- **If `leaving`:** an amber banner with the title "Your proof window is open now" and the text "Your last working day is **{fmtDate(leaving)}**, so the deadline is not the end of the year, it is **that day**. Anything not proved by then will not stay exempt and will be taxed in the final settlement."
- **If `!hasDecl`:** a card reading "No **Investment Declaration** found for this FY. Proofs are submitted against it. Fill in and submit the declaration first."
- **Else if `regime === 'NEW'`:** a green card reading "You are on the **New regime**: the 80C/80D/HRA exemptions do not apply, so no proof is needed."
- **Otherwise:**
  - **Summary tiles:**
    - Declared = Σ `declared_amount` (ink).
    - Proven = Σ `submitted_amount` where the status is APPROVED (positive).
    - Not yet proven = `max(0, declared − proven)`, shown in warning if > 0, otherwise muted.
    - Deadline = `rows[0].deadline`, if set. It turns red (criticalTint background, critical border) when `new Date(deadline) < now`.
  - **If there are no rows:** a card reading "The proof window is not open yet. Use the button below to open a window for each line of your declaration." Under it is the button **"Proof window kholein"** (Hindi, verbatim), which shows "Opening…" while busy.
  - **Otherwise:** one `ProofRow` per row.
- **Messages:** `msg` is a green box with the prefix "✓ ". `err` is a red box. Both appear at the bottom.

### 4.3 `ProofRow`

- **Top line:**
  - A section chip (brandTint, 11px, weight 800).
  - The `declared_item` text.
  - A status pill:

    | status | label | bg / fg |
    |---|---|---|
    | PENDING | Proof pending | sunken / muted |
    | SUBMITTED | Under review | warningTint / warning |
    | APPROVED | Approved | positiveTint / positive |
    | REJECTED | Rejected | criticalTint / critical |

    An unknown status falls back to PENDING.
- **Grid:**
  - "Declared" ₹.
  - "Proof amount" input: digits only (`replace(/[^0-9]/g,'')`), `inputMode` numeric.
  - "Bill / policy reference" input (spans 2 columns), placeholder "Policy no. / receipt no. / drive link".
- `locked = status === 'APPROVED'`. When locked, the inputs are read-only with a sunken background and there is no button.
- `shortfall = max(0, declared_amount − num(draftAmt || submitted_amount))`. If the row is not locked and the shortfall is > 0, the row shows "Proof for ₹X is still pending. That much will not stay exempt." in amber.
- When REJECTED and `rejection_reason` is set, the row shows "Rejected: {reason}" in a red box.
- **Button:** "Submit proof" when the status is PENDING, otherwise "Update proof". It is disabled while busy, at opacity 0.6.

### 4.4 Actions

- **Open the window:**

  ```ts
  supabase.rpc('open_investment_proof_window', { p_employee_id: employeeId, p_fy: '2026-27' })
  ```

  - An error is shown as `err = error.message`.
  - If `!Number(data)`, the screen shows "No declared line found. Fill in and submit the Investment Declaration first."
  - Otherwise the message is "Proof window opened for {n} line{s}." and the list reloads.
  - The RPC returns an integer count of lines created. Its SQL (from "sql99") is **not in the repo**. Per the component header, it creates the proof lines, and for a resigning employee the deadline is the Date of Leaving.
- **Save a proof:**

  ```ts
  supabase.from('investment_proofs').update({
    submitted_amount: num(d.amt), proof_reference: d.ref.trim() || null,
    status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString(),
  }).eq('id', p.id)
  ```

  - **Success:** "{section} proof submitted. HR will review it." and the list reloads.
  - **Error:** `error.message`.
  - There is no validation: a 0 amount is allowed.
- `fmtDate`: "DD Mon YYYY", or '-' when there is no date.

---

## 5. Flexi Claims (`flexiclaims`) → `components/ess/FlexiClaims.tsx` (414 lines) + `lib/flexi/claims.ts`

**Purpose:**
- Monthly bill submission against flexi entitlements, inside a company submission window.
- A per-component balance and history drawer.
- Limit-increase requests.

### 5.1 `lib/flexi/claims.ts` (it imports `@/lib/supabase`, so it is **not** directly portable)

**Constants** (portable; copy them):

```ts
NO_INVOICE = ['MEAL','DEVICE']        // auto-claimed, no bill needed
ACCEPTED_TYPES = '.zip,.png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx'
FY = '2026-27'
COMP_NAMES = { PDA:'Prof. Dev. Allowance', TEL:'Telephone / WiFi', DEVICE:'Device Leasing', LTA:'Leave Travel Allowance', CAR:'Car Lease', DRIVER:'Driver Allowance', FUEL:'Fuel Reimbursement', MEAL:'Meal (Zaggle)', ATTIRE:'Corporate Attire', CHEDU:"Children's Education", HOSTEL:'Hostel Allowance' }
FORM_KEY_TO_CODE = { pda:'PDA', tel:'TEL', device:'DEVICE', lta:'LTA', car:'CAR', driver:'DRIVER', fuel:'FUEL', meal:'MEAL', attire:'ATTIRE', childEdu:'CHEDU', hostel:'HOSTEL' }
```

**`loadEntitlements(employeeId)`.** Its direct queries, in order:

```ts
supabase.from('employees').select('company_id, tds_regime').eq('id', employeeId).maybeSingle()
  // regime = tds_regime lower includes 'new' ? 'new' : 'old'
// annualFixed():
supabase.from('salary_structures').select('gross_monthly, employer_pf, employer_esic, gratuity_monthly').eq('employee_id', id).order('effective_date', { ascending:false }).limit(1)
  // fixed = (gross+erPF+erESIC+gratuity)*12 ; else:
supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', id).order('effective_from', { ascending:false }).limit(1)
  // fixed = annual_ctc − annual_variable ; else 0
// if no company → return { limits: [] }
supabase.from('flexi_policy_slabs').select('*').eq('company_id', companyId).eq('is_active', true).order('sort_order')
  // slab = first with fixed_from <= fixed <= fixed_to, else LAST slab
supabase.from('flexi_slab_limits').select('*').eq('slab_id', slab.id).eq('is_active', true)
supabase.from('flexi_components').select('id, code')
  // perComp[code] = regime==='old' ? old_regime_max : new_regime_max   (only if > 0)
supabase.from('flexi_declarations').select('component_code, old_regime_amt, new_regime_amt').eq('employee_id', id).eq('fy', FY)
  // amt = max(old,new); if > 0 → perComp[code] = amt
supabase.from('flexi_tds_forms').select('form_data, regime').eq('employee_id', id).eq('fy', FY).maybeSingle()
  // if form_data (JSON-parse if string): chosen = form.regime||regime ; src = chosen new ? fd.nFlexi : fd.oFlexi
  // perComp is CLEARED and replaced by src[formKey] > 0 → perComp[FORM_KEY_TO_CODE[k]] = amt
supabase.from('flexi_limit_overrides').select('component_code, override_limit').eq('employee_id', id).eq('fy', FY).eq('is_active', true)
  // perComp[code] = override_limit ; overridden set
// claims: GET /api/flexi/claims?employee_id=<id>  (fallback: supabase.from('flexi_claims').select('component_code, claim_amount, status').eq('employee_id', id))
```

**Totals per component:**
- APPROVED or PAYROLL_PROCESSED → `approved += amt` and `claimed += amt`.
- PENDING → `pending += amt` and `claimed += amt`.
- REJECTED → `rejected += amt`.

**Returns:**

```
{ companyId, regime, fixed, slabLabel: slab?.slab_label||null,
  limits: ComponentLimit[] /* {code, name, annual_limit, claimed, approved, pending, rejected, overridden} sorted by code */ }
```

**`loadWindow(companyId, year, month)`:**

```ts
supabase.from('flexi_windows').select('*').eq('company_id', companyId).eq('year', year).eq('month', month).maybeSingle()
```

The month is the device's **local** month (`now.getMonth()+1`). Fields used: `id`, `status`, `closes_at`.

**Alternative single endpoint (unused by web):** `GET /api/ess/flexi` (`essRoute`, Bearer required). It runs the same 7-step resolver on the service role and returns:

```json
{ "fy":"2026-27", "regime":"old|new", "annual_fixed":0,
  "slab": {"id":"","label":""} | null,
  "window": {"id":"","status":"OPEN","open":true,"opens_at":"","closes_at":""} | null,
  "heads": [{"code":"FUEL","name":"Fuel Reimbursement","annual_limit":0,"claimed":0,"approved":0,"pending":0,"rejected":0,"available":0,"overridden":false}],
  "claims": [{"id":"","component_code":"","claim_amount":0,"approved_amount":0,"status":"","bill_date":"","bill_no":"","rejection_reason":""}],
  "diagnostics": {"noSalaryStructure":false,"noSlab":false,"noDeclaration":false,"noHeads":false,"noWindow":false,"windowClosed":false} }
```

`POST /api/ess/flexi` takes `{ component_code, claim_amount, window_id?, bill_date?, bill_no?, agency_name?, vendor_desc?, remark?, supporting_remark? }` and enforces `amount <= available`. It returns:

```json
{ "ok":true, "claim_id":"", "status":"PENDING", "available_after":0 }
```

Possible errors:
- 400 "Say which flexi head this claim is against."
- 400 "The claim amount has to be more than zero."
- 400 "There is no flexi submission window open for your company this month."
- 400 "The submission window is closed."
- 404 "That submission window does not exist."
- 400 "{Name} is not one of your flexi heads. File your Flexi & TDS declaration first." / "… this year."
- 409 "You have ₹X of {Name} left; this claim is ₹Y."
- 403 when viewing as someone else.

Differences from the web logic:
- There is no `ctc_master` fallback for fixed.
- The month is computed in IST.
- `available = max(0, limit − claimed)`. The web uses `limit − approved − pending`, which is the same number.

Using this endpoint is recommended for RN because it is more secure, but it is a deviation from the web flow.

### 5.2 Screen state and load

`load()`:
1. `loadEntitlements` sets `companyId`, `regime`, `slabLabel` and `limits`.
2. If there is a company, `loadWindow(companyId, localYear, localMonth)`.
3. `GET /api/flexi/claims?employee_id=<id>` (no auth header) fills `claimHist = r.claims || []`.
4. `status = limits.length ? 'ready' : 'nopolicy'`.

**`GET /api/flexi/claims?employee_id=` response:**

```json
{ "claims": [ { "...flexi_claims.*": "",
    "flexi_claim_files": [{ "id":"", "file_name":"", "file_type":"", "file_url":"", "uploaded_at":"" }] } ] }
```

- It is ordered by `submitted_at` desc.
- Fields used: `id`, `component_code`, `claim_amount`, `bill_date`, `bill_no`, `agency_name`, `vendor_desc`, `remark`, `status`, `rejection_reason`, `submitted_at`.

**States:**
- **Loading:** "Loading flexi claims…".
- **No policy:** a card with the title "Flexi Reimbursement" and the text "No claimable flexi components are configured for your company & salary band yet. Once HR sets up the flexi policy slabs, your entitlements & bill submission will appear here."

### 5.3 Layout (ready)

1. **Title** "Flexi Reimbursement". Subtitle: "Submit monthly bills for your declared flexi components · {Old|New} regime{ · Slab <label>}".
2. **Window banner:**
   - **Window exists and is OPEN:** green, 🟢, "Window open · submit bills by **{closes_at as DD Mon YYYY}** · {max(0, ceil((closes_at−now)/1 day))} days left".
   - **Window exists but is not open:** red, 🔴, "Window closed · bills cannot be submitted right now".
   - **No window:** amber, "No submission window is open for this month yet. Contact HR / Payroll."
3. **Summary (4 tiles):**
   - Annual limit (brand) = Σ `annual_limit`.
   - Approved (positive).
   - Pending (warning).
   - Balance (ink) = Σ (`annual_limit − approved`). **(note)** The balance tile excludes pending; per-component "remaining" subtracts pending.
4. **Bill uploader.** Shown only if `isOpen && billTypeOptions.length > 0`. `billTypeOptions` is every limit whose code is not in NO_INVOICE and whose `annual_limit − approved − pending` is > 0.
   - **Header** (brand gradient): "Upload your bills", with the subtitle "Pick a bill type, enter the amount, attach photos or files. Add as many bills as you like."
   - **One `BillFrame` per frame.** It starts with one blank frame, `{ id, code:'', amount:'', billNo:'', billDate:'', vendor:'', files:[] }`.
     - **Header:** a numbered circle and "Bill N". When a code is selected, "Remaining limit **₹X**" appears. A × remove button appears when there is more than one frame.
     - **"Bill type" select:** "Select a bill type…" plus the options (by name).
     - **"Amount (₹)"** number input, min 0. When `amount > remaining`, the border turns red and the frame shows "⚠ Exceeds the remaining limit (₹X)".
     - **Upload area** (tap, or drag & drop on the web):
       - Empty: 📎 "Upload bills: tap to choose photos or files", and "Multiple allowed · JPG PNG PDF WORD EXCEL ZIP".
       - Filled: 64×64 thumbnails (an image preview, or an extension tile coloured by type: PDF red, JPG/JPEG amber, PNG green, ZIP brand, DOC/DOCX info, XLS/XLSX green). Each has a × remove button. A "+" tile adds more files. The caption reads "N file(s) attached".
       - The file input uses `accept=ACCEPTED_TYPES` and `multiple`. There is **no client-side size limit**.
     - **Optional details:**
       - "Bill no. (optional)", placeholder "INV-2026-001".
       - "Bill date", a date input with `max` = today.
       - "Vendor", placeholder "HPCL, Airtel…".
   - **"＋ Add another bill"** appends a blank frame.
   - **Footer:** "**N** bill(s) ready to submit", or "Fill a bill type, amount and file to submit". Here `activeCount` counts frames that have code, amount and files.
   - **Submit button:** "Submit N bill(s)", or "Submitting…" while it runs. It is disabled when `activeCount === 0` or while submitting.
5. **"Your entitlements"** label, then one card per limit:
   - **Name**, plus badges: "Custom limit" (if overridden), "No invoice needed" (MEAL/DEVICE), "Limit exhausted" (if remaining ≤ 0 and an invoice is needed).
   - **"History (count)" button** → HistoryDrawer.
   - **3 tiles:** Annual limit / Approved / Pending.
   - **Progress line:** "Approved: P%", where `usedPct = min(100, round(approved/limit*100))`, and "Remaining: ₹X". The bar is critical at ≥ 100%, warning at ≥ 80%, otherwise brand.
   - If `rejected > 0`: "⚠ ₹X rejected (not deducted from limit)".
   - **No-invoice components:** "Auto-claimed monthly. No bill submission required. Payroll processes this automatically."
   - **Exhausted (with invoice):** an amber box, "Annual limit reached. You can request an increase from Payroll.", with the button [Request increase].
   - **Otherwise (with invoice):** the button [Request limit increase].
6. **Limit-request panel** (when `reqComp` is set). It is amber:
   - **Title:** "Request limit increase: {name}".
   - **Fields:** "Requested annual limit (₹)" (number) and "Reason (mandatory)" (placeholder "Official travel increased…").
   - **Buttons:** [Send request] [Cancel].
7. **HistoryDrawer:**
   - A fixed right drawer (380 px, `maxWidth` 92vw). Tapping the backdrop closes it.
   - **Title:** "{name}: Claim history", with a × close button.
   - **Empty:** "No claims submitted yet".
   - **Per claim:** the amount, and a status pill (PENDING warning, APPROVED positive, REJECTED critical, PAYROLL_PROCESSED brandTint/brandDeep, with `_` shown as a space). Then 📅 bill date, 🧾 bill no and 🏪 agency/vendor; the remark as an italic quote; "⚠ {rejection_reason}" if rejected; and "Submitted DD Mon YYYY".
8. **Local toast:** fixed at bottom-right, ink background, 3.5 s.

### 5.4 Actions

**Submit all** (`submitAll`):
- **Validation, in order (toast text verbatim):**
  1. The window is not open → "Submission window is closed".
  2. `active` = frames with any of code, amount or files. If none → "Add at least one bill".
  3. For each active frame (N = index + 1):
     - "Bill N: choose a bill type"
     - "Bill N: enter an amount" (when empty or ≤ 0)
     - "Bill N: amount exceeds the remaining limit (₹X)"
     - "Bill N: attach at least one file"
- **For each active frame, in sequence:**

  ```http
  POST /api/flexi/claims   Content-Type: application/json   (no auth header)
  { "action":"SUBMIT", "window_id": win.id, "employee_id": employeeId, "company_id": companyId,
    "component_code": f.code, "claim_amount": Number(f.amount), "bill_date": f.billDate || null,
    "bill_no": f.billNo || null, "agency_name": f.vendor || null, "vendor_desc": f.vendor || null }
  ```

  - **Response:** `{ success:true, claim_id }`.
  - **Errors:**
    - 400 "Submission window is closed."
    - 400 "Claim amount must be greater than zero."
    - 500 `{ error }`
  - The server sets `ai_flag = 'flag'` when the amount is above 15,000, with `ai_notes` "Amount above ₹15,000: manual review recommended". The status is PENDING. The server does **not** check the limit.
  - On error or a missing `claim_id`, the frame is pushed to `fails` as `"<code>: <error|failed>"`.
  - **Then, for each file:**

    ```ts
    const path = `flexi-claims/${employeeId}/${claim_id}/${Date.now()}_${file.name}`
    const { data: up } = await supabase.storage.from('flexi-bills').upload(path, file)   // raw File, no options
    if (up) await supabase.from('flexi_claim_files').insert({ claim_id, employee_id: employeeId, file_type: 'BILL',
          file_name: file.name, file_url: path, file_size: file.size, mime_type: file.type })
    ```

    - This uploads directly with the anon key. `file_url` stores the **storage path**, not a URL.
    - There is no `getPublicUrl` or signed URL on this screen. Upload failures are silent.
- **After the loop:** frames reset to one blank frame and the screen reloads. The toast reads "{ok} submitted · {n} failed ({first failure})", or "{ok} bill(s) submitted · pending HR approval".

**Request a limit increase.**
- Validation: if any of component, amount or reason is missing → "All fields are required".

  ```http
  POST /api/flexi/claims
  { "action":"REQUEST_LIMIT", "employee_id", "company_id", "fy":"2026-27", "component_code": reqComp,
    "current_limit": lim.annual_limit || 0, "requested_limit": Number(reqAmt), "reason": reqReason }
  ```

- **Response:** `{ success:true, request_id }`.
- **Errors:** 400 "Reason required", 500.
- **UI:** an error shows the toast '⚠ ' + error. Success resets the panel and shows "Limit-increase request sent to Payroll".

---

## 6. Voluntary PF (`vpf`) → `VpfSection` (`EmployeePortal.tsx` ~2365)

### 6.1 API: `app/api/ess/vpf/route.ts`

`CURRENT_FY='2026-27'`, `MAX_PCT=88`, `EPF_CEILING=15000`.

**`GET /api/ess/vpf?employee_id=<id>`**
- Errors: 400 `{error:'employee_id required'}`, 404 `{error:'Employee not found'}`.
- **Server calculation:**

  ```
  ctc_master latest by created_at: annual_ctc, annual_variable, basic_annual, hra_annual, epf_wage_limit
  annualFixed = annual_ctc − annual_variable; monthlyGross = round(annualFixed/12); monthlyHra = round(hra_annual/12)
  limit = epf_wage_limit ?? 15000
  wageBase = round(min(max(0, monthlyGross − monthlyHra), limit))
  mandatoryEpfMonthly = round(wageBase * 0.12)
  current = vpf_declarations where employee_id & status='ACTIVE' (maybeSingle)
  ```

- **Response:**

  ```json
  { "employee": { "id":"", "code":"", "name":"", "has_ctc":true, "epf_wage_limit":15000,
                  "is_capped":true, "epf_wage_base":15000, "mandatory_epf_monthly":1800,
                  "epf_annual":21600, "c80_limit":150000 },
    "current_vpf": null }
  ```

  `current_vpf` is either `null` or a `vpf_declarations` row. The fields used are `vpf_percent` and `monthly_vpf_amount`.

**`POST /api/ess/vpf`**
- **Body:** `{ employee_id, vpf_percent, effective_from_month, acknowledged }`.
- **Errors:**
  - 400 'Acknowledgement required'
  - 404 'Employee not found'
  - 400 'Percent must be at least 1'
  - 400 insert error message
- Values above 88 are silently capped at 88.
- The existing ACTIVE row is set to SUPERSEDED. A new row is inserted with: `vpf_percent`, `epf_wage_limit`, `epf_wage_base`, `monthly_vpf_amount = round(base*pct/100)`, `annual_vpf_amount = monthly*12`, `fy`, `effective_from_fy`, `effective_from_month`, `status 'ACTIVE'`, `acknowledged`. A `vpf_audit_log` row (DECLARED or MODIFIED) is also written.
- **Response:** `{ success:true, declaration }`.

**`PATCH /api/ess/vpf`**
- **Body:** `{ employee_id, stopped_reason, stopped_from_month }`.
- **Error:** 404 'No active VPF found'.
- Sets STOPPED and writes an audit row.
- **Response:** `{ success:true }`.

### 6.2 Screen

**Load:**
- `fetch('/api/ess/vpf?employee_id=' + emp.id)`, with no headers.
- If `current_vpf` exists, `pctInput = String(current_vpf.vpf_percent)`. The default is '10'.
- **Loading:** "Loading…".
- If there is no `employee` in the response (any error): "Salary data not found." in critical.

**Client calculation:**

```ts
MAX_PCT=88, HIGH_ALERT=50
rawPct = parseFloat(pctInput)||0; capHit = rawPct>88 → rawPct=88
vpfMonthly = round(base*rawPct/100); vpfAnnual = vpfMonthly*12
total80c = epf_annual + vpfAnnual; over80c = total80c > c80_limit
barPct = min(100, round(total80c/c80_limit*100)); showHighAlert = rawPct>50 && !capHit
```

**Layout, in order:**
1. **Title** "Voluntary PF (VPF)" (18/600). Subtitle: "Extra PF deducted from your EPF wages. Set your own percentage."
2. **If `!has_ctc`:** an amber card reading "Your CTC is not configured yet, so the EPF wage base shows ₹0. Ask HR to set your CTC (ctc_master). Then VPF will calculate correctly."
3. **If `current`:** a sunken card. On the left, in positive: "Active VPF: {vpf_percent}% (₹{monthly_vpf_amount}/mo). Modify below". On the right, the outlined critical button **"Stop VPF"**.
4. **brandTint card:**
   - "Your EPF wages (from database)", with a chip that reads "Capped ₹15,000" (when `is_capped`) or "Actual (Gross − HRA)".
   - The base amount in 24px brandDeep.
   - A row "Current mandatory EPF (12%)" showing "₹X/mo".
5. **Input:**
   - Label "VPF percentage".
   - A number input (min 1, step 1, placeholder "e.g. 25"), then "%".
   - Hint: "Percentage of your EPF wages."
6. **If `showHighAlert`:** a criticalTint box reading "**That high?** {round(rawPct)}% (₹X/mo) VPF will cut your net in-hand a lot. Please confirm."
7. **If `capHit`:** a warningTint box reading "Max 88% allowed (12% mandatory + 88% = 100%). Set to 88%."
8. **brandTint card, rows:**
   - "VPF deduction (monthly)" ₹.
   - "VPF (annual)" ₹.
   - "Net in-hand impact" "−₹X/mo" (critical).
9. **brandTint card:**
   - "80C usage (₹1.5L max)" with "₹{min(total80c, limit)} / ₹1.5L".
   - An 8px bar. The fill is `#EF9F27` when over the limit (a hard-coded hex), otherwise brand.
   - Caption: "EPF (₹a) + VPF (₹b) = ₹c", plus " (no 80C benefit on ₹excess)" when over.
10. **criticalTint warning box:** "**Choose carefully:**", then the bullets "• VPF will **reduce your net in-hand salary**", "• The 80C exemption only goes **up to ₹1.5 lakh** (EPF + VPF + your other 80C)", and "• It is deducted every month until you stop it".
11. **Checkbox:** "I understand this will reduce my net in-hand salary and that the 80C exemption is capped at ₹1.5L. I request this VPF deduction."
12. **Full-width button** "Acknowledge & submit" ("Saving…" while saving). It is disabled until the checkbox is checked: it then shows a canvas background, muted text and a not-allowed cursor; when enabled it is brand.

**Actions:**
- **Submit:** `POST /api/ess/vpf` with `{ employee_id: emp.id, vpf_percent: rawPct, effective_from_month: 4, acknowledged: true }`. The month is **always 4**.
  - OK → toast "VPF request submitted ✓", the checkbox clears, and the screen reloads.
  - Otherwise → toast "Failed: " + error (error style).
- **Stop VPF:** `PATCH` with `{ employee_id, stopped_reason: 'Employee requested', stopped_from_month: 4 }`. There is **no confirm dialog**.
  - OK → toast "VPF stopped" and reload.
  - Otherwise → toast "Failed to stop" (error).

---

## 7. Corporate NPS (`nps`) → `NpsSection` (~2496)

### 7.1 API: `app/api/ess/nps/route.ts`

`PRAN_LENGTH=12`, `PRAN_DEADLINE_DAYS=3`, `RATE_OLD=10`, `RATE_NEW=14`.
- Regime: `employees.tds_regime` uppercased equal to 'OLD' gives OLD; anything else (including empty) gives NEW.
- `effective_date` = the 1st of next month (server local, ISO date).

**`GET /api/ess/nps?employee_id=`**
- Errors: 400 / 404 as for VPF.
- **Server calculation:** `basicMonthly = round(ctc_master.basic_annual/12)`, `percent = 10|14`, `monthlyNps = round(basicMonthly*percent/100)`.
- `current` = the `nps_declarations` row whose status is in `['ACTIVE','PENDING_PRAN']` (maybeSingle).
- **Response:**

  ```json
  { "employee": { "id":"", "code":"", "name":"", "has_ctc":true, "basic_monthly":0, "tax_regime":"OLD|NEW",
                  "contribution_percent":10, "monthly_nps_amount":0, "annual_nps_amount":0,
                  "effective_date":"2026-11-01", "pran_length":12 },
    "current_nps": null }
  ```

  `current_nps` is either `null` or a row. The fields used are `status`, `pran_deadline`, `contribution_percent` and `monthly_nps_amount`.

**`POST /api/ess/nps`**
- **Body:** `{ employee_id, has_existing_pran, pran_number, pran_holder_name, tier_type, acknowledged, source?, performed_by_name? }`.
- **Errors:**
  - 400 'Acknowledgement required'
  - 400 'PRAN must be 12 digits' (when `has_existing_pran` and the digits do not count 12)
  - 404 'Employee not found'
  - 400 insert error
- The existing row is set to SUPERSEDED. The new row's status is ACTIVE when there is a PRAN, otherwise PENDING_PRAN, with `pran_deadline` = today + 3 days and `pran_email_sent_at` set.
- When pending, the server emails the PRAN creation form via `sendPranCreationEmail` to `office_email || personal_email` (best-effort) and writes audit rows.
- **Response:** `{ success:true, declaration, pending_pran: boolean, deadline: 'YYYY-MM-DD'|null }`.

**`PATCH /api/ess/nps`**
- **Body:** `{ employee_id, action:'SUBMIT_PRAN', pran_number }` or `{ employee_id, action:'STOP', stopped_reason }`.
- **Errors:**
  - 404 'No NPS declaration found'
  - 400 'PRAN must be 12 digits'
  - 400 'Invalid action'
- **Response for SUBMIT_PRAN:** `{ success:true, status:'ACTIVE' }`.
- **Response for STOP:** `{ success:true, status:'STOPPED' }`.

### 7.2 Screen

**Load:**
- `fetch('/api/ess/nps?employee_id=')`. `pranName` is prefilled from `employee.name`.
- **Loading:** "Loading…". With no employee: "Salary data not found."

**Validation:** `pranClean = pran.replace(/\D/g,'')`, `pranValid = pranClean.length === pran_length`, `canSubmit = ack && (!hasPran || pranValid)`.

**Layout, in order:**
1. **Title** "Corporate NPS enrolment". Subtitle: "Employer contributes to your NPS (Tier I). Extra tax benefit under Section 80CCD(2)."
2. **If `!has_ctc`:** amber, "Your CTC (Basic) isn't configured yet, so NPS shows ₹0. Ask HR to set your CTC (ctc_master)."
3. **If `current`:**
   - **status PENDING_PRAN:** brandTint background, border `#B5D4F4` (hex). Text: "PRAN pending: generate & submit by {pran_deadline as toLocaleDateString('en-IN'), e.g. 22/10/2026}." Below it, an input (digits only, `maxLength` 12, placeholder "Enter 12-digit PRAN", letterSpacing 2) and the button **"Submit PRAN"**, which is disabled until there are 12 digits.
   - **Otherwise (ACTIVE):** sunken background, border `#C5E8DB`. Text: "Active NPS: {contribution_percent}% of Basic (₹X/mo)", with the outlined critical button **"Stop NPS"**.
4. **brandTint card "Your contribution (from salary structure)":**
   - A 3-column grid: Monthly Basic ₹ | Tax regime ('Old' when OLD, otherwise 'New') | NPS rate {x}%.
   - A row "Monthly NPS contribution" "₹X/mo".
   - A row "Effective from" {effective_date, en-IN `{day:'numeric', month:'long', year:'numeric'}`, e.g. "1 November 2026"}.
   - Note: "Old regime = 10% of Basic · New regime = 14% of Basic".
5. **"Do you already have an NPS account (PRAN)?"** with two toggle buttons, "Yes, I have a PRAN" and "No, I need one". The default is Yes. The selected button has a 2px brand border, a canvas background and brandDeep text.
6. **If Yes:**
   - "PRAN number (12 digits)": a text input, digits only, `maxLength` 12, placeholder "e.g. 110012345678".
   - **Hint:** with 0 digits, "Enter your 12-digit PRAN" (muted). When valid, "Valid 12-digit PRAN" (positive). Otherwise "{12−n} more digit(s) needed" (warning).
   - A 2-column row: "Name as per PRAN" (text, prefilled) and "Account tier" select (Tier I | Tier II, default Tier I).
7. **If No:** a brandTint box reading "**A new PRAN will be created for you.** On submit, we'll email you the PRAN creation form. Generate your PRAN **within 3 days**, then resubmit here. For help, contact the **Payroll team**."
8. **Amber box:** "**Please read carefully:**", then the bullets "• NPS is a long-term retirement product, locked in until age 60 (limited early withdrawal)", "• Employer contribution is over & above your ₹1.5L 80C limit (Section 80CCD(2))", "• Recurring monthly contribution, reflects in your salary structure", and "• Rate follows your tax regime (10% old / 14% new of Basic)".
9. **Checkbox:** "I confirm I want to enrol in the corporate NPS. I understand the contribution will be a percentage of my Basic as per my tax regime, effective from the 1st of next month, and that NPS is a long-term retirement product with lock-in until age 60."
10. **Button:** "Acknowledge & submit" (when Yes) or "Submit & email me the PRAN form" (when No). It shows "Submitting…" while saving and is disabled unless `canSubmit`.

**Actions:**
- **Submit:** `POST` with `{ employee_id, has_existing_pran: hasPran, pran_number: hasPran ? pranClean : null, pran_holder_name: pranName, tier_type: tier, acknowledged: true }`.
  - OK → toast `d.pending_pran ? 'PRAN form emailed. Submit within 3 days' : 'NPS enrolment submitted ✓'`, the checkbox clears, and the screen reloads.
  - Otherwise → "Failed: " + error.
- **Submit PRAN:** `PATCH` with `{ employee_id, action:'SUBMIT_PRAN', pran_number: submitPran }`.
  - OK → "PRAN submitted. NPS active ✓", the input clears, and the screen reloads.
  - Otherwise → "Failed: " + error.
- **Stop NPS:** `PATCH` with `{ employee_id, action:'STOP', stopped_reason:'Employee requested' }`. There is no confirm dialog.
  - OK → "NPS stopped".
  - Otherwise → "Failed to stop".

**(note)** The enrolment form stays visible even when an NPS is active, so submitting again supersedes the active row.

---

## 8. Loans (`loans`) → `LoansSection` (~2756) + `LoanAgreementPanel`

### 8.1 Pure calculation

**Client EMI** (in `EmployeePortal.tsx`; copy it):

```ts
function loanEmi(P: number, ratePct: number, n: number): number {
  if (!P || !n) return 0
  if (!ratePct) return Math.round(P / n)
  const r = ratePct / 12 / 100, f = Math.pow(1 + r, n)
  return Math.round(P * r * f / (f - 1))
}
const loanInr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
```

- **(note)** The client always uses `interest_rate`. The server uses `0` when `interest_type === 'ZERO'`, so the indicative EMI can differ for ZERO loans that have a non-zero rate configured.
- `lib/loans/schedule-generator.ts` is **pure, with no imports**. RN can import or copy it: `import { calcEMI, generateSchedule, maxEligibleLoan, type ScheduleRow } from '@/lib/loans/schedule-generator'`.
  - `calcEMI(principal, annualRate, months)`: the PMT formula; `annualRate === 0` gives `round(P/n)`.
  - `maxEligibleLoan(base:'CTC'|'GROSS', annualCtc, annualFixed, maxPercent)` = `round(base amount × maxPercent / 100)`, where the base amount is CTC, or fixed when the base is GROSS.
  - `generateSchedule` produces REDUCING, FLAT or ZERO amortisation. It is used server-side for the agreement `schedule_snapshot`.

### 8.2 API: `app/api/ess/loans/route.ts`

**`GET /api/ess/loans?employee_id=`**
- Errors: 400 'employee_id required', 404 'Employee not found'.
- **Response:**

  ```json
  { "loan_types": [ { "...loan_types.*": "", "max_eligible": 0 } ],
    "my_loans": [ "loans.* (all statuses, newest first)" ],
    "pending_requests": [ "loan_requests.* where status in SUBMITTED|IN_APPROVAL|APPROVED, newest first" ],
    "has_ctc": true }
  ```

  - `has_ctc` is true when `annual_ctc > 0`.
  - `loan_types` contains only the active ones for the employee's company. Fields used: `id`, `name`, `interest_rate`, `interest_type`, `min_tenure_months`, `max_tenure_months`, `max_eligible`.
  - `loans` fields used: `id`, `loan_number`, `status`, `principal`, `emi_amount`, `outstanding_principal`, `paid_installments`, `remaining_installments`, `disbursement_date`.
  - `loan_requests` fields used: `id`, `loan_type_id`, `requested_amount`, `indicative_emi`, `requested_tenure_months`, `current_approval_level`, `status`.

**`POST /api/ess/loans`**
- **Body:** `{ employee_id, loan_type_id, requested_amount, requested_tenure_months, reason }`.
- **Errors:**
  - 404 'Employee not found' / 'Loan type not found'
  - 400 "Max eligible is ₹{n en-IN}"
  - 400 "Tenure must be {min}-{max} months"
  - 400 insert error
- **Effects:**
  - Inserts a `loan_requests` row with status IN_APPROVAL, `current_approval_level` 1, `indicative_emi` and `eligibility_max`.
  - Creates one `loan_approvals` row per active `loan_approval_levels` row for the company (type-specific or null).
  - Writes an audit row.
- **Response:** `{ success:true, request, emi, approval_levels }`.

**`PATCH /api/ess/loans`**
- **Body:** `{ loan_id, employee_id, request_type:'CLOSURE'|'PART_PAYMENT', amount?, apply_in_month? }`.
- **Errors:** 404 'Loan not found', 400.
- Inserts `loan_closure_requests` with `amount` = outstanding for a CLOSURE, otherwise `amount`; `status` REQUESTED; and `apply_in_fy`.
- **Response:** `{ success:true, closure_request }`.

### 8.3 API: `app/api/ess/loans/agreement/route.ts`

- **`GET ?request_id=`** returns `{ agreement: loan_agreements row }` (the latest by `created_at`).
  - Error: 404 `{ error:'No agreement' }`.
  - Fields used: `id`, `agreement_number`, `schedule_snapshot` (an array, or a JSON string, of `{installment_number, due_date | month, emi_amount, principal_component, interest_component, closing_balance}`), `status`, `esign_name` and `signed_at`.
- **`GET ?request_id=&format=html`** returns `text/html`, a printable agreement rendered server-side:
  - A company letterhead (`resolveLetterhead(company_name)` with header and footer HTML).
  - The title from the config template `loan.agreement` (subject, default 'LOAN AGREEMENT').
  - "Agreement No / Status".
  - Employee, Loan Type, Principal, Tenure and Indicative EMI.
  - A "Repayment Schedule" table with columns #, Due date, EMI, Principal, Interest and Balance, plus a Total row. When there are no rows it shows "Schedule pending disbursement.".
  - The template terms paragraphs.
  - The signature block: "Accepted & agreed:", then the e-sign name followed by "(e-signed)" or a blank line, then name · code · signed date.
  - There is no PDF binary; the user prints from the browser.
  - The page has no auth. It is opened by a plain link.
- **`POST`** (employee signs):
  - **ESIGN body:** `{ agreement_id, employee_id, signature_type:'ESIGN', esign_name, esign_image_url? }`.
  - **UPLOAD body:** `{ agreement_id, employee_id, signature_type:'UPLOAD', signed_pdf_url }`.
  - **Errors:**
    - 404 'Agreement not found'
    - 400 'Already signed or processed' (when the status is not GENERATED)
    - 400 'Name required for e-sign'
    - 400 'Signed PDF required'
    - 400 'Invalid signature_type'
  - Sets status UNDER_REVIEW and `signed_at`, and writes an audit row.
  - **Response:** `{ success:true, status:'UNDER_REVIEW' }`.
- **`PATCH`** is HR review. It is not employee-facing.

### 8.4 Status badge (`LoanStatusBadge`)

The text is the uppercased status with `_` replaced by a space. It renders as a pill: 10px, padding 2×9, radius 99, weight 600.

| Statuses | bg / fg |
|---|---|
| SUBMITTED, IN_APPROVAL, REQUESTED, GENERATED | warningTint / warning |
| UNDER_REVIEW, PENDING_PRAN | brandTint / brand |
| APPROVED, RECOVERING, DISBURSED, SIGNED | sunken / positive |
| REJECTED, CANCELLED, EXIT_RECOVERY | criticalTint / critical |
| CLOSED, FORECLOSED | sunken / muted |
| other | brandTint / brandDeep |

### 8.5 Screen

**Load:**
- `fetch('/api/ess/loans?employee_id=')`.
- The first time, `typeId` is set to `loan_types[0].id`.
- **Loading:** "Loading…".

**Layout:**
1. **Title** "Loans". Subtitle: "Apply for a company loan, track approvals, sign your agreement, and manage repayments."
2. **If `!has_ctc`:** amber, "CTC not configured: eligibility shows ₹0; ask HR to set CTC."
3. **Card "Apply for a loan":**
   - **If there are no types:** "No loan types configured for your company."
   - **Otherwise:**
     - **"Loan type"** select (by name). Under it, in brandDeep: "Max eligible ₹X · {rate}% ({interest_type}) · tenure {min}–{max} months".
     - **"Amount (₹)"**, placeholder "e.g. 100000". When it is above `max_eligible`: "Max eligible is ₹X" in red.
     - **"Tenure (months)"**, placeholder "{min}–{max}". When it is out of range: "Tenure must be {min}–{max} months" in red.
     - **"Reason"** textarea, placeholder "Purpose of the loan…", `minHeight` 70.
     - **brandTint box:** "Indicative EMI (reducing balance)" showing "₹X/mo".
     - **Button** "Submit loan request" ("Submitting…" while it runs).
4. **`LoanAgreementPanel`** (when `signingReq` is set). It is inserted here, above Pending requests.
5. **Card "Pending requests":**
   - **Empty:** "No pending requests."
   - **Otherwise, a row per request:** "{type name || 'Loan'} · ₹amount", then "EMI ₹X · N mo · approval level {current_approval_level ?? '-'}". On the right: the badge, plus the button **"Sign agreement"** when the status is APPROVED. That button sets `signingReq = p.id`.
6. **Card "My loans":**
   - **Empty:** "No active loans."
   - **Otherwise, per loan:**
     - `loan_number` and the badge.
     - "Principal ₹ · EMI ₹/mo · Outstanding **₹**".
     - "Paid {paid ?? 0} / {paid+remaining} installments · {remaining} remaining", plus " · disbursed {DD Mon YYYY}" when `disbursement_date` is set.
     - **If the status is RECOVERING:** the buttons **"Foreclose"** (critical outline) and **"Part-payment"** (brand outline).

**Actions:**
- **Submit request.**
  - Client validation: no type selected → "Select a loan type". An amount ≤ 0 → "Enter an amount". A tenure ≤ 0 → "Enter tenure in months". Range and max are not blocked on the client; the server enforces them.
  - Sends `POST` with `{ employee_id, loan_type_id: typeId, requested_amount: amtNum, requested_tenure_months: tenNum, reason }`.
  - `ok && d.success` → toast "Loan request submitted ✓". The amount, tenure and reason clear, and the screen reloads.
  - Otherwise → `d.error || 'Failed to submit'`.
- **Part-payment:**
  - `window.prompt('Part-payment amount (₹):', String(Math.round(outstanding_principal)))`. Cancel aborts.
  - A value ≤ 0 → "Enter a valid amount".
- **Foreclose:**
  - `window.confirm('Foreclose {loan_number}? Outstanding ₹X will be recovered.')`.
- **Both** then send `PATCH` with `{ loan_id, employee_id, request_type, amount }`. Success → "Foreclosure request submitted" or "Part-payment request submitted", then reload. Otherwise → `d.error || 'Failed'`.

### 8.6 `LoanAgreementPanel`

**Load:**
- `GET /api/ess/loans/agreement?request_id=` → `agr = d.agreement || null`.
- **Loading:** a card reading "Loading agreement…".
- **If `!agr`:** a card reading "No agreement found yet. Please check back shortly." (critical) with a [Close] button.

**Layout:**
- A card with a brand border.
- **Header:** "Sign agreement: {agreement_number}", with:
  - **[View / print]**: an `<a href="/api/ess/loans/agreement?request_id=<id>&format=html" target="_blank">` link.
  - **[Close]**.
- **Schedule table** (horizontal scroll, `minWidth` 520): # | Due | EMI | Principal | Interest | Closing.
  - "Due" shows `due_date || month || '-'`.
  - **Empty:** "No schedule rows.".
  - The snapshot is parsed when it is a string.
- **Mode toggle:** "E-sign" | "Upload signed PDF".
- **E-sign mode:**
  - Label "Type your full legal name to sign". Input placeholder "e.g. Rahul Sharma".
  - When the input is non-empty, a preview box (dashed brand border) shows the name in a cursive font: `"Segoe Script","Brush Script MT",cursive`, 22px.
- **Upload mode:**
  - Label "URL of your signed agreement PDF". Input placeholder "https://…/signed-agreement.pdf".
  - **There is no file picker.** The employee pastes a URL.
- **Button** "Submit signed agreement" ("Submitting…" while it runs).

**Submit:**
- **Validation:** ESIGN with an empty name → "Type your full name to sign". UPLOAD with an empty URL → "Paste the signed PDF URL".
- **Bodies:**
  - **ESIGN:** `{ agreement_id: agr.id, employee_id, signature_type:'ESIGN', esign_name: name.trim(), esign_image_url: 'data:text/plain,' + encodeURIComponent(name.trim()) }`.
  - **UPLOAD:** `{ agreement_id, employee_id, signature_type:'UPLOAD', signed_pdf_url: url.trim() }`.
- **Success:** toast "Agreement submitted for review", then `onDone` (close the panel and reload the list).
- **Failure:** "Failed: " + error.

---

## 9. Travel Claims (`claims`): the legacy screen → `components/ess/TravelClaims.tsx` (1,137 lines)

**Purpose:**
- Log individual travel expenses for the current month (billed, or GPS-recorded).
- Attach bill slips.
- Bundle unclaimed logs into a claim that goes through RM → HR Head → Finance.
- See claim history.

This is **not** the Travel & Expenses v2 module (`/ess/travel`), which is a separate page and not covered here.

### 9.1 Auth helper

```ts
async function travelAuthHeaders() {
  const ess = essAuthHeaders(); if (ess.Authorization) return ess
  const { data } = await supabase.auth.getSession(); const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}
isPreview() = !essAuthHeaders().Authorization   // admin preview: writes disabled
```

- In RN the employee always has an ESS token, so `preview` is false.
- All `/api/travel/*` routes use `resolveActor`. With an ESS token, a supplied `employee_id` must match the token, otherwise the route returns 403 "You can only act on your own travel records.".
- **No token:** 401 "Sign in to continue.".
- If `ESS_SESSION_SECRET` is missing, the route returns 503.

### 9.2 Pure modules RN can import directly

```ts
import { measureTrail, assessTrail, compactTrail, haversineM, isValidPoint, type GpsPoint } from '@/lib/travel/gps'  // no imports at all
import { decodePolyline, encodePolyline, simplify, boundsOf, projectToViewBox, type LatLng } from '@/lib/travel/polyline' // pure
import type { Flag, FareResult, ExpenseType, MileageRate } from '@/lib/travel/types'                                      // types only
import { computeFare, findModeRate, findMileageRate, checkLimit, ... } from '@/lib/travel/calc'                            // imports only ./types (pure, server uses it)
```

**Do not import these:**
- `lib/travel/access.ts` (it uses `createClient` with the service role, server-only).
- `lib/travel/actor.ts` (it uses `next/server` and `lib/ess-session`).
- `lib/travel/errors.ts` (it uses `next/server`).

**`measureTrail`.** It filters valid points, sorts them by `t`, then:
- drops points whose accuracy is > 100 m,
- drops steps < 15 m as drift,
- drops steps faster than 150 km/h as jumps (the last good point is kept, so the trail re-joins),
- sums the haversine distance of the remaining steps.

**Returns:** `{distance_km (2dp), used_points, dropped_accuracy, dropped_drift, dropped_jump, mean_accuracy_m, duration_min, avg_speed_kmph}`.

### 9.3 Journey recorder (`useJourneyRecorder`)

- **States:** `IDLE | TRACKING | RECORDED`.
- **Journey state:** `{state, points: GpsPoint[] (lat, lng, t = pos.timestamp, acc), startedAt, endedAt, error, accuracy}`.
- **`start()`:**
  - If there is no geolocation: error "This device cannot report its location, so a journey cannot be recorded here."
  - Otherwise it calls `navigator.geolocation.watchPosition(cb, errCb, { enableHighAccuracy:true, maximumAge:0, timeout:20000 })` and appends only valid points.
  - **PERMISSION_DENIED:** error "Location permission is blocked. Allow location for this site, then start the journey again.", state → IDLE, and the watch stops.
  - **Other errors:** "Waiting for a location fix. Move somewhere with a clearer view of the sky." The watch keeps running.
- **`end()`:** stops the watch, sets state RECORDED with `endedAt`, and persists the journey to `sessionStorage['ezer.travel.journey']`.
- **On mount:** if the stored journey is RECORDED and has points, it is restored.
- **`reset()`:** clears the storage and returns to IDLE.
- The watch is cleared on unmount.
- **RN:** use `expo-location` `watchPositionAsync` (Accuracy.Highest). Persist with AsyncStorage. Consider background location, because the web requires the screen to stay open.

### 9.4 Load (`load()`)

**Direct Supabase queries:**

```ts
supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
  // none → blocked = 'Your employee record has no company mapped.'
supabase.from('travel_expense_types').select('*').eq('company_id', companyId).eq('is_active', true).order('sort_order')
supabase.from('travel_employee_vehicles').select('*').eq('employee_id', employeeId).eq('is_active', true)
supabase.from('travel_policies').select('id').eq('company_id', companyId).eq('is_active', true).order('effective_from', { ascending:false }).limit(1)
supabase.from('travel_mileage_rates').select('type_code, rate_per_km, effective_from').eq('policy_id', pol.id).lte('effective_from', today()).order('effective_from', { ascending:false })
  // keep first row per non-empty type_code → rates (display only)
```

- `typeCode` defaults to the first type the first time.
- **ExpenseType fields:** `id`, `type_code`, `type_name`, `calc_method` ('PER_KM'|'ACTUAL'|'ZERO'), `bill_threshold`, `allowed_local`, `requires_vehicle`, `requires_gps`, `bill_required`, `category`.
- **Vehicle fields:** `id`, `vehicle_type` ('CAR'|'TWO_WHEELER'), `fuel_type`, `cubic_capacity`, `registration_no`, `is_verified`.

**API calls (in parallel, with Bearer):**
- `GET /api/travel/logs?employee_id=<id>&from=<YYYY-MM-01>&to=<today>`
- `GET /api/travel/claims?employee_id=<id>`

`today()` is `new Date().toISOString().slice(0,10)`, which is the **UTC** date. Note this for IST mornings.

- If the logs call returns 403, `blocked = body.error || 'Your access to the travel module has ended.'`.
- Any exception: `blocked = 'Could not load your travel claims. Please try again.'`.

**`GET /api/travel/logs` response:**

```json
{ "logs": [ "travel_logs.* + travel_trips(trip_no, purpose, to_city)  (status != CANCELLED, log_date desc)" ],
  "summary": { "count":0, "unclaimed_count":0, "unclaimed_amount":0, "total_amount":0, "total_distance":0 },
  "employee": { "id":"", "name":"", "grade":"" } }
```

- **TravelLog fields used:** `id`, `log_date`, `purpose`, `type_code`, `city`, `distance_claimed`, `computed_fare`, `amount_entered`, `toll_amount`, `parking_amount`, `total_amount`, `distance_source`, `rate_applied`, `status`, `claim_id`.
- **Guard errors** (`guardResponse`): `{ error, code, meta }`. Status 403 for EMPLOYEE_EXITED (message e.g. "Your travel module access ended on your last working day.") and EMPLOYEE_NOT_FOUND; 409 otherwise.

**`GET /api/travel/claims?employee_id=` response:** `{ "claims": [ "v_travel_claim_summary rows, submitted_at desc nulls last" ] }`.
- **Claim fields:** `id`, `claim_no`, `period_from`, `period_to`, `total_claimed`, `total_approved`, `net_payable`, `status`, `submitted_at`, `paid_at`, `line_count`, `flag_count`.

### 9.5 Layout

- **Loading:** centred brand text "Loading your travel claims…".
- **Blocked:** a card with the title "Travel claims are not available" and the `blocked` text below it.

**1. Summary strip (3 tiles):**
- "Ready to claim" = Σ `total_amount` of unclaimed logs (brandDeep).
- "Awaiting approval" = Σ `total_claimed` of claims whose status starts with PENDING or is SUBMITTED (warning).
- "Paid this year" = Σ `net_payable` where the status is PAID (positive). It is not actually filtered by year.

**2. Banners:**
- **`msg` Banner:**
  - tone `ok`: positiveTint / positive
  - tone `warn`: warningTint / warning
  - tone `err`: criticalTint / critical
- **`flags` Banner (warn):** "**Saved, with a note / notes for your approver:**", then a bulleted list of `flag.message`.

**3. Card "Log a travel expense":**
- **Preview Banner** (admin only). Not applicable in RN.
- **Row:**
  - **"Date":** a date input, max today, default today.
  - **"Expense type":** a select grouped by `optgroup` in CATEGORY_ORDER:

    ```
    CONVEYANCE 'Local conveyance', OUTSTATION 'Outstation travel', STAY 'Stay', ALLOWANCE 'Allowances',
    COMMUNICATION 'Communication', DOCUMENTATION 'Travel documents', CLIENT 'Client facing', OTHER 'Other'
    ```

    A null category maps to OTHER. The option text is `type_name`, plus " (recorded)" when `requires_gps`. With no types, a single option reads "No expense types configured". **Changing the type calls `reset()` on the journey.**
  - **"City":** placeholder "e.g. Mumbai".
- **"What was it for":** placeholder "e.g. Client meeting at Andheri".
- **If `needsGps` (`selectedType.requires_gps`):**
  - When the type requires a vehicle and none is registered, a warn Banner: "No vehicle is registered against your record, so mileage cannot be priced. Ask HR to add your vehicle before claiming {type_name}."
  - When there is no `liveRate` and no vehicle is required, a warn Banner: "No rate per kilometre has been set for {type_name} yet. You can still record the journey. Ask HR to set the rate before you submit."
  - **JourneyPanel:**
    - Intro text: "**{typeName}** has no bill to attach, so the journey is recorded and paid on distance. Start before you set off and end when you arrive, and keep this screen open while you travel."
    - The error Banner: `err` when the state is IDLE, otherwise `warn`.
    - While tracking or recorded:
      - "{liveKm.toFixed(2)} km"
      - "{n} location point(s) · ±{acc} m"
      - When there is a rate: "₹{liveKm×rate}" "at ₹{rate}/km"
      - While tracking: "Recording"
    - **Buttons:**
      - IDLE: **"Start travel"** (brand)
      - TRACKING: **"End travel"** (positive)
      - RECORDED: "Journey recorded. Add the details below and save." plus **"Discard"** (which calls `reset`)
  - "Working out the route you took…" while the route is loading.
  - `RouteMap` with the title "Your route" (height 260), when a route exists.
  - **Fields:**
    - "Vehicle" select (only when the type requires a vehicle): "Use my default", plus options `"{registration_no || vehicle_type} · {fuel_type}{' (unverified)' when not verified}"`.
    - "Toll (₹)".
    - "Parking (₹)".
  - **Checkbox:** "Return journey (double the recorded distance)".
- **Else (billed):**
  - "Amount (₹)".
  - When `bill_threshold > 0`: "A bill is required above ₹{threshold}."
- **Bill slip picker.** Shown when `!needsGps && selectedType?.bill_required !== false`.
  - Label "Bill slip".
  - A hidden file input with `accept="image/*,application/pdf"` (single file).
  - Button text: "Choose Uber / Ola / taxi bill", or "✓ {file name}" once a file is chosen. A chosen file also shows its size and a "remove" link.
  - When there is no file and the amount is above the threshold: "This amount needs a bill. Attach it now or from the list below." (warning).
  - Hint: "A photo or the PDF the app emails you. Up to 10 MB."
  - The file is held in `pendingBill` and uploaded after the log is created.
- **Button** "Add expense" ("Saving…" while it runs). It is disabled while saving.

**4. Card "Ready to claim · N":**
- **[Select all] / [Clear selection]** toggle.
- **Empty:** "Nothing logged yet this month. Add an expense above."
- **`LogRow` per unclaimed log** (where `!claim_id` and the status is not CANCELLED):
  - A checkbox, the `purpose`, then "{typeName} · {DD Mon YYYY}{ · city}{ · N km}{ · 📍 recorded when distance_source is GPS_TRACKED/GPS_SNAPPED}{ @ ₹rate/km}".
  - `total_amount` on the right, with a × delete button.
  - **For non-GPS rows, the bills line:**
    - Bill chips (positiveTint), each with a filename link (signed URL, opens in a new tab), its size and a × remove button.
    - **"Attach bill slip"** (or "+ another bill"; "Uploading…" while busy).
    - When the row is loaded, has no bills and needs one: "Needs a slip: {typeName} above ₹{threshold} must show a bill" (warning).
    - A row needs a bill when the type has `bill_required`, is not `requires_gps`, and `total_amount > bill_threshold > 0`.
- **Footer:** "Select the expenses you want to claim.", or "Claiming **₹X** across N expense(s)". The **"Submit claim"** button (positive) is disabled when nothing is selected or while submitting.

**5. Card "My claims":**
- **Empty:** "You have not submitted a travel claim yet."
- **`ClaimRow`:**
  - Left border in the status fg colour, `claim_no`, and a status pill (table below).
  - "{n} expense(s)", "{period_from} – {period_to}" (dmy), and "Claimed **₹**".
  - When APPROVED or PAID: "Approved **₹**".
  - When `flag_count > 0`: "⚑ N to review".
  - When settled and `total_approved < total_claimed`: "₹diff was not approved. Open the claim with Finance if you need the reason."

**Claim status pills:**

| status | label | bg / fg |
|---|---|---|
| DRAFT | Draft | brandTint / brandDeep |
| SUBMITTED | Submitted | warningTint / warning |
| PENDING_RM | With your manager | warningTint / warning |
| PENDING_HR | With HR Head | warningTint / warning |
| PENDING_FINANCE | With Finance | brandTint / brandDeep |
| APPROVED | Approved | positiveTint / positive |
| SENT_BACK | Sent back to you | criticalTint / critical |
| REJECTED | Rejected | criticalTint / critical |
| PAID | Paid | positiveTint / positive |

An unknown status falls back to brandTint / brandDeep with the raw status text.

### 9.6 Actions and endpoints

**Route preview** (automatic when the state becomes RECORDED and there are at least 2 points):

```http
POST /api/travel/route   Authorization: Bearer …   Content-Type: application/json
{ "points": [ { "lat":0, "lng":0, "t":0, "acc":0 } ] }
```

- **Response (`RouteData`):**

  ```json
  { "ok": true,
    "actual":  { "distance_km":0, "source":"GPS_SNAPPED|GPS_TRACKED", "polyline":"", "points":[{"lat":0,"lng":0}] },
    "optimal": { "distance_km":0, "duration_min":0, "polyline":"", "points":[] },
    "comparison": { "excess_km":0, "excess_pct":0 }, "raw_trail_km":0,
    "trail": { "recorded_points":0, "used_points":0, "dropped_accuracy":0, "dropped_drift":0, "dropped_jump":0, "mean_accuracy_m":0, "duration_min":0, "avg_speed_kmph":0 },
    "maps_configured": true, "concerns": [ { "code":"", "severity":"WARN|BLOCK", "message":"" } ] }
  ```

  `optimal` is `null` when Google Maps is not configured.
- **Error:** 400 `{ error:'A recorded trail needs at least two usable location points.', code:'GPS_NO_TRAIL' }`.
- Failures are ignored ("the map is a bonus").

**RouteMap rendering:**
- With `NEXT_PUBLIC_GOOGLE_MAPS_KEY`: a Google JS map showing the actual route as a brand polyline (weight 5), the optimal route as a dashed faint polyline, a green Start marker and a red End marker, with `fitBounds`.
- Otherwise: an SVG trace with a grid background (`projectToViewBox`), the actual path in brand and the optimal path dashed.
- **Legend:** Route taken, Direct route, Start, End.
- **Stats:**
  - "Route taken"
  - "Direct route"
  - "Difference" (±km; red when `excess_pct > 40`, amber when > 15, otherwise green)
  - "Duration" "N min"
  - "Avg speed" "N km/h"
- **Method line:** "Matched to roads from N recorded points." or "Measured from N recorded points, straight-line between fixes (road matching was unavailable)." It adds "N point(s) excluded as drift, jumps or poor accuracy." and "Average accuracy ±N m." where applicable.
- **No-key note (amber):** "Showing the recorded path without a basemap. No Google Maps key is configured. Distances above are still measured from the real trail. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY for the map, and GOOGLE_MAPS_API_KEY on the server for road matching and the direct-route comparison."
- **Concerns:** a bulleted list, red for BLOCK and amber for WARN.
- **RN:** use `react-native-maps` (Polyline, Marker) or `react-native-svg` for the fallback.

**Add expense** (`addExpense`):
- **Validation, in order:**
  1. Preview → warn "You are previewing this portal as an admin, so you cannot file an expense here. The employee has to log in and add it themselves."
  2. Empty purpose → err "Say what the journey was for."
  3. No type → "Pick an expense type."
  4. GPS type that is not RECORDED → "Record the journey first. Start before you set off and end when you arrive."
  5. Non-GPS type with no amount → "Enter the amount you spent."
- **If GPS**, first:

  ```http
  POST /api/travel/gps-distance
  { "points": journey.points, "type_code": typeCode, "employee_id": employeeId, "log_date": date, "vehicle_id": vehicleId || null }
  ```

  - **Response:**

    ```json
    { "distance_km":0, "raw_trail_km":0, "snapped_km":0, "source":"GPS_SNAPPED|GPS_TRACKED",
      "maps_configured":true, "rate_per_km":0, "rate_label":"", "amount":0,
      "trail": {}, "concerns": [], "compacted_track": [] }
    ```

    `snapped_km`, `rate_per_km`, `rate_label` and `amount` may each be `null`.
  - **Error:** 400 `{ error:'A recorded location trail is required.', code:'GPS_NO_TRAIL' }`.
  - The client uses only `snapped_km`. Failures resolve to null.
- **Then create the log:**

  ```http
  POST /api/travel/logs
  { "employee_id": employeeId, "log_date": date, "purpose": purpose.trim(), "type_code": typeCode,
    "city": city.trim() || null,
    "vehicle_id": selectedType.requires_vehicle ? (vehicleId || null) : null,
    "is_round_trip": needsGps ? roundTrip : false,
    "amount_entered": needsGps ? 0 : Number(amount),
    "toll_amount": Number(toll)||0, "parking_amount": Number(parking)||0,
    // GPS only:
    "gps_track": journey.points, "distance_snapped": snapped, "gps_started_at": journey.startedAt, "gps_ended_at": journey.endedAt,
    "from_lat": first.lat, "from_lng": first.lng, "to_lat": last.lat, "to_lng": last.lng }
  ```

  - **Response:**

    ```json
    { "log": { "...travel_logs row...": "" },
      "fare": { "computed_fare":0, "rate_applied":0, "distance_used":0, "distance_source":"", "variance_pct":0, "toll_amount":0, "parking_amount":0, "total_amount":0, "flags":[] },
      "limit": { "limit":0, "claimed":0, "payable":0, "unclaimable":0, "enforcement":"BLOCK|WARN|AUTO_TRIM", "flags":[] },
      "pooled": null,
      "flags": [ { "flag_type":"MISSING_BILL", "severity":"WARN", "policy_value":0, "actual_value":0, "message":"" } ],
      "message": "Travel logged." }
    ```

    - `fare.rate_applied`, `fare.distance_used`, `fare.distance_source`, `fare.variance_pct` and `limit.limit` may each be `null`.
    - `message` is "Travel logged with notes for your manager." when there are flags.
  - **Errors:**
    - 400 'log_date, type_code and purpose are required'
    - 400 "Expense type X is not configured for your company."
    - 400 "{type} can only be claimed against an outstation trip." (when `!allowed_local` and there is no `trip_id`)
    - 400 GPS_REQUIRED "{type} has no bill to verify against, so the journey must be recorded. Use Start travel and End travel. A typed distance is not accepted for this mode."
    - 409 `{ error: first BLOCK message, code, flags }`
    - **Guards** (403/409 `{error, code, meta}`):
      - PERIOD_NOT_OPENED "This expense month has not been opened yet. Please ask HR to open it." / "No active travel policy is configured for your company."
      - PERIOD_LOCKED "{label} is locked. It has already been paid through payroll and cannot be changed."
      - PERIOD_CLOSED "{label} is closed. You can no longer add or edit expenses for this month." / "Submissions for {label} open on {date}." / "The submission window for {label} ended on {date}."
      - FUTURE_DATED "Expense date cannot be in the future."
      - BEFORE_JOINING "Expense date is before your date of joining ({doj})."
      - BILL_TOO_OLD "This bill is N days old. Bills older than M days cannot be claimed."
      - EMPLOYEE_EXITED
    - 503 `{ error, code:'MIGRATION_PENDING' }`
  - **Client handling:**
    - `!res.ok` → err `json.error || 'Could not save this expense.'`.
    - Otherwise `flags = json.flags`. If `pendingBill` is set and `json.log.id` exists, the bill is uploaded and the note becomes ' Bill attached.' or ' The expense saved, but the bill did not: {message}'.
    - `msg` tone is warn when there are flags, otherwise ok. The text is `(json.message || 'Expense logged.') + billNote`.
    - The form resets and the screen reloads.
    - A network failure → "Could not reach the server. Please try again."

**Delete a log:**
- `DELETE /api/travel/logs?id=<id>&employee_id=<id>` with Bearer.
- **Response:** `{ ok:true }`. The server marks the log CANCELLED.
- **Errors:**
  - 400 'id is required'
  - 404 'Log not found'
  - 403 'Not your travel log'
  - 409 'This log is already part of a submitted claim and cannot be deleted.'
  - guard errors
- **Client:** shows `err` with `j.error || 'Could not remove that entry.'`. There is no confirm dialog.

**Bills (`/api/travel/upload-bill`):**
- **List:** `GET ?travel_log_id=<id>`, called per row on mount.
  - **Response:** `{ attachments: [{ ...travel_attachments.*, url: <1-hour signed URL | null> }] }`.
  - **Fields:** `id`, `file_name`, `mime_type`, `file_size`, `url`, `attachment_type`.
- **Upload:** `POST` as **multipart/form-data**. Do not set Content-Type; let the client add the boundary. Fields:
  - `travel_log_id`
  - `file`
  - `attachment_type` = 'BILL'. Allowed values: BILL, TOLL_SLIP, FASTAG_STATEMENT, BOOKING, OTHER.

  **Server limits:** maximum 10 MB. MIME must be one of `image/jpeg, image/png, image/webp, image/heic, image/heif, application/pdf`.

  **Response:**

  ```json
  { "attachment": { "...": "", "url": "" },
    "duplicate": null,
    "message": "Bill attached." }
  ```

  - `duplicate` is either `null` or `{ log_id, log_date, purpose, amount }`.
  - When it is a duplicate, `message` is "Bill attached, but it is the same file as another journey. Your approver will see a note."

  **Errors:**
  - 401
  - 413 FILE_TOO_LARGE "That file is too large to upload. Keep it under 10 MB. A photo of the slip is enough." / "That file is X MB. The limit is 10 MB. A photo of the slip is enough."
  - 400 'travel_log_id and file are both required.'
  - 400 'That file is empty.'
  - 400 "{mime} is not accepted. Attach a photo (JPEG, PNG, HEIC) or a PDF."
  - 404 'Journey not found'
  - 403 'You can only attach bills to your own journeys.'
  - 409 CLAIM_LOCKED "{claim_no} has already been submitted, so its bills cannot be changed. Ask HR to send it back if a bill is missing."
  - 500 'Upload failed: …'

  **Server side:** stores the file in the private bucket `onboarding-docs` at `travel/bills/<employee>/<log>/<KIND>_<ts>_<safeName>`, keyed by SHA-256 hash. It resolves the MISSING_BILL flag and adds a DUPLICATE flag where applicable.

  **Client:** the notify tone is `warn` if the message includes 'same file', `ok` otherwise, and `err` on failure. A failed upload message reads `j.error || j.message || 'Upload failed.'`. The bills list reloads.
- **Delete:** `DELETE ?id=<attachment id>` → `{ ok:true }`.
  - **Errors:** 409 CLAIM_LOCKED "{claim_no} has been submitted. Its bills can no longer be removed."
  - **Client:** `j.error || 'Could not remove that bill.'`.
- **Signed URL for a path:** `GET ?path=…` → `{ url }`. This is not used by this screen.

**Submit a claim:**

```http
POST /api/travel/claims   Bearer   { "employee_id": employeeId, "log_ids": ["…"] }
```

`claim_type` defaults to MONTHLY_LOCAL.

- **Response:** `{ claim: travel_claims row, lines: travel_claim_lines[], message: "{claim_no} submitted, now with {your reporting manager | the HR Head | Finance} for approval." }`.
- **Errors:**
  - 400 'At least one travel log is required'
  - 400 'No unclaimed travel logs found for the selected entries.'
  - guard errors
- **Client:**
  - OK → clear the selection, show ok `json.message || 'Claim submitted.'`, and reload.
  - Otherwise → err `json.error || 'Could not submit this claim.'`.
  - Network failure → "Could not reach the server. Please try again."

---

## 10. Investment Declaration (`declaration`): not in nav (noted only)

- The component is `components/ess/InvestmentDeclaration.tsx` (555 lines). It is reachable only via `/ess/declaration` or `?tab=declaration`. The nav entry was removed on request; the component, its import and its render case remain.
- It takes the same props as the calculator (`employeeId`, `empName`, `empCode`) and uses direct Supabase.
- The Investment Proofs screen refers to it in copy ("Fill in and submit the Investment Declaration first"). In practice the Flexi & TDS Calculator's submit is what writes `tds_declarations`.
- It is not specced further here.

---

## 11. Every direct Supabase call in this section (consolidated)

| Screen | Table / bucket | Op | Columns / payload | Filters / order |
|---|---|---|---|---|
| Flexi calc | ctc_master | select | annual_ctc, annual_variable | employee_id=; order effective_from desc; limit 1 |
| Flexi calc | employees | select | company_id, company_doj, group_doj, tds_regime | id=; maybeSingle |
| Flexi calc | tds_declarations | select | regime, declaration_status | employee_id=, fy='2026-27'; maybeSingle |
| Flexi calc | flexi_tds_forms | select | regime, status, form_data | employee_id=, fy=; maybeSingle |
| Flexi calc (loadSalary) | onboarding_candidates | select | candidate_id, offered_ctc | employee_id=; order created_at desc; limit 1; maybeSingle |
| Flexi calc (loadSalary) | ctc_negotiations | select | * | candidate_id=; order created_at desc; limit 1 |
| Flexi calc (loadSalary) | employees | select | employment_type, intern_pay, consultant_pay, contract_pay (fallback: employment_type) | id= |
| Flexi calc (loadSalary) | ctc_master | select | * | employee_id=; order effective_from desc; limit 1 |
| Flexi calc (loadSalary) | salary_structures | select | * | employee_id=; order effective_date desc; limit 1 |
| Flexi calc | flexi_tds_forms | upsert | {employee_id, company_id, fy, regime, status, form_data:{f,oFlexi,nFlexi,child}, submitted_at, updated_at} | onConflict employee_id,fy |
| Flexi calc | employees | update | {tds_regime} | id= |
| Flexi calc | tds_declarations | upsert | see 3.15 | onConflict employee_id,fy |
| Flexi calc | investment_declaration_lines | upsert | 11 rows {employee_id, fy, section_code, declared_amount, source:'calculator', updated_at} | onConflict employee_id,fy,section_code |
| Proofs | employees | select | date_of_leaving, last_working_date, relieving_date | id= |
| Proofs | tds_declarations | select | regime | employee_id=, fy= |
| Proofs | investment_proofs | select | * | employee_id=, fy=; order section |
| Proofs | rpc open_investment_proof_window | rpc | {p_employee_id, p_fy} → integer | |
| Proofs | investment_proofs | update | {submitted_amount, proof_reference, status:'SUBMITTED', rejection_reason:null, updated_at} | id= |
| Flexi claims (lib) | employees | select | company_id, tds_regime | id= |
| Flexi claims (lib) | salary_structures | select | gross_monthly, employer_pf, employer_esic, gratuity_monthly | employee_id=; order effective_date desc; limit 1 |
| Flexi claims (lib) | ctc_master | select | annual_ctc, annual_variable | employee_id=; order effective_from desc; limit 1 |
| Flexi claims (lib) | flexi_policy_slabs | select | * | company_id=, is_active=true; order sort_order |
| Flexi claims (lib) | flexi_slab_limits | select | * | slab_id=, is_active=true |
| Flexi claims (lib) | flexi_components | select | id, code | |
| Flexi claims (lib) | flexi_declarations | select | component_code, old_regime_amt, new_regime_amt | employee_id=, fy= |
| Flexi claims (lib) | flexi_tds_forms | select | form_data, regime | employee_id=, fy=; maybeSingle |
| Flexi claims (lib) | flexi_limit_overrides | select | component_code, override_limit | employee_id=, fy=, is_active=true |
| Flexi claims (lib, fallback) | flexi_claims | select | component_code, claim_amount, status | employee_id= |
| Flexi claims (lib) | flexi_windows | select | * | company_id=, year=, month=; maybeSingle |
| Flexi claims | storage `flexi-bills` | upload | path `flexi-claims/{emp}/{claim}/{Date.now()}_{file.name}`, raw File | (no getPublicUrl / signed URL) |
| Flexi claims | flexi_claim_files | insert | {claim_id, employee_id, file_type:'BILL', file_name, file_url:path, file_size, mime_type} | |
| Travel | employees | select | company_id | id= |
| Travel | travel_expense_types | select | * | company_id=, is_active=true; order sort_order |
| Travel | travel_employee_vehicles | select | * | employee_id=, is_active=true |
| Travel | travel_policies | select | id | company_id=, is_active=true; order effective_from desc; limit 1 |
| Travel | travel_mileage_rates | select | type_code, rate_per_km, effective_from | policy_id=, effective_from <= today; order effective_from desc |

VPF, NPS and Loans make no direct Supabase calls; everything goes through the API.

---

## 12. Shared formatting

- **Money:** `'₹' + Math.round(n||0).toLocaleString('en-IN')`, for example ₹1,50,000. It is used on every screen. In RN, `toLocaleString('en-IN')` needs Hermes Intl support (available in Expo SDK 50+). Otherwise use a manual Indian grouping helper.
- **Dates:**
  - `toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })` → "05 Oct 2026". Used by Loans (`fmt`), Flexi claims and Travel.
  - Proofs uses its own "DD Mon YYYY" format.
  - NPS uses the "1 November 2026" long form, and its PRAN deadline uses the default en-IN format (dd/mm/yyyy).
- **Tokens:** the screens use `C.*` from `lib/ui/tokens.ts`, which are `var(--ez-*)` CSS strings. RN cannot resolve those. Map them to the light and dark hex values in `lib/ui/theme.css`.
- **Hard-coded hex values to keep or map:**
  - `#EF9F27` (VPF over-80C bar)
  - `#B5D4F4`, `#C5E8DB` (NPS status borders)
  - `#C05621`, `#9b2c2c`, `#1c4532` (calculator regime colours)
  - The calculator hero gradients
  - The PDF and HTML templates

---

## Implementation notes for React Native

1. **Browser-only APIs in use, and their replacements:**
   - `localStorage` / `sessionStorage`: ESS token `ezer_ess_session`; journey `ezer.travel.journey`. Replace with SecureStore (token) and AsyncStorage (journey).
   - `window.confirm`: calculator submit, loan foreclose. Replace with `Alert.alert` using two buttons and the exact same text.
   - `window.prompt`: loan part-payment amount, prefilled with the outstanding amount. RN has no cross-platform prompt (`Alert.prompt` is iOS only), so use a modal with a numeric input.
   - `window.alert`: calculator "Could not save your regime: …".
   - `window.open('', '_blank')` + `document.write` + `window.print()`: calculator PDF. Replace with `expo-print` `printToFileAsync({ html })` and `expo-sharing`, or `Print.printAsync`.
   - `XLSX.writeFile`: calculator Excel. Use `XLSX.write(wb, { type:'base64' })`, then `FileSystem.writeAsStringAsync(..., { encoding: Base64 })`, then `Sharing.shareAsync`.
   - `<a target="_blank">` links:
     - The loan agreement "View / print" (`/api/ess/loans/agreement?request_id=…&format=html`).
     - Travel bill chips (signed URLs, 1-hour TTL).

     Open them with `expo-web-browser` or `Linking.openURL` using the absolute base URL. Alternatively, fetch the HTML and render it in a WebView or via `expo-print`. The agreement HTML endpoint needs no auth header today.
   - `<input type="file">`:
     - Flexi claims: multiple files, `.zip,.png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx`, plus drag & drop.
     - Travel: one file, `image/*,application/pdf`, 10 MB on the server.

     Use `expo-document-picker` (`multiple: true` for flexi) and `expo-image-picker` (camera or library) for photos. Drag & drop does not apply in RN.
   - `URL.createObjectURL`: flexi thumbnails. In RN, use the picked asset's `uri` directly in `<Image>`.
   - `FormData` uploads (travel): in RN append `{ uri, name, type }` as the file part and leave Content-Type unset.
   - Supabase Storage upload of a `File` (flexi bills): in RN, read the file to an ArrayBuffer (for example `fetch(uri).then(r => r.arrayBuffer())`, or base64 → `decode`) and call `storage.from('flexi-bills').upload(path, arrayBuffer, { contentType: mimeType })`. Keep `file_url` = the path.
   - `navigator.geolocation.watchPosition`: use `expo-location` `watchPositionAsync({ accuracy: Highest, timeInterval, distanceInterval })`, mapping `coords.latitude/longitude/accuracy` and `timestamp` to `GpsPoint {lat,lng,t,acc}`. Request foreground permission and show the same denied message. The web needs the screen to stay open; background tracking (`TaskManager`) would be an enhancement, not parity.
   - The Google Maps JS SDK in `RouteMap`: use `react-native-maps` Polyline/Marker. Use `react-native-svg` for the keyless trace via `projectToViewBox` from `lib/travel/polyline.ts`.
   - `<fieldset disabled>` (calculator lock): RN has no equivalent. Pass `editable={false}` / `disabled` to every control in steps 1–3 according to `basicRW`, `flexiRW` and `investRW`.
   - The `dangerouslySetInnerHTML` labels in the calculator breakup table: replace `&nbsp;&nbsp;` with leading spaces or indentation.
   - `<select>` / `<optgroup>`: use a picker or bottom sheet. The travel type picker must show category group headers.
2. **API base URL:** every `fetch('/api/…')` is relative. RN needs the absolute origin (for example `https://ezer-hrms-chi.vercel.app`).
3. **Auth:**
   - Send `Authorization: Bearer <ESS token>` on every API call. It is mandatory for `/api/travel/*`, `/api/ess/payslips` and `/api/ess/flexi`. VPF, NPS, Loans and `/api/flexi/claims` currently ignore it and trust `employee_id`, so still pass `employee_id` exactly as the web does.
   - Direct Supabase calls use the public anon key via `@supabase/supabase-js`. In RN, use the same client with an AsyncStorage adapter. No Supabase user session exists for an ESS employee.
4. **Portable pure modules** (safe to import or copy; they have no supabase, `next` or browser dependencies):
   - `lib/loans/schedule-generator.ts`: `calcEMI`, `generateSchedule`, `maxEligibleLoan` (no imports).
   - `lib/travel/gps.ts`: `measureTrail`, `assessTrail`, `compactTrail`, `haversineM`, `isValidPoint` (no imports).
   - `lib/travel/polyline.ts`: `decodePolyline`, `encodePolyline`, `simplify`, `boundsOf`, `projectToViewBox`.
   - `lib/travel/types.ts` (types only).
   - `lib/travel/calc.ts` (imports only `./types`; the server uses it for fare, limits and pooling).
5. **Not portable** (they import `@/lib/supabase`, `next/server` or server-only code):
   - `lib/flexi/claims.ts`: copy the constants and re-implement `loadEntitlements` / `loadWindow` against the RN Supabase client, or switch to `GET /api/ess/flexi`.
   - `lib/employees/hr-actions.ts` (`loadSalary`): re-implement, porting the `SalaryBreakup` derivation verbatim.
   - `lib/travel/access.ts`, `lib/travel/actor.ts`, `lib/travel/errors.ts`, `lib/nps/pran-email.ts`, `lib/loans/notify.ts`, `lib/loans/payroll-sync.ts`.
   - `lib/income-tax/*` and `lib/epf/*` (they import supabase). They are **not used** by these screens anyway.
   - The **Flexi/TDS tax engine lives inside the component** (section 3.2 and 3.9). Extract it into a shared pure TS file so the formulas stay byte-identical.
6. **Hard-coded FY:** `'2026-27'` appears in the calculator, proofs, `lib/flexi/claims`, and the VPF, NPS and Loans routes. The FY date window (1 Apr 2026 – 31 Mar 2027) and the MONTHS labels are also hard-coded. Mirror them; do not compute them.
7. **Local vs IST dates:**
   - The flexi window month uses the device's local month.
   - Travel `today()` uses the UTC date.
   - NPS `effective_date` comes from the server.

   Keep the same behaviour for parity, but be aware that an IST device before 05:30 gets yesterday's date for travel.
8. **Quirks to preserve or flag (do not silently fix without sign-off):**
   - The calculator `draftMsg` always renders in red, because of the `startsWith('')` check.
   - `defaultedByRule` never shows a date.
   - `eEpf` is double-counted in the Old regime.
   - 80G is saved as `80CCC`.
   - The "Flexi Wallet (monthly)" label in the exports shows the annual value.
   - The Flexi claims summary "Balance" excludes pending.
   - The client loan EMI ignores `interest_type 'ZERO'`.
   - The VPF and NPS Stop actions have no confirmation.
   - The loan agreement upload takes a pasted URL, not a file.
   - Investment Proofs has no file upload (text reference only).
   - The flexi wallet overflow is not blocked at submit.
