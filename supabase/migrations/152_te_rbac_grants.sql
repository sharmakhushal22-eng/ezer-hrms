-- 152_te_rbac_grants.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  ROLE GRANTS FOR THE NEW SCREENS
-- SAFE TO RUN TWICE. Run after 149 (order against 150 / 151 does not matter).
-- Copy to supabase/migrations/152_te_rbac_grants.sql.
-- ----------------------------------------------------------------------------
-- WHAT THE APP CHECKS (lib/te/server.ts, teHolds)
--
--   who                    needs, in role_permissions            already granted by 124 to
--   ---------------------  ------------------------------------  ---------------------------------
--   employee, approver     nothing (the SQL functions decide)    —
--   Finance desk           module 'Finance'        VIEW or more  FINANCE_EXECUTIVE (FULL), CFO, MD,
--                          AND a row in finance_team             HR_HEAD, CHRO, PAYROLL(_ADMIN) (VIEW)
--   Travel Desk            module 'Travel Claims'  EDIT or more  HR_MANAGER, ADMIN_COMPANY (FULL)
--   Admin (settings,       module 'Travel Claims'  FULL          HR_MANAGER, ADMIN_COMPANY (FULL)
--   masters, workflow)
--
-- So NO module level has to change for the product to work: the new page
-- /dashboard/expenses is mapped to the existing 'Travel Claims' module
-- (lib/rms/modules.ts). This file therefore does two small things only.
--
-- IMPORTANT, DIFFERENT FROM THE REST OF THE APP: the Travel & Expense routes
-- check the level even while rms_config.enforce_module_access is OFF. If the
-- Travel Desk is a team that holds neither HR_MANAGER nor ADMIN_COMPANY, give
-- their role 'Travel Claims' = EDIT in Roles & Access (or add a line to PART 2).
--
-- PART 1 — the tabs of /dashboard/expenses (lib/rms/screens.ts: travel.TE_*)
--   canSeeScreen() shows every tab of a module to a role that has NO screen
--   rows for it, and only the listed tabs to a role that has ANY. Migration 125
--   gave six roles travel.* rows, so for those six the new tabs must be granted
--   or they stay hidden. A role with no travel.* row is left alone on purpose:
--   adding its first row would HIDE the old Travel Claims tabs from it.
-- ============================================================================

insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  -- approvers: what is waiting for them
  ('L1_MANAGER',        'travel.TE_APPROVALS'),
  ('L2_MANAGER',        'travel.TE_APPROVALS'),
  ('HOD',               'travel.TE_APPROVALS'),
  -- HR leadership: approvals and the claim register
  ('HR_HEAD',           'travel.TE_APPROVALS'),
  ('HR_HEAD',           'travel.TE_REPORTS'),
  ('CHRO',              'travel.TE_APPROVALS'),
  ('CHRO',              'travel.TE_REPORTS'),
  -- Finance: the desk, the queue and the register
  ('FINANCE_EXECUTIVE', 'travel.TE_APPROVALS'),
  ('FINANCE_EXECUTIVE', 'travel.TE_FINANCE'),
  ('FINANCE_EXECUTIVE', 'travel.TE_REPORTS')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
-- only a role that is already restricted to a list of travel tabs (see the header)
where exists (select 1 from public.role_screen_access x
               where x.role_id = r.id and x.screen_key like 'travel.%' and x.screen_key not like 'travel.TE\_%')
on conflict (role_id, screen_key) do nothing;

-- PART 2 — module levels. Nothing is lowered and nothing existing is changed:
-- "do nothing" on conflict keeps whatever an admin has set since migration 124.
-- These two rows only matter on a database where 124 was never run.
insert into public.role_permissions (role_id, module, access_level)
select r.id, v.module, v.access_level
from (values
  ('FINANCE_EXECUTIVE', 'Finance',       'FULL'),
  ('HR_MANAGER',        'Travel Claims', 'FULL')
) as v(role_code, module, access_level)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, module) do nothing;

-- CHECK AFTERWARDS (read-only): who can do what in Travel & Expenses
--   select r.role_code, p.module, p.access_level
--     from public.role_permissions p join public.ess_roles r on r.id = p.role_id
--    where p.module in ('Travel Claims', 'Finance') and p.access_level <> 'NONE'
--    order by p.module, p.access_level desc, r.role_code;
--   select r.role_code, s.screen_key from public.role_screen_access s join public.ess_roles r on r.id = s.role_id
--    where s.screen_key like 'travel.TE\_%' order by 1, 2;
--   select * from te_health();            -- row "Finance team" must be ok

notify pgrst, 'reload schema';
