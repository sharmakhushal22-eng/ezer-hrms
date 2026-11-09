-- 197_pms_chain_approve_and_reject.sql — the approval chain, with rejection
-- that goes back one rung and cannot happen without a reason.
-- SAFE TO RUN TWICE. Adds five columns and five functions, and replaces
-- pms_block_readonly (195's body plus one allowed column — see the last
-- section). No existing column or constraint is altered, no data is changed.
-- ----------------------------------------------------------------------------
-- ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
--
-- Requested directly, and NOT in EZER_PMS_Module_Spec_v2: the docx describes
-- the chain as a forward march (§1 Stage 5 "RM L1 scores… transitions
-- directly to RM L2", §5 "Finalisation Queue"), with the only backward motion
-- being the KRA send-back at Stage 3. The requirement added here is:
--
--   anyone in the chain — L1, L2 or HOD — may reject; a rejection REQUIRES a
--   remark; and the appraisal returns to the PRECEDING person in the chain,
--   not to the employee.
--
-- Recorded as a divergence so a later reader does not go looking for it in
-- the spec and conclude the implementation invented it.
--
-- Settled alongside it, also by decision rather than by the spec: the HOD
-- finalises and there is no MD approval step, so §6.1's "RM2 → HOD → MD"
-- chain is out of scope. HR publishes and changes nothing.
--
-- ── WHY A STAGE COLUMN IS NEEDED AT ALL ────────────────────────────────────
--
-- pms_employee_goals.status has PENDING_RM_APPROVAL, which says a set is
-- waiting for a manager but not WHICH manager. So "send it back to the
-- preceding person" could not be computed from anything in the database:
-- nothing recorded where in the chain the appraisal had got to. Hence
-- chain_stage, and the four sent_back_* columns beside it.
--
-- The stage is kept on pms_overall_rating, which is already one row per
-- employee per period and already holds workflow_status and the frozen chain
-- ids the guards below check against. Putting it on the goals table instead
-- would mean ten rows arguing about one fact.
--
-- ── HOW IT RELATES TO workflow_status ──────────────────────────────────────
--
-- workflow_status (190) records HOW FAR the appraisal has got: which ratings
-- exist. chain_stage records WHOSE MOVE IT IS. They are different questions
-- and a rejection makes that obvious: a set rejected by RM L2 still has an
-- RM L1 rating, so its workflow_status is unchanged and only its stage moves.
-- Conflating them would mean a rejection deleting a rating to express itself.

ALTER TABLE pms_overall_rating
  -- NULL until the employee submits. Not 'EMPLOYEE', because "never submitted"
  -- and "sent back to the employee" need telling apart: the second is a
  -- rejection somebody has to answer, the first is just a cycle not started.
  ADD COLUMN IF NOT EXISTS chain_stage text
    CHECK (chain_stage IN ('EMPLOYEE','RM_L1','RM_L2','HOD','HR','DONE')),
  ADD COLUMN IF NOT EXISTS sent_back_to text,
  ADD COLUMN IF NOT EXISTS sent_back_by uuid,
  ADD COLUMN IF NOT EXISTS sent_back_reason text,
  ADD COLUMN IF NOT EXISTS sent_back_at timestamptz;

COMMENT ON COLUMN pms_overall_rating.chain_stage IS
  'Whose move it is. NULL = not submitted. Distinct from workflow_status, '
  'which records how far the ratings have got.';

-- ── the chain, as an ordered list ──────────────────────────────────────────
/**
 * The rungs an appraisal passes through, in order, for one approval chain.
 *
 * Derived from the policy rather than hardcoded, because §6.1 runs four
 * chain shapes side by side. HR is the last rung in every one: the HOD (or
 * the last reviewer where there is no HOD) finalises, and HR publishes
 * without changing anything.
 *
 * SELF_RM1_RM2_HOD_MD is absent on purpose — see the decision above.
 */
CREATE OR REPLACE FUNCTION pms_chain_rungs(p_chain text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_chain
    WHEN 'SELF_RM1'          THEN ARRAY['RM_L1','HR']
    WHEN 'SELF_RM1_HOD'      THEN ARRAY['RM_L1','HOD','HR']
    WHEN 'SELF_RM1_RM2_HOD'  THEN ARRAY['RM_L1','RM_L2','HOD','HR']
    ELSE ARRAY[]::text[]
  END;
$$;

/**
 * Who, by employee id, occupies a given rung for this employee and period.
 *
 * Reads the FROZEN chain on pms_overall_rating, never a live lookup — the
 * same reason 188 gives: somebody who changed department in week six would
 * otherwise acquire a different approver mid-cycle, which is the exact
 * failure the snapshot exists to prevent.
 */
CREATE OR REPLACE FUNCTION pms_chain_holder(
  p_employee_id uuid, p_period_id uuid, p_rung text)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
  SELECT CASE p_rung
           WHEN 'RM_L1' THEN o.rm_l1_id
           WHEN 'RM_L2' THEN o.rm_l2_id
           WHEN 'HOD'   THEN o.hod_id
           ELSE NULL
         END
    INTO v
    FROM pms_overall_rating o
   WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;
  RETURN v;
END $$;

-- ── submit: the employee hands it to the first reviewer ────────────────────
CREATE OR REPLACE FUNCTION pms_chain_submit(p_employee_id uuid, p_period_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_chain text; v_rungs text[]; v_first text; v_self numeric; v_ro boolean;
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

-- ── approve: move it on, and finalise at the last reviewer ─────────────────
CREATE OR REPLACE FUNCTION pms_chain_approve(
  p_employee_id uuid, p_period_id uuid, p_actor_id uuid, p_actor_role text,
  p_rating numeric DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_chain text; v_rungs text[]; v_stage text; v_idx int; v_next text;
        v_holder uuid; v_ro boolean; v_res text; v_lock text;
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

-- ── reject: one rung back, and never without a reason ──────────────────────
CREATE OR REPLACE FUNCTION pms_chain_reject(
  p_employee_id uuid, p_period_id uuid, p_actor_id uuid, p_actor_role text,
  p_remark text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_chain text; v_rungs text[]; v_stage text; v_idx int; v_back text;
        v_holder uuid; v_ro boolean;
BEGIN
  -- THE REMARK IS THE POINT. A rejection with no reason sends somebody back
  -- to guess what to change, and the set returns wrong a second time — the
  -- same argument 066 makes for sent_back_reason on the KRA send-back. Ten
  -- characters is not a quality bar, it is a bar against "no" and ".".
  IF p_remark IS NULL OR length(btrim(p_remark)) < 10 THEN
    RETURN 'BLOCKED: a rejection needs a remark saying what has to change — '
        || 'at least a sentence.';
  END IF;

  SELECT p.approval_chain, o.chain_stage, o.is_readonly
    INTO v_chain, v_stage, v_ro
    FROM pms_overall_rating o
    JOIN pms_periods pe ON pe.id = o.period_id
    JOIN pms_policies p ON p.id = pe.policy_id
   WHERE o.employee_id = p_employee_id AND o.period_id = p_period_id;
  IF NOT FOUND THEN RETURN 'BLOCKED: not enrolled in this period.'; END IF;
  IF v_ro THEN RETURN 'BLOCKED: this record is read-only.'; END IF;
  IF v_stage IS NULL OR v_stage IN ('EMPLOYEE','DONE') THEN
    RETURN 'BLOCKED: there is nothing here to reject.';
  END IF;

  v_rungs := pms_chain_rungs(v_chain);
  v_idx := array_position(v_rungs, v_stage);
  IF v_idx IS NULL THEN
    RETURN 'BLOCKED: stage ' || v_stage || ' is not part of this policy''s chain.';
  END IF;

  IF v_stage = 'HR' THEN
    -- HR reviews and publishes; it does not judge the rating. Letting HR
    -- reject would make them an approver, which the decision explicitly
    -- rules out.
    RETURN 'BLOCKED: HR publishes the result and does not reject it. A rating '
        || 'that needs changing goes back through the HOD.';
  END IF;

  IF p_actor_role IS DISTINCT FROM v_stage THEN
    RETURN 'BLOCKED: this is with ' || v_stage || ', not ' || COALESCE(p_actor_role, 'nobody') || '.';
  END IF;
  v_holder := pms_chain_holder(p_employee_id, p_period_id, v_stage);
  IF v_holder IS NULL OR v_holder <> p_actor_id THEN
    RETURN 'BLOCKED: you are not the ' || v_stage || ' recorded for this '
        || 'employee in this period.';
  END IF;

  /**
   * ONE RUNG BACK — to the nearest rung somebody OCCUPIES.
   *
   * Same reason as the forward walk above, in the other direction: on a
   * collapsed line a HOD's rejection must reach RM L1, because the RM_L2 the
   * policy lists does not exist for this employee. Sending it to an empty
   * rung would strand it where nobody can act, and a rejection that strands
   * the appraisal is worse than no rejection at all — the employee is waiting
   * on a correction that can never be made.
   *
   * Falls through to the employee when no held rung remains below, which is
   * also the right answer for the first rung.
   */
  v_back := 'EMPLOYEE';
  FOR i IN REVERSE v_idx - 1 .. 1 LOOP
    IF pms_chain_holder(p_employee_id, p_period_id, v_rungs[i]) IS NOT NULL THEN
      v_back := v_rungs[i];
      EXIT;
    END IF;
  END LOOP;

  IF v_back = 'EMPLOYEE' THEN
    UPDATE pms_employee_goals
       SET status = 'SENT_BACK', sent_back_reason = p_remark, updated_at = now()
     WHERE employee_id = p_employee_id AND period_id = p_period_id
       AND status <> 'TERMINATED';
  END IF;

  UPDATE pms_overall_rating
     SET chain_stage = v_back,
         sent_back_to = v_back, sent_back_by = p_actor_id,
         sent_back_reason = p_remark, sent_back_at = now(),
         updated_at = now()
   WHERE employee_id = p_employee_id AND period_id = p_period_id;
  RETURN 'REJECTED:' || v_back;
END $$;


-- ── the read-only lock has to let the stage move ───────────────────────────
-- 193's header predicted this exactly: its comparison is DEFAULT-DENY, so
-- "a column added to pms_overall_rating next year" is frozen on a locked
-- record automatically. chain_stage is that column, four migrations later.
--
-- NOT THEORETICAL. pms_finalise sets is_readonly for an EXITED employee, and
-- pms_chain_approve's very next statement writes chain_stage — so for the one
-- genuinely exited employee in the database (STC0003), the HOD's approval
-- would have raised
--
--   Record is read-only (employee exited and rating finalised).
--   Cannot change: chain_stage
--
-- and aborted with a raw exception instead of a BLOCKED sentence. The same
-- shape of failure 193 and 195 each had to fix, found this time by reading the
-- trigger before running the flow rather than after.
--
-- chain_stage belongs with the delivery columns on 193's own reasoning: rule
-- 12 freezes the NUMBERS and the ATTRIBUTION so a rating cannot be altered
-- after the person has gone and can no longer argue with it. Where the
-- paperwork has got to is not a number anybody can dispute.
--
-- It is constrained the way workflow_status is, and for the same reason: on a
-- locked record the stage may only move ONWARD, to HR or DONE. Without that
-- the allowance would also permit walking a settled appraisal back to RM_L1,
-- which is not delivery, it is reopening. The sent_back_* columns are
-- deliberately NOT allowed: a finalised record cannot be rejected, so the only
-- thing that would write them is a rejection that should not be happening.
--
-- Everything else is 195's body unchanged, generated-column discovery and all.
CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- Delivery and receipt only. See 193's header before adding to this.
  v_allowed text[] := ARRAY['workflow_status','published_at',
                            'employee_ack','employee_ack_at','updated_at',
                            'chain_stage'];
  -- Columns Postgres computes for itself, which a BEFORE trigger cannot see.
  v_generated text[];
  v_old jsonb;
  v_new jsonb;
  v_changed text;
  -- RAISE's format must be a literal, so the sentence is built here.
  v_why text;
BEGIN
  -- Not locked: nothing to police. Rule 12 only bites once the record is
  -- read-only, which pms_finalise sets for an EXITED employee.
  IF NOT OLD.is_readonly THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(c.column_name::text), ARRAY[]::text[])
    INTO v_generated
    FROM information_schema.columns c
   WHERE c.table_schema = TG_TABLE_SCHEMA
     AND c.table_name  = TG_TABLE_NAME
     AND c.is_generated = 'ALWAYS';

  v_old := to_jsonb(OLD) - v_allowed - v_generated;
  v_new := to_jsonb(NEW) - v_allowed - v_generated;

  IF v_old IS DISTINCT FROM v_new THEN
    SELECT string_agg(key, ', ' ORDER BY key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.value IS DISTINCT FROM (v_old -> n.key);
    v_why := 'Record is read-only (employee exited and rating finalised). '
          || 'Cannot change: ' || COALESCE(v_changed, '(unknown column)');
    RAISE EXCEPTION '%', v_why;
  END IF;

  -- workflow_status may move, but only onward to delivery. Without this the
  -- allowance would also let a settled record be walked back to SELF_DRAFT,
  -- which is not delivery, it is reopening.
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('PUBLISHED','ACKNOWLEDGED') THEN
    v_why := 'Record is read-only (employee exited and rating finalised). '
          || 'The status can only move on to PUBLISHED or ACKNOWLEDGED, not to '
          || NEW.workflow_status;
    RAISE EXCEPTION '%', v_why;
  END IF;

  -- 197: the stage may move, but only onward. Same argument as above.
  IF NEW.chain_stage IS DISTINCT FROM OLD.chain_stage
     AND NEW.chain_stage NOT IN ('HR','DONE') THEN
    v_why := 'Record is read-only (employee exited and rating finalised). '
          || 'The chain stage can only move on to HR or DONE, not back to '
          || COALESCE(NEW.chain_stage, 'nothing');
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
