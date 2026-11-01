-- =====================================================================
-- 208_lms_roles.sql — who may do what in EZER Learn. Needs 206 and 207. Safe to run twice.
--
-- Three permissions, so content and assignment stay independent. They are ordinary rows
-- in role_permissions, so HR changes them in Roles → Module Access like any other module:
--
--   Learning Content      VIEW  see every course, drafts included
--                         EDIT  create and edit, upload, build quizzes, submit for review
--                         FULL  review, publish, archive, categories, LMS settings
--   Learning Assignment   VIEW  see assignments and who is enrolled
--                         EDIT  assign to people and groups, invite candidates, manage enrolments
--                         FULL  organisation-wide assignment, automation, onboarding templates
--   Learning Reports      VIEW  dashboards, reports, exports
--
-- A manager needs none of these: the team view comes from the reporting line, and an
-- employee's own learning belongs to every employee. Those live in ESS.
--
-- Super Admin needs no row: it resolves to FULL on every module (lib/rms/resolve.ts).
--
-- ON CONFLICT DO NOTHING throughout, so re-running this never undoes a change HR made
-- in the matrix. Nobody is given a new role here; assign them in Roles → Assign Roles.
-- =====================================================================

-- ── Three small roles for companies that want them ──────────────────────────
-- role_code has no unique constraint on the live database (see 083), hence the guard.
INSERT INTO ess_roles (role_code, role_name, salary_visibility, scope, sort_order)
SELECT v.code, v.name, 'NONE', 'COMPANY', v.sort
  FROM (VALUES
    ('LND_MANAGER',     'L&D Manager',          30),   -- owns learning without any wider HR access
    ('LMS_AUTHOR',      'Content Author',       31),   -- builds courses; cannot publish or assign
    ('LMS_COORDINATOR', 'Training Coordinator', 32)    -- assigns and chases; cannot change content
  ) AS v(code, name, sort)
 WHERE NOT EXISTS (SELECT 1 FROM ess_roles r WHERE r.role_code = v.code);

-- ── What each role opens ────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, module, access_level)
SELECT r.id, v.module, v.lvl
  FROM (VALUES
    -- Company-level owners of the function.
    ('ALL_ACCESS',      'Learning Content',    'FULL'), ('ALL_ACCESS',      'Learning Assignment', 'FULL'), ('ALL_ACCESS',      'Learning Reports', 'VIEW'),
    ('ADMIN_COMPANY',   'Learning Content',    'FULL'), ('ADMIN_COMPANY',   'Learning Assignment', 'FULL'), ('ADMIN_COMPANY',   'Learning Reports', 'VIEW'),
    ('CHRO',            'Learning Content',    'FULL'), ('CHRO',            'Learning Assignment', 'FULL'), ('CHRO',            'Learning Reports', 'VIEW'),
    ('HR_HEAD',         'Learning Content',    'FULL'), ('HR_HEAD',         'Learning Assignment', 'FULL'), ('HR_HEAD',         'Learning Reports', 'VIEW'),
    ('LND_MANAGER',     'Learning Content',    'FULL'), ('LND_MANAGER',     'Learning Assignment', 'FULL'), ('LND_MANAGER',     'Learning Reports', 'VIEW'),
    -- EZER implementation sets a customer up; it does not need to publish their courses.
    ('IMPL_MANAGER',    'Learning Content',    'EDIT'), ('IMPL_MANAGER',    'Learning Assignment', 'EDIT'), ('IMPL_MANAGER',    'Learning Reports', 'VIEW'),
    -- HR Manager builds and assigns; HR Head or L&D signs off.
    ('HR_MANAGER',      'Learning Content',    'EDIT'), ('HR_MANAGER',      'Learning Assignment', 'FULL'), ('HR_MANAGER',      'Learning Reports', 'VIEW'),
    -- The HR desk assigns what is published and follows up.
    ('HR_EXECUTIVE',    'Learning Content',    'VIEW'), ('HR_EXECUTIVE',    'Learning Assignment', 'EDIT'), ('HR_EXECUTIVE',    'Learning Reports', 'VIEW'),
    ('BRANCH_HR',       'Learning Content',    'VIEW'), ('BRANCH_HR',       'Learning Assignment', 'EDIT'), ('BRANCH_HR',       'Learning Reports', 'VIEW'),
    -- The two single-purpose roles: the separation the module is built around.
    ('LMS_AUTHOR',      'Learning Content',    'EDIT'),
    ('LMS_COORDINATOR', 'Learning Content',    'VIEW'), ('LMS_COORDINATOR', 'Learning Assignment', 'EDIT'), ('LMS_COORDINATOR', 'Learning Reports', 'VIEW'),
    -- Leadership reads the compliance position.
    ('MD',              'Learning Reports',    'VIEW')
  ) AS v(code, module, lvl)
  JOIN ess_roles r ON r.role_code = v.code
ON CONFLICT (role_id, module) DO NOTHING;
