-- ============================================================================
-- EZER HRMS — RMS FOLLOW-UPS
-- Migration 056
-- ----------------------------------------------------------------------------
-- Two small things 055 left open. Safe to re-run, and safe to run while people
-- are using the system — nothing here touches data.
-- ============================================================================

begin;

-- ============================================================================
-- SECTION 1 — THE IMPERSONATION LOG STOPS BEING WORLD-WRITABLE
-- Viewing the portal as somebody else shows one person another person's salary,
-- documents and claims. The record of who did that, to whom, and when is the
-- only thing standing behind it — and until now anyone holding the anon key
-- could write or rewrite that record from a browser console.
--
-- Reading stays open so the audit screen still renders. Writing moved to
-- /api/rms/admin, which takes the admin's identity from their signed session
-- rather than from whatever the caller passed.
-- ============================================================================

do $$
declare p record;
begin
  execute 'alter table ess_impersonation_log enable row level security';
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'ess_impersonation_log'
  loop
    execute format('drop policy %I on ess_impersonation_log', p.policyname);
  end loop;
  execute 'create policy ess_impersonation_log_read on ess_impersonation_log '
          'for select to anon, authenticated using (true)';
end $$;


-- ============================================================================
-- SECTION 2 — THE AUDIT TRAIL STOPS BEING WORLD-WRITABLE
-- Same argument, one step further. An audit row that anyone can insert or edit
-- is not an audit row. ess_access_audit is written only by /api/rms/admin now.
-- ============================================================================

do $$
declare p record;
begin
  execute 'alter table ess_access_audit enable row level security';
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'ess_access_audit'
  loop
    execute format('drop policy %I on ess_access_audit', p.policyname);
  end loop;
  execute 'create policy ess_access_audit_read on ess_access_audit '
          'for select to anon, authenticated using (true)';
end $$;


-- ============================================================================
-- VERIFICATION
-- Each table should show exactly one policy, and it should be SELECT only.
-- ============================================================================

select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('ess_roles','ess_user_roles','role_permissions',
                     'role_approval_rights','ess_accounts',
                     'ess_impersonation_log','ess_access_audit')
 order by tablename, policyname;

-- ess_accounts should appear NOT AT ALL in the list above — it has no policy,
-- which is what makes it service-role only.

commit;
