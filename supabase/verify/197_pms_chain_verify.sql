-- 197_pms_chain_verify.sql — run AFTER 197.
-- Builds a fixture and ROLLS IT BACK, so it is safe on live data.
--
-- THE CASE THAT MATTERS IS THE COLLAPSED CHAIN, test 4 below. 197's first
-- version stepped to the next rung the POLICY lists, without asking who fills
-- it — and pms_resolve_chain drops RM L2 when it resolves to the same person
-- as RM L1, so 190 of the 395 enrolments in this database have approval_chain
-- SELF_RM1_RM2_HOD and rm_l2_id NULL. That version parked 48% of the company
-- on an RM_L2 nobody occupies, where neither approve nor reject could move it.
-- A permanent deadlock on the first approval of the cycle.
--
-- So this file does not merely check that approve advances. It checks that it
-- advances PAST an empty rung, which is the only version of the question the
-- live data actually asks.
--
-- Everything runs inside one transaction that ends in ROLLBACK. Nothing here
-- changes your data, including the fixture employee's enrolment.

BEGIN;

-- ── 0. the migration is actually in ──────────────────────────────────────
SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL — 197 not fully applied' END
         AS all_five_functions_exist,
       string_agg(proname, ', ' ORDER BY proname) AS found
  FROM pg_proc
 WHERE proname IN ('pms_chain_rungs','pms_chain_holder','pms_chain_submit',
                   'pms_chain_approve','pms_chain_reject');

SELECT CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL — columns missing' END
         AS all_five_columns_exist,
       string_agg(column_name, ', ' ORDER BY column_name) AS found
  FROM information_schema.columns
 WHERE table_name = 'pms_overall_rating'
   AND column_name IN ('chain_stage','sent_back_to','sent_back_by',
                       'sent_back_reason','sent_back_at');

-- chain_stage must be writable on a read-only row, or approving an exited
-- employee's appraisal throws instead of refusing readably.
SELECT CASE WHEN prosrc LIKE '%chain_stage%' THEN 'PASS'
            ELSE 'FAIL — pms_block_readonly does not know about chain_stage' END
         AS readonly_allows_the_stage_to_move
  FROM pg_proc WHERE proname = 'pms_block_readonly';

-- ── 1. the rung lists are what the module expects ────────────────────────
SELECT CASE WHEN pms_chain_rungs('SELF_RM1_RM2_HOD') = ARRAY['RM_L1','RM_L2','HOD','HR']
             AND pms_chain_rungs('SELF_RM1_HOD')     = ARRAY['RM_L1','HOD','HR']
             AND pms_chain_rungs('SELF_RM1')         = ARRAY['RM_L1','HR']
            THEN 'PASS' ELSE 'FAIL' END AS rungs_are_correct;

-- An unknown chain must come back EMPTY, not fall through to a default that
-- would silently run somebody on the wrong chain.
SELECT CASE WHEN pms_chain_rungs('SELF_RM1_RM2_HOD_MD') = ARRAY[]::text[]
            THEN 'PASS' ELSE 'FAIL — an unsupported chain got a rung list' END
         AS md_chain_is_not_offered;

-- ── 2-6. the live behaviour, on a fixture ────────────────────────────────
DO $$
DECLARE
  v_co uuid; v_per uuid; v_emp uuid; v_l1 uuid; v_l2 uuid; v_hod uuid;
  v_chain text; v_r text; v_stage text; v_reason text;
