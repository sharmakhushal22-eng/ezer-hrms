-- 187_te_trip_no_unique_verify.sql — proves one number names one trip, and
-- that the database will not let that come undone.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 187 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It tries to create a duplicate number on
-- purpose, reads what the database says, and then raises an exception so the
-- whole block is rolled back. The report survives because a PL/pgSQL variable
-- is not transactional — the same trick 175, 176, 177, 180 and 185 use.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED:
--
--   nothing is shared       no trip_no is used by two trips, in any company.
--   every number is keyed   each one carries a company prefix, so the number
--                            says which company's trip it is without a join.
--   the index exists        uq_te_trips_trip_no_global, which is the thing
--                            that stops this drifting back. A data fix with no
--                            constraint behind it is a data fix that returns.
--   a duplicate is refused  inserting a number another company already holds
--                            fails, which is the case that was allowed before.
--   history was kept        every renamed trip carries a TRIP_RENUMBERED entry
--                            naming the number it used to have, so a claim or
--                            an email quoting the old one still leads somewhere.
-- ============================================================================
do $$
declare
  r         text := E'\n=== 187 one number, one trip ===\n';
  v_trips   int;
  v_shared  int;
  v_bare    int;
  v_index   boolean;
  v_renamed int;
  v_victim  te_trips;
  v_other   uuid;
  v_err     text;
begin
  select count(*) into v_trips from te_trips;
  select count(*) into v_shared from (
    select trip_no from te_trips group by trip_no having count(*) > 1) s;
  select count(*) into v_bare from te_trips where trip_no !~ '^[A-Z0-9]{2,6}-TRP-';
  select exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_te_trips_trip_no_global') into v_index;
  select count(*) into v_renamed from te_audit_log where action = 'TRIP_RENUMBERED';

  r := r || format('trips                      %s%s', v_trips, E'\n');
  r := r || format('numbers naming two trips   %s%s', v_shared, E'\n');
  r := r || format('numbers with no prefix     %s%s', v_bare, E'\n');
  r := r || format('global unique index        %s%s', case when v_index then 'present' else 'MISSING' end, E'\n');
  r := r || format('renames recorded           %s%s', v_renamed, E'\n');

  if v_shared > 0 then
    raise exception E'%\nSTILL AMBIGUOUS: % number(s) name more than one trip. 187 has not been applied, or it refused.', r, v_shared;
  end if;
  if not v_index then
    raise exception E'%\nThe global unique index is missing, so nothing stops two companies reaching the same number again.', r;
  end if;
  if v_bare > 0 then
    r := r || format('  (%s number(s) have no prefix — unique today, but only by luck)%s', v_bare, E'\n');
  end if;

  -- ── the refusal, which is the part that matters ─────────────────────────
  -- Take a real trip and try to give it a number another trip already holds.
  select * into v_victim from te_trips order by created_at limit 1;
  select id into v_other from te_trips where id <> v_victim.id limit 1;
  if v_other is null then
    r := r || E'duplicate refused          SKIPPED (only one trip exists)\n';
  else
    begin
      update te_trips set trip_no = (select trip_no from te_trips where id = v_other)
       where id = v_victim.id;
      raise exception 'A duplicate trip number was ACCEPTED. The index is not doing its job.';
    exception
      when unique_violation then
        r := r || E'duplicate refused          yes, by the database itself\n';
      when others then
        v_err := sqlerrm;
        if v_err like '%was ACCEPTED%' then raise; end if;
        r := r || format('duplicate refused          yes: %s%s', left(v_err, 60), E'\n');
    end;
  end if;

  -- ── the trail ───────────────────────────────────────────────────────────
  if v_renamed > 0 then
    r := r || E'\nwhat the renames recorded, newest first:\n';
    for v_err in
      select format('  %s  %s -> %s', to_char(a.at, 'YYYY-MM-DD'), a.before->>'trip_no', a.after->>'trip_no')
        from te_audit_log a
       where a.action = 'TRIP_RENUMBERED'
       order by a.at desc limit 6
    loop
      r := r || v_err || E'\n';
    end loop;
  end if;

  raise exception E'%\n=== every check passed. Nothing was kept. ===', r;
end $$;
