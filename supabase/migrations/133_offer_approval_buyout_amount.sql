-- 133_offer_approval_buyout_amount.sql
-- Offer approval request:
--   notice_buyout_amount  the notice-period buyout AMOUNT (₹) beside the yes/no flag
--   cc_employee_ids       employees CC'd on the HR Head approval mail (multi-select on the form)
-- Both appear in the approval mail only when present. SAFE TO RUN TWICE.
alter table public.offer_approval_requests add column if not exists notice_buyout_amount numeric;
alter table public.offer_approval_requests add column if not exists cc_employee_ids uuid[] not null default '{}';
notify pgrst, 'reload schema';
