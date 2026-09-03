-- =====================================================================
-- EZER HRMS — 082: can() / explain_access(), the access floor
--
-- WHY THIS FILE EXISTS
--
-- The Wall of Fame bundle (084-087) calls can() sixteen times and
-- explain_access() seven times, and both were supposed to arrive in a
-- migration 083 that does not exist in this repository and does not exist
-- in the database. Verified directly: both functions return PGRST202
-- "could not find the function". Without them every access gate in that
-- module has no floor to stand on, so this file provides one.
--
-- IT DOES NOT INVENT A SECOND PERMISSION SYSTEM.
--
-- One already exists and is populated:
--     ess_accounts      an employee's login
--     ess_roles         named roles per company
--     ess_user_roles    which account holds which role
--     role_permissions  (role_id, module, access_level NONE/VIEW/EDIT/FULL)
--
-- can() is a reading of that model, not a replacement for it. A dotted
-- permission name maps to a module plus the access level that permission
-- needs, and the answer is whether any active role the person holds reaches
-- that level. Anything else would leave two sources of truth about who may
-- do what, which is the worst possible thing to have two of.
--
-- SCOPES
--   'self'    an everyday action inside the person's own company
--   'global'  EZER's own staff only — module activation, nothing less
--   <uuid>    a company id: the action is checked against that company
--
-- NOT APPLIED FROM HERE. Nayan owns the database; this file is handed over.
-- =====================================================================

-- ── the map from a permission name to what it requires ────────────────
-- Kept as a table rather than a CASE so a permission can be re-levelled
-- without shipping a function, and so the mapping can be READ by a human
-- who is trying to work out why they were denied.
CREATE TABLE IF NOT EXISTS access_permission_map (
  permission    text PRIMARY KEY,
  module        text NOT NULL,
  needs_level   text NOT NULL CHECK (needs_level IN ('VIEW','EDIT','FULL')),
  -- true when every active employee may do it without any role at all.
  -- Reacting to a colleague's recognition is not a privilege.
  everyday      boolean NOT NULL DEFAULT false,
  -- true when only EZER's own staff may do it, never a customer's admin
  ezer_only     boolean NOT NULL DEFAULT false,
  description   text NOT NULL
);

INSERT INTO access_permission_map (permission, module, needs_level, everyday, ezer_only, description) VALUES
  ('wof.view',            'wall_of_fame', 'VIEW', true,  false, 'See the wall and the company feed'),
  ('wof.react',           'wall_of_fame', 'VIEW', true,  false, 'React to a recognition'),
  ('wof.shoutout.create', 'wall_of_fame', 'VIEW', true,  false, 'Give a shoutout to a colleague'),
  ('wof.nominate',        'wall_of_fame', 'VIEW', true,  false, 'Nominate someone for an award'),
  ('wof.endorse',         'wall_of_fame', 'EDIT', false, false, 'Endorse a nomination as a manager'),
  ('wof.shortlist',       'wall_of_fame', 'EDIT', false, false, 'Shortlist nominations'),
  ('wof.publish',         'wall_of_fame', 'EDIT', false, false, 'Publish a recognition to the wall'),
  ('wof.unpublish',       'wall_of_fame', 'EDIT', false, false, 'Remove a published recognition'),
  ('wof.moderate',        'wall_of_fame', 'EDIT', false, false, 'Moderate reported content'),
  ('wof.report.view',     'wall_of_fame', 'VIEW', false, false, 'See recognition reports'),
  ('wof.board.manage',    'wall_of_fame', 'EDIT', false, false, 'Manage the digital board'),
  ('wof.badge.manage',    'wall_of_fame', 'FULL', false, false, 'Create and change badges'),
  ('wof.configure',       'wall_of_fame', 'FULL', false, false, 'Configure the module'),
  ('wof.admin.grant',     'wall_of_fame', 'FULL', false, false, 'Grant Wall Administrator rights'),
  ('wof.module.activate', 'wall_of_fame', 'FULL', false, true,  'Switch the module on for a company'),
  ('company.activate',    'platform',     'FULL', false, true,  'Activate a module for a company')
ON CONFLICT (permission) DO UPDATE
  SET module = excluded.module, needs_level = excluded.needs_level,
      everyday = excluded.everyday, ezer_only = excluded.ezer_only,
      description = excluded.description;

-- ── level ordering ────────────────────────────────────────────────────
-- NONE < VIEW < EDIT < FULL. An unrecognised level sorts to 0, so a typo in
-- role_permissions can only ever grant LESS than intended, never more.
CREATE OR REPLACE FUNCTION access_level_rank(p_level text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(p_level,''))
           WHEN 'FULL' THEN 3 WHEN 'EDIT' THEN 2 WHEN 'VIEW' THEN 1 ELSE 0 END;
$$;

-- ── the highest level this employee holds for a module ────────────────
CREATE OR REPLACE FUNCTION access_level_of(p_employee uuid, p_module text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT rp.access_level
       FROM ess_accounts a
       JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND coalesce(ur.is_active, true)
       JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE a.employee_id = p_employee
        AND rp.module = p_module
      ORDER BY access_level_rank(rp.access_level) DESC
      LIMIT 1),
    'NONE');
$$;

