-- 210_pms_recognition_is_not_training.sql
-- Tell the two kinds of recommendation apart with a column, not a prefix.
-- SAFE TO RUN TWICE. Adds one column and widens one unique constraint.
-- ----------------------------------------------------------------------------
-- ── WHY, AND WHY NOW ───────────────────────────────────────────────────────
--
-- 208 gave a rater's TRAINING suggestions their own table. The recognition a
-- rater proposes when they score somebody high shares that table on purpose:
-- both are proposals HR has not agreed to, both carry the same PENDING /
-- ACCEPTED / DECLINED lifecycle, and HR should action them in one place.
--
-- But the writer told them apart by prefixing details with "RECOGNITION — ",
-- and that is not a discriminator. It is a free-text field a rater also
-- types into. A manager who writes "recognition — she has earned a course on
-- this" against a training suggestion would have it filed as a bonus
-- proposal, and the category cannot rescue it: recognition is stored as
-- OTHER, which is also one of the six buckets a rater may pick for training.
--
-- Nothing read the prefix yet — HR's queue was going to be its first reader,
-- which is why this lands before that queue rather than after it. MEASURED
-- before writing this: pms_training_recommendation holds 0 rows and pms_pip
-- holds 0 rows, so there is no data to reinterpret and no backfill to get
-- wrong. The same change a month from now would be a guess about which of
-- somebody's sentences meant what.
--
-- ── THE DEFAULT IS THE SAFE ONE ────────────────────────────────────────────
--
-- DEFAULT 'TRAINING'. A row written by an older build of the app carries no
-- kind, and training is what that build's block was for; reading an unknown
-- row as a recognition proposal would invent a bonus nobody proposed.
--
-- ── THE UNIQUE HAS TO WIDEN WITH IT ────────────────────────────────────────
--
-- 208's unique was (period_id, employee_id, recommended_by, training_name).
-- With one table holding two kinds, that makes the NAMES collide across
-- kinds: a rater proposing the recognition "Training nomination" — one of
-- the six recognition kinds — could no longer also suggest a training called
-- "Training nomination", and the upsert would silently overwrite one with the
-- other. Adding kind to the key keeps each kind's own double-submit blocked
-- while letting the two coexist.
--
-- Widening a unique constraint can never fail on existing rows: every pair
-- that was distinct before is still distinct with a column added.

ALTER TABLE pms_training_recommendation
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'TRAINING'
    CHECK (kind IN ('TRAINING','RECOGNITION'));

COMMENT ON COLUMN pms_training_recommendation.kind IS
  'TRAINING — a course the rater suggests. RECOGNITION — a bonus, promotion '
  'or other appreciation they propose. Both are proposals HR decides on; the '
  'kind is a column because details is free text a rater also writes in.';

-- The 208 key, widened.
--
-- NOT DROPPED BY NAME. 208 wrote the unique inline, so Postgres named it
-- itself — and the name it would have built from four column names is far
-- past the 63-byte identifier limit, so what is actually in the database is
-- a truncation. Guessing where that truncation fell would leave the old
-- constraint in place on a wrong guess, and the new one would be added
-- beside it: both enforced, the narrower one still rejecting a rater who
-- proposes a recognition named after a training.
--
-- So the name is read rather than assumed: every UNIQUE on this table whose
-- column set is exactly the four 208 used. Anything else on the table is
-- left alone, and a second run finds nothing to drop.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'pms_training_recommendation'::regclass
       AND con.contype = 'u'
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM unnest(con.conkey) k
              JOIN pg_attribute att
                ON att.attrelid = con.conrelid AND att.attnum = k)
           = ARRAY['employee_id','period_id','recommended_by','training_name']
  LOOP
    EXECUTE format('ALTER TABLE pms_training_recommendation DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'dropped the 208 unique: %', c.conname;
  END LOOP;
END $$;

ALTER TABLE pms_training_recommendation
  DROP CONSTRAINT IF EXISTS pms_training_rec_one_per_rater_per_name;
ALTER TABLE pms_training_recommendation
  ADD CONSTRAINT pms_training_rec_one_per_rater_per_name
  UNIQUE (period_id, employee_id, recommended_by, kind, training_name);

CREATE INDEX IF NOT EXISTS idx_pms_training_rec_kind_status
  ON pms_training_recommendation (kind, hr_status);

NOTIFY pgrst, 'reload schema';
