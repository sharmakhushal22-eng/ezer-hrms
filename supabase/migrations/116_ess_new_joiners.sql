-- =============================================================================
-- 116_ess_new_joiners.sql
-- New joiners on the ESS Home → Recognition card.
--
-- FOR: Nayan Ahuja. ADDS TWO TABLES, ONE TRIGGER, TWO FUNCTIONS. SAFE TO RUN TWICE.
-- DEPENDS ON: 021 (ess_kudos, ess_accounts), employees, departments.
--
-- WHAT THIS IS FOR
--
-- Home asks for a list of the people who have just joined the company, with
-- their name, designation and department, and a button for a colleague to
-- CONGRATULATE them. Congratulate, not wish — a joining is an achievement, not
-- a date that came round again, and the copy everywhere below says so.
--
-- HOW A NEW JOINER IS IDENTIFIED, AND WHY IT IS NOT JUST ONE COLUMN
--
-- The rule we were given is "a new joiner is someone HR has just generated a
-- unique code for". In this schema that event is the INSERT of the employee's
-- ess_accounts row — /api/ess-auth/admin/generate issues the code and creates
-- exactly that row, with the emp_code as the temporary password.
--
-- Taken alone that rule does not survive contact with the data. ess_accounts
-- was populated in three bulk runs, not one row at a time:
--
--     2026-07-03     1
--     2026-07-11   133
--     2026-07-14     1
--     2026-08-19   134
--     2026-08-23     1
--     2026-09-10   128      <- five days ago
--
-- Those are backfills of people who have worked here for years. A plain "code
-- issued in the last 30 days" rule would have announced 128 of our 398 staff
-- as new joiners on the day this shipped, which is the kind of wrong that
-- destroys the card's credibility in one look.
--
-- So the code-issue is the TRIGGER and the joining date is the QUALIFIER:
-- issuing a code puts someone forward, and they are only announced if they
-- actually started recently (qualify_days, default 90). Both numbers live in
-- ess_new_joiner_settings so this is a policy change, not a code change.
--
-- Employees with no company_doj — there are a few — fall back to how recently
-- their employee row itself was created, which is the only other evidence of
-- newness we hold.
--
-- WHY A LEDGER TABLE RATHER THAN A VIEW OVER ess_accounts
--
-- Three reasons, all of them things a view cannot do:
--   1. Re-issuing a password must not re-announce someone. The app upserts on
--      employee_id, so a reset is an UPDATE; an AFTER INSERT trigger fires
--      once, on the first code only, and `on conflict do nothing` makes even
--      that idempotent.
--   2. HR needs to be able to take a wrongly-flagged person down. That is the
--      is_hidden column; a view has nowhere to record the decision.
--   3. It freezes what was true at the moment of announcing. If somebody's DOJ
--      is corrected later the announcement does not silently vanish.
-- =============================================================================

-- ── settings ────────────────────────────────────────────────────────────────
-- One row, enforced by the primary key. announce_days is how long a joiner
-- stays on the card; qualify_days is how recently they must have started for a
-- freshly issued code to count as a joining at all.
create table if not exists public.ess_new_joiner_settings (
  id             boolean primary key default true check (id),
  announce_days  integer not null default 30 check (announce_days between 1 and 365),
  qualify_days   integer not null default 90 check (qualify_days  between 1 and 365),
  updated_at     timestamptz not null default now()
);

insert into public.ess_new_joiner_settings (id) values (true)
on conflict (id) do nothing;

