-- ============================================================
-- 033_policy_ack.sql — EZER HRMS · Config-driven Policy ACK module
-- company_policies (per-company configurable policies) + onboarding_policy_acks
-- (per-candidate acknowledgements) + onboarding_esign_records, plus onboarding_candidates
-- completion flags. Seeds 4 default policies for every existing company.
--
-- NOTE: spec called this "026" but 026/031/032 are taken → renumbered 033.
-- Additive & idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → Run.
-- ============================================================

-- Table 1: company policies (config-driven, per company)
CREATE TABLE IF NOT EXISTS company_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  policy_code   TEXT NOT NULL,
  policy_title  TEXT NOT NULL,
  policy_body   TEXT NOT NULL DEFAULT '',
  is_mandatory  BOOLEAN DEFAULT TRUE,
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  version       TEXT DEFAULT '1.0',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, policy_code)
);

-- Table 2: per-candidate policy acknowledgements
CREATE TABLE IF NOT EXISTS onboarding_policy_acks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id    UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  policy_id        UUID NOT NULL REFERENCES company_policies(id),
  policy_code      TEXT NOT NULL,
  policy_title     TEXT NOT NULL,
  policy_version   TEXT NOT NULL DEFAULT '1.0',
  acknowledged_at  TIMESTAMPTZ,
  scroll_completed BOOLEAN DEFAULT FALSE,
  ack_order        INTEGER,
  UNIQUE(onboarding_id, policy_id)
);

-- Table 3: eSign records
CREATE TABLE IF NOT EXISTS onboarding_esign_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id    UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  aadhaar_last4    TEXT,
  otp_verified_at  TIMESTAMPTZ,
  signed_bundle    TEXT[] DEFAULT '{}',
  esign_hash       TEXT,
  ack_pdf_path     TEXT,
  hr_notified_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Extend onboarding_candidates (completion flags)
ALTER TABLE onboarding_candidates
  ADD COLUMN IF NOT EXISTS policies_ack_complete BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS esign_complete         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS esign_completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_pdf_path           TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_company_policies_co ON company_policies(company_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_policy_acks_onb     ON onboarding_policy_acks(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_esign_onb           ON onboarding_esign_records(onboarding_id);

-- RLS (project standard permissive)
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['company_policies','onboarding_policy_acks','onboarding_esign_records']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- Seed 4 default policies for every existing company (placeholder bodies — edit in Admin)
INSERT INTO company_policies (company_id, policy_code, policy_title, policy_body, is_mandatory, sort_order, is_active)
SELECT c.id, p.policy_code, p.policy_title, p.policy_body, TRUE, p.sort_order, TRUE
FROM companies c
CROSS JOIN (VALUES
  ('HR-POL-001', 'Prevention of Sexual Harassment (PoSH) Policy', '1. PURPOSE\nThe company is committed to a safe, secure and dignified work environment. [Edit this text in Admin → Company Policies.]', 1),
  ('HR-POL-002', 'Leave & Attendance Policy', '1. PURPOSE\nThis policy governs leave entitlement and attendance. [Edit this text in Admin → Company Policies.]', 2),
  ('HR-POL-003', 'Code of Conduct', '1. INTRODUCTION\nThe company conducts business with integrity. [Edit this text in Admin → Company Policies.]', 3),
  ('HR-POL-004', 'IT & Data Security Policy', '1. PURPOSE\nStandards for secure and appropriate use of IT resources. [Edit this text in Admin → Company Policies.]', 4)
) AS p(policy_code, policy_title, policy_body, sort_order)
ON CONFLICT (company_id, policy_code) DO NOTHING;

notify pgrst, 'reload schema';
