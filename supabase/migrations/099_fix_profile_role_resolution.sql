-- =====================================================================
-- 099_fix_profile_role_resolution.sql
-- get_employee_profile() failed for every caller
--
-- FOR: Nayan Ahuja. One function replaced. No schema change.
--
-- THE SYMPTOM
--
--     select get_employee_profile('<employee>', '<viewer>');
--     ERROR:  column ur.employee_id does not exist          [42703]
--
-- get_employee_profile is the single entry point for the whole Profile
-- module, so every profile page fails to load anything at all.
--
-- THE CAUSE — mine, not the vendor's
--
-- When 091 was adapted from the vendor drop, their code read a table called
-- employee_roles, which does not exist here. Redirecting it to ess_user_roles
-- was right. Assuming ess_user_roles keys on employee_id was not:
--
--     ess_user_roles(id, ess_account_id, role_id, assigned_by,
--                    assigned_at, is_active)
--
-- It keys on ess_account_id, so an employee is reached through ess_accounts.
-- The correct path is the one lib/rms/server.ts already uses:
--
--     employees.id -> ess_accounts.employee_id
--     ess_accounts.id = ess_user_roles.ess_account_id -> ess_roles
--
-- Two smaller errors in the same block, both fixed here:
--
--   * `ur.is_active` was not filtered. The canonical resolver in
--     lib/rms/server.ts does filter it, so a revoked role would still have
--     counted as HR.
--   * The role list contained 'SUPER_ADMIN', which is not a role_code in this
--     database. The real codes are ADMIN_SUPER and ALL_ACCESS. Harmless — a
--     dead entry in an IN list — but it would have silently failed to
--     recognise a super admin. HR_EXECUTIVE and BRANCH_HR are added for the
--     same reason: they exist and clearly belong.
--
-- EVERYTHING ELSE IS UNCHANGED. The body below is 091's, byte for byte,
-- except the role-resolution block. The masking rules, the payload shape and
-- the completeness call are exactly as applied.
--
-- DEPENDS ON 091. SAFE TO RUN TWICE.
-- =====================================================================

create or replace function get_employee_profile(p_employee_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record; viewer record; role text := 'peer'; j jsonb; comp record;
begin
  select * into v from v_employee_profile_360 where id = p_employee_id;
  if not found then return jsonb_build_object('error', 'employee_not_found'); end if;

  select * into viewer from employees where id = p_viewer_id;
  if not found then return jsonb_build_object('error', 'viewer_not_found'); end if;

  -- Somebody who has left cannot read profiles, including their own.
  if viewer.date_of_leaving is not null and viewer.date_of_leaving < current_date then
    return jsonb_build_object('error', 'viewer_inactive');
  end if;

  -- Role is POSITIONAL, not assigned: who you are to THIS employee.
  --
  -- The module read employee_roles, which does not exist here. Roles live in
  -- ess_user_roles joined to ess_roles — but that table keys on
  -- ess_account_id, NOT employee_id, so it has to be reached through
  -- ess_accounts. This is the path lib/rms/server.ts already uses, and
  -- getting it wrong is what made this function fail for every caller.
  if exists (
    select 1
      from ess_accounts a
      join ess_user_roles ur on ur.ess_account_id = a.id and ur.is_active
      join ess_roles r       on r.id = ur.role_id
     where a.employee_id = p_viewer_id
       and r.role_code in ('HR_MANAGER','HR_HEAD','HR_EXECUTIVE','BRANCH_HR','CHRO',
                           'PAYROLL','PAYROLL_ADMIN',
                           'ADMIN_COMPANY','ADMIN_SUPER','ALL_ACCESS')
  ) then role := 'hr';
  elsif p_viewer_id = v.reports_to_l1 or p_viewer_id = v.reports_to_l2
     or p_viewer_id = v.hod_id or p_viewer_id = v.md_id
  then role := 'manager';
  elsif p_viewer_id = p_employee_id
  then role := 'self';
  end if;

  j := to_jsonb(v);

  -- Strip what this viewer may not read. Removed from the payload entirely
  -- rather than blanked, so nothing sensitive travels and is merely hidden.
  if role <> 'hr' then
    j := j - 'pan' - 'passport_no' - 'bank_holder_name';
  end if;
  if role not in ('hr','self') then
    j := j - 'aadhar_last4' - 'bank_last4' - 'ifsc' - 'bank_name'
           - 'personal_email' - 'mobile' - 'alt_mobile'
           - 'present_address' - 'permanent_address'
           - 'emergency_contact_1' - 'emergency_contact_2'
           - 'date_of_birth' - 'father_name' - 'mother_name' - 'spouse_name'
           - 'uan' - 'pf_number' - 'esic_ip_number' - 'driving_licence' - 'voter_id';
  end if;
  -- Pay is manager-and-above, and never a peer's business.
  if role not in ('hr','manager','self') then
    j := j - 'annual_ctc' - 'gross_monthly';
  end if;
  if role = 'peer' then
    j := j - 'annual_ctc' - 'gross_monthly';
  end if;

  select * into comp from profile_completeness(p_employee_id);

  return jsonb_build_object(
    'employee',    j,
    'viewer_role', role,
    'completeness', jsonb_build_object(
      'score',   coalesce(comp.score, 0),
      'pending', coalesce(to_jsonb(comp.pending), '[]'::jsonb)),
    'family',      coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at)
                             from employee_family_members f
                             where f.employee_id = p_employee_id), '[]'::jsonb),
    'nominations', coalesce((select jsonb_agg(to_jsonb(n) order by n.scheme)
                             from employee_nominations n
                             where n.employee_id = p_employee_id), '[]'::jsonb),
    'insurance',   coalesce((select jsonb_agg(to_jsonb(i))
                             from employee_insurance i
                             where i.employee_id = p_employee_id and i.is_active), '[]'::jsonb),
    'documents',   coalesce((select jsonb_agg(to_jsonb(dd) order by dd.created_at desc)
                             from employee_documents dd
                             where dd.employee_id = p_employee_id), '[]'::jsonb),
    'assets',      coalesce((select jsonb_agg(to_jsonb(a) order by a.issued_on desc)
                             from employee_assets a
                             where a.employee_id = p_employee_id), '[]'::jsonb),
    'education',   coalesce((select jsonb_agg(to_jsonb(ed) order by ed.to_year desc)
                             from employee_education ed
                             where ed.employee_id = p_employee_id), '[]'::jsonb),
    'experience',  coalesce((select jsonb_agg(to_jsonb(ex) order by ex.from_date desc)
                             from employee_experience ex
                             where ex.employee_id = p_employee_id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(to_jsonb(ce) order by ce.issued_on desc)
                             from employee_certifications ce
                             where ce.employee_id = p_employee_id), '[]'::jsonb),
    'trainings',   coalesce((select jsonb_agg(to_jsonb(tr) order by tr.due_date)
                             from employee_trainings tr
                             where tr.employee_id = p_employee_id), '[]'::jsonb),
    'app_access',  coalesce((select jsonb_agg(to_jsonb(aa))
                             from employee_app_access aa
                             where aa.employee_id = p_employee_id
                               and aa.revoked_on is null), '[]'::jsonb)
  );
end $$;
