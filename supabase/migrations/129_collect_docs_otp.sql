-- 129_collect_docs_otp.sql
-- ===========================================================================
-- Email-OTP gate for the candidate document-collection link. The candidate must
-- prove they own the registered email before they can see or upload documents.
-- Idempotent. Safe to run twice.
-- ===========================================================================

alter table public.document_collection_links add column if not exists otp_hash text;
alter table public.document_collection_links add column if not exists otp_expires_at timestamptz;
alter table public.document_collection_links add column if not exists otp_attempts integer not null default 0;

notify pgrst, 'reload schema';
