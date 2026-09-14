-- 113_fix_ess_user_roles_rls.sql
--
-- Assigning a role from ESS & Access → Assign Roles failed with:
--   "new row violates row-level security policy for table ess_user_roles"
-- The browser uses the anon key; anon could SELECT ess_user_roles but not INSERT — the
-- live table had lost its permissive write policy (021/057 created "allow_all_*", but the
-- live state had diverged to select-only). This restores the project's standard pattern:
-- one permissive allow_all policy for anon + authenticated, covering every command.
--
-- Idempotent: drops whatever policies exist on each table, then recreates the single
-- allow_all policy. Safe to run more than once.

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['ess_user_roles', 'ess_accounts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

-- Verify (optional): should list exactly one allow_all_* policy per table.
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('ess_user_roles','ess_accounts');
