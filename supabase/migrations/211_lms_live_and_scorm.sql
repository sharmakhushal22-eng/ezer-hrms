-- =====================================================================
-- 211_lms_live_and_scorm.sql — webinars (live sessions) and SCORM packages in EZER Learn.
-- Needs 206, 207 and 208. Safe to run twice. Adds two tables and three columns, widens two
-- CHECK lists, and changes one default; it rewrites no existing row except the one noted.
--
-- (209 and 210 are taken by the PMS branch, origin/TusharPanwar.)
--
-- LIVE SESSIONS. The call itself happens in the company's own Zoom, Meet or Teams; EZER
-- Learn keeps the schedule, the invitations, attendance and the recording.
--   lms_sessions           one webinar: when, the meeting link, seats, the recording
--   lms_session_attendees  one person's place on it: invited or registered, whether they
--                          came, how much of the recording they watched, which mails went
-- A course can hold a LIVE lesson. It is done when the learner attended any session run for
-- that course (lms_sessions.course_id), or watched enough of one of its recordings.
--
-- SCORM. A package is uploaded as one .zip into the private bucket and stays one object:
-- the player reads each file out of the zip with range requests (lib/lms/scorm.ts), so
-- nothing is unpacked and the bucket's allowed types do not change.
--   lms_assets.scorm            the manifest: version, launch file, title, mastery score,
--                               and where each file sits inside the zip
--   lms_lesson_progress.scorm   the learner's SCORM run-time data (suspend data, location,
--                               status, score), so they resume where they stopped
--
-- Same security as 206: RLS on with no policy. Only the /api/lms routes, with the service
-- role, read or write these tables.
-- =====================================================================

-- ── Lesson and file kinds ───────────────────────────────────────────────────
-- 206 declared these CHECKs inline, so Postgres named them <table>_kind_check.
ALTER TABLE lms_lessons DROP CONSTRAINT IF EXISTS lms_lessons_kind_check;
ALTER TABLE lms_lessons ADD CONSTRAINT lms_lessons_kind_check
  CHECK (kind IN ('VIDEO','AUDIO','DOCUMENT','SLIDES','ARTICLE','LINK','ASSESSMENT','SCORM','LIVE'));

ALTER TABLE lms_assets DROP CONSTRAINT IF EXISTS lms_assets_kind_check;
ALTER TABLE lms_assets ADD CONSTRAINT lms_assets_kind_check
  CHECK (kind IN ('VIDEO','AUDIO','DOCUMENT','IMAGE','OTHER','SCORM'));

ALTER TABLE lms_assets          ADD COLUMN IF NOT EXISTS scorm JSONB;
ALTER TABLE lms_lesson_progress ADD COLUMN IF NOT EXISTS scorm JSONB;

-- ── The manager hears on the first overdue day, not after a week ───────────
-- Only rows still on the old default move; a company that chose its own number keeps it.
ALTER TABLE lms_settings ALTER COLUMN escalate_after_days SET DEFAULT 1;
UPDATE lms_settings SET escalate_after_days = 1 WHERE escalate_after_days = 7;

-- ── Live sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  course_id          UUID,                                   -- counts for that course's LIVE lessons
  host_name          TEXT,
  host_employee_id   UUID,
  starts_at          TIMESTAMPTZ NOT NULL,
  duration_min       INTEGER NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 600),
  join_url           TEXT,                                   -- the Zoom, Meet or Teams link
  location           TEXT,                                   -- or a room, for one held in person
  capacity           INTEGER CHECK (capacity IS NULL OR capacity > 0),
  open_registration  BOOLEAN NOT NULL DEFAULT false,         -- anyone in the company may sign up
  status             TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CANCELLED','COMPLETED')),
  checkin_code       TEXT,                                   -- read out during the call; typing it marks attendance
  recording_asset_id UUID,
  sequence           INTEGER NOT NULL DEFAULT 0,             -- calendar SEQUENCE: bumped on every change mailed out
  cancel_reason      TEXT,
  created_by_id      UUID,
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  UNIQUE (id, company_id),
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id),
  FOREIGN KEY (recording_asset_id, company_id) REFERENCES lms_assets (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_sessions_company_idx ON lms_sessions (company_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS lms_sessions_course_idx  ON lms_sessions (course_id) WHERE course_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lms_session_attendees (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL,
  session_id             UUID NOT NULL,
  learner_id             UUID NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','REGISTERED','DECLINED','REMOVED')),
  source                 TEXT NOT NULL DEFAULT 'INVITED' CHECK (source IN ('INVITED','SELF')),
  invited_by_name        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_at          TIMESTAMPTZ,
  joined_at              TIMESTAMPTZ,                        -- pressed Join in EZER Learn (a hint for the host)
  attended               BOOLEAN NOT NULL DEFAULT false,
  attended_at            TIMESTAMPTZ,
  attendance_by          TEXT CHECK (attendance_by IS NULL OR attendance_by IN ('CODE','HOST')),
  marked_by_name         TEXT,
  recording_opened_at    TIMESTAMPTZ,
  recording_last_beat_at TIMESTAMPTZ,
  recording_watched_s    NUMERIC NOT NULL DEFAULT 0,
  recording_position_s   NUMERIC NOT NULL DEFAULT 0,
  recording_done         BOOLEAN NOT NULL DEFAULT false,
  invite_mailed_at       TIMESTAMPTZ,
  invite_mailed_seq      INTEGER,                            -- the session.sequence that mail carried
  day_before_mailed_at   TIMESTAMPTZ,
  same_day_mailed_at     TIMESTAMPTZ,
  missed_mailed_at       TIMESTAMPTZ,
  UNIQUE (session_id, learner_id),
  FOREIGN KEY (session_id, company_id) REFERENCES lms_sessions (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id, company_id) REFERENCES lms_learners (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_session_attendees_learner_idx ON lms_session_attendees (learner_id);

ALTER TABLE lms_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_session_attendees ENABLE ROW LEVEL SECURITY;
