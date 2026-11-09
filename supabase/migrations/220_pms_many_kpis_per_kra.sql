-- 220_pms_many_kpis_per_kra.sql
-- A KRA can hold several KPIs, each rated on its own.
-- SAFE TO RUN TWICE. One table, one column, two functions. Scores do not move.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: a KRA can have several KPIs, each with its own rating; the KPIs
-- split the KRA's weightage; the total across KRAs stays exactly 100; every
-- rung rates every KPI.
--
-- Until now pms_employee_goals carried ONE kpi_metric, as text, and
-- pms_reviews carried one rating per goal per rater. An objective measured
-- three ways had to be written as three KRAs, or as one KRA with three
-- measures crammed into a single line and one rating covering all of them.
--
-- ── THE ARITHMETIC DOES NOT CHANGE, AND THAT IS THE POINT ──────────────────
--
-- Today:   score = SUM(rating x kra_weightage) / SUM(kra_weightage)
-- After:   score = SUM(rating x kpi_weightage) / SUM(kpi_weightage)
--
-- Every existing KRA gets exactly one KPI carrying the KRA's whole
-- weightage, so w_kpi = w_kra and r_kpi = r_kra, and the two formulas return
-- the same number for every appraisal on record. This migration is therefore
-- score-neutral by construction, not by hope: 220_pms_many_kpis_verify.sql
-- recomputes every stored score both ways and fails if any differs.
--
-- ── WEIGHTAGE: TWO RULES, ONE TOTAL ────────────────────────────────────────
--
--   Across KRAs      the weightages still total EXACTLY 100 (unchanged —
--                    pms_validate_kras, untouched below).
--   Inside a KRA     its KPIs total exactly that KRA's weightage.
--
-- The second rule is what keeps the first true. If a 30% KRA's KPIs summed
-- to 40, the real total would be 110 while pms_validate_kras still read 100
-- from the KRA rows and said yes.
--
-- ── WHAT IS DELIBERATELY NOT DONE ──────────────────────────────────────────
--
-- pms_employee_goals.kpi_metric and .target_value are NOT dropped. They are
-- the historical record of what was written before today, 48 rows of it, 32
-- of them locked. They are marked deprecated in a COMMENT and the
-- application stops reading them; destroying them to tidy the schema would
-- trade a real record for neatness.
--
-- Nor is a KRA-level rating kept alongside the KPI ratings. Two numbers that
-- can disagree about the same KRA is a question nobody can answer — the KRA's
-- rating is derived from its KPIs, and only from its KPIs.

-- ── 1. the KPIs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pms_goal_kpi (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  period_id     uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL,
  goal_id       uuid NOT NULL REFERENCES pms_employee_goals(id) ON DELETE CASCADE,
  seq_no        int  NOT NULL,
  kpi_metric    text NOT NULL,
  target_value  text,
  /**
   * THIS KPI'S SHARE OF ITS KRA. Not of the whole appraisal — the KPIs under
   * one KRA add up to that KRA's weightage, and the KRAs add up to 100. A
   * number here is therefore directly comparable with a KRA weightage, which
   * is what lets pms_score treat them as one flat list.
   */
  weightage     numeric(5,2) NOT NULL DEFAULT 0
                CHECK (weightage >= 0 AND weightage <= 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, seq_no)
);

CREATE INDEX IF NOT EXISTS idx_pms_goal_kpi_goal ON pms_goal_kpi (goal_id);
CREATE INDEX IF NOT EXISTS idx_pms_goal_kpi_emp  ON pms_goal_kpi (employee_id, period_id);

COMMENT ON TABLE pms_goal_kpi IS
  'The KPIs under one KRA. Each is rated separately by every rung, and its '
  'weightage is a share of its KRA''s weightage — the KPIs under a KRA total '
  'that KRA''s number, and the KRAs total 100.';

ALTER TABLE pms_goal_kpi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_pms_goal_kpi" ON pms_goal_kpi;
CREATE POLICY "allow_all_pms_goal_kpi" ON pms_goal_kpi
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 2. every existing KRA becomes a KRA with one KPI ───────────────────────
--
-- Lossless and idempotent: the WHERE NOT EXISTS makes a second run a no-op,
-- and the KPI carries the KRA's whole weightage so no score moves.
INSERT INTO pms_goal_kpi
  (company_id, period_id, employee_id, goal_id, seq_no,
   kpi_metric, target_value, weightage)
SELECT g.company_id, g.period_id, g.employee_id, g.id, 1,
       COALESCE(NULLIF(btrim(g.kpi_metric), ''), g.kra_title),
       g.target_value, g.weightage
  FROM pms_employee_goals g
 WHERE NOT EXISTS (SELECT 1 FROM pms_goal_kpi k WHERE k.goal_id = g.id);

COMMENT ON COLUMN pms_employee_goals.kpi_metric IS
  'DEPRECATED by 220 — a KRA''s measures live in pms_goal_kpi now. Kept as '
  'the record of what was written before that, and still carried on rows '
  'created before the change. Nothing reads it.';
