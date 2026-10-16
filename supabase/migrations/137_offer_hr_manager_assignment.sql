-- 137_offer_hr_manager_assignment.sql
-- ===========================================================================
-- The HR Head names the HR Manager who will issue the offer letter, at the
-- moment they give final approval — the same shape as assigning a hiring
-- manager when they approve the MRF.
--
-- WHY A NEW COLUMN WHEN hr_manager_email ALREADY EXISTS
--
-- 005 created offer_approval_requests with `hr_manager_email TEXT` and
-- `hr_manager_accepted_at`. Only the second is ever written (stamped when the
-- offer is sent). hr_manager_email has never been populated by any code path.
--
-- An email string cannot carry this: it cannot be scoped against, cannot gate a
-- screen, and cannot be validated against a role. The requisition side learned
-- the same lesson — the dashboard once assigned a recruiter by typing an address
-- into assigned_recruiter, and nothing ever reached that person because the
-- queue reads assigned_recruiter_ids. So this adds the id, and leaves
-- hr_manager_email as the human-readable echo beside it, exactly as
-- assigned_recruiter sits beside assigned_recruiter_ids.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- The employee who will generate and send the offer letter. Chosen by the HR
-- Head at final approval; the Offer Letter screen scopes to it.
alter table public.offer_approval_requests
  add column if not exists hr_manager_id uuid references public.employees(id);

-- The Offer Letter screen filters "offers assigned to me" on every load, and the
-- HR Head's console filters by company; without this that becomes a scan.
create index if not exists idx_offer_approval_requests_hr_manager
  on public.offer_approval_requests (hr_manager_id)
  where hr_manager_id is not null;

comment on column public.offer_approval_requests.hr_manager_id is
  'Employee who issues the offer letter, set by the HR Head at final approval. hr_manager_email is the display echo of this.';

notify pgrst, 'reload schema';
