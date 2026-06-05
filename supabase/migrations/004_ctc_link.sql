-- ============================================================================
-- 004_ctc_link.sql
-- Adds the public "salary view" share-link + offer-detail columns to
-- ctc_negotiations so app/salary-view/[token]/ can render a candidate's
-- offer from a tokenised public URL.
--
-- WHY: page.tsx queries  .eq('link_token', token)  and updates link_viewed_at,
-- and client.tsx reads candidate_name, company_name, position_title,
-- calculation_data and the bonus/ESOP fields. None of these exist on the
-- table created in 003_recruitment_tables.sql.
--
-- RLS: ctc_negotiations already has a permissive anon policy (0002), so the
-- public anon key can read by token once these columns exist. No new policy
-- is required here.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================================

alter table public.ctc_negotiations
  -- public share link
  add column if not exists link_token      text unique default encode(gen_random_bytes(16), 'hex'),
  add column if not exists link_viewed_at  timestamptz,
  -- denormalised display fields (so the public page needs no joins)
  add column if not exists candidate_name  text,
  add column if not exists company_name    text,
  add column if not exists position_title  text,
  -- full breakdown snapshot rendered by client.tsx
  add column if not exists calculation_data jsonb,
  -- joining / retention / ESOP
  add column if not exists joining_bonus        bigint,
  add column if not exists joining_bonus_freq   text,
  add column if not exists retention_bonus      bigint,
  add column if not exists retention_bonus_freq text,
  add column if not exists esop_value           bigint,
  add column if not exists esop_remark          text;

-- Backfill a token for any pre-existing rows that were created before this column.
update public.ctc_negotiations
   set link_token = encode(gen_random_bytes(16), 'hex')
 where link_token is null;

-- Unique index already created by the UNIQUE constraint above; this is a
-- defensive no-op for older Postgres planners.
create unique index if not exists idx_ctc_neg_link_token
  on public.ctc_negotiations (link_token);