-- ── the ledger ──────────────────────────────────────────────────────────────
create table if not exists public.ess_new_joiners (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null unique references public.employees(id) on delete cascade,
  code_issued_at timestamptz not null,          -- when HR generated the code
  joined_on      date,                          -- company_doj as it stood then
  source         text not null default 'TRIGGER'
                 check (source in ('TRIGGER','BACKFILL','MANUAL')),
  is_hidden      boolean not null default false,
  hidden_by      uuid,
  hidden_at      timestamptz,
  hidden_reason  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ess_new_joiners_issued
  on public.ess_new_joiners (code_issued_at desc) where is_hidden = false;

-- Congratulations are read back per (sender, joiner) to disable the button
-- once it has been pressed, and the Recognition feed reads every kudo a person
-- has received. Neither path had an index.
create index if not exists idx_ess_kudos_to_created
  on public.ess_kudos (to_employee_id, created_at desc);
create index if not exists idx_ess_kudos_from_to_badge
  on public.ess_kudos (from_employee_id, to_employee_id, badge);

alter table public.ess_new_joiners          enable row level security;
alter table public.ess_new_joiner_settings  enable row level security;
do $$ declare t text;
begin
  foreach t in array array['ess_new_joiners','ess_new_joiner_settings'] loop
    execute format('drop policy if exists "allow_all_%s" on public.%I', t, t);
    execute format('create policy "allow_all_%s" on public.%I for all to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── the trigger: issuing a code puts someone forward ────────────────────────
create or replace function public.ess_mark_new_joiner()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  emp       record;
  v_qualify integer := coalesce((select qualify_days from ess_new_joiner_settings limit 1), 90);
begin
  select id, company_doj, created_at, date_of_leaving, is_test
    into emp from employees where id = new.employee_id;

  if not found                        then return new; end if;
  if emp.date_of_leaving is not null  then return new; end if;   -- already left
  if coalesce(emp.is_test, false)     then return new; end if;   -- seed data

  -- The qualifier. Without it, every bulk credential run announces the company.
  if not (
       (emp.company_doj is not null and emp.company_doj >= current_date - v_qualify)
    or (emp.company_doj is null and emp.created_at >= now() - make_interval(days => v_qualify))
  ) then
    return new;
  end if;

  insert into ess_new_joiners (employee_id, code_issued_at, joined_on, source)
  values (new.employee_id, coalesce(new.created_at, now()), emp.company_doj, 'TRIGGER')
  on conflict (employee_id) do nothing;

  return new;
end $$;

drop trigger if exists trg_ess_mark_new_joiner on public.ess_accounts;
create trigger trg_ess_mark_new_joiner
after insert on public.ess_accounts
for each row execute function public.ess_mark_new_joiner();

-- ── backfill: the same rule, applied to codes already issued ────────────────
-- On today's data this admits the handful who genuinely started inside the
-- qualifying window and rejects all three bulk runs, which is the point.
insert into public.ess_new_joiners (employee_id, code_issued_at, joined_on, source)
select a.employee_id, a.created_at, emp.company_doj, 'BACKFILL'
  from public.ess_accounts a
  join public.employees   emp on emp.id = a.employee_id
 cross join lateral (select coalesce((select qualify_days from public.ess_new_joiner_settings limit 1), 90) as d) s
 where emp.date_of_leaving is null
   and coalesce(emp.is_test, false) = false
   and (
        (emp.company_doj is not null and emp.company_doj >= current_date - s.d)
     or (emp.company_doj is null and emp.created_at >= now() - make_interval(days => s.d))
   )
on conflict (employee_id) do nothing;

-- ── the feed the Home card reads ────────────────────────────────────────────
-- Returns a jsonb array, newest joiner first, carrying exactly what the card
-- shows: name, designation, department — plus whether THIS viewer has already
-- congratulated them, so the button can render as done.
--
-- Scoped to the viewer's own company and never includes the viewer.
create or replace function public.ess_new_joiners_feed(p_employee_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select id, company_id from employees where id = p_employee_id
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
       and (me.company_id is null or emp.company_id = me.company_id)
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

-- ── HR escape hatch ─────────────────────────────────────────────────────────
-- Takes a wrongly-flagged person off the card (or puts them back) without
-- anybody having to write an UPDATE by hand.
create or replace function public.ess_set_new_joiner_hidden(
  p_employee_id uuid, p_hidden boolean, p_by uuid default null, p_reason text default null)
returns boolean
language sql volatile security definer set search_path = public as $$
  update ess_new_joiners
     set is_hidden     = p_hidden,
         hidden_by     = case when p_hidden then p_by     end,
         hidden_at     = case when p_hidden then now()    end,
         hidden_reason = case when p_hidden then p_reason end
   where employee_id = p_employee_id
  returning true;
$$;

notify pgrst, 'reload schema';
