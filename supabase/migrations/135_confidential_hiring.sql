-- 135 — Confidential hiring.
--
-- An HR Head can raise an MRF as confidential: it is approved on the spot (no RM2 / HR Head
-- chain), nobody is notified, and the requisition and every candidate under it are visible
-- only to the company's HR Head and HR Manager(s) (and the super admin). The interview is a
-- single Telephonic round the HR Head / HR Manager records themselves; a Shortlist decision
-- moves the candidate straight to Negotiation, and the candidate's acceptance on the salary
-- link creates an already-approved offer request, so the letter can be sent from Send Offers
-- without an Offer Approval step. Visibility is enforced in the app (RLS is allow_all here).

ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS confidential_by UUID;   -- the HR Head who raised it

CREATE INDEX IF NOT EXISTS idx_mrf_confidential ON manpower_requisitions (company_id) WHERE is_confidential;

NOTIFY pgrst, 'reload schema';

-- VERIFY — both rows must show exists = true.
SELECT c AS column_name,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'manpower_requisitions' AND column_name = c) AS exists
FROM unnest(ARRAY['is_confidential', 'confidential_by']) AS c;
