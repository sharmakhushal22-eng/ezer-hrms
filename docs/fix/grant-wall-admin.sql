-- =====================================================================
-- grant-wall-admin.sql — give somebody the right to manage the wall
--
-- FOR: Nayan Ahuja. A DATA change, not a schema change.
--
-- WHY THIS IS NEEDED
--
-- "Manage the wall" shows every area locked because the whole database
-- contains exactly ONE wall grant, and it belongs to one person:
--
--     Kiran Reddy (SRS9047) — wall_owner in all three companies,
--     seeded by 085 at module activation.
--
-- Nobody else has a row in wall_admins, so for everybody else wof_can()
-- returns false for wof.configure, wof.badge.manage, wof.admin.grant and
-- wof.report.view, and the console locks all of them.
--
-- WHY IT CANNOT BE DONE IN THE APP
--
-- The Administrators panel is READ-ONLY — it lists wall_admins and has no
-- grant_wall_admin call anywhere in the component. So the first grant to
-- anyone new has to be made here.
--
-- TWO RULES IN grant_wall_admin (084:683) THAT SHAPE THIS SCRIPT
--
--   1. The caller must already hold wof.admin.grant, so the grant has to be
--      made while ACTING AS the existing Wall Owner. Hence the set_config.
--   2. `if v_actor = p_employee then raise` — you cannot grant to yourself.
--      Kiran cannot use this on Kiran. (He does not need to; he already has
--      wall_owner.) If the person who needs the rights IS Kiran, then nothing
--      is wrong with the grants and the problem is which portal is open —
--      see the note at the bottom.
--
-- SAFE TO RUN TWICE: a duplicate grant is skipped rather than stacked.
-- =====================================================================

do $$
declare
  -- ─── FILL THIS IN ───────────────────────────────────────────────────
  v_target_code text := 'REPLACE-ME';        -- employee CODE, e.g. 'SRS9047'
  v_level       text := 'wall_admin';        -- board_operator | wall_moderator
                                             -- | wall_admin | wall_owner
  v_reason      text := 'Wall administration for the HR team';
  -- ────────────────────────────────────────────────────────────────────

  -- The only current Wall Owner. The grant is made in their name, and the
  -- audit log records it that way.
  v_owner  uuid := '358c74fb-e720-4c7d-973e-2dd2159bcc9e';
  v_target uuid;
  v_id     uuid;
begin
  select id into v_target from employees where emp_code = v_target_code;
  if v_target is null then
    raise exception 'No employee has the code %. Check it and run again.', v_target_code;
  end if;

  if v_target = v_owner then
    raise exception 'That is the existing Wall Owner, who already holds every '
                    'wall permission. Nothing to grant — see the note at the '
                    'bottom of this file.';
  end if;

  if exists (select 1 from wall_admins
              where employee_id = v_target and revoked_at is null) then
    raise notice 'Already granted — nothing to do.';
    return;
  end if;

  -- Transaction-scoped, so grant_wall_admin sees an actor with the right to
  -- grant, and wall_audit() records a real person rather than nobody.
  perform set_config('app.current_employee_id', v_owner::text, true);

  v_id := grant_wall_admin(v_target, v_level, v_reason);
  raise notice 'Granted % to % (grant %)', v_level, v_target_code, v_id;
end $$;

-- Read it back. Expect the new person alongside Kiran Reddy.
select e.emp_code, e.full_name, a.admin_level, a.granted_at, a.grant_reason
  from wall_admins a
  join employees e on e.id = a.employee_id
 where a.revoked_at is null
 order by a.granted_at;

-- =====================================================================
-- NOTE ON MULTI-COMPANY
--
-- grant_wall_admin files the grant against the TARGET'S OWN company, taken
-- from employees.company_id. There are three companies here, and Kiran holds
-- wall_owner in all three because 085 seeded each one separately. If the new
-- administrator needs to manage more than their own company, run this once
-- per company with a direct insert instead — wall_admins has no write guard,
-- only an audit trigger.
--
-- NOTE ON "IT IS STILL LOCKED AFTER THIS"
--
-- Two causes that a grant will NOT fix:
--
--   • SCREENS stays locked regardless of grant, for everybody including the
--     Wall Owner, because wall_config.board_enabled is false for all three
--     companies and wof_can() tests the feature switch BEFORE the grant.
--     That one is data-fixes/enable-wall-boards.sql.
--
--   • The console reads the PORTAL OWNER'S permissions, not the viewer's.
--     components/ess/EmployeePortal.tsx renders <WallOfFame employeeId={emp.id}/>,
--     and emp is loaded from loadEmployeeDetail(employeeId) — the employee
--     whose portal is open. So an administrator looking at somebody else's ESS
--     portal sees THAT person's wall rights, all locked, even when their own
--     account is a Wall Owner. Open your own portal to see your own access.
-- =====================================================================
