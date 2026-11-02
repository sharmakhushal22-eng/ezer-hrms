-- 209_pms_allows_recognition.sql
-- Which bands invite a recognition recommendation, as configuration.
-- SAFE TO RUN TWICE. Adds one column and seeds it ONCE per scale.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: when a rater scores somebody high, a box should appear for
-- recognition — "salary bonus / promotion recommendations / other
-- appreciations" — the mirror of the PIP checkbox that appears when they
-- score somebody low.
--
-- The low half already exists as data. pms_rating_scale.allows_pip_request
-- has been there since 066 and is seeded true at bands 2 and 1 on this
-- company's scale. The high half had nothing, so it is added the same way
-- rather than computed.
--
-- ── WHY A COLUMN AND NOT "RATING > 2" ──────────────────────────────────────
--
-- The request said "you say rating > 2", deferring the threshold. Three
-- readings were offered and this is the one chosen: a per-band flag an admin
-- can change, mirroring allows_pip_request exactly.
--
-- Computing it instead would have meant hardcoding a midpoint, and the scale
-- is policy configuration — a three-point or ten-point scale is a setting
-- away, and "above 2" means something different on each. The same trap the
-- rating ramp avoided by normalising against the bands in play.
--
-- It also keeps the two halves symmetrical: one flag says a band may raise a
-- PIP, the other says a band may propose recognition, and an admin changes
-- either in Setup & Controls without a deploy.
--
-- ── THE SEED, AND WHY IT ONLY RUNS ONCE ────────────────────────────────────
--
-- DEFAULT false, then the top two bands of each scale are switched on. "Top
-- two" is by rating_value within each (company_id, policy_id), so it follows
-- whatever scale that policy actually has rather than assuming five bands.
--
-- The UPDATE is the only data change in this migration, and it is guarded:
-- it touches a scale ONLY IF no band in it already says true. So a second
-- run changes nothing, and — more importantly — an admin who later turns
-- recognition off for "Exceeds" does not have their decision undone the next
-- time somebody replays the migrations.
--
-- ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
--
-- It grants nothing and awards nothing. The flag decides whether a rater is
-- OFFERED the box; what they write is a recommendation that HR decides on,
-- exactly like the training suggestions in 208. Recognition that is actually
-- awarded still lands in pms_additional_benefits, written by HR.

ALTER TABLE pms_rating_scale
  ADD COLUMN IF NOT EXISTS allows_recognition boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pms_rating_scale.allows_recognition IS
  'Whether a rater scoring in this band is offered the recognition box '
  '(bonus, promotion, other). The mirror of allows_pip_request at the other '
  'end of the scale. Not a permission and not an award: HR decides.';

-- Seed the top two bands of each scale, once. See the header on the guard.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY company_id, policy_id
                            ORDER BY rating_value DESC) AS rn,
         company_id, policy_id
    FROM pms_rating_scale
   WHERE is_active IS NOT false
),
untouched AS (
  -- A scale nobody has configured yet: no band in it says true.
  SELECT r.company_id, r.policy_id
    FROM ranked r
   GROUP BY r.company_id, r.policy_id
  EXCEPT
  SELECT s.company_id, s.policy_id
    FROM pms_rating_scale s
   WHERE s.allows_recognition
)
UPDATE pms_rating_scale t
   SET allows_recognition = true
  FROM ranked r
  JOIN untouched u
    ON u.company_id IS NOT DISTINCT FROM r.company_id
   AND u.policy_id  IS NOT DISTINCT FROM r.policy_id
 WHERE t.id = r.id
   AND r.rn <= 2;

NOTIFY pgrst, 'reload schema';
