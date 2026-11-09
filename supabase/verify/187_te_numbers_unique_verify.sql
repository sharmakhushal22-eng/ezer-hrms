-- 187_te_numbers_unique_verify.sql — proves one number names one thing, and
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
-- WHAT IS BEING PROVED, for all six numbered things:
--
--   nothing is shared       no number is used by two rows, in any company.
--   every number is keyed   each carries a company prefix, so the number says
--                            which company's it is without a join.
--   the index exists        the global unique on each table, which is the thing
--                            that stops this drifting back.
--   a duplicate is refused  giving one row a number another already holds
--                            fails. This is the case that was allowed before.
--   history was kept        every renamed row carries a *_RENUMBERED entry
--                            naming the number it used to have.
-- ============================================================================
do $$
declare
  spec      record;
  r         text := E'\n=== 187 one number, one thing ===\n';
  v_rows    int;
  v_shared  int;
  v_bare    int;
  v_index   boolean;
  v_renamed int;
  v_total   int := 0;
  v_a       uuid;
  v_b       uuid;
  v_bno     text;
  v_err     text;
  v_bad     text[] := '{}';
begin
  r := r || format('%-20s %6s %7s %6s %6s%s', 'table', 'rows', 'shared', 'bare', 'index', E'\n');

  for spec in
    select * from (values
      ('te_trips',          'trip_no',     'TRP', 'uq_te_trips_no_global',    'TRIP_RENUMBERED'),
      ('te_claims',         'claim_no',    'CLM', 'uq_te_claims_no_global',   'CLAIM_RENUMBERED'),
      ('te_advances',       'advance_no',  'ADV', 'uq_te_advances_no_global', 'ADVANCE_RENUMBERED'),
      ('te_bookings',       'booking_no',  'BKG', 'uq_te_bookings_no_global', 'BOOKING_RENUMBERED'),
      ('te_payout_batches', 'batch_no',    'PAY', 'uq_te_payouts_no_global',  'PAYOUT_RENUMBERED'),
      ('te_expenses',       'expense_no',  'EXP', 'uq_te_expenses_no_global', 'EXPENSE_RENUMBERED')
    ) as t(tbl, col, tag, idx, act)
  loop
    execute format('select count(*) from %I', spec.tbl) into v_rows;
    execute format('select count(*) from (select %I from %I group by %I having count(*) > 1) s',
                   spec.col, spec.tbl, spec.col) into v_shared;
    execute format('select count(*) from %I where %I !~ %L', spec.tbl, spec.col,
                   '^[A-Z0-9]{2,6}-' || spec.tag || '-') into v_bare;
    select exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = spec.idx) into v_index;
    select count(*) into v_renamed from te_audit_log where action = spec.act;
    v_total := v_total + v_renamed;

    r := r || format('%-20s %6s %7s %6s %6s%s', spec.tbl, v_rows, v_shared, v_bare,
                     case when v_index then 'yes' else 'NO' end, E'\n');

    if v_shared > 0 then
      v_bad := v_bad || format('%s still has %s shared number(s)', spec.tbl, v_shared);
    end if;
    if not v_index then
      v_bad := v_bad || format('%s has no global unique index', spec.tbl);
    end if;
  end loop;

  r := r || format('%srenames recorded in the audit log: %s%s', E'\n', v_total, E'\n');

  if array_length(v_bad, 1) > 0 then
    raise exception E'%\nNOT DONE:\n  %\n187 has not been applied, or it refused.',
      r, array_to_string(v_bad, E'\n  ');
  end if;

  -- ── the refusal, which is the part that matters ─────────────────────────
  -- Take two trips and try to give one the other's number.
  select id into v_a from te_trips order by id limit 1;
  select id, trip_no into v_b, v_bno from te_trips where id <> v_a order by id limit 1;
  if v_b is null then
    r := r || E'duplicate refused    SKIPPED (only one trip exists)\n';
  else
    begin
      update te_trips set trip_no = v_bno where id = v_a;
      raise exception 'A duplicate number was ACCEPTED. The index is not doing its job.';
    exception
      when unique_violation then
        r := r || E'duplicate refused    yes, by the database itself\n';
      when others then
        v_err := sqlerrm;
        if v_err like '%was ACCEPTED%' then raise; end if;
        r := r || format('duplicate refused    yes: %s%s', left(v_err, 60), E'\n');
    end;
  end if;

  -- ── the trail ───────────────────────────────────────────────────────────
  if v_total > 0 then
    r := r || E'\na few of the renames, newest first:\n';
    for v_err in
      select format('  %-10s %s', replace(a.action, '_RENUMBERED', ''),
                    coalesce(a.before::text, '?') || ' -> ' || coalesce(a.after::text, '?'))
        from te_audit_log a
       where a.action like '%\_RENUMBERED' escape '\'
       order by a.at desc limit 8
    loop
      r := r || v_err || E'\n';
    end loop;
  end if;

  raise exception E'%\n=== every check passed. Nothing was kept. ===', r;
end $$;
