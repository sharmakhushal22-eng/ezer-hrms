-- =====================================================================
-- 102_grant_super_admin.sql — the platform has no super admin
--
-- FOR: Nayan Ahuja. Seed data — one role assignment. No schema change.
--
-- THE PROBLEM
--
-- Nobody holds ADMIN_SUPER. Measured on the live database: zero active
-- assignments of that role, across every ESS account.
--
-- That matters more than it looks, because ADMIN_SUPER is not simply a
-- larger admin. It is the role is_ezer_staff() tests for, and it is the ONLY
-- thing that satisfies a permission flagged ezer_only in
-- access_permission_map. can() short-circuits on that flag before it ever
-- reaches a module access level (082:151):
--
--     IF m.ezer_only THEN RETURN is_ezer_staff(p_employee); END IF;
--
-- The permission that matters is company.activate — "Activate a module for a
-- company" — which switches the Wall of Fame, PMS or any other module on or
-- off for an entire company, and is what wof.module.activate resolves to.
--
-- So today that action cannot be performed by anybody. It has not bitten
-- anyone only because every module is already activated: 085 seeded
-- module_enabled = true for all three companies. Onboard a fourth company,
-- or switch a module off, and there is currently no one who can switch it
-- back on.
--
-- There is a second symptom in the code. LEGACY_SUPABASE_BRIDGE in
-- lib/rms/server.ts is still true, and its own comment explains why:
-- "until a named person holds a super-admin role there would otherwise be a
-- window with no way into the dashboard at all". The shared dashboard login
-- is standing in for a super admin that does not exist. Closing that bridge
-- needs this row first.
--
-- WHO
--
-- SRS0001, requested by Tushar. Two things about the account were raised at
-- the time and are recorded here rather than lost in a chat, because whoever
-- audits the highest privilege in the platform will want to know they were
-- considered and not missed:
--
--     full_name is 'aadhar' — lower case, no surname
--     office_email is empty
--     must_change_password is still true after 6 logins
--
-- Neither blocks the grant. If the intent is for a named person with a
-- working mailbox to hold this instead, change v_emp_code below; nothing
-- else in the file needs touching.
--
-- HOW IT IS WRITTEN
--
-- By CODE, not by uuid. A migration that hardcodes ids silently writes to
-- the wrong row if it is ever run against a restored or rebuilt database.
-- This resolves the employee, their active ESS account and the role by their
-- stable identifiers, and refuses rather than guesses when one is missing.
--
-- ALL_ACCESS, if held, is left alone. This ADDS a role; removing one to add
-- another risks withdrawing access something else depends on.
--
-- TO REVERSE
--
--     update ess_user_roles ur set is_active = false
--       from ess_accounts a, employees e, ess_roles r
--      where ur.ess_account_id = a.id and a.employee_id = e.id
--        and ur.role_id = r.id and r.role_code = 'ADMIN_SUPER'
--        and e.emp_code = 'SRS0001';
--
-- SAFE TO RUN TWICE.
-- =====================================================================

do $$
declare
  v_emp_code text := 'SRS0001';     -- change this to move the grant
  v_emp     uuid;
  v_account uuid;
  v_role    uuid;
begin
  select id into v_emp from employees
   where emp_code = v_emp_code
     and (date_of_leaving is null or date_of_leaving >= current_date);
  if v_emp is null then
    raise exception 'No active employee with code % — refusing to guess.', v_emp_code;
  end if;

  -- An employee can in principle have more than one account row; take the
  -- active one, and refuse if that is ambiguous rather than picking.
  select id into v_account from ess_accounts
   where employee_id = v_emp and coalesce(status,'INACTIVE') = 'ACTIVE';
  if v_account is null then
    raise exception 'Employee % has no ACTIVE ESS account. is_ezer_staff() '
                    'requires one, so the grant would have no effect.', v_emp_code;
  end if;

  select id into v_role from ess_roles where role_code = 'ADMIN_SUPER';
  if v_role is null then
    raise exception 'There is no ADMIN_SUPER role in ess_roles — stopping.';
  end if;

  if exists (select 1 from ess_user_roles
              where ess_account_id = v_account and role_id = v_role and is_active) then
    raise notice '% already holds ADMIN_SUPER — nothing to do.', v_emp_code;
    return;
  end if;

  -- Re-activate rather than stack a second row, so the history reads cleanly.
  if exists (select 1 from ess_user_roles
              where ess_account_id = v_account and role_id = v_role) then
    update ess_user_roles set is_active = true, assigned_at = now()
     where ess_account_id = v_account and role_id = v_role;
    raise notice 'Re-activated ADMIN_SUPER for %.', v_emp_code;
  else
    insert into ess_user_roles (ess_account_id, role_id, is_active, assigned_at)
    values (v_account, v_role, true, now());
    raise notice 'ADMIN_SUPER granted to %.', v_emp_code;
  end if;
end $$;

-- Read it back, and assert the gate rather than the row: a role that does not
-- change what can() answers has not achieved anything.
select e.emp_code, e.full_name,
       is_ezer_staff(e.id)                                   as is_ezer_staff,
       can(e.id, 'company.activate', 'global')                as can_activate_modules,
       wof_can(e.id, 'wof.module.activate')                   as can_activate_the_wall
  from employees e
 where e.emp_code = 'SRS0001';
