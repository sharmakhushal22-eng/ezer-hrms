-- =====================================================================
-- ADAPTED FOR THIS DATABASE — see 082_access_foundation.sql
--
-- The bundle this came from assumes a schema that differs from the live one.
-- Every rename below was verified against the RUNNING database before it was
-- applied, not inferred from the code:
--
--   employee_code    -> emp_code          (employees)
--   date_of_joining  -> company_doj       (employees)
--   reports_to       -> l1_manager_id     (employees)
--   department_name  -> dept_name         (departments)
--   branches         -> locations          there is no branches table here,
--   branch_id           location_id        and employees.branch_id does not
--   branch_name         location_name      exist either
--
-- Nothing else was touched. is_active was left alone throughout: every
-- occurrence in this bundle is on the module's OWN tables (wall_admins,
-- board_screens, shoutout_categories, badge_master), not on companies.
--
-- can() and explain_access() come from 082, which reads the permission model
-- this app already has (ess_accounts / ess_user_roles / role_permissions)
-- rather than introducing a second one.
--
-- NOT APPLIED FROM HERE. Handed to Nayan.
-- =====================================================================

-- =====================================================================
-- EZER HRMS · migration 085_wall_of_fame_seed.sql
-- Provisioning defaults for the Wall of Fame module.
-- Depends: 084_wall_of_fame.sql
-- =====================================================================
-- This file installs a single function, seed_wall_defaults(company_id).
-- It is called once per company, by the EZER Super Admin, at the moment
-- the module is activated. It never runs automatically for all companies,
-- because activation is a commercial decision, not a migration side effect.
-- =====================================================================

begin;

create or replace function seed_wall_defaults(p_company uuid, p_owner uuid)
returns jsonb
language plpgsql
as $$
declare
  v_values  int := 0;
  v_awards  int := 0;
  v_badges  int := 0;
  v_award_id uuid;
begin
  -- seeds run in service context so the admin write guards let them through
  perform set_config('app.service_context', 'true', true);

  ---------------------------------------------------------------------
  -- config row (module stays OFF until Super Admin activates it)
  ---------------------------------------------------------------------
  insert into wall_config (company_id, module_enabled, board_enabled)
  values (p_company, false, false)
  on conflict (company_id) do nothing;

  ---------------------------------------------------------------------
  -- first Wall Owner. Granted by EZER, not self-granted.
  ---------------------------------------------------------------------
  if p_owner is not null then
    insert into wall_admins (company_id, employee_id, admin_level, granted_by, grant_reason)
    select p_company, p_owner, 'wall_owner',
           (select id from employees where company_id = p_company order by created_at limit 1),
           'Initial Wall Owner assigned at module activation'
    where not exists (
      select 1 from wall_admins
       where company_id = p_company and employee_id = p_owner and revoked_at is null);
  end if;

  ---------------------------------------------------------------------
  -- company values
  ---------------------------------------------------------------------
  insert into recognition_values (company_id, code, label, description, colour_token, sort_order)
  values
    (p_company,'first_time_right','First Time Right','Delivered correctly without rework or a second attempt.','blue',1),
    (p_company,'team_before_self','Team Before Self','Put the team result ahead of individual convenience.','green',2),
    (p_company,'bar_raiser','Bar Raiser','Raised the standard for everyone who does this work next.','violet',3),
    (p_company,'customer_first','Customer First','Solved it from the customer''s point of view.','cyan',4),
    (p_company,'safety_first','Safety First','Protected people and equipment before output.','rose',5),
    (p_company,'owns_it','Owns It','Took the problem end to end without being asked.','slate',6)
  on conflict (company_id, code) do nothing;
  get diagnostics v_values = row_count;

  ---------------------------------------------------------------------
  -- awards
  ---------------------------------------------------------------------
  insert into recognition_awards
    (company_id, code, name, description, frequency, scope, winners_per_cycle, points,
     auto_source, needs_nomination, eligible_nominators, approval_chain, badge_code, sort_order)
  values
    (p_company,'eom','Employee of the Month',
     'The single strongest contribution of the month, across the whole company.',
     'monthly','company',1,100,null,true,'{employee}','["rm_l1","hod","hr_manager"]','eom',1),

    (p_company,'safety_champion','Safety Champion',
     'Sustained safe practice or a safety improvement at a plant or warehouse.',
     'quarterly','branch',1,75,null,true,'{employee}','["rm_l1","hod","hr_manager"]','safety',2),

    (p_company,'bar_raiser','Bar Raiser of the Quarter',
     'Raised the working standard for a whole team or process.',
     'quarterly','company',1,75,null,true,'{rm_l1,hod}','["hod","hr_manager"]','bar_raiser',3),

    (p_company,'spot_award','Spot Award',
     'Immediate recognition a reporting manager can give without a cycle.',
     'anytime','department',10,25,null,true,'{rm_l1,rm_l2,hod}','["hr_manager"]','spot',4),

    (p_company,'long_service','Long Service Award',
     'Generated automatically from date of joining at 5, 10, 15 and 20 years.',
     'anytime','company',50,50,'doj_long_service',false,'{}','["hr_manager"]',null,5),

    (p_company,'perfect_attendance','Perfect Attendance',
     'Generated from the attendance module for a full month with no unplanned absence.',
     'monthly','branch',50,20,'attendance_perfect',false,'{}','["hr_manager"]','attendance',6),

    (p_company,'idea_shipped','Idea That Shipped',
     'A suggestion that was implemented and produced a measurable result.',
     'anytime','company',20,50,null,true,'{employee}','["hod","hr_manager"]','idea',7)
  on conflict (company_id, code) do nothing;
  get diagnostics v_awards = row_count;

  ---------------------------------------------------------------------
  -- badges
  ---------------------------------------------------------------------
  select id into v_award_id from recognition_awards where company_id = p_company and code = 'eom';

  insert into badge_master
    (company_id, code, label, glyph, shape, base_tier, tier_thresholds, value_code, service_years, sort_order)
  values
    (p_company,'eom','Employee of the Month','🏆','shield','bronze',
       '{"bronze":1,"silver":3,"gold":5,"platinum":10}',null,null,1),
    (p_company,'safety','Safety Champion','🦺','shield','bronze',
       '{"bronze":1,"silver":2,"gold":4,"platinum":8}',null,null,2),
    (p_company,'bar_raiser','Bar Raiser','📈','medal','bronze',
       '{"bronze":1,"silver":3,"gold":6,"platinum":12}',null,null,3),
    (p_company,'spot','Spot Award','⚡','medal','bronze',
       '{"bronze":1,"silver":5,"gold":10,"platinum":25}',null,null,4),
    (p_company,'idea','Idea That Shipped','💡','medal','bronze',
       '{"bronze":1,"silver":3,"gold":5,"platinum":10}',null,null,5),
    (p_company,'attendance','Perfect Attendance','📆','medal','bronze',
       '{"bronze":1,"silver":6,"gold":12,"platinum":24}',null,null,6),

    -- value badges: always blue, only the count grows
    (p_company,'v_ftr','First Time Right','🎯','hex','blue',
       '{"blue":1}','first_time_right',null,10),
    (p_company,'v_team','Team Before Self','🫱','hex','blue',
       '{"blue":1}','team_before_self',null,11),
    (p_company,'v_customer','Customer First','🤝','hex','blue',
       '{"blue":1}','customer_first',null,12),
    (p_company,'v_owns','Owns It','🧱','hex','blue',
       '{"blue":1}','owns_it',null,13),

    -- service rings: fixed metal per milestone
    (p_company,'svc5','5 Years of Service','','ring','bronze','{"bronze":1}',null,5,20),
    (p_company,'svc10','10 Years of Service','','ring','silver','{"silver":1}',null,10,21),
    (p_company,'svc15','15 Years of Service','','ring','gold','{"gold":1}',null,15,22),
    (p_company,'svc20','20 Years of Service','','ring','platinum','{"platinum":1}',null,20,23)
  on conflict (company_id, code) do nothing;
  get diagnostics v_badges = row_count;

  update recognition_awards set badge_code = 'eom' where id = v_award_id;

  perform set_config('app.service_context', 'false', true);

  return jsonb_build_object(
    'company_id', p_company,
    'values_created', v_values,
    'awards_created', v_awards,
    'badges_created', v_badges,
    'module_enabled', false,
    'next_step', 'EZER Super Admin must set wall_config.module_enabled = true after activation.'
  );
