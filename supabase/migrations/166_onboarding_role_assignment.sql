-- 166_onboarding_role_assignment.sql — the revamped code-generation flow (16-Oct-2026).
-- SAFE TO RUN TWICE.
--
-- After the HR Manager accepts the onboarding form, the IT, Admin and Payroll heads each
-- confirm a checklist (laptop / email / ID card / salary structure …) with their approval;
-- then the HR Manager assigns the reporting line and the ESS role (Role assignment on the
-- onboarding card), and only then generates the employee code.
--
--   onboarding_approvals.checklist     what the team confirmed, as the form sent it
--   onboarding_candidates.role_assignment
--       { role_id, role_code, role_name, permissions:[{module, access_level}],
--         l1_manager_id, l2_manager_id, hod_id, by, by_name, at }
--       The managers also land in the existing l1_manager_id / l2_manager_id / hod_id columns.

ALTER TABLE onboarding_approvals  ADD COLUMN IF NOT EXISTS checklist       JSONB;
ALTER TABLE onboarding_candidates ADD COLUMN IF NOT EXISTS role_assignment JSONB;
