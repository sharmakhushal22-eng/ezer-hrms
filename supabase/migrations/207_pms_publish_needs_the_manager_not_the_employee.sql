-- 207_pms_publish_needs_the_manager_not_the_employee.sql
-- Publishing no longer waits on the employee's acknowledgement.
-- SAFE TO RUN TWICE. Replaces one function. No data change, no column added,
-- nothing dropped, no UPDATE at load time.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Reported while walking the full cycle: Isha Nair SRS9057 was finalised at 4
-- and sat at chain_stage HR, unpublishable, because her FINAL_REVIEW log
-- carried the HOD's acknowledgement and not hers. Answered: "no need to ack
-- of employee at this stage."
--
-- So the employee's half of the final-review sign-off now gates NOTHING. It
-- is still recorded when they give it — the row, both columns and both
-- timestamps are unchanged — but the result reaches them without it.
--
-- ── WHAT THIS REVERSES, AND WHAT IT KEEPS ──────────────────────────────────
--
-- 188 required both acknowledgements to FINALISE. 200 moved that gate to
-- PUBLICATION, because docx Stage 6 and §230 halt publication until the log
-- is "mutually signed off", while §389 only asks that the log exist before
-- the rating is settled. That move was right and stands.
--
-- This goes one step further than the spec: publication now needs the log to
-- exist WITH THE MANAGER'S ACKNOWLEDGEMENT, and no longer the employee's.
-- Recorded plainly because it is a deliberate divergence from §230, not an
-- oversight — the same way 197's header records the chain's send-back.
--
-- WHAT IS KEPT is the half that is actually load-bearing: somebody in
-- authority asserting the conversation happened. A manager ticking their own
-- box is a weaker record than two people ticking theirs, and the honest
-- reading of this change is that the mutual record is now optional. The
-- protection that remains is that a rating still cannot reach an employee
-- before a final-review conversation is on record at all.
--
-- STILL UNTOUCHED, and worth saying because they look adjacent:
--
--   · pms_overall_rating.employee_ack — the employee acknowledging the
--     PUBLISHED RESULT, which happens after this and moves the record to
--     ACKNOWLEDGED. A different acknowledgement of a different thing.
--   · 201's guard, which stops an ACKNOWLEDGED result being walked back to
--     PUBLISHED.
--   · The KRA_SETTING one-to-one, which still needs both sides before
--     weightage can lock. That gate is about agreeing what is measured, and
--     nothing here touches it.
--
-- ── HOW IT WAS BUILT ───────────────────────────────────────────────────────
--
-- 200's function extracted verbatim and patched at two asserted anchors, then
-- diffed: 7 lines moved, the ack condition and the sentence that explains the
-- refusal. Everything else below is 200's body unchanged, including the
-- policy check that skips the gate entirely when final_review_one_to_one is
-- off for that policy.

CREATE OR REPLACE FUNCTION pms_block_unsigned_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_req boolean; v_n int; v_why text;
BEGIN
  -- Not a publish: nothing to police.
  IF NEW.workflow_status IS NOT DISTINCT FROM OLD.workflow_status
     OR NEW.workflow_status <> 'PUBLISHED'
     OR OLD.workflow_status IN ('PUBLISHED','ACKNOWLEDGED') THEN
    RETURN NEW;
  END IF;

  SELECT p.final_review_one_to_one INTO v_req
    FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id
   WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req, false) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_n FROM pms_one_to_one
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id
     AND discussion_type = 'FINAL_REVIEW' AND manager_ack;

  IF v_n = 0 THEN
    -- RAISE's format must be a string literal, so the sentence is built here.
    v_why := 'This result cannot be published yet: the final review one-to-one '
          || 'is not on record with the manager''s acknowledgement. The '
          || 'conversation has to have happened before the rating reaches '
          || 'them.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_publish_needs_signoff ON pms_overall_rating;
CREATE TRIGGER trg_pms_publish_needs_signoff
BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_block_unsigned_publish();

COMMENT ON FUNCTION pms_block_unsigned_publish() IS
  'Publication needs the final-review one-to-one on record with the '
  'manager''s acknowledgement. 207 removed the employee''s, which now '
  'records the conversation without gating the result.';

NOTIFY pgrst, 'reload schema';
