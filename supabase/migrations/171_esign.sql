-- =====================================================================
-- 171_esign.sql — EZER Sign: send PDFs for signature, sign with e-mail OTP
-- (and optional Aadhaar OTP), stamp the PDF, keep a tamper-evident audit trail.
--
-- NEW TABLES ONLY. Nothing existing is altered. Safe to run twice.
-- REQUIRED for Compliance & Docs → E-Sign and the public /sign/<token> page.
--
-- THE SHAPE
--
--   esign_envelopes   one document sent for signature (one PDF, 1..n signers)
--   esign_signers     who signs it, in which order, and how they proved who they are
--   esign_fields      where on which page each signer signs (fractions of the page,
--                     so the box lands in the same place whatever the render size)
--   esign_events      the audit trail: every view, OTP, signature, decline, reminder,
--                     with IP and browser — printed on the Certificate of Completion
--
-- SECURITY
--
-- Signing links are bearer secrets, so only their SHA-256 is stored (token_hash);
-- OTPs are stored as an HMAC, never in clear. Every read and write goes through
-- the /api/esign routes with the service-role key — RLS is ON with NO policy, so
-- the anon key the browser holds cannot read a single row or file. This is
-- deliberately stricter than the allow-all pattern elsewhere: these are signed
-- employment documents.
--
-- STORAGE: a private bucket `esign` holds original/<envelope>.pdf (as uploaded),
-- working/<envelope>.pdf (with the signatures so far) and signed/<envelope>.pdf
-- (final, with the certificate page). The original is never modified.
-- =====================================================================

CREATE TABLE IF NOT EXISTS esign_envelopes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_no       TEXT UNIQUE NOT NULL,                -- EZS-2026-4F7Q2K, printed on every page
  title             TEXT NOT NULL,
  message           TEXT,
  company_id        UUID,
  category          TEXT DEFAULT 'GENERAL',              -- OFFER_LETTER, APPOINTMENT, POLICY, NDA, HR_LETTER, ONBOARDING, EXIT, GENERAL
  source            TEXT DEFAULT 'MANUAL',               -- MANUAL | BULK | HR_LETTER | OFFER
  source_ref        TEXT,                                -- id in the source module, when there is one
  batch_id          UUID,                                -- set on every envelope of one bulk send
  status            TEXT NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('DRAFT','SENT','IN_PROGRESS','COMPLETED','DECLINED','VOIDED','EXPIRED')),
  signing_order     TEXT NOT NULL DEFAULT 'SEQUENTIAL' CHECK (signing_order IN ('SEQUENTIAL','PARALLEL')),
  page_count        INTEGER,
  original_path     TEXT NOT NULL,
  original_sha256   TEXT NOT NULL,
  original_name     TEXT,
  working_path      TEXT,
  doc_version       INTEGER NOT NULL DEFAULT 0,          -- optimistic lock for parallel signers
  signed_path       TEXT,
  signed_sha256     TEXT,
  expires_at        TIMESTAMPTZ,
  reminder_days     INTEGER DEFAULT 2,
  last_reminded_at  TIMESTAMPTZ,
  created_by_id     UUID,                                -- employees.id of the sender (null for the legacy login)
  created_by_name   TEXT,
  created_by_email  TEXT,
  cc_emails         TEXT[] DEFAULT '{}',
  void_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS esign_envelopes_status_idx  ON esign_envelopes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS esign_envelopes_company_idx ON esign_envelopes (company_id);
CREATE INDEX IF NOT EXISTS esign_envelopes_sha_idx     ON esign_envelopes (signed_sha256);
CREATE INDEX IF NOT EXISTS esign_envelopes_batch_idx   ON esign_envelopes (batch_id);

CREATE TABLE IF NOT EXISTS esign_signers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id         UUID NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
  order_no            INTEGER NOT NULL DEFAULT 1,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  employee_id         UUID,                              -- when the signer is an employee (shows in their ESS)
  designation         TEXT,
  role_label          TEXT,                              -- "Employee", "HR Head", "Authorised signatory" …
  auth_method         TEXT NOT NULL DEFAULT 'EMAIL_OTP' CHECK (auth_method IN ('EMAIL_OTP','EMAIL_AADHAAR_OTP')),
  status              TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING','PENDING','VIEWED','SIGNED','DECLINED')),
  token_hash          TEXT UNIQUE,
  token_issued_at     TIMESTAMPTZ,
  session_hash        TEXT,                              -- set once the e-mail OTP is verified
  session_expires_at  TIMESTAMPTZ,
  otp_hmac            TEXT,
  otp_expires_at      TIMESTAMPTZ,
  otp_attempts        INTEGER NOT NULL DEFAULT 0,
  otp_sent_count      INTEGER NOT NULL DEFAULT 0,
  email_verified_at   TIMESTAMPTZ,
  aadhaar_last4       TEXT,
  aadhaar_otp_hmac    TEXT,
  aadhaar_otp_expires_at TIMESTAMPTZ,
  aadhaar_verified_at TIMESTAMPTZ,
  aadhaar_mode        TEXT,                              -- DEMO until a licensed eSign/ASP provider is wired
  signature_kind      TEXT CHECK (signature_kind IN ('DRAWN','TYPED','UPLOADED')),
  signature_path      TEXT,
  signed_at           TIMESTAMPTZ,
  signed_ip           TEXT,
  signed_user_agent   TEXT,
  signed_location     TEXT,
  viewed_at           TIMESTAMPTZ,
  invited_at          TIMESTAMPTZ,
  declined_at         TIMESTAMPTZ,
  decline_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_signers_env_idx   ON esign_signers (envelope_id, order_no);
CREATE INDEX IF NOT EXISTS esign_signers_emp_idx   ON esign_signers (employee_id);
CREATE INDEX IF NOT EXISTS esign_signers_email_idx ON esign_signers (lower(email));

CREATE TABLE IF NOT EXISTS esign_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
  signer_id   UUID NOT NULL REFERENCES esign_signers(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,                          -- 1-based
  x           NUMERIC NOT NULL,                          -- 0..1 of page width, from the left
  y           NUMERIC NOT NULL,                          -- 0..1 of page height, from the TOP
  w           NUMERIC NOT NULL,
  h           NUMERIC NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'SIGNATURE' CHECK (kind IN ('SIGNATURE','INITIALS','DATE','NAME')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_fields_env_idx ON esign_fields (envelope_id);

CREATE TABLE IF NOT EXISTS esign_events (
  id          BIGSERIAL PRIMARY KEY,
  envelope_id UUID NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
  signer_id   UUID REFERENCES esign_signers(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                             -- CREATED, SENT, INVITED, OPENED, OTP_SENT, OTP_VERIFIED, OTP_FAILED, AADHAAR_VERIFIED, VIEWED, SIGNED, DECLINED, REMINDED, VOIDED, COMPLETED, DOWNLOADED, VERIFIED
  actor       TEXT,                                      -- who, as a readable name/e-mail
  ip          TEXT,
  user_agent  TEXT,
  details     JSONB DEFAULT '{}',
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_events_env_idx ON esign_events (envelope_id, at);

ALTER TABLE esign_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_signers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_events    ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service role only (see header).

INSERT INTO storage.buckets (id, name, public)
VALUES ('esign', 'esign', false)
ON CONFLICT (id) DO NOTHING;
