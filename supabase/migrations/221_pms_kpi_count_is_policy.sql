-- 221_pms_kpi_count_is_policy.sql
-- How many KPIs a KRA may hold becomes policy configuration, not a constant.
-- SAFE TO RUN TWICE. Two columns, one CHECK, one trigger, one function.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: a KRA can have several KPIs, added and removed with a button;
-- the minimum is 1 and the maximum is 5 BY DEFAULT, and both are changed from
-- Setup and Configuration on the admin side.
--
-- 220 gave a KRA many KPIs. The floor of one lived in lib/pms/kpi.ts as
-- `MIN_KPI_PER_KRA = 1` and there was no ceiling at all — nothing stopped an
-- eleventh KPI. Neither number was anywhere an admin could reach.
--
-- This is the same shape as min_kra_count/max_kra_count, which have been
-- policy columns since 066. KPI count joins them rather than inventing a
-- second home for the same kind of rule.
--
-- ── MIN AND MAX ARE ENFORCED IN DIFFERENT PLACES, ON PURPOSE ───────────────
--
-- A MAXIMUM is a fact about a write: the sixth INSERT is the one to refuse,
-- and refusing it is both cheap and exact. That is the trigger below.
--
-- A MINIMUM cannot be a trigger. Nothing fires when a KRA has NO KPIs — zero
-- rows means zero trigger invocations — so a floor can only be checked when
-- somebody asserts the set is finished. That is pms_validate_kpis, now read
-- by pms_lock_kras.
--
-- Writing it the other way round is the trap: a floor enforced per-INSERT
-- would refuse the FIRST KPI of every KRA, because one is fewer than one
-- until the row lands.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- It does not retro-validate. The trigger fires on INSERT only, so lowering
-- the maximum from 5 to 3 never makes existing data unwritable: a KRA that
-- already holds five KPIs keeps them and stays editable, and only a SIXTH is
-- refused. A migration or a setting change that bricks rows already in the
-- table leaves somebody with no way forward — 194 made the same choice for
-- overlapping policies and for the same reason.
--
-- It does not refuse when the period has no policy. A missing policy is a
-- configuration fault with its own complaint in pms_validate_kras ("No policy
-- found for period … — cannot validate"). Surfacing it a second time as a
-- mysterious refusal in the KRA form would send the reader to the wrong
-- place. No policy therefore means no ceiling here, and the lock gate still
-- refuses the submission.
--
-- ENGINE COMPUTES, SQL DECIDES. lib/pms/kpi.ts predicts both limits so the
-- form can disable the + button and say why; this file is what actually
-- refuses. When they disagree, the TypeScript is the half that is wrong.

-- ── 1. the two columns ─────────────────────────────────────────────────────

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS min_kpi_per_kra int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_kpi_per_kra int NOT NULL DEFAULT 5;

COMMENT ON COLUMN pms_policies.min_kpi_per_kra IS
  'Fewest KPIs a KRA may be submitted with. Default 1: a KRA is the '
  'objective and the KPI is how it is measured, so a KRA with no KPI has '
  'nothing to rate. Checked by pms_validate_kpis when the set is submitted, '
  'not per INSERT — the first KPI of a KRA would otherwise be refused.';
COMMENT ON COLUMN pms_policies.max_kpi_per_kra IS
  'Most KPIs a KRA may hold. Default 5. Enforced by trg_pms_kpi_count on '
  'INSERT, so lowering it never makes existing KRAs unwritable — it refuses '
  'the next one rather than the ones already there.';

-- ── 2. the range has to be a range ─────────────────────────────────────────
--
-- min_kra_count/max_kra_count learned this in 066: without the pair CHECK an
-- admin can save min 5 / max 3, and every KRA is then simultaneously too
-- small and too large with no setting that satisfies both.
--
-- Added as a named constraint rather than inline on the ADD COLUMN so that
-- re-running this file is a no-op instead of a duplicate-object error.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'pms_policies'::regclass
                    AND conname  = 'pms_policies_kpi_range') THEN
    -- The upper bound of 20 mirrors max_kra_count's. It is a guard against a
    -- typo (50 where 5 was meant) producing a form nobody can scroll, not a
    -- considered editorial limit.
    ALTER TABLE pms_policies
      ADD CONSTRAINT pms_policies_kpi_range CHECK (
        min_kpi_per_kra >= 1
        AND max_kpi_per_kra >= min_kpi_per_kra
        AND max_kpi_per_kra <= 20
      );
  END IF;
