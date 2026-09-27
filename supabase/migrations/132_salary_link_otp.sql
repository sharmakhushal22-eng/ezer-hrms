-- 132_salary_link_otp.sql
-- ===========================================================================
-- EMAIL-OTP GATE ON THE CANDIDATE SALARY LINK. SAFE TO RUN TWICE.
--
-- Opening /salary-view/<token> now shows a login step first: the candidate's
-- registered email (candidates.email, masked) with "Send OTP"; the 6-digit code
-- is verified before any salary figure is loaded. Same mechanics as the
-- document-collection link (migration 129).
-- ===========================================================================
alter table public.ctc_negotiations add column if not exists otp_hash        text;
alter table public.ctc_negotiations add column if not exists otp_expires_at  timestamptz;
alter table public.ctc_negotiations add column if not exists otp_attempts    integer not null default 0;
alter table public.ctc_negotiations add column if not exists otp_verified_at timestamptz;
notify pgrst, 'reload schema';
