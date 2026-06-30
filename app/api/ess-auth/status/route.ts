// app/api/ess-auth/status/route.ts — ESS auth step 1: does this email map to an employee, and is a password set?
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const { data: employees, error } = await sb
    .from('employees')
    .select('id, full_name, employment_status, personal_email, office_email')
    .or(`personal_email.ilike.${email},office_email.ilike.${email}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!employees || employees.length === 0) return NextResponse.json({ found: false })

  // Prefer the first Active employee, else fall back to the first match.
  const employee =
    employees.find((e: any) => (e.employment_status || '').toLowerCase() === 'active') || employees[0]

  const { data: account } = await sb
    .from('ess_accounts')
    .select('id, password_hash, status')
    .eq('employee_id', employee.id)
    .maybeSingle()

  return NextResponse.json({
    found: true,
    employee_id: employee.id,
    name: employee.full_name,
    has_password: !!(account && account.password_hash),
  })
}
