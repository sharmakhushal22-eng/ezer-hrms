-- 215_pms_training_catalogue_and_bin.sql
-- A catalogue to retrieve from, and a bin to hold what the model suggests.
-- SAFE TO RUN TWICE. Creates two tables and their policies. No data change.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: while a rater is scoring somebody, an AI should suggest training
-- based on the ratings and the remarks the chain has written, the suggestions
-- should sit in a bin, and the rater should be able to drag one into their
-- own training recommendations.
--
-- ── THERE WAS NOTHING TO RETRIEVE FROM ─────────────────────────────────────
--
-- 208 recorded it and it is still true: this database has no training table.
-- Checked again before writing this — no trainings, training_catalogue,
-- lms_courses or employee_trainings, and no pgvector.
--
-- A retrieval-augmented suggestion needs something to retrieve. Without a
-- catalogue the model is left inventing course names and links, which is the
-- failure mode that matters here: a manager recommends "Advanced Power BI
-- for Retail Ops, Coursera" in good faith, HR tries to book it, and it does
-- not exist. So the catalogue comes first and the model fills the gaps —
-- the owner's choice, and the honest one.
--
-- ── WHAT THE MODEL MAY AND MAY NOT PRODUCE ─────────────────────────────────
--
-- A suggestion is marked by its SOURCE and the two are not interchangeable:
--
--   CATALOGUE — a row that exists here. It has a provider and may have a
--   link, because somebody put them there.
--
--   MODEL — a SKILL AREA, never a named course and never a URL. "Inventory
--   forecasting" is a direction a manager can act on. "Inventory
--   Forecasting Masterclass, Udemy, 14 hours" is a fabrication wearing a
--   catalogue's clothes, and nothing downstream could tell them apart.
--
-- The column comment says so, and the application enforces it, because the
-- distinction survives only as long as somebody remembers why it is there.
--
-- ── THE CATALOGUE STARTS EMPTY, DELIBERATELY ───────────────────────────────
--
-- No seed. Inventing a starter list of courses would be the same fabrication
-- one layer down, and a seeded row is indistinguishable from one an L&D team
-- chose. The screens say the catalogue is empty and what that means; until
-- it is filled, every suggestion is a skill area, correctly labelled.

CREATE TABLE IF NOT EXISTS pms_training_catalogue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means the whole group: a course any company may send people on.
  company_id    uuid,
  course_name   text NOT NULL,
  provider      text,
  /** What it teaches, in the words a rater would use. The retrieval matches
   *  on this before anything else. */
  skill         text NOT NULL,
  category      text NOT NULL DEFAULT 'TECHNICAL'
                CHECK (category IN ('TECHNICAL','BEHAVIOURAL','LEADERSHIP',
                                    'DOMAIN','COMPLIANCE','OTHER')),
  level         text CHECK (level IN ('FOUNDATION','INTERMEDIATE','ADVANCED')),
  url           text,
  duration_hours numeric(6,2),
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, course_name, provider)
);

CREATE INDEX IF NOT EXISTS idx_pms_catalogue_active
  ON pms_training_catalogue (is_active) WHERE is_active;

COMMENT ON TABLE pms_training_catalogue IS
  'Training this organisation can actually send somebody on. The corpus the '
  'AI suggestion retrieves from: a catalogue suggestion names a real course '
  'because a person put it here.';

-- ── the bin ────────────────────────────────────────────────────────────────
--
-- PER RATER, not per employee. Two managers rating the same person are
-- forming their own views, and one of them dismissing a suggestion must not
-- remove it from the other's bin.
CREATE TABLE IF NOT EXISTS pms_training_suggestion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  period_id     uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  /** Whose bin this is. */
  generated_by  uuid NOT NULL REFERENCES employees(id),
  generated_at  timestamptz NOT NULL DEFAULT now(),

  source        text NOT NULL CHECK (source IN ('CATALOGUE','MODEL')),
  /** Set only for a CATALOGUE suggestion. */
  catalogue_id  uuid REFERENCES pms_training_catalogue(id) ON DELETE SET NULL,

  training_name text NOT NULL,
  skill         text,
  category      text NOT NULL DEFAULT 'TECHNICAL'
                CHECK (category IN ('TECHNICAL','BEHAVIOURAL','LEADERSHIP',
                                    'DOMAIN','COMPLIANCE','OTHER')),
  /** Why the model put this in front of the rater. Shown, not hidden: a
   *  suggestion a manager cannot interrogate is one they either take on
   *  trust or ignore, and both are worse than understanding it. */
  rationale     text,

  status        text NOT NULL DEFAULT 'BIN'
                CHECK (status IN ('BIN','TAKEN','DISMISSED')),

  /** Which model produced it, so a bad batch can be traced to its source. */
  model         text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- The same rater being offered the same thing twice for the same person is
  -- a duplicate, not a second opinion.
  UNIQUE (period_id, employee_id, generated_by, training_name)
);

CREATE INDEX IF NOT EXISTS idx_pms_suggestion_bin
  ON pms_training_suggestion (period_id, employee_id, generated_by, status);

COMMENT ON TABLE pms_training_suggestion IS
  'The bin of AI suggestions for one rater, for one person, for one period. '
  'Kept rather than regenerated so an interrupted appraisal comes back to '
  'the same shortlist and the same call is not paid for twice.';
COMMENT ON COLUMN pms_training_suggestion.source IS
  'CATALOGUE — a course that exists in pms_training_catalogue. MODEL — a '
  'SKILL AREA the model proposed, never a named course and never a URL, '
  'because an invented course is indistinguishable from a real one once it '
  'is written down.';

ALTER TABLE pms_training_catalogue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_pms_training_catalogue" ON pms_training_catalogue;
CREATE POLICY "allow_all_pms_training_catalogue" ON pms_training_catalogue
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE pms_training_suggestion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_pms_training_suggestion" ON pms_training_suggestion;
CREATE POLICY "allow_all_pms_training_suggestion" ON pms_training_suggestion
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
