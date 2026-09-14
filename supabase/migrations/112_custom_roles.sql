-- ============================================================================
-- 112 — Custom roles
--
-- Lets HR invent roles beyond the built-in fourteen from the access sheet.
-- A custom role is an ordinary ess_roles row; is_custom just marks the ones a
-- human made, so the delete path can refuse to touch a built-in role.
--
-- The rest of the machinery already exists: role_permissions grants a custom
-- role its module access, ess_user_roles assigns it to employees, and the
-- widest-access-wins union in lib/rms/modules.ts already handles an employee
-- holding several roles. Nothing else changes.
--
-- SAFE TO RUN TWICE.
-- ============================================================================

alter table public.ess_roles
  add column if not exists is_custom boolean not null default false;

comment on column public.ess_roles.is_custom is
  'True for HR-created roles (deletable). The built-in roles from the access matrix stay false.';

notify pgrst, 'reload schema';
