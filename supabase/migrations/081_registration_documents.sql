-- =====================================================================
-- EZER HRMS — 081: a document against each statutory registration
--
-- A registration row carries a number and two dates. The certificate
-- itself — the thing an inspector actually asks for — lived in
-- somebody's email. These columns give it a home next to the record it
-- belongs to.
--
-- METADATA ONLY. The file goes to Supabase Storage, the way flexi-bills
-- and onboarding-docs already do; document_path is the object key in the
-- `company-docs` bucket, and nothing here stores bytes.
--
-- Note this makes the `company-docs` bucket necessary again. It was
-- asked for in the 078 notes for the Documents tab, which has since been
-- removed — so if you skipped creating it, it is needed after all, and
-- it is the only manual step for this file.
-- =====================================================================

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_path        text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_name        text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_mime        text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_size        integer;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_uploaded_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS document_uploaded_by uuid REFERENCES employees(id);

-- ── Only the two formats the UI can actually deal with ────────────────
-- PDF renders read-only in the browser. DOCX cannot be rendered natively
-- by any browser, so the UI offers it as a download and says so rather
-- than pretending to preview it — sending a statutory certificate to a
-- third-party viewer service to get a preview is not a trade worth
-- making. Anything else is refused at upload, and the CHECK is here so
-- that stays true even if a future caller forgets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_document_mime_chk') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_document_mime_chk
      CHECK (document_mime IS NULL OR document_mime IN (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ));
  END IF;

  -- A path without a name is a file nobody can identify in a list, and a
  -- name without a path is a row pointing at nothing. They travel together.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_document_pair_chk') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_document_pair_chk
      CHECK ((document_path IS NULL AND document_name IS NULL)
          OR (document_path IS NOT NULL AND document_name IS NOT NULL));
  END IF;

  -- 15 MB. Large enough for a scanned multi-page certificate, small
  -- enough that a mis-selected video is rejected by the database and not
  -- only by the route.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_document_size_chk') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_document_size_chk
      CHECK (document_size IS NULL OR (document_size > 0 AND document_size <= 15728640));
  END IF;
END $$;

-- =====================================================================
-- STILL YOURS
-- =====================================================================
-- 1. THE BUCKET. One manual step, and nothing uploads without it:
--
--        name     company-docs
--        access   PRIVATE
--        policy   whatever flexi-bills / onboarding-docs already use
--
--    PRIVATE matters here more than it did for the Documents tab. These
--    are PAN, GST, EPF and ESIC certificates. The app never links to a
--    file directly — every view goes through a short-lived signed URL
--    minted server-side — so a public bucket would be giving away
--    something the application itself never exposes.
--
--    Until the bucket exists the UI says uploads are unavailable rather
--    than offering a button that fails.
--
-- 2. No RLS change is needed: these are columns on `registrations`,
--    which already has whatever policy you gave it. Worth knowing that
--    the app now writes this table ONLY through /api/company/profile,
--    which checks the caller's role server-side — the browser no longer
--    writes registrations through the anon key.
-- =====================================================================
