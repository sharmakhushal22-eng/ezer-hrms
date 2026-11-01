// app/api/lms/admin/lookups/route.ts — the pick-lists an assign form needs, for one company.
// Names and org fields only. No salary, statutory or personal data leaves this route.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { allRows, errorResponse, sb } from '@/lib/lms/server'

export const runtime = 'nodejs'

const uniq = (rows: any[], k: string) => [...new Set(rows.map(r => r[k]).filter((v: any) => v && String(v).trim()))].sort()

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['assign', 'viewAssignments', 'editContent'])
  if (error) return error
  try {
    const [company] = await readCompanies(actor, req.nextUrl.searchParams.get('company'))
    let q = () => {
      let x = sb.from('employees').select('id, emp_code, full_name, designation, grade, employment_type, employee_category, team_name, confirmation_status, department_id, location_id').eq('company_id', company).eq('employment_status', 'Active').neq('is_test', true)
      if (actor.locationId) x = x.eq('location_id', actor.locationId)
      return x.order('full_name')
    }
    const [emps, { data: departments }, { data: locations }, { data: skills }] = await Promise.all([
      allRows<any>((f, t) => q().range(f, t)),
      sb.from('departments').select('id, dept_name').eq('company_id', company).order('dept_name'),
      sb.from('locations').select('id, location_name').eq('company_id', company).order('location_name'),
      sb.from('skills').select('name').order('name').limit(1000),
    ])
    return NextResponse.json({
      employees: emps.map(e => ({ id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation })),
      departments: departments || [], locations: locations || [],
      designations: uniq(emps, 'designation'), grades: uniq(emps, 'grade'), employment_types: uniq(emps, 'employment_type'),
      employee_categories: uniq(emps, 'employee_category'), teams: uniq(emps, 'team_name'), confirmation_statuses: uniq(emps, 'confirmation_status'),
      skills: (skills || []).map((s: any) => s.name),
    })
  } catch (e) { return errorResponse(e) }
}
