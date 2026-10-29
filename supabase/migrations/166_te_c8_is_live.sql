-- 166_te_c8_is_live.sql — C8 is now evaluated, and evaluated as the person types.
-- SAFE TO RUN TWICE. Data only: no table, no function, no behaviour.
-- ----------------------------------------------------------------------------
-- WHAT C8 IS. "Employee already tagged as co-traveller on the bill", a block.
-- The co-traveller feature lets several people share one trip, which is what
-- makes a shared dinner or one hotel room possible — and the same thing that
-- lets one receipt be claimed twice, once by each of them.
--
-- It was declared in the catalogue by migration 149 and evaluated nowhere. It
-- is implemented now, in the rules engine's C block, in two arms:
--
--   a) the payer declared the bill SHARED, which is them saying out loud that
--      it covered the others. Anyone covered by it claiming their own is a
--      second claim on one expense.
--   b) the same category, date and amount as another person's line on this
--      same trip, which is one receipt entered twice.
--
-- It fires only on a trip that actually has co-travellers; one person's own
-- duplicates are B4's job.
--
-- WHY is_live CHANGES. The column means "evaluated while the person types",
-- not "implemented" — Admin → Checks renders it as "Checked as they type".
-- C8 runs inside lineFlags, which is what expensePreview calls, so it is live
-- in that sense and the screen should say so. Left at false it would read
-- "Checked on the claim", which is now the wrong half of a true statement.
--
-- WHY THIS IS A MIGRATION AND NOT A SEED EDIT. 149 and 156 seed the catalogue
-- with `on conflict do nothing`, so editing them changes nothing for a company
-- whose rows already exist — which is every company. The flag has to be moved
-- on the rows that are there.
--
-- THE SWITCH IS LEFT ALONE. is_enabled is an administrator's decision and this
-- does not touch it: a company that has deliberately switched C8 off stays
-- switched off. Only the description of WHEN it runs is corrected.
-- ============================================================================

update te_checks
   set is_live = true,
       updated_at = now()
 where code = 'C8'
   and is_live is distinct from true;

-- A quick way to see the effect:
--   select company_id, code, is_enabled, is_live from te_checks where code = 'C8';
