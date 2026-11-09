-- 176_te_drafts_verify.sql — proves a draft is private and resumable.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 176 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It creates drafts for two real employees, asks
-- the three functions about each, checks every answer, and then raises an
-- exception on purpose. The exception aborts the block, so both drafts
-- disappear. The report survives because a PL/pgSQL variable is not
-- transactional; that is the whole trick.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED. A draft holds unfinished, unreviewed, often wrong work
-- that its author has not chosen to show anybody. The only thing that really
-- matters here is that nobody else can read or write it, so that is tested
-- from both sides rather than assumed from the WHERE clauses:
--
--   privacy, reading   te_draft_list returns only the caller's own, and the
--                      count for each person is exactly their own drafts.
--   privacy, writing   te_draft_save with SOMEBODY ELSE'S draft id must not
--                      overwrite it. It creates a new draft for the caller
--                      instead, and the victim's body is untouched — this is
--                      the test that would catch an id used without an
--                      employee_id beside it in the WHERE.
--   privacy, deleting  te_draft_delete on somebody else's id deletes nothing
--                      and says so.
--   resuming           saving twice with the same id updates one row rather
--                      than making two, which is what stops autosave filling
--                      the table.
--   the body           goes in and comes back out unchanged, nested values and
--                      all. SQL never reads inside it and must never reshape
--                      it either.
--   the size limit     a body over 64 KB is refused by the CHECK rather than
--                      stored, so one runaway client cannot fill the table.
-- ============================================================================

do $$
declare
  v_co     uuid;
  v_a      uuid;         -- one employee
  v_b      uuid;         -- another
  v_da     uuid;         -- A's draft
  v_db     uuid;         -- B's draft
  v_new    uuid;
  v_body   jsonb;
  v_list   jsonb;
  v_people uuid[];
  r        text := E'\n';
  fails    int  := 0;
  v_ok     boolean;
