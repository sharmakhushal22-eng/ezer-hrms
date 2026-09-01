-- =====================================================================
-- EZER HRMS — 079: group-level profile fields
--
-- The groups table is the root of the hierarchy and carries almost nothing:
--
--     id, group_code, group_name, logo_url, country, status, timestamps
--
-- Every company under it can hold a tagline, a website, a registered office
-- and a set of contacts; the group that owns them all could hold none of it.
-- This adds the fields the group header and the group editor need.
--
-- All ADD COLUMN IF NOT EXISTS, all nullable, no defaults that rewrite an
-- existing row. The one group in the database keeps every value it has.
-- =====================================================================

-- ── Identity ───────────────────────────────────────────────────────────
ALTER TABLE groups ADD COLUMN IF NOT EXISTS tagline        text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS description    text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS website_url    text;
-- logo_url already exists and is unused. Kept as the file path, the way
-- company logos and letterheads already work — the bytes live in storage.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS icon_emoji     text;

-- ── Registration ───────────────────────────────────────────────────────
-- A group is frequently a holding company with its own PAN and CIN, distinct
-- from any of its operating entities.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS holding_pan    text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS holding_cin    text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS incorporated_on date;

-- ── Contact ────────────────────────────────────────────────────────────
ALTER TABLE groups ADD COLUMN IF NOT EXISTS head_office    text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS contact_email  text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS contact_phone  text;

-- ── Brand ──────────────────────────────────────────────────────────────
-- The group header is a permanently dark gradient. These let a group tint it
-- to its own brand rather than every group looking like the default navy.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS brand_primary   text;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS brand_secondary text;

-- ── Guard the brand colours ────────────────────────────────────────────
-- These are interpolated straight into a CSS gradient. A CHECK is not a
-- substitute for escaping, but it stops an obviously malformed value being
-- stored in the first place, and a hex colour has exactly one shape.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_brand_primary_chk') THEN
    ALTER TABLE groups ADD CONSTRAINT groups_brand_primary_chk
      CHECK (brand_primary IS NULL OR brand_primary ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_brand_secondary_chk') THEN
    ALTER TABLE groups ADD CONSTRAINT groups_brand_secondary_chk
      CHECK (brand_secondary IS NULL OR brand_secondary ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

-- ── What this does NOT add ─────────────────────────────────────────────
-- No group_id on anything new: companies.group_id already exists and is the
-- only link the hierarchy needs. Adding a company to a group is an INSERT
-- into companies with that group_id, not a new join table.
-- =====================================================================
