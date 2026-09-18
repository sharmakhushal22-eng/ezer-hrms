-- 119_social_joiner_window.sql
-- ===========================================================================
-- SOCIAL'S NEW-JOINER LIST NOW HONOURS announce_days, LIKE THE HOME CARD.
--
-- FOR: Nayan Ahuja. NO SCHEMA CHANGE. ONE FUNCTION REPLACED, PLUS A SMALL
-- ONE-OFF CLEANUP. SAFE TO RUN TWICE.
-- DEPENDS ON: 116 (ess_new_joiners, ess_new_joiner_settings), 118 (social_posts).
--
-- ---------------------------------------------------------------------------
-- THE BUG
--
-- 116 identifies a new joiner in two parts: HR issuing the ESS code is the
-- TRIGGER, and having actually started within qualify_days (90) is the
-- QUALIFIER. It then shows that person for announce_days (30) from the day the
-- code was issued — that last clause lives in ess_new_joiners_feed():
--
--     and current_date <= (nj.code_issued_at::date + cfg.announce_days)
--
-- ess_social_materialise() in 118 reads the ledger directly and checks only
-- is_hidden and that the employee is still active. It never applied the
-- window. So Social kept announcing people the Home card had already retired.
--
-- Measured on this database on 16 September 2026, with announce_days = 30:
--
--     code issued 19 Aug  (3 people)  -> + 30 = 18 Sep   still inside
--     code issued 11 Jul  (2 people)  -> + 30 = 10 Aug   five weeks stale
--
-- The Home card showed 3. Social showed 5. Same ledger, two different answers
-- to "who is new", which is precisely the kind of disagreement that makes
-- people stop trusting both surfaces.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES
--
-- One clause added to the joiner branch. Birthdays and anniversaries are
-- untouched and are reproduced below verbatim, because `create or replace`
-- rewrites the whole body and the two blocks must not drift.
--
-- announce_days is read from ess_new_joiner_settings rather than hardcoded, so
-- retuning the window stays a policy change in one row — change it there and
-- both surfaces move together.
-- ===========================================================================

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
  -- The same default 116 uses when the settings row is somehow missing.
  v_announce integer := coalesce((select announce_days from ess_new_joiner_settings limit 1), 30);
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

  -- New joiners, from the ledger 116 maintains. is_hidden is HR's escape hatch
  -- for somebody flagged wrongly, and it is honoured here.
  --
  -- THE FIX: the announce window, measured from the day the code was issued,
  -- exactly as ess_new_joiners_feed() measures it. Without this line Social and
  -- the Home card disagree about who is new.
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
     and current_date <= (j.code_issued_at::date + v_announce)
  on conflict (kind, subject_employee_id, occasion_on) do nothing;

  return n;
end $$;

comment on function public.ess_social_materialise is
  'Creates social_posts rows for the group''s upcoming birthdays, anniversaries and new joiners. Joiners respect ess_new_joiner_settings.announce_days, as the Home card does. Idempotent.';

-- ── CLEANUP: the rows the old version already created ───────────────────────
-- Replacing the function stops NEW stale posts; it does not retract the ones
-- already written. This removes joiner posts that are now outside the window.
--
-- DELIBERATELY CONSERVATIVE. It only deletes a post that nobody has touched —
-- no reactions, no comments. If a colleague has already welcomed someone, that
-- exchange is theirs and is not something a migration should quietly destroy;
-- such a post stays, and ages out of the feed on its own as the ledger row
-- does. On this database, on 16 September, the untouched stale rows are the two
-- whose codes were issued on 11 July.
delete from public.social_posts p
 where p.kind = 'joiner'
   and not exists (
     select 1 from public.ess_new_joiners j
      where j.employee_id = p.subject_employee_id
        and current_date <= (j.code_issued_at::date
              + coalesce((select announce_days from public.ess_new_joiner_settings limit 1), 30))
   )
   and not exists (select 1 from public.social_reactions r where r.post_id = p.id)
   and not exists (select 1 from public.social_comments  c where c.post_id = p.id);

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Before and after, these two should agree. The first is what the Home card
-- shows; the second is what Social shows.
--
--   select jsonb_array_length(public.ess_new_joiners_feed('<an-employee-uuid>'));
--   select count(*) from public.social_posts where kind = 'joiner';
--
-- And the window itself, per ledger row:
--
--   select employee_id,
--          code_issued_at::date                            as issued,
--          code_issued_at::date
--            + (select announce_days from ess_new_joiner_settings limit 1) as shows_until,
--          current_date <= code_issued_at::date
--            + (select announce_days from ess_new_joiner_settings limit 1) as still_shown
--     from ess_new_joiners
--    where is_hidden = false
--    order by code_issued_at desc;