END $$;

-- ── 3. the ceiling, refused at the write ───────────────────────────────────

CREATE OR REPLACE FUNCTION pms_kpi_count_within_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max int; v_have int; v_title text;
BEGIN
  -- The policy comes through the PERIOD, which is how pms_validate_kras
  -- resolves it too. Going via pms_resolve_policy(employee) instead would
  -- answer a different question — what covers this person TODAY, rather than
  -- what this cycle was opened under — and would re-rule a KRA mid-period
  -- when somebody changes department.
  SELECT p.max_kpi_per_kra INTO v_max
    FROM pms_periods pe
    JOIN pms_policies p ON p.id = pe.policy_id
   WHERE pe.id = NEW.period_id;

  -- No policy: no ceiling here. See the header — the lock gate complains
  -- about the missing policy in words that point at the right screen.
  IF v_max IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_have FROM pms_goal_kpi WHERE goal_id = NEW.goal_id;
  IF v_have >= v_max THEN
    SELECT kra_title INTO v_title FROM pms_employee_goals WHERE id = NEW.goal_id;
    RAISE EXCEPTION
      'This KRA already has the most KPIs the policy allows (%). Remove one '
      'before adding another, or raise the maximum in Setup and '
      'Configuration.%', v_max,
      CASE WHEN v_title IS NULL THEN '' ELSE format(' KRA: “%s”.', v_title) END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION pms_kpi_count_within_policy IS
  'Refuses a KPI beyond pms_policies.max_kpi_per_kra. INSERT only: an UPDATE '
  'of an existing KPI must stay possible after the maximum is lowered, or '
  'tightening the setting would freeze the KRAs already written under it.';

DROP TRIGGER IF EXISTS trg_pms_kpi_count ON pms_goal_kpi;
CREATE TRIGGER trg_pms_kpi_count
  BEFORE INSERT ON pms_goal_kpi
  FOR EACH ROW EXECUTE FUNCTION pms_kpi_count_within_policy();

-- ── 4. the floor, checked when the set is submitted ────────────────────────
--
-- 220's version hardcoded "no KPI at all" as the only count fault. It now
-- reads the policy, reports both ends, and — the part that matters — is
-- actually CONSULTED: until this migration pms_validate_kpis was called by
-- nothing but the verify script, so the floor of one was a sentence in a
-- function nobody ran.

CREATE OR REPLACE FUNCTION pms_validate_kpis(p_employee_id uuid, p_period_id uuid)
RETURNS TABLE (goal_id uuid, seq_no int, kra_title text,
               kra_weightage numeric, kpi_total numeric, kpi_count int,
               error_msg text)
