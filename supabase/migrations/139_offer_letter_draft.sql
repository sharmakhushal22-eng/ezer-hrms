-- 139_offer_letter_draft.sql
-- ===========================================================================
-- The HR Manager can save an offer letter as a DRAFT, come back to it, finalise
-- it, and only then send. Until now offer_letters only ever held rows that had
-- already gone out: both writers insert status 'SENT' at the moment of sending,
-- so there was nowhere to keep work in progress.
--
-- WHY A LINK COLUMN
--
-- offer_letters references candidate_id but NOT the approval request it came
-- from. With one draft per candidate that is survivable; with a revised offer to
-- the same candidate it is not — the second draft cannot be told from the first,
-- and loading "the draft for this request" has to guess. offer_request_id makes
-- the belonging explicit, the same way hr_manager_id (137) made the assignment
-- explicit instead of leaning on an email string.
--
-- status is TEXT with no CHECK constraint (verified against the live table), so
-- DRAFT and FINAL need no constraint change. Existing rows stay 'SENT' and are
-- untouched.
--
--   DRAFT  saved, still editable
--   FINAL  locked, ready to send
--   SENT   dispatched (what every existing row already is)
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

alter table public.offer_letters
  add column if not exists offer_request_id uuid references public.offer_approval_requests(id) on delete set null;

-- The Offer Letter screen loads "the draft for this request" on every open.
create index if not exists idx_offer_letters_request
  on public.offer_letters (offer_request_id)
  where offer_request_id is not null;

comment on column public.offer_letters.offer_request_id is
  'The offer_approval_requests row this letter was generated from. Lets a DRAFT be found again, and keeps a revised offer distinct from the one it replaces.';

notify pgrst, 'reload schema';
