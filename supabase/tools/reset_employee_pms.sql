-- reset_employee_pms.sql — put ONE employee's PMS back to the start point.
--
-- Paste into the Supabase SQL editor, set the two settings at the top, run.
-- SAFE TO RUN TWICE: a second run finds nothing to delete and reports zeroes.
--
-- ============================================================================
-- WHAT IT DOES
--
--   DELETE  pms_reviews             every rating, every rater (SELF too)
--   DELETE  pms_one_to_one          every logged discussion
--   DELETE  pms_employee_goals      the KRAs themselves
--   DELETE  pms_feedback            appreciation / improvement / RM comment
--   DELETE  pms_additional_benefits recognition awarded on this cycle
--   DELETE  pms_pip (+ its areas)   any PIP raised on this cycle
--   UPDATE  pms_overall_rating      back to NOT_STARTED, every score NULL
--
-- The employee lands on stage 1, "KRA Setting", exactly like somebody who
-- has never started.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
--
-- IT DOES NOT DELETE pms_overall_rating. That row IS the enrolment — it is
-- what puts the person in the cycle at all, and every untouched employee in
-- the database has one sitting at NOT_STARTED. Deleting it does not reset
-- them to the start of the period, it removes them from the period.
--
-- IT DOES NOT TOUCH pms_audit_log. The audit trail is the record that this
-- work happened and was then undone. Erasing it is the one part of a reset
-- that cannot be justified: it would leave no trace that a rating ever
-- existed, which is the opposite of what an audit log is for.
--
-- ── THE GUARD, AND WHY IT IS THERE ─────────────────────────────────────────
--
-- A PUBLISHED or ACKNOWLEDGED result has been READ BY THE EMPLOYEE. Wiping
-- one is not a reset, it is deleting something a person has already been
-- told and may have signed. This script refuses by default and makes you
-- say so in writing (v_force_published) — it does not merely warn.
--
-- A READ-ONLY record (rule 12: the employee has exited and the rating is
-- finalised) is refused outright. The database would refuse most of it
-- anyway: pms_block_readonly allows only workflow_status, published_at,
-- employee_ack, employee_ack_at, updated_at and chain_stage to change on
-- such a row, so the score columns below would raise. Better to say why up
-- front than to half-run and abort.
--
-- ── IT PRINTS WHAT IT DID ──────────────────────────────────────────────────
--
-- Through a temp table and a final SELECT, not RAISE NOTICE. The Supabase
-- editor shows the result of the LAST statement and discards notices, so a
-- DO block that reports with RAISE NOTICE runs silently and tells you
-- nothing. Read the table at the bottom; that is the output.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _reset(seq int, step text, detail text) ON COMMIT DROP;
-- WHO WAS RESOLVED, so the verification at the bottom reads the same person
-- the DO block acted on. The first version hardcoded 'STC9030' down there
-- while the top was a variable: change the code at the top and the proof
-- would have described somebody else entirely.
CREATE TEMP TABLE _who(emp_code text, emp_id uuid, period text) ON COMMIT DROP;

DO $$
DECLARE
  -- ── SET THESE TWO ────────────────────────────────────────────────────────

  -- Who. The employee code as it appears on screen.
  v_emp_code   text := 'STC9030';

  -- Which cycle. NULL means every period this person is enrolled in; set a
  -- period_code (for example 'Q2-FY202627') to reset only that one.
  v_period     text := NULL;

  -- Leave false. Setting it true lets the script wipe a result the employee
  -- has already been shown. Read the guard note in the header first.
  v_force_published boolean := false;

  -- ── nothing below needs editing ──────────────────────────────────────────
  v_emp     uuid;
  v_count   int;
  v_n       int;
  v_blocked int;
