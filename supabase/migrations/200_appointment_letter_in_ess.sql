-- 200_appointment_letter_in_ess.sql
--
-- The Letter of Appointment (Onboarding → the joiner's row → Appointment letter) is saved to
-- the employee's ESS → Profile → My Letters when HR sends it. My Letters reads
-- generated_letters through the my_generated_letters view, where every letter came from a
-- letter template and took its name from it. The appointment letter is drawn by its own
-- builder (lib/onboarding/appointment-letter-server.ts), not from a template, so:
--   • generated_letters.letter_name   the letter's own name, used when there is no template
--   • template_id is no longer required
--   • my_generated_letters is re-created to show letter_name, else the template's name, for
--     the letters released to ESS (published_to_ess_at set).
-- Safe to run more than once.

ALTER TABLE generated_letters ADD COLUMN IF NOT EXISTS letter_name text;
ALTER TABLE generated_letters ALTER COLUMN template_id DROP NOT NULL;

DROP VIEW IF EXISTS my_generated_letters;
CREATE VIEW my_generated_letters AS
SELECT gl.id,
       gl.employee_id,
       gl.letter_date,
       gl.file_url,
       COALESCE(gl.letter_name, lt.name, 'Letter') AS letter_name,
       gl.generated_at,
       gl.emailed_at,
       gl.published_to_ess_at
  FROM generated_letters gl
  LEFT JOIN letter_templates lt ON lt.id = gl.template_id
 WHERE gl.published_to_ess_at IS NOT NULL;

GRANT SELECT ON my_generated_letters TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