end $$;

comment on function seed_wall_defaults is
  'Provisions default values, awards and badges for one company. Called at module activation, never in bulk.';


-- =====================================================================
-- Long service generator. Runs nightly as a service job.
-- Creates a milestone recognition and awards the ring badge.
-- =====================================================================
create or replace function generate_service_milestones(p_company uuid)
returns int
language plpgsql
as $$
declare v_count int := 0; r record; v_badge text;
begin
  perform set_config('app.service_context', 'true', true);

  for r in
    select e.id, e.full_name, e.location_id,
           extract(year from age(current_date, e.company_doj))::int as yrs
      from employees e
     where e.company_id = p_company
       and e.company_doj is not null
       and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
       and extract(month from e.company_doj) = extract(month from current_date)
       and extract(day   from e.company_doj) = extract(day   from current_date)
       and extract(year from age(current_date, e.company_doj))::int in (5,10,15,20)
  loop
    v_badge := 'svc' || r.yrs;

    if not exists (
      select 1 from recognitions
       where company_id = p_company and kind = 'milestone'
         and receiver_employee_ids = array[r.id]
         and cycle_label = v_badge
    ) then
      insert into recognitions (company_id, location_id, kind, receiver_employee_ids,
                                message, visibility, cycle_label, points_awarded)
      values (p_company, r.location_id, 'milestone', array[r.id],
              format('%s completes %s years with us today.', r.full_name, r.yrs),
              'company', v_badge, 50);

      perform award_badge(r.id, v_badge);
      v_count := v_count + 1;
    end if;
  end loop;

  perform set_config('app.service_context', 'false', true);
  return v_count;
end $$;

commit;

-- =====================================================================
-- USAGE
-- =====================================================================
-- 1. At activation, EZER Super Admin runs:
--      select seed_wall_defaults('<company_uuid>', '<hr_head_employee_uuid>');
--
-- 2. Then, in the same admin session (app.current_employee_id set to the
--    Super Admin), flips the master switch:
--      update wall_config set module_enabled = true where company_id = '<company_uuid>';
--
-- 3. From that point the company's Wall Owner does everything else from
--    Studio > Wall of Fame > Setup. No further SQL is required.
--
-- 4. Nightly job (Vercel cron or Supabase scheduled function):
--      select generate_service_milestones(id) from companies;
--
--    NOTE: the bundle wrote this as "... from companies where is_active".
--    companies.is_active does not exist in this database — verified against
--    the live schema. The filter is removed rather than swapped for a
--    guess, because guessing which column means "live" could silently
--    skip real companies every night and nobody would see it fail.
--    If there is a liveness column, tell me and I will put it back.
