-- 219_pms_chain_rungs_really_checked.sql
-- Two things 218 got wrong, both found by probing the live database.
-- SAFE TO RUN TWICE. One CHECK replaced, one COMMENT corrected. No data change.
-- ----------------------------------------------------------------------------
-- ── 1. pms_chain_has_rungs DID NOT REFUSE AN EMPTY CHAIN ───────────────────
--
-- 218 wrote:
--
--   CONSTRAINT pms_chain_has_rungs CHECK (array_length(rungs, 1) >= 1)
--
-- array_length('{}', 1) is NULL in Postgres, not 0 — an empty array has no
-- first dimension to measure. NULL >= 1 is NULL, and a CHECK whose expression
-- is NULL is SATISFIED. So the constraint accepted exactly the one value it
-- was written to refuse, and `INSERT ... rungs = '{}'` succeeded.
--
-- cardinality() is the right function: it counts elements rather than
-- measuring a dimension, and returns 0 for an empty array.
--
-- WHY THE TESTS DID NOT CATCH THIS. chain-admin-route.test.ts and
-- custom-chains.test.ts both assert the constraint's TEXT appears in the
-- migration. That is a check on what 218 says, not on what Postgres does with
-- it — and the project's own rule is ENGINE COMPUTES, SQL DECIDES. Asserting
-- SQL's text and calling it verified is the engine grading its own homework.
-- 219_pms_chain_rungs_verify.sql asks the database instead.
--
-- Nothing stored is affected: no row has an empty rungs[] today, and the new
-- constraint is strictly stronger, so adding it can only refuse future writes.
--
-- ── 2. THE DOCUMENTED COLUMNS FOR RM L1 AND RM L2 DID NOT EXIST ────────────
--
-- 218's COMMENT said RM_L1 resolves through rm_l1_id and RM_L2 through
-- rm_l2_id. The columns on employees are l1_manager_id and l2_manager_id.
-- There is no rm_l1_id anywhere in this database.
--
-- The consequence was not cosmetic. lib/pms/chainBuilder.ts took its column
-- names from this COMMENT, so the chain builder's coverage read asked for a
-- column that does not exist; the route swallows a failed per-rung count by
-- design, so those two rungs simply showed no coverage at all — the one
-- number the builder exists to put in front of an administrator.
--
-- And the test that was supposed to prevent exactly this compared
-- chainBuilder.ts against this COMMENT. Both were wrong the same way, because
-- one was written from the other. Two sources agreeing is not evidence when
-- one is a copy.
--
-- MEASURED, 2026-11-05, active employees only (398 of them):
--
--   hod_id            398 of 398
--   l1_manager_id     395 of 398
--   site_hr_id        395 of 398
--   l2_manager_id     261 of 398   -- a third of the company has no L2
--   regional_head_id    0 of 398   -- the column exists; nobody populates it

ALTER TABLE pms_chain DROP CONSTRAINT IF EXISTS pms_chain_has_rungs;
ALTER TABLE pms_chain
  ADD CONSTRAINT pms_chain_has_rungs CHECK (cardinality(rungs) >= 1);

COMMENT ON COLUMN pms_chain.rungs IS
  'Ordered. Each entry must resolve to a person through a column on '
  'employees: RM_L1 l1_manager_id, RM_L2 l2_manager_id, HOD hod_id, '
  'SITE_HR site_hr_id, REGIONAL_HEAD regional_head_id. EMPLOYEE is the '
  'self rating and HR is the publish step, which is a role rather than a '
  'named person.';

NOTIFY pgrst, 'reload schema';
