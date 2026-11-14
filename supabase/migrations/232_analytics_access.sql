-- 232_analytics_access.sql
-- Who may open People Analytics, and on which slice of the company.
-- SAFE TO RUN TWICE. Creates one table. No data change anywhere else.
-- ----------------------------------------------------------------------------
-- Until now the analytics page opened for anyone holding Reports, Company Dashboard
-- or ESS Reports, across every company their roles cover. That is a role-wide
-- switch: it cannot say "the site manager of the Pune plant sees Pune only", or
-- "this CHRO sees one company, with pay", or "this HR manager sees attendance and
-- hiring but no salaries".
--
-- One row here is one person's analytics access, set from People Analytics ->
-- Manage access. When a person has an active row, the row decides — it can narrow
-- what their role would give, or open analytics to somebody with no reporting role
-- at all (they find it in ESS -> Insights -> Organisation). Super Admin is never
-- limited by a row. People without a row keep exactly what their role gives today.
--
--   company_ids       NULL = every company; else only these
--   locations         NULL = every location; else only employees at these (by name,
--                     the same way the page's Location filter matches)
--   departments       NULL = every department; else only these (by name)
--   employment_types  NULL = every type; else only these
--   tabs              NULL = every tab; else a subset of workforce, attrition,
--                     attendance, performance, hiring, cost. Pulse is always shown,
--                     limited to the tabs allowed.
--   see_names         the named lists (flight risk, late marks, probation …)
--   see_pay           the Pay & cost tab
--   can_export        the PDF and Excel downloads
--   valid_until       last day the row applies; NULL = no end
--
-- WHY NO allow_all POLICY: the row decides who sees salaries and named lists, so
-- it must not be writable with the public anon key. RLS is ON with NO policy —
-- only the service role (the API route, which checks the caller may grant) can
-- read or write it. Every change is also written to ess_access_audit.

CREATE TABLE IF NOT EXISTS analytics_access (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  company_ids       UUID[],
  locations         TEXT[],
  departments       TEXT[],
  employment_types  TEXT[],
  tabs              TEXT[],
  see_names         BOOLEAN NOT NULL DEFAULT false,
  see_pay           BOOLEAN NOT NULL DEFAULT false,
  can_export        BOOLEAN NOT NULL DEFAULT true,
  valid_until       DATE,
  note              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  granted_by        UUID,
  granted_by_name   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_access_active_idx ON analytics_access (employee_id) WHERE is_active;

ALTER TABLE analytics_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_analytics_access" ON analytics_access;
-- (deliberately no CREATE POLICY — service role only)

COMMENT ON TABLE analytics_access IS
  'Per-person People Analytics access and data scope (companies, locations, departments, tabs, names, pay). Service role only. See lib/analytics/server/access.ts.';

NOTIFY pgrst, 'reload schema';