BEGIN
  -- ONE PERSON, OR STOP. A code that matches nobody is a typo; a code that
  -- matches several means the data is not what this script assumes, and
  -- guessing which one was meant is exactly the wrong move.
  SELECT count(*) INTO v_count FROM employees WHERE emp_code = v_emp_code;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No employee with code %. Nothing was changed.', v_emp_code;
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION '% employees share the code %. Nothing was changed.',
                    v_count, v_emp_code;
  END IF;
  SELECT id INTO v_emp FROM employees WHERE emp_code = v_emp_code;
  INSERT INTO _who VALUES (v_emp_code, v_emp, v_period);

  INSERT INTO _reset VALUES (0, 'employee',
    v_emp_code || ' · ' || (SELECT full_name FROM employees WHERE id = v_emp)
    || COALESCE(' · period ' || v_period, ' · all periods'));

  -- ── the guards ───────────────────────────────────────────────────────────

  SELECT count(*) INTO v_blocked
    FROM pms_overall_rating o
    LEFT JOIN pms_periods p ON p.id = o.period_id
   WHERE o.employee_id = v_emp
     AND (v_period IS NULL OR p.period_code = v_period)
     AND o.is_readonly;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Refused: % record(s) are read-only (employee exited with a '
                    'finalised rating, rule 12). Nothing was changed.', v_blocked;
  END IF;

  SELECT count(*) INTO v_blocked
    FROM pms_overall_rating o
    LEFT JOIN pms_periods p ON p.id = o.period_id
   WHERE o.employee_id = v_emp
     AND (v_period IS NULL OR p.period_code = v_period)
     AND (o.workflow_status IN ('PUBLISHED', 'ACKNOWLEDGED')
          OR o.published_at IS NOT NULL
          OR o.employee_ack);
  IF v_blocked > 0 AND NOT v_force_published THEN
    RAISE EXCEPTION 'Refused: % result(s) have already been published to or '
                    'acknowledged by the employee. Set v_force_published := true '
                    'if you really mean to erase something they have read. '
                    'Nothing was changed.', v_blocked;
  END IF;
  IF v_blocked > 0 THEN
    INSERT INTO _reset VALUES (1, 'WARNING',
      v_blocked || ' published/acknowledged result(s) wiped on purpose '
      || '(v_force_published was true)');
  END IF;

  -- ── the deletes, children first ──────────────────────────────────────────
  -- pms_reviews references pms_employee_goals, so ratings go before goals or
  -- the foreign key refuses.

  DELETE FROM pms_reviews r USING pms_periods p
   WHERE r.employee_id = v_emp AND p.id = r.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (2, 'pms_reviews deleted', v_n::text);

  DELETE FROM pms_one_to_one t USING pms_periods p
   WHERE t.employee_id = v_emp AND p.id = t.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (3, 'pms_one_to_one deleted', v_n::text);

  DELETE FROM pms_employee_goals g USING pms_periods p
   WHERE g.employee_id = v_emp AND p.id = g.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (4, 'pms_employee_goals deleted', v_n::text);

  DELETE FROM pms_feedback f USING pms_periods p
   WHERE f.employee_id = v_emp AND p.id = f.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (5, 'pms_feedback deleted', v_n::text);

  DELETE FROM pms_additional_benefits b USING pms_periods p
   WHERE b.employee_id = v_emp AND p.id = b.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (6, 'pms_additional_benefits deleted', v_n::text);

  -- The areas hang off the PIP, so they go first whether or not the FK
  -- cascades — this does not depend on how that constraint was declared.
  DELETE FROM pms_pip_areas a
   WHERE a.pip_id IN (SELECT i.id FROM pms_pip i
                        JOIN pms_periods p ON p.id = i.period_id
                       WHERE i.employee_id = v_emp
                         AND (v_period IS NULL OR p.period_code = v_period));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (7, 'pms_pip_areas deleted', v_n::text);

  DELETE FROM pms_pip i USING pms_periods p
   WHERE i.employee_id = v_emp AND p.id = i.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (8, 'pms_pip deleted', v_n::text);

  -- ── the enrolment row is RESET, never deleted ────────────────────────────

  UPDATE pms_overall_rating o
     SET workflow_status  = 'NOT_STARTED',
         chain_stage      = NULL,
         self_score       = NULL,
         rm_l1_score      = NULL,
         rm_l2_score      = NULL,
         hod_score        = NULL,
         final_score      = NULL,
         final_rating     = NULL,
         final_rating_code= NULL,
         finalised_by     = NULL,
         finalised_by_role= NULL,
         finalised_at     = NULL,
         published_at     = NULL,
         employee_ack     = false,
         employee_ack_at  = NULL,
         sent_back_to     = NULL,
         sent_back_by     = NULL,
         sent_back_at     = NULL,
         sent_back_reason = NULL
    FROM pms_periods p
   WHERE o.employee_id = v_emp AND p.id = o.period_id
     AND (v_period IS NULL OR p.period_code = v_period);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _reset VALUES (9, 'pms_overall_rating reset', v_n::text);

  INSERT INTO _reset VALUES (10, 'pms_audit_log', 'untouched, on purpose');
END $$;

-- ── what is left, read straight back from the tables ────────────────────────
-- Proof rather than assertion: these are counted AFTER the deletes, in the
-- same transaction.

INSERT INTO _reset
SELECT 20, 'now: ' || t, n::text FROM (
  SELECT 'goals'       AS t, count(*) AS n
    FROM pms_employee_goals WHERE employee_id = (SELECT emp_id FROM _who)
  UNION ALL
  SELECT 'reviews',    count(*)
    FROM pms_reviews        WHERE employee_id = (SELECT emp_id FROM _who)
  UNION ALL
  SELECT 'one_to_one', count(*)
    FROM pms_one_to_one     WHERE employee_id = (SELECT emp_id FROM _who)
  UNION ALL
  SELECT 'feedback',   count(*)
    FROM pms_feedback       WHERE employee_id = (SELECT emp_id FROM _who)
) x;

INSERT INTO _reset
SELECT 21, 'now: overall · ' || COALESCE(p.period_code, '?'),
       o.workflow_status || ' · chain_stage ' || COALESCE(o.chain_stage, 'NULL')
       || ' · self ' || COALESCE(o.self_score::text, 'NULL')
       || ' · final ' || COALESCE(o.final_rating::text, 'NULL')
  FROM pms_overall_rating o
  LEFT JOIN pms_periods p ON p.id = o.period_id
 WHERE o.employee_id = (SELECT emp_id FROM _who);

-- THE OUTPUT. This table is the whole point of the script.
SELECT step, detail FROM _reset ORDER BY seq, step;

COMMIT;

-- ============================================================================
-- IF IT REFUSED
--
-- The exception rolls the whole thing back — nothing is half-reset. Read the
-- message: it names the reason (read-only, or already published) and the
-- number of rows that caused it.
--
-- IF YOU WANT TO SEE WHAT WOULD HAPPEN WITHOUT DOING IT
--
-- Change the final COMMIT to ROLLBACK. Every count above is still computed
-- and returned, and nothing is kept.
-- ============================================================================
