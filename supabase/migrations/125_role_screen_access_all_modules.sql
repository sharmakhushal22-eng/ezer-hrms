-- 125_role_screen_access_all_modules.sql
-- Tab-level (sub-module) restrictions for modules BEYOND Recruitment, from
-- Khushal's Role-Access sheet. Recruitment stays as migration 123 (L1/L2/HOD = MRF only).
-- A row = the role may see that tab; a module with rows is restricted to just those tabs
-- (canSeeScreen, lib/rms/resolve.ts). Idempotent. Safe to run twice.
insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  ('HR_HEAD', 'travel.HR'),
  ('CHRO', 'travel.HR'),
  ('IT', 'payroll.admin'),
  ('L1_MANAGER', 'pms.overview'),
  ('L1_MANAGER', 'pms.fill'),
  ('L1_MANAGER', 'pms.upload'),
  ('L1_MANAGER', 'pms.pip'),
  ('L1_MANAGER', 'pms.reports'),
  ('L1_MANAGER', 'attendance.assign'),
  ('L1_MANAGER', 'attendance.records'),
  ('L1_MANAGER', 'travel.RM'),
  ('L1_MANAGER', 'holidays.hol'),
  ('L1_MANAGER', 'holidays.prev'),
  ('L2_MANAGER', 'pms.overview'),
  ('L2_MANAGER', 'pms.fill'),
  ('L2_MANAGER', 'pms.upload'),
  ('L2_MANAGER', 'pms.pip'),
  ('L2_MANAGER', 'pms.reports'),
  ('L2_MANAGER', 'attendance.assign'),
  ('L2_MANAGER', 'attendance.records'),
  ('L2_MANAGER', 'travel.RM'),
  ('L2_MANAGER', 'holidays.hol'),
  ('L2_MANAGER', 'holidays.prev'),
  ('HOD', 'pms.overview'),
  ('HOD', 'pms.fill'),
  ('HOD', 'pms.upload'),
  ('HOD', 'pms.pip'),
  ('HOD', 'pms.reports'),
  ('HOD', 'attendance.assign'),
  ('HOD', 'attendance.records'),
  ('HOD', 'travel.RM'),
  ('HOD', 'holidays.hol'),
  ('HOD', 'holidays.prev'),
  ('FINANCE_EXECUTIVE', 'payroll.reports'),
  ('FINANCE_EXECUTIVE', 'travel.HR'),
  ('FINANCE_EXECUTIVE', 'travel.FINANCE'),
  ('FINANCE_EXECUTIVE', 'travel.RATES'),
  ('FINANCE_EXECUTIVE', 'travel.PERIODS'),
  ('FINANCE_EXECUTIVE', 'flexi.approvals'),
  ('FINANCE_EXECUTIVE', 'flexi.submit'),
  ('BRANCH_HR', 'attendance.assign'),
  ('BRANCH_HR', 'attendance.records'),
  ('BRANCH_EXEC', 'attendance.assign'),
  ('BRANCH_EXEC', 'attendance.records'),
  ('BRANCH_HR', 'holidays.hol'),
  ('BRANCH_HR', 'holidays.prev'),
  ('BRANCH_EXEC', 'holidays.hol'),
  ('BRANCH_EXEC', 'holidays.prev')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;
