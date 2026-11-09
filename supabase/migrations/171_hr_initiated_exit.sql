-- =====================================================================
-- 171_hr_initiated_exit.sql — exit reasons for an exit HR processes
--
-- ESS → HR Services → Exit now lets the HR roles (Hiring Manager / Recruiter,
-- HR Executive, Branch HR, HR Manager, HR Head, CHRO) exit an employee
-- (app/api/ess/exit-employee). The reasons in 071 are all an employee's own
-- reasons for resigning (PUSH / PULL / PERSONAL); an exit the company
-- initiates needs its own. A new category, EMPLOYER, and seven reasons.
--
-- Safe to run twice. Without it the screen still works with the 071 reasons
-- (HR recording a resignation on the employee's behalf).
-- =====================================================================

ALTER TABLE exit_reason_master DROP CONSTRAINT IF EXISTS exit_reason_master_category_check;
ALTER TABLE exit_reason_master
  ADD CONSTRAINT exit_reason_master_category_check CHECK (category IN ('PUSH','PULL','PERSONAL','EMPLOYER'));

INSERT INTO exit_reason_master (code, category, label, sort_order) VALUES
  ('TERMINATION',     'EMPLOYER', 'Termination by the company',          200),
  ('ABSCONDING',      'EMPLOYER', 'Absconding',                          210),
  ('CONTRACT_END',    'EMPLOYER', 'End of contract / internship',        220),
  ('PROBATION_NOT_CONFIRMED', 'EMPLOYER', 'Not confirmed after probation', 230),
  ('MUTUAL_SEPARATION','EMPLOYER', 'Mutual separation',                  240),
  ('RETIREMENT',      'EMPLOYER', 'Retirement',                          250),
  ('DEATH_IN_SERVICE','EMPLOYER', 'Death in service',                    260)
ON CONFLICT (code) DO NOTHING;
