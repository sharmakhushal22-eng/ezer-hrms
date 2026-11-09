// A throwaway database that matches the live schema's shape, with invented data only.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { PGlite } from '@electric-sql/pglite'

const here = path.dirname(new URL(import.meta.url).pathname)
const defs = JSON.parse(fs.readFileSync(path.join(here, 'defs.json'), 'utf8'))
const REPO = process.env.REPO

const typeOf = p => {
  const f = String(p.format || p.type || 'text')
  if (f.endsWith('[]')) return f.replace(/^public\./, '').match(/^(uuid|text|integer|numeric|boolean|date|bigint)\[\]$/) ? f : 'text[]'
  if (['uuid','text','integer','bigint','smallint','boolean','date','numeric','jsonb','json','time without time zone',
       'timestamp with time zone','timestamp without time zone','character varying','real','double precision','interval','inet'].includes(f)) return f
  if (p.type === 'array') return 'text[]'
  return 'text'
}
export const fkOf = {}
function ddl() {
  const out = []
  for (const [t, d] of Object.entries(defs)) {
    // Learning's own tables come from the migrations below, with their constraints, even when
    // the copied schema already has them (once 206 has run on the real project).
    if (t.startsWith('lms_')) continue
    const cols = [], pks = []
    for (const [c, p] of Object.entries(d.properties || {})) {
      const pk = /<pk\/>/.test(p.description || '')
      const ty = typeOf(p)
      const fk = (p.description || '').match(/<fk table='([^']+)' column='([^']+)'\/>/)
      if (fk) (fkOf[t] ||= {})[c] = { table: fk[1], column: fk[2] }
      let col = `"${c}" ${ty}`
      if (pk) pks.push(c)
      if (pk && ty === 'uuid') col += ' DEFAULT gen_random_uuid()'
      else if (c === 'created_at' || c === 'updated_at') col += ' DEFAULT now()'
      cols.push(col)
    }
    if (pks.length) cols.push(`PRIMARY KEY (${pks.map(c => `"${c}"`).join(',')})`)
    if (cols.length) out.push(`CREATE TABLE IF NOT EXISTS "${t}" (${cols.join(', ')});`)
  }
  return out.join('\n')
}

const ids = {}
const id = k => (ids[k] ||= (() => {
  const h = crypto.createHash('md5').update(k).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
})())
export { id }

export async function build(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  const db = new PGlite(dir)
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.buckets TO service_role;
  `)
  await db.exec(ddl())
  await db.exec(`
    CREATE UNIQUE INDEX ON role_permissions (role_id, module);
    CREATE UNIQUE INDEX ON ess_user_roles (ess_account_id, role_id);
    CREATE UNIQUE INDEX ON ess_accounts (employee_id);
    ALTER TABLE ess_notifications ALTER COLUMN is_read SET DEFAULT false;
    ALTER TABLE employees ALTER COLUMN is_test SET DEFAULT false;
    ALTER TABLE employees ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
  `)
  await seed(db)
  for (const f of ['206_lms_schema.sql', '207_lms_engine.sql', '208_lms_roles.sql', '211_lms_live_and_scorm.sql']) {
    await db.exec(fs.readFileSync(path.join(REPO, 'supabase/migrations', f), 'utf8'))
  }
  return db
}

async function ins(db, table, row) {
  const k = Object.keys(row)
  await db.query(`INSERT INTO "${table}" (${k.map(c => `"${c}"`).join(',')}) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')})`, k.map(c => row[c]))
}

