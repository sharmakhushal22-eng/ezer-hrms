-- =============================================================================
-- 117_ess_today_recognition_all.sql
-- Recognition on ESS Home shows ALL of it, and carries the new joiners.
--
-- FOR: Nayan Ahuja. NO SCHEMA CHANGE. ONE FUNCTION REPLACED. SAFE TO RUN TWICE.
-- DEPENDS ON 111, 112, 113, 114 AND 116 (ess_new_joiners_feed).
--
-- RUN 116 FIRST. This function calls ess_new_joiners_feed() and will not
-- create without it.
--
-- TWO CHANGES, BOTH ADDITIVE
--
-- 1. 'recognitions' — the whole list instead of `limit 1`, and from both
--    places recognition is actually stored. The old key read `recognitions`
--    (Wall of Fame awards, 3 rows company-wide) and never looked at ess_kudos,
--    where every peer kudo and wish in the system lives. So the card showed
--    "No kudos yet" to people who had been thanked repeatedly.
--
-- 2. 'new_joiners' — name, designation and department of everyone recently
--    issued a code, with a flag for whether this viewer has already
--    congratulated them.
--
-- The old 'recognition' key is untouched and still returns the single newest
-- award, so a client that has not been updated keeps working.
--
-- Everything else in the payload is carried over from 114 verbatim.
-- =============================================================================

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
    -- accrued - used, the only columns leave_balances has.
    --
    -- SUMMED PER TYPE FIRST. jsonb_object_agg raises `duplicate key value` the
    -- moment the same key appears twice, and an employee can hold more than one
    -- balance row for a leave type — one per financial year, for instance. The
    -- grouping makes that impossible instead of leaving it to the data.
    'leave', (
      with per_type as (
        select lt.name as type_name,
               sum(coalesce(lb.accrued,0) - coalesce(lb.used,0)) as bal
          from leave_balances lb
          left join leave_types lt on lt.id = lb.leave_type_id
         where lb.employee_id = e.id
         group by lt.name
      )
      select jsonb_build_object(
        'total', coalesce(round(sum(bal), 1), 0),
        'accrued_this_month', 0,
        'by_type', coalesce(jsonb_object_agg(type_name, round(bal, 1))
                     filter (where type_name is not null), '{}'::jsonb))
        from per_type),

    -- latest paid run. paid_on stays null: no payment-date column exists, and
    -- the tile shows "No payslip yet" rather than inventing one.
    'payroll', (
      select jsonb_build_object(
               -- payroll_month and payroll_year are INTEGERS, not a date. The
               -- first version coalesced payroll_month with current_date and
               -- Postgres refused the whole payload:
               --   COALESCE types integer and date cannot be matched
               'month', to_char(make_date(r.payroll_year, r.payroll_month, 1), 'Mon YYYY'),
               'net', coalesce(s.final_net_pay, s.net_pay, 0),
               'tds', coalesce(s.tds_amount, 0),
               'pf',  coalesce(s.epf_employee, 0),
               -- No payment-date column exists, so this stays null and the tile
               -- reads "No payslip yet" rather than inventing a date.
               'paid_on', null, 'on_time', false)
        from payroll_employee_snapshot s
        join payroll_runs r on r.id = s.run_id
       where s.employee_id = e.id and lower(r.status) in ('paid','completed','finalised')
       order by r.payroll_year desc nulls last, r.payroll_month desc nulls last
       limit 1),

    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind','action','id',ai.id,'type',ai.item_type,'title',ai.title,
               'description',ai.description,'due_on',ai.due_on,
               'cta_label',ai.cta_label,'cta_route',ai.cta_route)
             order by ai.due_on nulls last)
        from ess_action_items ai
       where ai.employee_id = e.id and ai.status = 'open'), '[]'::jsonb),

    'team', ess_team_presence(e.id),

    -- holiday_entries, not holiday_calendar.
    --
    -- holiday_calendar is the FY HEADER — one row called "FY 2026-27 Holiday
    -- Calendar" spanning 1 Apr to 31 Mar. Reading it as though it listed the
    -- holidays gave a single "holiday" a year long, and because its from_date
    -- was in the past the card simply never appeared. The dates live in
    -- holiday_entries, keyed to a calendar, and the label is `description`.
    --
    -- Optional holidays are excluded: several may fall on the same day and a
    -- card headed "next holiday" should name the one the office is closed for.
    -- The calendar's own status is deliberately not filtered — the only one
    -- here is DRAFT, and dropping it would mean the card never rendered at all.
    'next_holiday', (
      select jsonb_build_object('date', h.holiday_date, 'name', h.description,
               'days_away', (h.holiday_date - current_date),
               'long_weekend', extract(isodow from h.holiday_date) in (1,5))
        from holiday_entries h
       where h.holiday_date >= current_date
         and coalesce(h.is_optional, false) = false
       order by h.holiday_date limit 1),

    -- Birthdays and work anniversaries in the next 30 days.
    --
    -- The keys are built explicitly rather than aggregating the row. The first
    -- version aliased on_date to "on" in the inner select and then ordered the
    -- outer by x.on_date — a column that no longer existed at that level, so
    -- the whole payload failed with `column x.on_date does not exist`.
    -- Naming each key here keeps the sort column and the output name separate.
    'celebrations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'name', x.name, 'initials', x.initials,
               'kind', x.kind, 'on', x.on_date, 'years', x.years)
             order by x.on_date)
        from (
          select c.id, c.full_name as name,
                 upper(left(split_part(c.full_name,' ',1),1) ||
                       coalesce(left(nullif(split_part(c.full_name,' ',2),''),1),'')) as initials,
                 c.kind, c.on_date, c.years
            from (
              select id, full_name, 'birthday'::text as kind,
                     (date_trunc('year', current_date)
                       + (date_of_birth - date_trunc('year', date_of_birth)))::date as on_date,
                     null::int as years
                from employees
               where id <> e.id and date_of_birth is not null
                 and (date_of_leaving is null or date_of_leaving >= current_date)
              union all
              select id, full_name, 'anniversary',
                     (date_trunc('year', current_date)
                       + (company_doj - date_trunc('year', company_doj)))::date,
                     extract(year from age(current_date, company_doj))::int
                from employees
               where id <> e.id and company_doj is not null
                 and (date_of_leaving is null or date_of_leaving >= current_date)
                 and extract(year from age(current_date, company_doj)) >= 1
            ) c
           where c.on_date between current_date and current_date + 30
           order by c.on_date
           limit 6) x), '[]'::jsonb),

    -- receiver_employee_ids is a uuid[], not a receiver_id column
    --
    -- KEPT, UNCHANGED, DELIBERATELY. The card reads `recognitions` now, but
    -- older clients still read this key and a payload that drops it would
    -- blank their card. It is the newest entry of the list below.
    'recognition', (
      select jsonb_build_object('badge', r.badge_ref, 'from', g.full_name,
                                'message', r.message, 'tags', to_jsonb(r.tag_refs), 'at', r.published_at)
        from recognitions r
        left join employees g on g.id = r.giver_employee_id
       where e.id = any(r.receiver_employee_ids)
         and r.is_archived = false and r.published_at is not null
       order by r.published_at desc limit 1),

    -- EVERY recognition this person has received, newest first.
    --
    -- Two sources, because recognition arrives by two doors and the card was
    -- only watching one:
    --
    --   'wall'  — recognitions, the Wall of Fame awards. What the old single
    --             `recognition` key read. Three rows exist company-wide.
    --   'kudos' — ess_kudos, peer-to-peer. Every birthday wish, anniversary
    --             note, thank-you and JOINING congratulation lands here.
    --
    -- Reading only the first meant almost everybody saw "No kudos yet" while
    -- holding a pile of kudos, because theirs were in the second. `source` is
    -- carried through so the card can style an award differently from a
    -- colleague's note.
    --
    -- Capped at 50: this is a Home card, not an archive, and the payload is
    -- fetched on every portal mount.
    'recognitions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'source', f.source, 'badge', f.badge,
               'from', f.from_name, 'from_id', f.from_id,
               'message', f.message, 'tags', f.tags, 'at', f.at)
             order by f.at desc)
        from (
          select r.id, 'wall'::text as source, r.badge_ref as badge,
                 g.full_name as from_name, g.id as from_id,
                 r.message, to_jsonb(r.tag_refs) as tags, r.published_at as at
            from recognitions r
            left join employees g on g.id = r.giver_employee_id
           where e.id = any(r.receiver_employee_ids)
             and r.is_archived = false and r.published_at is not null
          union all
          select k.id, 'kudos'::text, k.badge,
                 coalesce(g.full_name, 'A colleague'), g.id,
                 k.message, null::jsonb, k.created_at
            from ess_kudos k
            left join employees g on g.id = k.from_employee_id
           where k.to_employee_id = e.id
          order by at desc nulls last
          limit 50) f), '[]'::jsonb),

    -- The people HR has just issued a code to. See 116 for why the code-issue
    -- alone is not the test.
    'new_joiners', ess_new_joiners_feed(e.id),

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

notify pgrst, 'reload schema';
