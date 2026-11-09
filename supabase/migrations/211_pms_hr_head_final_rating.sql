-- 211_pms_hr_head_final_rating.sql
-- The HR Head settles the final rating, and nothing publishes before they do.
-- SAFE TO RUN TWICE. Adds columns and one trigger. No data is rewritten.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Requested: "HR head should have a checkbox before giving final rating to
-- employee that message like 'do you discussed with your management of
-- company regarding final rating'. final rating by hr head will over write
-- the all the ratings of peoples behind in chain, it will consider as final
-- rating, also hr head can continue with ratings that is given through out
-- the chain. and only after the final rating is given to a employee, there
-- result can be published."
--
-- So there is now a step between the chain finishing and the result going
-- out. The chain settles a rating; the HR Head either keeps it or replaces
-- it, attests that they discussed it with the company's management, and
-- only then may it be published.
--
-- ── WHAT "OVERWRITE THE RATINGS BEHIND IN THE CHAIN" MEANS HERE ────────────
--
-- The HR Head's number becomes final_rating — the one the employee reads and
-- the one every report counts. It SUPERSEDES the chain; it does not erase it.
--
-- rm_l1_score, rm_l2_score and hod_score are separate columns and are left
-- exactly as they were, because they are the record of what each person
-- actually said. Deleting them would make the rating comparison panel lie
-- about a conversation that happened, and no later audit could reconstruct
-- it. What WOULD have been lost is the band the chain settled on, since that
-- lives in final_rating and is about to be written over — so it is copied to
-- chain_final_rating first. After an override the row can still answer "the
-- HOD settled 4, the HR Head set 3", which is the question somebody will ask.
--
-- ── WHO MAY DO IT ──────────────────────────────────────────────────────────
--
-- Anyone holding the HR_HEAD role, which the owner chose over both the
-- stricter reading (only the one person named in pms_policies.hr_head_id)
-- and the looser one (any HR-level user, which would have let an HR Manager
-- set the number that overrides the HOD).
--
-- That check lives in the application, not here: roles are in the ESS tables
-- and this trigger fires under the service role, which holds no role of its
-- own. What the database enforces is that a confirmation EXISTS and carries
-- the attestation — the part that must be true no matter which screen or
-- script performed the update.
--
-- ── A SETTING, DEFAULTED ON ────────────────────────────────────────────────
--
-- pms_policies.hr_head_final_rating, true for everybody from today. A hard
-- rule was the alternative and is a trap: a company whose policy has no HR
-- Head named would have nothing publishable and no way out but a code
-- change. Same shape as final_review_one_to_one and post_final_owner.
--
-- ── WHAT IT DOES NOT TOUCH ─────────────────────────────────────────────────
--
-- Already-published rows. The trigger only inspects a transition INTO
-- PUBLISHED, so the three results already out stay out, unchanged and
-- unquestioned. The gate applies to what is published from now on.

ALTER TABLE pms_overall_rating
  ADD COLUMN IF NOT EXISTS hr_final_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS hr_final_confirmed_by   uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS hr_management_discussed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hr_final_reason         text,
  ADD COLUMN IF NOT EXISTS chain_final_rating      smallint;

COMMENT ON COLUMN pms_overall_rating.hr_management_discussed IS
  'The HR Head''s attestation that this final rating was discussed with the '
  'company''s management. Required before the result may be published; it is '
  'a statement by a named person, not a system check.';
COMMENT ON COLUMN pms_overall_rating.chain_final_rating IS
  'The band the chain had settled on, copied here when the HR Head replaces '
  'it. Null when they kept the chain''s rating. The per-rater scores in '
  'rm_l1_score, rm_l2_score and hod_score are never touched.';
COMMENT ON COLUMN pms_overall_rating.hr_final_reason IS
  'Why the HR Head set a different rating. Required only when they change '
  'it: agreeing with the chain explains itself.';

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS hr_head_final_rating boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN pms_policies.hr_head_final_rating IS
  'Whether the HR Head must settle the final rating before a result can be '
  'published. Default true. Turning it off returns the cycle to publishing '
  'straight from the chain''s finalisation.';

-- ── the gate ───────────────────────────────────────────────────────────────
--
-- Its OWN function and trigger rather than a patch into
-- pms_block_unsigned_publish. Two rules gate publication now — the manager's
-- sign-off (207) and this one — and they answer different questions, fire on
-- different policy settings, and will be changed by different people. Folded
-- together, editing either means re-reading both.
CREATE OR REPLACE FUNCTION pms_block_unconfirmed_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_req boolean; v_why text;
BEGIN
  -- Not a publish: nothing to police. Re-publishing something already out is
  -- not a transition either, which keeps the three existing results alone.
  IF NEW.workflow_status IS NOT DISTINCT FROM OLD.workflow_status
     OR NEW.workflow_status <> 'PUBLISHED'
     OR OLD.workflow_status IN ('PUBLISHED','ACKNOWLEDGED') THEN
    RETURN NEW;
  END IF;

  SELECT p.hr_head_final_rating INTO v_req
    FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id
   WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req, true) THEN RETURN NEW; END IF;

  IF NEW.hr_final_confirmed_at IS NULL THEN
    v_why := 'This result cannot be published yet: the HR Head has not '
          || 'settled the final rating. They either keep the rating the '
          || 'chain settled or replace it, and confirm it was discussed '
          || 'with the company''s management.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  -- THE CHECKBOX IS PART OF THE CONFIRMATION, not decoration on the form.
  -- A row could otherwise carry a timestamp with the attestation false and
  -- publish, which is the exact thing the owner asked to prevent.
  IF NOT COALESCE(NEW.hr_management_discussed, false) THEN
    v_why := 'This result cannot be published yet: the final rating is not '
          || 'recorded as discussed with the company''s management.';
    RAISE EXCEPTION '%', v_why;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_publish_needs_hr_final ON pms_overall_rating;
CREATE TRIGGER trg_pms_publish_needs_hr_final
BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_block_unconfirmed_publish();

COMMENT ON FUNCTION pms_block_unconfirmed_publish() IS
  'Publication needs the HR Head to have settled the final rating and '
  'attested that it was discussed with management, when the policy requires '
  'it (pms_policies.hr_head_final_rating). Separate from the 207 sign-off '
  'rule on purpose: different question, different setting.';

NOTIFY pgrst, 'reload schema';
