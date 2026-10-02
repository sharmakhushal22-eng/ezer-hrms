-- 140_offer_letter_config.sql
-- ===========================================================================
-- Admin-controlled offer-letter design.
--
-- WHAT ALREADY EXISTS (and is therefore NOT recreated here)
--
--   letterhead_files        the stationery PDF + safe margins, per scope
--   letterhead_signatories  the signature image + name/designation, per scope
--   letterhead_resolved     \ SQL views applying the Branch > Company > Group
--   signatory_resolved      / cascade, so callers never walk it themselves
--   letter_templates        {{token}} bodies, incl. an empty row named
--                           'Offer Letter' waiting to be filled
--   generated_letters       issued-letter records
--
-- None of those six relations is created by any migration in this repo. They
-- exist in the live database only. This file does NOT attempt to define them
-- retroactively — guessing at columns that already hold data is how you lose
-- data — it only adds what is missing. The drift is recorded in
-- docs/security/ for a human to reconcile properly.
--
-- WHAT IS ACTUALLY MISSING
--
-- 1. letter_templates cannot say WHICH letter a template is, or who it belongs
--    to. Name matching ('Offer Letter') is not identity: rename it and every
--    consumer breaks silently. letter_type gives the offer flow a stable
--    handle, and company_id lets each company word its own offer.
--
-- 2. Nowhere stores offer terms or annexures. The flow calls for terms and
--    annexures attached to the offer, and a grep across app/, components/,
--    lib/ and every migration found no such store — only unrelated uses of
--    the word in recruitment and appraisal text.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ── 1. Identity and scope for templates ────────────────────────────────────

alter table public.letter_templates
  add column if not exists letter_type text,
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

comment on column public.letter_templates.letter_type is
  'Stable machine handle for what this template IS (e.g. OFFER_LETTER). The offer flow looks the template up by this, never by name — a rename must not break generation.';
comment on column public.letter_templates.company_id is
  'Which company this template belongs to. NULL = a group-wide default usable by any company, matching the Branch > Company > Group spirit of letterhead_resolved.';

-- Claim the existing 'Offer Letter' row rather than inserting a duplicate.
-- It is already there with empty content; a second row would make "the offer
-- template" ambiguous, which is the exact problem letter_type exists to solve.
update public.letter_templates
   set letter_type = 'OFFER_LETTER'
 where letter_type is null
   and upper(trim(name)) = 'OFFER LETTER';

-- At most one offer template per company, and at most one group-wide default.
-- Two partial indexes because NULL company_id must be treated as a single
-- distinct slot: a plain UNIQUE(letter_type, company_id) would permit many
-- rows with NULL, since NULLs never collide in SQL.
create unique index if not exists uq_letter_templates_type_company
  on public.letter_templates (letter_type, company_id)
  where letter_type is not null and company_id is not null;

create unique index if not exists uq_letter_templates_type_global
  on public.letter_templates (letter_type)
  where letter_type is not null and company_id is null;

create index if not exists idx_letter_templates_type
  on public.letter_templates (letter_type)
  where letter_type is not null;

-- ── 2. Terms and annexures ─────────────────────────────────────────────────
-- Separate rows rather than one blob on the template: they are reordered,
-- toggled and reused independently, and an admin editing clause 3 should not
-- rewrite the whole letter body.

create table if not exists public.offer_letter_clauses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  kind          text not null default 'TERM',
  heading       text,
  body          text not null default '',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  -- TERM      numbered condition printed in the letter body
  -- ANNEXURE  titled block printed after the terms
  constraint offer_letter_clauses_kind_check check (kind in ('TERM', 'ANNEXURE'))
);

comment on table public.offer_letter_clauses is
  'Admin-authored terms and annexures for offer letters. company_id NULL = applies to every company unless that company has its own.';
comment on column public.offer_letter_clauses.kind is
  'TERM prints as a numbered condition inside the letter; ANNEXURE prints as a titled block after the terms.';
comment on column public.offer_letter_clauses.sort_order is
  'Print order within a kind. Ties fall back to created_at so the order is always total, never arbitrary.';

create index if not exists idx_offer_letter_clauses_company
  on public.offer_letter_clauses (company_id, kind, sort_order)
  where is_active;

alter table public.offer_letter_clauses enable row level security;
drop policy if exists "allow_all_offer_letter_clauses" on public.offer_letter_clauses;
create policy "allow_all_offer_letter_clauses" on public.offer_letter_clauses
  for all to anon, authenticated using (true) with check (true);

-- updated_at must not be left to the client: an admin reordering clauses in
-- one request would otherwise have to restate it per row.
create or replace function public.touch_offer_letter_clauses()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_offer_letter_clauses on public.offer_letter_clauses;
create trigger trg_touch_offer_letter_clauses
  before update on public.offer_letter_clauses
  for each row execute function public.touch_offer_letter_clauses();

notify pgrst, 'reload schema';
