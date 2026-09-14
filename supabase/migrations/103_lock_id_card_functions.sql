-- =====================================================================
-- 103_lock_id_card_functions.sql
-- 092's REVOKE did nothing, and no ID card was ever issued
--
-- FOR: Nayan Ahuja. Grants, plus the seeding step that did not run.
-- No schema change.
--
-- ─── 1. THE REVOKE THAT DID NOT REVOKE ───────────────────────────────
--
-- 092 ends with:
--
--     revoke all on function issue_id_card, revoke_id_card,
--       register_id_token, consume_id_token from anon, authenticated;
--
-- That has no effect. Postgres grants EXECUTE on a new function to PUBLIC,
-- and anon inherits PUBLIC. Revoking from anon by name leaves the PUBLIC
-- grant untouched, so the function stays callable.
--
-- Measured with the publishable key that ships in the browser:
--
--     issue_id_card      -> P0001 "employee not found"   (it RAN)
--     register_id_token  -> 23503 foreign key violation  (it RAN)
--     consume_id_token   -> {"valid": false, ...}        (it RAN)
--
-- Each reached its own logic, which means the permission check never
-- stopped them. What that allows:
--
--   * issue_id_card(<anyone>) ROTATES THAT EMPLOYEE'S SECRET and bumps
--     card_version, which invalidates every live QR they have. A silent
--     denial of service against any employee's gate access, from a key
--     that is in every browser.
--   * register_id_token lets somebody farm jti rows.
--   * consume_id_token lets somebody burn a token they never held, so the
--     real holder's next scan reports "already used".
--
-- The fix is one word: revoke from PUBLIC as well. 094 and 096 already do
-- this correctly — `from public, anon, authenticated` — which is why their
-- wrappers answer 42501 and these do not.
--
-- ─── 2. ANY EMPLOYEE WITHOUT A CARD GETS ONE ─────────────────────────
--
-- 092 section 7 loops over active employees calling issue_id_card. Whether
-- it ran cannot be told from outside: the three id_card_* tables carry a
-- deny-all RLS policy, so the publishable key sees an empty set whether the
-- rows are absent or merely hidden. Section 2 below therefore does not
-- assume either way — it fills the gaps and leaves existing cards alone.
--
-- THAT DISTINCTION MATTERS MORE THAN IT LOOKS. issue_id_card is written
-- ON CONFLICT DO UPDATE:
--
--     set secret       = encode(gen_random_bytes(32), 'base64'),
--         card_version = id_card_credentials.card_version + 1
--
-- so calling it for somebody who ALREADY has a card rotates their secret
-- and bumps card_version — which invalidates every token they hold, at that
-- instant, including the one somebody may be holding up at a gate. Re-running
-- 092's loop wholesale would do that to all 398 employees.
--
-- So the loop below is guarded by NOT EXISTS. It issues to whoever has no
-- card and touches nobody who does.
--
-- SAFE TO RUN TWICE: the grants are idempotent, and the second run finds
-- every employee already carded and does nothing.
-- =====================================================================

-- ─── 1. lock the functions properly ──────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'issue_id_card(uuid,uuid)',
    'revoke_id_card(uuid,text,uuid)',
    'register_id_token(text,uuid,int,int)',
    'consume_id_token(text,text,inet,text)'
  ]
  loop
    -- PUBLIC is the one that matters. Naming anon and authenticated too is
    -- belt and braces in case somebody granted them explicitly later.
    execute format('revoke all on function %s from public, anon, authenticated', f::regprocedure);
    execute format('grant execute on function %s to service_role', f::regprocedure);
  end loop;
end $$;

-- consume_id_token is called by the VERIFY endpoint, which runs on the
-- server with the service key — a guard's phone hits our route, not the
-- database. So it does not need a public grant either.

notify pgrst, 'reload schema';

-- ─── 2. issue a card to anyone who has none ──────────────────────────
do $$
declare r record; n int := 0;
begin
  for r in
    select e.id from employees e
     where e.date_of_leaving is null
       and lower(coalesce(e.employment_status, 'active')) = 'active'
       -- The guard. Without it this rotates every existing card's secret and
       -- kills every live QR.
       and not exists (select 1 from id_card_credentials c where c.employee_id = e.id)
  loop
    perform issue_id_card(r.id);
    n := n + 1;
  end loop;
  raise notice 'issued or rotated % ID cards', n;
end $$;

-- ─── 3. confirm ──────────────────────────────────────────────────────
-- Expect a row per active employee, and no anon, authenticated or PUBLIC
-- entry in proacl for any of the four functions.
select (select count(*) from employees
         where date_of_leaving is null
           and lower(coalesce(employment_status,'active')) = 'active') as active_employees,
       (select count(*) from id_card_credentials)                      as cards_on_file;

select p.proname,
       coalesce(array_to_string(p.proacl, E'\n'), '(default: PUBLIC)') as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('issue_id_card','revoke_id_card','register_id_token','consume_id_token')
 order by p.proname;
