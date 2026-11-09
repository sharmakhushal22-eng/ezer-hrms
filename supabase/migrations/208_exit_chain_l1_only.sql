-- 208_exit_chain_l1_only.sql
-- ===========================================================================
-- Exit approval: the Reporting Manager (L1), then the HR Manager. L2 and HOD are no longer asked.
--
-- SAFE TO RUN TWICE.
--
-- Decided 01-Nov-2026: an exit (the employee's own resignation, and the exits HR starts, which
-- walk the same chain — lib/exit/hr-exit.ts STAGE_ORDER) needs only the L1 manager's approval
-- (with their last working day); the HR Manager then sets the final last working day.
--
--   fn_resignation_advance   walks RM_L1 → HR_MANAGER (was RM_L1 → RM_L2 → HOD → HR_MANAGER).
--                            A resignation still on a stage that is no longer in the chain moves on
--                            to the HR Manager. The HR Manager stage is never skipped as "already
--                            acted": it is the stage that sets the final last working day.
--   in flight                resignations waiting on an L2 manager or a HOD go to the HR Manager
--                            now; the stage they leave is logged SKIPPED ("Removed from the
--                            approval flow"). One on retention hold at those stages stays on hold;
--                            when it is resumed and approved it goes to the HR Manager.
-- ===========================================================================

CREATE OR REPLACE FUNCTION fn_resignation_advance(p_resignation_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD; stages TEXT[] := ARRAY['RM_L1','HR_MANAGER'];
  i INT := 1; s TEXT; appr UUID; acted BOOLEAN;
BEGIN
  SELECT * INTO r FROM employee_resignation WHERE id = p_resignation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resignation % not found', p_resignation_id; END IF;
  IF r.current_stage IS NOT NULL THEN
    -- A stage that is no longer in the chain (RM_L2, HOD) hands over to the HR Manager.
    i := COALESCE(array_position(stages, r.current_stage) + 1, array_position(stages, 'HR_MANAGER'));
  END IF;
  WHILE i <= array_length(stages, 1) LOOP
    s := stages[i];
    appr := fn_resignation_stage_approver(r.employee_id, s);
    SELECT EXISTS (SELECT 1 FROM resignation_stage_log l WHERE l.resignation_id = p_resignation_id
                     AND l.approver_id = appr AND l.action IN ('ACKNOWLEDGED','ACCEPTED_WITH_DATE')) INTO acted;
    IF appr IS NULL OR appr = r.employee_id OR (acted AND s <> 'HR_MANAGER') THEN
      INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, action, note)
      VALUES (p_resignation_id, s, appr, 'SKIPPED',
              CASE WHEN appr IS NULL THEN 'No approver resolved' WHEN appr = r.employee_id THEN 'Resolves to the resigning employee' ELSE 'Already acted at an earlier stage' END);
      i := i + 1; CONTINUE;
    END IF;
    UPDATE employee_resignation
       SET current_stage = s, current_approver_id = ess_effective_approver(appr), status = 'PENDING_' || s
     WHERE id = p_resignation_id;
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, action)
    VALUES (p_resignation_id, s, ess_effective_approver(appr), 'STAMPED');
    RETURN s;
  END LOOP;
  -- Chain exhausted without an HR Manager stamp: park it for HR under the old status.
  UPDATE employee_resignation SET current_stage = NULL, current_approver_id = NULL, status = 'INITIATED' WHERE id = p_resignation_id;
  RETURN NULL;
END $$;

-- Resignations waiting on an L2 manager or a HOD: on to the HR Manager.
DO $$
DECLARE x RECORD;
BEGIN
  FOR x IN SELECT id, current_stage, current_approver_id FROM employee_resignation WHERE status IN ('PENDING_RM_L2', 'PENDING_HOD') LOOP
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, action, note)
    VALUES (x.id, x.current_stage, x.current_approver_id, 'SKIPPED', 'Removed from the approval flow (L1 and HR Manager only)');
    PERFORM fn_resignation_advance(x.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
