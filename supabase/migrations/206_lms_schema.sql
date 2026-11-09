-- =====================================================================
-- 206_lms_schema.sql — EZER Learn: the self-paced learning module.
--
-- NEW TABLES ONLY. Nothing existing is altered or dropped. Safe to run twice.
-- Run in order: 206 (tables) → 207 (engine functions) → 208 (roles and seeds).
-- Design and rationale: docs/lms/ARCHITECTURE.md.
--
-- THE SHAPE
--
--   Catalogue   lms_categories → lms_courses → lms_course_versions
--   Content     lms_modules → lms_lessons (+ lms_lesson_resources)
--               lms_quizzes → lms_questions        lms_assets (file metadata only)
--   Programmes  lms_paths → lms_path_items
--   Who         lms_learners (one row per person: employee OR pre-joining candidate)
--               lms_candidate_access (the candidate's link, OTP and session state)
--   Giving out  lms_assignments → lms_assignment_items + lms_assignment_targets
--   Doing       lms_enrollments → lms_lesson_progress + lms_quiz_attempts
--               lms_path_enrollments
--   Proof       lms_certificates, lms_feedback, lms_reminder_log, lms_audit_log
--
-- A course is a stable identity; what a learner studies is a VERSION of it. Publishing
-- freezes a version (see the trigger below), and an enrolment pins the version it started
-- on, so editing a live course can never change what someone is halfway through.
--
-- SECURITY
--
-- ESS employees are not Supabase auth users, so auth.uid() cannot identify them and RLS
-- cannot express "this employee's own row". Every read and write therefore goes through
-- the /api/lms routes with the service-role key, and those routes decide who may do what
-- (lib/lms/access.ts). RLS is ON with NO policy, so the anon key every browser holds
-- reads and writes nothing here — the EZER Sign pattern (174), deliberately stricter than
-- the older allow-all tables, because this holds assessment results and quiz answers.
--
-- Tenant isolation is enforced twice. The routes pin every query to a company through
-- companyFilter(), and the composite foreign keys below (…, company_id) make it impossible
-- at the database level for a row of one company to point at a row of another.
--
-- STORAGE: private bucket `lms-content`. No storage policies exist, so a file is only
-- reachable through a short-lived signed URL minted after the entitlement check. Video
-- files never enter Postgres; lms_assets holds their metadata.
-- =====================================================================

-- ── Settings ────────────────────────────────────────────────────────────────
-- One row per company, created on first use. Every default a course or assignment form
-- starts from lives here, so a company changes behaviour without a deploy.
CREATE TABLE IF NOT EXISTS lms_settings (
  company_id               UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  default_pass_pct         INTEGER NOT NULL DEFAULT 70  CHECK (default_pass_pct BETWEEN 0 AND 100),
  default_media_pct        INTEGER NOT NULL DEFAULT 90  CHECK (default_media_pct BETWEEN 10 AND 100),
  default_max_attempts     INTEGER DEFAULT 3            CHECK (default_max_attempts IS NULL OR default_max_attempts > 0),
  default_due_days         INTEGER NOT NULL DEFAULT 14  CHECK (default_due_days > 0),
  publish_requires_review  BOOLEAN NOT NULL DEFAULT false,   -- four eyes: an author cannot publish their own course
  managers_can_assign      BOOLEAN NOT NULL DEFAULT true,    -- a manager may assign published courses to their reports
  managers_see_scores      BOOLEAN NOT NULL DEFAULT true,
  reminder_days_before     INTEGER[] NOT NULL DEFAULT '{7,3,1}',
  overdue_every_days       INTEGER NOT NULL DEFAULT 3   CHECK (overdue_every_days > 0),
  escalate_after_days      INTEGER NOT NULL DEFAULT 7   CHECK (escalate_after_days >= 0),   -- overdue this long → tell the manager
  email_enabled            BOOLEAN NOT NULL DEFAULT true,
  certificates_enabled     BOOLEAN NOT NULL DEFAULT true,
  cert_title               TEXT NOT NULL DEFAULT 'Certificate of Completion',
  cert_signatory_name      TEXT,
  cert_signatory_title     TEXT,
  preboarding_enabled      BOOLEAN NOT NULL DEFAULT true,
  preboarding_link_days    INTEGER NOT NULL DEFAULT 30  CHECK (preboarding_link_days BETWEEN 1 AND 180),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               TEXT
);

-- ── Catalogue ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lms_categories_name_uq ON lms_categories (company_id, lower(name));

-- Metadata for one uploaded file. The bytes live in object storage, never in Postgres.
-- `provider` is the seam for moving video to a streaming service later without touching
-- a lesson: a CLOUDFLARE_STREAM row carries external_ref instead of storage_path.
CREATE TABLE IF NOT EXISTS lms_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('VIDEO','AUDIO','DOCUMENT','IMAGE','OTHER')),
  provider        TEXT NOT NULL DEFAULT 'SUPABASE' CHECK (provider IN ('SUPABASE','CLOUDFLARE_STREAM')),
  storage_path    TEXT,
  external_ref    TEXT,
  poster_path     TEXT,
  -- One shared signed URL per file, rotated daily. A per-viewer token would never warm the
  -- CDN, so every play of every employee would count as uncached egress.
  play_url        TEXT,
  play_url_expires_at TIMESTAMPTZ,
  original_name   TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT,
  duration_s      NUMERIC,
  status          TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','READY','FAILED','DELETED')),
  created_by_id   UUID,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_assets_company_idx ON lms_assets (company_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS lms_courses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,                       -- "CRS-0007"; the key used in Excel imports
  title                 TEXT NOT NULL,
  summary               TEXT,
  description           TEXT,
  category_id           UUID,
  thumbnail_asset_id    UUID,
  language              TEXT NOT NULL DEFAULT 'English',
  difficulty            TEXT NOT NULL DEFAULT 'BEGINNER' CHECK (difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  est_minutes           INTEGER,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  skills                TEXT[] NOT NULL DEFAULT '{}',        -- names from the existing `skills` master
  status                TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_version_id  UUID,
  -- Who can FIND it. Separate from who is made to DO it: EVERYONE puts it in the catalogue
  -- for all, RESTRICTED for lms_course_audience only, HIDDEN only reaches people by assignment.
  visibility            TEXT NOT NULL DEFAULT 'EVERYONE' CHECK (visibility IN ('EVERYONE','RESTRICTED','HIDDEN')),
  enrolment_mode        TEXT NOT NULL DEFAULT 'SELF' CHECK (enrolment_mode IN ('SELF','APPROVAL','ASSIGN_ONLY')),
  is_compliance         BOOLEAN NOT NULL DEFAULT false,      -- counted in compliance reporting
  is_featured           BOOLEAN NOT NULL DEFAULT false,      -- HR's pick; feeds recommendations
  validity_months       INTEGER CHECK (validity_months IS NULL OR validity_months > 0),   -- recertify after this long
  renew_before_days     INTEGER NOT NULL DEFAULT 30 CHECK (renew_before_days >= 0),
  certificate_enabled   BOOLEAN NOT NULL DEFAULT true,
  publish_at            TIMESTAMPTZ,                         -- scheduled publish, run by the daily job
  retire_at             TIMESTAMPTZ,                         -- course expiry: archived by the daily job
  created_by_id         UUID,
  created_by_name       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at           TIMESTAMPTZ,
  UNIQUE (id, company_id),
  UNIQUE (company_id, code),
  FOREIGN KEY (category_id, company_id) REFERENCES lms_categories (id, company_id),
  FOREIGN KEY (thumbnail_asset_id, company_id) REFERENCES lms_assets (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_courses_catalogue_idx ON lms_courses (company_id, status, visibility);

-- Who a RESTRICTED course is visible to. Same vocabulary as lms_assignment_targets.
CREATE TABLE IF NOT EXISTS lms_course_audience (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  course_id  UUID NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('DEPARTMENT','DESIGNATION','LOCATION','GRADE','EMPLOYMENT_TYPE','EMPLOYEE_CATEGORY','TEAM')),
  value      TEXT NOT NULL,
  label      TEXT,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id) ON DELETE CASCADE,
  UNIQUE (course_id, kind, value)
);

CREATE TABLE IF NOT EXISTS lms_course_prerequisites (
  company_id         UUID NOT NULL,
  course_id          UUID NOT NULL,
  requires_course_id UUID NOT NULL,
  PRIMARY KEY (course_id, requires_course_id),
  CHECK (course_id <> requires_course_id),
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (requires_course_id, company_id) REFERENCES lms_courses (id, company_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lms_course_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  course_id           UUID NOT NULL,
  version_no          INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','PUBLISHED','SUPERSEDED')),
  -- SEQUENTIAL lesson by lesson · MODULE_SEQUENTIAL modules in order, lessons free within · FREE any order
  order_mode          TEXT NOT NULL DEFAULT 'SEQUENTIAL' CHECK (order_mode IN ('SEQUENTIAL','MODULE_SEQUENTIAL','FREE')),
  -- ALL_REQUIRED every required lesson · PERCENT completion_pct of them · FINAL_ONLY the final assessment alone
  completion_mode     TEXT NOT NULL DEFAULT 'ALL_REQUIRED' CHECK (completion_mode IN ('ALL_REQUIRED','PERCENT','FINAL_ONLY')),
  completion_pct      INTEGER NOT NULL DEFAULT 100 CHECK (completion_pct BETWEEN 1 AND 100),
  require_all_quizzes BOOLEAN NOT NULL DEFAULT true,
  require_final       BOOLEAN NOT NULL DEFAULT false,
  min_overall_pct     INTEGER CHECK (min_overall_pct IS NULL OR min_overall_pct BETWEEN 0 AND 100),
  change_note         TEXT,
  submitted_by_id     UUID,
  submitted_by_name   TEXT,
  submitted_at        TIMESTAMPTZ,
  reviewed_by_name    TEXT,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  published_by_name   TEXT,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  UNIQUE (course_id, version_no),
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id) ON DELETE CASCADE
);
-- A course has at most one version being worked on.
CREATE UNIQUE INDEX IF NOT EXISTS lms_versions_one_draft_uq ON lms_course_versions (course_id) WHERE status IN ('DRAFT','IN_REVIEW');
CREATE UNIQUE INDEX IF NOT EXISTS lms_versions_one_live_uq  ON lms_course_versions (course_id) WHERE status = 'PUBLISHED';

DO $$ BEGIN
  ALTER TABLE lms_courses
    ADD CONSTRAINT lms_courses_published_version_fk
    FOREIGN KEY (published_version_id, company_id) REFERENCES lms_course_versions (id, company_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Content (all of it hangs off a version, so all of it freezes with it) ───
CREATE TABLE IF NOT EXISTS lms_modules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL,
  version_id        UUID NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  unlock_after_days INTEGER CHECK (unlock_after_days IS NULL OR unlock_after_days >= 0),   -- drip: days after the learner starts
  source_module_id  UUID,                                    -- the module this was cloned from
  UNIQUE (id, company_id),
  FOREIGN KEY (version_id, company_id) REFERENCES lms_course_versions (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_modules_version_idx ON lms_modules (version_id, position);

CREATE TABLE IF NOT EXISTS lms_quizzes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL,
  version_id         UUID NOT NULL,
  title              TEXT NOT NULL,
  instructions       TEXT,
  pass_pct           INTEGER NOT NULL DEFAULT 70 CHECK (pass_pct BETWEEN 0 AND 100),
  max_attempts       INTEGER CHECK (max_attempts IS NULL OR max_attempts > 0),     -- NULL = unlimited
  cooldown_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_minutes >= 0),     -- wait between attempts
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  shuffle_questions  BOOLEAN NOT NULL DEFAULT false,
  shuffle_options    BOOLEAN NOT NULL DEFAULT false,
  draw_count         INTEGER CHECK (draw_count IS NULL OR draw_count > 0),         -- N random questions of the pool
  show_answers       TEXT NOT NULL DEFAULT 'AFTER_PASS' CHECK (show_answers IN ('NEVER','AFTER_SUBMIT','AFTER_PASS')),
  -- Attempts used up: LOCK waits for HR to grant more, REWATCH resets them once the
  -- learner has rewatched the lesson.
  on_exhausted       TEXT NOT NULL DEFAULT 'LOCK' CHECK (on_exhausted IN ('LOCK','REWATCH')),
  source_quiz_id     UUID,
  UNIQUE (id, company_id),
  FOREIGN KEY (version_id, company_id) REFERENCES lms_course_versions (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_quizzes_version_idx ON lms_quizzes (version_id);

-- options: [{ "id": "a", "text": "…", "correct": true }]. `correct` and `accepted` never
-- leave the server before a submission; lib/lms/quiz.ts builds the learner's paper.
CREATE TABLE IF NOT EXISTS lms_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL,
  quiz_id        UUID NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'SINGLE' CHECK (kind IN ('SINGLE','MULTI','TRUE_FALSE','SHORT_TEXT')),
  prompt         TEXT NOT NULL,
  explanation    TEXT,
  marks          NUMERIC NOT NULL DEFAULT 1 CHECK (marks > 0),
  position       INTEGER NOT NULL DEFAULT 0,
  options        JSONB NOT NULL DEFAULT '[]',
  accepted       TEXT[] NOT NULL DEFAULT '{}',               -- SHORT_TEXT: auto-graded, case-insensitive
  partial_credit BOOLEAN NOT NULL DEFAULT false,             -- MULTI: marks pro rata instead of all-or-nothing
  UNIQUE (id, company_id),
  FOREIGN KEY (quiz_id, company_id) REFERENCES lms_quizzes (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_questions_quiz_idx ON lms_questions (quiz_id, position);

CREATE TABLE IF NOT EXISTS lms_lessons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL,
  version_id        UUID NOT NULL,
  module_id         UUID NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('VIDEO','AUDIO','DOCUMENT','SLIDES','ARTICLE','LINK','ASSESSMENT')),
  position          INTEGER NOT NULL DEFAULT 0,
  is_required       BOOLEAN NOT NULL DEFAULT true,
  is_final          BOOLEAN NOT NULL DEFAULT false,          -- this is the final assessment
  is_preview        BOOLEAN NOT NULL DEFAULT false,          -- viewable from the catalogue before enrolling
  est_minutes       INTEGER,
  asset_id          UUID,
  external_url      TEXT,
  body              TEXT,                                    -- ARTICLE text, plain with line breaks
  media_pct         INTEGER NOT NULL DEFAULT 90 CHECK (media_pct BETWEEN 10 AND 100),   -- share to watch or hear
  allow_skip_ahead  BOOLEAN NOT NULL DEFAULT false,          -- may seek past what has been watched
  min_seconds       INTEGER NOT NULL DEFAULT 0 CHECK (min_seconds >= 0),                -- time on a document or link
  require_ack       BOOLEAN NOT NULL DEFAULT false,          -- "I have read and understood" attestation
  ack_text          TEXT,
  quiz_id           UUID,
  quiz_required     BOOLEAN NOT NULL DEFAULT true,           -- must be passed; false = optional knowledge check
  source_lesson_id  UUID,                                    -- what this was cloned from; carries progress across versions
  UNIQUE (id, company_id),
  FOREIGN KEY (version_id, company_id) REFERENCES lms_course_versions (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (module_id, company_id) REFERENCES lms_modules (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, company_id) REFERENCES lms_assets (id, company_id),
  FOREIGN KEY (quiz_id, company_id) REFERENCES lms_quizzes (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_lessons_module_idx  ON lms_lessons (module_id, position);
CREATE INDEX IF NOT EXISTS lms_lessons_version_idx ON lms_lessons (version_id);
CREATE INDEX IF NOT EXISTS lms_lessons_source_idx  ON lms_lessons (source_lesson_id);

CREATE TABLE IF NOT EXISTS lms_lesson_resources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  lesson_id  UUID NOT NULL,
  title      TEXT NOT NULL,
  asset_id   UUID,
  url        TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  CHECK ((asset_id IS NOT NULL) <> (url IS NOT NULL)),
  FOREIGN KEY (lesson_id, company_id) REFERENCES lms_lessons (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, company_id) REFERENCES lms_assets (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_resources_lesson_idx ON lms_lesson_resources (lesson_id);

-- A published version never changes. Enforced here rather than in the routes, so a bug
-- in a route or a hand-run statement cannot rewrite what somebody has been certified on.
CREATE OR REPLACE FUNCTION lms_guard_frozen_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_version UUID;
  v_status  TEXT;
BEGIN
  IF TG_TABLE_NAME IN ('lms_modules','lms_lessons','lms_quizzes') THEN
    v_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  ELSIF TG_TABLE_NAME = 'lms_questions' THEN
    SELECT version_id INTO v_version FROM lms_quizzes
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.quiz_id ELSE NEW.quiz_id END;
  ELSE
    SELECT version_id INTO v_version FROM lms_lessons
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.lesson_id ELSE NEW.lesson_id END;
  END IF;
  -- A cascade from the version itself finds no row: nothing left to protect.
  SELECT status INTO v_status FROM lms_course_versions WHERE id = v_version;
  IF v_status IN ('PUBLISHED','SUPERSEDED') THEN
    RAISE EXCEPTION 'LMS: version % is published and cannot change. Start a new version.', v_version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lms_modules','lms_lessons','lms_quizzes','lms_questions','lms_lesson_resources'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_frozen ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_frozen BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lms_guard_frozen_version()', t, t);
  END LOOP;
END $$;

-- ── Learning paths ──────────────────────────────────────────────────────────
-- A separate entity from a course: a course teaches, a path sequences courses and tracks
-- them as one programme. Each course keeps its own enrolment, completion and certificate.
CREATE TABLE IF NOT EXISTS lms_paths (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  title               TEXT NOT NULL,
  summary             TEXT,
  category_id         UUID,
  order_mode          TEXT NOT NULL DEFAULT 'SEQUENTIAL' CHECK (order_mode IN ('SEQUENTIAL','FLEXIBLE')),
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  visibility          TEXT NOT NULL DEFAULT 'EVERYONE' CHECK (visibility IN ('EVERYONE','HIDDEN')),
  enrolment_mode      TEXT NOT NULL DEFAULT 'ASSIGN_ONLY' CHECK (enrolment_mode IN ('SELF','ASSIGN_ONLY')),
  certificate_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  UNIQUE (company_id, code),
  FOREIGN KEY (category_id, company_id) REFERENCES lms_categories (id, company_id)
);

CREATE TABLE IF NOT EXISTS lms_path_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  path_id     UUID NOT NULL,
  course_id   UUID NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (path_id, course_id),
  FOREIGN KEY (path_id, company_id) REFERENCES lms_paths (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_path_items_course_idx ON lms_path_items (course_id);

-- ── Learners ────────────────────────────────────────────────────────────────
-- ONE identity for the whole learning record. A candidate and the employee they become
-- are the same row: conversion sets employee_id here, and every enrolment, attempt and
-- certificate carries over without being rewritten.
CREATE TABLE IF NOT EXISTS lms_learners (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (kind IN ('EMPLOYEE','CANDIDATE')),
  employee_id             UUID REFERENCES employees(id) ON DELETE SET NULL,
  onboarding_candidate_id UUID,
  recruit_candidate_id    UUID,
  full_name               TEXT NOT NULL,
  email                   TEXT,
  designation             TEXT,
  department_id           UUID,
  date_of_joining         DATE,
  status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  converted_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  -- Per company, not global: a group transfer starts a new record in the new legal entity,
  -- and the old one stays where it was earned. Achievements read across both.
  UNIQUE (company_id, employee_id)
);
CREATE INDEX IF NOT EXISTS lms_learners_company_idx    ON lms_learners (company_id, kind);
CREATE INDEX IF NOT EXISTS lms_learners_email_idx      ON lms_learners (company_id, lower(email));
CREATE INDEX IF NOT EXISTS lms_learners_onboarding_idx ON lms_learners (onboarding_candidate_id);

-- The candidate's way in. The link is a bearer secret, so only its SHA-256 is kept, and
-- the OTP only as an HMAC (the esign pattern). session_version is bumped to end every
-- session at once when access is revoked or a new link is issued.
CREATE TABLE IF NOT EXISTS lms_candidate_access (
  learner_id       UUID PRIMARY KEY REFERENCES lms_learners(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash       TEXT UNIQUE NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  otp_hmac         TEXT,
  otp_expires_at   TIMESTAMPTZ,
  otp_attempts     INTEGER NOT NULL DEFAULT 0,
  otp_sent_count   INTEGER NOT NULL DEFAULT 0,
  session_version  INTEGER NOT NULL DEFAULT 1,
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by_name  TEXT,
  last_login_at    TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
);

-- ── Assignments ─────────────────────────────────────────────────────────────
-- An assignment is the INSTRUCTION; lms_enrollments are its results. Storing the audience
-- as rules rather than a list of 2,000 ids keeps a company-wide assignment one row plus
-- one target, and it still records who asked for what, when, and why.
--
--   ONCE      a snapshot: whoever matches today
--   DYNAMIC   today's matches, and anyone who matches later (the daily sweep)
--   ON_JOIN   new joiners matching the audience; this is also an onboarding template
--   PREBOARD  pre-joining candidates matching the audience
CREATE TABLE IF NOT EXISTS lms_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  trigger_type        TEXT NOT NULL DEFAULT 'ONCE' CHECK (trigger_type IN ('ONCE','DYNAMIC','ON_JOIN','PREBOARD')),
  source              TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','IMPORT','MANAGER')),
  mandatory           BOOLEAN NOT NULL DEFAULT true,
  priority            TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
  due_mode            TEXT NOT NULL DEFAULT 'AFTER_ASSIGN' CHECK (due_mode IN ('NONE','FIXED','AFTER_ASSIGN','AFTER_JOIN','BEFORE_JOIN')),
  due_date            DATE,
  due_days            INTEGER CHECK (due_days IS NULL OR due_days >= 0),
  start_at            TIMESTAMPTZ,                           -- scheduled assignment; NULL = now
  join_window_days    INTEGER NOT NULL DEFAULT 30 CHECK (join_window_days >= 0),  -- ON_JOIN: how far back a joiner still counts
  reminder_every_days INTEGER CHECK (reminder_every_days IS NULL OR reminder_every_days > 0),
  include_completed   BOOLEAN NOT NULL DEFAULT false,        -- retake: also enrol people who already completed
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('SCHEDULED','ACTIVE','PAUSED','CANCELLED')),
  note                TEXT,
  created_by_id       UUID,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at        TIMESTAMPTZ,
  cancelled_by_name   TEXT,
  last_applied_at     TIMESTAMPTZ,
  enrolled_count      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_assignments_company_idx ON lms_assignments (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS lms_assignment_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  assignment_id UUID NOT NULL,
  course_id     UUID,
  path_id       UUID,
  position      INTEGER NOT NULL DEFAULT 0,
  due_days      INTEGER CHECK (due_days IS NULL OR due_days >= 0),   -- overrides the assignment's, for staged templates
  CHECK ((course_id IS NOT NULL) <> (path_id IS NOT NULL)),
  FOREIGN KEY (assignment_id, company_id) REFERENCES lms_assignments (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id),
  FOREIGN KEY (path_id, company_id) REFERENCES lms_paths (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_assignment_items_idx ON lms_assignment_items (assignment_id);

-- Rows of the same kind are ORed, different kinds are ANDed, so "Sales or Ops, in Pune" is
-- two DEPARTMENT rows and a LOCATION row. EMPLOYEE rows always add that person. `exclude`
-- rows take people out again. See lms_audience_employees (207).
CREATE TABLE IF NOT EXISTS lms_assignment_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  assignment_id UUID NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('COMPANY','EMPLOYEE','DEPARTMENT','DESIGNATION','LOCATION','TEAM','MANAGER','GRADE','EMPLOYMENT_TYPE','EMPLOYEE_CATEGORY','CONFIRMATION_STATUS')),
  value         TEXT NOT NULL DEFAULT '',
  label         TEXT,
  exclude       BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY (assignment_id, company_id) REFERENCES lms_assignments (id, company_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lms_assignment_targets_idx ON lms_assignment_targets (assignment_id);

-- ── Enrolments and progress ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_path_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  learner_id      UUID NOT NULL,
  path_id         UUID NOT NULL,
  assignment_id   UUID,
  status          TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','WAIVED','CANCELLED')),
  mandatory       BOOLEAN NOT NULL DEFAULT false,
  due_at          TIMESTAMPTZ,
  progress_pct    NUMERIC NOT NULL DEFAULT 0,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (id, company_id),
  FOREIGN KEY (learner_id, company_id) REFERENCES lms_learners (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (path_id, company_id) REFERENCES lms_paths (id, company_id),
  FOREIGN KEY (assignment_id, company_id) REFERENCES lms_assignments (id, company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lms_path_enrollments_open_uq ON lms_path_enrollments (learner_id, path_id) WHERE status IN ('NOT_STARTED','IN_PROGRESS');

-- A completed enrolment is history and is never reopened: a retake or a renewal is a new
-- row with the next cycle_no, so the record of every past completion survives.
CREATE TABLE IF NOT EXISTS lms_enrollments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL,
  learner_id         UUID NOT NULL,
  course_id          UUID NOT NULL,
  version_id         UUID NOT NULL,
  assignment_id      UUID,
  path_enrollment_id UUID,
  source             TEXT NOT NULL DEFAULT 'SELF' CHECK (source IN ('SELF','ASSIGNED','MANAGER','IMPORT','RENEWAL','RETAKE')),
  status             TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('PENDING_APPROVAL','REJECTED','NOT_STARTED','IN_PROGRESS','COMPLETED','FAILED','EXPIRED','WAIVED','CANCELLED')),
  mandatory          BOOLEAN NOT NULL DEFAULT false,
  priority           TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
  due_at             TIMESTAMPTZ,
  cycle_no           INTEGER NOT NULL DEFAULT 1,
  progress_pct       NUMERIC NOT NULL DEFAULT 0,
  score_pct          NUMERIC,
  enrolled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,                            -- completion lapses here (validity_months)
  renewal_of         UUID,
  last_lesson_id     UUID,
  last_activity_at   TIMESTAMPTZ,
  assigned_by_id     UUID,
  assigned_by_name   TEXT,
  decided_by_name    TEXT,                                   -- enrolment approval, waiver
  decision_note      TEXT,
  notified_at        TIMESTAMPTZ,                            -- the "you have new learning" mail has gone
  last_escalated_at  TIMESTAMPTZ,
  UNIQUE (id, company_id),
  FOREIGN KEY (learner_id, company_id) REFERENCES lms_learners (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id),
  FOREIGN KEY (version_id, company_id) REFERENCES lms_course_versions (id, company_id),
  FOREIGN KEY (assignment_id, company_id) REFERENCES lms_assignments (id, company_id),
  FOREIGN KEY (path_enrollment_id, company_id) REFERENCES lms_path_enrollments (id, company_id)
);
-- One live enrolment per person per course: what makes every bulk insert safely repeatable.
CREATE UNIQUE INDEX IF NOT EXISTS lms_enrollments_open_uq ON lms_enrollments (learner_id, course_id)
  WHERE status IN ('PENDING_APPROVAL','NOT_STARTED','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS lms_enrollments_learner_idx ON lms_enrollments (learner_id, status);
CREATE INDEX IF NOT EXISTS lms_enrollments_course_idx  ON lms_enrollments (course_id, status);
CREATE INDEX IF NOT EXISTS lms_enrollments_company_idx ON lms_enrollments (company_id, status, due_at);
CREATE INDEX IF NOT EXISTS lms_enrollments_assign_idx  ON lms_enrollments (assignment_id);
CREATE INDEX IF NOT EXISTS lms_enrollments_path_idx    ON lms_enrollments (path_enrollment_id);
CREATE INDEX IF NOT EXISTS lms_enrollments_expiry_idx  ON lms_enrollments (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS lms_lesson_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL,
  enrollment_id    UUID NOT NULL,
  lesson_id        UUID NOT NULL,
  status           TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  content_done     BOOLEAN NOT NULL DEFAULT false,           -- the video, document or link part is done
  watched_ranges   JSONB NOT NULL DEFAULT '[]',              -- [[start,end],…] in seconds, server-credited
  watched_s        NUMERIC NOT NULL DEFAULT 0,
  duration_s       NUMERIC,
  position_s       NUMERIC NOT NULL DEFAULT 0,               -- where to resume
  dwell_s          INTEGER NOT NULL DEFAULT 0,
  last_beat_at     TIMESTAMPTZ,
  ack_at           TIMESTAMPTZ,
  quiz_passed      BOOLEAN NOT NULL DEFAULT false,
  quiz_best_pct    NUMERIC,
  attempts_used    INTEGER NOT NULL DEFAULT 0,
  extra_attempts   INTEGER NOT NULL DEFAULT 0,               -- granted by HR after a lock
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  UNIQUE (enrollment_id, lesson_id),
  FOREIGN KEY (enrollment_id, company_id) REFERENCES lms_enrollments (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id, company_id) REFERENCES lms_lessons (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_progress_lesson_idx ON lms_lesson_progress (lesson_id);

-- `paper` is the exact question and option order this learner saw, so grading and any
-- later dispute read what was on screen rather than a quiz that may have been reshuffled.
CREATE TABLE IF NOT EXISTS lms_quiz_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  lesson_id     UUID NOT NULL,
  quiz_id       UUID NOT NULL,
  attempt_no    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','SUBMITTED','EXPIRED')),
  paper         JSONB NOT NULL DEFAULT '[]',
  answers       JSONB NOT NULL DEFAULT '{}',
  score         NUMERIC,
  max_score     NUMERIC,
  pct           NUMERIC,
  passed        BOOLEAN,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,                                 -- set by the server; the client clock decides nothing
  submitted_at  TIMESTAMPTZ,
  UNIQUE (enrollment_id, lesson_id, attempt_no),
  FOREIGN KEY (enrollment_id, company_id) REFERENCES lms_enrollments (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id, company_id) REFERENCES lms_lessons (id, company_id),
  FOREIGN KEY (quiz_id, company_id) REFERENCES lms_quizzes (id, company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lms_attempts_one_open_uq ON lms_quiz_attempts (enrollment_id, lesson_id) WHERE status = 'IN_PROGRESS';
CREATE INDEX IF NOT EXISTS lms_attempts_quiz_idx ON lms_quiz_attempts (quiz_id, status);

-- ── Proof, feedback, audit ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms_certificates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL,
  learner_id         UUID NOT NULL,
  enrollment_id      UUID,
  path_enrollment_id UUID,
  cert_no            TEXT UNIQUE NOT NULL,                   -- printed: EZL-2026-4F7Q2K
  verify_code        TEXT UNIQUE NOT NULL,                   -- the unguessable half of the public link
  recipient_name     TEXT NOT NULL,                          -- snapshots: a certificate records what was true then
  title              TEXT NOT NULL,
  score_pct          NUMERIC,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoked_by_name    TEXT,
  revoke_reason      TEXT,
  CHECK ((enrollment_id IS NOT NULL) <> (path_enrollment_id IS NOT NULL)),
  FOREIGN KEY (learner_id, company_id) REFERENCES lms_learners (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (enrollment_id, company_id) REFERENCES lms_enrollments (id, company_id),
  FOREIGN KEY (path_enrollment_id, company_id) REFERENCES lms_path_enrollments (id, company_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lms_certificates_enrollment_uq ON lms_certificates (enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lms_certificates_path_uq ON lms_certificates (path_enrollment_id) WHERE path_enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lms_certificates_learner_idx ON lms_certificates (learner_id);

CREATE TABLE IF NOT EXISTS lms_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  enrollment_id UUID NOT NULL UNIQUE,
  course_id     UUID NOT NULL,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (enrollment_id, company_id) REFERENCES lms_enrollments (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, company_id) REFERENCES lms_courses (id, company_id)
);
CREATE INDEX IF NOT EXISTS lms_feedback_course_idx ON lms_feedback (course_id);

-- What the daily job has already sent. The unique key is what stops a rerun from
-- mailing everybody twice.
CREATE TABLE IF NOT EXISTS lms_reminder_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('DUE_SOON','OVERDUE','ESCALATION','RENEWAL')),
  day           DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (enrollment_id, kind, day),
  FOREIGN KEY (enrollment_id, company_id) REFERENCES lms_enrollments (id, company_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lms_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID,
  actor_employee_id UUID,
  actor_label       TEXT,
  action            TEXT NOT NULL,                           -- COURSE_PUBLISHED, ASSIGNMENT_CREATED, ENROLMENT_WAIVED …
  entity            TEXT NOT NULL,
  entity_id         TEXT,
  detail            JSONB NOT NULL DEFAULT '{}',
  ip                TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_audit_company_idx ON lms_audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lms_audit_entity_idx  ON lms_audit_log (entity, entity_id);

-- The audit trail only ever grows, whoever is connected.
CREATE OR REPLACE FUNCTION lms_audit_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lms_audit_log is append-only' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_lms_audit_append_only ON lms_audit_log;
CREATE TRIGGER trg_lms_audit_append_only BEFORE UPDATE OR DELETE ON lms_audit_log
  FOR EACH ROW EXECUTE FUNCTION lms_audit_append_only();

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lms_touch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_lms_courses_touch ON lms_courses;
CREATE TRIGGER trg_lms_courses_touch BEFORE UPDATE ON lms_courses FOR EACH ROW EXECUTE FUNCTION lms_touch();
DROP TRIGGER IF EXISTS trg_lms_paths_touch ON lms_paths;
CREATE TRIGGER trg_lms_paths_touch BEFORE UPDATE ON lms_paths FOR EACH ROW EXECUTE FUNCTION lms_touch();

-- ── RLS: on, no policy, and no table grants to the browser's roles ──────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'lms\_%' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Private, and deliberately without storage.objects policies: the service role signs
-- every URL. 2 GB is the per-file cap; the plan's global limit in the Supabase dashboard
-- must be at least this (docs/lms/ARCHITECTURE.md, Video).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lms-content', 'lms-content', false, 2147483648, ARRAY[
  'video/mp4',                                   -- H.264/AAC only: nothing here transcodes
  'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm',
  'application/pdf',
  'image/jpeg','image/png','image/webp',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/msword','application/vnd.ms-excel',
  'text/csv','text/plain','application/zip'
])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
