-- 233_analytics_digests.sql
-- The two analytics emails: a manager's Monday note, and the monthly executive briefing.
-- SAFE TO RUN TWICE. Creates three small tables. No data change anywhere else.
-- ----------------------------------------------------------------------------
-- Both emails are OFF until an administrator switches them on (People Analytics ->
-- Email digests). Without this migration the switches are not offered and nothing is
-- sent; the in-app Monday note and briefing work regardless.
--
--   analytics_digest_settings  one row: which emails are on, and who receives the
--                              monthly briefing (each recipient gets it on the slice of
--                              the company THEIR analytics access covers)
--   analytics_digest_optout    a manager who would rather not get the Monday email
--   analytics_digest_log       one row per email per person per period, so a re-run
--                              (or the catch-up schedule) never sends twice
--
-- WHY NO allow_all POLICY: who receives an analytics email, and the log of who was
-- sent what, are not for the public anon key. RLS is ON with NO policy — only the
-- service role (the API routes and the scheduled job) can read or write them.

CREATE TABLE IF NOT EXISTS analytics_digest_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monday_note          BOOLEAN NOT NULL DEFAULT false,
  monthly_briefing     BOOLEAN NOT NULL DEFAULT false,
  briefing_recipients  UUID[] NOT NULL DEFAULT '{}',
  updated_by           UUID,
  updated_by_name      TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO analytics_digest_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics_digest_optout (
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('monday_note', 'monthly_briefing')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, kind)
);

CREATE TABLE IF NOT EXISTS analytics_digest_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('monday_note', 'monthly_briefing')),
  employee_id  UUID NOT NULL,
  period_key   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  detail       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, employee_id, period_key)
);

ALTER TABLE analytics_digest_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_digest_optout  ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_digest_log     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_analytics_digest_settings" ON analytics_digest_settings;
DROP POLICY IF EXISTS "allow_all_analytics_digest_optout" ON analytics_digest_optout;
DROP POLICY IF EXISTS "allow_all_analytics_digest_log" ON analytics_digest_log;
-- (deliberately no CREATE POLICY — service role only)

COMMENT ON TABLE analytics_digest_settings IS 'Analytics emails: Monday note on/off, monthly briefing on/off and its recipients. Service role only. See lib/analytics/server/digest.ts.';
COMMENT ON TABLE analytics_digest_log IS 'One row per analytics email per person per period — stops a re-run sending twice. Service role only.';

NOTIFY pgrst, 'reload schema';
