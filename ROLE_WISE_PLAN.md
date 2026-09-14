# HRMS Role-Wise Rollout — Execution Plan

Source of truth: the manager-approved "role wise & role based access" sheet.
Confirmed decisions live in memory `rolewise-division-decisions`.

## Confirmed decisions
1. **Super Admin = Khushal only** (cross-company). Everyone else is capped at their own company.
2. **HR Manager** = process owner of HR modules, but **own company only**.
3. **IT / Admin Manager** = only Onboarding (code generate + approval) for now.
4. **Company Profile** visible to all roles; **Admin Setup** = Super Admin only.
5. **Company scoping is the master rule** — every module, every role, own company only. Only Super Admin crosses companies.
6. **Recruitment** already exists as "Recruitment ATS"; MRF is inside it.
7. **Multiple roles per employee** → union (widest access wins). Already handled in `lib/rms/modules.ts`.
8. RM1/RM2/HOD/HR-holder roles derive from the per-employee hierarchy (`l1_manager_id`, `l2_manager_id`, `hod_id`, `hr_manager_id`, `hr_head_id`).

## Current state (measured live)
- **21 roles** exist in `ess_roles` (map: RM1→L1_MANAGER, RM2→L2_MANAGER, Hiring Mgr→RECRUITER, +ADMIN_SUPER, ALL_ACCESS).
- **`role_permissions`**: 281 rows already configured (migration 082) — reconcile, don't rebuild.
- **Hierarchy columns**: l1 395/398, hr_manager 397, hr_head 397 ✓ · hod 7/398 ✗ · l2 258 partial.
- **`ess_user_roles`**: only 37 assignments (keyed by `ess_account_id`).
- **`ess_accounts`**: 270/398 (128 missing).
- **`rms_config.enforce_module_access` = FALSE** — nothing enforced yet.
- **Company scope NOT in code**: scope model is SELF/TEAM/DEPT/BRANCH/ORG; ORG = all companies. No COMPANY level. `ess_roles_scope_check` (migration 057) must be widened.

## Role → scope mapping (target)
| Scope | Roles |
|---|---|
| ORG (cross-company) | ADMIN_SUPER, ALL_ACCESS  (Khushal only) |
| COMPANY (own company) | HR_MANAGER, HR_HEAD, CHRO, CFO, MD, PAYROLL, PAYROLL_ADMIN, IT, ADMIN_COMPANY, FINANCE_EXECUTIVE |
| BRANCH | BRANCH_HR, BRANCH_EXEC |
| DEPT | HOD, HR_EXECUTIVE |
| TEAM | L1_MANAGER, L2_MANAGER, RECRUITER |
| SELF | EMPLOYEE |
| (leave as-is) | IMPL_MANAGER — internal Ezer implementation role, not in the sheet |

## Permission level translation (sheet verbal → access_level)
- "Process Owner" / "Full …" → **FULL**
- "Approver" / "Can edit" / "raise request + act" → **EDIT**
- "Only Dashboard View" / "Can view reports" / "Part of Configuration / Can view" → **VIEW**
- blank / "Self request" (Employee handled by ESS self-service) → **NONE**
- Company Profile → **VIEW** for every role
- Admin Setup → **FULL** for ADMIN_SUPER only, NONE elsewhere

## Phases
1. **CODE — COMPANY scope** (biggest): add `COMPANY` to the Scope type + rank (between BRANCH and ORG); filter by `company_id` in `lib/ess-scope.ts` and every cross-employee data surface the investigation lists. Super-admin (ORG) bypasses. *Blocks on the surface map.*
2. **DATA — scope migration** (`113_company_scope.sql`): widen `ess_roles_scope_check` to include COMPANY; set each role's `scope` per the table above.
3. **DATA — ESS accounts**: create `ess_accounts` for the 128 employees without one (default password `abc123`), so all 398 can log in and hold roles.
4. **DATA — assign functional roles** (`ess_user_roles`): derive from the DB hierarchy columns (cleaner than the sheet snapshot which had errors):
   - appears as anyone's `l1_manager_id` → L1_MANAGER; `l2_manager_id` → L2_MANAGER; `hod_id` → HOD.
   - is a company's `hr_manager_id` → HR_MANAGER; `hr_head_id` → HR_HEAD; etc. for payroll/admin/it/finance/branch-hr holders.
   - Khushal → ADMIN_SUPER. Everyone keeps EMPLOYEE (base).
5. **DATA — reconcile permission matrix**: diff current 281 rows against the sheet + decisions; adjust only the differences; show the diff before applying.
6. **DATA — populate `hod_id`** (7/398): from the sheet HOD column / department heads. *Needs a source — see Open items.*
7. **VERIFY + FLIP**: spot-check a user from each company & role in each company; then set `enforce_module_access = true`. Rollback = set it back to false.

## Open items still to resolve
- **hod_id source** (only 7/398 populated): does the full sheet's HOD column cover all 398, or should HOD = department head be derived? The partial sheet I saw had gaps.
- **Permission matrix diff**: I'll surface the concrete before/after per role before applying Phase 5.

## Safety
- Every DATA step ships as an idempotent SQL file the user runs (direct writes are classifier-blocked); each has a verify query.
- Enforcement stays OFF until Phases 1–6 are verified. Flipping it is the only user-visible change; it is instantly reversible.
