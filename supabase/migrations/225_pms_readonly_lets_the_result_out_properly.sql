-- 225_pms_readonly_lets_the_result_out_properly.sql
-- 193 opened the lock for delivery and missed one column. This is that column.
-- SAFE TO RUN TWICE. One function.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────
--
-- 193's own header says:
--
--     "read-only" on a screen that was only trying to publish sends somebody
--     looking in the wrong place for an hour.
--
-- It fixed that for four columns and missed a fifth. Both publish paths —
-- publishMany and publishOne — write THREE columns:
--
--     workflow_status  'PUBLISHED'   allowed by 193
--     published_at     now           allowed by 193
--     chain_stage      'DONE'        NOT allowed
--
-- So for any employee whose record is read-only, the publish is refused with
--
--     Record is read-only (employee exited and rating finalised).
--     Cannot change: chain_stage
--
-- naming a column the administrator never typed, on a screen that was only
-- trying to release a result. The exact sentence 193 was written to stop.
--
-- ── WHO THIS HITS ────────────────────────────────────────────────────
--
-- pms_finalise sets is_readonly = (flag = 'EXITED') when it settles a rating
-- (200). Nothing excludes those rows from the publish queue, so a leaver
-- whose appraisal the chain finished appears under "Ready to publish", is
-- counted on the confirm button, and is then refused.
--
-- Their rating can never be released. The one population whose result is most
-- likely to be wanted on paper later — somebody who has left — is the one
-- population that cannot be given it.
--
-- ── ONWARD ONLY ──────────────────────────────────────────────────────
--
-- chain_stage is allowed to move to 'DONE' and nowhere else, mirroring what
-- 193 already does for workflow_status. Allowing the column outright would
-- let a frozen record be walked back to RM_L1 — not delivery, but reopening
-- an appraisal for somebody who has left the company.
--
-- Everything else is reproduced from 193 byte-for-byte.

CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- Delivery and receipt only. See the header before adding to this.
  -- 225 adds chain_stage. See the header: publishing writes it, so without
  -- it here an exited employee's settled rating could never be released.
  v_allowed text[] := ARRAY['workflow_status','published_at',
                            'employee_ack','employee_ack_at','updated_at',
                            'chain_stage'];
  v_old jsonb;
  v_new jsonb;
  v_changed text;
  -- RAISE's format must be a STRING LITERAL. It cannot be an expression, so a
  -- message assembled with || is a syntax error there, not a runtime one —
  -- which is why this is built here and passed through a single '%'.
  v_why text;
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

  -- ── 225 adds this ────────────────────────────────────────────────────────
  -- chain_stage is allowed ONWARD TO 'DONE' and nowhere else, exactly as
  -- workflow_status is allowed onward to PUBLISHED or ACKNOWLEDGED above.
  -- Allowing the column outright would also let a frozen record be walked
  -- back to RM_L1, which is not delivery — it is reopening an appraisal for
  -- somebody who has left.
  IF NEW.chain_stage IS DISTINCT FROM OLD.chain_stage
     AND COALESCE(NEW.chain_stage, '') <> 'DONE' THEN
    v_why := 'Record is read-only (employee exited and rating finalised). '
          || 'The chain stage can only move on to DONE, not to '
          || COALESCE(NEW.chain_stage, '(null)');
    RAISE EXCEPTION '%', v_why;
  END IF;
  -- ── end 225 ──────────────────────────────────────────────────────────────

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
