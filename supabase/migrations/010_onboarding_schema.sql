-- ================================================================
-- EZER HRMS — Complete Onboarding Schema
-- Run in Supabase SQL Editor
-- All tables use service_role access (via API routes)
-- ================================================================

-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. onboarding_candidates (master record) ────────────────────
CREATE TABLE IF NOT EXISTS onboarding_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Link to recruitment
  candidate_id          UUID,
  offer_letter_id       UUID,
  company_id            UUID NOT NULL,
  location_id           UUID,
  -- Position
  designation           TEXT,
  department            TEXT,
  employment_type       TEXT DEFAULT 'Employee',
  grade                 TEXT,
  reporting_manager_id  UUID,
  -- Personal (from offer)
  full_name             TEXT NOT NULL,
  email                 TEXT,
  mobile                TEXT,
  date_of_joining       DATE,
  offered_ctc           NUMERIC(12,2),
  -- Magic link
  magic_link_token      TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),
  token_used_at         TIMESTAMPTZ,
  -- OTP
  otp_code              TEXT,
  otp_expires_at        TIMESTAMPTZ,
  otp_verified          BOOLEAN DEFAULT false,
  -- Progress
  current_step          INTEGER DEFAULT 1,
  form_data             JSONB DEFAULT '{}',
  -- Status
  status                TEXT DEFAULT 'INVITED'
    CHECK (status IN ('INVITED','IN_PROGRESS','SUBMITTED','HR_REVIEW','APPROVED','REJECTED','EMPLOYEE_CREATED')),
  submitted_at          TIMESTAMPTZ,
  hr_reviewed_at        TIMESTAMPTZ,
  hr_reviewed_by        UUID,
  hr_notes              TEXT,
  -- Employee output
  employee_id           UUID,
  employee_code         TEXT UNIQUE,
  -- Meta
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ── 2. onboarding_document_types ────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_document_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID,
  doc_code      TEXT NOT NULL,
  doc_name      TEXT NOT NULL,
  is_mandatory  BOOLEAN DEFAULT true,
  ai_verify     BOOLEAN DEFAULT true,
  ai_fields     TEXT[] DEFAULT '{}',
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, doc_code)
);

-- Insert default document types
INSERT INTO onboarding_document_types (company_id, doc_code, doc_name, is_mandatory, ai_verify, ai_fields, display_order) VALUES
  (NULL, 'AADHAAR_FRONT', 'Aadhaar Card (Front)', true, true, ARRAY['name','dob','gender','aadhaar_number','address'], 1),
  (NULL, 'AADHAAR_BACK',  'Aadhaar Card (Back)',  true, true, ARRAY['address','pin_code'], 2),
  (NULL, 'PAN',           'PAN Card',             true, true, ARRAY['name','pan_number','dob','father_name'], 3),
  (NULL, 'PHOTO',         'Passport Size Photo',  true, false, ARRAY[]::TEXT[], 4),
  (NULL, 'DEGREE',        'Highest Degree Certificate', true, true, ARRAY['name','degree','institution','year'], 5),
  (NULL, 'EXP_LETTER',    'Experience / Relieving Letter', false, true, ARRAY['name','company','designation','last_date'], 6),
  (NULL, 'BANK_PROOF',    'Cancelled Cheque / Bank Passbook', true, true, ARRAY['account_number','ifsc','bank_name','account_holder'], 7),
  (NULL, 'UAN_CARD',      'UAN Card (if existing PF)', false, true, ARRAY['uan','name'], 8)
ON CONFLICT DO NOTHING;

-- ── 3. onboarding_documents ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id       UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  doc_type_id         UUID REFERENCES onboarding_document_types(id),
  doc_code            TEXT NOT NULL,
  -- Storage
  storage_path        TEXT,
  file_name           TEXT,
  file_size           INTEGER,
  mime_type           TEXT,
  -- AI verification
  ai_verified         BOOLEAN DEFAULT false,
  ai_status           TEXT DEFAULT 'PENDING'
    CHECK (ai_status IN ('PENDING','PROCESSING','VERIFIED','FAILED','MISMATCH')),
  ai_extracted_data   JSONB DEFAULT '{}',
  ai_confidence       NUMERIC(5,2),
  ai_flags            TEXT[] DEFAULT '{}',
  ai_processed_at     TIMESTAMPTZ,
  -- HR review
  hr_verified         BOOLEAN,
  hr_notes            TEXT,
  -- Meta
  uploaded_at         TIMESTAMPTZ DEFAULT now()
);

