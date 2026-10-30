// /api/exit/clearance — the five department clearance forms (spec §8).
//   GET  ?inbox=1                 -> { items }  forms waiting on the caller (their department, or
//                                               as HR Head: overdue ones they may override)
//   GET  ?resignation_id=         -> { rows, forms }
//   POST { action: 'start', resignation_id }                    HR roles: open the forms now
//   POST { action: 'submit', id, items, signoff, remarks }      the department's approver
//   POST { action: 'override', id, remarks }                    HR Head (§8.3), with a reason
// When the fifth form clears, the F&F is calculated (lib/exit/case.ts computeFnf).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit } from '@/lib/ess/session'
import { allowedCompanies } from '@/lib/rms/resolve'
import { CLEARANCE_FORMS, clearanceProblems, recoveryOf, payableOf, type Dept } from '@/lib/exit/clearance'
import { canExitOthers } from '@/lib/exit/hr-exit'
import { startClearance, computeFnf } from '@/lib/exit/case'

export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const HR_HEADS = ['HR_HEAD', 'CHRO']
/** Who sees every form of an exit (spec §12): HR, Payroll, HR Head. */
const FULL_VIEW = ['HR_MANAGER', 'HR_HEAD', 'CHRO', 'PAYROLL', 'PAYROLL_ADMIN', 'HR_EXECUTIVE', 'BRANCH_HR']

