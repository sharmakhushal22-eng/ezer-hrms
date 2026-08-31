-- =====================================================================
-- EZER HRMS — 074: PMS "not found" guards
--
-- Renumbered from 071: Nayan independently used 071 for
-- 071_ess_access_reconciliation.sql. 074 is the next free number after
-- his 073. Contents unchanged.
--
-- Found by smoke-testing 066/067 against the live database on 29-Aug-2026.
-- Two functions load a row with SELECT ... INTO and never check whether
-- they found one. In plpgsql a miss leaves the record NULL, and every
-- comparison against it evaluates to NULL rather than TRUE — so the
-- guard clauses are all skipped and the function reports success.
--
-- Observed, against the live database, with a period id that does not exist:
--
--   pms_open_period('0000…')    -> "OPENED: 0 employees enrolled, 0 excluded"
--   pms_validate_kras('0000…')  -> is_valid = true, kra_count = 0
--   pms_lock_kras('0000…')      -> "LOCKED"
--
-- Neither wrote anything, because the follow-on UPDATEs matched no rows.
-- The danger is not the nil UUID — it is the direction of failure. The
-- readiness gate is the piece the whole design rests on ("blocks rather
-- than guesses"), and it currently FAILS OPEN: when the company cannot be
-- determined, `WHERE company_id = NULL` matches no rows, the unresolvable
-- count comes back 0, and the gate concludes everything is fine.
--
-- pms_periods.policy_id is NOT NULL REFERENCES pms_policies(id), so a real
-- period always has a policy and the normal path is unaffected. The reachable
-- case is a stale period id — note ON DELETE CASCADE means deleting a policy
-- deletes its periods, so an id held by an open browser tab can outlive the
-- row it names. Then an employee with zero KRAs validates as complete.
--
-- WHAT THIS CHANGES
--   1. The missing NOT FOUND checks, in all three functions. No schema
--      change, no data change, and no effect on any input that already
--      behaved correctly.
--   2. One deliberate NEW restriction: pms_open_period now refuses a period
--      that is not SCHEDULED. Re-opening a running period previously
--      "worked" and silently re-ran pms_snapshot_chains, overwriting the
--      frozen chain mid-cycle — the exact thing freezing it exists to
--      prevent. This is a behaviour change, called out rather than buried:
--      if you want re-opening to stay possible, drop that second block.
--
-- Everything else in all three functions is byte-for-byte as deployed;
-- verified by diffing against 066/067.
-- =====================================================================


-- ---------------------------------------------------------------------
-- pms_open_period — refuse an unknown period instead of reporting success
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pms_open_period(p_period_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_company uuid; v_bad int; v_res RECORD; v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status
  FROM pms_periods WHERE id = p_period_id;

  -- Without this the gate below counts FIX_* rows WHERE company_id = NULL,
  -- finds none, and happily opens a period that does not exist.
  IF NOT FOUND THEN
    RETURN format('ERROR: no period with id %s.', p_period_id);
  END IF;

  -- Opening twice would re-snapshot the chain mid-cycle, which is exactly
  -- what freezing it was meant to prevent.
  IF v_status <> 'SCHEDULED' THEN
    RETURN format('ERROR: period is already %s; only a SCHEDULED period can be opened.', v_status);
  END IF;

  SELECT COUNT(*) INTO v_bad
  FROM vw_pms_org_readiness
  WHERE company_id = v_company AND readiness_status IN ('FIX_DEPARTMENT','FIX_EMPLOYEE','FIX_OTHER');

  IF v_bad > 0 THEN
    RETURN format('BLOCKED: %s employees have an unresolvable chain. '
                  'See vw_pms_org_readiness.', v_bad);
  END IF;

  SELECT * INTO v_res FROM pms_snapshot_chains(p_period_id);

  UPDATE pms_periods SET status = 'KRA_SETTING' WHERE id = p_period_id;

  RETURN format('OPENED: %s employees enrolled, %s excluded (MD / exited).',
                v_res.enrolled, v_res.skipped);
END $$;


-- ---------------------------------------------------------------------
-- pms_validate_kras — a missing policy is an error, not a pass
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pms_validate_kras(p_employee_id uuid, p_period_id uuid)
RETURNS TABLE (is_valid boolean, kra_count int, total_wt numeric, error_msg text)
LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_cnt int; v_tot numeric; v_min numeric; v_err text := NULL;
BEGIN
  SELECT p.* INTO pol
  FROM pms_policies p JOIN pms_periods pe ON pe.policy_id = p.id
  WHERE pe.id = p_period_id;

  -- Every rule below compares against a column of `pol`. If no policy was
  -- found they all compare against NULL, none of them fire, and an employee
  -- with no KRAs at all comes back valid.
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0::numeric,
      format('No policy found for period %s — cannot validate.', p_period_id);
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(weightage),0), COALESCE(MIN(weightage),0)
    INTO v_cnt, v_tot, v_min
  FROM pms_employee_goals
  WHERE employee_id = p_employee_id AND period_id = p_period_id
    AND status <> 'SENT_BACK';

  IF v_cnt < pol.min_kra_count THEN
    v_err := format('Minimum %s KRA mandatory (currently %s)', pol.min_kra_count, v_cnt);
  ELSIF v_cnt > pol.max_kra_count THEN
    v_err := format('Maximum %s KRA allowed (currently %s)', pol.max_kra_count, v_cnt);
  ELSIF v_tot <> pol.total_weightage THEN
    v_err := format('Total weightage must be exactly %s (currently %s)', pol.total_weightage, v_tot);
  ELSIF v_min < pol.min_weightage_per_kra THEN
    v_err := format('Each KRA needs at least %s weightage', pol.min_weightage_per_kra);
  END IF;

  RETURN QUERY SELECT (v_err IS NULL), v_cnt, v_tot, v_err;
END $$;


-- ---------------------------------------------------------------------
-- pms_lock_kras — same guard, so it cannot LOCK against a missing policy
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pms_lock_kras(p_employee_id uuid, p_period_id uuid, p_manager_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_ok boolean; v_err text; v_121 int;
BEGIN
  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;

  -- The only change from 066: without this, a missing policy leaves `pol`
  -- NULL, pms_validate_kras returns valid, one_to_one_mandatory is NULL so
  -- the check is skipped, and this returns LOCKED for an employee with no
  -- KRAs. Everything below is byte-for-byte as deployed.
  IF NOT FOUND THEN
    RETURN format('ERROR: no policy found for period %s.', p_period_id);
  END IF;

  SELECT is_valid, error_msg INTO v_ok, v_err
  FROM pms_validate_kras(p_employee_id, p_period_id);
  IF NOT v_ok THEN RETURN 'BLOCKED: ' || v_err; END IF;

  IF pol.one_to_one_mandatory THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id = p_employee_id AND period_id = p_period_id
      AND discussion_type = 'KRA_SETTING'
      AND employee_ack = true AND manager_ack = true;
    IF v_121 = 0 THEN
      RETURN 'BLOCKED: one-to-one discussion required and must be acknowledged by both';
    END IF;
  END IF;

  UPDATE pms_employee_goals
     SET status='LOCKED', locked_at=now(), locked_by=p_manager_id, updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id AND status <> 'SENT_BACK';

  UPDATE pms_overall_rating SET workflow_status='KRA_LOCKED', updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id;

  RETURN 'LOCKED';
END $$;
