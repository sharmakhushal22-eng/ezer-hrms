-- ============================================================
-- 019_interview_rounds.sql
-- Multi-round interview management (Interview Pipeline feature).
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
CREATE TABLE IF NOT EXISTS interview_rounds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  round_type            TEXT NOT NULL,
  round_number          INTEGER DEFAULT 1,
  interviewer_name      TEXT,
  interviewer_email     TEXT,
  status                TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','scheduled','done','rejected')),
  scheduled_at          TIMESTAMPTZ,
  interview_mode        TEXT,
  feedback_submitted_at TIMESTAMPTZ,
  recommendation        TEXT CHECK (recommendation IN ('yes','no','hold')),
  next_round_suggestion TEXT,
  suggested_interviewer TEXT,
  notes_for_recruiter   TEXT,
  overall_score         INTEGER,        -- 0–100 (avg rating * 20)
  params                JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Columns added defensively in case an older version of the table exists.
alter table public.interview_rounds
  add column if not exists interview_mode        text,
  add column if not exists suggested_interviewer text;

create index if not exists idx_interview_rounds_candidate on public.interview_rounds (candidate_id);

ALTER TABLE public.interview_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_interview_rounds" ON public.interview_rounds;
CREATE POLICY "allow_all_interview_rounds" ON public.interview_rounds
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

notify pgrst, 'reload schema';
