-- =============================================================================
-- 111_ess_today.sql — EZER ESS "Today" tab
--
-- Adapted from the EZER-ESS-Today drop (Khushal, 10 Sep 2026). The four tables
-- and the payload's JSON shape are the drop's, unchanged — lib/today/types.ts
-- is the contract and the UI is built against it. Every READ is rewritten,
-- because the drop was written against a different schema.
--
-- WHAT THE SELF-CHECK FOUND (run before writing this, against the live database)
--
--   assumed                          actual here
--   ─────────────────────────────    ────────────────────────────────────────
--   attendance_logs                  attendance_records
--     .work_date                       .attendance_date
--     .punch_in / .punch_out           .work_in / .work_out
--     .is_late                         .late_minutes > 0
--   holidays                         holiday_calendar (.from_date, .name)
--   leave_requests                   leave_applications
--   leave_balances.balance           no such column — .accrued and .used only
--   leave_balances.leave_type_code   .leave_type_id -> leave_types.name
--   payroll_employee_snapshot
--     .tds_total                       .tds_amount
--     .payroll_month                   payroll_runs.payroll_month
--   payroll_runs.paid_on             does not exist in any form
--   employees.reports_to_l1          .l1_manager_id
--   employees.status                 .employment_status / .date_of_leaving
--   employees.date_of_joining        .company_doj
--   employees.department_name        .department_id -> departments.dept_name
--   employees.location_name          .location_id  -> locations.location_name
--   employees.shift_start/_end       absent entirely — see decision 1
--   employees.work_mode              absent entirely — see decision 1
--   ess_my_approvals()               does not exist; the drop cites
--                                    087_mobile_app.sql, which was never in
--                                    this repo (087 here is social_and_inbox)
--
-- THREE DECISIONS, taken with Tushar
--
--   1. SHIFT AND WORK MODE — NO EXISTING TABLE IS ALTERED. The hero line and
--      the dial's progress ring need a working window, and nothing models one.
--      An earlier draft added shift_start / shift_end / work_mode to employees;
--      that was withdrawn. `employees` is read by payroll, attendance, PMS,
--      onboarding and the wall, and a home-screen redesign is not reason enough
--      to widen it. Instead ess_shift_window() holds the company-wide day in
--      one place, and work mode — modelled nowhere — is simply not reported, so
--      team presence resolves leave -> in -> out and the WFH count reads 0
--      rather than reading wrong.
--   2. LEAVE BALANCE — computed as accrued - used, per type, because those are
--      the only columns that exist.
--   3. APPROVALS — `pending` here returns ess_action_items ONLY. The approvals
--      half is merged by /api/ess/today from lib/ess/pending.ts, which is the
--      app's existing, tested approvals logic. Writing a second one in SQL
--      would be a copy free to drift from it.
--
-- RLS IS NOT THE DROP'S. It shipped `for all to anon, authenticated using
-- (true) with check (true)` on all four tables. Nothing in this tab needs anon
-- access — every read and write goes through /api/ess/* with the service role —
-- and an allow-all policy on announcements would let anybody with the public
-- key rewrite what the company reads on its home page. RLS is enabled with no
-- permissive policy, which denies by default, and the service role is granted
-- explicitly. NAYAN: this is the one part of this migration worth a second
-- opinion; say if you want it looser.
--
-- SAFE TO RUN TWICE.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. NO CHANGES TO EXISTING TABLES.
--
--    The design wants a per-employee shift window and a work mode, and neither
--    exists. An earlier draft added three columns to `employees`; that has been
--    withdrawn. `employees` is the spine of this system — payroll, attendance,
--    PMS, onboarding and the wall all read it — and a home-screen redesign is
--    not a good enough reason to widen it.
--
--    So the two values are supplied without touching the table:
--
--      shift      a company-wide window, defined once below and read by the
--                 payload. When real shifts exist, this constant is the only
--                 thing that has to change.
--      work_mode  not modelled anywhere, so team presence resolves
--                 leave -> in -> out and simply never reports WFH. The design
--                 renders that correctly: the WFH count is zero rather than
--                 wrong, and the strip still reads.
--
--    Only genuinely new things are created: four tables this feature owns.
-- -----------------------------------------------------------------------------
create or replace function public.ess_shift_window()
returns table (shift_start time, shift_end time)
language sql immutable as $$
  -- The company's standard day. One place to change; no column on employees.
  select time '09:30', time '18:30';
$$;

-- -----------------------------------------------------------------------------
-- 1. Preferences  (drop's table, unchanged)
-- -----------------------------------------------------------------------------
create table if not exists public.ess_user_preferences (
  employee_id   uuid primary key references public.employees(id) on delete cascade,
  theme         text not null default 'auto'  check (theme in ('auto','light','dark')),
  time_format   text not null default '24'    check (time_format in ('12','24')),
  date_format   text not null default 'long'  check (date_format in ('long','short','dmy','mdy','iso')),
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2 & 3. Announcements  (drop's tables, unchanged)
-- -----------------------------------------------------------------------------
create table if not exists public.company_announcements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  title         text not null,
  body          text,
  is_pinned     boolean not null default false,
  cta_label     text,
  cta_route     text,
  audience      jsonb not null default '{}'::jsonb,
  published_at  timestamptz not null default now(),
  expires_at    timestamptz,
  created_by    uuid references public.employees(id),
  created_at    timestamptz not null default now()
);
create index if not exists company_announcements_live_idx
  on public.company_announcements (company_id, is_pinned desc, published_at desc)
  where expires_at is null or expires_at > now();

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.company_announcements(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- 4. Action items  (drop's table, unchanged)
-- -----------------------------------------------------------------------------
create table if not exists public.ess_action_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  item_type     text not null check (item_type in
                 ('investment_declaration','investment_proof','policy_ack','profile_update',
                  'document_upload','survey','training','custom')),
  title         text not null,
  description   text,
  due_on        date,
  cta_label     text not null default 'Open',
  cta_route     text not null,
  status        text not null default 'open' check (status in ('open','done','dismissed')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ess_action_items_open_idx
  on public.ess_action_items (employee_id, due_on) where status = 'open';

-- -----------------------------------------------------------------------------
-- 5. On-time streak — consecutive days punched in without being late, walking
--    back from yesterday. attendance_records.late_minutes is the lateness
--    signal here; there is no is_late boolean.
-- -----------------------------------------------------------------------------
create or replace function public.ess_attendance_streak(p_employee_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  with days as (
    select attendance_date, coalesce(late_minutes, 0) as late, work_in
      from attendance_records
     where employee_id = p_employee_id
       and attendance_date >= current_date - 120
       and attendance_date <= current_date
       and work_in is not null
     order by attendance_date desc
  ),
  marked as (
    select attendance_date, late,
           sum(case when late > 0 then 1 else 0 end) over (order by attendance_date desc) as broken
      from days
  )
  select coalesce(count(*), 0)::int from marked where broken = 0;
$$;

-- -----------------------------------------------------------------------------
-- 6. Team presence — people sharing my L1 manager, plus my own reports.
--    status: leave -> wfh -> in -> out, first match wins.
-- -----------------------------------------------------------------------------
create or replace function public.ess_team_presence(p_employee_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select id, l1_manager_id from employees where id = p_employee_id),
  mates as (
    select e.id, e.full_name
      from employees e, me
     where e.id <> me.id
       and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
       and (e.l1_manager_id = me.l1_manager_id or e.l1_manager_id = me.id)
     limit 40
  ),
  status as (
    select m.id, m.full_name,
      case
        when exists (
          select 1 from leave_applications l
           where l.employee_id = m.id
             and l.status in ('APPROVED','approved')
             and current_date between l.from_date and l.to_date
        ) then 'leave'
        -- No WFH branch: work mode is not modelled on employees and this
        -- migration does not add it. The count stays 0 rather than guessing.
        when exists (
          select 1 from attendance_records a
           where a.employee_id = m.id and a.attendance_date = current_date
             and a.work_in is not null
        ) then 'in'
        else 'out'
      end as st
      from mates m
  )
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', full_name,
        'initials', upper(left(split_part(full_name,' ',1),1) ||
                          coalesce(left(nullif(split_part(full_name,' ',2),''),1),'')),
        'status', st) order by st) from status), '[]'::jsonb),
    'in',    (select count(*) from status where st='in'),
    'wfh',   (select count(*) from status where st='wfh'),
    'leave', (select count(*) from status where st='leave'),
    'out',   (select count(*) from status where st='out'),
    'total', (select count(*) from status)
  );
$$;

commit;

begin;

-- -----------------------------------------------------------------------------
-- 7. The payload — everything the tab renders, in one round trip.
--    Shape is lib/today/types.ts exactly; only the sources differ from the drop.
--
--    `pending` carries ess_action_items only. Approvals are merged by
--    /api/ess/today from lib/ess/pending.ts — see the header.
-- -----------------------------------------------------------------------------
create or replace function public.ess_today_payload(p_employee_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e            record;
  v_shift      record;
  v_week_start date := current_date - ((extract(isodow from current_date)::int) - 1);
  v_month      date := date_trunc('month', current_date)::date;
  v_prev       date := (v_month - interval '1 month')::date;
  out          jsonb;
begin
  select emp.id, emp.emp_code, emp.full_name, emp.first_name, emp.designation,
         emp.company_id, emp.company_doj, emp.date_of_birth, emp.l1_manager_id,
         d.dept_name, l.location_name,
         mgr.full_name as manager_name
    into e
    from employees emp
    left join departments d on d.id = emp.department_id
    left join locations   l on l.id = emp.location_id
    left join employees mgr on mgr.id = emp.l1_manager_id
   where emp.id = p_employee_id;

  if not found then
    return jsonb_build_object('error', 'employee not found');
  end if;

  -- The company-wide window, in place of per-employee shift columns.
  select * into v_shift from ess_shift_window();

  select jsonb_build_object(

    'employee', jsonb_build_object(
      'id', e.id, 'code', e.emp_code, 'name', e.full_name,
      'first_name', coalesce(nullif(e.first_name,''), split_part(e.full_name,' ',1)),
      'initials', upper(left(split_part(e.full_name,' ',1),1) ||
                        coalesce(left(nullif(split_part(e.full_name,' ',2),''),1),'')),
      'designation', e.designation, 'department', e.dept_name, 'location', e.location_name,
      'date_of_joining', e.company_doj, 'reports_to', e.manager_name),

    'shift', jsonb_build_object('start', to_char(v_shift.shift_start,'HH24:MI'),
                                'end',   to_char(v_shift.shift_end,'HH24:MI')),

    'prefs', coalesce((select jsonb_build_object('theme',theme,'time_format',time_format,'date_format',date_format)
                         from ess_user_preferences where employee_id = e.id),
                      jsonb_build_object('theme','auto','time_format','24','date_format','long')),

    -- today
    -- work_mode is not modelled; the tab reads null and shows nothing for it.
    'today', (select jsonb_build_object('punch_in', a.work_in, 'punch_out', a.work_out,
                                        'work_mode', null)
                from attendance_records a
               where a.employee_id = e.id and a.attendance_date = current_date),

    -- Monday..Sunday of the current week
    'week', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d::date,
               'punch_in',  a.work_in,
               'punch_out', a.work_out,
               'is_late',   coalesce(a.late_minutes,0) > 0,
               -- Sat/Sun. Replace with the shift calendar when one exists.
               'is_off',    extract(isodow from d) in (6,7),
               'hours',     round(coalesce(a.total_minutes,0)/60.0, 2))
             order by d)
        from generate_series(v_week_start, v_week_start + 6, interval '1 day') d
        left join attendance_records a
               on a.employee_id = e.id and a.attendance_date = d::date), '[]'::jsonb),

    'week_hours', coalesce((select round(sum(total_minutes)/60.0, 1) from attendance_records
                             where employee_id = e.id
                               and attendance_date between v_week_start and v_week_start + 6), 0),

    'streak', ess_attendance_streak(e.id),

    'attendance_month', (
      with mtd as (
        select count(*) filter (where work_in is not null)                    as present,
               count(*) filter (where coalesce(late_minutes,0) > 0)           as late
          from attendance_records
         where employee_id = e.id and attendance_date >= v_month and attendance_date <= current_date
      ),
      wd as (
        select count(*) as working from generate_series(v_month, current_date, interval '1 day') d
         where extract(isodow from d) between 1 and 5
      ),
      prev as (
        select count(*) filter (where work_in is not null)::numeric as p,
               greatest(count(*),1)::numeric                        as t
          from attendance_records
         where employee_id = e.id
           and attendance_date >= v_prev and attendance_date < v_month
      )
      select jsonb_build_object(
        'present', mtd.present, 'working_days', wd.working, 'late', mtd.late,
        'pct', case when wd.working > 0 then round(mtd.present * 100.0 / wd.working) end,
        'prev_pct', case when prev.t > 0 then round(prev.p * 100.0 / prev.t) end)
      from mtd, wd, prev),

    -- accrued - used, the only columns leave_balances has
    'leave', (
      select jsonb_build_object(
        'total', coalesce(sum(coalesce(lb.accrued,0) - coalesce(lb.used,0)), 0),
        'accrued_this_month', 0,
        'by_type', coalesce(jsonb_object_agg(lt.name,
                     round(coalesce(lb.accrued,0) - coalesce(lb.used,0), 1))
                     filter (where lt.name is not null), '{}'::jsonb))
        from leave_balances lb
        left join leave_types lt on lt.id = lb.leave_type_id
       where lb.employee_id = e.id),

    -- latest paid run. paid_on stays null: no payment-date column exists, and
    -- the tile shows "No payslip yet" rather than inventing one.
    'payroll', (
      select jsonb_build_object(
               'month', to_char(coalesce(r.payroll_month, current_date), 'Mon YYYY'),
               'net', coalesce(s.final_net_pay, s.net_pay, 0),
               'tds', coalesce(s.tds_amount, 0),
               'pf',  coalesce(s.epf_employee, 0),
               'paid_on', null, 'on_time', false)
        from payroll_employee_snapshot s
        join payroll_runs r on r.id = s.run_id
       where s.employee_id = e.id and lower(r.status) in ('paid','completed','finalised')
       order by r.payroll_month desc nulls last limit 1),

    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind','action','id',ai.id,'type',ai.item_type,'title',ai.title,
               'description',ai.description,'due_on',ai.due_on,
               'cta_label',ai.cta_label,'cta_route',ai.cta_route)
             order by ai.due_on nulls last)
        from ess_action_items ai
       where ai.employee_id = e.id and ai.status = 'open'), '[]'::jsonb),

    'team', ess_team_presence(e.id),

    'next_holiday', (
      select jsonb_build_object('date', h.from_date, 'name', h.name,
               'days_away', (h.from_date - current_date),
               'long_weekend', extract(isodow from h.from_date) in (1,5))
        from holiday_calendar h
       where h.from_date >= current_date
         and coalesce(lower(h.status),'active') <> 'inactive'
       order by h.from_date limit 1),

    'celebrations', coalesce((
      select jsonb_agg(x order by x.on_date) from (
        select c.id, c.full_name as name,
               upper(left(split_part(c.full_name,' ',1),1) ||
                     coalesce(left(nullif(split_part(c.full_name,' ',2),''),1),'')) as initials,
               c.kind, c.on_date as "on", c.years
          from (
            select id, full_name, 'birthday'::text as kind,
                   (date_trunc('year', current_date) + (date_of_birth - date_trunc('year', date_of_birth)))::date as on_date,
                   null::int as years
              from employees
             where id <> e.id and date_of_birth is not null
               and (date_of_leaving is null or date_of_leaving >= current_date)
            union all
            select id, full_name, 'anniversary',
                   (date_trunc('year', current_date) + (company_doj - date_trunc('year', company_doj)))::date,
                   extract(year from age(current_date, company_doj))::int
              from employees
             where id <> e.id and company_doj is not null
               and (date_of_leaving is null or date_of_leaving >= current_date)
               and extract(year from age(current_date, company_doj)) >= 1
          ) c
         where c.on_date between current_date and current_date + 30
         limit 6) x), '[]'::jsonb),

    -- receiver_employee_ids is a uuid[], not a receiver_id column
    'recognition', (
      select jsonb_build_object('badge', r.badge_ref, 'from', g.full_name,
                                'message', r.message, 'tags', to_jsonb(r.tag_refs), 'at', r.published_at)
        from recognitions r
        left join employees g on g.id = r.giver_employee_id
       where e.id = any(r.receiver_employee_ids)
         and r.is_archived = false and r.published_at is not null
       order by r.published_at desc limit 1),

    'announcements', jsonb_build_object(
      'pinned', (select jsonb_build_object('id',a.id,'title',a.title,'body',a.body,
                          'cta_label',a.cta_label,'cta_route',a.cta_route,'published_at',a.published_at)
                   from company_announcements a
                  where a.company_id = e.company_id and a.is_pinned
                    and (a.expires_at is null or a.expires_at > now())
                  order by a.published_at desc limit 1),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'body',a.body,
                 'published_at',a.published_at,
                 'unread', not exists (select 1 from announcement_reads ar
                                        where ar.announcement_id = a.id and ar.employee_id = e.id))
               order by a.published_at desc)
          from (select * from company_announcements
                 where company_id = e.company_id and not is_pinned
                   and (expires_at is null or expires_at > now())
                 order by published_at desc limit 5) a), '[]'::jsonb))

  ) into out;

  return out;
end $$;

-- -----------------------------------------------------------------------------
-- 8. RLS — DENY BY DEFAULT, deliberately not the drop's allow-all.
--     Nothing here is read from the browser: /api/ess/today, /preferences and
--     /announcements all run with the service role. An allow-all policy would
--     let anybody holding the public anon key rewrite the company's
--     announcements. Enabled with no permissive policy = no anon access.
-- -----------------------------------------------------------------------------
alter table public.ess_user_preferences  enable row level security;
alter table public.company_announcements enable row level security;
alter table public.announcement_reads    enable row level security;
alter table public.ess_action_items      enable row level security;

do $$ declare t text; begin
  foreach t in array array['ess_user_preferences','company_announcements',
                           'announcement_reads','ess_action_items'] loop
    -- if an older allow-all policy exists, take it away
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.ess_today_payload(uuid)      from public, anon, authenticated;
revoke all on function public.ess_attendance_streak(uuid)   from public, anon, authenticated;
revoke all on function public.ess_team_presence(uuid)       from public, anon, authenticated;
grant execute on function public.ess_today_payload(uuid)    to service_role;
grant execute on function public.ess_attendance_streak(uuid) to service_role;
grant execute on function public.ess_team_presence(uuid)     to service_role;

commit;

notify pgrst, 'reload schema';
