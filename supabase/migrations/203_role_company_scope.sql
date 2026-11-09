-- 203_role_company_scope.sql
-- ===========================================================================
-- ROLE SCOPE BY COMPANY: which companies an assigned role is valid in.
--
-- SAFE TO RUN TWICE.
--
-- ess_user_roles.company_ids — the companies the role applies to for this person, chosen
-- when the role is assigned (Onboarding → Generate code → Roles: "Valid in companies").
-- NULL or empty = the employee's own company, exactly as before, so every existing
-- assignment keeps its meaning.
--
-- Read by lib/rms/resolve.ts: each module's screens may show and pick the companies of the
-- roles that grant it (Grant.companiesByModule), and companyFilter() pins every read to
-- one of them. EMPLOYEE, L1_MANAGER, L2_MANAGER and HOD are always own-company whatever
-- is stored here. A super admin / ORG-scoped role still crosses every company.
-- ===========================================================================

ALTER TABLE public.ess_user_roles ADD COLUMN IF NOT EXISTS company_ids uuid[];

COMMENT ON COLUMN public.ess_user_roles.company_ids IS
  'Companies this role is valid in for this person; NULL/empty = the employee''s own company.';

NOTIFY pgrst, 'reload schema';
