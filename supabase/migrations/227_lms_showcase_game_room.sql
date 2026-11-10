-- =====================================================================
-- 227_lms_showcase_game_room.sql — EZER Learn as a product people want to open: course
-- trailers and "My list" (the browsing screens), points, streaks, badges and the leaderboard,
-- and a webinar room inside EZER Learn (chat, questions, polls, attendance by time in the room).
-- Needs 206, 207, 208 and 211. Safe to run twice. Adds tables and columns; rewrites no row.
--
-- TRAILERS. A course card plays a short muted clip when the pointer rests on it.
--   lms_courses.trailer_asset_id   a VIDEO asset: a trailer uploaded for the course, or the
--                                  file of one of its own video lessons
--   lms_courses.trailer_start_s    where the clip starts inside that file
--   lms_courses.trailer_len_s      how long it plays before it loops back
-- With no trailer the screens fall back to the course's free-preview video lesson, and for a
-- course anyone may enrol in, to its first video lesson (lib/lms/me.ts).
--
-- MY LIST. lms_saved: courses a learner put aside for later.
--
-- POINTS AND BADGES are worked out from the learning record every time (lib/lms/game-core.ts),
-- so there is no ledger to drift and history counts from the first day. The company decides
-- whether they show, and whether the leaderboard names people:
--   lms_settings.game_enabled, leaderboard_enabled, leaderboard_names
--
-- THE WEBINAR ROOM. A session can be watched inside EZER Learn (a YouTube or Vimeo live
-- stream, or an HLS address) or still happen in Zoom, Meet or Teams with the room beside it.
--   lms_sessions.stream_kind / stream_url / room_*   what the room shows and allows
--   lms_session_messages    chat lines and questions (questions carry upvotes and answers)
--   lms_session_votes       one upvote per person per question
--   lms_session_polls       a question the host puts to the room, with its options
--   lms_session_poll_votes  one answer per person per poll
--   lms_session_attendees.room_seconds / room_last_beat_at   time spent in the room, credited
--                           by the server from heartbeats; enough of it marks attendance
--                           ('ROOM' joins CODE and HOST as a way attendance was recorded)
--
-- Same security as 206: RLS on with no policy. Only the /api/lms routes, with the service
-- role, read or write these tables. Live updates in the room travel over Supabase Realtime
-- broadcast, sent by the server; nothing here is opened to the public key.
-- =====================================================================

-- ── Trailers ────────────────────────────────────────────────────────────────
ALTER TABLE lms_courses ADD COLUMN IF NOT EXISTS trailer_asset_id UUID;
ALTER TABLE lms_courses ADD COLUMN IF NOT EXISTS trailer_start_s  NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE lms_courses ADD COLUMN IF NOT EXISTS trailer_len_s    INTEGER NOT NULL DEFAULT 20;
ALTER TABLE lms_courses DROP CONSTRAINT IF EXISTS lms_courses_trailer_fk;
ALTER TABLE lms_courses ADD CONSTRAINT lms_courses_trailer_fk
  FOREIGN KEY (trailer_asset_id, company_id) REFERENCES lms_assets (id, company_id);
ALTER TABLE lms_courses DROP CONSTRAINT IF EXISTS lms_courses_trailer_window_check;
ALTER TABLE lms_courses ADD CONSTRAINT lms_courses_trailer_window_check
  CHECK (trailer_start_s >= 0 AND trailer_len_s BETWEEN 5 AND 90);

-- ── My list ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_saved (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  learner_id  UUID NOT NULL,
  course_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, course_id),
  FOREIGN KEY (learner_id, company_id) REFERENCES lms_learners (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_saved_learner_idx ON lms_saved (learner_id, created_at DESC);

-- ── Points, badges, leaderboard: the company's switches ─────────────────────
ALTER TABLE lms_settings ADD COLUMN IF NOT EXISTS game_enabled        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lms_settings ADD COLUMN IF NOT EXISTS leaderboard_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lms_settings ADD COLUMN IF NOT EXISTS leaderboard_names   BOOLEAN NOT NULL DEFAULT true;   -- false: others appear as "A colleague in Sales"

-- ── The webinar room ────────────────────────────────────────────────────────
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS stream_kind TEXT NOT NULL DEFAULT 'MEETING';
ALTER TABLE lms_sessions DROP CONSTRAINT IF EXISTS lms_sessions_stream_kind_check;
ALTER TABLE lms_sessions ADD CONSTRAINT lms_sessions_stream_kind_check
  CHECK (stream_kind IN ('MEETING','YOUTUBE','VIMEO','HLS'));
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS stream_url      TEXT;                      -- the watch address for YOUTUBE, VIMEO, HLS
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS room_enabled    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS room_chat       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS room_questions  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS room_attend_pct INTEGER NOT NULL DEFAULT 50 CHECK (room_attend_pct BETWEEN 10 AND 100);  -- share of the session to stay for
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ;               -- the host pressed "Go live"
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS live_ended_at   TIMESTAMPTZ;
ALTER TABLE lms_sessions ADD COLUMN IF NOT EXISTS pinned_message_id UUID;

ALTER TABLE lms_session_attendees ADD COLUMN IF NOT EXISTS room_seconds      NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE lms_session_attendees ADD COLUMN IF NOT EXISTS room_last_beat_at TIMESTAMPTZ;
ALTER TABLE lms_session_attendees DROP CONSTRAINT IF EXISTS lms_session_attendees_attendance_by_check;
ALTER TABLE lms_session_attendees ADD CONSTRAINT lms_session_attendees_attendance_by_check
  CHECK (attendance_by IS NULL OR attendance_by IN ('CODE','HOST','ROOM'));

CREATE TABLE IF NOT EXISTS lms_session_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL,
  session_id   UUID NOT NULL,
  learner_id   UUID,                                         -- null when the host writes from the Studio without a learner record
  author_name  TEXT NOT NULL,
  is_host      BOOLEAN NOT NULL DEFAULT false,
  kind         TEXT NOT NULL CHECK (kind IN ('CHAT','QUESTION')),
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  anonymous    BOOLEAN NOT NULL DEFAULT false,               -- a question asked without a name on it (the host still sees who)
  upvotes      INTEGER NOT NULL DEFAULT 0,
  answered_at  TIMESTAMPTZ,
  answer       TEXT,
  hidden_at    TIMESTAMPTZ,                                  -- removed by the host
  hidden_by_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (session_id, company_id) REFERENCES lms_sessions (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_session_messages_session_idx ON lms_session_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS lms_session_votes (
  message_id  UUID NOT NULL REFERENCES lms_session_messages (id) ON DELETE CASCADE,
  learner_id  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, learner_id)
);

CREATE TABLE IF NOT EXISTS lms_session_polls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  session_id  UUID NOT NULL,
  question    TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  options     JSONB NOT NULL,                                -- ["Yes","No","Not sure"], 2 to 6
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  show_results BOOLEAN NOT NULL DEFAULT true,                -- learners see the split once they answer
  created_by_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  UNIQUE (id, company_id),
  FOREIGN KEY (session_id, company_id) REFERENCES lms_sessions (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_session_polls_session_idx ON lms_session_polls (session_id, created_at);

CREATE TABLE IF NOT EXISTS lms_session_poll_votes (
  poll_id     UUID NOT NULL REFERENCES lms_session_polls (id) ON DELETE CASCADE,
  learner_id  UUID NOT NULL,
  option_idx  INTEGER NOT NULL CHECK (option_idx BETWEEN 0 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, learner_id)
);

ALTER TABLE lms_saved              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_session_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_session_votes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_session_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_session_poll_votes ENABLE ROW LEVEL SECURITY;
