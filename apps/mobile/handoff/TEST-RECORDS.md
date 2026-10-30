# Records created on the live (test-data) DB during mobile testing — 19 Oct 2026

| # | Module | Table / id | What | State now |
|---|---|---|---|---|
| 1 | Leave | leave_applications 9458bae1-d6e6-454b-bb47-b22d916e2b9e | Rohan SRS9042, EL 25 Nov 2026, reason "CLAUDE TEST" | DELETED 30 Oct, with its 3 ess_notifications rows (the mail to Shreya cannot be recalled) |
| 2 | Home | attendance_punches (Kiran SRS9047, 358c74fb-…) 2026-10-19 | IN 03:39:55Z, OUT 03:40:00Z, source ESS_APP | DELETED 30 Oct, with the derived attendance_records row (a5f28c3a…), so Kiran's false 19 Oct "Late" is gone |
| 3 | Home | ess_user_preferences (Kiran) | written by PUTs | restored to {light,24,long} (again on 30 Oct; Rohan's and Shreya's prior themes were not recorded, left on auto) |
| 4 | HR Services | ess_service_requests 6cb8bc61-769a-4edc-a556-432e896ea174 | Rohan SRS9042, type LOAN, details "CLAUDE TEST — mobile app parity check, please ignore" | DELETED 30 Oct |
| 5 | Profile (30 Oct) | employees SRS9042 `aadhar_last4` | accidental save of '0124' while testing validation | REVERTED to NULL (only column the route writes) |
| 6 | T&E (30 Oct) | te trip drafts ×~6, expense draft ×1 (Rohan) | "CLAUDE TEST plan" / "CLAUDE TEST draft" | all discarded in the app; Drafts list empty |
