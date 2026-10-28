-- 192_pms_rating_upload_commit.sql — §6.4's commit, applied all-or-nothing.
-- SAFE TO RUN TWICE. Adds one function. No schema change, no data change.
-- ----------------------------------------------------------------------------
-- The Final Rating Upload screen has had a working file parser, a working
-- validation preview and a Commit button wired to nothing. This is the thing
-- the button needed, and it is a function rather than a loop in the client
-- for one reason, which the screen already states in its own footnote:
--
--   "a part-applied upload is worse than a refused one: some people on the
--    system's rating, some on the spreadsheet's, and nothing on screen to say
--    which."
--
-- Twenty-four separate calls from a browser cannot keep that promise. Six
-- succeed, the laptop sleeps, and nobody can say where the batch stopped. One
-- function is one transaction, so the batch either lands or it does not.
--
-- ── THE CLIENT PREVIEW IS ADVISORY. THIS RE-VALIDATES EVERYTHING ───────────
--
-- Every rule in lib/pms/upload.ts is checked again here, against the database
-- rather than against whatever the browser was told. Not because the client
-- is buggy, but because it is a client: this function is reachable from a
-- console with an anon key, and "the preview said it was fine" is not a
-- guarantee of anything. Where the two could disagree, THIS one decides.
--
-- The rules are mirrored deliberately rather than improved, so the preview
-- and the commit cannot diverge:
--
--   ERROR_NOT_FOUND       no employee with that code, or not enrolled in this
--                         period
--   ERROR_NOT_ELIGIBLE    new joiner, or already read-only (exited and rated)
--   ERROR_INVALID_RATING  not a value on this company's active rating scale
--   ERROR_REASON_MISSING  the rating CHANGES and no reason was given
--
-- A REASON IS OWED ONLY WHERE THE NUMBER CHANGES, which is upload.ts's rule
-- and worth restating because of what it implies: an employee with no final
-- rating yet has nothing to change FROM, so a row that sets their first
-- rating needs no reason. That is defensible for a calibration import and it
-- is also how a large batch could set many first ratings with no
-- justification recorded. Mirrored as-is because two disagreeing copies of a
-- validation rule is worse than one debatable rule; if it should be tightened,
-- tighten it in both places at once.
--
-- ── WHAT IS LOGGED, AND THE ONE CASE THAT CANNOT BE ───────────────────────
--
-- §6.4: "Every row logged in pms_rating_upload_log with actor, timestamp,
-- reason." So a REFUSED batch logs every row with committed = false and
-- returns normally — it does not raise, because raising would roll the log
-- back too and lose the record that somebody tried.
--
-- A row that passes validation but is then refused by pms_finalise (a policy
-- that changed under us, a missing final-review one-to-one) RAISES, and the
-- whole transaction including the log is rolled back. plpgsql has no
-- autonomous transaction, so the alternatives are: lose the log of a failed
-- attempt, or leave the batch half applied. Half applied is the one outcome
-- this function exists to prevent, so the log loses. The error names the
-- employee and repeats pms_finalise's own sentence, so nothing is mysterious.
--
-- ── ATTRIBUTION IS THE UPLOADER, NEVER THE FILE ──────────────────────────
--
-- The template carries finalised_by_code, and this function ignores it for
-- attribution. A spreadsheet cannot attest that somebody else made a
-- decision; if it could, anyone who can upload could record any manager as
-- having signed off any rating. pms_overall_rating.finalised_by and
-- pms_rating_upload_log.uploaded_by both get the actor who ran the upload.
-- The claimed code is preserved in the logged reason instead, so the
-- information survives without being presented as verified.
--
-- Only HR and admin roles may do this. A bulk override is not a step in the
-- approval chain, so RM_L1, RM_L2 and HOD are refused here even though
-- pms_finalise would accept them for a single employee.
--
-- rating_source is set to HR_OVERRIDE afterwards: pms_finalise leaves it at
-- 'SYSTEM', which would make a calibration import indistinguishable from a
-- rating the engine produced.
--
-- NOTHING IS PUBLISHED. pms_finalise takes the row to FINALISED; §3.5 makes
-- publication a separate, deliberate act and this function does not perform
-- it. visible_to_employee on any feedback written here stays false.

