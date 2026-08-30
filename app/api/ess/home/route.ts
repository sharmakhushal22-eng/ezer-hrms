// GET /api/ess/home — KPIs and "pending on you", scope-aware (guide §6, answers F1).
// One component downstream; only the data differs per login.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, fyOf } from '@/lib/ess/session'
import { buildPending } from '@/lib/ess/pending'

export const dynamic = 'force-dynamic'

interface Kpi { label: string; value: string; note?: string; tone?: 'ok' | 'warn' | 'dang' }

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId
  const fy = fyOf()
  const year = new Date().getFullYear()

  const [pending, { data: bal }, { data: run }, { data: decl }, { data: proofLines }] = await Promise.all([
    buildPending(ctx),
    sb.from('leave_balances').select('opening, accrued, used, encashed, leave_types(is_paid, is_active)').eq('employee_id', me).eq('year', year),
    ctx.companyId
      ? sb.from('payroll_runs').select('period_label, status, fy, month').eq('company_id', ctx.companyId).neq('status', 'CANCELLED').order('fy', { ascending: false }).order('month', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null } as any),
    sb.from('tds_declarations').select('declaration_status, regime').eq('employee_id', me).eq('fy', fy).maybeSingle(),
    sb.from('investment_declaration_lines').select('declared_amount, proof_status').eq('employee_id', me).eq('fy', fy),
  ])

  const leaveBal = (bal || []).filter((b: any) => b.leave_types?.is_paid !== false)
    .reduce((s: number, b: any) => s + Number(b.opening || 0) + Number(b.accrued || 0) - Number(b.used || 0) - Number(b.encashed || 0), 0)
  const declared = (proofLines || []).filter((l: any) => Number(l.declared_amount) > 0)
  const proven = declared.filter((l: any) => l.proof_status === 'VERIFIED').length
  const proofStatus = !declared.length ? 'Nothing declared' : proven === declared.length ? 'Verified' : proven ? `${proven} of ${declared.length} verified` : 'Not submitted'

  const kpis: Kpi[] = [
    { label: 'Leave balance', value: `${leaveBal % 1 ? leaveBal.toFixed(1) : leaveBal} days` },
    { label: 'Latest payroll', value: run?.period_label || '—', note: run?.status ? run.status.toLowerCase().replace('_', ' ') : undefined },
    { label: 'Declaration', value: decl?.declaration_status ? decl.declaration_status.charAt(0) + decl.declaration_status.slice(1).toLowerCase() : 'Not started', note: decl?.regime ? `${decl.regime === 'OLD' ? 'Old' : 'New'} regime` : undefined },
    { label: 'Proof status', value: proofStatus, tone: proofStatus === 'Not submitted' ? 'warn' : undefined },
  ]

  const mine = pending.filter(p => p.mine).length
  if (ctx.menu.is_rm) kpis.unshift({ label: 'Team size', value: String(ctx.menu.direct_reports) }, { label: 'Pending on you', value: String(mine), tone: mine ? 'warn' : 'ok' })
  else if (ctx.canApprovals) kpis.unshift({ label: 'Pending on you', value: String(mine), tone: mine ? 'warn' : 'ok' })

  // Company-wide numbers only for a login that can open the Company tab.
  if (ctx.canCompany && ctx.companyId) {
    const qStart = new Date(); qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3, 1); qStart.setHours(0, 0, 0, 0)
    const [{ count: headcount }, { data: openRes }, { data: attr }, { data: unv }] = await Promise.all([
      sb.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('employment_status', 'Active').or('is_test.is.null,is_test.eq.false'),
      sb.from('employee_resignation').select('id, employees!inner(company_id)').eq('employees.company_id', ctx.companyId).not('status', 'in', '("SETTLED","WITHDRAWN")'),
      sb.from('v_attrition_reasons').select('category, exits').eq('company_id', ctx.companyId).gte('quarter_start', qStart.toISOString().slice(0, 10)),
      sb.from('investment_declaration_lines').select('employee_id, employees!inner(company_id)').eq('fy', fy).gt('declared_amount', 0).neq('proof_status', 'VERIFIED').eq('employees.company_id', ctx.companyId),
    ])
    const push = (attr || []).filter((a: any) => a.category === 'PUSH').reduce((s: number, a: any) => s + Number(a.exits), 0)
    const unverified = new Set((unv || []).map((u: any) => u.employee_id)).size
    kpis.splice(0, 0,
      { label: 'Total headcount', value: String(headcount ?? 0) },
      { label: 'Open resignations', value: String((openRes || []).length), tone: (openRes || []).length ? 'warn' : undefined },
      { label: 'Push-reason exits, this qtr', value: String(push), tone: push ? 'dang' : undefined },
      { label: 'Declarations unverified', value: String(unverified), tone: unverified ? 'warn' : undefined },
    )
  }

  return NextResponse.json({ kpis: kpis.slice(0, 8), pending, pending_title:
    ctx.canCompany ? 'Needs your attention — company-wide' : ctx.menu.is_rm || ctx.menu.is_hod ? 'Pending on you — your team' : 'Your open items' })
}
