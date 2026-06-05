-- ============================================================
-- EZER HRMS — Offer Flow Tables v2.0
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Document Collection Links (24hr validity)
CREATE TABLE IF NOT EXISTS document_collection_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  mrf_id        UUID REFERENCES manpower_requisitions(id),
  company_id    UUID REFERENCES companies(id),
  link_token    TEXT UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  status        TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','SUBMITTED')),
  sent_at       TIMESTAMPTZ DEFAULT now(),
  opened_at     TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  created_by    TEXT, -- recruiter email
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Candidate Documents Uploaded
CREATE TABLE IF NOT EXISTS candidate_documents_uploaded (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id       UUID NOT NULL REFERENCES document_collection_links(id),
  candidate_id  UUID NOT NULL REFERENCES candidates(id),
  company_id    UUID REFERENCES companies(id),
  doc_type      TEXT NOT NULL CHECK (doc_type IN (
    '10TH_MARKSHEET','12TH_MARKSHEET','GRADUATION','MASTERS',
    'APPOINTMENT_LETTER','OFFER_LETTER','APPRAISAL_LETTER',
    'SALARY_SLIP_1','SALARY_SLIP_2','SALARY_SLIP_3',
    'BANK_PROOF','ADDITIONAL_1','ADDITIONAL_2','ADDITIONAL_3'
  )),
  doc_label     TEXT, -- display name
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_size     INTEGER, -- bytes
  file_type     TEXT, -- pdf/jpg/png
  is_mandatory  BOOLEAN DEFAULT TRUE,
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

-- 3. Offer Approval Requests (Recruiter → HR Head → HR Manager)
CREATE TABLE IF NOT EXISTS offer_approval_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES candidates(id),
  mrf_id                UUID REFERENCES manpower_requisitions(id),
  company_id            UUID REFERENCES companies(id),
  ctc_negotiation_id    UUID REFERENCES ctc_negotiations(id),

  -- Previous Employer Details (recruiter fills, NOT shown to candidate)
  prev_company_name     TEXT,
  prev_company_address  TEXT,
  prev_total_ctc        BIGINT, -- annual
  prev_fixed_ctc        BIGINT,
  prev_variable         BIGINT,
  prev_ta_da            BIGINT, -- monthly
  prev_additional       TEXT,   -- description of any extra pay

  -- Offered Compensation (from CTC calculator)
  offered_ctc           BIGINT,
  offered_fixed         BIGINT,
  offered_variable      BIGINT,
  offered_variable_pct  NUMERIC(5,2),
  monthly_gross         BIGINT,
  monthly_inhand        BIGINT,
  joining_bonus         BIGINT,
  joining_bonus_freq    TEXT,
  retention_bonus       BIGINT,
  retention_bonus_freq  TEXT,
  esop_value            BIGINT,
  esop_vesting          TEXT,
  hike_pct              NUMERIC(5,2),

  -- Joining Details
  proposed_doj          DATE,
  days_to_join          INTEGER, -- calculated: DOJ - today
  notice_period_days    INTEGER,
  notice_buyout         BOOLEAN DEFAULT FALSE,

  -- Documents
  documents_count       INTEGER DEFAULT 0,
  bgv_status            TEXT DEFAULT 'PENDING',

  -- Full template (AI generated, editable)
  template_content      TEXT,

  -- Approval Chain
  status                TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','HR_HEAD_APPROVED','HR_HEAD_REJECTED','OFFER_SENT')),
  submitted_by          TEXT, -- recruiter email
  submitted_at          TIMESTAMPTZ,
  recruiter_comments    TEXT,

  -- HR Head
  hr_head_email         TEXT,
  hr_head_action        TEXT CHECK (hr_head_action IN ('APPROVED','REJECTED')),
  hr_head_comments      TEXT,
  hr_head_actioned_at   TIMESTAMPTZ,

  -- HR Manager
  hr_manager_email      TEXT,
  hr_manager_accepted_at TIMESTAMPTZ,
  offer_sent_at         TIMESTAMPTZ,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 4. Offer Acceptances
CREATE TABLE IF NOT EXISTS offer_acceptances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID NOT NULL REFERENCES candidates(id),
  offer_letter_id   UUID REFERENCES offer_letters(id),
  approval_request_id UUID REFERENCES offer_approval_requests(id),
  company_id        UUID REFERENCES companies(id),
  acceptance_type   TEXT CHECK (acceptance_type IN ('DIGITAL','UPLOAD')),
  -- Digital
  aadhaar_last4     TEXT,
  -- Upload
  signed_file_url   TEXT,
  signed_file_name  TEXT,
  -- Common
  accepted_at       TIMESTAMPTZ DEFAULT now(),
  ip_address        TEXT,
  user_agent        TEXT,
  status            TEXT DEFAULT 'ACCEPTED'
);

-- 5. Recruitment Audit Logs
CREATE TABLE IF NOT EXISTS recruitment_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES candidates(id),
  mrf_id        UUID REFERENCES manpower_requisitions(id),
  company_id    UUID REFERENCES companies(id),
  action_type   TEXT NOT NULL,
  actor_email   TEXT,
  actor_role    TEXT,
  details       JSONB DEFAULT '{}',
  ip_address    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Add prev employer fields to ctc_negotiations
ALTER TABLE ctc_negotiations
  ADD COLUMN IF NOT EXISTS prev_company_name    TEXT,
  ADD COLUMN IF NOT EXISTS prev_company_address TEXT,
  ADD COLUMN IF NOT EXISTS prev_total_ctc       BIGINT,
  ADD COLUMN IF NOT EXISTS prev_fixed_ctc       BIGINT,
  ADD COLUMN IF NOT EXISTS prev_variable        BIGINT,
  ADD COLUMN IF NOT EXISTS prev_ta_da           BIGINT,
  ADD COLUMN IF NOT EXISTS prev_additional      TEXT,
  ADD COLUMN IF NOT EXISTS proposed_doj         DATE,
  ADD COLUMN IF NOT EXISTS notice_period_days   INTEGER;

-- Add candidate salary acceptance field
ALTER TABLE ctc_negotiations
  ADD COLUMN IF NOT EXISTS candidate_interested  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS candidate_comment     TEXT,
  ADD COLUMN IF NOT EXISTS candidate_responded_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_doc_links_token ON document_collection_links(link_token);
CREATE INDEX IF NOT EXISTS idx_doc_links_candidate ON document_collection_links(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_approval_candidate ON offer_approval_requests(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_approval_status ON offer_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_audit_candidate ON recruitment_audit_logs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON recruitment_audit_logs(action_type);

-- Auto-expire document links (optional scheduled function)
-- CREATE OR REPLACE FUNCTION expire_doc_links() RETURNS void AS $$
--   UPDATE document_collection_links
--   SET status = 'EXPIRED'
--   WHERE status = 'ACTIVE' AND expires_at < now();
-- $$ LANGUAGE sql;
