-- 202_manager_roles_mrf_only.sql
-- ===========================================================================
-- L1 MANAGER / L2 MANAGER / HOD: on the admin side, only raising an MRF.
--
-- SAFE TO RUN TWICE.
--
-- These three roles come to anybody who has people reporting to them (the reporting
-- structure, not hand assignment), so they must not open HR's admin modules. Decided
-- 30-Oct-2026: they keep Recruitment (EDIT) — whose screens migration 123 already limits
-- to the MRF tab for these roles — and lose everything else on the admin side:
-- Employees, Transfer, Attendance, Attendance Reports, Reports, Loans, Travel Claims,
-- Policies, Holidays, Support, Ezer AI, Performance.
--
-- Nothing a manager does in ESS depends on these: approvals, regularisation, team
-- attendance, appraisal review, travel, loans and resignations all go through the ESS
-- routes (lib/ess/session.ts essRoute), which read the reporting lines, not module grants.
-- ESS → My Team's team-mates list no longer needs Employees (app/api/rms/orgchart, own
-- peers). Anyone who also holds an HR / Payroll / admin role keeps that role's access:
-- permissions are the union of all roles held.
--
-- Rollback: set the rows back to their previous levels (VIEW, and EDIT for Transfer,
-- and Performance EDIT for L1 / L2, VIEW for HOD).
-- ===========================================================================

update public.role_permissions rp
   set access_level = 'NONE'
  from public.ess_roles r
 where rp.role_id = r.id
   and r.role_code in ('L1_MANAGER', 'L2_MANAGER', 'HOD')
   and rp.module in ('Employees', 'Transfer', 'Attendance', 'Attendance Reports', 'Reports', 'Loans',
                     'Travel Claims', 'Policies', 'Holidays', 'Support', 'Ezer AI', 'Performance');

-- Recruitment stays EDIT (raising an MRF).
update public.role_permissions rp
   set access_level = 'EDIT'
  from public.ess_roles r
 where rp.role_id = r.id
   and r.role_code in ('L1_MANAGER', 'L2_MANAGER', 'HOD')
   and rp.module = 'Recruitment';

NOTIFY pgrst, 'reload schema';
