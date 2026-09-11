// GET /api/ess/reports?report=attrition|regime|declaration|tds|span — one gate for
// the whole tab ('ESS Reports' module, answers F4); each report is its own query.
// Returns { title, columns, rows }; the client turns rows into CSV.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, fyOf } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export const REPORTS = [
  { key: 'attrition',   title: 'Attrition & exit reasons',       desc: 'Push / Pull / Personal breakdown, by department and quarter' },
  { key: 'regime',      title: 'Regime comparison',              desc: 'Every employee, Old vs New, and what the wrong election costs them' },
  { key: 'declaration', title: 'Investment declaration status',  desc: 'Who has declared, who has proven, what the January cliff looks like' },
  { key: 'tds',         title: 'TDS register',                   desc: 'Month-wise TDS and additional TDS, company-wide' },
  { key: 'span',        title: 'Span of control',                desc: 'Managers with an unusually high number of direct reports' },
]

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (!ctx.canReports) return forbidden()
  const key = req.nextUrl.searchParams.get('report') || ''
  if (!key) return NextResponse.json({ reports: REPORTS })
  if (!ctx.companyId) return NextResponse.json({ error: 'No company on this employee' }, { status: 400 })
  const co = ctx.companyId
  const fy = fyOf()
  const inr = (n: any) => Math.round(Number(n || 0))

  if (key === 'attrition') {
    const { data } = await sb.from('v_attrition_reasons').select('*').eq('company_id', co).order('quarter_start', { ascending: false })
    return NextResponse.json({ title: 'Attrition & exit reasons', columns: ['Quarter', 'Department', 'Category', 'Reason', 'Exits', 'Regrettable', 'Open'],
      rows: (data || []).map((a: any) => [a.quarter, a.dept_name || '—', a.category, a.reason, a.exits, a.regrettable, a.open_exits]) })
  }
  if (key === 'regime') {
    const { data } = await sb.from('tds_declarations').select('regime, annual_tax_old, annual_tax_new, declaration_status, employees!inner(emp_code, full_name, company_id)').eq('company_id', co).eq('fy', fy)
    const rows = (data || []).map((d: any) => {
      const o = inr(d.annual_tax_old), n = inr(d.annual_tax_new), elected = d.regime === 'OLD' ? o : n, best = Math.min(o, n)
      return [d.employees?.emp_code, d.employees?.full_name, d.regime, o, n, elected - best, elected - best > 0 ? 'Costlier' : 'Optimal', d.declaration_status]
    }).sort((a: any, b: any) => b[5] - a[5])
    return NextResponse.json({ title: `Regime comparison — FY ${fy}`, columns: ['Code', 'Name', 'Elected', 'Tax (Old)', 'Tax (New)', 'Cost of election', 'Verdict', 'Status'], rows })
  }
  if (key === 'declaration') {
    const [{ data: lines }, { data: win }] = await Promise.all([
      sb.from('investment_declaration_lines').select('employee_id, section_code, declared_amount, proof_amount, proof_status, employees!inner(emp_code, full_name, company_id)').eq('fy', fy).eq('employees.company_id', co),
      sb.from('tds_declaration_window').select('*').eq('fy', fy).maybeSingle(),
    ])
    const by = new Map<string, any>()
    ;(lines || []).forEach((l: any) => {
      const x = by.get(l.employee_id) || { code: l.employees?.emp_code, name: l.employees?.full_name, declared: 0, proven: 0, lines: 0, verified: 0 }
      x.declared += inr(l.declared_amount); x.proven += inr(l.proof_amount); if (inr(l.declared_amount) > 0) { x.lines++; if (l.proof_status === 'VERIFIED') x.verified++ }
      by.set(l.employee_id, x)
    })
    const rows = Array.from(by.values()).map(x => [x.code, x.name, x.declared, x.proven, x.lines, x.verified, x.lines === 0 ? 'Nothing declared' : x.verified === x.lines ? 'Proven' : x.verified ? 'Partly proven' : 'Unproven', x.lines && x.verified < x.lines ? x.declared - x.proven : 0])
      .sort((a: any, b: any) => b[7] - a[7])
    return NextResponse.json({ title: `Investment declaration status — FY ${fy}${win ? ` (proof window closes ${win.proof_close})` : ''}`,
      columns: ['Code', 'Name', 'Declared ₹', 'Proven ₹', 'Sections', 'Verified', 'Status', 'At risk ₹'], rows })
  }
  if (key === 'tds') {
    const { data } = await sb.from('payroll_employee_snapshot').select('employee_code, full_name, tds_monthly, tds_additional, tds_regime_used, payroll_runs!inner(fy, month, period_label, status, company_id)')
      .eq('payroll_runs.company_id', co).eq('payroll_runs.fy', fy).neq('payroll_runs.status', 'CANCELLED').order('employee_code').limit(20000)
    const rows = (data || []).map((s: any) => [s.payroll_runs?.period_label, s.employee_code, s.full_name, s.tds_regime_used || '—', inr(s.tds_monthly), inr(s.tds_additional), inr(s.tds_monthly) + inr(s.tds_additional)])
      .sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))
    return NextResponse.json({ title: `TDS register — FY ${fy}`, columns: ['Month', 'Code', 'Name', 'Regime', 'TDS', 'Additional TDS', 'Total'], rows })
  }
  if (key === 'span') {
    const { data } = await sb.from('employees').select('l1_manager_id').eq('company_id', co).eq('employment_status', 'Active').or('is_test.is.null,is_test.eq.false').not('l1_manager_id', 'is', null).limit(10000)
    const cnt = new Map<string, number>()
    ;(data || []).forEach((e: any) => cnt.set(e.l1_manager_id, (cnt.get(e.l1_manager_id) || 0) + 1))
    const ids = Array.from(cnt.keys())
    const { data: mgrs } = ids.length ? await sb.from('employees').select('id, emp_code, full_name, designation, departments!employees_department_id_fkey(dept_name)').in('id', ids) : { data: [] as any[] }
    const rows = (mgrs || []).map((m: any) => [m.emp_code, m.full_name, m.designation || '—', m.departments?.dept_name || '—', cnt.get(m.id) || 0, (cnt.get(m.id) || 0) > 8 ? 'High' : (cnt.get(m.id) || 0) < 2 ? 'Low' : 'Typical'])
      .sort((a: any, b: any) => b[4] - a[4])
    return NextResponse.json({ title: 'Span of control', columns: ['Code', 'Manager', 'Designation', 'Department', 'Direct reports', 'Band'], rows })
  }
  return NextResponse.json({ error: 'Unknown report' }, { status: 400 })
}