CREATE OR REPLACE FUNCTION pms_commit_rating_upload(
  p_period_id uuid,
  p_actor_id  uuid,
  p_actor_role text,
  p_rows      jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_batch    uuid := gen_random_uuid();
  v_company  uuid;
  v_scale    numeric[];
  v_errors   int := 0;
  v_applied  int := 0;
  v_total    int := 0;
  r          jsonb;
  v_code     text;
  v_emp      uuid;
  v_flag     text;
  v_cur      numeric;   -- the rating the system currently holds
  v_up       numeric;   -- the rating in the file
  v_reason   text;
  v_status   text;
  v_msg      text;
  v_ro       boolean;
  v_enrolled boolean;
  v_res      text;
  v_claimed  text;
  v_benefit  text;
  v_raw      text;   -- the rating cell exactly as the file had it
  v_need121  boolean;  -- does this period's policy demand a final review?
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'No rows were sent, so there is nothing to commit.');
  END IF;

  -- uploaded_by is NOT NULL, and an override has to be attributable to a
  -- person. The shared dashboard login is not attached to an employee record,
  -- which is the same reason the single-employee finalise screen refuses it.
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'This session is not attached to an employee record, and an '
              || 'override is recorded against a named person. Sign in with '
              || 'your own account to commit an upload.');
  END IF;

  IF p_actor_role IS NULL OR p_actor_role NOT IN ('HR_MANAGER','HR_HEAD','ADMIN') THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'A bulk upload is an HR override, not a step in the approval '
              || 'chain. Only HR_MANAGER, HR_HEAD or ADMIN can commit one.');
  END IF;

  SELECT company_id INTO v_company FROM pms_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'That period does not exist.');
  END IF;

  -- The ratings this company's scale actually allows. Read, not assumed: the
  -- screens used to hardcode 1-5 and an admin can edit the scale.
  SELECT array_agg(rating_value) INTO v_scale
    FROM pms_rating_scale
   WHERE company_id = v_company AND COALESCE(is_active, true);
  IF v_scale IS NULL OR array_length(v_scale, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'This company has no active rating scale, so no rating can '
              || 'be validated. Configure the scale first.');
  END IF;

  -- Does this period's policy demand a final-review one-to-one before a
  -- rating can be settled? Pre-checked per row below so the batch is refused
  -- cleanly instead of rolling back halfway through the apply pass. See the
  -- note on defence in depth at the pass-one check.
  SELECT p.final_review_one_to_one INTO v_need121
    FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id
   WHERE pe.id = p_period_id;

  -- ── pass one: validate, and log every row ────────────────────────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_total  := v_total + 1;
    v_code   := NULLIF(btrim(COALESCE(r->>'employee_code', '')), '');
    v_reason := NULLIF(btrim(COALESCE(r->>'override_reason', '')), '');
    v_claimed := NULLIF(btrim(COALESCE(r->>'finalised_by_code', '')), '');
    v_benefit := NULLIF(btrim(COALESCE(r->>'additional_benefit_type', '')), '');
    -- EVERY per-row variable is reset. v_enrolled, v_ro and v_flag are set by
    -- a SELECT INTO that leaves them UNTOUCHED when it finds nothing, so a
    -- `true` left over from the previous row would wave an unenrolled
    -- employee straight through the eligibility check.
    v_emp := NULL; v_cur := NULL; v_status := 'OK'; v_msg := NULL;
    v_enrolled := NULL; v_ro := NULL; v_flag := NULL; v_up := NULL;

    -- A non-numeric rating must become ERROR_INVALID_RATING, not an exception.
    -- `'abc'::numeric` raises, which would abort the whole run before a single
    -- row was logged — a typo in one cell losing the audit trail for all of
    -- them.
    v_raw := NULLIF(btrim(COALESCE(r->>'final_rating', '')), '');
    BEGIN
      v_up := v_raw::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      v_up := NULL;
    END;

    SELECT e.id INTO v_emp FROM employees e
     WHERE upper(btrim(e.emp_code)) = upper(v_code);

    IF v_code IS NULL OR v_emp IS NULL THEN
      v_status := 'ERROR_NOT_FOUND';
      v_msg := 'No employee has the code ' || COALESCE(v_code, '(blank)') || '.';
    ELSE
      SELECT true, o.final_rating, o.is_readonly, o.employment_flag
        INTO v_enrolled, v_cur, v_ro, v_flag
        FROM pms_overall_rating o
       WHERE o.employee_id = v_emp AND o.period_id = p_period_id;

      IF v_enrolled IS NOT TRUE THEN
        v_status := 'ERROR_NOT_FOUND';
        v_msg := v_code || ' is not enrolled in this period.';
      ELSE
        -- The live flag, not the stored one: 188 showed employment_flag on
        -- this table is only written at finalise.
        SELECT f.employment_flag INTO v_flag
          FROM vw_pms_employment_flag f WHERE f.employee_id = v_emp;

        IF COALESCE(v_ro, false) OR (v_flag = 'EXITED' AND v_cur IS NOT NULL) THEN
          v_status := 'ERROR_NOT_ELIGIBLE';
          v_msg := v_code || ' is read-only: they have left and their rating is settled.';
        ELSIF v_flag = 'NEW_JOINER' THEN
          v_status := 'ERROR_NOT_ELIGIBLE';
          v_msg := v_code || ' is a new joiner for this period and is not rated.';
        END IF;
      END IF;
    END IF;

    IF v_status = 'OK' AND (v_up IS NULL OR NOT (v_up = ANY(v_scale))) THEN
      v_status := 'ERROR_INVALID_RATING';
      -- Echo what the FILE said, not the parsed value. A cell reading 'abc'
      -- parses to NULL, and reporting that as "(blank) is not on the scale"
      -- sends an admin hunting an empty cell that is not empty.
      v_msg := COALESCE('"' || v_raw || '"', '(blank)')
            || ' is not on this company''s rating scale.';
    END IF;

    -- A reason only where the number moves. See the header.
    IF v_status = 'OK' AND v_cur IS NOT NULL AND v_up <> v_cur AND v_reason IS NULL THEN
      v_status := 'ERROR_REASON_MISSING';
      v_msg := v_code || ': the rating changes from ' || v_cur || ' to ' || v_up
            || ', so a reason is required.';
    END IF;

    -- THE GATE THAT USED TO SURFACE AS A ROLLBACK.
    --
    -- pms_finalise refuses without a FINAL_REVIEW discussion acknowledged by
    -- both sides where the policy asks for one. That refusal arrives during
    -- the apply pass, which raises and discards the whole batch — correct, but
    -- a rotten way to find out, and it loses the log. Observed live: a file
    -- whose single row passed every validation came back "Upload rolled back
    -- at SRS9088: BLOCKED: final review one-to-one not logged."
    --
    -- So the same question is asked here, where it becomes an ordinary
    -- per-row error with the other five. This is deliberately a SECOND copy
    -- of pms_finalise's rule, and that is defence in depth rather than
    -- divergence: pms_finalise remains the authority and the rollback stays
    -- as the backstop. A pre-flight check that disagrees can only ever be
    -- more cautious than the gate it precedes.
    IF v_status = 'OK' AND COALESCE(v_need121, false)
       AND NOT EXISTS (SELECT 1 FROM pms_one_to_one t
                        WHERE t.employee_id = v_emp AND t.period_id = p_period_id
                          AND t.discussion_type = 'FINAL_REVIEW'
                          AND t.employee_ack AND t.manager_ack) THEN
      v_status := 'ERROR_NOT_ELIGIBLE';
      v_msg := v_code || ': this policy requires a final review one-to-one, '
            || 'acknowledged by both sides, before a rating can be settled.';
    END IF;

    -- A benefit_type the CHECK constraint rejects has to be caught HERE.
    -- Discovered during the apply pass it would raise, rolling back a batch
    -- that had already passed validation and reporting it as a mysterious
    -- failure. ERROR_INVALID_RATING is the closest status the log's own CHECK
    -- allows — there is no ERROR_INVALID_BENEFIT — so the message carries the
    -- truth that the status code cannot.
    IF v_status = 'OK' AND v_benefit IS NOT NULL
       AND v_benefit NOT IN ('CERTIFICATE','SPOT_AWARD','TRAINING_NOMINATION',
                             'SPECIAL_MENTION','STAR_PERFORMER','OTHER') THEN
      v_status := 'ERROR_INVALID_RATING';
      v_msg := v_code || ': "' || v_benefit || '" is not a recognition type. '
            || 'Use CERTIFICATE, SPOT_AWARD, TRAINING_NOMINATION, '
            || 'SPECIAL_MENTION, STAR_PERFORMER or OTHER.';
    END IF;

    IF v_status <> 'OK' THEN v_errors := v_errors + 1; END IF;

    INSERT INTO pms_rating_upload_log
      (company_id, period_id, batch_id, employee_id, employee_code,
       system_rating, uploaded_rating, override_reason, validation_status,
       error_message, committed, uploaded_by)
    VALUES
      (v_company, p_period_id, v_batch, v_emp, v_code,
       v_cur, v_up,
       -- The file's claimed finaliser is kept here, clearly marked as a claim.
       CASE WHEN v_claimed IS NULL THEN v_reason
            ELSE COALESCE(v_reason, '') || ' [file names ' || v_claimed
                 || ' as finaliser; applied by the uploader]' END,
       v_status, v_msg, false, p_actor_id);
  END LOOP;

  -- An empty array is a no-op, not a success. Reported separately so "0 rows
  -- committed" never reads as a batch that worked, and so zero errors across
  -- zero rows cannot fall through into the apply pass as if it had passed.
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'batch_id', v_batch, 'rows', 0,
      'errors', 0, 'applied', 0,
      'message', 'That file had no data rows, so nothing was committed.');
  END IF;

  -- ── refused: the attempt stays logged, nothing is applied ────────────────
  IF v_errors > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'batch_id', v_batch, 'rows', v_total, 'errors', v_errors,
      'applied', 0,
      'message', v_errors || ' of ' || v_total || ' rows failed validation, so '
              || 'nothing was applied. The attempt is logged.');
  END IF;

  -- ── pass two: apply. Any refusal here rolls the whole batch back ─────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_code   := NULLIF(btrim(COALESCE(r->>'employee_code', '')), '');
    v_up     := NULLIF(btrim(COALESCE(r->>'final_rating', '')), '')::numeric;
    v_reason := NULLIF(btrim(COALESCE(r->>'override_reason', '')), '');
    SELECT e.id INTO v_emp FROM employees e
     WHERE upper(btrim(e.emp_code)) = upper(v_code);

    SELECT pms_finalise(v_emp, p_period_id, p_actor_id, p_actor_role, v_up, v_reason)
      INTO v_res;

    IF v_res IS DISTINCT FROM 'FINALISED' THEN
      RAISE EXCEPTION
        'Upload rolled back at %: %. Nothing in this batch was applied.',
        v_code, COALESCE(v_res, 'pms_finalise returned nothing');
    END IF;

    -- Distinguishable from a rating the engine produced.
    UPDATE pms_overall_rating
       SET rating_source = 'HR_OVERRIDE', updated_at = now()
     WHERE employee_id = v_emp AND period_id = p_period_id;

    -- The template's prose columns, where given. visible_to_employee stays
    -- false: finalising is not publishing.
    IF NULLIF(btrim(COALESCE(r->>'appreciation_remark', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(r->>'improvement_feedback', '')), '') IS NOT NULL THEN
      INSERT INTO pms_feedback
        (company_id, period_id, employee_id, appreciation_remark,
         improvement_feedback, given_by, given_by_role, visible_to_employee)
      VALUES
        (v_company, p_period_id, v_emp,
         NULLIF(btrim(COALESCE(r->>'appreciation_remark', '')), ''),
         NULLIF(btrim(COALESCE(r->>'improvement_feedback', '')), ''),
         p_actor_id, p_actor_role, false)
      ON CONFLICT (period_id, employee_id) DO UPDATE
        SET appreciation_remark  = COALESCE(EXCLUDED.appreciation_remark,
                                            pms_feedback.appreciation_remark),
            improvement_feedback = COALESCE(EXCLUDED.improvement_feedback,
                                            pms_feedback.improvement_feedback),
            given_by = EXCLUDED.given_by, given_by_role = EXCLUDED.given_by_role,
            updated_at = now();
    END IF;

    v_benefit := NULLIF(btrim(COALESCE(r->>'additional_benefit_type', '')), '');
    IF v_benefit IS NOT NULL THEN
      INSERT INTO pms_additional_benefits
        (company_id, period_id, employee_id, benefit_type, benefit_note, awarded_by)
      VALUES
        (v_company, p_period_id, v_emp, v_benefit,
         NULLIF(btrim(COALESCE(r->>'additional_benefit_note', '')), ''),
         p_actor_id);
    END IF;

    v_applied := v_applied + 1;
  END LOOP;

  UPDATE pms_rating_upload_log SET committed = true WHERE batch_id = v_batch;

  RETURN jsonb_build_object(
    'ok', true, 'batch_id', v_batch, 'rows', v_total, 'errors', 0,
    'applied', v_applied,
    'message', v_applied || ' ' || CASE WHEN v_applied = 1 THEN 'rating' ELSE 'ratings' END
            || ' committed. Results are finalised, not published.');
END $$;

NOTIFY pgrst, 'reload schema';