begin
  select s.company_id into v_co from te_settings s
    join companies c on c.id = s.company_id order by c.company_name limit 1;
  if v_co is null then
    raise exception 'No company has Travel and Expense set up. Nothing to verify.';
  end if;
  select array_agg(id) into v_people from (
    select e.id from employees e
     where e.company_id = v_co and te_is_employee_active(e.id)
     order by e.emp_code limit 2) q;
  if coalesce(cardinality(v_people), 0) < 2 then
    raise exception 'Need two active employees of this company. Found %.', coalesce(cardinality(v_people), 0);
  end if;
  v_a := v_people[1]; v_b := v_people[2];

  -- ── a draft goes in, with a nested body ──────────────────────────────────
  v_body := jsonb_build_object(
    'name', 'Half-planned Pune trip', 'scope', 'domestic', 'step', 2,
    'points', jsonb_build_array(jsonb_build_object('place', 'ggn', 'leave', '2026-12-01'),
                                jsonb_build_object('place', 'pune')),
    'segs', jsonb_build_array(jsonb_build_object('mode', 'flight', 'bookedBy', 'desk')));
  v_da := (te_draft_save(jsonb_build_object('kind', 'trip', 'title', 'Half-planned Pune trip',
             'scope', 'domestic', 'step', 2, 'body', v_body), v_a)->>'draft_id')::uuid;
  v_db := (te_draft_save(jsonb_build_object('kind', 'expense', 'title', 'Taxi',
             'scope', 'taxi', 'body', jsonb_build_object('f', jsonb_build_object('cat', 'taxi'))), v_b)->>'draft_id')::uuid;

  -- ── the body comes back exactly as it went in ───────────────────────────
  select d.body into v_body from te_drafts d where d.id = v_da;
  if v_body = jsonb_build_object(
       'name', 'Half-planned Pune trip', 'scope', 'domestic', 'step', 2,
       'points', jsonb_build_array(jsonb_build_object('place', 'ggn', 'leave', '2026-12-01'),
                                   jsonb_build_object('place', 'pune')),
       'segs', jsonb_build_array(jsonb_build_object('mode', 'flight', 'bookedBy', 'desk')))
  then r := r || E'  ok   the body round-trips unchanged, nested values and all\n';
  else r := r || E'  FAIL the body came back reshaped\n'; fails := fails + 1; end if;

  -- ── reading: only your own ──────────────────────────────────────────────
  v_list := te_draft_list(v_a, null);
  if jsonb_array_length(v_list) = 1 and (v_list->0->>'id')::uuid = v_da
  then r := r || E'  ok   te_draft_list(A) returns A''s one draft\n';
  else r := r || format(E'  FAIL te_draft_list(A) returned %s rows\n', jsonb_array_length(v_list)); fails := fails + 1; end if;

  if not exists (select 1 from jsonb_array_elements(te_draft_list(v_a, null)) x where (x->>'id')::uuid = v_db)
  then r := r || E'  ok   A cannot see B''s draft   <- privacy, reading\n';
  else r := r || E'  FAIL A can see B''s draft\n'; fails := fails + 1; end if;

  -- The kind filter, which the Drafts list uses.
  if jsonb_array_length(te_draft_list(v_a, 'expense')) = 0 and jsonb_array_length(te_draft_list(v_a, 'trip')) = 1
  then r := r || E'  ok   the kind filter works\n';
  else r := r || E'  FAIL the kind filter is wrong\n'; fails := fails + 1; end if;

  -- ── writing: somebody else's id must not be writable ────────────────────
  v_new := (te_draft_save(jsonb_build_object('id', v_db, 'kind', 'expense',
              'title', 'HIJACKED', 'body', jsonb_build_object('x', 1)), v_a)->>'draft_id')::uuid;
  if v_new <> v_db then r := r || E'  ok   saving with B''s id made a NEW draft for A   <- privacy, writing\n';
  else r := r || E'  FAIL A overwrote B''s draft by passing its id\n'; fails := fails + 1; end if;

  select (d.title = 'Taxi') into v_ok from te_drafts d where d.id = v_db;
  if coalesce(v_ok, false) then r := r || E'  ok   B''s draft is untouched\n';
  else r := r || E'  FAIL B''s draft was modified by A\n'; fails := fails + 1; end if;

  -- ── resuming: the same id updates one row, never adds ───────────────────
  perform te_draft_save(jsonb_build_object('id', v_da, 'kind', 'trip', 'title', 'Renamed',
            'step', 3, 'body', jsonb_build_object('name', 'Renamed')), v_a);
  if (select count(*) from te_drafts d where d.employee_id = v_a and d.kind = 'trip') = 1
     and (select d.step from te_drafts d where d.id = v_da) = 3
  then r := r || E'  ok   saving again updates the one row (autosave does not pile up)\n';
  else r := r || E'  FAIL saving again did not update in place\n'; fails := fails + 1; end if;

  -- ── deleting: not somebody else's ───────────────────────────────────────
  if (te_draft_delete(v_db, v_a)->>'deleted') = 'false' and exists (select 1 from te_drafts d where d.id = v_db)
  then r := r || E'  ok   A cannot delete B''s draft   <- privacy, deleting\n';
  else r := r || E'  FAIL A deleted B''s draft\n'; fails := fails + 1; end if;

  if (te_draft_delete(v_da, v_a)->>'deleted') = 'true'
  then r := r || E'  ok   A can delete their own\n';
  else r := r || E'  FAIL A could not delete their own draft\n'; fails := fails + 1; end if;

  if (te_draft_delete(v_da, v_a)->>'deleted') = 'false'
  then r := r || E'  ok   deleting a draft that has gone is quiet, not an error\n';
  else r := r || E'  FAIL deleting twice did not report false\n'; fails := fails + 1; end if;

  -- ── the size limit ──────────────────────────────────────────────────────
  begin
    perform te_draft_save(jsonb_build_object('kind', 'trip',
      'body', jsonb_build_object('junk', repeat('x', 70000))), v_a);
    r := r || E'  FAIL a 70 KB body was accepted; the CHECK is not doing its job\n'; fails := fails + 1;
  exception when check_violation then
    r := r || E'  ok   a body over 64 KB is refused\n';
  end;

  raise exception E'176 VERIFY — % check(s) failed%', fails, r ||
    E'\n  (This error is expected: it rolls the fixture back. Nothing was kept.)';
end $$;
