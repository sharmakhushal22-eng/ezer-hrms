-- =====================================================================
-- 095_wall_explain_alignment.sql — stop the explainer contradicting the gate
--
-- THE BUG
--
-- The admin console asks two questions: wof_can() decides whether a panel is
-- locked, and wof_explain_access() supplies the reason. They were written
-- separately and drifted, so the console could show a padlock captioned
-- "Allowed."
--
-- That is exactly what a Wall Owner saw on the Screens panel. wof_can()
-- refuses wof.board.manage when board_enabled is false — the feature switch is
-- tested BEFORE the admin grant — while wof_explain_access() tests no feature
-- switch at all and fell through to 'Allowed.'
--
-- The explainer was missing FIVE of the gate's tests:
--   • the employee has left            • the five feature switches
--   • the per-location override        • the super-admin branch
--   • the RBAC fall-through for everyday permissions
--
-- So it also said "Allowed." to a separated employee, to anyone at a branch
-- where the wall is switched off, and to anyone RBAC refuses.
--
-- THE FIX, AND WHY IT CANNOT DRIFT AGAIN
--
-- The verdict is no longer re-derived here. wof_explain_access() now CALLS
-- wof_can() and only explains the answer it gets. Copying the nine tests into
-- a second function is what caused this; a second copy would rot the same way
-- the first did. Everything below the verdict exists solely to choose the
-- wording, and cannot change the outcome.
--
-- Signature is unchanged on purpose: adding a p_branch argument would create a
-- four-argument overload beside the three-argument one, and PostgREST would
-- then have two candidates for the console's existing call.
--
-- DEPENDS ON 084. No schema change — one function is replaced.
-- SAFE TO RUN TWICE.
-- =====================================================================

create or replace function wof_explain_access(
  p_employee   uuid,
  p_permission text,
  p_company    uuid default null
) returns text
language plpgsql stable as $$
declare
  v_company uuid;
  v_cfg     wall_config%rowtype;
  v_min     text;
  v_admin   boolean;
  v_left    boolean;
  v_switch  boolean;
begin
  -- The single source of truth. If this says yes, nothing below may say no.
  if wof_can(p_employee, p_permission, p_company, null) then
    return 'Allowed.';
  end if;

  if p_employee is null then
    return 'No employee to check.';
  end if;

  select coalesce(p_company, company_id) into v_company from employees where id = p_employee;
  if v_company is null then
    return 'This employee is not attached to a company.';
  end if;

  select (date_of_leaving is not null and date_of_leaving < current_date)
    into v_left from employees where id = p_employee;
  if v_left then
    return 'This employee has left the organisation.';
  end if;

  select * into v_cfg from wall_config where company_id = v_company;
  if v_cfg.company_id is null then
    return 'Module has never been set up for this company.';
  end if;
  if not v_cfg.module_enabled then
    return 'Module is not activated. EZER Super Admin must activate it.';
  end if;

  select admin_only, min_level into v_admin, v_min
    from wall_permissions where code = p_permission;
  if v_admin is null then
    return 'Unknown permission code.';
  end if;

  -- The tests the old version skipped. Named individually because "a feature
  -- is off" sends somebody to a switch, while "ask for a grant" sends them to
  -- a person — and the whole point of this message is which one to do.
  v_switch := case p_permission
    when 'wof.view'            then v_cfg.wall_enabled
    when 'wof.shoutout.create' then v_cfg.shoutouts_enabled
    when 'wof.nominate'        then v_cfg.nominations_enabled
    when 'wof.react'           then v_cfg.reactions_enabled
    when 'wof.board.manage'    then v_cfg.board_enabled
    else true
  end;
  if not v_switch then
    return case p_permission
      when 'wof.board.manage' then
        'Wall boards are switched off for this company. Switch on "board" in '
        || 'the Wall of Fame settings — an administrator grant will not open '
        || 'this on its own.'
      else
        format('This feature is switched off for the company, so %s is '
               || 'unavailable to everybody. It is a settings switch, not a '
               || 'permission.', p_permission)
    end;
  end if;

  if v_admin then
    if v_min = 'super_admin' then
      return 'Restricted to EZER Super Admin.';
    end if;
    if not is_wall_admin(p_employee, v_company, v_min) then
      return format('Requires Wall Administrator level %s or above. '
                    || 'Ask a Wall Owner to grant it.', v_min);
    end if;
    -- Holds the grant, passes every switch, and wof_can still refused.
    -- This should not be reachable: wof_can is called above with a null
    -- branch, and is_wall_admin ignores the location override when the branch
    -- is null, so the two agree by construction. It is here so that a future
    -- change to wof_can surfaces as an honest "I don't know" rather than as a
    -- confident wrong reason — which is the bug this migration exists to fix.
    return 'Refused by the access gate, for a reason this screen could not '
           || 'determine. Please report it.';
  end if;

  return 'Your role does not include this permission.';
end $$;

comment on function wof_explain_access is
  'Explains the verdict wof_can() returned. It calls wof_can rather than '
  're-deriving it, so the two can never disagree — they did, and the console '
  'showed a locked panel captioned "Allowed."';
