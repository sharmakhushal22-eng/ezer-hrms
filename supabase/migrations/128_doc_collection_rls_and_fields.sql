-- 128_doc_collection_rls_and_fields.sql
-- ===========================================================================
-- Candidate document-collection link (CTC negotiation): RLS + a couple of
-- fields + the full document type list.
--
-- FOR: Nayan Ahuja. Tables document_collection_links + candidate_documents_uploaded
-- were created in migration 005 but never had RLS or been used. This wires them
-- for the recruitment doc-collection flow. Idempotent. Safe to run twice.
-- ===========================================================================

-- who was CC'd on the invite, and the email it was sent to (candidate.email may change)
alter table public.document_collection_links add column if not exists cc_emails text[];
alter table public.document_collection_links add column if not exists candidate_email text;

-- RLS — the standard project pattern (client uses the anon key).
alter table public.document_collection_links enable row level security;
drop policy if exists "allow_all_document_collection_links" on public.document_collection_links;
create policy "allow_all_document_collection_links" on public.document_collection_links
  for all to anon, authenticated using (true) with check (true);

alter table public.candidate_documents_uploaded enable row level security;
drop policy if exists "allow_all_candidate_documents_uploaded" on public.candidate_documents_uploaded;
create policy "allow_all_candidate_documents_uploaded" on public.candidate_documents_uploaded
  for all to anon, authenticated using (true) with check (true);

-- Widen the doc_type list to the full recruitment set (adds PAN, AADHAAR, FORM_16, PHOTO).
alter table public.candidate_documents_uploaded drop constraint if exists candidate_documents_uploaded_doc_type_check;
alter table public.candidate_documents_uploaded add constraint candidate_documents_uploaded_doc_type_check
  check (doc_type in (
    'PAN','AADHAAR','BANK_PROOF',
    '10TH_MARKSHEET','12TH_MARKSHEET','GRADUATION','MASTERS','ADDITIONAL_1','ADDITIONAL_2','ADDITIONAL_3',
    'APPOINTMENT_LETTER','OFFER_LETTER','APPRAISAL_LETTER',
    'SALARY_SLIP_1','SALARY_SLIP_2','SALARY_SLIP_3','FORM_16','PHOTO'
  ));
