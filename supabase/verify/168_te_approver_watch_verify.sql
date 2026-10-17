-- 168_te_approver_watch_verify.sql — proves F2 and F3 compute correctly.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
--
-- WRITES NOTHING. It builds a fixture, asks te_approver_watch what it sees,
-- checks every number against what the fixture was designed to produce, and
-- then raises an exception on purpose. The exception aborts the block, so every
-- row it inserted disappears. The report survives because a PL/pgSQL variable
-- is not transactional — that is the whole trick.
--
-- It finishes with an ERROR in red. That is the success case. Read the message.
--
-- WHY A FIXTURE AT ALL. The live database has no claims, so the report
-- correctly shows nothing, and "nothing" is exactly what a broken query shows
-- too. These are the only numbers that tell the two apart.
--
-- THE FIXTURE, and what each row is there to prove:
--
--   Employee 1   4 flagged claims, each decided by approver A ten seconds
--                after it became theirs        → the F2 and F3 rows themselves
--                1 UNflagged claim decided by A in five seconds
--                                              → proves a clean claim decided
--                                                quickly is not counted: if it
--                                                were, A's flagged would be 5
--                1 flagged claim with an 'auto' step and no acted_by
--                                              → proves a rule firing is not an
--                                                approver: if it counted,
--                                                theirTotal would be 5 and the
--                                                pairing 80%, not 100%
--   Employee 2   1 flagged claim decided by approver B after an hour
--                                              → proves the seconds threshold
--                                                excludes B from F2, and that
--                                                minClaims excludes a person
--                                                with one claim from F3
--
-- Then it narrows the thresholds in te_checks.params and asks again, which
-- proves the numbers on screen are the configured ones and not constants.
-- ============================================================================

do $$
declare
  v_co     uuid;
  v_e1     uuid;   -- the claimant
  v_e2     uuid;   -- a second claimant, with only one claim
  v_a      uuid;   -- approver A, fast
  v_b      uuid;   -- approver B, slow
  v_base   timestamptz;
  v_claim  uuid;
  v_out    jsonb;
  v_f2     jsonb;
  v_f3     jsonb;
  v_rep    text := '';
  v_fails  int := 0;
  i        int;
