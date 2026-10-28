// /api/exit/letters?resignation_id=&kind= — an exit letter as a PDF (spec §10, lib/exit/letters-pdf).
// Letters exist once the F&F is approved, and only those the exit's reason allows (§10.4). HR and
// Payroll may also open the F&F statement while it is being worked on; the employee gets their
// own letters after approval, for 12 months (§11.2).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { exitLetterPdf } from '@/lib/exit/letters-pdf'
import { exitReasonOf } from '@/lib/exit/case'
import type { LetterKind } from '@/lib/exit/fnf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const KINDS: LetterKind[] = ['EXPERIENCE', 'RELIEVING', 'TERMINATION', 'PF_GUIDANCE', 'FNF_STATEMENT']
const VIEW = ['PAYROLL', 'PAYROLL_ADMIN', 'HR_MANAGER', 'HR_HEAD', 'CHRO', 'FINANCE_EXECUTIVE', 'CFO', 'HR_EXECUTIVE', 'BRANCH_HR']

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const sp = req.nextUrl.searchParams
  const kind = String(sp.get('kind') || '').toUpperCase() as LetterKind
  if (!KINDS.includes(kind)) return bad('Unknown letter.')
  const resId = sp.get('resignation_id') || ''
  const { data: res } = await sb.from('employee_resignation').select('id, employee_id, final_lwd, lwd_as_per_policy').eq('id', resId).maybeSingle()
  if (!res) return bad('Exit not found.', 404)
  const { data: emp } = await sb.from('employees')
    .select('id, full_name, emp_code, designation, company_id, company_doj, date_of_joining, uan_number, bank_name, bank_account_last4, personal_email, departments!employees_department_id_fkey(dept_name)')
    .eq('id', res.employee_id).maybeSingle()
  if (!emp) return bad('Employee not found.', 404)
  const roles = (ctx.menu.roles || []).map((x: string) => String(x).toUpperCase())
  const hr = (ctx.grant.isSuperAdmin || roles.some((c: string) => VIEW.includes(c))) && (ctx.grant.isSuperAdmin || ctx.grant.crossCompany || emp.company_id === ctx.companyId)
  const own = emp.id === ctx.caller.employeeId
  if (!hr && !own) return forbidden('You cannot open this letter.')

  const { data: fnf } = await sb.from('fnf_settlements').select('*').eq('resignation_id', res.id).maybeSingle()
  const approved = !!fnf && ['APPROVED', 'PAID'].includes(fnf.status)
  if (kind === 'FNF_STATEMENT') {
    if (!fnf) return bad('The F&F has not been calculated yet.', 409)
    if (!approved && !hr) return forbidden('Your F&F statement is available once it is approved.')
  } else {
    if (!approved) return bad('Exit letters are issued once the F&F is approved.', 409)
    if (!(fnf.letters || []).includes(kind)) return bad('This exit does not get that letter (spec §10.4).', 409)
  }

  const [{ data: company }, reason, { data: clr }] = await Promise.all([
    sb.from('companies').select('*').eq('id', emp.company_id).maybeSingle(),
    exitReasonOf(sb as any, res.id),
    sb.from('exit_clearance').select('dept, status, recovery, cleared_by_name').eq('resignation_id', res.id),
  ])
  const pdf = await exitLetterPdf({
    kind, company,
    employee: {
      full_name: emp.full_name, emp_code: emp.emp_code, designation: emp.designation, department: (emp as any).departments?.dept_name || null,
      doj: emp.company_doj || emp.date_of_joining, uan: emp.uan_number, personal_email: emp.personal_email,
      bank: emp.bank_name || emp.bank_account_last4 ? `${emp.bank_name || 'Bank'} · A/C ••${emp.bank_account_last4 || '----'}` : null,
    },
    lwd: String(res.final_lwd || res.lwd_as_per_policy),
    reason: { code: reason.code, label: reason.label, sub: reason.request?.sub_reason || null },
    fnf: fnf ? { ...fnf, total_earnings: Number(fnf.total_earnings), total_deductions: Number(fnf.total_deductions), net_payable: Number(fnf.net_payable) } : null,
    clearance: (clr || []).map((c: any) => ({ ...c, recovery: Number(c.recovery) || 0 })),
  })
  return new NextResponse(new Uint8Array(pdf.content), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name}"`, 'Cache-Control': 'no-store' } })
}
