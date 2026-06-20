-- ============================================================
-- 028_role_permissions.sql — EZER HRMS · Roles & Permissions
-- role_permissions (module access per role) + role_approval_rights
-- (which roles can approve/reject/initiate which workflows) + seed.
--
-- NOTE: spec called this "024" but 024_employee_child_tables.sql already
--       exists, so this is renumbered to 028 (025/026/027 also taken).
-- Depends on existing ess_roles (migration 021). Idempotent — safe to re-run.
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id      UUID NOT NULL REFERENCES ess_roles(id) ON DELETE CASCADE,
  module       TEXT NOT NULL,
  access_level TEXT DEFAULT 'NONE'
    CHECK (access_level IN ('NONE','VIEW','EDIT','FULL')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(role_id, module)
);

CREATE TABLE IF NOT EXISTS role_approval_rights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       UUID NOT NULL REFERENCES ess_roles(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL,
  can_approve   BOOLEAN DEFAULT TRUE,
  can_reject    BOOLEAN DEFAULT TRUE,
  can_initiate  BOOLEAN DEFAULT FALSE,
  priority      INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(role_id, approval_type)
);

CREATE INDEX IF NOT EXISTS idx_role_perm_role   ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_approv_role ON role_approval_rights(role_id);

-- ── RLS (project standard permissive — anon + authenticated) ─────────
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['role_permissions','role_approval_rights']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ── Seed default approval rights (per spec section 4) ────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, role_code FROM ess_roles LOOP

    IF r.role_code IN ('L1_MANAGER','L2_MANAGER','HR_MANAGER','HR_HEAD','HOD','BRANCH_HR') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'LEAVE_APPLY',true,true,false,1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('L1_MANAGER','HR_MANAGER','PAYROLL','PAYROLL_ADMIN') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'EXPENSE_CLAIM',true,true,false,1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HOD','HR_HEAD','CHRO','MD','HR_MANAGER') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'HIRING_MRF',true,true,r.role_code IN ('HOD','HR_HEAD','MD'),1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','CHRO','MD','RECRUITER') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'OFFER_LETTER',true,true,r.role_code IN ('HR_MANAGER','RECRUITER'),1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','CHRO','CFO','MD') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'SALARY_REVISION',true,true,r.role_code IN ('HR_MANAGER','HR_HEAD'),1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','CHRO') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'RESIGNATION',true,true,true,1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','ADMIN_COMPANY','ADMIN_SUPER') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'PROFILE_UPDATE',true,true,false,1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','CHRO','L1_MANAGER','L2_MANAGER','HOD') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'PIP',true,true,r.role_code IN ('HR_MANAGER','L1_MANAGER','HOD'),1) ON CONFLICT DO NOTHING;
    END IF;

    IF r.role_code IN ('HR_MANAGER','HR_HEAD','CFO','MD') THEN
      INSERT INTO role_approval_rights (role_id,approval_type,can_approve,can_reject,can_initiate,priority)
      VALUES (r.id,'LOAN',true,true,false,1) ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;
END $$;

notify pgrst, 'reload schema';
