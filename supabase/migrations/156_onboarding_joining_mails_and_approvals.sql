-- 156_onboarding_joining_mails_and_approvals.sql
-- Joining-day mails and the four-team onboarding approval.
--
--   candidates.prep_mail_sent_at      2 days before joining: IT / Admin / HR Ops / HR Manager were
--                                     told to prepare the givables (cron offer-followup)
--   candidates.welcome_mail_sent_at   the day before joining: the candidate got the welcome mail,
--                                     the day's schedule and the greeting PDF
--   candidates.link_reminder_sent_at  joining day: the HR Manager was reminded to send the
--                                     onboarding link, when none had gone out yet
--   onboarding_approvals              after the candidate submits the onboarding form, IT, Admin,
--                                     Payroll and the HR Manager each approve (or return) it; the
--                                     employee code is generated when all four have approved
--   onboarding_day_schedules          a company's joining-day programme (optional; a default is
--                                     used when there is no row)

alter table public.candidates
  add column if not exists prep_mail_sent_at     timestamptz,
  add column if not exists welcome_mail_sent_at  timestamptz,
  add column if not exists link_reminder_sent_at timestamptz;

create table if not exists public.onboarding_approvals (
  id            uuid primary key default gen_random_uuid(),
  onboarding_id uuid not null references public.onboarding_candidates(id) on delete cascade,
  team          text not null check (team in ('IT','ADMIN','PAYROLL','HR_MANAGER')),
  status        text not null default 'PENDING' check (status in ('PENDING','APPROVED','RETURNED')),
  acted_by      uuid,
  acted_by_name text,
  remark        text,
  acted_at      timestamptz,
  created_at    timestamptz not null default now(),
  unique (onboarding_id, team)
);
create index if not exists onboarding_approvals_status_idx on public.onboarding_approvals(status, team);

create table if not exists public.onboarding_day_schedules (
  company_id    uuid primary key,
  report_time   text not null default '09:30',
  venue         text,
  contact_name  text,
  contact_phone text,
  items         jsonb not null default '[]'::jsonb,   -- [{ "time": "09:30", "title": "...", "detail": "..." }]
  updated_at    timestamptz not null default now()
);

comment on table public.onboarding_approvals is 'Per-team sign-off on a submitted onboarding form. All four APPROVED → employee code generated (lib/onboarding/approvals.ts).';
comment on table public.onboarding_day_schedules is 'Joining-day programme per company for the welcome mail and greeting PDF. No row → the default programme in lib/onboarding/joining-day.ts.';

-- Service-role access everywhere, like the other onboarding tables.
alter table public.onboarding_approvals enable row level security;
alter table public.onboarding_day_schedules enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'onboarding_approvals' and policyname = 'allow_all') then
    create policy allow_all on public.onboarding_approvals for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'onboarding_day_schedules' and policyname = 'allow_all') then
    create policy allow_all on public.onboarding_day_schedules for all using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
