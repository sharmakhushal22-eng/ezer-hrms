-- 123_role_screen_access.sql
-- ===========================================================================
-- ROLE-WISE SUB-MODULE (TAB) VISIBILITY.
--
-- FOR: Nayan Ahuja. ONE TABLE + AN IDEMPOTENT SEED. SAFE TO RUN TWICE.
--
-- role_permissions already decides which top-level MODULES a role can open
-- (Recruitment, Payroll, …). This adds the next level down: which TABS inside a
-- module a role may see — e.g. an L1 Manager who holds Recruitment should see
-- only the MRF tab, not Pipeline / Negotiation / Offers.
--
-- Model (see lib/rms/resolve.ts canSeeScreen):
--   • A row here means "this role may see this tab" (can_view).
--   • A module is "configured" for a role the moment it has ANY row for that
--     module. Only then are that module's other tabs hidden. A module with no
--     rows stays fully visible — so nothing breaks until it is deliberately
--     restricted. Super admins are never restricted.
--
-- screen_key is `${moduleKey}.${tabKey}`, matching lib/rms/screens.ts.
-- ===========================================================================

create table if not exists public.role_screen_access (
  role_id     uuid not null references public.ess_roles(id) on delete cascade,
  screen_key  text not null,
  can_view    boolean not null default true,
  updated_at  timestamptz default now(),
  primary key (role_id, screen_key)
);

alter table public.role_screen_access enable row level security;
drop policy if exists "allow_all_role_screen_access" on public.role_screen_access;
create policy "allow_all_role_screen_access" on public.role_screen_access
  for all to anon, authenticated using (true) with check (true);

comment on table public.role_screen_access is
  'Per-role sub-module (tab) visibility. A row = the role may see that tab. A module with no rows for a role is fully visible; one or more rows restrict it to the listed tabs. screen_key = moduleKey.tabKey (lib/rms/screens.ts).';

-- ── SEED — from Khushal''s Role-wise Access sheet (Recruitment) ──────────────
-- Restricts the reporting-manager roles to MRF only, gives the Hiring Manager
-- the pipeline side, and CFO/MD a dashboard-only view. HR Head / HR Manager /
-- super-admin are intentionally left unconfigured, so they see every tab.
insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  -- L1 / L2 / HOD: raise MRFs only (their interview feedback happens in ESS)
  ('L1_MANAGER','recruitment.mrf'),
  ('L2_MANAGER','recruitment.mrf'),
  ('HOD','recruitment.mrf'),
  -- Hiring Manager / Recruiter: everything except the HR-Head console
  ('RECRUITER','recruitment.dashboard'),
  ('RECRUITER','recruitment.mrf'),
  ('RECRUITER','recruitment.screening'),
  ('RECRUITER','recruitment.pipeline'),
  ('RECRUITER','recruitment.negotiation'),
  ('RECRUITER','recruitment.offerapproval'),
  ('RECRUITER','recruitment.sendoffer'),
  ('RECRUITER','recruitment.offers'),
  ('RECRUITER','recruitment.preonboarding'),
  ('RECRUITER','recruitment.jobstatus'),
  -- CFO / MD: reports / dashboard view only
  ('CFO','recruitment.dashboard'),
  ('MD','recruitment.dashboard')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;

-- ── Make sure the restricted roles can actually OPEN Recruitment ─────────────
-- The screen restriction only bites once a role is inside the module. L1 / L2 /
-- HOD / CFO / MD are given Recruitment module VIEW so they reach the module and
-- then see only their permitted tab(s). DO NOTHING never downgrades a role that
-- already has a higher level (e.g. an existing EDIT/FULL stays).
insert into public.role_permissions (role_id, module, access_level)
select r.id, 'Recruitment', 'VIEW'
from public.ess_roles r
where r.role_code in ('L1_MANAGER','L2_MANAGER','HOD','CFO','MD')
on conflict (role_id, module) do nothing;
