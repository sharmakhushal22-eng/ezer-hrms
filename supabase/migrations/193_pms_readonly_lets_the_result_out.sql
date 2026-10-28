-- 193_pms_readonly_lets_the_result_out.sql — rule 12 freezes the RATING, not
-- the delivery of it.
-- SAFE TO RUN TWICE. Replaces one function. No schema change, no data change,
-- no column or constraint touched.
-- ----------------------------------------------------------------------------
-- ── THE CONFLICT ───────────────────────────────────────────────────────────
--
-- Rule 12: "Exited + finalised = read-only", enforced by trg_pms_readonly.
-- §8:      EXITED means "finalise ke baad permanently read-only · login
--          blocked · result copy emailed before block".
--
-- Those two sit badly together, and 188 resolved them in the strictest
-- direction: after finalise, NOTHING about the row may change. But publishing
-- a result is an UPDATE of that same row — workflow_status to PUBLISHED, then
-- the employee's own acknowledgement — so an exited employee could be
-- finalised and then never told. §8 is explicit that the result reaches them
-- before their login closes, so the strict reading does not merely inconvenience
-- the flow, it contradicts the spec it was implementing.
--
-- OBSERVED, not theorised. Committing a rating for STC0003, the one genuinely
-- EXITED employee in the database, returned:
--
--   {"ERR":"Record is read-only (employee exited and rating finalised)"}
--
-- because pms_finalise sets is_readonly inside the same transaction and the
-- very next statement then touched the row. 192 was reordered to dodge that,
-- but publication happens in a LATER transaction and cannot be reordered —
-- by then the row is locked, and the publish simply fails.
--
-- ── WHAT THE LOCK IS ACTUALLY FOR ──────────────────────────────────────────
--
-- Rule 12 exists so a rating cannot be altered after the person has gone and
-- can no longer argue with it. That purpose is served by freezing the NUMBERS
-- and the ATTRIBUTION. It is not served by refusing to mark the result as
-- delivered, which changes nothing anybody could dispute.
--
-- So the lock narrows to: on a read-only row, the only columns that may change
-- are the ones that record delivery and receipt.
--
--   workflow_status   — and only forward, into PUBLISHED or ACKNOWLEDGED
--   published_at
--   employee_ack, employee_ack_at
--   updated_at
--
-- Everything else stays frozen: every score, the final rating and its code,
-- who finalised it and when, the override reason, the rating source, the
-- employment flag, eligibility, and is_readonly itself. The lock still cannot
-- be cleared by clearing it — 188's fix, kept.
--
-- ── DEFAULT-DENY, SO A NEW COLUMN IS FROZEN BY DEFAULT ─────────────────────
--
-- The comparison lists what is ALLOWED and freezes everything else, rather
-- than listing what is frozen. Written the other way round, a column added to
-- pms_overall_rating next year would be silently writable on a locked record,
-- and nobody would notice until it mattered. OLD and NEW are compared as
-- jsonb with the allowed keys removed; if anything remains different, the
-- update is refused.
--
-- The message names the columns that actually changed, because "record is
-- read-only" on a screen that was only trying to publish sends somebody
-- looking in the wrong place for an hour.

CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- Delivery and receipt only. See the header before adding to this.
  v_allowed text[] := ARRAY['workflow_status','published_at',
                            'employee_ack','employee_ack_at','updated_at'];
  v_old jsonb;
  v_new jsonb;
  v_changed text;
BEGIN
  -- Not locked: nothing to police. Rule 12 only bites once the record is
  -- read-only, which pms_finalise sets for an EXITED employee.
  IF NOT OLD.is_readonly THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD) - v_allowed;
  v_new := to_jsonb(NEW) - v_allowed;

  IF v_old IS DISTINCT FROM v_new THEN
    SELECT string_agg(key, ', ' ORDER BY key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.value IS DISTINCT FROM (v_old -> n.key);
    -- One % per argument. RAISE's placeholder is %, not %s: written '%s' the
    -- argument fills the % and the 's' is left stranded in the sentence.
    RAISE EXCEPTION 'Record is read-only (employee exited and rating '
                 || 'finalised). Cannot change: %',
      COALESCE(v_changed, '(unknown column)');
  END IF;

  -- workflow_status may move, but only onward to delivery. Without this the
  -- allowance would also let a settled record be walked back to SELF_DRAFT,
  -- which is not delivery, it is reopening.
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('PUBLISHED','ACKNOWLEDGED') THEN
    RAISE EXCEPTION 'Record is read-only (employee exited and rating '
                 || 'finalised). The status can only move on to PUBLISHED or '
                 || 'ACKNOWLEDGED, not to %', NEW.workflow_status;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
