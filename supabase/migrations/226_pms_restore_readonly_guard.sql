-- 226_pms_restore_readonly_guard.sql
-- Puts pms_block_readonly back to what 197 had. 225 should never have shipped.
-- SAFE TO RUN TWICE. One function, restored byte-for-byte from 197.
-- ----------------------------------------------------------------------------
-- -- WHAT WENT WRONG -------------------------------------------------------
--
-- 225 rebuilt this function from 193 and called it "193 missed a column".
-- 193 was not the version in the database. The chain is:
--
--     193  narrowed the lock so a finalised result could be delivered
--     195  stopped it comparing GENERATED columns Postgres has not computed
--     197  added chain_stage to the allowlist, onward to HR or DONE
--     225  rebuilt from 193 -- dropping 195 and 197
--
-- So 225 reintroduced the exact bug 195 exists to fix. Reported from the
-- SQL editor the moment it was applied:
--
--     Record is read-only (employee exited and rating finalised).
--     Cannot change: is_readonly, self_vs_final_gap
--
-- self_vs_final_gap is GENERATED ALWAYS. Postgres computes generated columns
-- AFTER every BEFORE trigger, so inside this trigger NEW holds NULL while OLD
-- holds the stored value -- the comparison sees it change on every update and
-- a default-deny check refuses. 195 excludes generated columns by reading the
-- catalogue; 225 deleted that and the refusal came back.
--
-- The "missing column" 225 was written to add was ALREADY THERE. 197 put
-- chain_stage in the allowlist and allowed it onward to HR or DONE -- wider
-- than 225's DONE-only, and right, because the chain hands a settled record
-- to HR before publication moves it to DONE. 225 narrowed that too.
--
-- -- WHY IT WAS NOT CAUGHT --------------------------------------------------
--
-- The covering test asserted "225 reproduces 193 exactly, apart from
-- chain_stage" -- and it did. The test compared against the base I had
-- chosen, so it certified the mistake rather than catching it. A diff is only
-- evidence when it is taken against what is actually deployed.
--
-- The test that replaces it computes the previous definer from the directory
-- instead of naming one, so a migration generated from the wrong base fails
-- whatever base its author believed in.
--
-- -- THIS FILE ---------------------------------------------------------------
--
-- The function below is 197's, copied from 197. Nothing is added, including
-- the thing 225 meant to add, because 197 already has it.

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
