-- 195_pms_readonly_ignores_generated_columns.sql — 193's comparison was
-- reading a generated column that Postgres had not computed yet.
-- SAFE TO RUN TWICE. Replaces one function. No schema change, no data change.
-- ----------------------------------------------------------------------------
-- 193 narrowed trg_pms_readonly so a locked record could still be published:
-- it compares OLD and NEW as jsonb with the delivery columns removed, and
-- refuses if anything else differs. Default-deny, so a column added later is
-- frozen automatically.
--
-- It refused the publish it was written to allow.
--
--   publish -> REFUSED  Record is read-only (employee exited and rating
--                       finalised). Cannot change: self_vs_final_gap
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- self_vs_final_gap is GENERATED ALWAYS AS (self_score - final_score) STORED.
-- Postgres computes generated columns AFTER all BEFORE triggers have run, so
-- inside this trigger NEW.self_vs_final_gap is NULL while OLD still holds its
-- stored value. The comparison therefore sees a column changing from 0.30 to
-- NULL on every single update, and a default-deny check does exactly what it
-- was told: refuses.
--
-- Nothing was wrong with the row, the update, or the rule. The trigger was
-- comparing a value that does not exist yet.
--
-- ── WHY IT LOOKED FINE WHEN I TESTED IT ────────────────────────────────────
--
-- It only shows when the generated column has a value, which needs BOTH
-- self_score and final_score populated — i.e. a genuinely finalised
-- appraisal, which is the only kind that ever gets locked. My first fixture
-- set both and caught it. My follow-up fixture, isolating one column at a
-- time, happened to omit the scores, so self_vs_final_gap was NULL on both
-- sides, the comparison passed, and six cases in a row reported ALLOWED.
-- The narrower test was the less faithful one.
--
-- ── THE FIX, AND WHY NOT A NAME LIST ───────────────────────────────────────
--
-- Generated columns are discovered from the catalogue rather than listed by
-- name. Hardcoding 'self_vs_final_gap' would work today and quietly break the
-- next time somebody adds a generated column — which is the same trap 193's
-- own default-deny design was written to avoid, so it would be odd to walk
-- into it one line later.
--
-- This costs a catalogue lookup, but only on an update to an ALREADY LOCKED
-- row: the trigger still returns immediately for everything else, which is
-- every normal appraisal in the system.
--
-- Excluding them loses nothing. A generated column is a function of other
-- columns, and those columns are all still frozen, so it cannot change
-- without something frozen changing first and being refused on its own.

CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- Delivery and receipt only. See 193's header before adding to this.
  v_allowed text[] := ARRAY['workflow_status','published_at',
                            'employee_ack','employee_ack_at','updated_at'];
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

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
