-- 118_social.sql
-- ===========================================================================
-- THE SOCIAL SECTION — birthdays, work anniversaries, new joiners, and the
-- Wall of Fame gathered under one tab, with reactions and comments on every
-- post in every one of them.
--
-- ADDS FIVE TABLES. NO SCHEMA CHANGE TO ANY EXISTING ONE. SAFE TO RUN TWICE.
--
-- ---------------------------------------------------------------------------
-- WHY NEW TABLES RATHER THAN `recognitions`
--
-- The obvious move is to widen recognitions.kind and get its reactions and
-- comments for free. It does not fit and the misfit is not cosmetic:
--
--   * recognitions requires giver_employee_id and a receiver_employee_ids
--     array of length >= 1. A birthday has no giver. Every celebration row
--     would carry a fake one.
--   * its kind CHECK is ('award','shoutout','milestone','pms_remark') and it
--     carries enforce_wall_admin() / guard_wall_config() / wall_audit()
--     triggers plus a daily-limit and cooldown path in create_shoutout().
--     Widening the constraint puts birthday rows through all of that.
--
-- So shoutouts STAY where they are. The feed reads both and labels each row
-- with a source, and the API routes a reaction to recognition_reactions or to
-- social_reactions accordingly. Two stores, one feed, nothing duplicated.
--
-- ---------------------------------------------------------------------------
-- SCOPE IS THE GROUP, NOT THE COMPANY
--
-- Confirmed with Khushal: the Social feed spans every company sharing a
-- groups.id through companies.group_id. That is deliberately wider than the
-- rule in ROLE_WISE_PLAN.md ("every module, own company only"), and it is the
-- only surface in the product that crosses that line — which is exactly why
-- group_id is denormalised onto the post rather than being joined at read
-- time. A feed query that forgets the join returns nothing, not everything.
--
-- ---------------------------------------------------------------------------
-- RLS
--
-- The project's standard permissive policy, as in 116 and 113. ESS employees
-- are not Supabase auth users, so a policy of the form "employee reads own
-- rows" cannot identify a claimant; protection sits in the API layer, where
-- essRoute() resolves the caller from the ESS token and the service-role
-- client does the reading. Anything reachable with the anon key is reachable
-- by anybody who views source, so nothing private goes in these tables — a
-- birthday post carries a person's name and the day, never the year.
-- ===========================================================================

-- ── 1. POSTS ───────────────────────────────────────────────────────────────
-- One row per thing that can be reacted to or commented on. Celebrations are
-- materialised rather than derived on the fly precisely BECAUSE they carry
-- reactions: a comment needs something stable to hang off, and "Kavya's
-- birthday" computed from employees.date_of_birth is a different object on
-- every request.
create table if not exists public.social_posts (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('birthday','anniversary','joiner')),
  subject_employee_id uuid not null references public.employees(id) on delete cascade,
  -- Denormalised at write time. See the scope note above.
  group_id            uuid,
  company_id          uuid,
  -- The day it falls. For a joiner this is the joining date.
  occasion_on         date not null,
  -- Anniversaries only. NEVER set for a birthday: no age is stored, derivable
  -- or displayed anywhere in this feature.
  years               integer,
  created_at          timestamptz not null default now(),
  -- HR takedown. removed_by is recorded for audit and is NEVER returned to a
  -- client: the person who wrote the post is told what the remark said and
  -- never who acted, so a policy decision does not become a personal one.
  removed_by          uuid references public.employees(id),
  removed_reason      text,
  removed_at          timestamptz,
  -- One post per person per occasion. This is what makes the materialiser
  -- idempotent: it can run on every page load and insert nothing.
  unique (kind, subject_employee_id, occasion_on)
);

-- ── 2. REACTIONS ───────────────────────────────────────────────────────────
create table if not exists public.social_reactions (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.social_posts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  -- One of each emoji per person per post. The toggle is a delete, not a
  -- second row.
  unique (post_id, employee_id, emoji)
);

-- ── 3. COMMENTS ────────────────────────────────────────────────────────────
-- One level of replies, matching wall_config.comment_max_depth = 1. A comment
-- and its replies is a conversation; a tree is a forum, and nobody asked for
-- a forum inside an HR portal.
create table if not exists public.social_comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.social_posts(id) on delete cascade,
  employee_id       uuid not null references public.employees(id) on delete cascade,
  -- A wish may be a GIF with no words, so the body is allowed to be empty when
  -- media_ref is set. The CHECK below enforces "at least one of the two".
  body              text not null default '' check (char_length(body) <= 1000),
  -- A key into the curated pack we host (confetti, cake, balloons…), never a
  -- third-party URL: no Giphy or Tenor, so nothing an employee types in the
  -- composer is sent to another company.
  media_ref         text,
  parent_comment_id uuid references public.social_comments(id) on delete cascade,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  removed_by        uuid references public.employees(id),
  removed_reason    text,
  removed_at        timestamptz,
  -- Silence is not a comment. Without this a stray insert produces an empty
  -- bubble that cannot be distinguished from a rendering fault.
  constraint social_comments_has_content
    check (char_length(body) > 0 or media_ref is not null)
);

create table if not exists public.social_comment_reactions (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references public.social_comments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (comment_id, employee_id, emoji)
);

