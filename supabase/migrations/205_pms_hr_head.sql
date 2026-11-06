-- 205_pms_hr_head.sql — the HR Head, by name, so a screen can say who to go to.
-- SAFE TO RUN TWICE. Adds one nullable column and one foreign key. No data
-- change, no constraint altered, nothing dropped, no UPDATE.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested, about the banner on the HOD's Published Results tab: "this line
-- should also tell which HR with name and employee id", then "hr head should
-- have these authority".
--
-- The line says "A rating that genuinely needs correcting goes through HR."
-- That is true and useless: it names a department, and the HOD standing in
-- front of it has to go and find out who. The ask is for a person.
--
-- ── WHY A NEW COLUMN, AND NOT ONE OF THE FOUR THINGS THAT NEARLY WORK ──────
--
-- Checked before adding anything, against the live database:
--
--   user_roles                 EXISTS AND IS EMPTY — 0 rows. Nothing to read.
--   employees.designation      One person company-wide matches /HR/: "Hr
--                              Executive", in one of three companies. A
--                              correction authority picked by string match on
--                              a free-text job title is a wrong name waiting
--                              to happen.
--   pms_feedback.given_by      Checked on all three published results: it is
--                              the RM or the HOD who wrote the feedback —
--                              Arjun Malhotra (RM_L1), Shreya Reddy (HOD).
--                              Never HR.
--   pms_overall_rating         Has finalised_by, finalised_by_role,
--                              published_at, sent_back_by — and no
--                              published_by. Nothing records which HR
--                              released a result.
--
-- 202's post_final_owner is the closest thing and it answers a different
-- question: it names a ROLE ('HR' or 'FINALISER') that owns the controls
-- after finalisation. Which human holds that role has never been recorded.
--
-- So the product could not name the HR Head because nobody had ever told it.
-- This is where it is told.
--
-- ── WHY ON pms_policies ────────────────────────────────────────────────────
--
-- A policy belongs to one company, and the HR Head is a per-company fact —
-- the group in this database runs three companies with separate HR. The
-- policy row is already where every other per-company PMS decision lives
-- (post_final_owner, publish_scope, the chain, the carry-forward switch), and
-- the admin screen that edits them is already built and already allowlists
-- columns one at a time.
--
-- NULLABLE ON PURPOSE. A company that has not named its HR Head is the
-- normal state on the day this is applied — all three of them — and the
-- screens must say "HR" as they do today rather than invent somebody. A NOT
-- NULL default would mean picking a person on everyone's behalf, which is
-- exactly the mistake the designation match would have made.
--
-- ON DELETE SET NULL, not CASCADE. If the HR Head leaves and their employee
-- row is deleted, the policy must survive without them; the screens fall
-- back to the generic sentence until somebody names a successor. CASCADE
-- would take the whole policy with the person.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--
-- It does not grant anything. Who may write post-final feedback, recognition
-- and publication is still post_final_owner plus §2's matrix
-- (mayWritePostFinal / mayPublish in lib/pms/postFinal.ts), and whether a
-- result may be published at all is still 200's
-- trg_pms_publish_needs_signoff. This records WHO the HR Head is so a screen
-- can name them; it is not a permission.
--
-- Deliberately no trigger. Nothing is enforced by this column, so there is
-- nothing for a guard to protect.

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS hr_head_id uuid REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN pms_policies.hr_head_id IS
  'The HR Head for this company, as an employees.id. Named so screens can '
  'tell somebody WHO to go to about a settled result rather than saying '
  '"HR". NULL means nobody has been named and the screens say "HR" as '
  'before. Not a permission: post_final_owner and the role matrix still '
  'decide who may act.';

NOTIFY pgrst, 'reload schema';
