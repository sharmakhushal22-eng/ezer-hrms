-- 206_joiner_ctc_master_backfill.sql
-- ===========================================================================
-- Payroll CTC (ctc_master) for joiners who came through onboarding.
--
-- SAFE TO RUN TWICE (on conflict do nothing — an existing row is never changed).
--
-- Payroll, ESS → Payroll → Flexi Benefits and the appraisal read an employee's CTC from
-- ctc_master only, which was filled by the salary bulk upload alone. Joiners whose code was
-- generated in onboarding had no row, so Flexi Benefits showed "Not on record" for the annual
-- CTC and variable pay (reported for STC9101, 01-Nov-2026). From now on Generate code writes
-- the row (lib/onboarding/ctc-master.ts); this fills it for the joiners coded before that.
--
-- Figures: the offer the candidate accepted — the recruitment negotiation, with the HR Head's
-- revision when there is one — the same as the appointment letter's Annexure A.
-- ===========================================================================

insert into public.ctc_master (employee_id, company_id, fy, effective_from, annual_ctc, annual_variable, basic_annual, hra_annual, epf_wage_limit, status)
values
  -- STC0005 Yash Dhawan
  ('13ac4f35-62b6-40d6-a1cd-f16d33699d7f', '96b6ec21-f545-4bcd-82b6-1a1f8e5e19da', '2026-27', null, 2200000, 220000, 990000, 396000, 15000, 'ACTIVE'),
  -- STC9101 Girish Sharma
  ('0c1ba939-b023-4d16-bbef-dde836264d79', '96b6ec21-f545-4bcd-82b6-1a1f8e5e19da', '2026-27', '2026-10-23', 1500000, 100000, 700000, 280000, 15000, 'ACTIVE'),
  -- STC0003 Flowtest Data Engineer
  ('00c81c7d-c1f5-4c5f-8980-e732cdaf5a26', '96b6ec21-f545-4bcd-82b6-1a1f8e5e19da', '2026-27', '2026-11-01', 1400000, 140000, 630000, 252000, 15000, 'ACTIVE')
on conflict (employee_id, fy) do nothing;

NOTIFY pgrst, 'reload schema';
