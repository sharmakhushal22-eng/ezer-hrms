-- ============================================================
-- 021_ess.sql — ESS (Employee Self Service) module, Phase 1.
-- Access & roles tables + employee-portal tables + RLS + seed 19 roles.
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

-- ── ACCESS & ROLES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ess_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  auth_user_id UUID,
  status TEXT DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  first_login_at TIMESTAMPTZ, last_login_at TIMESTAMPTZ, login_count INTEGER DEFAULT 0,
  deactivated_at TIMESTAMPTZ, deactivated_by UUID, deactivation_reason TEXT,
  password_reset_allowed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id)
);
CREATE TABLE IF NOT EXISTS ess_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code TEXT UNIQUE NOT NULL, role_name TEXT NOT NULL,
  salary_visibility TEXT DEFAULT 'NONE' CHECK (salary_visibility IN ('NONE','OWN','TEAM','DEPT','BRANCH','ALL')),
  scope TEXT DEFAULT 'SELF' CHECK (scope IN ('SELF','TEAM','DEPT','BRANCH','ORG')),
  sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ess_account_id UUID NOT NULL REFERENCES ess_accounts(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES ess_roles(id),
  assigned_by UUID, assigned_at TIMESTAMPTZ DEFAULT now(), is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(ess_account_id, role_id)
);
CREATE TABLE IF NOT EXISTS ess_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ess_account_id UUID REFERENCES ess_accounts(id),
  action TEXT NOT NULL, performed_by UUID, performed_by_name TEXT, reason TEXT,
  details JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_login_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ess_account_id UUID REFERENCES ess_accounts(id),
  logged_in_at TIMESTAMPTZ DEFAULT now(),
  login_type TEXT DEFAULT 'EMPLOYEE' CHECK (login_type IN ('EMPLOYEE','ADMIN_IMPERSONATION')),
  ip_address TEXT, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS ess_impersonation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL, admin_name TEXT,
  employee_id UUID NOT NULL REFERENCES employees(id),
  started_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ,
  actions_taken JSONB DEFAULT '[]', ip_address TEXT
);

-- ── EMPLOYEE PORTAL ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ess_letter_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  letter_type TEXT NOT NULL, purpose TEXT, custom_details TEXT,
  status TEXT DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','GENERATED','REJECTED')),
  requested_at TIMESTAMPTZ DEFAULT now(), processed_by UUID, processed_at TIMESTAMPTZ,
  letter_url TEXT, rejection_reason TEXT
);
CREATE TABLE IF NOT EXISTS ess_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  request_type TEXT NOT NULL, request_data JSONB DEFAULT '{}',
  is_confidential BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_REVIEW','APPROVED','REJECTED','COMPLETED')),
  assigned_to TEXT, submitted_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ, resolution_note TEXT
);
CREATE TABLE IF NOT EXISTS ess_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  claim_type TEXT NOT NULL, amount NUMERIC DEFAULT 0, claim_date DATE, description TEXT,
  receipt_urls TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','PAID')),
  approved_by UUID, approved_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  category TEXT, title TEXT NOT NULL, body TEXT, link TEXT,
  is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID, holiday_date DATE NOT NULL, holiday_name TEXT NOT NULL,
  state TEXT, is_optional BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_contact_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID, category TEXT NOT NULL,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT, description TEXT, sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ess_kudos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_employee_id UUID NOT NULL REFERENCES employees(id),
  to_employee_id UUID NOT NULL REFERENCES employees(id),
  message TEXT, badge TEXT, points INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ess_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID, title TEXT NOT NULL, body TEXT, category TEXT,
  published_at TIMESTAMPTZ DEFAULT now(), published_by UUID, is_active BOOLEAN DEFAULT TRUE
);

-- ── RLS (project standard: permissive while auth is not yet wired) ──
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'ess_accounts','ess_roles','ess_user_roles','ess_access_audit','ess_login_log',
  'ess_impersonation_log','ess_letter_requests','ess_service_requests','ess_claims',
  'ess_notifications','ess_holidays','ess_contact_directory','ess_kudos','ess_announcements'
]) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ── SEED 19 ROLES ──────────────────────────────────────────────
INSERT INTO ess_roles (role_code, role_name, salary_visibility, scope, sort_order) VALUES
  ('EMPLOYEE','Employee','OWN','SELF',19),
  ('RECRUITER','Hiring Manager / Recruiter','NONE','TEAM',2),
  ('HR_MANAGER','HR Manager','ALL','ORG',3),
  ('HR_HEAD','HR Head','ALL','ORG',4),
  ('CHRO','CHRO','ALL','ORG',5),
  ('CFO','CFO','ALL','ORG',6),
  ('MD','MD','ALL','ORG',7),
  ('ADMIN_COMPANY','Admin (Company)','NONE','ORG',8),
  ('PAYROLL','Payroll','ALL','ORG',9),
  ('PAYROLL_ADMIN','Payroll Admin','ALL','ORG',10),
  ('L1_MANAGER','L1 Manager','TEAM','TEAM',11),
  ('L2_MANAGER','L2 Manager','TEAM','TEAM',12),
  ('HOD','HOD','DEPT','DEPT',13),
  ('IMPL_MANAGER','Implementation Manager','NONE','ORG',14),
  ('BRANCH_HR','Branch HR','BRANCH','BRANCH',15),
  ('BRANCH_EXEC','Branch Executive','NONE','BRANCH',16),
  ('IT','IT','NONE','ORG',17),
  ('ADMIN_SUPER','Admin (Super)','NONE','ORG',18)
ON CONFLICT (role_code) DO NOTHING;

notify pgrst, 'reload schema';
