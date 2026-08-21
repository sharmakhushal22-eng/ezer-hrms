// app/api/ess-auth/change-password/route.ts — verify current password, set a new one,
// clear the must_change_password flag. Used for the forced first-login change and voluntary changes.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveEmployee, hashPassword, verifyPassword } from '@/lib/ess-auth'
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
  const current = String(body?.current_password || '')
  const next = String(body?.new_password || '')

  if (next.length < 6) return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
  if (next === current) return NextResponse.json({ error: 'New password must be different from the current one' }, { status: 400 })

  const employee = await resolveEmployee(sb, identifier)
  if (!employee) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const { data: account } = await sb.from('ess_accounts')
    .select('id, password_hash, password_salt, status').eq('employee_id', employee.id).maybeSingle()
  if (!account || !account.password_hash) return NextResponse.json({ error: 'No account to update' }, { status: 404 })
  if (account.status !== 'ACTIVE') return NextResponse.json({ error: 'Account inactive — contact HR.' }, { status: 403 })
  if (!verifyPassword(current, account.password_hash, account.password_salt)) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })

  const { hash, salt } = hashPassword(next)
  const { error } = await sb.from('ess_accounts')
    .update({ password_hash: hash, password_salt: salt, must_change_password: false }).eq('id', account.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // They proved the old password and set a new one, so this is the moment a session is
  // earned — login deliberately withholds it while must_change_password stands.
  const token = issueEssToken(employee.id)
  return NextResponse.json({ ok: true, employee_id: employee.id, name: employee.full_name, token, session_available: !!token })
}
