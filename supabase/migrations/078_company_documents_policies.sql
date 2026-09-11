-- =====================================================================
-- EZER HRMS — 078: company documents, directors, and attendance mode
--
-- Sections 11 and 12 of the company profile. Section 12 turned out to be
-- almost entirely present already and needed one column:
--
--   Working days      weekly_off_config    EXISTS (Sunday, every week)
--   Shift timings     shift_master         EXISTS (GEN 09:00-18:00, 30m lunch)
--   Working hours     derived from shift_master, not stored twice
--   Leave policy      leave_types          EXISTS (11 types)
--   Attendance mode   -                    added below
--   Bonus / gratuity  bonus_config exists but is empty; employees already
--                     carries gratuity_eligible and gratuity_eligible_date
--
-- Section 11 is genuinely new: there is nowhere to record a handbook, a
-- registration certificate, or who sits on the board.
-- =====================================================================


-- ── 12. Attendance mode ────────────────────────────────────────────────
-- How attendance is captured, which changes what the attendance screens can
-- trust. Several modes can run at once — a factory on biometric and a sales
-- team on geo-tagging — so this is an array rather than a single value.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS attendance_modes text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_attendance_modes_chk') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_attendance_modes_chk
      CHECK (attendance_modes IS NULL OR attendance_modes <@ ARRAY['BIOMETRIC','MANUAL','GEO','WEB','MOBILE','SWIPE']::text[]);
  END IF;
END $$;

-- Standard working hours are DERIVED from shift_master (out_time - in_time,
-- less the lunch break) rather than stored. A second copy of a number that is
-- already recorded is a number that will eventually disagree with the first.


-- ── 11. Document repository ────────────────────────────────────────────
-- Metadata only. The file itself goes to Supabase Storage, the way
-- flexi-bills, letterhead-files and onboarding-docs already do — this table
-- holds the path, not the bytes.
--
-- *** A BUCKET NAMED company-docs MUST EXIST BEFORE UPLOADS WORK. ***
-- Creating a bucket is a storage operation, not SQL, so it is not in this
-- file. Create it private, then grant whatever policy the other buckets use.
CREATE TABLE IF NOT EXISTS company_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type      text NOT NULL
                CHECK (doc_type IN ('HANDBOOK','CODE_OF_CONDUCT','REG_CERTIFICATE',
                                    'MOA','AOA','LICENCE','POLICY','OTHER')),
  title         text NOT NULL,
  description   text,
  bucket        text NOT NULL DEFAULT 'company-docs',
  file_path     text,
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  -- Version as text, not a number: real documents are labelled "v2.1" and
  -- "2024-rev-B", and forcing them into an integer loses what they were called.
  version       text,
  -- A handbook supersedes the previous handbook. Keeping both and marking one
  -- current is how you answer "what did the policy say in March" later.
  is_current    boolean NOT NULL DEFAULT true,
  valid_from    date,
  valid_till    date,
  uploaded_by   text,
  status        text NOT NULL DEFAULT 'Active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_company
  ON company_documents (company_id, doc_type);
-- The common read is "the current handbook for this company".
CREATE INDEX IF NOT EXISTS idx_company_documents_current
  ON company_documents (company_id, doc_type) WHERE is_current;


-- ── 11. Directors and board ────────────────────────────────────────────
-- Deliberately NOT a link to employees. A director is frequently not on the
-- payroll — an independent director, a nominee from an investor — and forcing
-- an employees row for them would put people who do not work here into
-- headcount, attrition and every gender chart on the profile.
--
-- employee_id is there for the ones who ARE staff (companies.md_employee_id
-- already points at one), so the two can be reconciled without conflating them.
CREATE TABLE IF NOT EXISTS company_directors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid REFERENCES employees(id),
  person_name    text NOT NULL,
  designation    text,
  -- Director Identification Number, the MCA's identifier. Unique per person
  -- nationally, so it is the reliable key when a name is ambiguous.
  din            text,
  is_board_member boolean NOT NULL DEFAULT true,
  is_signatory   boolean NOT NULL DEFAULT false,
  email          text,
  phone          text,
  appointed_on   date,
  resigned_on    date,
  status         text NOT NULL DEFAULT 'Active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_directors_company
  ON company_directors (company_id) WHERE resigned_on IS NULL;


-- ── RLS ────────────────────────────────────────────────────────────────
-- House pattern, and the same open question as everything else here — these
-- two hold board members' personal contact details and the company's
-- constitutional documents, which are more sensitive than most of what is
-- already anon-readable. Flagged rather than quietly made different from its
-- neighbours.
ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_directors ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_documents' AND policyname='company_documents_all') THEN
    CREATE POLICY company_documents_all ON company_documents
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_directors' AND policyname='company_directors_all') THEN
    CREATE POLICY company_directors_all ON company_directors
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
-- =====================================================================