-- ── 4. THE JOINER'S OWN INTRODUCTION ───────────────────────────────────────
-- Written by the joiner, not by HR. employees.hobbies already exists but is
-- HR-maintained from the admin Employee Master screen and has no ESS write
-- path; overloading it would mean HR and the employee editing one column from
-- two screens with different intentions.
--
-- Nothing is published until they write it: a joiner card with no intro says
-- so rather than printing an empty block where a person should be.
create table if not exists public.social_intros (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  intro       text check (intro is null or char_length(intro) <= 600),
  hobbies     text[] not null default '{}',
  skills      text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ── 5. INDEXES ─────────────────────────────────────────────────────────────
-- The feed reads by group and date, newest first; everything else hangs off a
-- post id.
create index if not exists idx_social_posts_group_on   on public.social_posts (group_id, occasion_on desc);
create index if not exists idx_social_posts_kind_on    on public.social_posts (kind, occasion_on desc);
create index if not exists idx_social_posts_subject    on public.social_posts (subject_employee_id);
create index if not exists idx_social_reactions_post   on public.social_reactions (post_id);
create index if not exists idx_social_comments_post    on public.social_comments (post_id, created_at);
create index if not exists idx_social_creactions_cmt   on public.social_comment_reactions (comment_id);

-- ── 6. RLS ─────────────────────────────────────────────────────────────────
alter table public.social_posts             enable row level security;
alter table public.social_reactions         enable row level security;
alter table public.social_comments          enable row level security;
alter table public.social_comment_reactions enable row level security;
alter table public.social_intros            enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'social_posts','social_reactions','social_comments',
    'social_comment_reactions','social_intros'
  ] loop
    execute format('drop policy if exists "allow_all_%s" on public.%I', t, t);
    execute format(
      'create policy "allow_all_%s" on public.%I for all to anon, authenticated using (true) with check (true)',
      t, t);
  end loop;
end $$;

-- ── 7. MATERIALISING TODAY'S CELEBRATIONS ──────────────────────────────────
-- Called by the feed route. Idempotent by the unique constraint above, so it
-- is safe on every page load and does nothing on the second call of the day.
--
-- The window is deliberately asymmetric and matches what the section shows:
-- birthdays reach forward far enough to be "coming up", anniversaries only to
-- the end of the current week, and joiners come from ess_new_joiners (116),
-- which already decides who counts as new and for how long.
create or replace function public.ess_social_materialise(
  p_group_id uuid,
  p_birthday_days integer default 14,
  p_anniversary_days integer default 7
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if p_group_id is null then return 0; end if;

  -- Birthdays. The occasion date is this year's projection of the stored date
  -- of birth; the year of birth never leaves this function.
  with cal as (
    select e.id, e.company_id,
           (date_trunc('year', current_date)
             + make_interval(days => extract(doy from e.date_of_birth)::int - 1))::date as on_date
      from public.employees e
      join public.companies c on c.id = e.company_id
     where c.group_id = p_group_id
       and e.date_of_leaving is null
       and e.date_of_birth is not null
  )
  insert into public.social_posts (kind, subject_employee_id, group_id, company_id, occasion_on)
  select 'birthday', cal.id, p_group_id, cal.company_id, cal.on_date
    from cal
   where cal.on_date between current_date and current_date + p_birthday_days
  on conflict (kind, subject_employee_id, occasion_on) do nothing;
  get diagnostics n = row_count;

  -- Work anniversaries. Only a completed year counts — somebody who joined
  -- this year is a new joiner, which is a different card in a different
  -- sub-section.
  with cal as (
    select e.id, e.company_id, e.company_doj,
           (date_trunc('year', current_date)
             + make_interval(days => extract(doy from e.company_doj)::int - 1))::date as on_date
      from public.employees e
      join public.companies c on c.id = e.company_id
     where c.group_id = p_group_id
       and e.date_of_leaving is null
       and e.company_doj is not null
  )
  insert into public.social_posts (kind, subject_employee_id, group_id, company_id, occasion_on, years)
  select 'anniversary', cal.id, p_group_id, cal.company_id, cal.on_date,
         extract(year from age(cal.on_date, cal.company_doj))::int
    from cal
   where cal.on_date between current_date and current_date + p_anniversary_days
     and extract(year from age(cal.on_date, cal.company_doj))::int >= 1
  on conflict (kind, subject_employee_id, occasion_on) do nothing;

  -- New joiners, from the ledger migration 116 already maintains. is_hidden is
  -- HR's escape hatch for somebody flagged wrongly, and it is honoured here.
  insert into public.social_posts (kind, subject_employee_id, group_id, company_id, occasion_on)
  select 'joiner', j.employee_id, p_group_id, e.company_id,
         coalesce(j.joined_on, j.code_issued_at::date)
    from public.ess_new_joiners j
    join public.employees e on e.id = j.employee_id
    join public.companies c on c.id = e.company_id
   where c.group_id = p_group_id
     and j.is_hidden = false
     and e.date_of_leaving is null
     and coalesce(j.joined_on, j.code_issued_at::date) is not null
  on conflict (kind, subject_employee_id, occasion_on) do nothing;

  return n;
end $$;

comment on function public.ess_social_materialise is
  'Creates social_posts rows for the group''s upcoming birthdays, anniversaries and new joiners. Idempotent.';

-- ── 8. VERIFY ──────────────────────────────────────────────────────────────
-- Run these after applying. Expect five tables and one function.
--
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'social_%'
--    order by table_name;
--
--   select routine_name from information_schema.routines
--    where routine_schema = 'public' and routine_name = 'ess_social_materialise';
--
-- Then, for one real group id, check the materialiser is idempotent — the
-- second call must add nothing:
--
--   select public.ess_social_materialise('<group-uuid>');
--   select count(*) from public.social_posts;
--   select public.ess_social_materialise('<group-uuid>');
--   select count(*) from public.social_posts;   -- unchanged
