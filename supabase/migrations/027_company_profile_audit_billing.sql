-- ════════════════════════════════════════════════════════════════════
-- 027_company_profile_audit_billing.sql — EZER HRMS · Company Profile
-- Adds: company_master_audit (edit trail), company_billing (quarterly ledger),
--       branch-wise employee cap on locations, billing fields on license_plans,
--       resolve_account_status(company) → ACTIVE | GRACE | SUSPENDED.
-- Existing master tables (groups, companies, locations, registrations,
--   company_bank_accounts, license_plans) live in Supabase already.
-- RLS: project standard permissive (anon + authenticated).
-- ════════════════════════════════════════════════════════════════════

-- ── Audit trail: every edit to any company-master entity ─────────────
CREATE TABLE IF NOT EXISTS company_master_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,                 -- GROUP | COMPANY | LOCATION | REGISTRATION | BANK | LICENSE
  entity_id   UUID NOT NULL,
  company_id  UUID,                          -- for scoping the audit feed (nullable)
  action      TEXT NOT NULL DEFAULT 'UPDATE',-- CREATE | UPDATE | DELETE
  field       TEXT,                          -- which field changed
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT,
  note        TEXT,
  changed_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cma_entity  ON company_master_audit(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cma_company ON company_master_audit(company_id, changed_at DESC);

-- ── Quarterly billing ledger (one row per billed period) ─────────────
CREATE TABLE IF NOT EXISTS company_billing (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period       TEXT,                         -- e.g. 'FY2026-27 Q1'
  amount       NUMERIC(12,2),
  valid_from   DATE,
  valid_till   DATE,
  paid_on      DATE,
  confirmed_by TEXT,                          -- EZER super-admin who confirmed payment
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | OVERDUE
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_company ON company_billing(company_id, valid_till DESC);

-- ── Extend license_plans with billing + account-status fields ────────
ALTER TABLE license_plans ADD COLUMN IF NOT EXISTS billing_cycle  TEXT DEFAULT 'QUARTERLY';
ALTER TABLE license_plans ADD COLUMN IF NOT EXISTS paid_till      DATE;
ALTER TABLE license_plans ADD COLUMN IF NOT EXISTS grace_days     INTEGER DEFAULT 30;
ALTER TABLE license_plans ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'ACTIVE';
ALTER TABLE license_plans ADD COLUMN IF NOT EXISTS next_due_date  DATE;

-- ── Extend locations with branch-wise employee cap (billing basis) ───
ALTER TABLE locations ADD COLUMN IF NOT EXISTS max_employees INTEGER;

-- ── RLS (project standard permissive while auth not yet wired) ───────
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['company_master_audit','company_billing']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ── Resolver: live account status from license paid_till + grace ─────
-- ACTIVE while paid; GRACE for grace_days after paid_till; SUSPENDED after.
CREATE OR REPLACE FUNCTION resolve_account_status(p_company_id UUID)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN lp.paid_till IS NULL                                          THEN 'ACTIVE'
    WHEN CURRENT_DATE <= lp.paid_till                                  THEN 'ACTIVE'
    WHEN CURRENT_DATE <= lp.paid_till + COALESCE(lp.grace_days, 30)    THEN 'GRACE'
    ELSE 'SUSPENDED'
  END
  FROM license_plans lp
  WHERE lp.company_id = p_company_id AND lp.is_active = TRUE
  ORDER BY lp.valid_till DESC NULLS LAST
  LIMIT 1;
$$ LANGUAGE sql STABLE;
