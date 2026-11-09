-- 189_pms_feedback_has_two_authors.sql — the RM's overall comment stops
-- overwriting the HOD's appreciation remark.
-- SAFE TO RUN TWICE. Adds two nullable columns. Changes no data, drops
-- nothing, and alters no constraint — every existing read keeps working.
-- ----------------------------------------------------------------------------
-- THE SPEC ASKS TWO DIFFERENT PEOPLE FOR PROSE, AND THE TABLE HOLDS ONE ROW.
--
--   §4.3 Rate My Team       — the RM writes an "Overall comment".
--   §5.2 Feedback & Recognition — the HOD writes an "Appreciation Remark",
--                                 "Improvement Feedback" and benefits.
--
-- pms_feedback is UNIQUE (period_id, employee_id): one row per person per
-- period, with given_by / given_by_role naming a single author. There is no
-- column for the RM's comment, so it was being written into
-- appreciation_remark — the HOD's field. Both are upserts on the same
-- conflict target, so whoever saved last silently erased the other. The RM
-- comments first and the HOD publishes afterwards, which means the losing
-- side was always the RM, and the loss was invisible: no error, no conflict,
-- just a remark that is no longer there when the result is published.
--
-- This is the same shape as the rater_role defect fixed earlier this session,
-- where an RM L2's rating overwrote the RM L1's because the upsert key did not
-- distinguish them. Two authors need two places to write.
--
-- WHY A COLUMN AND NOT A WIDER UNIQUE KEY
--
-- Changing the key to (period_id, employee_id, given_by_role) would also work
-- and is arguably the more general design. It is not what this does, because
-- that key is read by the employee's result screen, by vw_pms_* views and by
-- the published-result path, all of which currently assume at most one row per
-- employee per period and would start seeing several. An additive column
-- changes the behaviour of nothing that already exists. If the module later
-- needs feedback from arbitrarily many authors, the key is the right change to
-- make then, deliberately, with those readers updated in the same breath.
--
-- WHY NOT visible_to_employee PER AUTHOR
--
-- §3.5 says nothing at all is visible before the result is published, and
-- publication is a single event for the whole record. One flag is correct.

ALTER TABLE pms_feedback
  ADD COLUMN IF NOT EXISTS rm_overall_comment text;

-- Who wrote it, kept separate from given_by for the same reason the text is:
-- given_by names the author of the HOD's half, and overwriting it would lose
-- the record of which manager actually rated the employee.
ALTER TABLE pms_feedback
  ADD COLUMN IF NOT EXISTS rm_overall_by uuid;

COMMENT ON COLUMN pms_feedback.rm_overall_comment IS
  'Spec §4.3: the RM''s overall comment from Rate My Team. Distinct from '
  'appreciation_remark, which §5.2 gives to the HOD. Sharing one column meant '
  'the later writer erased the earlier one.';
COMMENT ON COLUMN pms_feedback.rm_overall_by IS
  'The manager who wrote rm_overall_comment. given_by stays the author of the '
  'HOD''s half of the row.';

NOTIFY pgrst, 'reload schema';
