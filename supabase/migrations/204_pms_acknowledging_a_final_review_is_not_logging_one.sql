-- 204_pms_acknowledging_a_final_review_is_not_logging_one.sql
-- SAFE TO RUN TWICE. Replaces one trigger function. No schema change, no data
-- change, no column or constraint touched, no UPDATE, nothing dropped.
-- ----------------------------------------------------------------------------
-- 199 put a trigger on pms_one_to_one so a final review cannot be logged
-- before the chain ahead of it has finished. It is BEFORE INSERT OR UPDATE,
-- and the readiness check ran on both — so ACKNOWLEDGING an existing final
-- review was treated as logging a new one.
--
-- A row logged before 199 existed, or logged while the chain was further
-- along than it is now, therefore became impossible to acknowledge. The
-- screen reported a refusal for an action that was never the thing being
-- refused.
--
-- The fix is one condition: an UPDATE to a row that was ALREADY a final
-- review passes. Its existence was decided when it was inserted, and that
-- decision was gated at the time.
--
-- Still gated: an UPDATE that turns some other discussion type INTO a final
-- review. That is a creation wearing an update's clothes, and letting it
-- through would make the rule bypassable by inserting an ADHOC row and
-- editing it.
--
-- Everything else is 199's function VERBATIM, patched at one asserted anchor
-- and diffed.

CREATE OR REPLACE FUNCTION pms_block_early_final_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_rung text; v_why text; o pms_overall_rating%ROWTYPE;
BEGIN
  IF NEW.discussion_type <> 'FINAL_REVIEW' THEN RETURN NEW; END IF;

  -- 204: GATE THE CREATION, NOT EVERY LATER TOUCH.
  --
  -- This trigger is BEFORE INSERT OR UPDATE, and 199 applied the readiness
  -- check to both. So acknowledging a final review that ALREADY EXISTS
  -- re-ran the check, and a row logged before 199 — or logged while the
  -- chain was further along and since reset — became permanently
  -- un-acknowledgeable.
  --
  -- OBSERVED: Amit Gupta (STCCON9008) has a FINAL_REVIEW logged against an
  -- appraisal that is NOT_STARTED. Ticking the manager's acknowledgement
  -- returned
  --
  --   P0001  The final review cannot be logged yet: their self rating is
  --          not in yet.
  --
  -- The screen had done nothing wrong; it was setting manager_ack on a row
  -- whose existence was decided long before.
  --
  -- 201's header makes exactly this argument about publication — "an already
  -- published row is not re-gated ... blocking the follow-up writes would
  -- strand it" — and this is the same shape of mistake one migration
  -- earlier.
  --
  -- An UPDATE that turns some OTHER discussion INTO a final review is still
  -- gated: that is a creation wearing an update's clothes, and skipping it
  -- would leave the rule trivially bypassable.
  IF TG_OP = 'UPDATE' AND OLD.discussion_type = 'FINAL_REVIEW' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO o FROM pms_overall_rating
   WHERE employee_id = NEW.employee_id AND period_id = NEW.period_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Which rung the logger occupies. The employee logging their own review is
  -- not a chain rung and is not blocked here.
  v_rung := CASE
              WHEN NEW.manager_id IS NULL             THEN NULL
              WHEN NEW.manager_id = o.rm_l1_id        THEN 'RM_L1'
              WHEN NEW.manager_id = o.rm_l2_id        THEN 'RM_L2'
              WHEN NEW.manager_id = o.hod_id          THEN 'HOD'
              ELSE NULL
            END;
  IF v_rung IS NULL THEN RETURN NEW; END IF;

  v_why := pms_chain_ready_before(NEW.employee_id, NEW.period_id, v_rung);
  IF v_why IS NOT NULL THEN
    -- RAISE's format must be a STRING LITERAL — a message built with || is a
    -- syntax error there, not a runtime one. Hence v_why and a single '%'.
    v_why := 'The final review cannot be logged yet: ' || v_why || '.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;


NOTIFY pgrst, 'reload schema';