// Everything below is invented. Two companies so that isolation can be tested.
async function seed(db) {
  await db.exec(`INSERT INTO rms_config (id, enforce_module_access) VALUES (true, true);`)
  await ins(db, 'groups', { id: id('group'), group_code: 'FICT', group_name: 'Fictional Group' })
  for (const [k, code, name] of [['acme', 'ACM', 'Acme Fictional Pvt Ltd'], ['beta', 'BET', 'Beta Fictional Pvt Ltd']]) {
    await ins(db, 'companies', { id: id(k), group_id: id('group'), company_code: code, company_name: name })
    for (const [loc, nm] of [['pune', 'Pune'], ['delhi', 'Delhi']]) await ins(db, 'locations', { id: id(`${k}:${loc}`), company_id: id(k), location_code: `${code}-${loc}`, location_name: nm })
    for (const [dep, nm] of [['eng', 'Engineering'], ['sales', 'Sales'], ['hr', 'Human Resources']]) await ins(db, 'departments', { id: id(`${k}:${dep}`), company_id: id(k), dept_code: `${code}-${dep}`, dept_name: nm })
  }
  const roles = ['ADMIN_SUPER','ADMIN_COMPANY','ALL_ACCESS','BRANCH_HR','CHRO','EMPLOYEE','HOD','HR_EXECUTIVE','HR_HEAD','HR_MANAGER','IMPL_MANAGER','L1_MANAGER','MD']
  for (const r of roles) await ins(db, 'ess_roles', { id: id(`role:${r}`), role_code: r, role_name: r, scope: r === 'ADMIN_SUPER' || r === 'ALL_ACCESS' || r === 'IMPL_MANAGER' ? 'ORG' : r === 'BRANCH_HR' ? 'BRANCH' : r === 'EMPLOYEE' ? 'SELF' : 'COMPANY', salary_visibility: 'NONE', sort_order: 1 })

  const E = (key, co, code, name, dept, loc, desig, extra = {}) => ({ key, co, code, name, dept, loc, desig, ...extra })
  const people = [
    E('super','acme','ACM0001','Asha Super','hr','pune','Platform Admin',{ roles:['ADMIN_SUPER'] }),
    E('head','acme','ACM0002','Hari Head','hr','pune','HR Head',{ roles:['HR_HEAD'] }),
    E('mgr','acme','ACM0003','Mira Manager','hr','pune','HR Manager',{ roles:['HR_MANAGER'] }),
    E('exec','acme','ACM0004','Esha Executive','hr','pune','HR Executive',{ roles:['HR_EXECUTIVE'] }),
    E('branch','acme','ACM0005','Bala Branch','hr','delhi','Branch HR',{ roles:['BRANCH_HR'] }),
    E('author','acme','ACM0006','Anu Author','hr','pune','Trainer',{ roles:['LMS_AUTHOR'] }),
    E('coord','acme','ACM0007','Cyrus Coordinator','hr','pune','Coordinator',{ roles:['LMS_COORDINATOR'] }),
    E('lead','acme','ACM0010','Lata Lead','eng','pune','Engineering Manager'),
    E('dev1','acme','ACM0011','Dev One','eng','pune','Software Engineer',{ l1:'lead' }),
    E('dev2','acme','ACM0012','Dev Two','eng','pune','Software Engineer',{ l1:'lead' }),
    E('dev3','acme','ACM0013','Dev Three','eng','delhi','Senior Engineer',{ l1:'lead' }),
    E('sale1','acme','ACM0020','Sam Sales','sales','delhi','Sales Executive'),
    E('sale2','acme','ACM0021','Sia Sales','sales','pune','Sales Executive'),
    E('gone','acme','ACM0030','Gita Gone','sales','pune','Sales Executive',{ status:'Resigned' }),
    E('bhead','beta','BET0001','Bina Head','hr','pune','HR Head',{ roles:['HR_HEAD'] }),
    E('bdev','beta','BET0011','Bob Beta','eng','pune','Software Engineer'),
  ]
  for (const p of people) {
    await ins(db, 'employees', {
      id: id(`emp:${p.key}`), emp_code: p.code, company_id: id(p.co), department_id: id(`${p.co}:${p.dept}`), location_id: id(`${p.co}:${p.loc}`),
      full_name: p.name, first_name: p.name.split(' ')[0], designation: p.desig, employment_status: p.status || 'Active', employment_type: 'Employee',
      grade: 'E1', company_doj: '2024-01-15', group_doj: '2024-01-15', office_email: `${p.key}@example.test`, l1_manager_id: p.l1 ? id(`emp:${p.l1}`) : null,
    })
    await ins(db, 'ess_accounts', { id: id(`acct:${p.key}`), employee_id: id(`emp:${p.key}`), status: 'ACTIVE' })
  }
  // Roles that 208 itself creates are attached after the migrations: see attachLateRoles.
  for (const p of people) for (const r of p.roles || []) if (!r.startsWith('LMS_')) await ins(db, 'ess_user_roles', { id: crypto.randomUUID(), ess_account_id: id(`acct:${p.key}`), role_id: id(`role:${r}`), is_active: true })
  await db.exec(`
    CREATE OR REPLACE FUNCTION ess_menu(p_employee_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$
      SELECT jsonb_build_object('employee_id', p_employee_id,
        'is_rm', EXISTS (SELECT 1 FROM employees WHERE l1_manager_id = p_employee_id),
        'direct_reports', (SELECT count(*) FROM employees WHERE l1_manager_id = p_employee_id),
        'is_hod', false, 'hod_departments', '[]'::jsonb, 'roles', '[]'::jsonb,
        'functional_scope', 'SELF', 'approval_types', '[]'::jsonb, 'modules', '{}'::jsonb)
    $f$;
  `)
}

export async function attachLateRoles(db) {
  for (const [emp, code] of [['author', 'LMS_AUTHOR'], ['coord', 'LMS_COORDINATOR']]) {
    await db.query(`INSERT INTO ess_user_roles (id, ess_account_id, role_id, is_active)
                    SELECT gen_random_uuid(), $1, r.id, true FROM ess_roles r WHERE r.role_code = $2`, [id(`acct:${emp}`), code])
  }
}
