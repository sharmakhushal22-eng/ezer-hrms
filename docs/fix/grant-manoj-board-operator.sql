-- =====================================================================
-- grant-manoj-board-operator.sql
-- Give Manoj Kumar Sharma the Screens panel, and nothing more
--
-- Run in the Supabase SQL editor. A DATA change; no schema change.
--
-- WHO AND WHAT
--
--   target   Manoj Kumar Sharma · SRS0003 · 6dab412f-bbc6-469a-abbf-c8ea2657875b
--            company: Sharma Retail Solutions Pvt Ltd
--   level    board_operator — the LOWEST rung, and all that wof.board.manage
--            needs. It does not open Awards, Values, Badges, Audit or the
--            ability to appoint anybody. Handing out more than the panel
--            requires is how a "just let me see the TVs" request turns into
--            somebody who can rewrite the badge catalogue.
--
-- Verified before writing: he holds no wall grant today, he has not left, and
-- board_enabled is now true for all three companies — so this grant is the
-- only thing between him and the Screens panel.
--
-- WHY IT ACTS AS SOMEBODY ELSE
--
-- grant_wall_admin() checks wof_can(v_actor, 'wof.admin.grant'), and refuses
-- outright if the caller is not a Wall Owner. It reads that caller from
-- app.current_employee_id, which cannot be set over the API — so this has to
-- run in a SQL session, and it has to name an owner.
--
-- Kiran Reddy is used below. aadhar (SRS0001) is also a wall_owner now and
-- would work just as well; swap the id if the grant should be recorded
-- against them instead. It cannot be Manoj himself: line 694 of 084 refuses
-- to let anybody grant themselves.
--
-- SAFE TO RUN TWICE — the second run finds the grant and stops.
-- =====================================================================

do $$
declare
  v_target uuid := '6dab412f-bbc6-469a-abbf-c8ea2657875b';  -- Manoj Kumar Sharma, SRS0003
  v_owner  uuid := '358c74fb-e720-4c7d-973e-2dd2159bcc9e';  -- Kiran Reddy, SRS9047, wall_owner
  v_id     uuid;
begin
  if exists (select 1 from wall_admins
              where employee_id = v_target and revoked_at is null) then
    raise notice 'Manoj already holds a wall grant — nothing to do.';
    return;
  end if;

  -- Transaction-scoped. grant_wall_admin sees an actor entitled to grant, and
  -- the audit trigger records a real person rather than nobody.
  perform set_config('app.current_employee_id', v_owner::text, true);

  v_id := grant_wall_admin(
            v_target,
            'board_operator',
            'Operate the wall display screens at the Gurugram office');

  raise notice 'Granted board_operator to Manoj Kumar Sharma (grant %)', v_id;
end $$;

-- Read it back. Expect Manoj at board_operator, alongside the two owners.
select e.emp_code, e.full_name, a.admin_level, a.granted_at, a.grant_reason
  from wall_admins a
  join employees e on e.id = a.employee_id
 where a.revoked_at is null
 order by a.granted_at;

-- And confirm the gate agrees — this is the check the panel itself makes.
select wof_can('6dab412f-bbc6-469a-abbf-c8ea2657875b', 'wof.board.manage')
         as manoj_can_manage_screens,
       wof_can('6dab412f-bbc6-469a-abbf-c8ea2657875b', 'wof.configure')
         as manoj_can_configure;   -- expect true, then false