const roleSet = (ctx: any) => new Set<string>((ctx.menu.roles || []).map((r: string) => String(r).toUpperCase()))
// Own company, or one the caller's roles were scoped to (migration 203).
const scoped = (ctx: any, companyId: string | null) => ctx.grant.isSuperAdmin || ctx.grant.crossCompany || !companyId || allowedCompanies(ctx.grant, null).includes(companyId)

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId
  const roles = roleSet(ctx)
  const sp = req.nextUrl.searchParams
  const sel = '*, employees!exit_clearance_employee_id_fkey(full_name, emp_code, designation), employee_resignation!inner(final_lwd, lwd_as_per_policy)'

  if (sp.get('inbox')) {
    const { data, error } = await sb.from('exit_clearance').select(sel).eq('status', 'PENDING').order('started_at')
    if (error) return NextResponse.json({ items: [], missing: /does not exist|schema cache/.test(error.message) })
    const headOverride = HR_HEADS.some(c => roles.has(c))
    const items = (data || []).filter((c: any) => (c.approver_ids || []).includes(me) || (headOverride && c.escalated_to === 'HR_HEAD' && scoped(ctx, c.company_id)))
      .map((c: any) => ({ ...c, can_fill: (c.approver_ids || []).includes(me), can_override: headOverride && c.escalated_to === 'HR_HEAD', form: CLEARANCE_FORMS[c.dept as Dept], lwd: c.employee_resignation?.final_lwd || c.employee_resignation?.lwd_as_per_policy }))
    return NextResponse.json({ items })
  }

  const resId = sp.get('resignation_id')
  if (!resId) return bad('Which exit?')
  const { data: rows } = await sb.from('exit_clearance').select(sel).eq('resignation_id', resId).order('dept')
  const full = ctx.grant.isSuperAdmin || [...roles].some(c => FULL_VIEW.includes(c))
  const visible = (rows || []).filter((c: any) => (full && scoped(ctx, c.company_id)) || (c.approver_ids || []).includes(me) || c.employee_id === me)
    .map((c: any) => c.employee_id === me && !full && !(c.approver_ids || []).includes(me)
      // The employee sees status only (§12.2-3), not remarks or items.
      ? { id: c.id, dept: c.dept, status: c.status, recovery: c.recovery, cleared_at: c.cleared_at }
      : c)
  return NextResponse.json({ rows: visible, forms: CLEARANCE_FORMS })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden(ctx.caller.actorEmployeeId === null
    ? 'Your ESS session is not active, so this has nobody to act on it. Sign in again with your own ESS account.'
    : 'Clearance is signed from your own portal, not while viewing somebody else’s.')
  const me = ctx.caller.employeeId
  const roles = roleSet(ctx)
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const { data: meRow } = await sb.from('employees').select('full_name, emp_code').eq('id', me).maybeSingle()
  const myName = meRow ? `${meRow.full_name} (${meRow.emp_code})` : 'HR'
  const now = new Date().toISOString()

  if (action === 'start') {
    if (!canExitOthers([...roles], !!ctx.grant.isSuperAdmin)) return forbidden('Only the HR team can start clearance.')
    const { data: res } = await sb.from('employee_resignation').select('id, employee_id, final_lwd, status, employees(company_id)').eq('id', String(body.resignation_id || '')).maybeSingle()
    if (!res) return bad('Exit not found.', 404)
    if (!scoped(ctx, (res as any).employees?.company_id)) return forbidden('This employee belongs to another company.')
    if (!res.final_lwd) return bad('Set the final last working day first (the resignation is still in its approval chain).', 409)
    const out = await startClearance(sb as any, res.id)
    return NextResponse.json({ ok: true, ...out })
  }

  const { data: row } = await sb.from('exit_clearance').select('*').eq('id', String(body.id || '')).maybeSingle()
  if (!row) return bad('Clearance form not found.', 404)
  const dept = row.dept as Dept

  if (action === 'override') {
    if (!HR_HEADS.some(c => roles.has(c)) && !ctx.grant.isSuperAdmin) return forbidden('Only the HR Head can override a clearance.')
    if (!scoped(ctx, row.company_id)) return forbidden('This employee belongs to another company.')
    if (row.status !== 'PENDING') return bad('This form is already signed off.', 409)
    const why = String(body.remarks || '').trim()
    if (!why) return bad('Give the reason for overriding.')
    const { data: upd } = await sb.from('exit_clearance').update({ status: 'CLEARED_WITH_CONDITIONS', overridden: true, remarks: `HR Head override: ${why}`, cleared_by: me, cleared_by_name: myName, cleared_at: now, updated_at: now }).eq('id', row.id).eq('status', 'PENDING').select('id')
    if (!upd?.length) return bad('This form changed a moment ago. Reload.', 409)
    await audit(ctx.caller, 'EXIT_CLEARANCE_OVERRIDDEN', row.employee_id, { dept, why })
    const fnf = await computeFnf(sb as any, row.resignation_id)
    return NextResponse.json({ ok: true, fnf: fnf ? { id: fnf.id, net_payable: fnf.net_payable } : null })
  }

  if (action === 'submit') {
    if (!(row.approver_ids || []).includes(me)) return forbidden(`This ${CLEARANCE_FORMS[dept].label} form is for its department approvers.`)
    if (row.status !== 'PENDING' && row.status !== 'NOT_CLEARED') return bad('This form is already signed off.', 409)
    const items = (body.items && typeof body.items === 'object') ? body.items : {}
    const x = { items, signoff: String(body.signoff || ''), remarks: String(body.remarks || '').trim() || null }
    const problems = clearanceProblems(dept, x)
    if (problems.length) return bad(problems.join(' '))
    const status = x.signoff
    const { data: upd } = await sb.from('exit_clearance').update({
      items, status, remarks: x.remarks, recovery: recoveryOf(dept, items), payable: payableOf(dept, items),
      extra: body.extra && typeof body.extra === 'object' ? body.extra : row.extra,
      cleared_by: me, cleared_by_name: myName, cleared_at: status === 'NOT_CLEARED' ? null : now, updated_at: now,
    }).eq('id', row.id).in('status', ['PENDING', 'NOT_CLEARED']).select('id')
    if (!upd?.length) return bad('This form changed a moment ago. Reload.', 409)
    // HR's rehire flag is the employee's (§11.3).
    if (dept === 'HR' && items.rehire?.status) {
      const flag = ({ Green: 'GREEN', Blocked: 'BLOCKED', Review: 'REVIEW' } as Record<string, string>)[items.rehire.status]
      if (flag) await sb.from('employees').update({ rehire_flag: flag, rehire_reason: items.rehire.remark || null }).eq('id', row.employee_id)
    }
    await audit(ctx.caller, 'EXIT_CLEARANCE_SIGNED', row.employee_id, { dept, status, recovery: recoveryOf(dept, items) })
    const fnf = await computeFnf(sb as any, row.resignation_id)
    return NextResponse.json({ ok: true, fnf: fnf ? { id: fnf.id, net_payable: fnf.net_payable } : null })
  }

  return bad("action must be 'start', 'submit' or 'override'")
}