LANGUAGE sql STABLE AS $$
  -- pol ALWAYS YIELDS EXACTLY ONE ROW. A SELECT with no FROM does, whatever
  -- the subqueries find, so the CROSS JOIN below cannot silently empty the
  -- result. Reading the limits with `FROM pms_periods JOIN pms_policies`
  -- instead returns NO row for a period that does not exist or has no
  -- policy — the CROSS JOIN then matches nothing, the function reports zero
  -- faults, and "no such period" reads as "every KRA is fine". That is
  -- exactly the silent pass 074 was written to remove from
  -- pms_validate_kras, and it would be worse here because this one is a gate.
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
           COALESCE(SUM(k.weightage), 0) AS kpi_total,
           COUNT(k.id)::int             AS kpi_count
      FROM pms_employee_goals g
      LEFT JOIN pms_goal_kpi k ON k.goal_id = g.id
     WHERE g.employee_id = p_employee_id
       AND g.period_id   = p_period_id
       AND g.status <> 'SENT_BACK'
     GROUP BY g.id, g.seq_no, g.kra_title, g.weightage
  )
  SELECT gk.id, gk.seq_no, gk.kra_title, gk.weightage, gk.kpi_total, gk.kpi_count,
         CASE
           -- COUNT ORDER IS DELIBERATE. A KRA with no KPIs also fails the
           -- weightage sum (0 <> 25), and "add a KPI" is the sentence that
           -- leads somewhere. Reporting the arithmetic first would tell a
           -- reader to balance a set that does not exist yet.
           WHEN gk.kpi_count = 0 THEN
             format('“%s” has no KPI. A KRA is measured by at least one.',
                    gk.kra_title)
           WHEN gk.kpi_count < pol.min_kpi THEN
             format('“%s” has %s KPI(s); the policy asks for at least %s.',
                    gk.kra_title, gk.kpi_count, pol.min_kpi)
           WHEN gk.kpi_count > pol.max_kpi THEN
             format('“%s” has %s KPIs; the policy allows at most %s.',
                    gk.kra_title, gk.kpi_count, pol.max_kpi)
           WHEN gk.kpi_total <> gk.weightage THEN
             format('“%s” is %s%% but its KPIs total %s%%.',
                    gk.kra_title, gk.weightage, gk.kpi_total)
         END
    FROM gk CROSS JOIN pol
   WHERE gk.kpi_count = 0
      OR gk.kpi_count < pol.min_kpi
      OR gk.kpi_count > pol.max_kpi
      OR gk.kpi_total <> gk.weightage
   ORDER BY gk.seq_no;
$$;

COMMENT ON FUNCTION pms_validate_kpis IS
  'The KRAs whose KPIs do not satisfy the policy: too few, too many, or not '
  'adding up to the KRA''s own weightage. Empty means every KRA is measured '
  'and balanced. The across-KRA total of exactly 100 is pms_validate_kras'' '
  'job and is unchanged.';

-- ── 5. and the gate consults it ────────────────────────────────────────────
--
-- pms_lock_kras is reproduced from 074 with ONE block added, marked below.
-- Everything else is byte-for-byte what is deployed, because this migration
-- has no business changing the one-to-one rule or the lock write while it is
-- in here for the KPI check.

CREATE OR REPLACE FUNCTION pms_lock_kras(p_employee_id uuid, p_period_id uuid, p_manager_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_ok boolean; v_err text; v_121 int;
BEGIN
  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;

  -- The only change from 066: without this, a missing policy leaves `pol`
  -- NULL, pms_validate_kras returns valid, one_to_one_mandatory is NULL so
  -- the check is skipped, and this returns LOCKED for an employee with no
  -- KRAs. Everything below is byte-for-byte as deployed.
  IF NOT FOUND THEN
    RETURN format('ERROR: no policy found for period %s.', p_period_id);
  END IF;

  SELECT is_valid, error_msg INTO v_ok, v_err
  FROM pms_validate_kras(p_employee_id, p_period_id);
  IF NOT v_ok THEN RETURN 'BLOCKED: ' || v_err; END IF;

  -- ── 221 adds this, and only this ─────────────────────────────────────────
  -- The KRA set can be the right size and total exactly 100 while a KRA
  -- inside it has no measure at all, or has KPIs summing to something other
  -- than its own weightage. pms_validate_kras cannot see either: it reads
  -- weightage off the KRA rows. Without this the floor of one KPI was
  -- enforced only by the browser.
  SELECT error_msg INTO v_err
  FROM pms_validate_kpis(p_employee_id, p_period_id) LIMIT 1;
  IF v_err IS NOT NULL THEN RETURN 'BLOCKED: ' || v_err; END IF;
  -- ── end 221 ──────────────────────────────────────────────────────────────

  IF pol.one_to_one_mandatory THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id = p_employee_id AND period_id = p_period_id
      AND discussion_type = 'KRA_SETTING'
      AND employee_ack = true AND manager_ack = true;
    IF v_121 = 0 THEN
      RETURN 'BLOCKED: one-to-one discussion required and must be acknowledged by both';
    END IF;
  END IF;

  UPDATE pms_employee_goals
     SET status='LOCKED', locked_at=now(), locked_by=p_manager_id, updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id AND status <> 'SENT_BACK';

  UPDATE pms_overall_rating SET workflow_status='KRA_LOCKED', updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id;

  RETURN 'LOCKED';
END $$;

NOTIFY pgrst, 'reload schema';
