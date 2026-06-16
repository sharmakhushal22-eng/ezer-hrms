-- ============================================================
-- 016_pre_negotiation_docs.sql
-- Pre-negotiation document checks on a candidate.
-- HR uploads Aadhaar + previous offer letter before CTC negotiation;
-- once saved, pre_negotiation_done flips true and the candidate moves
-- from "Pre-negotiation Checks" to "CTC Negotiations".
-- Files are stored in the existing 'onboarding-docs' storage bucket.
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
alter table public.candidates
  add column if not exists aadhaar_url           text,
  add column if not exists prev_offer_url        text,
  add column if not exists pre_negotiation_done  boolean default false;

-- Storage bucket for uploaded docs (Aadhaar / offer letters). Private.
insert into storage.buckets (id, name, public)
values ('onboarding-docs', 'onboarding-docs', false)
on conflict (id) do nothing;

-- Allow the app (anon + authenticated) to read/write objects in this bucket.
-- Matches the project's functionality-first RLS. The service role bypasses RLS
-- entirely, so this is only needed when the server uses the anon key.
drop policy if exists "onboarding-docs app access" on storage.objects;
create policy "onboarding-docs app access" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'onboarding-docs')
  with check (bucket_id = 'onboarding-docs');

notify pgrst, 'reload schema';
