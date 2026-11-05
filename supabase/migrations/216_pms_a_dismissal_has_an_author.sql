-- 216_pms_a_dismissal_has_an_author.sql
-- A decision recorded with nobody's name on it cannot be questioned later.
-- SAFE TO RUN TWICE. Adds two columns. No data change.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- 215 gave pms_training_suggestion a status of BIN, TAKEN or DISMISSED and
-- recorded who GENERATED the row — but not who moved it, or when.
--
-- That gap stopped being theoretical during testing. Ten suggestions were
-- in the table; five read DISMISSED and only one had been dismissed by
-- hand. There is no way to tell from the row whether the other four were
-- rejected by a person, written that way by a bug, or changed by something
-- else entirely — the column holds a verdict with no author and no clock.
--
-- The cause is still unexplained. That is exactly the argument for these
-- two columns: the next time it happens the row will say who did it and
-- when, and the question will take a query rather than a guess.
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
--
-- Not an audit table and not a history. One actor and one timestamp for the
-- last move, which is what answers "who threw this away". A full trail of
-- every transition would be a bigger decision than the question in front of
-- me, and pms_audit_log already exists for anybody who wants to make it.

ALTER TABLE pms_training_suggestion
  ADD COLUMN IF NOT EXISTS status_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS status_at timestamptz;

COMMENT ON COLUMN pms_training_suggestion.status_by IS
  'Who last moved this suggestion out of the bin. Null while it is still '
  'BIN, and null on rows written before 216. A status with no author is a '
  'verdict nobody can be asked about.';

NOTIFY pgrst, 'reload schema';