COMMENT ON COLUMN pms_employee_goals.target_value IS
  'DEPRECATED by 220 — see pms_employee_goals.kpi_metric.';

-- ── 3. a review is of a KPI ────────────────────────────────────────────────

ALTER TABLE pms_reviews
  ADD COLUMN IF NOT EXISTS kpi_id uuid REFERENCES pms_goal_kpi(id) ON DELETE CASCADE;

-- Point every existing review at its goal's single KPI. Unambiguous: step 2
-- created exactly one per goal, so there is only one row it can mean.
UPDATE pms_reviews r
   SET kpi_id = k.id
  FROM pms_goal_kpi k
 WHERE k.goal_id = r.goal_id
   AND r.kpi_id IS NULL
   AND (SELECT count(*) FROM pms_goal_kpi k2 WHERE k2.goal_id = r.goal_id) = 1;

/**
 * ONE RATING PER RATER PER KPI.
 *
 * The old key was (period, employee, goal, rater_role) — one rating per KRA.
 * It has to include the KPI now, or a rater can hold only one rating across
 * all the KPIs of a KRA.
 *
 * Swapped only once every row has a kpi_id, and the guard is not ceremony:
 * a review whose goal somehow has no KPI would be silently dropped from the
 * new key's coverage, and the first duplicate would appear months later.
 */
DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans FROM pms_reviews WHERE kpi_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION '220: % review(s) have no KPI to point at. The backfill '
                    'in step 2 did not cover every goal — stopping rather '
                    'than leaving the unique key half applied.', orphans;
  END IF;

  ALTER TABLE pms_reviews ALTER COLUMN kpi_id SET NOT NULL;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'pms_reviews'::regclass
                AND conname  = 'pms_reviews_period_id_employee_id_goal_id_rater_role_key') THEN
    ALTER TABLE pms_reviews
      DROP CONSTRAINT pms_reviews_period_id_employee_id_goal_id_rater_role_key;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'pms_reviews'::regclass
                    AND conname  = 'pms_reviews_one_per_kpi_per_rater') THEN
    ALTER TABLE pms_reviews
      ADD CONSTRAINT pms_reviews_one_per_kpi_per_rater
      UNIQUE (period_id, employee_id, kpi_id, rater_role);
  END IF;
END $$;

-- ── 4. the score, over KPIs ────────────────────────────────────────────────
--
-- Identical in shape to the function it replaces; the weightage and the join
-- move from the KRA to the KPI. Unrated KPIs stay out of the denominator, as
-- unrated KRAs did — a half-rated appraisal shows the average of what has
-- been rated, not a number dragged toward zero by work nobody has looked at.
CREATE OR REPLACE FUNCTION pms_score(p_employee_id uuid, p_period_id uuid, p_role text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT ROUND(COALESCE(SUM(r.rating * k.weightage) / NULLIF(SUM(k.weightage), 0), 0), 2)
  FROM pms_goal_kpi k
  JOIN pms_reviews r
    ON r.kpi_id = k.id AND r.rater_role = p_role AND r.submitted = true
  WHERE k.employee_id = p_employee_id AND k.period_id = p_period_id;
$$;

-- ── 5. the KPIs under a KRA total that KRA's weightage ─────────────────────
--
-- Returned as a row per offending KRA rather than raised, so a screen can
-- name every one at once instead of making somebody fix them one refusal at
-- a time. pms_validate_kras is untouched: across KRAs the total is still
-- exactly 100.
CREATE OR REPLACE FUNCTION pms_validate_kpis(p_employee_id uuid, p_period_id uuid)
RETURNS TABLE (goal_id uuid, seq_no int, kra_title text,
               kra_weightage numeric, kpi_total numeric, kpi_count int,
               error_msg text)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.seq_no, g.kra_title, g.weightage,
         COALESCE(SUM(k.weightage), 0), COUNT(k.id)::int,
         CASE
           WHEN COUNT(k.id) = 0
             THEN format('“%s” has no KPI. A KRA is measured by at least one.',
                         g.kra_title)
           WHEN COALESCE(SUM(k.weightage), 0) <> g.weightage
             THEN format('“%s” is %s%% but its KPIs total %s%%.',
                         g.kra_title, g.weightage, COALESCE(SUM(k.weightage), 0))
         END
    FROM pms_employee_goals g
    LEFT JOIN pms_goal_kpi k ON k.goal_id = g.id
   WHERE g.employee_id = p_employee_id
     AND g.period_id   = p_period_id
     AND g.status <> 'SENT_BACK'
   GROUP BY g.id, g.seq_no, g.kra_title, g.weightage
  HAVING COUNT(k.id) = 0 OR COALESCE(SUM(k.weightage), 0) <> g.weightage
   ORDER BY g.seq_no;
$$;

COMMENT ON FUNCTION pms_validate_kpis IS
  'The KRAs whose KPIs do not add up to the KRA''s weightage, or have no KPI '
  'at all. Empty means every KRA is measured and balanced. The across-KRA '
  'total of exactly 100 is pms_validate_kras'' job and is unchanged.';

NOTIFY pgrst, 'reload schema';
