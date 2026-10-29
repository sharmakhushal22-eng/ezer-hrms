-- 196_pms_carry_forward_is_a_policy_choice.sql — KRA carry-forward becomes
-- policy configuration, defaulting to ON as the spec resolves it.
-- SAFE TO RUN TWICE. Adds one column with a default. No data change, no
-- constraint altered, nothing dropped.
-- ----------------------------------------------------------------------------
-- EZER_PMS_Module_Spec_v2 §13.2(3), "Open Architectural Decisions — Current
-- Resolution":
--
--   "Goal Continuity & Carry-Forward: Quarterly cycles automatically carry
--    forward existing KRAs and KPIs BY DEFAULT (source = CARRIED_FORWARD)."
--
-- Carry-forward was built earlier today and it is unconditional: any employee
-- opening a period with no KRAs of their own is offered the previous period's
-- locked set. That matches the default the spec asks for and nothing else —
-- there is no way to turn it off.
--
-- "By default" is the operative phrase. §6.1 runs four policies side by side
-- in one company, from Quarterly down to Annual, and carrying a year-old KRA
-- set into a fresh annual cycle is a very different proposition from carrying
-- last quarter's. An Annual or Plant Operations policy may well want to start
-- each cycle clean. The spec says default, not always, and the difference is
-- the whole point of a policy engine.
--
-- DEFAULT true, so every existing policy keeps today's behaviour and nobody
-- has to go and switch it on to get what the spec already promises. A policy
-- that wants a clean start turns it off, deliberately, and the admin screen
-- shows which it is.
--
-- No backfill: the column default covers every existing row, and there is no
-- prior state to migrate because nothing has ever recorded this choice.

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS carry_forward_kras boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN pms_policies.carry_forward_kras IS
  'Spec §13.2(3): recurring cycles carry the previous period''s LOCKED KRAs '
  'forward as the starting point, marked source = CARRIED_FORWARD. Default '
  'true, which is the resolution the spec states; a policy that should start '
  'each cycle from nothing sets it false.';

NOTIFY pgrst, 'reload schema';
