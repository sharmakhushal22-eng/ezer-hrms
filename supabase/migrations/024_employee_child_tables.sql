-- ============================================================
-- 024_employee_child_tables.sql
-- Onboarding → Employee Master, follow-up:
--   • employee_education / employee_family / employee_experience (the "separate
--     tables" decision for highest_qual / spouse / prev_employer)
--   • employees.is_test flag + backfill (dummy rows kept, not deleted)
--   • onboarding_candidates.department_id (so the bridge gets a reliable FK,
--     not a fragile text match — feeds the masters-dropdown decision)
-- Idempotent. HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  qualification TEXT, institute TEXT, year_of_passing TEXT, doc_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_family (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  relation TEXT, name TEXT, date_of_birth DATE,
  residing_with_emp BOOLEAN DEFAULT false, is_dependent BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company TEXT, designation TEXT, from_date DATE, to_date DATE,
  reason_for_change TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
create index if not exists idx_emp_edu_emp on employee_education(employee_id);
create index if not exists idx_emp_fam_emp on employee_family(employee_id);
create index if not exists idx_emp_exp_emp on employee_experience(employee_id);

-- Dummy-data flag (non-destructive). Defaults to false; flag specific dummy
-- rows manually (e.g. by emp_code) — do NOT auto-flag by date, it wrongly
-- caught real pre-launch employees and hid them from the dashboard/master.
alter table public.employees add column if not exists is_test boolean default false;

-- Reliable department FK on the onboarding candidate (text lookup is fragile).
alter table public.onboarding_candidates add column if not exists department_id uuid;

-- RLS (permissive, project standard).
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['employee_education','employee_family','employee_experience']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

notify pgrst, 'reload schema';
