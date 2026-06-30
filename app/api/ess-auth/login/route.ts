// app/api/ess-auth/login/route.ts — ESS login with password verification.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

async function resolveEmployee(email: string) {
  const { data: employees } = await sb
    .from('employees')
    .select('id, full_name, employment_status, personal_email, office_email')
    .or(`personal_email.ilike.${email},office_email.ilike.${email}`)
  if (!employees || employees.length === 0) return null
  return employees.find((e: any) => (e.employment_status || '').toLowerCase() === 'active') || employees[0]
}

const INVALID = { error: 'Invalid email or password' }

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  const employee = await resolveEmployee(email)
  if (!employee) return NextResponse.json(INVALID, { status: 401 })

  const { data: account } = await sb
    .from('ess_accounts')
    .select('id, password_hash, password_salt, status, login_count')
    .eq('employee_id', employee.id)
    .maybeSingle()

  if (!account || !account.password_hash || !account.password_salt) {
    return NextResponse.json(INVALID, { status: 401 })
  }
  if (account.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Account inactive — contact HR.' }, { status: 403 })
  }

  const computed = crypto.scryptSync(password, account.password_salt, 64).toString('hex')
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(account.password_hash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json(INVALID, { status: 401 })
  }

  await sb
    .from('ess_accounts')
    .update({ last_login_at: new Date().toISOString(), login_count: (account.login_count || 0) + 1 })
    .eq('id', account.id)

  return NextResponse.json({ ok: true, employee_id: employee.id, name: employee.full_name })
}
