-- pms_chain_stage_probe.sql — READ ONLY. Changes nothing.
--
-- DELIBERATELY UNNUMBERED. It verifies no migration; it answers one
-- question about live data. It was called 223_… before migration 223
-- existed and was about something else entirely, which read as though the
-- two belonged together.
--
-- WHY THIS EXISTS
--
-- Walking a real appraisal through the chain, the manager's rating card
-- ("Waiting on your approval") did not render for an employee whose Team
-- Dashboard said "Your rating is owed." That card shows a row only when
--
--     member.chainStage === rungFor(member, viewer)
--
-- so either chain_stage is not the rung the viewer holds, or it is not what
-- pms_chain_submit was expected to leave behind. From the browser the value
-- is invisible; this prints it.
--
-- Run it and read the `verdict` column. No BEGIN/ROLLBACK because it writes
-- nothing at all.

SELECT
  e.emp_code,
  e.full_name,
  pe.period_code,
  o.chain_stage,
  o.workflow_status,
  o.self_score,
  o.rm_l1_score,
  -- Who the frozen chain says holds each rung, so the comparison the screen
  -- makes can be made here too.
  l1.emp_code  AS rm_l1_code,
  l2.emp_code  AS rm_l2_code,
  hod.emp_code AS hod_code,
  p.approval_chain,
  public.pms_chain_rungs(p.approval_chain) AS rungs,
  CASE
    WHEN o.chain_stage IS NULL
      THEN 'chain_stage is NULL — pms_chain_submit never ran, or something '
        || 'cleared it. The approval card cannot match a null.'
    WHEN o.chain_stage = 'SELF'
      THEN 'chain_stage is SELF — the first rung of this policy''s chain is '
        || 'the employee, so no manager rung matches it and the card is '
        || 'empty for everybody.'
    WHEN o.chain_stage = 'EMPLOYEE'
      THEN 'back with the employee after a rejection'
    WHEN o.chain_stage = 'DONE'
      THEN 'finished'
    WHEN o.chain_stage = 'RM_L1' AND l1.emp_code IS NULL
      THEN 'sitting on RM_L1 but the frozen chain has no RM L1 — nobody can '
        || 'match this rung'
    ELSE 'sitting on ' || o.chain_stage || ', which should render for whoever '
        || 'holds that rung'
  END AS verdict
FROM pms_overall_rating o
JOIN employees  e  ON e.id = o.employee_id
JOIN pms_periods pe ON pe.id = o.period_id
LEFT JOIN pms_policies p ON p.id = pe.policy_id
LEFT JOIN employees l1  ON l1.id  = o.rm_l1_id
LEFT JOIN employees l2  ON l2.id  = o.rm_l2_id
LEFT JOIN employees hod ON hod.id = o.hod_id
WHERE o.self_score IS NOT NULL
ORDER BY o.updated_at DESC NULLS LAST
LIMIT 20;
