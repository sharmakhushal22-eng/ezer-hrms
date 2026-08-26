-- 061_mrf_rm2_hod.sql
-- The MRF form only ever captured one manager (reporting_manager_id, treated in the
-- UI as RM1). Recruiters now need to record the full line for the position being
-- requisitioned — RM1, RM2 (skip-level) and HOD — matching the L1/L2/HOD vocabulary
-- already used by employee_relationships (058_employee_hierarchy_rms.sql). RM1 stays
-- on the existing reporting_manager_id column so no data already on live MRFs moves;
-- only rm2_id and hod_id are new.

ALTER TABLE manpower_requisitions
  ADD COLUMN IF NOT EXISTS rm2_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS hod_id UUID REFERENCES employees(id);