-- ── 4. onboarding_statutory_forms ───────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_statutory_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  form_type       TEXT NOT NULL
    CHECK (form_type IN ('EPF_FORM11','EPF_FORM2','ESIC_FORM1','GRATUITY_FORM_F','BANK_MANDATE','FORM_12B')),
  form_data       JSONB NOT NULL DEFAULT '{}',
  is_applicable   BOOLEAN DEFAULT true,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(onboarding_id, form_type)
);

-- ── 5. onboarding_checklists (templates) ────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  name          TEXT NOT NULL,
  department    TEXT,
  employment_type TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id    UUID REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
  item_name       TEXT NOT NULL,
  description     TEXT,
  assigned_to     TEXT DEFAULT 'HR',
  due_days        INTEGER DEFAULT 0,
  is_mandatory    BOOLEAN DEFAULT true,
  display_order   INTEGER DEFAULT 0
);

-- ── 6. employee_onboarding_progress ─────────────────────────────
CREATE TABLE IF NOT EXISTS employee_onboarding_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES onboarding_checklist_items(id),
  task_name       TEXT NOT NULL,
  assigned_to     TEXT DEFAULT 'HR',
  status          TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED','BLOCKED')),
  due_date        DATE,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 7. onboarding_bgv ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_bgv (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  check_type      TEXT NOT NULL
    CHECK (check_type IN ('EDUCATION','EMPLOYMENT','ADDRESS','CRIMINAL','REFERENCE','CREDIT')),
  vendor_name     TEXT,
  status          TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','CLEAR','DISCREPANCY','UNABLE_TO_VERIFY')),
  initiated_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  report_url      TEXT,
  ai_summary      TEXT,
  flags           TEXT[] DEFAULT '{}',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 8. onboarding_statutory_enrollment ──────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_statutory_enrollment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  employee_id     UUID,
  -- PF
  pf_applicable   BOOLEAN DEFAULT false,
  uan_number      TEXT,
  pf_member_id    TEXT,
  pf_join_date    DATE,
  pf_opted_out    BOOLEAN DEFAULT false,
  -- ESI
  esi_applicable  BOOLEAN DEFAULT false,
  esi_ip_number   TEXT,
  esi_join_date   DATE,
  -- PT
  pt_applicable   BOOLEAN DEFAULT false,
  pt_state        TEXT,
  -- Gratuity
  gratuity_applicable BOOLEAN DEFAULT true,
  gratuity_start_date DATE,
  -- Status
  enrolled_at     TIMESTAMPTZ,
  enrolled_by     UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 9. onboarding_probation_reviews ─────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_probation_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  employee_id     UUID,
  review_type     TEXT CHECK (review_type IN ('45_DAY','90_DAY','EXTENSION','CONFIRMATION')),
  review_date     DATE,
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  outcome         TEXT CHECK (outcome IN ('CONFIRMED','EXTENDED','TERMINATED','PENDING')),
  reviewer_id     UUID,
  comments        TEXT,
  letter_generated BOOLEAN DEFAULT false,
  letter_path     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 10. onboarding_asset_requests ───────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_asset_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  asset_type      TEXT NOT NULL,
  description     TEXT,
  requested_by    UUID,
  assigned_to     TEXT DEFAULT 'IT',
  status          TEXT DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','APPROVED','ISSUED','RETURNED')),
  issued_at       TIMESTAMPTZ,
  asset_serial    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 11. onboarding_notifications ────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  recipient_type  TEXT CHECK (recipient_type IN ('CANDIDATE','HR','IT','ADMIN','MANAGER')),
  recipient_id    UUID,
  channel         TEXT DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','SMS','WHATSAPP','IN_APP')),
  subject         TEXT,
  body            TEXT,
  status          TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','READ')),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 12. onboarding_audit_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  actor_type      TEXT CHECK (actor_type IN ('CANDIDATE','HR','SYSTEM','AI')),
  actor_id        UUID,
  details         JSONB DEFAULT '{}',
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 13. onboarding_buddies ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_buddies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  buddy_employee_id UUID,
  buddy_name    TEXT,
  buddy_email   TEXT,
  buddy_mobile  TEXT,
  assigned_at   TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 14. onboarding_goals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  goal_title      TEXT NOT NULL,
  description     TEXT,
  target_date     DATE,
  status          TEXT DEFAULT 'PENDING',
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 15. onboarding_training_plans ───────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_training_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_candidates(id) ON DELETE CASCADE,
  training_name   TEXT NOT NULL,
  trainer         TEXT,
  scheduled_date  DATE,
  duration_hours  NUMERIC(5,1),
  status          TEXT DEFAULT 'SCHEDULED',
  completion_date DATE,
  certificate_url TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oc_token    ON onboarding_candidates(magic_link_token);
CREATE INDEX IF NOT EXISTS idx_oc_company  ON onboarding_candidates(company_id);
CREATE INDEX IF NOT EXISTS idx_oc_status   ON onboarding_candidates(status);
CREATE INDEX IF NOT EXISTS idx_oc_email    ON onboarding_candidates(email);
CREATE INDEX IF NOT EXISTS idx_od_onb      ON onboarding_documents(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_oal_onb     ON onboarding_audit_log(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_osf_onb     ON onboarding_statutory_forms(onboarding_id);

-- ── RLS: ALL tables — service_role only (API routes bypass RLS) ──
ALTER TABLE onboarding_candidates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_document_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_statutory_forms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_checklists          ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_checklist_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_onboarding_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_bgv                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_statutory_enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_probation_reviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_asset_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_buddies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_goals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_training_plans      ENABLE ROW LEVEL SECURITY;

-- Allow authenticated HR users to read their company's onboarding data
DROP POLICY IF EXISTS "hr_read_onboarding" ON onboarding_candidates;
CREATE POLICY "hr_read_onboarding" ON onboarding_candidates
  FOR SELECT TO authenticated
  USING (true);

-- All writes go through service_role (API routes)
-- No direct INSERT/UPDATE/DELETE from client

-- Allow public read of document types
DROP POLICY IF EXISTS "public_read_doc_types" ON onboarding_document_types;
CREATE POLICY "public_read_doc_types" ON onboarding_document_types
  FOR SELECT TO anon, authenticated
  USING (true);

-- ── Trigger: updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oc_updated_at ON onboarding_candidates;
CREATE TRIGGER trg_oc_updated_at
  BEFORE UPDATE ON onboarding_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_osf_updated_at ON onboarding_statutory_forms;
CREATE TRIGGER trg_osf_updated_at
  BEFORE UPDATE ON onboarding_statutory_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Storage bucket for onboarding docs ──────────────────────────
-- Run this separately in Supabase Dashboard > Storage:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('onboarding-docs', 'onboarding-docs', false);

SELECT 'Onboarding schema created successfully' AS status;

-- ============================================================
-- Permissive anon/authenticated policies so the HR dashboard
-- (which uses the anon key) can read/write these tables.
-- Functionality-first stopgap — same approach as 0002. The
-- service-role API routes bypass RLS regardless of this.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'onboarding_candidates','onboarding_document_types','onboarding_documents',
    'onboarding_statutory_forms','onboarding_checklists','onboarding_checklist_items',
    'employee_onboarding_progress','onboarding_bgv','onboarding_statutory_enrollment',
    'onboarding_probation_reviews','onboarding_asset_requests','onboarding_notifications',
    'onboarding_audit_log','onboarding_buddies','onboarding_goals','onboarding_training_plans'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_anon_all', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true);', t||'_anon_all', t);
  end loop;
end $$;
