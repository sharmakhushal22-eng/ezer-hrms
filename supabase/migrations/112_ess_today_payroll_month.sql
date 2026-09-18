-- =============================================================================
-- 112_ess_today_payroll_month.sql
-- ess_today_payload() fails on its own payroll block. One function replaced.
--
-- FOR: Nayan Ahuja. NO SCHEMA CHANGE. SAFE TO RUN TWICE.
--
-- THE SYMPTOM
--
--     select ess_today_payload('<employee uuid>');
--     ERROR:  COALESCE types integer and date cannot be matched
--
-- The whole Today tab 500s. Not one card — the payload is built in a single
-- jsonb_build_object, so one bad expression takes all sixteen keys with it.
--
-- THE CAUSE, WHICH IS MINE
--
-- I wrote
--
--     to_char(coalesce(r.payroll_month, current_date), 'Mon YYYY')
--
-- assuming payroll_runs.payroll_month was a date. It is an INTEGER — a month
-- number — and there is a matching payroll_year beside it. Coalescing an
-- integer with a date is a type error, and Postgres raises it when the function
-- runs rather than when it is created, so 111 installed cleanly and only failed
-- on first use.
--
-- THE FIX
--
--     to_char(make_date(r.payroll_year, r.payroll_month, 1), 'Mon YYYY')
--
-- and the ordering follows the same two columns instead of treating one of them
-- as a date. Everything else in the function is 111's, unchanged.
--
-- WHY I DID NOT CATCH IT
--
-- payroll_employee_snapshot and payroll_runs are both empty, so no test row
-- would have reached this branch either way — but the type error is raised on
-- parse of the expression, not on rows, so simply calling the function once
-- would have found it. I verified the four functions were locked down and that
-- employees was untouched, and did not build the payload itself until after
-- handing it over.
--
-- DEPENDS ON 111.
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

notify pgrst, 'reload schema';
