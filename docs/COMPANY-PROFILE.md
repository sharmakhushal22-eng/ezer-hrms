# EZER HRMS — Company Profile

**Module:** Admin → Company Profile (Group → Company → Branch → Statutory master)
**Route:** `/dashboard/company-profile`
**Migration:** `027_company_profile_audit_billing.sql` (validated on real Postgres)
**Status:** Code complete · typecheck-clean (0 new TS errors) · migration tested
**Last updated:** 17 June 2026

---

## 1. Ye module kya hai

Company Setup form se jo data daala/dummy banaya — **Group → Companies → Branches → Statutory → Bank → License** — woh sab ek hi screen pe visible. Har field **inline editable**, aur har edit ka **audit log** (field, old → new, kaun, kab). Plus **billing lifecycle** (quarterly advance + 30-day grace + suspend) aur **branch-wise employee limit**.

Company Setup form data *banata* hai; Company Profile usko *dikhata, edit karta, aur track karta* hai.

---

## 2. Hierarchy

```
Group  (groups)
  └─ Company  (companies — PAN/TAN/CIN/DOI/reg-office/letterhead)
       ├─ Branches      (locations — address, GPS lat/lng, max_employees)
       ├─ Statutory     (registrations — GST/EPF/ESIC/PT/LWF/FACTORY)
       ├─ Bank          (company_bank_accounts)
       └─ License       (license_plans — limits + billing + account status)
```

---

## 3. Data model

### Existing master tables (Supabase mein already — `lib/supabase-admin.ts`)
| Table | Key fields |
|---|---|
| `groups` | group_code, group_name, country, status |
| `companies` | group_id, company_code, company_name, short_name, company_type, industry, pan, tan, cin, date_of_inc, reg_office, corp_office, letterhead_*, status |
| `locations` (branch) | company_id, location_code, location_name, location_type, address_line1, city, district, state, pin_code, **latitude, longitude**, status |
| `registrations` | company_id, location_id, reg_type, reg_number, state, district, dept_address, valid_from/till, status |
| `company_bank_accounts` | company_id, account_type, bank_name, account_number, ifsc_code, branch_name, is_primary, status |
| `license_plans` | company_id, plan_name, max_employees, max_locations, price_monthly, valid_from/till, is_active |

### Migration 027 adds
| Object | Purpose |
|---|---|
| `company_master_audit` | entity_type (GROUP/COMPANY/LOCATION/REGISTRATION/BANK/LICENSE), entity_id, company_id, action, field, old_value, new_value, changed_by, note, changed_at |
| `company_billing` | company_id, period, amount, valid_from/till, paid_on, confirmed_by, status (PENDING/PAID/OVERDUE) |
| ALTER `license_plans` | + billing_cycle (QUARTERLY), paid_till, grace_days (30), account_status, next_due_date |
| ALTER `locations` | + max_employees (branch-wise cap) |
| `resolve_account_status(company_id)` | returns ACTIVE / GRACE / SUSPENDED |

---

## 4. Edit + audit mechanism

App-level logging (repo ke `onboarding_audit_log` pattern jaisa). `updateEntity(entityType, id, patch, {company_id, changedBy})`:
1. Pehle current row fetch (old values).
2. Update karo.
3. Har **changed** field ke liye ek `company_master_audit` row insert (old vs new diff). Unchanged fields skip.

Page pe har editable field `✎` icon ke saath; click → input → Save → audit. Audit log panel niche recent 40 changes dikhata hai.

---

## 5. Billing lifecycle

```
[quarter paid] → ACTIVE → (paid_till crossed) → GRACE (30 days, reminders) → (day 30 unpaid) → SUSPENDED
                    ↑                                                                              │
                    └──────────────── payment confirmed → paid_till rolls forward ────────────────┘
```

- **ACTIVE:** aaj ≤ `paid_till`. Full access.
- **GRACE:** `paid_till` < aaj ≤ `paid_till + grace_days` (default 30). Access on, par reminder banner — window mein escalate (day 1 · 15 · 25 · 29).
- **SUSPENDED:** aaj > `paid_till + 30`. Access locked.
- **Confirm payment** (EZER super-admin) → `company_billing` PAID row + `license_plans.paid_till` aage roll + status ACTIVE. (Audit mein bhi log.)

Status `resolve_account_status()` (DB) ya client-side `computeStatus()` (lib) — dono same logic.

**Branch employee limit:** `locations.max_employees` per branch. Billing headcount basis + employee add karte time cap cross hone pe alert (employees module integration).

---

## 6. Files delivered

| File | What |
|---|---|
| `supabase/migrations/027_company_profile_audit_billing.sql` | audit + billing tables, ALTERs, resolver, RLS |
| `lib/supabase-company-profile.ts` | `loadHierarchy()`, `updateEntity()` (auto-audit), `loadAudit()`, `loadBilling()`, `confirmPayment()` |
| `app/dashboard/company-profile/page.tsx` | C-palette view — group hierarchy, inline edit, billing banner, audit log, confirm-payment modal |

---

## 7. Setup steps

1. **Migration run:** Supabase → SQL Editor → `027_company_profile_audit_billing.sql` paste → Run. (`companies`/`locations`/`license_plans` already exist; ALTER `IF NOT EXISTS` safe hai.)
2. **Sidebar nav link** — `app/dashboard/layout.tsx` mein ek entry add karo:
   ```tsx
   { label: '🏢 Company Profile', href: '/dashboard/company-profile' },
   ```
3. Deploy: GitHub Desktop → Vercel auto-deploy.

---

## 8. Notes

- Style: **C palette** (#F0F4F8 page, #FFFFFF cards, #0F172A text, #7C3AED purple, #E2E8F0 borders, 10px/8px radius, "DM Sans") — admin/employees module se match.
- Helper components (`Toast`, `StatusBadge`, `EditField`, `CompanyCard`, `PayModal`) parent ke **bahar** defined (focus-loss bug se bachne ke liye).
- `isMobile` breakpoint <1024px.
- Saare Supabase calls `lib/supabase-company-profile.ts` mein isolated.
- RLS: permissive (`anon` + `authenticated`) — auth wire hone par tighten karna.
- GPS lat/lng + branch `max_employees` attendance geofence punch (50/100m) aur billing dono feed karte hain.

---

*EZER HRMS · Company Profile · module reference*
