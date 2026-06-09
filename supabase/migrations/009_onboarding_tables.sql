-- ================================================================
-- EZER HRMS — Onboarding Module Tables
-- Run in Supabase SQL Editor
-- ================================================================

-- 1. Onboarding checklists (IT + Admin tasks per joiner)
CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID REFERENCES candidates(id),
  company_id            UUID,
  doj                   DATE,
  -- IT Team
  it_laptop             BOOLEAN DEFAULT false,
  it_email_created      BOOLEAN DEFAULT false,
  it_erp_access         BOOLEAN DEFAULT false,
  it_sim_issued         BOOLEAN DEFAULT false,
  it_tools_access       BOOLEAN DEFAULT false,
  it_asset_registered   BOOLEAN DEFAULT false,
  it_notes              TEXT,
  it_completed_at       TIMESTAMPTZ,
  -- Admin Team
  admin_desk_allotted   BOOLEAN DEFAULT false,
  admin_id_card         BOOLEAN DEFAULT false,
  admin_access_card     BOOLEAN DEFAULT false,
  admin_parking_sticker BOOLEAN DEFAULT false,
  admin_canteen_card    BOOLEAN DEFAULT false,
  admin_joining_kit     BOOLEAN DEFAULT false,
  admin_notes           TEXT,
  admin_completed_at    TIMESTAMPTZ,
  -- Meta
  alert_sent_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 2. Joining formalities tokens (link sent to employee)
CREATE TABLE IF NOT EXISTS joining_formalities_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  company_id   UUID,
  token        TEXT UNIQUE DEFAULT encode(gen_random_bytes(20), 'hex'),
  status       TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','OPENED','SUBMITTED','EXPIRED')),
  sent_at      TIMESTAMPTZ,
  opened_at    TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 3. Employee joining forms (data submitted by employee)
CREATE TABLE IF NOT EXISTS employee_joining_forms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id       UUID REFERENCES joining_formalities_tokens(id),
  candidate_id   UUID REFERENCES candidates(id),
  company_id     UUID,
  -- Personal
  full_name      TEXT,
  dob            DATE,
  father_name    TEXT,
  spouse_name    TEXT,
  gender         TEXT,
  blood_group    TEXT,
  marital_status TEXT,
  mobile         TEXT,
  personal_email TEXT,
  aadhaar_number TEXT,
  pan_number     TEXT,
  nationality    TEXT DEFAULT 'Indian',
  photo_url      TEXT,
  -- Address
  perm_address   JSONB,
  curr_address   JSONB,
  same_address   BOOLEAN DEFAULT false,
  emergency_1    JSONB,
  emergency_2    JSONB,
  -- Professional
  designation    TEXT,
  doj            DATE,
  highest_qual   TEXT,
  prev_employer  TEXT,
  prev_uan       TEXT,
  prev_pf_id     TEXT,
  pf_transfer    BOOLEAN DEFAULT false,
  -- Bank (store masked)
  bank_account   TEXT,
  bank_ifsc      TEXT,
  bank_name      TEXT,
  bank_branch    TEXT,
  account_type   TEXT DEFAULT 'Savings',
  account_holder TEXT,
  -- References
  reference_1    JSONB,
  reference_2    JSONB,
  -- Docs status
  photo_uploaded     BOOLEAN DEFAULT false,
  uan_card_uploaded  BOOLEAN DEFAULT false,
  esic_card_uploaded BOOLEAN DEFAULT false,
  -- Meta
  ai_prefill_data    JSONB,
  form_status    TEXT DEFAULT 'DRAFT'
    CHECK (form_status IN ('DRAFT','SUBMITTED')),
  submitted_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 4. Policy acceptance records
CREATE TABLE IF NOT EXISTS policy_acceptance_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID REFERENCES candidates(id),
  company_id     UUID,
  policy_name    TEXT NOT NULL,
  policy_version TEXT DEFAULT 'v1.0',
  accepted_at    TIMESTAMPTZ DEFAULT now(),
  ip_address     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 5. Employee codes
CREATE TABLE IF NOT EXISTS employee_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID REFERENCES candidates(id),
  company_id     UUID,
  employee_code  TEXT UNIQUE NOT NULL,
  company_doj    DATE,
  group_doj      DATE,
  generated_by   UUID,
  generated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jft_token ON joining_formalities_tokens(token);
CREATE INDEX IF NOT EXISTS idx_jft_candidate ON joining_formalities_tokens(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ejf_token ON employee_joining_forms(token_id);
CREATE INDEX IF NOT EXISTS idx_ec_code ON employee_codes(employee_code);

SELECT 'Onboarding tables created' as status;
