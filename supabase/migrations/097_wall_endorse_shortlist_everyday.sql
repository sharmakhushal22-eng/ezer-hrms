-- =====================================================================
-- 097_wall_endorse_shortlist_everyday.sql
-- Open endorsing and shortlisting to every employee
--
-- FOR: Nayan Ahuja. Requested by Tushar: the Wall of Fame should be usable
-- by everyone, and administered only by the Wall Owner.
--
-- WHERE THINGS ALREADY STOOD
--
-- Measured against the live database on 4 Sep, for a real non-admin employee.
-- Almost all of that was already true: wof.view, wof.shoutout.create,
-- wof.react, wof.comment, wof.nominate, wof.mention, wof.inbox.view and
-- wof.message.send all return true for an ordinary employee, and every
-- administrative permission — wof.configure, wof.badge.manage,
-- wof.admin.grant, wof.report.view, wof.moderate, wof.publish — returns
-- false for everybody except the Wall Owner.
--
-- Exactly two were out of step:
--
--     wof.endorse     everyday=false  needs_level=EDIT
--     wof.shortlist   everyday=false  needs_level=EDIT
--
-- Both are admin_only=false in wall_permissions, so wof_can() falls through
-- to the RBAC model, and can() refuses them at the module-level check:
-- an ordinary employee has no EDIT on wall_of_fame. Endorsing a colleague's
-- nomination and shortlisting nominees were set up as reviewer actions.
--
-- WHAT THIS CHANGES
--
-- One column, on two rows, matched by primary key:
--
--     everyday = true
--
-- can() returns at `IF m.everyday THEN RETURN true` (082:159) before the
-- module-level check, which is precisely how wof.react, wof.comment and
-- wof.nominate are already open to everybody.
--
-- needs_level is deliberately LEFT AT 'EDIT'. Once everyday is true it is
-- never read: can() returns before line 162, and explain_access() calls can()
-- first and returns "You have access to this." before it would format a
-- message mentioning the level. Leaving it records what the requirement would
-- be if the everyday flag were ever switched back off — changing it would be
-- an extra edit with no behavioural effect.
--
-- BLAST RADIUS
--
-- access_permission_map is the SHARED RBAC table that every module reads
-- through can(), so it is worth being explicit: both rows have
-- module = 'wall_of_fame' and neither permission code is used outside the
-- wall. Nothing in Recruitment, Payroll, PMS or anywhere else changes.
--
-- READ THIS BEFORE RUNNING — IT FLATTENS THE NOMINATION CHAIN
--
-- 084 describes these two by the role that was meant to perform them:
--
--     ('wof.endorse',   'Endorse a nomination (RM L1)',  ...)
--     ('wof.shortlist', 'Shortlist a nomination (HOD)',  ...)
--
-- So they were not simply set too strictly. They are the review stages of the
-- nomination flow: an employee nominates, their reporting manager endorses,
-- the HOD shortlists, and an award follows. Marking them `everyday` means ANY
-- employee can endorse a nomination and shortlist nominees — the nomination
-- still exists, but the two filters between it and an award no longer
-- restrict who applies them.
--
-- Tushar asked for this deliberately, so that the wall is usable by everyone
-- and administered only by the Wall Owner. It is recorded here because the
-- description strings in 084 will otherwise read as contradicting the data,
-- and because the way back is one UPDATE:
--
--     update access_permission_map set everyday = false
--      where permission in ('wof.endorse','wof.shortlist');
--
-- WHAT THIS DOES NOT CHANGE
--
--   • No administrative permission is touched. The wall stays editable by
--     the Wall Owner alone.
--   • It does not fix "permission denied for function create_shoutout_as".
--     That is the server's database key not resolving to service_role, which
--     happens well after the permission gate and affects the Wall Owner as
--     much as anybody. It needs its own fix.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

update access_permission_map
   set everyday = true
 where permission in ('wof.endorse', 'wof.shortlist')
   and everyday is distinct from true;   -- re-running touches no rows

-- Read it back. Expect everyday = true on both, sitting alongside the other
-- everyday wall permissions.
select permission, module, everyday, needs_level
  from access_permission_map
 where permission in ('wof.endorse', 'wof.shortlist',
                      'wof.react', 'wof.comment', 'wof.nominate')
 order by everyday desc, permission;
