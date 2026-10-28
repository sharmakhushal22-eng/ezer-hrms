// /api/exit/fnf — exits in progress and their Full & Final settlement (spec §9, §12.3–12.4).
//   GET                         -> { exits }   consolidated dashboard: LWD, reason, the five
//                                              clearances, F&F status / net (HR & Payroll roles)
//   GET ?resignation_id=        -> { exit, clearance, fnf, letters, can }
//   POST { action: 'calculate', resignation_id }         recalculate (only while CALCULATED)
//   POST { action: 'save', id, earnings, deductions, notes, letters_case_by_case }   Payroll
//   POST { action: 'review', id }      Payroll Manager reviewed           CALCULATED → REVIEWED
//   POST { action: 'reopen', id }      back for changes                   REVIEWED → CALCULATED
//   POST { action: 'approve', id }     HR Manager approves                REVIEWED → APPROVED
//   POST { action: 'pay', id, paid_ref }  Finance released the payment    APPROVED → PAID
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit, notify } from '@/lib/ess/session'
import { DEPTS } from '@/lib/exit/clearance'
import { fnfTotals, lettersFor, rupees, LETTER_LABEL, type FnfLine } from '@/lib/exit/fnf'
import { computeFnf, exitReasonOf } from '@/lib/exit/case'
import { handleLoanOnExit } from '@/lib/loans/payroll-sync'
import { sendMail, mailConfigured } from '@/lib/mail/send'

