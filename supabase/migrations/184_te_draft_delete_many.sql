-- 184_te_draft_delete_many.sql — discard several drafts in one go.
-- SAFE TO RUN TWICE. One new function. No table or column changes.
-- ----------------------------------------------------------------------------
-- WHY NOT JUST CALL te_draft_delete IN A LOOP. Somebody who has left eleven
-- half-started plans behind wants them gone in one action, and a loop makes
-- that eleven round trips that can half-succeed: five deleted, the sixth fails,
-- and the screen has to explain a state nobody asked for. One statement either
-- deletes the lot or deletes none.
--
-- OWNERSHIP IS THE FILTER, not a check — exactly as in te_draft_delete. Another
-- person's draft id simply matches nothing, so a crafted list deletes nothing
-- and is reported as nothing deleted. The employee id is never taken from the
-- request; the route passes the actor from the verified token.
--
-- IT RETURNS WHAT ACTUALLY WENT, not what was asked for. A list of eleven that
-- deletes nine is nine: two had already gone, or were never the caller's. The
-- screen says the true number rather than echoing the request back.
--
-- QUIET ABOUT AN EMPTY LIST. Selecting nothing and pressing discard is not an
-- error worth a sentence; it is a no-op that answers 0.
--
-- THE CAP IS THERE SO A BUG CANNOT EMPTY THE DRAWER. 200 is far above any real
-- number of drafts one person accumulates and far below anything that would
-- look like a runaway client sending every id it has ever seen.
-- ============================================================================

create or replace function te_draft_delete_many(p_ids uuid[], p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_gone int;
  v_n    int := coalesce(cardinality(p_ids), 0);
begin
  if v_n = 0 then
    return jsonb_build_object('deleted', 0, 'asked', 0);
  end if;
  if v_n > 200 then
    perform te_fail('TE_BAD_REQUEST', 'Too many drafts at once. Discard up to 200.');
  end if;
  perform te_assert_active(p_actor);

  delete from te_drafts
   where id = any (p_ids)
     and employee_id = p_actor;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('deleted', v_gone, 'asked', v_n);
end;
$$;

comment on function te_draft_delete_many is
  'Discard several of the actor''s own drafts in one statement. Returns how many actually went, which can be fewer than were asked for when one had already gone or was never theirs.';

-- ── locked down, the same way 176 locks te_draft_delete ─────────────────────
-- The function takes p_actor, so an open execute grant would let anybody
-- delete anybody's drafts with the key that ships in the browser.
do $$
declare
  sig text;
begin
  for sig in
    select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'te_draft_delete_many'
  loop
    execute format('revoke all on function %s from public', sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
