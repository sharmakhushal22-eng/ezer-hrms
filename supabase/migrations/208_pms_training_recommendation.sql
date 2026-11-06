-- 208_pms_training_recommendation.sql
-- What a rater thinks this person should be trained in, said while rating.
-- SAFE TO RUN TWICE. Creates one table and its policy. No data change,
-- nothing dropped, no UPDATE at load time.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: "training recommendation block should be shown to r1, r2, hod
-- during giving rating in pms (optional) where they can suggest training to
-- the employee they are giving rating to — like python training / excel /
-- other trainings — and can explain it in details", and all of it reaches
-- the HR Head at the end so they can act on it.
--
-- ── WHY ITS OWN TABLE ──────────────────────────────────────────────────────
--
-- Two existing places could have held this and both were wrong:
--
--   pms_additional_benefits already has a TRAINING_NOMINATION type, a note
--   and an attachment. But it records awarded_by, not recommended_by — it is
--   the table of things GIVEN, and a suggestion is not a benefit. Storing
--   "I think she needs Excel" as an award would make the recognition list
--   wrong and leave HR unable to decline one.
--
--   pms_feedback.development_plan is free text and exists. But pms_feedback
--   is UNIQUE (period_id, employee_id) — ONE row per person per period — so
--   three raters would overwrite each other, and HR could not accept one
--   recommendation and decline another.
--
-- A recommendation is a distinct thing with a distinct lifecycle: somebody
-- suggests it, HR decides, and both halves have to survive separately.
--
-- ── MANY PER PERSON, FROM MANY RATERS ──────────────────────────────────────
--
-- No unique on (period, employee): an RM L1 may suggest two courses and the
-- HOD a third, and all of them should reach HR. The only uniqueness is the
-- exact duplicate — the same rater naming the same training twice for the
-- same cycle — which is a double-submit, not a second opinion.
--
-- ── IT IS A SUGGESTION, NOT A DECISION ─────────────────────────────────────
--
-- hr_status starts PENDING and only HR moves it. A rater recommending
-- training is not committing a budget, and nothing in this table books,
-- schedules or charges anything. The honest shape is: the rating conversation
-- captures the need while it is fresh, and HR decides separately.
--
-- ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
--
-- No catalogue. There is no training table in this database — checked for
-- trainings, training_catalogue, lms_courses and employee_trainings, none
-- exist — so training_name is free text and category is a coarse bucket.
-- Inventing a course catalogue to satisfy a dropdown would be a bigger and
-- separate decision than the one asked for.
--
-- Not gated by rating. Unlike the PIP prompt, a good performer may need
-- training as much as a poor one, so this block is offered at every band.

CREATE TABLE IF NOT EXISTS pms_training_recommendation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  period_id           uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- WHO SUGGESTED IT. The role is stored beside the id for the reason
  -- pms_reviews stores rater_role: the chain is frozen per period, and a
  -- reorg must not relabel last quarter's recommendation.
  recommended_by      uuid NOT NULL REFERENCES employees(id),
  recommended_by_role text NOT NULL
                      CHECK (recommended_by_role IN ('RM_L1','RM_L2','HOD')),
  recommended_at      timestamptz NOT NULL DEFAULT now(),

  training_name       text NOT NULL,
  category            text NOT NULL DEFAULT 'TECHNICAL'
                      CHECK (category IN ('TECHNICAL','BEHAVIOURAL','LEADERSHIP',
                                          'DOMAIN','COMPLIANCE','OTHER')),
  -- The "explain it in details" half. Optional, because a rater who writes
  -- only "Advanced Excel" has still told HR something useful.
  details             text,

  -- HR's half. PENDING until somebody acts.
  hr_status           text NOT NULL DEFAULT 'PENDING'
                      CHECK (hr_status IN ('PENDING','ACCEPTED','DECLINED')),
  hr_note             text,
  hr_actioned_by      uuid REFERENCES employees(id),
  hr_actioned_at      timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- The exact duplicate only. See the header: many recommendations per
  -- person, from many raters, is the normal case.
  UNIQUE (period_id, employee_id, recommended_by, training_name)
);

CREATE INDEX IF NOT EXISTS idx_pms_training_rec_period_employee
  ON pms_training_recommendation (period_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_pms_training_rec_hr_status
  ON pms_training_recommendation (hr_status);

COMMENT ON TABLE pms_training_recommendation IS
  'Training a rater suggests for an employee while rating them. A suggestion '
  'with its own lifecycle, not a benefit: pms_additional_benefits records '
  'what was AWARDED. HR accepts or declines each row.';

ALTER TABLE pms_training_recommendation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_pms_training_recommendation" ON pms_training_recommendation;
CREATE POLICY "allow_all_pms_training_recommendation" ON pms_training_recommendation
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
