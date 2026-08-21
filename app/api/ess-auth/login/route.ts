// app/api/ess-auth/login/route.ts — ESS login (email OR emp_code) with password verification.
import { NextRequest, NextResponse } from 'next/server'
import { issueEssToken } from '@/lib/ess-session'
import { createClient } from '@supabase/supabase-js'
import { resolveEmployee, verifyPassword } from '@/lib/ess-auth'

export const runtime = 'nodejs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const INVALID = { error: 'Invalid email/employee code or password' }

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim()
  const password = String(body?.password || '')

  const employee = await resolveEmployee(sb, identifier)
  if (!employee) return NextResponse.json(INVALID, { status: 401 })

  const { data: account } = await sb
    .from('ess_accounts')
    .select('id, password_hash, password_salt, status, login_count, must_change_password')
    .eq('employee_id', employee.id)
    .maybeSingle()

  if (!account || !account.password_hash || !account.password_salt) return NextResponse.json(INVALID, { status: 401 })
  if (account.status !== 'ACTIVE') return NextResponse.json({ error: 'Account inactive — contact HR.' }, { status: 403 })
  if (!verifyPassword(password, account.password_hash, account.password_salt)) return NextResponse.json(INVALID, { status: 401 })

  await sb.from('ess_accounts')
    .update({ last_login_at: new Date().toISOString(), first_login_at: account.login_count ? undefined : new Date().toISOString(), login_count: (account.login_count || 0) + 1 })
    .eq('id', account.id)

  // A temp password is the employee code, which anyone can read off the employee list.
  // So a session is not issued while must_change_password stands — the flag used to be
  // advisory and a valid token came with it anyway. Withholding it costs the employee
  // nothing: /api/ess-auth/change-password takes the identifier and the current password
  // and needs no session, so they can still set a real one and get a token then.
  if (account.must_change_password) {
    return NextResponse.json({
      ok: true,
      employee_id: employee.id,
      name: employee.full_name,
      must_change_password: true,
      token: null,
      session_available: false,
    })
  }

  // The signed session token. issueEssToken was imported in 9cb7f8c but never called, so
  // this response carried no token: ess-login stored null, essAuthHeaders() sent no
  // Authorization header, and every travel route answered 401 for every signed-in
  // employee. The gate was working — there was simply nothing to present to it.
  const token = issueEssToken(employee.id)

  return NextResponse.json({
    ok: true,
    employee_id: employee.id,
    name: employee.full_name,
    must_change_password: false,
    token,
    // Null means no signing secret is configured on this deployment. Said out loud
    // rather than left to surface as a 401 the employee cannot act on.
    session_available: !!token,
  })
}
