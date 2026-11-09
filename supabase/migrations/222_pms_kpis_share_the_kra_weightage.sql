-- 222_pms_kpis_share_the_kra_weightage.sql
-- A KPI has no weightage of its own. The KRA has one, and its KPIs split it.
-- SAFE TO RUN TWICE. One comment, four functions, two gates.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: "kpis do not have their own weightage and only kras have their
-- weightage, and total weightage of all the kras will be not more than 100%";
-- and "user can not proceed to submit kras without achieving 100% weightage
-- and filling all the minimum kras and kpis"; and all KRAs must be rated,
-- by every rung, before the appraisal moves.
--
-- 220 gave each KPI its own weightage and made the KPIs of a KRA sum to that
-- KRA's. That is one more number to keep balanced on every screen, and the
-- balancing was the only thing it bought: the arithmetic below produces the
-- same appraisal score without it.
--
-- ── WHY THIS DOES NOT MOVE SCORES ──────────────────────────────────────────
--
-- A KPI's weight is now its KRA's weightage divided by how many KPIs that KRA
-- has:
--
--   before   w_kpi = pms_goal_kpi.weightage          (stored, had to balance)
--   after    w_kpi = kra.weightage / n_kpis_in_kra   (computed, cannot not)
--
-- For a KRA with ONE KPI the two are identical — w/1 = w — and 220's backfill
-- gave every KRA that existed exactly one KPI carrying its whole weightage.
-- So every appraisal written before this migration scores the same to the
-- last decimal.
--
-- A KRA somebody has since built with UNEVEN KPI weightages (say 20 and 10 on
-- a 30% KRA) becomes 15 and 15, and its score moves. The verify script lists
-- every such appraisal with the old and new number. It is reported rather
-- than refused: a settled rating that moved is something to look at, not a
-- reason to leave the schema half-migrated.
--
-- ── THE COLUMN IS RETIRED, NOT DROPPED ─────────────────────────────────────
--
-- pms_goal_kpi.weightage keeps its rows and is read by nothing. Dropping it
-- would throw away the only record of how somebody chose to split a KRA, to
-- save one dormant column. If per-KPI weightage is ever wanted back, the
-- numbers are still there.
--
-- ── EVERY RUNG RATES EVERY KPI ─────────────────────────────────────────────
--
-- pms_chain_submit checked that SOME self score existed; pms_chain_approve
-- checked nothing at all. Both now refuse while any KPI is unrated by the
-- person acting — so a half-rated appraisal cannot reach the finaliser, and
-- the final rating is never an average of work nobody looked at.
--
-- ENGINE COMPUTES, SQL DECIDES. lib/pms/kpi.ts predicts all of this so the
-- form can disable a button and say why; this file is what refuses.

-- ── 1. the column is retired ───────────────────────────────────────────────

COMMENT ON COLUMN pms_goal_kpi.weightage IS
  'RETIRED by 222 and read by NOTHING. A KPI has no weightage of its own: '
  'its share is its KRA''s weightage divided by the number of KPIs under '
  'that KRA, computed in pms_score. The rows are kept because they record '
  'how somebody chose to split a KRA before the rule changed. Do not read '
  'this column — a KRA whose KPIs were 20/10 still says 20/10 here while '
  'the appraisal scores it 15/15.';

-- ── 2. the score, over KPIs that share their KRA's weightage ───────────────
--
-- Identical in shape to 220's. Only the weight changes, from a stored column
-- to kra.weightage / n. Unrated KPIs stay out of BOTH the numerator and the
-- denominator, exactly as before — so a KRA with three KPIs of which two are
-- rated contributes the average of those two, at two thirds of its weightage.
-- That is "average the ones rated so far", which is what the screens show.

