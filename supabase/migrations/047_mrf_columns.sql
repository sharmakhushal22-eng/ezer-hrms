-- ═══════════════════════════════════════════════════════════════════
-- 047_mrf_columns.sql — MRF expansion, COLUMNS ONLY
--
-- This is the half of 032 the application actually needs. It is nothing but
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so there is no plpgsql, no seed
-- data and nothing that can fail on a permission or constraint.
--
-- HOW TO RUN
--   1. Open the SQL Editor.
--   2. Click into the editor and press Cmd+A to make sure NOTHING is selected
--      as a partial highlight — the editor runs only the highlighted text.
--   3. Paste this whole file over it, then press Run (Cmd+Enter).
--   4. The last statement returns one row per column with exists = true.
--
-- Run 048_mrf_lookups.sql afterwards for the Business Unit / Cost Center /
-- Currency dropdown values. The app works without it — those three selects
-- simply show "No options configured" until then.
-- ═══════════════════════════════════════════════════════════════════

-- §1 Requisition Meta
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS raised_by_name TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS raised_by_role TEXT;

-- §2 Position Details
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS job_title              TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS business_unit          TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS grade                  TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS job_code               TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS reporting_manager_id   UUID;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS reports_to_designation TEXT;

-- §3 Employment Details
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS work_mode      TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS shift_schedule TEXT;

-- §4 Budget & Cost
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS cost_center       TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS is_budgeted       BOOLEAN;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS headcount_ref     TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS currency          TEXT DEFAULT 'INR';
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS compensation_type TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS pay_period        TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS duration_months   INTEGER;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS duration_end      DATE;

-- §5 Justification
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS outgoing_employee_id   UUID;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS exit_reason            TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS business_justification TEXT;

-- §6 Timeline
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS target_joining_date DATE;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS validity_date       DATE;

-- §7 Candidate Requirements
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS good_to_have_skills TEXT;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS ctq_questions       JSONB DEFAULT '[]';

-- §8 Approval Workflow
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS approval_chain JSONB DEFAULT '[]';

-- §9 Sourcing
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS sourcing_channels JSONB DEFAULT '[]';
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS sourcing_mode     TEXT;

-- §10 Attachments
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- Existing rows keep working with sensible defaults.
UPDATE manpower_requisitions SET job_title = COALESCE(job_title, designation, position) WHERE job_title IS NULL;
UPDATE manpower_requisitions SET currency = 'INR'      WHERE currency IS NULL;
UPDATE manpower_requisitions SET work_mode = 'Onsite'  WHERE work_mode IS NULL;
UPDATE manpower_requisitions SET ctq_questions = '[]'     WHERE ctq_questions IS NULL;
UPDATE manpower_requisitions SET approval_chain = '[]'    WHERE approval_chain IS NULL;
UPDATE manpower_requisitions SET sourcing_channels = '[]' WHERE sourcing_channels IS NULL;
UPDATE manpower_requisitions SET attachments = '[]'       WHERE attachments IS NULL;

UPDATE manpower_requisitions SET
  compensation_type = CASE
    WHEN employment_type IN ('Intern','NAPS','NATS','Live Project') THEN 'STIPEND'
    WHEN employment_type IN ('Contract','Consultant')               THEN 'FEES'
    ELSE 'SALARY' END,
  pay_period = CASE
    WHEN employment_type IN ('Intern','NAPS','NATS','Live Project','Contract','Consultant')
      THEN 'MONTHLY' ELSE 'ANNUAL' END
WHERE compensation_type IS NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFY — every row must show exists = true.
SELECT c AS column_name,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'manpower_requisitions' AND column_name = c) AS exists
FROM unnest(ARRAY[
  'raised_by_name','raised_by_role','job_title','business_unit','grade','job_code',
  'reporting_manager_id','reports_to_designation','work_mode','shift_schedule',
  'cost_center','is_budgeted','headcount_ref','currency','compensation_type','pay_period',
  'duration_months','duration_end','outgoing_employee_id','exit_reason',
  'business_justification','target_joining_date','validity_date','good_to_have_skills',
  'ctq_questions','approval_chain','sourcing_channels','sourcing_mode','attachments'
]) AS c
ORDER BY 2, 1;
