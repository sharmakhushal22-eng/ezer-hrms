-- 141_merge_offer_letter_screen.sql
-- ===========================================================================
-- Send Offers and Offer Letter are one tab now.
--
-- They always rendered the SAME component (HRManagerSendOffer) with two
-- different props — readOnly, and scopeToMe. The distinction was never about
-- the screen; it was about who was looking at it. So the page now renders one
-- tab and decides from the viewer's role: a recruiter sees every offer in
-- flight read-only, the assigned HR Manager gets draft / finalise / send.
--
-- WHICH KEY SURVIVED, AND WHY
--
-- 'recruitment.sendoffer'. Live, RECRUITER and HR_MANAGER BOTH hold it, while
-- only HR_MANAGER holds 'recruitment.offerletter'. Keeping sendoffer therefore
-- needed no grant to move for the tab to stay visible to anyone. Keeping
-- offerletter instead would have hidden the screen from every recruiter until
-- this migration ran — and a change that breaks before its migration is applied
-- is the wrong way round.
--
-- So this file is CLEANUP, not a prerequisite. The merge works without it; this
-- removes rows that now point at a screen key the catalogue no longer lists.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- Belt and braces: make sure every role that held ONLY the old key keeps the
-- screen. Today that set is empty (HR_MANAGER holds both), but seeding order is
-- not guaranteed across environments, and losing a tab silently is exactly the
-- failure this is written to avoid. Runs before the delete for the same reason.
insert into public.role_screen_access (role_id, screen_key, can_view)
select rsa.role_id, 'recruitment.sendoffer', true
from public.role_screen_access rsa
where rsa.screen_key = 'recruitment.offerletter'
  and not exists (
    select 1 from public.role_screen_access x
    where x.role_id = rsa.role_id and x.screen_key = 'recruitment.sendoffer'
  )
on conflict do nothing;

-- The catalogue (lib/rms/screens.ts) no longer lists recruitment.offerletter,
-- so these rows grant a screen that cannot be rendered or configured. Harmless
-- but misleading: the admin matrix would never show them, and
-- recruitment-authority.test.ts asserts every seeded key is a real screen.
delete from public.role_screen_access
where screen_key = 'recruitment.offerletter';

comment on table public.role_screen_access is
  'Role → sub-module (screen) visibility. screen_key must exist in lib/rms/screens.ts; recruitment.offerletter was removed in 141 when Send Offers and Offer Letter merged into recruitment.sendoffer.';

notify pgrst, 'reload schema';