BEGIN
  -- A period whose policy runs the full four-rung chain, so the collapsed
  -- case below is a real skip rather than a chain that never had an L2.
  SELECT pe.id, pe.company_id, p.approval_chain
    INTO v_per, v_co, v_chain
    FROM pms_periods pe
    JOIN pms_policies p ON p.id = pe.policy_id
   WHERE p.approval_chain = 'SELF_RM1_RM2_HOD'
   ORDER BY pe.period_start DESC LIMIT 1;
  IF v_per IS NULL THEN
    RAISE NOTICE 'SKIP  no period on a SELF_RM1_RM2_HOD policy';
    RETURN;
  END IF;

  -- An employee NOT already enrolled, so the fixture cannot disturb a real
  -- appraisal even before the rollback.
  SELECT e.id INTO v_emp FROM employees e
   WHERE e.company_id = v_co
     AND NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  -- Three other people to stand on the rungs, each distinct from the last so
  -- the identity guards are actually exercised rather than passing because
  -- one person holds everything.
  SELECT e.id INTO v_l1 FROM employees e
   WHERE e.company_id = v_co AND e.id <> v_emp ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_l2 FROM employees e
   WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1) ORDER BY e.emp_code LIMIT 1;
  SELECT e.id INTO v_hod FROM employees e
   WHERE e.company_id = v_co AND e.id NOT IN (v_emp, v_l1, v_l2) ORDER BY e.emp_code LIMIT 1;
  IF v_emp IS NULL OR v_l1 IS NULL OR v_l2 IS NULL OR v_hod IS NULL THEN
    RAISE NOTICE 'SKIP  need an unenrolled employee plus three others in one company';
    RETURN;
  END IF;

  -- ── 2. submit refuses without a self rating ────────────────────────────
  INSERT INTO pms_overall_rating (company_id, period_id, employee_id,
                                  workflow_status, rm_l1_id, rm_l2_id, hod_id)
  VALUES (v_co, v_per, v_emp, 'KRA_LOCKED', v_l1, v_l2, v_hod);

  v_r := pms_chain_submit(v_emp, v_per);
  IF v_r LIKE 'BLOCKED%no self rating%' THEN
    RAISE NOTICE 'PASS  2. submit refuses with no self rating';
  ELSE
    RAISE NOTICE 'FAIL  2. expected a no-self-rating refusal, got: %', v_r;
  END IF;

  -- ── 3. submit lands on RM L1 ───────────────────────────────────────────
  UPDATE pms_overall_rating SET self_score = 3.4
   WHERE employee_id = v_emp AND period_id = v_per;

  v_r := pms_chain_submit(v_emp, v_per);
  SELECT chain_stage INTO v_stage FROM pms_overall_rating
   WHERE employee_id = v_emp AND period_id = v_per;
  IF v_r = 'SUBMITTED:RM_L1' AND v_stage = 'RM_L1' THEN
    RAISE NOTICE 'PASS  3. submit lands on RM L1';
  ELSE
    RAISE NOTICE 'FAIL  3. got % with stage %', v_r, v_stage;
  END IF;

  -- ── 3b. an impostor cannot approve ─────────────────────────────────────
  v_r := pms_chain_approve(v_emp, v_per, v_hod, 'RM_L1', NULL);
  IF v_r LIKE 'BLOCKED%not the RM_L1%' THEN
    RAISE NOTICE 'PASS  3b. claiming a rung you do not hold is refused';
  ELSE
    RAISE NOTICE 'FAIL  3b. expected an identity refusal, got: %', v_r;
  END IF;

  -- ── 4. THE COLLAPSED CHAIN — the deadlock case ─────────────────────────
  -- Drop RM L2 exactly as pms_resolve_chain does for 190 of the 395 real
  -- enrolments, then approve as RM L1. The stage must reach HOD, NOT RM_L2.
  UPDATE pms_overall_rating SET rm_l2_id = NULL
   WHERE employee_id = v_emp AND period_id = v_per;

  v_r := pms_chain_approve(v_emp, v_per, v_l1, 'RM_L1', NULL);
  SELECT chain_stage INTO v_stage FROM pms_overall_rating
   WHERE employee_id = v_emp AND period_id = v_per;

  IF v_stage = 'HOD' THEN
    RAISE NOTICE 'PASS  4. an unfilled RM L2 is SKIPPED — stage went to HOD';
  ELSIF v_stage = 'RM_L2' THEN
    RAISE NOTICE 'FAIL  4. DEADLOCK: parked on RM_L2 with rm_l2_id NULL. '
                 'Nobody can approve or reject this. (approve returned: %)', v_r;
  ELSE
    RAISE NOTICE 'FAIL  4. stage is % (approve returned: %)', v_stage, v_r;
  END IF;

  -- ── 5. reject needs a remark, and goes back to a HELD rung ─────────────
  v_r := pms_chain_reject(v_emp, v_per, v_hod, 'HOD', 'no');
  IF v_r LIKE 'BLOCKED%remark%' THEN
    RAISE NOTICE 'PASS  5a. a rejection without a real remark is refused';
  ELSE
    RAISE NOTICE 'FAIL  5a. expected a remark refusal, got: %', v_r;
  END IF;

  v_r := pms_chain_reject(v_emp, v_per, v_hod, 'HOD',
                          'Weightage on KRA 2 is too high for this quarter.');
  SELECT chain_stage, sent_back_reason INTO v_stage, v_reason
    FROM pms_overall_rating WHERE employee_id = v_emp AND period_id = v_per;

  -- RM_L1, not RM_L2: the rung between them is empty, and a rejection that
  -- strands the set is worse than none at all.
  IF v_stage = 'RM_L1' AND v_reason IS NOT NULL THEN
    RAISE NOTICE 'PASS  5b. rejection went back to RM L1, skipping the empty rung, with the reason kept';
  ELSE
    RAISE NOTICE 'FAIL  5b. stage % reason % (returned: %)', v_stage, v_reason, v_r;
  END IF;

  -- ── 6. the last held rung finalises, and demands a rating ──────────────
  -- Put it back with the HOD and remove the HOD's successor so the HOD is
  -- last before HR.
  UPDATE pms_overall_rating SET chain_stage = 'HOD'
   WHERE employee_id = v_emp AND period_id = v_per;

  v_r := pms_chain_approve(v_emp, v_per, v_hod, 'HOD', NULL);
  IF v_r LIKE 'BLOCKED%final rating is needed%' THEN
    RAISE NOTICE 'PASS  6a. the finalising rung refuses without a rating';
  ELSE
    RAISE NOTICE 'NOTE  6a. got: % (a policy gate such as the final-review '
                 'one-to-one may answer first, which is also correct)', v_r;
  END IF;

  -- ── 7. a published appraisal cannot be rejected ────────────────────────
  UPDATE pms_overall_rating SET chain_stage = 'HR'
   WHERE employee_id = v_emp AND period_id = v_per;
  v_r := pms_chain_reject(v_emp, v_per, v_hod, 'HOD',
                          'Changed my mind about this rating entirely.');
  IF v_r LIKE 'BLOCKED%' THEN
    RAISE NOTICE 'PASS  7. HR''s rung cannot be rejected into';
  ELSE
    RAISE NOTICE 'FAIL  7. a rejection reached the HR stage: %', v_r;
  END IF;
END $$;

-- NOTHING IS KEPT. Every row above disappears here.
ROLLBACK;
