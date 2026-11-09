-- 201_recruitment_reports_screen.sql
-- ===========================================================================
-- RECRUITMENT -> "Reports" TAB VISIBILITY.
--
-- SAFE TO RUN TWICE.
--
-- Adds one screen_key: recruitment.reports — every recruitment report (MRF register,
-- ageing, funnel, candidates, sources, rejections, interviews, interviewer turnaround,
-- negotiations, offer approvals, offers, documents, joining, recruiter performance, audit)
-- as an Excel download, built by app/api/recruitment/reports from the data the viewer may
-- already see.
--
-- Why a migration: canSeeScreen() (lib/rms/resolve.ts) is default-visible only while a
-- module has NO screen rows for the viewer's roles. RECRUITER has explicit recruitment.*
-- rows (migrations 123 / 142), so without this row the tab would be hidden from them.
-- HR Head / HR Manager / super admin are deliberately left unconfigured (see 142): they
-- already see every tab, and a row for them would start hiding the others.
--
-- Same (role code, screen key) tuple shape as 123 / 142, which
-- lib/rms/__tests__/recruitment-authority.test.ts parses.
-- ===========================================================================

insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  ('RECRUITER','recruitment.reports')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;
