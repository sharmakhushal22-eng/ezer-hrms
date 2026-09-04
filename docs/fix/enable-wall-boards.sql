-- =====================================================================
-- enable-wall-boards.sql — unlock the "Screens" panel (wall TVs)
--
-- FOR: Nayan Ahuja. This is a DATA change, not a schema change.
--
-- WHY
--
-- The Screens panel is locked for everybody, including the Wall Owner. It is
-- not a permission problem — wall boards are switched OFF for every company:
--
--     wall_config.board_enabled = false   (all three companies)
--
-- wof_can() tests the feature switch BEFORE it looks at the administrator
-- grant, so no grant can open this panel while the switch is off.
--
-- Verified 4 Sep against the live database: wof_can(<wall owner>,
-- 'wof.board.manage') returns false, while wof.configure, wof.badge.manage,
-- wof.admin.grant and wof.report.view all return true for the same person.
--
-- WHY THIS IS NOT A PLAIN UPDATE
--
-- wall_config carries two triggers:
--   trg_guard_wall_config  BEFORE UPDATE — enforce_wall_admin('wof.configure')
--   trg_audit_config       AFTER  UPDATE — wall_audit()
--
-- The guard raises 42501 unless there is a session actor, so a bare UPDATE in
-- the SQL editor fails outright. Setting app.current_employee_id satisfies it
-- AND gives wall_audit() a real person to record — enable-by-service-context
-- would work too, but would log the change against nobody. A settings change
-- that opens a screen to a whole company should have a name attached to it.
--
-- The actor below is the Wall Owner seeded by 085, who holds wof.configure in
-- all three companies. Change it if somebody else should own the change.
-- =====================================================================

begin;

-- Transaction-scoped. Both triggers run inside this transaction and see it.
select set_config('app.current_employee_id',
                  '358c74fb-e720-4c7d-973e-2dd2159bcc9e',   -- Kiran Reddy (SRS9047), wall_owner
                  true);

-- Explicitly listed, never a bare UPDATE. Delete the lines for any company
-- that should NOT have wall boards.
update wall_config
   set board_enabled = true
 where company_id in (
   'c3eb1b50-24b5-49e0-9e60-a5a87702aab4',   -- Sharma Retail Solutions Pvt Ltd
   'e15b8aeb-266e-47ab-8f7c-02b2bee31127',   -- Sharma Sons Manufacturing Pvt Ltd
   '96b6ec21-f545-4bcd-82b6-1a1f8e5e19da'    -- Sharma Trading Corporation
 );

-- Read it back before committing. Expect three rows, all true.
select c.company_name, w.board_enabled
  from wall_config w
  join companies c on c.id = w.company_id
 where w.company_id in (
   'c3eb1b50-24b5-49e0-9e60-a5a87702aab4',
   'e15b8aeb-266e-47ab-8f7c-02b2bee31127',
   '96b6ec21-f545-4bcd-82b6-1a1f8e5e19da'
 )
 order by c.company_name;

commit;

-- =====================================================================
-- AFTER THIS RUNS
--
-- The Screens panel opens for anyone holding board_operator or above — which
-- today is only the Wall Owner, since wall_admins has exactly one grant.
--
-- The panel will still be EMPTY: board_screens has zero rows, so no TV has
-- been paired yet. Registering one is itself guarded by
-- trg_guard_screens → wof.board.manage, which is precisely the permission
-- this script unlocks. Enable first, pair second — in that order, or the
-- insert is refused.
-- =====================================================================
