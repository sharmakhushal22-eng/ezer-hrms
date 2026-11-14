// app/api/analytics/access/route.ts — who may open People Analytics, and on what.
//
// GET                       anyone signed in: { org, via, manage, … } — does this person
//                           have the organisation view? (ESS Insights asks this to offer
//                           its Organisation tab.)
// GET ?view=manage          administrators: the grants, the people who have access
//                           through a role, and the options the form may offer.
// GET ?search=text          administrators: employees to pick, in their companies.
// POST                      administrators: give or change access for one or more people.
// DELETE ?employee_id=      administrators: remove a person's grant (their role, if any,
//                           applies again).
//
// "Administrators" = whoever may hand out roles (Super Admin, HR Head, CHRO) or holds
// ESS & Roles at FULL. Nobody may give more than they have: companies outside their own
// scope, pay without pay access, names without names. Nobody edits their own row.
// Every change is written to ess_access_audit.
import { NextRequest, NextResponse } from 'next/server'
import { requireGrant } from '@/lib/rms/authz'
import { allowedCompanies, SUPER_ADMIN_CODES, type Grant } from '@/lib/rms/resolve'
import { sb, inChunks, soft } from '@/lib/analytics/server/db'
import { orgAccessFor, canManageAnalytics, tableReady, isMissingTable, GATE, ROW_COLS } from '@/lib/analytics/server/access'
import { ORG_TABS, rowApplies, rowTabs, limitLabel, type AccessRow, type OrgTab } from '@/lib/analytics/access'
import { istToday } from '@/lib/analytics/period'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
const MISSING = 'Run migration 232_analytics_access.sql in the Supabase SQL editor to turn on Manage access.'

/** The companies this administrator may hand out: every one for a cross-company caller,
 *  else the companies their roles are valid in. Null = every company. */
function grantable(g: Grant): string[] | null {
  if (g.isSuperAdmin || g.legacy || g.crossCompany) return null
  return allowedCompanies(g, 'ESS & Roles')
}

async function companies(ids: string[] | null) {
  let q = sb.from('companies').select('id, company_name, short_name, company_code').order('company_name')
  if (ids) q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const { data } = await q
  return ((data || []) as any[]).map(c => ({ id: c.id as string, label: (c.company_name || c.short_name || c.company_code) as string }))
}

export async function GET(req: NextRequest) {
  const gate = await requireGrant(req)
  if (gate.error) return gate.error
  const g = gate.grant
  const sp = req.nextUrl.searchParams
  const manage = canManageAnalytics(g)

  // ── Employee picker ──────────────────────────────────────────────────────
  const search = (sp.get('search') || '').trim().slice(0, 60)
  if (sp.has('search')) {
    if (!manage) return bad('You cannot give analytics access.', 403)
    if (search.length < 2) return NextResponse.json({ people: [] })
    const scope = grantable(g)
    const term = search.replace(/[%,()]/g, ' ')
    let q = sb.from('employees').select('id, full_name, emp_code, designation, company_id, is_test, date_of_leaving')
      .or(`full_name.ilike.%${term}%,emp_code.ilike.%${term}%`).order('full_name').limit(25)
    if (scope) q = q.in('company_id', scope.length ? scope : ['00000000-0000-0000-0000-000000000000'])
    const [{ data }, cos] = await Promise.all([q, companies(null)])
    const coName = new Map(cos.map(c => [c.id, c.label]))
    const today = istToday()
    const people = ((data || []) as any[])
      .filter(e => e.is_test !== true && (!e.date_of_leaving || String(e.date_of_leaving).slice(0, 10) >= today))
      .map(e => ({ id: e.id, name: e.full_name, code: e.emp_code, designation: e.designation, company: coName.get(e.company_id) || null }))
    return NextResponse.json({ people })
  }

  // ── The management screen ────────────────────────────────────────────────
  if (sp.get('view') === 'manage') {
    if (!manage) return bad('You cannot give analytics access.', 403)
    const ready = await tableReady()
    const scope = grantable(g)
    const cos = await companies(scope)
    const coIds = cos.map(c => c.id)
    const mine = await orgAccessFor(g)

    const [locs, depts, types, rows, holders] = await Promise.all([
      soft(inChunks<any>(coIds, c => sb.from('locations').select('location_name, company_id').in('company_id', c).order('location_name') as any, 'locations')),
      soft(inChunks<any>(coIds, c => sb.from('departments').select('dept_name, company_id').in('company_id', c).order('dept_name') as any, 'departments')),
      soft(inChunks<any>(coIds, c => sb.from('employees').select('employment_type').in('company_id', c).not('employment_type', 'is', null).order('employment_type') as any, 'types')),
      ready ? sb.from('analytics_access').select(ROW_COLS).order('updated_at', { ascending: false }).then(r => (r.data || []) as AccessRow[]) : Promise.resolve([] as AccessRow[]),
      roleHolders(coIds),
    ])
    const coName = new Map(cos.map(c => [c.id, c.label]))
    const allCos = scope ? null : coIds
    const grantedIds = rows.map(r => r.employee_id)
    const { data: people } = grantedIds.length
      ? await sb.from('employees').select('id, full_name, emp_code, designation, company_id').in('id', grantedIds)
      : { data: [] as any[] }
    const pById = new Map(((people || []) as any[]).map(p => [p.id, p]))
    const today = istToday()
    const grants = rows
      // An administrator over some companies sees only the grants of people in them.
      .filter(r => { const p = pById.get(r.employee_id); return p && (!scope || scope.includes(p.company_id)) })
      .map(r => {
        const p = pById.get(r.employee_id)
        return {
          ...r,
          name: p.full_name, code: p.emp_code, designation: p.designation, company: coName.get(p.company_id) || null,
          tabs: rowTabs(r),
          live: rowApplies(r, today),
          scopeLabel: limitLabel({ companies: r.company_ids, locations: r.locations, departments: r.departments, types: r.employment_types }, id => coName.get(id)) || 'Everything',
        }
      })
    return NextResponse.json({
      table: ready,
      grants,
      holders: holders.filter(h => !grantedIds.includes(h.id)),
      options: {
        companies: cos,
        allCompanies: allCos !== null,
        locations: uniq(locs.map((l: any) => [l.location_name, l.company_id])),
        departments: uniq(depts.map((d: any) => [d.dept_name, d.company_id])),
        types: [...new Set(types.map((t: any) => String(t.employment_type)))].sort(),
      },
      can: { pay: g.isSuperAdmin || g.legacy || !!mine?.cost, names: g.isSuperAdmin || g.legacy || !!mine?.people },
      me: g.employeeId,
    })
  }

  // ── "Do I have the organisation view?" ─────────────────────────────────────
  const acc = await orgAccessFor(g)
  return NextResponse.json({ org: !!acc, via: acc?.via || null, tabs: acc?.tabs || [], export: acc?.export ?? false, manage, until: acc?.until || null })
}

