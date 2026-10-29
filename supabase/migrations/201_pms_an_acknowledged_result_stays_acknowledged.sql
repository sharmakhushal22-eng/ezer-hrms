-- 201_pms_an_acknowledged_result_stays_acknowledged.sql — a second publish
-- stops discarding the employee's acknowledgement.
-- ----------------------------------------------------------------------------
-- WHAT THIS CONTAINS, because the SQL editor's warning on 200 was worth
-- taking seriously:
--
--   * one CREATE OR REPLACE FUNCTION (new function, nothing dropped)
--   * one DROP TRIGGER IF EXISTS + CREATE TRIGGER, the idempotent idiom
--   * ONE UPDATE, WITH A WHERE CLAUSE, repairing rows already damaged
--
-- That last statement is a DATA CHANGE, unlike every other migration in this
-- series. It is described in full under "REPAIRING WHAT ALREADY HAPPENED"
-- below. Nothing is deleted and no column, table or constraint is altered.
-- SAFE TO RUN TWICE: the trigger is replaced, and the repair's WHERE makes it
-- a no-op the second time.
-- ----------------------------------------------------------------------------
-- ── WHAT WENT WRONG ────────────────────────────────────────────────────────
--
-- OBSERVED, on Anil Verma (STC9030). He was ACKNOWLEDGED — the last state in
-- the ladder, meaning he had read his result and confirmed it. Somebody
-- published him a second time from the app, and his row came back:
--
--   workflow_status   ACKNOWLEDGED -> PUBLISHED      (walked BACKWARDS)
--   published_at      15:50:21     -> 16:17:13       (first delivery LOST)
--   employee_ack      true, untouched
--   employee_ack_at   unchanged
--
-- So the FACT of his acknowledgement survived in employee_ack, but the status
-- said he had never given it, and the record of when his result actually
-- reached him was overwritten with a later timestamp.
--
-- Both publish paths — the HOD's own Feedback & Recognition and HR's Publish
-- Results — set workflow_status = 'PUBLISHED' and published_at = now()
-- unconditionally. Neither asks whether the result was already out.
--
-- ── WHY THE EXISTING GUARDS DID NOT CATCH IT ───────────────────────────────
--
-- 193's trg_pms_readonly refuses a backward status move, but only on a
-- READ-ONLY row — an exited, finalised employee — and even there it permits
-- PUBLISHED and ACKNOWLEDGED as the two delivery states. Anil is active, so
-- it never ran.
--
-- 190's pms_workflow_derived does preserve the terminal statuses, but it only
-- governs the recompute path. A direct UPDATE from a screen bypasses it.
--
-- ── WHY THIS IS NARROW ON PURPOSE ──────────────────────────────────────────
--
-- The obvious fix — refuse every backward move of workflow_status — would
-- break two things that are meant to move backwards:
--
--   * 190's retraction. "A retracted rating has to move the score back down,
--     not leave the old one standing", so RM_L2_DONE -> SELF_SUBMITTED is a
--     correct transition when a review is deleted.
--   * an HR correction. pms_finalise writes 'FINALISED', so HR re-finalising
--     a published rating is ACKNOWLEDGED -> FINALISED by design, and 192's
--     bulk calibration does the same for a whole upload.
--
-- So this blocks exactly one transition: ACKNOWLEDGED -> PUBLISHED. That is
-- never meaningful. Publishing is "let them see it"; they have seen it.
--
-- ── IT KEEPS, RATHER THAN REFUSES ──────────────────────────────────────────
--
-- The trigger silently holds the row at ACKNOWLEDGED instead of raising.
-- Publishing a result that is already out is not an error the user needs to
-- see — it is a no-op, and an exception would put a red banner on a button
-- press that did nothing wrong. The other columns of the same UPDATE still
-- apply, so a re-publish that also carries new feedback visibility still
-- works.
--
-- published_at is held to its FIRST value for the same reason: the question
-- that column answers is "when did this reach the employee", and that is the
-- first delivery, not the most recent button press.

CREATE OR REPLACE FUNCTION pms_keep_acknowledged() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only a publish landing on an already-acknowledged row. Everything else —
  -- a first publish, an HR re-finalise, 190's retraction — passes untouched.
  IF OLD.workflow_status = 'ACKNOWLEDGED' AND NEW.workflow_status = 'PUBLISHED' THEN
    NEW.workflow_status := 'ACKNOWLEDGED';
  END IF;

  -- The first delivery is the fact. A later publish must not overwrite when
  -- the result actually reached them.
  IF OLD.published_at IS NOT NULL THEN
    NEW.published_at := OLD.published_at;
  END IF;

  -- An acknowledgement is not retractable by a write that was not about it.
  -- Nothing in the product clears these, but both publish paths rewrite the
  -- row wholesale through PostgREST, and a future one could carry a stale
  -- false picked up from a client that had not reloaded.
  IF OLD.employee_ack THEN
    NEW.employee_ack := true;
    NEW.employee_ack_at := COALESCE(NEW.employee_ack_at, OLD.employee_ack_at);
  END IF;

  RETURN NEW;
END $$;

-- Named to sort AFTER trg_pms_publish_needs_signoff and trg_pms_readonly, so
-- it has the final say on the row: BEFORE triggers fire in alphabetical order,
-- and this one's job is to correct what the others have let through.
DROP TRIGGER IF EXISTS trg_pms_settled_stays_settled ON pms_overall_rating;
CREATE TRIGGER trg_pms_settled_stays_settled
BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_keep_acknowledged();

-- ── REPAIRING WHAT ALREADY HAPPENED ────────────────────────────────────────
--
-- The trigger stops this recurring; it cannot undo the rows that are already
-- wrong. One row is known to be — Anil Verma — and the condition below finds
-- any other with the same fingerprint.
--
-- IT RESTORES A TRUE FACT, it does not invent one. employee_ack = true is the
-- employee's own acknowledgement, written by their own screen with its own
-- timestamp; a status of PUBLISHED beside it is the contradiction, and
-- ACKNOWLEDGED is what the two columns together already say.
--
-- Scoped tightly: only rows whose status is exactly PUBLISHED and whose
-- employee_ack is true. A row that is published and genuinely unacknowledged
-- has employee_ack false and is left alone. Running it twice changes nothing,
-- because the first run empties the WHERE.
--
-- published_at is NOT repaired. The original value was overwritten and is not
-- recoverable from this table — inventing one would be worse than a timestamp
-- that is known to be late.
UPDATE pms_overall_rating
   SET workflow_status = 'ACKNOWLEDGED'
 WHERE workflow_status = 'PUBLISHED'
   AND employee_ack = true;

NOTIFY pgrst, 'reload schema';