CREATE OR REPLACE FUNCTION pms_score(p_employee_id uuid, p_period_id uuid, p_role text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH shared AS (
    -- COUNT(*) OVER (PARTITION BY goal_id) counts every KPI under the KRA,
    -- rated or not. Counting only the rated ones would make each rated KPI
    -- grow to fill the KRA, and a one-of-three-rated KRA would carry its
    -- full weightage on a third of the evidence.
    SELECT k.id,
           g.weightage::numeric
             / NULLIF(COUNT(*) OVER (PARTITION BY k.goal_id), 0) AS w
      FROM pms_goal_kpi k
      JOIN pms_employee_goals g ON g.id = k.goal_id
     WHERE k.employee_id = p_employee_id AND k.period_id = p_period_id
  )
  SELECT ROUND(COALESCE(SUM(r.rating * s.w) / NULLIF(SUM(s.w), 0), 0), 2)
    FROM shared s
    JOIN pms_reviews r
      ON r.kpi_id = s.id AND r.rater_role = p_role AND r.submitted = true;
$$;

COMMENT ON FUNCTION pms_score IS
  'The weighted mean rating for one rater role, over the KPIs they have '
  'rated. Each KPI carries its KRA''s weightage divided by the number of '
  'KPIs under that KRA — pms_goal_kpi.weightage is retired and not read.';

-- ── 3. the KPI rules, without the balance that no longer exists ────────────
--
-- 221's version checked three things: too few KPIs, too many, and whether
-- they summed to the KRA's weightage. The third is gone with the column —
-- equal shares cannot fail to add up. The counts remain, and they are what
-- "filling all the minimum kras and kpis" is enforced by.

CREATE OR REPLACE FUNCTION pms_validate_kpis(p_employee_id uuid, p_period_id uuid)
RETURNS TABLE (goal_id uuid, seq_no int, kra_title text,
               kra_weightage numeric, kpi_total numeric, kpi_count int,
               error_msg text)
LANGUAGE sql STABLE AS $$
  -- pol ALWAYS YIELDS EXACTLY ONE ROW, as 221 established: a SELECT with no
  -- FROM does, whatever the subqueries find, so an unknown period cannot
  -- empty the CROSS JOIN and report "every KRA is fine".
  WITH pol AS (
    SELECT COALESCE((SELECT p.min_kpi_per_kra
                       FROM pms_periods pe
                       JOIN pms_policies p ON p.id = pe.policy_id
                      WHERE pe.id = p_period_id), 1) AS min_kpi,
           COALESCE((SELECT p.max_kpi_per_kra
                       FROM pms_periods pe
                       JOIN pms_policies p ON p.id = pe.policy_id
                      WHERE pe.id = p_period_id), 5) AS max_kpi
  ), gk AS (
    SELECT g.id, g.seq_no, g.kra_title, g.weightage,
           COUNT(k.id)::int AS kpi_count
      FROM pms_employee_goals g
      LEFT JOIN pms_goal_kpi k ON k.goal_id = g.id
     WHERE g.employee_id = p_employee_id
       AND g.period_id   = p_period_id
       AND g.status <> 'SENT_BACK'
     GROUP BY g.id, g.seq_no, g.kra_title, g.weightage
  )
  SELECT gk.id, gk.seq_no, gk.kra_title, gk.weightage,
         -- kpi_total is kept in the signature and is now simply the KRA's
         -- own weightage: the KPIs always total it exactly. Returning it
         -- rather than dropping the column keeps every existing caller and
         -- verify script working.
         gk.weightage, gk.kpi_count,
         CASE
           WHEN gk.kpi_count = 0 THEN
             format('“%s” has no KPI. A KRA is measured by at least one.',
                    gk.kra_title)
           WHEN gk.kpi_count < pol.min_kpi THEN
             format('“%s” has %s KPI(s); the policy asks for at least %s.',
                    gk.kra_title, gk.kpi_count, pol.min_kpi)
           WHEN gk.kpi_count > pol.max_kpi THEN
             format('“%s” has %s KPIs; the policy allows at most %s.',
                    gk.kra_title, gk.kpi_count, pol.max_kpi)
         END
    FROM gk CROSS JOIN pol
   WHERE gk.kpi_count = 0
      OR gk.kpi_count < pol.min_kpi
      OR gk.kpi_count > pol.max_kpi
   ORDER BY gk.seq_no;
$$;

COMMENT ON FUNCTION pms_validate_kpis IS
  'The KRAs whose KPI COUNT breaks the policy: none at all, too few, or too '
  'many. The weightage check 220 and 221 carried is gone — a KPI has no '
  'weightage of its own since 222, so its KRA''s total cannot fail to add '
  'up. Across KRAs the total of exactly 100 is pms_validate_kras'' job.';

-- ── 4. how much is still unrated, for one rater ────────────────────────────
--
-- The question both gates below ask. A function rather than a subquery in
-- each, so the two cannot drift: "submitted and not null" has to mean the
-- same thing to the employee and to every manager, or one of them is held to
-- a standard the other is not.

CREATE OR REPLACE FUNCTION pms_unrated_kpis(
  p_employee_id uuid, p_period_id uuid, p_role text)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int
    FROM pms_goal_kpi k
    JOIN pms_employee_goals g
      ON g.id = k.goal_id AND g.status <> 'SENT_BACK'
   WHERE k.employee_id = p_employee_id
     AND k.period_id   = p_period_id
     -- A row with submitted = false is a draft, and a NULL rating is a row
     -- that exists because something else was typed into it. Neither is a
     -- rating, and counting either as one is how a blank reaches the chain.
     AND NOT EXISTS (
       SELECT 1 FROM pms_reviews r
        WHERE r.kpi_id = k.id
          AND r.rater_role = p_role
          AND r.submitted = true
          AND r.rating IS NOT NULL);
$$;

COMMENT ON FUNCTION pms_unrated_kpis IS
  'How many KPIs this rater role has not rated for this employee and period. '
  'Zero is the condition for submitting and for approving — every rung rates '
  'every KPI, so a final rating is never an average of work nobody saw.';


-- ── 5. the two gates ───────────────────────────────────────────────────────
--
-- Both functions are reproduced from 197 and each has ONE block added, marked
-- below. Generated from 197's bytes rather than retyped: the last time a
-- migration restated a deployed function from memory it silently dropped the
-- UPDATE that advances the workflow, and what was left looked complete.
-- A test diffs both bodies against 197 and allows only the marked lines.

CREATE OR REPLACE FUNCTION pms_chain_submit(p_employee_id uuid, p_period_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_chain text; v_rungs text[]; v_first text; v_self numeric; v_ro boolean;
        v_left int;
BEGIN
  SELECT p.approval_chain, o.self_score, o.is_readonly
    INTO v_chain, v_self, v_ro
    FROM pms_overall_rating o
    JOIN pms_periods pe ON pe.id = o.period_id
    JOIN pms_policies p ON p.id = pe.policy_id
   WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;
  IF NOT FOUND THEN RETURN 'BLOCKED: not enrolled in this period.'; END IF;
  IF v_ro THEN RETURN 'BLOCKED: this record is read-only.'; END IF;

  v_rungs := pms_chain_rungs(v_chain);
  IF array_length(v_rungs, 1) IS NULL THEN
    RETURN 'BLOCKED: this policy''s approval chain (' || COALESCE(v_chain, 'none')
        || ') is not one this module runs.';
  END IF;

  -- Rule 6 restated where it is now reachable. trg_pms_self_first already
  -- blocks a manager rating before the self rating, but a submission with no
  -- self rating would park the appraisal on a manager who then cannot act.
  IF v_self IS NULL THEN
    RETURN 'BLOCKED: no self rating on record. Submit your ratings with your '
        || 'KRAs first.';
  END IF;

  -- ── 222 adds this ────────────────────────────────────────────────────────
  -- EVERY KRA MUST BE RATED, which since 220 means every KPI under it. The
  -- check above only asked whether SOME self score existed, so an employee
  -- who rated one measure of nine could submit, and the eight blanks became
  -- weightage the chain scored against nothing.
  v_left := pms_unrated_kpis(p_employee_id, p_period_id, 'SELF');
  IF v_left > 0 THEN
    RETURN format('BLOCKED: %s measure(s) still need your rating. Every KRA '
                  'has to be rated before this goes to your manager.', v_left);
  END IF;
  -- ── end 222 ──────────────────────────────────────────────────────────────

  -- A skipped rung is not an empty rung. If the chain says RM_L2 and the
  -- frozen snapshot has none, the period should not have opened; refusing
  -- here is better than silently handing the appraisal to the HOD.
  v_first := v_rungs[1];
  IF pms_chain_holder(p_employee_id, p_period_id, v_first) IS NULL THEN
    RETURN 'BLOCKED: this period''s frozen chain has no ' || v_first
        || '. See vw_pms_org_readiness.';
  END IF;

  UPDATE pms_overall_rating
     SET chain_stage = v_first,
         -- A fresh submission answers any previous rejection.
         sent_back_to = NULL, sent_back_by = NULL,
         sent_back_reason = NULL, sent_back_at = NULL,
         updated_at = now()
   WHERE employee_id = p_employee_id AND period_id = p_period_id;
  RETURN 'SUBMITTED:' || v_first;
END $$;

CREATE OR REPLACE FUNCTION pms_chain_approve(
  p_employee_id uuid, p_period_id uuid, p_actor_id uuid, p_actor_role text,
  p_rating numeric DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_chain text; v_rungs text[]; v_stage text; v_idx int; v_next text;
        v_holder uuid; v_ro boolean; v_res text; v_lock text;
        v_left int;
BEGIN
  SELECT p.approval_chain, o.chain_stage, o.is_readonly
    INTO v_chain, v_stage, v_ro
    FROM pms_overall_rating o
    JOIN pms_periods pe ON pe.id = o.period_id
    JOIN pms_policies p ON p.id = pe.policy_id
   WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;
  IF NOT FOUND THEN RETURN 'BLOCKED: not enrolled in this period.'; END IF;
  IF v_ro THEN RETURN 'BLOCKED: this record is read-only.'; END IF;
  IF v_stage IS NULL THEN
    RETURN 'BLOCKED: nothing has been submitted for approval yet.';
  END IF;
  IF v_stage = 'EMPLOYEE' THEN
    RETURN 'BLOCKED: this is back with the employee after a rejection. They '
        || 'resubmit it.';
  END IF;
  IF v_stage = 'DONE' THEN
    RETURN 'BLOCKED: this appraisal is already complete.';
  END IF;

  v_rungs := pms_chain_rungs(v_chain);
  v_idx := array_position(v_rungs, v_stage);
  IF v_idx IS NULL THEN
    RETURN 'BLOCKED: stage ' || v_stage || ' is not part of this policy''s chain.';
  END IF;

  -- IDENTITY, not a claimed role. The same guard 188 added to pms_finalise,
  -- for the same reason: without it the role string is self-asserted and any
  -- manager could approve anybody's appraisal.
  IF v_stage <> 'HR' THEN
    IF p_actor_role IS DISTINCT FROM v_stage THEN
      RETURN 'BLOCKED: this is with ' || v_stage || ', not ' || COALESCE(p_actor_role, 'nobody') || '.';
    END IF;
    v_holder := pms_chain_holder(p_employee_id, p_period_id, v_stage);
    IF v_holder IS NULL OR v_holder <> p_actor_id THEN
      RETURN 'BLOCKED: you are not the ' || v_stage || ' recorded for this '
          || 'employee in this period.';
    END IF;
  ELSE
    -- HR's move is to publish, which is its own path and changes no rating.
    IF p_actor_role NOT IN ('HR_MANAGER','HR_HEAD','ADMIN') THEN
      RETURN 'BLOCKED: only HR can act at this stage.';
    END IF;
  END IF;

  -- ── 222 adds this ────────────────────────────────────────────────────────
  -- EVERY RUNG RATES EVERY KPI. Approving checked nothing at all before, so
  -- a manager could pass an appraisal on having rated none of it, and the
  -- finaliser would average whatever happened to be there.
  --
  -- HR is exempt because HR's move at this stage is publication and changes
  -- no rating — there is no HR rating to be missing. The LAST REVIEWER is
  -- not exempt: they are on a real rung when they finalise, so they are
  -- held to this on the same approval that calls pms_finalise.
  IF v_stage <> 'HR' THEN
    v_left := pms_unrated_kpis(p_employee_id, p_period_id, v_stage);
    IF v_left > 0 THEN
      RETURN format('BLOCKED: %s measure(s) still need your rating. Rate '
                    'every KRA before approving.', v_left);
    END IF;
  END IF;
  -- ── end 222 ──────────────────────────────────────────────────────────────

  -- THE WEIGHTAGE LOCK HAPPENS HERE, at the first reviewer's approval.
  -- §1 Stage 3 requires the dual-acknowledged one-to-one before a lock, and
  -- pms_lock_kras enforces that and refuses otherwise — so this is also where
  -- a missing one-to-one surfaces, in a sentence written for the manager.
  IF v_idx = 1 THEN
    SELECT pms_lock_kras(p_employee_id, p_period_id, p_actor_id) INTO v_lock;
    IF v_lock IS DISTINCT FROM 'LOCKED' THEN
      RETURN COALESCE(v_lock, 'BLOCKED: the weightages could not be locked.');
    END IF;
    -- pms_lock_kras ENDS WITH workflow_status = 'KRA_LOCKED', unconditionally.
    -- That was written for the old order, where locking preceded the self
    -- rating. Here the employee has already self-rated — pms_chain_submit
    -- refuses without it — so the bare lock REWINDS the status from
    -- SELF_SUBMITTED back to KRA_LOCKED, and the appraisal looks like it lost
    -- its self rating. 190's recompute reads the facts instead of trusting the
    -- write, and its CASE ranks SELF_SUBMITTED above KRA_LOCKED, so this puts
    -- the status back where the ratings say it belongs.
    PERFORM pms_refresh_workflow(p_employee_id, p_period_id);
  END IF;

  /**
   * THE NEXT RUNG THAT SOMEBODY ACTUALLY OCCUPIES.
   *
   * NOT v_rungs[v_idx + 1]. The policy's chain says which rungs a cycle has;
   * the FROZEN SNAPSHOT says who fills them for this employee, and the two
   * disagree by design. pms_resolve_chain (067) drops RM L2 when it resolves
   * to the same person as RM L1 — "Same person at L1 and L2: drop L2, keep
   * them as L1 reviewer" — so a collapsed line has a policy chain of
   * SELF_RM1_RM2_HOD and a snapshot shape of L1_HOD with rm_l2_id NULL.
   *
   * MEASURED, NOT IMAGINED: 190 of the 395 enrolments in the database are in
   * exactly that state. Stepping blindly to the next listed rung would have
   * parked 48% of the company on RM_L2 with no RM_L2 in existence — and both
   * approve and reject check identity against the frozen chain, so NOBODY
   * could have moved it in either direction. Not a stall: a permanent
   * deadlock, for half the company, on the first approval.
   *
   * This is the same bug lib/pms/team.ts's hasRmL2 was written to fix on the
   * queue side earlier, reintroduced here in SQL. Skipping an unfilled rung is
   * what the rest of the module already does.
   *
   * HR is special-cased because it is a rung with no holder column by nature:
   * HR is a role, not a person named in the snapshot.
   */
  v_next := NULL;
  FOR i IN v_idx + 1 .. COALESCE(array_length(v_rungs, 1), 0) LOOP
    IF v_rungs[i] = 'HR' THEN
      v_next := 'HR';
      EXIT;
    END IF;
    IF pms_chain_holder(p_employee_id, p_period_id, v_rungs[i]) IS NOT NULL THEN
      v_next := v_rungs[i];
      EXIT;
    END IF;
  END LOOP;

  -- The LAST REVIEWER finalises. Everything after them is publication, and a
  -- result cannot be published before it exists. pms_finalise carries all of
  -- 188's guards — policy, role, frozen-chain identity, the final-review
  -- one-to-one — so they are not restated here.
  IF v_next = 'HR' THEN
    IF p_rating IS NULL THEN
      RETURN 'BLOCKED: a final rating is needed to finalise.';
    END IF;
    SELECT pms_finalise(p_employee_id, p_period_id, p_actor_id, p_actor_role,
                        p_rating, NULL) INTO v_res;
    IF v_res IS DISTINCT FROM 'FINALISED' THEN RETURN v_res; END IF;
  END IF;

  UPDATE pms_overall_rating
     SET chain_stage = COALESCE(v_next, 'DONE'), updated_at = now()
   WHERE employee_id = p_employee_id AND period_id = p_period_id;
  RETURN 'APPROVED:' || COALESCE(v_next, 'DONE');
END $$;

NOTIFY pgrst, 'reload schema';
