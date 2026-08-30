// GET /api/ess/session — is ESS open for this employee, and who are they.
// Checked FIRST, before any other ESS route renders (guide §3 step 2).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essCaller, audit } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const c = await essCaller(req)
  if (c.error) return c.error
  const { caller } = c
  const [{ data: en, error }, { data: emp }] = await Promise.all([
    sb.rpc('fn_ess_enabled', { p_employee_id: caller.employeeId }),
    sb.from('employees').select('id, emp_code, full_name, designation, company_id, department_id, departments!employees_department_id_fkey(dept_name)').eq('id', caller.employeeId).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: `fn_ess_enabled: ${error.message} — has migration 071 been run?` }, { status: 500 })
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  if (caller.viewAs) await audit(caller, 'VIEW_AS_START', caller.employeeId, { route: 'session' })
  const blocked = !en?.enabled
  return NextResponse.json({
    blocked, reason: en?.reason ?? null, source: en?.source ?? null, view_as: caller.viewAs,
    employee: { id: emp.id, emp_code: emp.emp_code, full_name: emp.full_name, designation: emp.designation, company_id: emp.company_id, dept_name: (emp as any).departments?.dept_name || null },
  })
}
