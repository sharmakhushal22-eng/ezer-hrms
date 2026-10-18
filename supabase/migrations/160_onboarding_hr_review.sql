-- 160_onboarding_hr_review.sql — the HR Manager's review of a submitted onboarding form.
--
-- From the onboarding card (Review form) the HR Manager accepts the form or returns it,
-- document by document and detail by detail. What was decided lives here:
--   onboarding_candidates.hr_review   the last review: outcome ACCEPTED / RETURNED /
--                                     RESUBMITTED, who, when, the documents rejected (code,
--                                     reason) and the details to correct (field, reason)
--   onboarding_documents.hr_verified  (existing) true = accepted, false = rejected; a fresh
--                                     upload clears it
--   onboarding_documents.hr_reviewed_at  when the verdict on that file was given
-- Idempotent.
ALTER TABLE onboarding_candidates ADD COLUMN IF NOT EXISTS hr_review JSONB;
ALTER TABLE onboarding_documents  ADD COLUMN IF NOT EXISTS hr_reviewed_at TIMESTAMPTZ;
COMMENT ON COLUMN onboarding_candidates.hr_review IS 'HR Manager review: {outcome, at, by, by_name, note, documents:[{doc_code,label,ok,reason}], details:[{section,field,reason}]}';
