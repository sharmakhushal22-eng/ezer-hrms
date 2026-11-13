-- 231_analytics_ai_brief.sql
-- Remembers the AI read of an analytics page, so the same figures are not paid for twice.
-- SAFE TO RUN TWICE. OPTIONAL: without this table the AI read still works, cached in
-- each server instance's memory only (lib/analytics/server/ai.ts notices the table is
-- missing and stops asking for it).
-- ----------------------------------------------------------------------------
-- One row per answer the model wrote. The newest row for a scope_hash is the one
-- served; older rows stay as a record of what the AI said, when, on which model, at
-- what token cost, and who caused the call.
--
-- scope_hash is a SHA-256 of the scope (company set + filters, a manager's team, or
-- one employee) — no ids in clear. `brief` is what the reader saw: for a manager's
-- team it contains their team members' names, and for an employee it describes their
-- own attendance, leave and pay.
--
-- -- WHY NO allow_all POLICY ------------------------------------------------------
--
-- Most tables here carry the open anon policy. This one must not: an employee's read
-- of their own pay would be readable by anybody holding the public anon key. RLS is ON
-- with NO policy, so only the service role (the API routes) can touch it — the same
-- reason 230_deny_public_key exists.

CREATE TABLE IF NOT EXISTS analytics_ai_brief (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_hash     TEXT NOT NULL,
  audience       TEXT NOT NULL CHECK (audience IN ('org', 'team', 'me')),
  fingerprint    TEXT NOT NULL,
  brief          JSONB NOT NULL,
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_ai_brief_scope_idx ON analytics_ai_brief (scope_hash, created_at DESC);

ALTER TABLE analytics_ai_brief ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_analytics_ai_brief" ON analytics_ai_brief;
-- (deliberately no CREATE POLICY — service role only)

COMMENT ON TABLE analytics_ai_brief IS
  'AI-written reads of the analytics pages (org / team / me). Service role only. See lib/analytics/server/ai.ts.';
