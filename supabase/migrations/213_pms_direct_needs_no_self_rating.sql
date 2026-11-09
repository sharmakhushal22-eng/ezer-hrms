-- 213_pms_direct_needs_no_self_rating.sql
-- The second rule a direct appraisal cannot satisfy, waived the same way.
-- SAFE TO RUN TWICE. Replaces one function. No schema change, no data change.
-- ----------------------------------------------------------------------------
-- ── WHY THIS EXISTS, AND HOW IT WAS FOUND ──────────────────────────────────
--
-- 212 let the HR Head build an appraisal for somebody the chain never picked
-- up, and waived the final-review sign-off because there is no manager to
-- have had that conversation.
--
-- There is a SECOND rule with the same shape, and it was missed. 066's
-- pms_check_self_first refuses any submitted non-SELF rating until the
-- employee has submitted their own self rating. An employee the chain never
-- started has no self rating and never will, so the HR Head could create the
-- KRAs and then be refused on every single per-KRA rating:
--
--   "Self rating must be submitted before manager rating"
--
-- MEASURED, not reasoned about: the four-step write was run against the live
-- database and failed at step 3 with exactly that message, after the stamp
-- and the four KRAs had already been written. The engine tests could not
-- have caught it — they know the rules this codebase states, not the ones
-- the database has held since 066. The half-built record was reverted.
--
-- ── THE SAME NARROW WAIVER ─────────────────────────────────────────────────
--
-- One early return, for rows the 212 guard allowed to be stamped. Everything
-- else is 066's function byte for byte.
--
-- The alternative was writing a SELF rating on the employee's behalf so the
-- check would pass. That is worse in the same way the fake one-to-one was
-- worse: it puts words in the employee's mouth, it satisfies the rule
-- instead of facing it, and a year later nobody could tell which self
-- ratings were real. A rating the employee never gave must not exist.
--
-- ── WHAT IS STILL ENFORCED ─────────────────────────────────────────────────
--
-- Everything else about a direct appraisal. The 212 guard still refuses the
-- stamp on a row the chain has touched, so this waiver cannot reach an
-- appraisal where a self rating was genuinely expected. 211 still requires
-- the HR Head's settlement and attestation before publishing. The KRA rules
-- and the rating scale are unchanged.

CREATE OR REPLACE FUNCTION pms_check_self_first() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_self int; v_req boolean; v_direct boolean;
BEGIN
  IF NEW.rater_role = 'SELF' OR NEW.submitted = false THEN RETURN NEW; END IF;

  -- 213: an appraisal the HR Head built outside the chain has no self
  -- rating step, because the chain never reached the employee. Waived only
  -- for rows 212's guard allowed to be stamped.
  SELECT o.hr_direct INTO v_direct FROM pms_overall_rating o
   WHERE o.period_id = NEW.period_id AND o.employee_id = NEW.employee_id;
  IF COALESCE(v_direct, false) THEN RETURN NEW; END IF;

  SELECT p.self_rating_mandatory INTO v_req FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id=p.id WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req,true) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_self FROM pms_reviews
   WHERE period_id=NEW.period_id AND employee_id=NEW.employee_id
     AND rater_role='SELF' AND submitted=true;
  IF v_self = 0 THEN
    RAISE EXCEPTION 'Self rating must be submitted before manager rating';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION pms_check_self_first() IS
  'A manager cannot rate before the employee has rated themselves, when the '
  'policy requires a self rating. 213 waives it for an appraisal the HR Head '
  'built outside the chain, which has no self-rating step at all.';

NOTIFY pgrst, 'reload schema';
