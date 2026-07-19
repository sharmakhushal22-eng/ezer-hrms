// app/api/ess-auth/admin/generate/route.ts — HR bulk-generates ESS login credentials.
// Temp password = the employee's emp_code. must_change_password=true forces a change on first login.
// Body: { employee_ids?: string[], company_id?: string, all?: boolean, reset?: boolean, performedBy?: string }
//   • all=true → every active employee (optionally scoped to company_id)
//   • reset=false (default) → skip employees who already set a real password
//   • reset=true → re-issue emp_code as a temp password (forces change again)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/ess-auth'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const { employee_ids, company_id, all, reset, performedBy } = body

  // Target employee set.
  let q = sb.from('employees').select('id, emp_code, full_name, office_email, personal_email, employment_status').neq('is_test', true)
  if (Array.isArray(employee_ids) && employee_ids.length) q = q.in('id', employee_ids)
  else if (all) { q = q.eq('employment_status', 'Active'); if (company_id) q = q.eq('company_id', company_id) }
  else return NextResponse.json({ error: 'Provide employee_ids or all=true' }, { status: 400 })

  const { data: emps, error } = await q.order('emp_code')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!emps?.length) return NextResponse.json({ error: 'No employees matched' }, { status: 404 })

  // Existing accounts (to skip already-active ones unless reset).
  const ids = emps.map((e: any) => e.id)
  const existing: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await sb.from('ess_accounts').select('id, employee_id, password_hash, must_change_password').in('employee_id', ids.slice(i, i + 400))
    ;(data || []).forEach((a: any) => { existing[a.employee_id] = a })
  }

  const issued: any[] = []
  let skipped = 0
  for (const e of emps as any[]) {
    const acct = existing[e.id]
    // Skip employees who already have a real (non-temp) password, unless reset requested.
    if (acct?.password_hash && !acct.must_change_password && !reset) { skipped++; continue }
    const tempPw = String(e.emp_code).trim().toUpperCase()   // temp password = emp_code
    const { hash, salt } = hashPassword(tempPw)
    const patch = {
      employee_id: e.id, password_hash: hash, password_salt: salt,
      status: 'ACTIVE', must_change_password: true, password_reset_allowed: true,
    }
    const { error: ue } = await sb.from('ess_accounts').upsert(patch, { onConflict: 'employee_id' })
    if (ue) { issued.push({ emp_code: e.emp_code, full_name: e.full_name, status: 'ERROR', error: ue.message }); continue }
    issued.push({
      emp_code: e.emp_code, full_name: e.full_name,
      login_id: e.office_email || e.personal_email || e.emp_code,
      temp_password: tempPw, status: 'ISSUED',
    })
  }

  // Audit (best-effort).
  try {
    await sb.from('ess_access_audit').insert({
      action: 'CREDENTIALS_GENERATED', performed_by_name: performedBy || 'Admin',
      details: { count: issued.filter(i => i.status === 'ISSUED').length, skipped, reset: !!reset },
    })
  } catch { /* audit optional */ }

  return NextResponse.json({ issued, skipped, generated: issued.filter(i => i.status === 'ISSUED').length })
}
