// app/api/ess-auth/set-password/route.ts — ESS first-time password set (self-service).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveEmployee, hashPassword } from '@/lib/ess-auth'
import { issueEssToken } from '@/lib/ess-session'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim()
  const password = String(body?.password || '')
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const employee = await resolveEmployee(sb, identifier)
  if (!employee) return NextResponse.json({ error: 'No employee found with this email/employee code' }, { status: 404 })

  const { data: account } = await sb.from('ess_accounts')
    .select('id, password_hash, status, password_reset_allowed').eq('employee_id', employee.id).maybeSingle()
  if (account && account.password_hash) return NextResponse.json({ error: 'Password already set. Use login.' }, { status: 409 })

  // This route used to set a password on any account that did not have one, for anybody
  // who could name an employee code — and employee codes are printed on the employee
  // list. That was a way to claim somebody else's account. It is now limited to accounts
  // HR has activated and explicitly opened for a reset. Everyone else is told to ask HR,
  // which is the path that already exists (/dashboard/ess-credentials).
  //
  // This matters more from now on: the provisioning trigger in migration 055 creates an
  // INACTIVE, password-less account for every new employee, and without this check every
  // one of those would be claimable by a stranger.
  if (!account || account.status !== 'ACTIVE' || account.password_reset_allowed === false) {
    return NextResponse.json(
      { error: 'Your login has not been issued yet — ask HR to generate your ESS credentials.' },
      { status: 403 },
    )
  }

  const { hash, salt } = hashPassword(password)
  if (account) {
    const { error } = await sb.from('ess_accounts').update({ password_hash: hash, password_salt: salt, status: 'ACTIVE', must_change_password: false, first_login_at: new Date().toISOString() }).eq('id', account.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('ess_accounts').insert({ employee_id: employee.id, password_hash: hash, password_salt: salt, status: 'ACTIVE', must_change_password: false, first_login_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // A password was just set by the account's owner, so a session is issued here the
  // same way login issues one.
  const token = issueEssToken(employee.id)
  return NextResponse.json({ ok: true, employee_id: employee.id, name: employee.full_name, token, session_available: !!token })
}
