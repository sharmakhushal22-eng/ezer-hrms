-- 204_letters_studio.sql
-- ===========================================================================
-- PEOPLE → LETTERS: what each generated letter is.
--
-- SAFE TO RUN TWICE.
--
-- People → Letters (app/dashboard/employee-letters) issues the twenty letters of the EZER
-- Letters & Documents spec. Every letter is a generated_letters row, as the HR Letters
-- designer's and the appointment letter's already are; these columns say which letter it
-- is and what went into it:
--   letter_type        the spec's code: OFR, APT, NDA, NCA, WEL, CNF, INC, PRM, TRF, WRN,
--                      SCN, PIP, BNS, DEP, RAL, TRM, REL, EXP, FNF, PFC
--   doc_id             {Code}-{CompanyCode}-{EmpCode}-{YYYYMMDD}-{Seq} (spec §7)
--   fields             the values the letter was generated from (audit, re-issue)
--   sent_to            the address it was mailed to
--   generated_by_name  who issued it
-- published_to_ess_at stays NULL for the letters the spec keeps out of ESS (welcome,
-- warning, show cause, PIP); HR still sees them on the employee's Documents tab.
-- ===========================================================================

ALTER TABLE public.generated_letters ADD COLUMN IF NOT EXISTS letter_type text;
ALTER TABLE public.generated_letters ADD COLUMN IF NOT EXISTS doc_id text;
ALTER TABLE public.generated_letters ADD COLUMN IF NOT EXISTS fields jsonb;
ALTER TABLE public.generated_letters ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE public.generated_letters ADD COLUMN IF NOT EXISTS generated_by_name text;

CREATE UNIQUE INDEX IF NOT EXISTS generated_letters_doc_id_key ON public.generated_letters (doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS generated_letters_employee_idx ON public.generated_letters (employee_id, generated_at DESC);

NOTIFY pgrst, 'reload schema';
