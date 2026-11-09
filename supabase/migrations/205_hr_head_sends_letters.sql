-- 205_hr_head_sends_letters.sql
-- ===========================================================================
-- HR HEAD: may issue letters (People → Letters).
--
-- SAFE TO RUN TWICE.
--
-- Sending a letter needs HR Letters at EDIT (app/api/letters/studio, and the appointment
-- letter from Pending letters, app/api/onboarding/appointment-letter, which also accepts
-- HR Letters EDIT). The HR Head held VIEW; decided 31-Oct-2026 that they send letters too.
-- Their Onboarding access is unchanged.
-- ===========================================================================

update public.role_permissions rp
   set access_level = 'EDIT'
  from public.ess_roles r
 where rp.role_id = r.id
   and r.role_code = 'HR_HEAD'
   and rp.module = 'HR Letters'
   and rp.access_level in ('NONE', 'VIEW');

-- A role with no HR Letters row at all gets one.
insert into public.role_permissions (role_id, module, access_level)
select r.id, 'HR Letters', 'EDIT'
  from public.ess_roles r
 where r.role_code = 'HR_HEAD'
   and not exists (select 1 from public.role_permissions p where p.role_id = r.id and p.module = 'HR Letters');

NOTIFY pgrst, 'reload schema';
