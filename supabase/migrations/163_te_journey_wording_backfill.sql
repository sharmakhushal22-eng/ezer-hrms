-- 157_te_journey_wording_backfill.sql — the history already written.
--
-- DECIDED ON 18 OCTOBER 2026: NOT APPLIED, DELIBERATELY. Khushal chose to skip
-- it. Three rows in te_audit_log still say "leg" where everything written
-- since migration 162 says "journey", and that is accepted — the entries are
-- cosmetic, nothing reads the word, and this is the only migration in the
-- module that rewrites rows somebody has already seen.
--
-- Left in the repo rather than deleted so the decision is visible and
-- reversible: anybody wondering why the old audit lines read differently finds
-- the answer and the fix in one place. If it is ever run, back up te_audit_log
-- first.
--
-- NUMBERED 163 HERE, 157 ON THE BRANCH THIS CAME FROM. The companion migration
-- it refers to is 162 in this tree and was 156 there; the merge kept this
-- branch's numbering so the pair is not carried twice under two numbers.
--
-- OPTIONAL. 162 changed what the database writes from now on. It did not touch
-- the rows already in te_audit_log, so a trip planned before 162 still shows
-- "Planned 1 leg, 42.8 km" under a screen that now says "Add a journey". This
-- file rewrites those rows. SAFE TO RUN TWICE.
--
-- WHY IT IS SEPARATE, AND WHY YOU MAY NOT WANT IT. te_audit_log is an audit
-- trail. Editing it after the fact is a different kind of act from changing a
-- label, even when only the wording moves and no fact does. Some companies
-- would rather the audit trail say exactly what the system said at the time.
-- If that is you, do not apply this file: 162 is complete without it, and only
-- rows written before it will carry the old word.
--
-- THE HAZARD THIS AVOIDS. A blanket
--
--   update te_audit_log set summary = replace(summary, 'leg', 'journey')
--
-- would corrupt real sentences people wrote. te_leg_skip stores the employee's
-- own reason -- 'Skipped: ' || p_reason -- and te_leg_no_gps stores theirs too.
-- Somebody who skipped a journey because they broke their leg would find their
-- own words rewritten into nonsense, in the audit log, where the entire point
-- is that it records what they actually said.
--
-- So every statement below is anchored on the ACTION CODE that wrote the row,
-- and then on the exact text that code produces, with ^ and $ where the text
-- is a prefix or a suffix. A summary that came from a person is never matched:
-- the two actions that carry typed text are LEG_SKIPPED, pinned here to the one
-- generated sentence it can produce, and LEG_NO_GPS, which is not touched at
-- all.
--
-- LOOK BEFORE YOU LEAP. This changes nothing and prints what is left:
--
--   select action, count(*), min(summary) as example
--     from te_audit_log
--    where summary ~ '\mLegs?\M' or entity_ref ~ '\mleg\M'
--    group by action order by count(*) desc;
--
-- Run it before and after. Any action still listed afterwards is one this file
-- deliberately leaves alone -- check it is user-written before adding it here.
-- ============================================================================

-- ── whole sentences, matched exactly ───────────────────────────────────────

update te_audit_log set summary = 'All journeys are closed.'
 where action = 'LEGS_CLOSED' and summary = 'All legs are closed.';

update te_audit_log set summary = 'Not tracked on the day. Journeys added without GPS.'
 where action = 'TRIP_RECORDED_LATE' and summary = 'Not tracked on the day. Legs added without GPS.';

update te_audit_log set summary = 'Journey closed. Company vehicle, nothing to claim.'
 where action = 'LEG_FILED' and summary = 'Leg closed. Company vehicle, nothing to claim.';

update te_audit_log set summary = 'Journey closed. The ticket was booked and paid by the company.'
 where action = 'LEG_FILED' and summary = 'Leg closed. The ticket was booked and paid by the company.';

-- LEG_SKIPPED writes two different sentences: this generated one, and
-- 'Skipped: ' || whatever the employee typed. Matching the full text exactly
-- is what keeps the employee's own words out of this.
update te_audit_log set summary = 'Skipped: the added journey goes to the same place.'
 where action = 'LEG_SKIPPED' and summary = 'Skipped: the added leg goes to the same place.';

-- ── sentences that open with the word, the rest left untouched ─────────────
-- regexp_replace with ^ rather than substring() arithmetic: an off-by-one here
-- would quietly eat the first character of an audit record.

update te_audit_log set summary = regexp_replace(summary, '^Leg started at ', 'Journey started at ')
 where action = 'LEG_STARTED' and summary like 'Leg started at %';

update te_audit_log set summary = regexp_replace(summary, '^Leg ended at ', 'Journey ended at ')
 where action = 'LEG_ENDED' and summary like 'Leg ended at %';

update te_audit_log set summary = regexp_replace(summary, '^Leg report saved\. ', 'Journey report saved. ')
 where action = 'LEG_FILED' and summary like 'Leg report saved. %';

update te_audit_log set summary = regexp_replace(summary, '^Leg added: ', 'Journey added: ')
 where action = 'LEG_ADDED' and summary like 'Leg added: %';

-- ── and one that closes with it ────────────────────────────────────────────

update te_audit_log
   set summary = regexp_replace(summary, ', because a leg was added before it\.$',
                                ', because a journey was added before it.')
 where action = 'LEG_REWIRED' and summary like '%, because a leg was added before it.';

-- ── the trip lines ─────────────────────────────────────────────────────────
-- te_trip_save builds these as <count> || ' leg'/' legs' || ', ' || <km>, so
-- the word is always followed by a comma. With the action pinning the row and
-- the comma pinning the word, replace() cannot reach anything else.
--   "Planned 1 leg, 42.8 km. Local travel up to 75 km needs no approval."
--   "Recorded after travel: 2 legs, 120 km."
--   "Sent for approval. 2 legs, 120 km by road plus flights. Estimate ..."

update te_audit_log
   set summary = replace(replace(summary, ' legs, ', ' journeys, '), ' leg, ', ' journey, ')
 where action in ('TRIP_PLANNED', 'TRIP_RECORDED', 'TRIP_SUBMITTED')
   and (summary like '% leg, %' or summary like '% legs, %');

-- ── the reference a journey row is filed under ─────────────────────────────
-- te__leg_log builds this as trip_no || ' leg ' || leg_no. Entirely generated,
-- and entity_type pins it to journey rows, so nothing else can match.

update te_audit_log set entity_ref = replace(entity_ref, ' leg ', ' journey ')
 where entity_type = 'leg' and entity_ref like '% leg %';

-- ── the one generated skip reason stored on the journey itself ─────────────
-- te_leg_add writes this when a journey it inserted makes the next one
-- redundant. Every other skip_reason was typed by a person and is left alone.

update te_legs set skip_reason = 'Replaced by the journey added before it'
 where skip_reason = 'Replaced by the leg added before it';
