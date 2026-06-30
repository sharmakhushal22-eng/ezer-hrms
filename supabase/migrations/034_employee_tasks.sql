-- ============================================================
-- 034_employee_tasks.sql — EZER HRMS · Employee post-add tasks
-- Tasks assigned to an employee after direct add / bulk upload, e.g.
-- "Read & acknowledge company policies" (POLICY_ACK). Drives the ESS task list.
--
-- NOTE: spec called this "027" but 027 is taken → renumbered 034.
-- Additive & idempotent. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_type        TEXT NOT NULL,        -- POLICY_ACK | PROFILE_UPDATE | DOCUMENT_UPLOAD | BANK_UPDATE
  task_title       TEXT NOT NULL,
  task_description TEXT,
  status           TEXT DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED | SKIPPED
  due_date         DATE,
  completed_at     TIMESTAMPTZ,
  meta             JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_tasks_emp ON employee_tasks(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_emp_tasks_co  ON employee_tasks(company_id, task_type, status);

ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_employee_tasks" ON employee_tasks;
CREATE POLICY "allow_all_employee_tasks" ON employee_tasks
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