/** [name, company] pairs → one option per name, with the companies it exists in. */
function uniq(pairs: [string, string][]) {
  const m = new Map<string, Set<string>>()
  for (const [n, c] of pairs) { if (!n) continue; const s = m.get(n) || new Set(); s.add(c); m.set(n, s) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, cs]) => ({ name, companies: [...cs] }))
}

/** People who reach analytics through a role, in these companies — so the screen can
 *  show the whole picture of who sees what, not only the grants made here. */
async function roleHolders(companyIds: string[]) {
  const [{ data: perms }, { data: roles }] = await Promise.all([
    sb.from('role_permissions').select('role_id, module, access_level').in('module', GATE),
    sb.from('ess_roles').select('id, role_code, role_name, scope'),
  ])
  const roleById = new Map(((roles || []) as any[]).map(r => [r.id, r]))
  const gateRoles = new Set<string>(((perms || []) as any[]).filter(p => p.access_level && p.access_level !== 'NONE').map(p => p.role_id))
  for (const r of (roles || []) as any[]) if (SUPER_ADMIN_CODES.includes(r.role_code)) gateRoles.add(r.id)
  // The automatic EMPLOYEE role never carries these; if it ever did, everybody would be
  // listed, which helps nobody.
  for (const id of [...gateRoles]) if (roleById.get(id)?.role_code === 'EMPLOYEE') gateRoles.delete(id)
  if (!gateRoles.size) return []
  const ur = await soft(inChunks<any>([...gateRoles], c => sb.from('ess_user_roles').select('ess_account_id, role_id, company_ids').in('role_id', c).eq('is_active', true).order('ess_account_id') as any, 'user roles'))
  const accts = await soft(inChunks<any>([...new Set(ur.map((u: any) => u.ess_account_id as string))], c => sb.from('ess_accounts').select('id, employee_id').in('id', c).order('id') as any, 'accounts'))
  const empOf = new Map(accts.map((a: any) => [a.id, a.employee_id]))
  const emps = await soft(inChunks<any>([...new Set(accts.map((a: any) => a.employee_id as string))], c => sb.from('employees').select('id, full_name, emp_code, designation, company_id, is_test').in('id', c).order('id') as any, 'holders'))
  const byEmp = new Map<string, { id: string; name: string; code: string | null; designation: string | null; roles: Set<string> }>()
  const inScope = new Set(companyIds)
  const eById = new Map(emps.map((e: any) => [e.id, e]))
  for (const u of ur as any[]) {
    const e: any = eById.get(empOf.get(u.ess_account_id))
    if (!e || e.is_test === true || !inScope.has(e.company_id)) continue
    const cur = byEmp.get(e.id) || { id: e.id, name: e.full_name, code: e.emp_code, designation: e.designation, roles: new Set<string>() }
    cur.roles.add(roleById.get(u.role_id)?.role_name || roleById.get(u.role_id)?.role_code || 'Role')
    byEmp.set(e.id, cur)
  }
  return [...byEmp.values()].map(h => ({ ...h, roles: [...h.roles].sort() })).sort((a, b) => a.name.localeCompare(b.name))
}

const strList = (x: unknown, max = 200): string[] | null => {
  if (x == null) return null
  if (!Array.isArray(x)) return null
  const out = [...new Set(x.map(v => String(v ?? '').trim().slice(0, 120)).filter(Boolean))].slice(0, max)
  return out.length ? out : null
}

