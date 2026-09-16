-- 120_new_joiners_group_wide.sql
-- ===========================================================================
-- THE NEW-JOINER FEED BECOMES GROUP-WIDE, MATCHING SOCIAL.
--
-- FOR: Nayan Ahuja. NO SCHEMA CHANGE. ONE FUNCTION REPLACED. SAFE TO RUN TWICE.
-- DEPENDS ON: 116 (ess_new_joiners, ess_new_joiner_settings), companies.group_id.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- 118/119 made the Social tab group-wide: every company sharing a groups.id
-- sees the same people. ess_new_joiners_feed() was still scoped to the viewer's
-- OWN company, so the two surfaces answered "who is new?" differently.
--
-- Measured on this database, for Krishna Mehta (Sharma Retail Solutions), with
-- announce_days = 30:
--
--     SHyam               Sharma Retail   issued 11 Jul   expired 9 Aug
--     Manoj Kumar Sharma  Sharma Retail   issued 11 Jul   expired 9 Aug
--     Nayan Ahuja         Sharma Sons     issued 19 Aug   in window
--     khushal sharma      Sharma Sons     issued 19 Aug   in window
--     Sam                 Sharma Sons     issued 19 Aug   in window
--
-- His own company's two joiners lapsed five weeks ago and the three still
-- current are in a sister company, so the Home card showed him NOTHING while
-- Social showed three. After this, both show three.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT DOES NOT
--
-- Exactly one clause: the company test becomes a group test. Everything else —
-- the announce window, is_hidden, excluding leavers, excluding the viewer,
-- already_congratulated, the ordering and every key in the returned object — is
-- reproduced verbatim below, because `create or replace` rewrites the whole
-- body and the two must not drift.
--
-- A company with no group still gets its own feed. An ungrouped company is a
-- group of one, and returning nothing would read as "this is broken" rather
-- than "you are the only company here". That is the same fallback
-- /api/ess/social already uses when it resolves a group.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS AFFECTS
--
-- Both Home paths at once, because both go through this one function:
--   * ess_today_payload() (117) embeds it as the payload's `new_joiners` key
--   * components/ess/today/NewJoiners.tsx calls it directly as its fallback,
--     for a database that has 116 but not 117
--
-- The Social tab does NOT read this function — it materialises its own rows in
-- ess_social_materialise() — so nothing here changes what Social shows.
-- ===========================================================================

create or replace function public.ess_new_joiners_feed(p_employee_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  -- group_id joined in so the scope test below can be a group test. LEFT JOIN
  -- on purpose: an employee with no company, or a company with no group, must
  -- still get an answer rather than an empty set.
  with me as (
    select e.id, e.company_id, c.group_id
      from employees e
      left join companies c on c.id = e.company_id
     where e.id = p_employee_id
  ),
  cfg as (
    select coalesce((select announce_days from ess_new_joiner_settings limit 1), 30) as announce_days
  ),
  picked as (
    select nj.employee_id,
           emp.full_name, emp.emp_code, emp.designation, emp.photo_url,
           d.dept_name,
           nj.joined_on, nj.code_issued_at,
           exists (
             select 1 from ess_kudos k
              where k.from_employee_id = p_employee_id
                and k.to_employee_id   = nj.employee_id
                and k.badge            = 'JOINING'
           ) as already_congratulated
      from ess_new_joiners nj
      join employees   emp on emp.id = nj.employee_id
      left join departments d on d.id = emp.department_id
     cross join me, cfg
     where nj.is_hidden = false
       and emp.date_of_leaving is null
       and nj.employee_id <> p_employee_id
       -- THE CHANGE. Was: (me.company_id is null or emp.company_id = me.company_id)
       and (
         case
           when me.group_id is not null then
             exists (select 1
                       from companies c2
                      where c2.id = emp.company_id
                        and c2.group_id = me.group_id)
           when me.company_id is not null then emp.company_id = me.company_id
           else true
         end
       )
       and current_date <= (nj.code_issued_at::date + cfg.announce_days)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',            employee_id,
        'name',          full_name,
        'initials',      upper(left(split_part(full_name,' ',1),1) ||
                               coalesce(left(nullif(split_part(full_name,' ',2),''),1),'')),
        'code',          emp_code,
        'designation',   designation,
        'department',    dept_name,
        'photo',         photo_url,
        'joined_on',     joined_on,
        'code_issued_at', code_issued_at,
        'days_since_joining', case when joined_on is not null then current_date - joined_on end,
        'already_congratulated', already_congratulated)
      order by coalesce(joined_on, code_issued_at::date) desc, full_name),
    '[]'::jsonb)
  from picked;
$$;

comment on function public.ess_new_joiners_feed is
  'New joiners for the viewer''s whole group (companies sharing a groups.id), within ess_new_joiner_settings.announce_days. Falls back to the viewer''s own company when that company has no group.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Before this migration, for a Sharma Retail employee, the first returns 0.
-- After it, both should return 3 and agree with each other.
--
--   select jsonb_array_length(public.ess_new_joiners_feed('16c09c2c-984a-45d5-ba99-f3ebb9c0b58e'));
--   select count(*) from public.social_posts where kind = 'joiner';   -- after 119
--
-- The names, to eyeball that they cross company lines:
--
--   select x->>'name' as joiner, x->>'department' as dept
--     from jsonb_array_elements(
--            public.ess_new_joiners_feed('16c09c2c-984a-45d5-ba99-f3ebb9c0b58e')) x;
--
-- And confirm an ungrouped company still gets its own feed rather than nothing
-- (there are none today, so this should simply not error):
--
--   select count(*) from companies where group_id is null;
