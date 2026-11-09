# Records created on the live (test-data) DB during mobile testing — 19 Oct 2026

| # | Module | Table / id | What | State now |
|---|---|---|---|---|
| 1 | Leave | leave_applications 9458bae1-d6e6-454b-bb47-b22d916e2b9e | Rohan SRS9042, EL 25 Nov 2026, reason "CLAUDE TEST" | DELETED 30 Oct, with its 3 ess_notifications rows (the mail to Shreya cannot be recalled) |
| 2 | Home | attendance_punches (Kiran SRS9047, 358c74fb-…) 2026-10-19 | IN 03:39:55Z, OUT 03:40:00Z, source ESS_APP | DELETED 30 Oct, with the derived attendance_records row (a5f28c3a…), so Kiran's false 19 Oct "Late" is gone |
| 3 | Home | ess_user_preferences (Kiran) | written by PUTs | restored to {light,24,long} (again on 30 Oct; Rohan's and Shreya's prior themes were not recorded, left on auto) |
| 4 | HR Services | ess_service_requests 6cb8bc61-769a-4edc-a556-432e896ea174 | Rohan SRS9042, type LOAN, details "CLAUDE TEST — mobile app parity check, please ignore" | DELETED 30 Oct |
| 5 | Profile (30 Oct) | employees SRS9042 `aadhar_last4` | accidental save of '0124' while testing validation | REVERTED to NULL (only column the route writes) |
| 6 | T&E (30 Oct) | te trip drafts ×~6, expense draft ×1 (Rohan) | "CLAUDE TEST plan" / "CLAUDE TEST draft" | all discarded in the app; Drafts list empty |

# Performance (PMS) parity sync — 9 Nov 2026

Rohan SRS9042 (`bd794095-603b-47ba-a948-b94f84c7d717`), period Q2-FY202627 (`c1f03b2e-1b69-4cbd-97c7-6f53b30aee68`).
Before the test he had nothing in the cycle: `pms_overall_rating` row `2b99d42b-9024-4a9b-87d0-9b958b8530ec` at NOT_STARTED with every score null, chain_stage null, and 0 rows in pms_employee_goals / pms_goal_kpi / pms_reviews / pms_one_to_one / pms_feedback / pms_additional_benefits / pms_pip / pms_training_recommendation / pms_training_suggestion / pms_audit_log.

| # | Who acted | Table / rows | What | State now |
|---|---|---|---|---|
| P1 | Rohan (app, My KRAs) | pms_employee_goals ×4 (7fc2228f…, f8c59be7…, dd6d0ce4…, 0fa47be4…), pms_goal_kpi ×5, pms_reviews SELF ×5, pms_one_to_one KRA_SETTING 5eaddb1a… (employee_ack, manager = frozen RM L1 Shreya), pms_overall_rating → SELF_SUBMITTED / self_score 3.88 / chain_stage RM_L1 | KRA titles start "CLAUDE TEST" | DELETED 9 Nov (see P3) |
| P2 | Shreya (app, review panel on Rohan) | pms_reviews RM_L1 ×5, pms_feedback (rm_overall_comment "CLAUDE TEST…"), pms_training_recommendation ×1 ("CLAUDE TEST — Advanced Excel"), pms_one_to_one 5eaddb1a… manager_ack, pms_chain_approve → pms_lock_kras (goals LOCKED) → chain_stage HOD (it sat in HOD 45fd2db4…'s queue for about 15 minutes; PMS writes send no mail or notification) | | DELETED 9 Nov (see P3) |
| P3 | cleanup (anon client) | deleted pms_reviews ×10, pms_goal_kpi ×5, pms_one_to_one ×1, pms_employee_goals ×4, pms_feedback ×1, pms_training_recommendation ×1; reset pms_overall_rating 2b99d42b… to NOT_STARTED with every score null and updated_at put back to 2026-08-31T12:27:51.873706+00:00 | Compared column by column with the snapshot taken before P1: no difference; every table back to 0 rows for Rohan. No pms_audit_log or pms_training_suggestion rows were created (the AI route answered 503 before storing anything). | RESTORED |

# 1.3.0 sync: exit, proofs, flexi, Learning (9 Nov 2026)

| # | Who acted | Table / rows | What | State now |
|---|---|---|---|---|
| E1 | Rohan SRS9042 (app, Exit Process) | employee_resignation 2b524a31… + resignation_stage_log | submitted with tentative_lwd 2026-12-09, remarks "CLAUDE TEST: app check of tentative LWD; will be withdrawn"; Shreya opened "Approve with LWD" without confirming; Rohan withdrew | **deleted** (stage log cascades). Two in-app notifications to Shreya (submitted / withdrawn) remain in her bell. |
| E2 | Shreya SRS9010 (app, Investment Proofs, 80C line) | investment_proof_files + bucket investment-proofs | uploaded "CLAUDE TEST proof.pdf" (1 KB), saw it listed, removed it | **deleted** (row and stored file); the line stayed PENDING |