begin
  -- ── pick a company with at least four employees ──
  select c.id into v_co
    from companies c
   where (select count(*) from employees e where e.company_id = c.id) >= 4
   order by c.company_name
   limit 1;
  if v_co is null then
    raise exception 'No company with four employees to build a fixture from.';
  end if;

  select e.id into v_e1 from employees e where e.company_id = v_co order by e.emp_code offset 0 limit 1;
  select e.id into v_e2 from employees e where e.company_id = v_co order by e.emp_code offset 1 limit 1;
  select e.id into v_a  from employees e where e.company_id = v_co order by e.emp_code offset 2 limit 1;
  select e.id into v_b  from employees e where e.company_id = v_co order by e.emp_code offset 3 limit 1;

  -- Five days inside the default 90-day window, at a fixed time of day so the
  -- numbers do not move with the clock.
  v_base := (te_today(v_co) - 5)::timestamp + interval '10 hours';

  v_rep := v_rep || E'\n  company   ' || (select company_name from companies where id = v_co);
  v_rep := v_rep || E'\n  claimant  ' || te_emp_name(v_e1);
  v_rep := v_rep || E'\n  approvers ' || te_emp_name(v_a) || ' (fast) and ' || te_emp_name(v_b) || ' (slow)';
  v_rep := v_rep || E'\n  window    ' || (te_today(v_co) - 90) || ' to ' || te_today(v_co) || E'\n';

  -- ── employee 1: four flagged claims, each decided by A in ten seconds ──
  for i in 1..4 loop
    insert into te_claims (company_id, claim_no, employee_id, claim_type, status)
      values (v_co, 'VERIFY-F-' || i, v_e1, 'GENERAL', 'VERIFIED')
      returning id into v_claim;
    insert into te_flags (claim_id, check_code, title)
      values (v_claim, 'A1', 'a flag, so the claim qualifies');
    insert into te_approval_steps
      (company_id, entity_type, entity_id, step_no, stage, role_label,
       approver_id, status, acted_by, acted_at, created_at)
      values (v_co, 'claim', v_claim, 1, 'manager', 'Manager',
              v_a, 'approved', v_a, v_base, v_base - interval '10 seconds');
  end loop;

  -- ── employee 1: one CLEAN claim, decided even faster. Must not count. ──
  insert into te_claims (company_id, claim_no, employee_id, claim_type, status)
    values (v_co, 'VERIFY-CLEAN', v_e1, 'GENERAL', 'VERIFIED')
    returning id into v_claim;
  insert into te_approval_steps
    (company_id, entity_type, entity_id, step_no, stage, role_label,
     approver_id, status, acted_by, acted_at, created_at)
    values (v_co, 'claim', v_claim, 1, 'manager', 'Manager',
            v_a, 'approved', v_a, v_base, v_base - interval '5 seconds');

  -- ── employee 1: one flagged claim cleared by a RULE, not a person. ──
  insert into te_claims (company_id, claim_no, employee_id, claim_type, status)
    values (v_co, 'VERIFY-AUTO', v_e1, 'GENERAL', 'VERIFIED')
    returning id into v_claim;
  insert into te_flags (claim_id, check_code, title)
    values (v_claim, 'A1', 'a flag, so the claim qualifies');
  insert into te_approval_steps
    (company_id, entity_type, entity_id, step_no, stage, role_label,
     approver_id, status, acted_by, acted_at, created_at)
    values (v_co, 'claim', v_claim, 1, 'manager', 'Auto',
            v_a, 'auto', null, v_base, v_base - interval '1 second');

  -- ── employee 2: one flagged claim, decided by B after an hour ──
  insert into te_claims (company_id, claim_no, employee_id, claim_type, status)
    values (v_co, 'VERIFY-SLOW', v_e2, 'GENERAL', 'VERIFIED')
    returning id into v_claim;
  insert into te_flags (claim_id, check_code, title)
    values (v_claim, 'A1', 'a flag, so the claim qualifies');
  insert into te_approval_steps
    (company_id, entity_type, entity_id, step_no, stage, role_label,
     approver_id, status, acted_by, acted_at, created_at)
    values (v_co, 'claim', v_claim, 1, 'manager', 'Manager',
            v_b, 'approved', v_b, v_base, v_base - interval '1 hour');

  -- ══ ASK ═══════════════════════════════════════════════════════════════════
  v_out := te_approver_watch(v_co, null, null);
  v_f2  := v_out->'f2'->'rows';
  v_f3  := v_out->'f3'->'rows';

  v_rep := v_rep || E'\nAT THE DEFAULTS (' || (v_out->'f2'->>'seconds') || 's, '
        || (v_out->'f2'->>'minClaims') || ' claims / '
        || (v_out->'f3'->>'pct') || '%, ' || (v_out->'f3'->>'minClaims') || ' claims)';

  -- F2: exactly A, four flagged, four of them fast, ten seconds each.
  if jsonb_array_length(v_f2) = 1 then
    v_rep := v_rep || E'\n  ok    F2 names one person';
  else
    v_rep := v_rep || E'\n  FAIL  F2 named ' || jsonb_array_length(v_f2) || ' people, expected 1';
    v_fails := v_fails + 1;
  end if;
  if v_f2->0->>'who' = v_a::text then v_rep := v_rep || E'\n  ok    F2 names the fast approver';
  else v_rep := v_rep || E'\n  FAIL  F2 named ' || coalesce(v_f2->0->>'name', 'nobody'); v_fails := v_fails + 1; end if;
  if (v_f2->0->>'flagged')::int = 4 then v_rep := v_rep || E'\n  ok    F2 counts 4 flagged claims, so the clean one was ignored';
  else v_rep := v_rep || E'\n  FAIL  F2 counted ' || coalesce(v_f2->0->>'flagged','null') || ' flagged, expected 4 (a clean claim is being counted)'; v_fails := v_fails + 1; end if;
  if (v_f2->0->>'fast')::int = 4 then v_rep := v_rep || E'\n  ok    F2 counts 4 of them as fast';
  else v_rep := v_rep || E'\n  FAIL  F2 counted ' || coalesce(v_f2->0->>'fast','null') || ' fast, expected 4'; v_fails := v_fails + 1; end if;
  if (v_f2->0->>'fastestSecs')::int = 10 and (v_f2->0->>'medianSecs')::int = 10 then
    v_rep := v_rep || E'\n  ok    F2 measures 10 seconds, so waiting_since is right for an acted step';
  else
    v_rep := v_rep || E'\n  FAIL  F2 measured fastest ' || coalesce(v_f2->0->>'fastestSecs','null')
          || 's median ' || coalesce(v_f2->0->>'medianSecs','null') || 's, expected 10 and 10';
    v_fails := v_fails + 1;
  end if;
  if not (v_f2 @> jsonb_build_array(jsonb_build_object('who', v_b))) then
    v_rep := v_rep || E'\n  ok    F2 leaves out the slow approver';
  else
    v_rep := v_rep || E'\n  FAIL  F2 included the approver who took an hour'; v_fails := v_fails + 1;
  end if;

  -- F3: exactly A paired with employee 1, four of four.
  if jsonb_array_length(v_f3) = 1 then v_rep := v_rep || E'\n  ok    F3 names one pairing';
  else v_rep := v_rep || E'\n  FAIL  F3 named ' || jsonb_array_length(v_f3) || ' pairings, expected 1'; v_fails := v_fails + 1; end if;
  if v_f3->0->>'who' = v_a::text and v_f3->0->>'employee' = v_e1::text then
    v_rep := v_rep || E'\n  ok    F3 names the right two people';
  else v_rep := v_rep || E'\n  FAIL  F3 paired the wrong people'; v_fails := v_fails + 1; end if;
  if (v_f3->0->>'pairs')::int = 4 and (v_f3->0->>'theirTotal')::int = 4 and (v_f3->0->>'pct')::int = 100 then
    v_rep := v_rep || E'\n  ok    F3 reads 4 of 4 = 100%, so the auto step and the clean claim were both ignored';
  else
    v_rep := v_rep || E'\n  FAIL  F3 read ' || coalesce(v_f3->0->>'pairs','null') || ' of '
          || coalesce(v_f3->0->>'theirTotal','null') || ' = ' || coalesce(v_f3->0->>'pct','null')
          || '%, expected 4 of 4 = 100% (80% means the auto step is being counted as a decision)';
    v_fails := v_fails + 1;
  end if;

  -- ══ ASK OUTSIDE THE WINDOW ════════════════════════════════════════════════
  -- This has to happen BEFORE the thresholds are narrowed. Narrowing them
  -- empties both lists on its own, so a window test run afterwards would pass
  -- whether the window worked or not.
  v_out := te_approver_watch(v_co, (te_today(v_co) - 2)::date, te_today(v_co)::date);
  v_rep := v_rep || E'\n\nASKED ABOUT THE LAST TWO DAYS, WITH EVERY DECISION FIVE DAYS OLD';
  if jsonb_array_length(v_out->'f2'->'rows') = 0 and jsonb_array_length(v_out->'f3'->'rows') = 0 then
    v_rep := v_rep || E'\n  ok    the window is honoured';
  else
    v_rep := v_rep || E'\n  FAIL  decisions outside the window were still reported'; v_fails := v_fails + 1;
  end if;

  -- ══ ASK AGAIN, WITH THE THRESHOLDS MOVED ══════════════════════════════════
  -- Proves the screen shows configured numbers rather than constants.
  update te_checks set params = jsonb_build_object('seconds', 5, 'minClaims', 3)
   where company_id = v_co and code = 'F2';
  update te_checks set params = jsonb_build_object('pct', 80, 'minClaims', 5)
   where company_id = v_co and code = 'F3';

  v_out := te_approver_watch(v_co, null, null);
  v_rep := v_rep || E'\n\nWITH THE THRESHOLDS NARROWED (5s, and 5 claims before a pairing counts)';
  if (v_out->'f2'->>'seconds')::int = 5 and (v_out->'f3'->>'minClaims')::int = 5 then
    v_rep := v_rep || E'\n  ok    the report reads its thresholds from te_checks.params';
  else
    v_rep := v_rep || E'\n  FAIL  the report ignored params: seconds=' || (v_out->'f2'->>'seconds')
          || ' minClaims=' || (v_out->'f3'->>'minClaims');
    v_fails := v_fails + 1;
  end if;
  if jsonb_array_length(v_out->'f2'->'rows') = 0 then
    v_rep := v_rep || E'\n  ok    at 5 seconds, a 10-second decision is no longer fast';
  else
    v_rep := v_rep || E'\n  FAIL  a 10-second decision still counted as under 5 seconds'; v_fails := v_fails + 1;
  end if;
  if jsonb_array_length(v_out->'f3'->'rows') = 0 then
    v_rep := v_rep || E'\n  ok    at 5 claims, an employee with 4 is below the floor';
  else
    v_rep := v_rep || E'\n  FAIL  a 4-claim employee still produced a pairing'; v_fails := v_fails + 1;
  end if;

  raise exception E'\n\n%\n%\n%\n%\n',
    '════ 168 te_approver_watch — ' || case when v_fails = 0 then 'ALL CHECKS PASSED' else v_fails || ' CHECK(S) FAILED' end || ' ════',
    v_rep,
    '════ every row above was rolled back by this exception. The database is untouched. ════',
    'This error is how the script finishes. It is not a failure.';
end $$;
