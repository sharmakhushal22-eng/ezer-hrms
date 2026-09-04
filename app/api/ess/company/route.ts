// GET /api/ess/company — the Company tab: headcount by department, why people are
// leaving this quarter, regime election. Gated on the 'Company Dashboard' module
// (answers A3/B5); scope is the caller's own company.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, fyOf } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (!ctx.canCompany) return forbidden()
  if (!ctx.companyId) return NextResponse.json({ error: 'No company on this employee' }, { status: 400 })
  const co = ctx.companyId
  const fy = fyOf()
  const qStart = new Date(); qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3, 1); qStart.setHours(0, 0, 0, 0)
  const q = qStart.toISOString().slice(0, 10)

  const [{ data: emps }, { data: depts }, { data: locs }, { data: mrfs }, { data: attr }, { data: decls }, { data: openRes }] = await Promise.all([
    sb.from('employees').select('id, department_id').eq('company_id', co).eq('employment_status', 'Active').or('is_test.is.null,is_test.eq.false').limit(10000),
    sb.from('departments').select('id, dept_name').eq('company_id', co),
    sb.from('locations').select('id').eq('company_id', co).neq('status', 'INACTIVE'),
    sb.from('manpower_requisitions').select('id, no_of_openings, openings, status').eq('company_id', co).in('status', ['OPEN', 'APPROVED', 'IN_PROGRESS']),
    sb.from('v_attrition_reasons').select('*').eq('company_id', co).gte('quarter_start', q),
    sb.from('tds_declarations').select('regime, annual_tax_old, annual_tax_new').eq('company_id', co).eq('fy', fy),
    sb.from('employee_resignation').select('employee_id, employees!inner(department_id, company_id)').eq('employees.company_id', co).not('status', 'in', '("SETTLED","WITHDRAWN")'),
  ])

  const deptName = new Map((depts || []).map((d: any) => [d.id, d.dept_name]))
  const byDept = new Map<string, { dept: string; headcount: number; open_exits: number; push: number }>()
  const row = (id: string | null) => {
    const k = id || 'none'
    if (!byDept.has(k)) byDept.set(k, { dept: (id && deptName.get(id)) || 'Unassigned', headcount: 0, open_exits: 0, push: 0 })
    return byDept.get(k)!
  }
  ;(emps || []).forEach((e: any) => row(e.department_id).headcount++)
  ;(openRes || []).forEach((x: any) => row(x.employees?.department_id).open_exits++)
  ;(attr || []).filter((a: any) => a.category === 'PUSH').forEach((a: any) => row(a.department_id).push += Number(a.exits))

  const reasons = new Map<string, { category: string; reason: string; exits: number; regrettable: number; depts: Set<string> }>()
  ;(attr || []).forEach((a: any) => {
    const k = `${a.category}|${a.reason}`
    if (!reasons.has(k)) reasons.set(k, { category: a.category, reason: a.reason, exits: 0, regrettable: 0, depts: new Set() })
    const x = reasons.get(k)!; x.exits += Number(a.exits); x.regrettable += Number(a.regrettable); if (a.dept_name) x.depts.add(a.dept_name)
  })

  const regime = { OLD: { n: 0, costlier: 0 }, NEW: { n: 0, costlier: 0 } }
  ;(decls || []).forEach((d: any) => {
    const k = d.regime === 'OLD' ? 'OLD' : 'NEW'
    regime[k].n++
    const o = Number(d.annual_tax_old || 0), n = Number(d.annual_tax_new || 0)
    if (k === 'OLD' ? o > n : n > o) regime[k].costlier++
  })
  const pushTotal = Array.from(byDept.values()).reduce((s, d) => s + d.push, 0)
  const exitsTotal = (attr || []).reduce((s: number, a: any) => s + Number(a.exits), 0)
  const topPush = Array.from(byDept.values()).filter(d => d.push).sort((a, b) => b.push - a.push)[0]

  return NextResponse.json({
    fy, quarter_from: q,
    kpis: [
      { label: 'Total headcount', value: (emps || []).length },
      { label: 'Departments', value: (depts || []).length },
      { label: 'Locations', value: (locs || []).length },
      { label: 'Open positions', value: (mrfs || []).reduce((s: number, m: any) => s + Number(m.no_of_openings ?? m.openings ?? 1), 0) },
    ],
    departments: Array.from(byDept.values()).sort((a, b) => b.headcount - a.headcount),
    reasons: Array.from(reasons.values()).map(x => ({ ...x, concentration: Array.from(x.depts).join(', ') })).sort((a, b) => b.exits - a.exits),
    attrition_note: topPush && exitsTotal ? `${topPush.push} of ${exitsTotal} exits this quarter cite a push reason${topPush.push === pushTotal ? `, all in ${topPush.dept}` : `; ${topPush.dept} has the most`}. That is one organisational finding, not ${exitsTotal} decisions.` : null,
    regime: [
      { regime: 'Old Regime', employees: regime.OLD.n, costlier: regime.OLD.costlier },
      { regime: 'New Regime', employees: regime.NEW.n, costlier: regime.NEW.costlier },
    ],
    regime_note: (regime.OLD.costlier + regime.NEW.costlier) ? `${regime.OLD.costlier + regime.NEW.costlier} employees are on the costlier regime for their own numbers. The comparison is computed on every declaration — nudging them costs nothing to surface.` : null,
  })
}
