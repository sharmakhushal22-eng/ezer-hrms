// app/api/ess-auth/status/route.ts — ESS auth step 1: does this identifier (email OR emp_code)
// map to an employee, and is a password already set?
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveEmployee } from '@/lib/ess-auth'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim()
  if (!identifier) return NextResponse.json({ error: 'Email or employee code required' }, { status: 400 })

  const employee = await resolveEmployee(sb, identifier)
  if (!employee) return NextResponse.json({ found: false })

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