export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const day = (d: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-'

const PAYROLL = ['PAYROLL', 'PAYROLL_ADMIN']
const HR_APPROVE = ['HR_MANAGER', 'HR_HEAD', 'CHRO']
const FINANCE = ['FINANCE_EXECUTIVE', 'CFO', 'PAYROLL_ADMIN']
const VIEW = [...new Set([...PAYROLL, ...HR_APPROVE, ...FINANCE, 'HR_EXECUTIVE', 'BRANCH_HR'])]

function abilities(ctx: any) {
  const roles = new Set<string>((ctx.menu.roles || []).map((r: string) => String(r).toUpperCase()))
  const sa = !!ctx.grant.isSuperAdmin
  const has = (l: string[]) => sa || l.some(c => roles.has(c))
  return { view: has(VIEW), review: has(PAYROLL), approve: has(HR_APPROVE), pay: has(FINANCE), startClearance: has(['HR_MANAGER', 'HR_HEAD', 'CHRO', 'HR_EXECUTIVE', 'BRANCH_HR', 'RECRUITER']) }
}
const scopeOf = (ctx: any): string | null => (ctx.grant.isSuperAdmin || ctx.grant.crossCompany) ? null : (ctx.companyId || null)

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const can = abilities(ctx)
  const resId = req.nextUrl.searchParams.get('resignation_id')
  const co = scopeOf(ctx)

  if (!resId) {
    if (!can.view) return NextResponse.json({ exits: [], can })
    const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
    let q = sb.from('employee_resignation')
      .select('id, employee_id, status, final_lwd, lwd_as_per_policy, date_of_resignation, submitted_by_employee, employees!employee_resignation_employee_id_fkey!inner(full_name, emp_code, designation, company_id, access_revoked_at)')
      .not('status', 'eq', 'WITHDRAWN').or(`final_lwd.gte.${since},final_lwd.is.null`).order('final_lwd', { ascending: true, nullsFirst: false }).limit(300)
    if (co) q = q.eq('employees.company_id', co)
    const { data: res, error } = await q
    if (error) return bad(error.message, 500)
    const ids = (res || []).map((x: any) => x.id)
    const [{ data: clr }, { data: fnf }, { data: hrx }] = ids.length ? await Promise.all([
      sb.from('exit_clearance').select('resignation_id, dept, status, recovery').in('resignation_id', ids),
      sb.from('fnf_settlements').select('resignation_id, id, status, net_payable').in('resignation_id', ids),
      sb.from('hr_exit_requests').select('resignation_id, reason_label').in('resignation_id', ids),
    ]) : [{ data: [] }, { data: [] }, { data: [] }] as any
    const exits = (res || []).map((x: any) => ({
      resignation_id: x.id, employee_id: x.employee_id, employee: x.employees, lwd: x.final_lwd || x.lwd_as_per_policy, status: x.status,
      reason: (hrx || []).find((h: any) => h.resignation_id === x.id)?.reason_label || 'Self Resignation',
      final_lwd_set: !!x.final_lwd,
      clearance: Object.fromEntries(DEPTS.map(d => { const c = (clr || []).find((c: any) => c.resignation_id === x.id && c.dept === d); return [d, c ? { status: c.status, recovery: Number(c.recovery) || 0 } : null] })),
      fnf: (fnf || []).find((f: any) => f.resignation_id === x.id) || null,
    }))
    return NextResponse.json({ exits, can })
  }

  const { data: res } = await sb.from('employee_resignation').select('*, employees!employee_resignation_employee_id_fkey(id, full_name, emp_code, designation, company_id, company_doj, group_doj, date_of_joining, uan_number, personal_email, office_email, bank_name, bank_account_last4, rehire_flag)').eq('id', resId).maybeSingle()
  if (!res) return bad('Exit not found.', 404)
  const emp = (res as any).employees
  const own = emp?.id === ctx.caller.employeeId
  if (!own && !(can.view && (!co || emp?.company_id === co))) return forbidden('You cannot see this exit.')
  const [{ data: fnf }, reason] = await Promise.all([
    sb.from('fnf_settlements').select('*').eq('resignation_id', resId).maybeSingle(),
    exitReasonOf(sb as any, resId),
  ])
  // The employee sees the statement once approved, and the letters it unlocks (§12.2).
  const shownFnf = own && !can.view ? (fnf && ['APPROVED', 'PAID'].includes(fnf.status) ? fnf : null) : fnf
  const letters = shownFnf && ['APPROVED', 'PAID'].includes(shownFnf.status) ? (shownFnf.letters || []).map((k: string) => ({ kind: k, label: (LETTER_LABEL as any)[k] || k })) : []
  return NextResponse.json({
    exit: { resignation_id: res.id, status: res.status, lwd: res.final_lwd || res.lwd_as_per_policy, date_of_resignation: res.date_of_resignation, reason: reason.label, reason_code: reason.code, employee: emp },
    fnf: shownFnf, letters, can: own && !can.view ? { view: false, review: false, approve: false, pay: false, startClearance: false } : can,
  })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden(ctx.caller.actorEmployeeId === null
    ? 'Your ESS session is not active, so this has nobody to act on it. Sign in again with your own ESS account.'
    : 'F&F is handled from your own portal, not while viewing somebody else’s.')
  const can = abilities(ctx)
  const co = scopeOf(ctx)
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const { data: meRow } = await sb.from('employees').select('full_name, emp_code').eq('id', me).maybeSingle()
  const myName = meRow ? `${meRow.full_name} (${meRow.emp_code})` : 'HR'
  const now = new Date().toISOString()

  if (action === 'calculate') {
    if (!can.review && !can.approve) return forbidden('Only Payroll and HR can calculate the F&F.')
    const out = await computeFnf(sb as any, String(body.resignation_id || ''))
    if (!out) return bad('All five departments must clear first (spec §8.1): the F&F cannot start while any clearance is pending.', 409)
    return NextResponse.json({ ok: true, fnf: out })
  }

  const { data: f } = await sb.from('fnf_settlements').select('*, employees!fnf_settlements_employee_id_fkey(full_name, emp_code, company_id, personal_email, office_email)').eq('id', String(body.id || '')).maybeSingle()
  if (!f) return bad('F&F statement not found.', 404)
  const emp = (f as any).employees
  if (co && emp?.company_id !== co) return forbidden('This employee belongs to another company.')
  const move = async (from: string, patch: Record<string, unknown>) => {
    const { data } = await sb.from('fnf_settlements').update({ ...patch, updated_at: now }).eq('id', f.id).eq('status', from).select('*')
    return data?.[0] || null
  }

  if (action === 'save') {
    if (!can.review) return forbidden('Only Payroll edits the F&F statement.')
    if (f.status !== 'CALCULATED') return bad('Reopen the statement to change it.', 409)
    const clean = (l: any[]): FnfLine[] => (Array.isArray(l) ? l : []).slice(0, 40).map(x => ({ key: String(x.key || '').slice(0, 40) || `line_${Math.random().toString(36).slice(2, 7)}`, label: String(x.label || '').slice(0, 120) || 'Line', amount: Math.max(0, Math.round(Number(x.amount) || 0)), note: x.note ? String(x.note).slice(0, 300) : undefined, editable: true }))
    const earnings = clean(body.earnings), deductions = clean(body.deductions)
    const t = fnfTotals({ earnings, deductions })
    const caseByCase = !!body.letters_case_by_case
    const reason = f.reason_code || 'SELF'
    const upd = await move('CALCULATED', { earnings, deductions, total_earnings: t.earnings, total_deductions: t.deductions, net_payable: t.net, notes: String(body.notes || '').slice(0, 2000) || null, letters_case_by_case: caseByCase, letters: lettersFor(reason, { caseByCase }) })
    if (!upd) return bad('The statement changed a moment ago. Reload.', 409)
    return NextResponse.json({ ok: true, fnf: upd })
  }

  if (action === 'review') {
    if (!can.review) return forbidden('The Payroll Manager reviews the F&F.')
    const upd = await move('CALCULATED', { status: 'REVIEWED', reviewed_by: me, reviewed_by_name: myName, reviewed_at: now })
    if (!upd) return bad('Only a calculated statement can be marked reviewed.', 409)
    const { roleHolders } = await import('@/lib/recruitment/offer-approval-notify')
    const hrs = await roleHolders(sb as any, emp?.company_id || null, ['HR_MANAGER'])
    await Promise.all(hrs.map(h => notify(h.id, `F&F to approve: ${emp?.full_name} (${emp?.emp_code})`, `Reviewed by ${myName}. Net payable ${rupees(Number(f.net_payable))}.`, '/ess/exit-fnf', 'APPROVAL').catch(() => null)))
    await audit(ctx.caller, 'FNF_REVIEWED', f.employee_id, { fnf_id: f.id, net: f.net_payable })
    return NextResponse.json({ ok: true, fnf: upd })
  }

  if (action === 'reopen') {
    if (!can.review && !can.approve) return forbidden('Only Payroll and HR can reopen the F&F.')
    const upd = await move('REVIEWED', { status: 'CALCULATED', reviewed_by: null, reviewed_by_name: null, reviewed_at: null })
    if (!upd) return bad('Only a reviewed (not yet approved) statement can be reopened.', 409)
    return NextResponse.json({ ok: true, fnf: upd })
  }

  if (action === 'approve') {
    if (!can.approve) return forbidden('The HR Manager approves the F&F.')
    if (f.reviewed_by === me && !ctx.grant.isSuperAdmin) return forbidden('The F&F is approved by someone other than its reviewer.')
    const upd = await move('REVIEWED', { status: 'APPROVED', approved_by: me, approved_by_name: myName, approved_at: now })
    if (!upd) return bad('The Payroll Manager must review the statement first.', 409)
    // Loans move to exit recovery against this F&F (lib/loans/payroll-sync).
    await handleLoanOnExit(sb as any, f.employee_id).catch(() => null)
    await sb.from('employee_resignation').update({ status: 'RECOVERY_PENDING' }).eq('id', f.resignation_id).in('status', ['INITIATED', 'PENDING_HR_MANAGER'])
    const letters = (upd.letters || []).map((k: string) => (LETTER_LABEL as any)[k] || k)
    await notify(f.employee_id, 'Your Full & Final settlement is approved', `Net payable ${rupees(Number(f.net_payable))}. Your letters are ready: ${letters.join(', ')}. Download them from ESS → HR Services → Exit.`, '/ess/exit', 'COMPLIANCE').catch(() => null)
    const to = emp?.personal_email || emp?.office_email
    if (to && mailConfigured()) {
      await sendMail({ to, fromName: 'EZER HR Team', subject: `Your Full & Final settlement: ${rupees(Number(f.net_payable))}`,
        text: `Hi ${emp?.full_name},\n\nYour Full & Final settlement for the last working day ${day(f.last_working_day)} has been approved.\n\nNet payable: ${rupees(Number(f.net_payable))}\n\nYour letters (${letters.join(', ')}) and the F&F statement are in ESS → HR Services → Exit, available for the next 12 months.\n\nEZER HR Team` }).catch(() => null)
    }
    const { roleHolders } = await import('@/lib/recruitment/offer-approval-notify')
    const fin = await roleHolders(sb as any, emp?.company_id || null, FINANCE)
    await Promise.all(fin.map(p => notify(p.id, `F&F to pay: ${emp?.full_name} (${emp?.emp_code})`, `Approved by ${myName}. Release ${rupees(Number(f.net_payable))} and mark it paid.`, '/ess/exit-fnf', 'APPROVAL').catch(() => null)))
    await audit(ctx.caller, 'FNF_APPROVED', f.employee_id, { fnf_id: f.id, net: f.net_payable })
    return NextResponse.json({ ok: true, fnf: upd })
  }

  if (action === 'pay') {
    if (!can.pay) return forbidden('Finance marks the F&F paid.')
    const ref = String(body.paid_ref || '').trim()
    if (!ref) return bad('Enter the payment reference (UTR / bank file).')
    const upd = await move('APPROVED', { status: 'PAID', paid_by: me, paid_by_name: myName, paid_at: now, paid_ref: ref.slice(0, 120) })
    if (!upd) return bad('Only an approved statement can be paid.', 409)
    await sb.from('employee_resignation').update({ status: 'SETTLED' }).eq('id', f.resignation_id)
    await notify(f.employee_id, 'Your F&F has been paid', `${rupees(Number(f.net_payable))} released (ref ${ref}).`, '/ess/exit', 'COMPLIANCE').catch(() => null)
    await audit(ctx.caller, 'FNF_PAID', f.employee_id, { fnf_id: f.id, ref })
    return NextResponse.json({ ok: true, fnf: upd })
  }

  return bad("action must be 'calculate', 'save', 'review', 'reopen', 'approve' or 'pay'")
}
