-- ============================================================================
-- 0001_align_recruitment_schema.sql
-- Aligns the live Supabase schema with the Recruitment/ATS page
-- (app/dashboard/recruitment/page.tsx).
--
-- WHY: the page was written against column names that differ from the deployed
-- tables, so every write (create MRF, add candidate, save offer) was failing
-- with "column ... does not exist". This migration adds the page's columns,
-- backfills from the legacy equivalents, and relaxes legacy NOT NULL columns
-- that the page does not populate.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- Safe to run multiple times (idempotent).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) manpower_requisitions  (legacy: position, openings, mrf_number)
-- ---------------------------------------------------------------------------
alter table public.manpower_requisitions
  add column if not exists designation        text,
  add column if not exists no_of_openings      integer,
  add column if not exists job_description      text,
  add column if not exists employment_type      text,
  add column if not exists budget_min           numeric,
  add column if not exists budget_max           numeric,
  add column if not exists experience_required  text;

-- Backfill the new columns from the legacy ones for existing rows.
update public.manpower_requisitions
   set designation = coalesce(designation, position)
 where designation is null;
update public.manpower_requisitions
   set no_of_openings = coalesce(no_of_openings, openings)
 where no_of_openings is null;

-- The page does not write these legacy columns -> stop them blocking inserts.
-- (drop not null is a no-op if the column is already nullable.)
alter table public.manpower_requisitions alter column position     drop not null;
alter table public.manpower_requisitions alter column openings     drop not null;
alter table public.manpower_requisitions alter column reason       drop not null;
alter table public.manpower_requisitions alter column requested_by drop not null;
alter table public.manpower_requisitions alter column approved_by  drop not null;

-- The page generates mrf_number itself, but keep a default as a safety net so
-- an insert can never fail on a missing requisition number.
alter table public.manpower_requisitions
  alter column mrf_number set default ('MRF-' || to_char(now(), 'YYYY') || '-' ||
                                        lpad((floor(random() * 100000))::int::text, 5, '0'));
alter table public.manpower_requisitions alter column mrf_number drop not null;

-- ---------------------------------------------------------------------------
-- 2) candidates  (legacy: job_id, phone; status/applied_date may be NOT NULL)
--    Note: notice_period_days, ai_match_tag, ai_questions, interview_notes,
--    doj already exist on this table; only mrf_id, mobile, designation are new.
-- ---------------------------------------------------------------------------
alter table public.candidates
  add column if not exists mrf_id      uuid references public.manpower_requisitions(id) on delete set null,
  add column if not exists mobile      text,
  add column if not exists designation text;

-- Keep mobile in sync with the legacy phone column.
update public.candidates set mobile = coalesce(mobile, phone) where mobile is null;

-- The page attaches candidates to an MRF (mrf_id), not a job_opening (job_id),
-- and does not set status/applied_date on insert -> relax + default them.
alter table public.candidates alter column job_id drop not null;
alter table public.candidates alter column status       set default 'Active';
alter table public.candidates alter column applied_date set default current_date;
alter table public.candidates alter column stage        set default 'Applied';

-- Legacy columns the page no longer writes (it uses mobile / notice_period_days /
-- ai_match_tag instead) -> ensure they can't block an insert.
alter table public.candidates alter column phone          drop not null;
alter table public.candidates alter column notice_period  drop not null;
alter table public.candidates alter column ai_tag         drop not null;

create index if not exists candidates_mrf_id_idx on public.candidates (mrf_id);

-- ---------------------------------------------------------------------------
-- 3) offer_letters
-- ---------------------------------------------------------------------------
alter table public.offer_letters
  add column if not exists letter_content text,
  add column if not exists to_email       text,
  add column if not exists cc_emails       text[];

-- ---------------------------------------------------------------------------
-- 4) preonboarding_links
--    The page reads link_token; ensure one is always generated even if the
--    client insert omits it.
-- ---------------------------------------------------------------------------
alter table public.preonboarding_links
  alter column link_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.preonboarding_links alter column link_token drop not null;

commit;

-- ============================================================================
-- OPTIONAL — Row Level Security
-- ----------------------------------------------------------------------------
-- The app currently talks to Supabase with the PUBLIC anon key and has no
-- auth gate yet (see the security findings). If writes still fail after the
-- migration with a "row-level security policy" error, RLS is blocking the
-- anon role. The block below makes these recruitment tables readable/writable
-- so the module is functional TODAY.
--
-- ⚠️  SECURITY: this exposes recruitment data (incl. candidate PII) to anyone
-- with the public anon key. Treat as a stopgap and add real auth + scoped
-- policies before production. Uncomment to apply.
-- ============================================================================
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['manpower_requisitions','candidates','mrf_approvals',
--                            'offer_letters','ctc_negotiations','preonboarding_links'] loop
--     execute format('alter table public.%I enable row level security;', t);
--     execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
--     execute format($p$create policy %I on public.%I for all
--                       to anon, authenticated using (true) with check (true);$p$,
--                     t || '_anon_all', t);
--   end loop;
-- end $$;