-- ── is this person EZER's own staff? ──────────────────────────────────
-- Deliberately narrow. Module activation is not a customer-side decision,
-- and a customer admin who could self-activate would make the whole
-- "nothing is self-serve" rule decorative.
-- Matched on role_code, which is UNIQUE and stable, rather than on the
-- display name — 'Admin (Super)' is a label somebody may reasonably retitle,
-- and an access check that breaks when a label is edited is a trap.
CREATE OR REPLACE FUNCTION is_ezer_staff(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM ess_accounts a
      JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND coalesce(ur.is_active, true)
      JOIN ess_roles r ON r.id = ur.role_id
     WHERE a.employee_id = p_employee
       AND coalesce(a.status,'INACTIVE') = 'ACTIVE'
       AND r.role_code = 'ADMIN_SUPER'
  );
$$;

-- ── can(employee, permission, scope) ──────────────────────────────────
-- The three-argument form the bundle calls with 'self' / 'global' / a
-- company uuid rendered as text.
CREATE OR REPLACE FUNCTION can(p_employee uuid, p_permission text, p_scope text DEFAULT 'self')
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  m access_permission_map%ROWTYPE;
  v_emp_company uuid;
  v_scope_company uuid;
BEGIN
  IF p_employee IS NULL THEN RETURN false; END IF;

  SELECT * INTO m FROM access_permission_map WHERE permission = p_permission;
  -- An unknown permission is DENIED, never allowed. A typo in a route must
  -- fail shut; the alternative is a route that silently checks nothing.
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT company_id INTO v_emp_company FROM employees
   WHERE id = p_employee AND date_of_leaving IS NULL;
  -- Somebody who has left keeps no permissions at all.
  IF v_emp_company IS NULL THEN RETURN false; END IF;

  IF m.ezer_only THEN RETURN is_ezer_staff(p_employee); END IF;

  -- A company-scoped check must be about the employee's OWN company.
  IF p_scope IS NOT NULL AND p_scope NOT IN ('self','global') THEN
    BEGIN v_scope_company := p_scope::uuid; EXCEPTION WHEN others THEN RETURN false; END;
    IF v_scope_company <> v_emp_company THEN RETURN false; END IF;
  END IF;

  IF m.everyday THEN RETURN true; END IF;

  RETURN access_level_rank(access_level_of(p_employee, m.module))
       >= access_level_rank(m.needs_level);
END;
$$;

-- The four-argument form 084 also calls: (employee, permission, company, branch).
-- Branch is accepted and ignored here on purpose — see the note in 084 about
-- this schema having locations rather than branches.
CREATE OR REPLACE FUNCTION can(p_employee uuid, p_permission text,
                               p_company uuid, p_branch uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT can(p_employee, p_permission, coalesce(p_company::text, 'self'));
$$;

-- ── explain_access(): why not ─────────────────────────────────────────
-- Denial is a state, not a 404. Telling somebody "this needs Wall
-- Administrator level, ask a Wall Owner" is worth more than a blank screen,
-- so every branch here returns a sentence a person can act on.
CREATE OR REPLACE FUNCTION explain_access(p_employee uuid, p_permission text,
                                          p_company uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  m access_permission_map%ROWTYPE;
  v_emp_company uuid;
  v_have text;
BEGIN
  IF p_employee IS NULL THEN
    RETURN 'You are not signed in.';
  END IF;

  SELECT * INTO m FROM access_permission_map WHERE permission = p_permission;
  IF NOT FOUND THEN
    RETURN format('"%s" is not a permission this system knows about. '
                  'That is a fault in the screen, not in your access.', p_permission);
  END IF;

  SELECT company_id INTO v_emp_company FROM employees
   WHERE id = p_employee AND date_of_leaving IS NULL;
  IF v_emp_company IS NULL THEN
    RETURN 'This account is no longer an active employee, so it holds no permissions.';
  END IF;

  IF m.ezer_only AND NOT is_ezer_staff(p_employee) THEN
    RETURN format('%s is done by EZER, not from inside a company. Ask EZER support.',
                  m.description);
  END IF;

  IF p_company IS NOT NULL AND p_company <> v_emp_company THEN
    RETURN 'That belongs to a different company from yours.';
  END IF;

  IF can(p_employee, p_permission, coalesce(p_company::text,'self')) THEN
    RETURN 'You have access to this.';
  END IF;

  v_have := access_level_of(p_employee, m.module);
  RETURN format('%s needs %s access to %s. You have %s. Ask a Wall Owner or your HR admin.',
                m.description, m.needs_level, replace(m.module,'_',' '),
                CASE WHEN v_have = 'NONE' THEN 'none' ELSE v_have END);
END;
$$;

-- =====================================================================
-- STILL YOURS, NAYAN
-- =====================================================================
-- 1. RLS. access_permission_map is a lookup table and is safe to expose
--    read-only; it contains no company data. Suggested:
--        ALTER TABLE access_permission_map ENABLE ROW LEVEL SECURITY;
--        CREATE POLICY read_all ON access_permission_map FOR SELECT USING (true);
--    Writes should be service-role only. Please confirm rather than copying
--    an allow-all policy from an older migration.
--
-- 2. is_ezer_staff() identifies EZER's own staff as ess_roles.role_code =
--    'ADMIN_SUPER' with an ACTIVE ess_account. Please confirm that is the
--    right code — it is the one seeded in 027, but it is also the single
--    assumption in this file that would silently widen access if wrong.
--
-- 3. can() reads ess_accounts.employee_id. If that column is named otherwise,
--    this is the single place to correct.
-- =====================================================================
