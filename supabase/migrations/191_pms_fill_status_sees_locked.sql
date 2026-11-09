-- 191_pms_fill_status_sees_locked.sql — a locked KRA set stops reporting as
-- "not started" in HR's fill-status roll-up.
-- SAFE TO RUN TWICE. Recreates one view. No schema change, no data change,
-- no column added, renamed or dropped — the column list is byte-identical.
-- ----------------------------------------------------------------------------
-- 190 made workflow_status truthful. This is the other half: the view that
-- reads it still cannot express one of the states.
--
-- vw_pms_fill_status has six branches. KRA_LOCKED matches NONE of them, so a
-- locked row falls through to `ELSE 'NOT_STARTED'`:
--
--   WHEN COALESCE(g.kra_count,0) = 0                       THEN 'NOT_STARTED'
--   WHEN o.workflow_status IN ('KRA_DRAFT','SELF_DRAFT')   THEN 'DRAFT_SAVED'
--   WHEN o.workflow_status = 'SELF_SUBMITTED'              THEN 'SUBMITTED'
--   WHEN o.workflow_status IN ('RM_L1_DONE','RM_L2_DONE')  THEN 'IN_REVIEW'
--   WHEN o.workflow_status IN ('FINALISED',...)            THEN 'FINALISED'
--   ELSE 'NOT_STARTED'
--
-- KRA_LOCKED is the one status the module HAS always written (pms_lock_kras,
-- 066 line 614), so this half of the defect was live long before 190 and
-- independent of it.
--
-- OBSERVED, 28-Oct-2026, walking a cycle through rung by rung: Krishna Mehta
-- (SRS9003) with four LOCKED KRAs totalling 100%, the KRA one-to-one
-- acknowledged by both sides, and the self rating genuinely owed, read
-- fill_status = NOT_STARTED. That is not a near-miss. The first branch
-- already means "no KRAs at all", so the view was reporting the same thing
-- about an employee who had agreed and frozen a full KRA set as about one who
-- had never opened the screen — and NOT_STARTED is the state an HR admin
-- escalates, so it points them at the wrong person with the wrong urgency.
--
-- ── WHY DRAFT_SAVED AND NOT A SIXTH VALUE ──────────────────────────────────
--
-- FILL exists to collapse ten workflow values into "the five states an HR
-- admin actually chases" (lib/pms/status.ts). Five is a deliberate number, so
-- the fix folds KRA_LOCKED into an existing state rather than widening the
-- vocabulary, which would mean changing FILL, FILL_ORDER, FILL_LABEL,
-- FILL_MEANING and every consumer.
--
-- DRAFT_SAVED is the honest fold, because the question this column answers is
-- "whose move is it, and how hard do I push?". KRA_LOCKED and KRA_DRAFT give
-- the same answer: the EMPLOYEE owes the next thing, and it wants a nudge
-- rather than an escalation. SUBMITTED would be a lie — nothing has been
-- submitted for rating. NOT_STARTED is the lie being fixed.
--
-- The one cost is the label: "Draft saved" reads oddly for a set that is
-- locked. lib/pms/status.ts FILL_MEANING is reworded in the same change so
-- the sentence HR reads describes both cases, and a test pins it.
--
-- SELF_DRAFT stays in the branch although 190 deliberately never writes it:
-- removing it would be an unrelated change, and if a self-rating draft-save
-- is ever built, this is where it already belongs.

CREATE OR REPLACE VIEW vw_pms_fill_status AS
SELECT o.period_id, pe.period_code, o.company_id,
       e.emp_code AS employee_code, e.full_name AS employee_name, o.department_id, o.grade,
       o.rm_l1_id, o.rm_l2_id, o.hod_id,
       f.employment_flag, f.last_working_day,
       COALESCE(g.kra_count,0)  AS kra_count,
       COALESCE(g.total_wt,0)   AS total_weightage,
       CASE WHEN o121.id IS NOT NULL THEN 'DONE' ELSE 'PENDING' END AS one_to_one_status,
       CASE
         WHEN COALESCE(g.kra_count,0) = 0                       THEN 'NOT_STARTED'
         -- 191: KRA_LOCKED added. It matched no branch and fell to the ELSE.
         WHEN o.workflow_status IN ('KRA_DRAFT','SELF_DRAFT','KRA_LOCKED')
                                                                THEN 'DRAFT_SAVED'
         WHEN o.workflow_status = 'SELF_SUBMITTED'              THEN 'SUBMITTED'
         WHEN o.workflow_status IN ('RM_L1_DONE','RM_L2_DONE')  THEN 'IN_REVIEW'
         WHEN o.workflow_status IN ('FINALISED','PUBLISHED','ACKNOWLEDGED') THEN 'FINALISED'
         ELSE 'NOT_STARTED' END AS fill_status,
       o.workflow_status, o.self_score, o.final_score, o.final_rating, o.final_rating_code,
       o.finalised_by_role, o.finalised_at, o.rating_source, o.updated_at AS last_action_at
FROM pms_overall_rating o
JOIN pms_periods pe ON pe.id = o.period_id
JOIN employees e    ON e.id  = o.employee_id
LEFT JOIN vw_pms_employment_flag f ON f.employee_id = o.employee_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS kra_count, SUM(weightage) AS total_wt
  FROM pms_employee_goals WHERE employee_id=o.employee_id AND period_id=o.period_id
) g ON true
LEFT JOIN LATERAL (
  SELECT id FROM pms_one_to_one
  WHERE employee_id=o.employee_id AND period_id=o.period_id
    AND discussion_type='KRA_SETTING' AND employee_ack AND manager_ack LIMIT 1
) o121 ON true;

NOTIFY pgrst, 'reload schema';