export async function POST(req: NextRequest) {
  const gate = await requireGrant(req)
  if (gate.error) return gate.error
  const g = gate.grant
  if (!canManageAnalytics(g)) return bad('You cannot give analytics access.', 403)
  if (!(await tableReady())) return bad(MISSING, 409)

  let body: any
  try { body = await req.json() } catch { return bad('Invalid request.') }
  const ids: string[] = Array.isArray(body?.employee_ids) ? [...new Set(body.employee_ids.filter(isUuid) as string[])] : []
  if (!ids.length) return bad('Pick at least one person.')
  if (ids.length > 50) return bad('Fifty people at a time, at most.')
  if (g.employeeId && ids.includes(g.employeeId)) return bad('You cannot change your own analytics access — ask another administrator.')
  const reason = String(body?.reason || '').trim().slice(0, 300)
  if (!reason) return bad('Say why, for the access log.')

  // ── Nobody gives more than they have ──────────────────────────────────────
  const scope = grantable(g)
  const companyIds = strList(body?.companies, 50)
  if (companyIds && !companyIds.every(isUuid)) return bad('Unknown company.')
  if (!companyIds && scope) return bad('Pick the companies — you can only give access to your own.')
  if (companyIds && scope && !companyIds.every(c => scope.includes(c))) return bad('One of those companies is outside your own access.')
  const mine = await orgAccessFor(g)
  const top = g.isSuperAdmin || g.legacy
  const pay = !!body?.see_pay
  const names = !!body?.see_names
  if (pay && !top && !mine?.cost) return bad('You cannot give pay access without having it yourself.')
  if (names && !top && !mine?.people) return bad('You cannot show names without seeing them yourself.')
  const askedTabs = strList(body?.tabs, 10)
  const tabs = askedTabs ? ORG_TABS.filter(t => askedTabs.includes(t)) : null
  if (askedTabs && !tabs?.length) return bad('Pick at least one tab.')
  const until = body?.valid_until ? String(body.valid_until).slice(0, 10) : null
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return bad('The end date is not a date.')

  const { data: emps } = await sb.from('employees').select('id, full_name, company_id').in('id', ids)
  const found = (emps || []) as any[]
  if (found.length !== ids.length) return bad('One of those people was not found.')
  if (scope && found.some(e => !scope.includes(e.company_id))) return bad('One of those people is in a company outside your access.')

  const now = new Date().toISOString()
  const rows = ids.map(id => ({
    employee_id: id,
    company_ids: companyIds,
    locations: strList(body?.locations),
    departments: strList(body?.departments),
    employment_types: strList(body?.types, 20),
    tabs: tabs && tabs.length === ORG_TABS.length ? null : (tabs as OrgTab[] | null),
    see_names: names,
    see_pay: pay,
    can_export: body?.can_export !== false,
    valid_until: until,
    note: reason,
    is_active: true,
    granted_by: g.employeeId,
    granted_by_name: g.name || (g.legacy ? 'Legacy dashboard login' : null),
    updated_at: now,
  }))
  const { error } = await sb.from('analytics_access').upsert(rows, { onConflict: 'employee_id' })
  if (error) return bad(isMissingTable(error) ? MISSING : error.message, isMissingTable(error) ? 409 : 500)
  await audit(g, 'analytics_access_set', reason, rows.map(r => ({ ...r, name: found.find(e => e.id === r.employee_id)?.full_name })))
  return NextResponse.json({ ok: true, saved: rows.length })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireGrant(req)
  if (gate.error) return gate.error
  const g = gate.grant
  if (!canManageAnalytics(g)) return bad('You cannot change analytics access.', 403)
  if (!(await tableReady())) return bad(MISSING, 409)
  const id = req.nextUrl.searchParams.get('employee_id')
  if (!isUuid(id)) return bad('Which person?')
  if (g.employeeId === id) return bad('You cannot change your own analytics access — ask another administrator.')
  const scope = grantable(g)
  const { data: emp } = await sb.from('employees').select('id, full_name, company_id').eq('id', id as string).maybeSingle()
  if (!emp) return bad('Person not found.', 404)
  if (scope && !scope.includes((emp as any).company_id)) return bad('That person is in a company outside your access.', 403)
  const { data: before } = await sb.from('analytics_access').select(ROW_COLS).eq('employee_id', id as string).maybeSingle()
  const { error } = await sb.from('analytics_access').delete().eq('employee_id', id as string)
  if (error) return bad(error.message, 500)
  await audit(g, 'analytics_access_removed', String(req.nextUrl.searchParams.get('reason') || '').slice(0, 300) || null, [{ before, name: (emp as any).full_name }])
  return NextResponse.json({ ok: true })
}

async function audit(g: Grant, action: string, reason: string | null, details: unknown[]) {
  await sb.from('ess_access_audit').insert(details.map(d => ({
    ess_account_id: null,
    action,
    performed_by: g.employeeId,
    performed_by_name: g.name || (g.legacy ? 'Legacy dashboard login' : 'Unknown'),
    reason,
    details: d,
  }))).then(() => undefined, () => undefined)
}
