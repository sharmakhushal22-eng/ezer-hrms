-- 151_te_lockdown.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  LOCK-DOWN  (run before real data goes in)
-- SAFE TO RUN TWICE. Run AFTER 149 (and after 150 if you use it).
-- RUN IT AGAIN after any later migration that adds a te_ function.
-- ----------------------------------------------------------------------------
-- WHY
--
-- Migration 145 gives the te_ tables the same allow-all policies the rest of
-- EZER uses, and a new function in Supabase can be called by anyone holding
-- the anon key. The anon key is in the browser. That means, until this file is
-- run, somebody who reads the key out of the page could call
--     rpc/te_claim_finance  or  rpc/te_payout_paid
-- with another person's employee id, or read every GPS trail in te_leg_pings.
-- The old travel module has the same weakness; this module moves money and
-- stores location, so it does not keep it.
--
-- WHAT IT DOES
--   1  te_ tables: removes the allow-all policies and the anon / authenticated
--      grants. Row level security stays ON with no policy, so the browser key
--      reads and writes nothing.
--   2  te_ functions and v_te_ views: only the service role may use them.
--   3  a company created from now on is seeded automatically.
--
-- BEFORE YOU RUN IT
--   The API routes of this module use ONLY the service-role key
--   (app-code/lib/te/server.ts refuses to start without it). Check that
--   SUPABASE_SERVICE_ROLE_KEY is set on Vercel for Production AND Preview:
--   lib/travel/access.ts falls back to the anon key when it is missing, and
--   after this file the anon key reaches nothing here.
--   The old travel module (travel_ tables) is not touched by this file.
--
-- TO UNDO  re-run 145 (it puts the allow-all policies back) and grant execute
--          on the functions again. There is no reason to.
-- ============================================================================

do $$
declare
  r record;
begin
  perform set_config('client_min_messages', 'warning', true);   -- "policy does not exist, skipping" on a second run is not news
  -- 1. tables
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'te\_%' loop
    execute format('alter table %I enable row level security', r.relname);
    execute format('drop policy if exists %I on %I', 'allow_all_' || r.relname, r.relname);
    execute format('revoke all on table %I from public', r.relname);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', r.relname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', r.relname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table %I to service_role', r.relname);
    end if;
  end loop;

  -- 2a. views
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_te\_%' loop
    execute format('revoke all on table %I from public', r.relname);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', r.relname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', r.relname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select on table %I to service_role', r.relname);
    end if;
  end loop;

  -- 2b. functions
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'te\_%' loop
    execute format('revoke all on function %s from public', r.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', r.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- 3. a new company gets its Travel and Expense settings the moment it is created
-- SECURITY DEFINER: whoever creates the company (an admin screen, with the
-- browser key) cannot write te_ tables after the lock-down above; this can.
create or replace function te_autoseed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform te_seed_company(new.id);
  exception when others then
    -- creating a company must never fail because of this module
    raise warning 'Travel and Expenses could not be set up for company %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_te_autoseed on companies;
create trigger trg_te_autoseed after insert on companies
  for each row execute function te_autoseed();
revoke all on function te_autoseed() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function te_autoseed() from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function te_autoseed() from authenticated; end if;
end $$;

notify pgrst, 'reload schema';
