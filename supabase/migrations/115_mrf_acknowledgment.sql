-- 115_mrf_acknowledgment.sql
--
-- A hiring manager acknowledges an MRF an HR Head assigned to them (in ESS → Tasks &
-- Approvals). We record who has acknowledged so the "Assigned to you" block can show a
-- ✓ instead of the Acknowledge button. Idempotent.

ALTER TABLE manpower_requisitions
  ADD COLUMN IF NOT EXISTS acknowledged_recruiter_ids uuid[] DEFAULT '{}';

-- (Optional) verify:
--   SELECT mrf_number, assigned_recruiter_ids, acknowledged_recruiter_ids
--   FROM manpower_requisitions WHERE assigned_recruiter_ids IS NOT NULL;
