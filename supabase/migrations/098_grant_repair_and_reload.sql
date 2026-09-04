-- =====================================================================
-- 098_grant_repair_and_reload.sql
-- Repair the EXECUTE grants the server needs, or say exactly what is wrong
--
-- FOR: Nayan Ahuja. No schema change — grants only.
--
-- THE SYMPTOM
--
-- Posting a shoutout from the app fails with
--
--     permission denied for function create_shoutout_as
--
-- 094 IS applied: all thirteen wrappers exist, and calling one with the
-- publishable (anon) key returns 42501 rather than PGRST202, which proves the
-- REVOKE in 094 ran. The GRANT sits in the same loop body, one line later, so
-- it should have run too — yet the server, which connects with the secret
-- key, is refused as well.
--
-- Two causes fit, and this file addresses both without needing to know which:
--
--   1. The grant did not survive — re-granting is harmless if it is present.
--   2. PostgREST is serving a schema cache built before the grant. The
--      NOTIFY at the bottom makes it rebuild.
--
-- If neither is it, the SELECT at the end prints the actual ACL, which names
-- the role that really holds EXECUTE. Send me that output and I will write
-- the exact fix rather than another guess.
--
-- NOTHING HERE WIDENS ACCESS. Only service_role is granted. anon and
-- authenticated are re-revoked, because these functions take the actor as an
-- argument: reachable from a browser, any employee could act as any other.
--
-- DEPENDS ON 094. Run 096 first if you have not — it creates the three Fun
-- Zone wrappers this also repairs. SAFE TO RUN TWICE.
-- =====================================================================

-- Fail loudly if the role the whole design assumes is not there. A silent
-- no-op here would leave the app broken with no clue why.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception
      'There is no role called service_role on this database. Every GRANT in '
      '094, 096 and this file targets it. Roles present: %',
      (select string_agg(rolname, ', ' order by rolname)
         from pg_roles where rolname not like 'pg\_%');
  end if;
end $$;

do $$
declare
  f text;
  targets text[] := array[
    -- 094, the wall
    'get_wall_inbox_as(uuid,text,int,timestamptz)',
    'get_inbox_counts_as(uuid)',
    'get_company_feed_as(uuid,text,text,text,int,timestamptz)',
    'get_feed_stats_as(uuid,uuid)',
    'create_shoutout_as(uuid,uuid[],text,text,uuid[],text)',
    'add_comment_as(uuid,uuid,text,uuid,uuid[])',
    'send_appreciation_as(uuid,uuid[],text,text,uuid,boolean,text)',
    'thank_for_appreciation_as(uuid,uuid,text)',
    'thank_back_as(uuid,uuid)',
    'mark_inbox_read_as(uuid,uuid[])',
    'request_share_to_feed_as(uuid,uuid)',
    'approve_share_to_feed_as(uuid,uuid,text)',
    'set_recognition_marks_as(uuid,uuid,text,text[])',
    'wof_act_as(uuid)'
  ];
begin
  -- 096's three are added only if 096 has been run, so this file works
  -- whether it goes before or after it.
  if to_regprocedure('accept_game_invite_as(uuid,uuid)') is not null then
    targets := targets || array[
      'accept_game_invite_as(uuid,uuid)',
      'finish_game_as(uuid,uuid,jsonb,jsonb)',
      'share_game_score_as(uuid,uuid,uuid[],text)'
    ];
  else
    raise notice '096 has not been run yet — Fun Zone wrappers skipped. '
                 'Run 096, then run this file again.';
  end if;

  foreach f in array targets loop
    execute format('revoke all on function %s from public, anon, authenticated', f::regprocedure);
    execute format('grant execute on function %s to service_role', f::regprocedure);
  end loop;
end $$;

-- PostgREST decides which functions a role may see from a cached snapshot of
-- the catalogue. A grant made after that snapshot was taken is not visible
-- until it reloads, which is one of the two things that would produce the
-- symptom above.
notify pgrst, 'reload schema';

-- ─── WHAT TO SEND ME IF IT STILL FAILS ───────────────────────────────
-- proacl reads like {owner=X/owner,service_role=X/owner}. "service_role=X"
-- means service_role holds EXECUTE. If it is absent, the grant is not
-- landing; if it is present and the app still fails, the server's key is
-- resolving to some other role and I need to know which.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner)               as owner,
       coalesce(array_to_string(p.proacl, E'\n'), '(default: PUBLIC)') as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('create_shoutout_as', 'get_inbox_counts_as', 'wof_act_as')
 order by p.proname;
