-- =====================================================================
-- make-aadhar-super-admin.sql
-- Give SRS0001 the ADMIN_SUPER role
--
-- Run in the Supabase SQL editor. A DATA change; no schema change.
--
-- WHAT THIS UNLOCKS, WHICH IS MORE THAN IT SOUNDS
--
-- ADMIN_SUPER is not "a bigger admin". It is the role is_ezer_staff() tests
-- for, and it is the ONLY thing that satisfies permissions flagged
-- ezer_only = true in access_permission_map. can() short-circuits on that
-- flag before it looks at any module access level:
--
--     IF m.ezer_only THEN RETURN is_ezer_staff(p_employee); END IF;
--
-- The clearest example is company.activate — "Activate a module for a
-- company". That is the switch that turns the Wall of Fame, PMS or any other
-- module on or off FOR A WHOLE COMPANY, and it is what
-- wof.module.activate resolves to. It was designed to sit with EZER, not
-- with a customer's own administrator: a Wall Owner runs the wall, and only
-- EZER decides the company has a wall at all.
--
-- Nobody holds ADMIN_SUPER today. Verified: zero active assignments, and
-- can(aadhar, 'company.activate', 'global') returns false even though they
-- already hold ALL_ACCESS.
--
-- BEFORE RUNNING, TWO THINGS WORTH A SECOND LOOK
--
--   1. This account reads as a seed record rather than a person:
--        full_name        'aadhar'      (lower case, no surname)
--        office_email     empty
--        designation      'SR Manager'
--      The highest privilege in the platform is easier to audit when it
--      belongs to a named human with a working mailbox.
--
--   2. must_change_password is still TRUE after 6 logins, the last on
--      3 September. A password that was never rotated from its issued value
--      is a poor thing to hang platform-wide rights on.
--
-- Neither blocks the grant. They are recorded because a reviewer reading
-- wall_audit_log in six months will want to know they were considered.
--
-- WHAT IT DOES NOT DO
--
-- ALL_ACCESS is kept. This ADDS a role rather than swapping one, because
-- removing an existing grant to add another risks taking away access that
-- something else depends on. If ALL_ACCESS should go, revoke it separately
-- and deliberately.
--
-- TO REVERSE IT
--
--     update ess_user_roles set is_active = false
--      where ess_account_id = '13635ccf-7f8a-497d-87fd-eddfaad8a39f'
--        and role_id = 'e6d4b595-6ea3-4c3a-9413-cc22078ef7d3';
--
-- SAFE TO RUN TWICE.
-- =====================================================================

do $$
declare
  v_account uuid := '13635ccf-7f8a-497d-87fd-eddfaad8a39f';  -- aadhar's ESS account
  v_role    uuid := 'e6d4b595-6ea3-4c3a-9413-cc22078ef7d3';  -- ADMIN_SUPER
  v_emp     uuid := '35f88814-cbca-49ad-83ad-b8318af09467';  -- aadhar, SRS0001
begin
  -- Re-check the three facts this script was written against, rather than
  -- trusting ids pasted from a console session.
  if not exists (select 1 from ess_accounts
                  where id = v_account and employee_id = v_emp and status = 'ACTIVE') then
    raise exception 'That ESS account is not an active account for SRS0001 — stopping.';
  end if;
  if not exists (select 1 from ess_roles where id = v_role and role_code = 'ADMIN_SUPER') then
    raise exception 'That role id is not ADMIN_SUPER — stopping.';
  end if;

  if exists (select 1 from ess_user_roles
              where ess_account_id = v_account and role_id = v_role and is_active) then
    raise notice 'aadhar already holds ADMIN_SUPER — nothing to do.';
    return;
  end if;

  -- Re-activate a previously revoked assignment rather than stacking a
  -- second row, so the history stays readable.
  if exists (select 1 from ess_user_roles
              where ess_account_id = v_account and role_id = v_role) then
    update ess_user_roles set is_active = true, assigned_at = now()
     where ess_account_id = v_account and role_id = v_role;
    raise notice 'Re-activated an existing ADMIN_SUPER assignment.';
  else
    insert into ess_user_roles (ess_account_id, role_id, is_active, assigned_at)
    values (v_account, v_role, true, now());
    raise notice 'ADMIN_SUPER granted to aadhar (SRS0001).';
  end if;
end $$;

-- Read it back: the roles aadhar now holds.
select r.role_code, r.role_name, r.scope, ur.is_active, ur.assigned_at
  from ess_user_roles ur
  join ess_roles r on r.id = ur.role_id
 where ur.ess_account_id = '13635ccf-7f8a-497d-87fd-eddfaad8a39f'
 order by r.role_code;

-- And confirm the gate agrees. Both should now be true; they are false today.
select is_ezer_staff('35f88814-cbca-49ad-83ad-b8318af09467')              as is_ezer_staff,
       can('35f88814-cbca-49ad-83ad-b8318af09467',
           'company.activate', 'global')                                  as can_activate_modules,
       wof_can('35f88814-cbca-49ad-83ad-b8318af09467',
               'wof.module.activate')                                     as can_activate_the_wall;
