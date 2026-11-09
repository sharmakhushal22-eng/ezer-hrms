-- 207_exit_lwd_controls.sql
-- ===========================================================================
-- Exit: the employee's tentative last working day, an LWD at every approval, the HR Manager
-- changing the LWD after approval, and the HR Manager waiving the notice period.
--
-- SAFE TO RUN TWICE (add column if not exists).
--
--   tentative_lwd           the last working day the employee proposes when they resign
--                           (ESS → HR Services → Exit). Every approver sees it.
--   lwd_history             every change of the final LWD after approval:
--                           [{ from, to, reason, by, by_name, at }]
--   notice_waived_days      notice days the HR Manager waived (0 … notice_period_days);
--   notice_waiver_reason,   the waived days are not recovered in the F&F and are taken off
--   notice_waived_by(_name), notice_shortfall_days.
--   notice_waived_at
--
-- Each approver's own LWD is already kept per stage in resignation_stage_log.proposed_lwd
-- (071); managers now always approve with a date (app/api/ess/approvals).
-- ===========================================================================

alter table public.employee_resignation add column if not exists tentative_lwd date;
alter table public.employee_resignation add column if not exists lwd_history jsonb not null default '[]'::jsonb;
alter table public.employee_resignation add column if not exists notice_waived_days integer not null default 0;
alter table public.employee_resignation add column if not exists notice_waiver_reason text;
alter table public.employee_resignation add column if not exists notice_waived_by uuid references public.employees(id);
alter table public.employee_resignation add column if not exists notice_waived_by_name text;
alter table public.employee_resignation add column if not exists notice_waived_at timestamptz;

NOTIFY pgrst, 'reload schema';
