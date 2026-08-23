// app/api/payroll/unlock/route.ts — prove it is still you, before payroll opens.
//
// The check is against the account that is ALREADY signed in. Someone else's correct
// password does not open payroll on your session — otherwise this would be a way to
// borrow a colleague's access rather than a way to confirm your own.
//
// Two identities can be confirmed, matching the two ways into the dashboard:
//   ESS session    the password on their ess_accounts row
//   legacy login   the Supabase password for that email
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyEssToken } from '@/lib/ess-session'
import { issueUnlockToken, UNLOCK_TTL_MINUTES } from '@/lib/payroll-unlock'
import { verifyPassword, resolveEmployee } from '@/lib/ess-auth'
import { LEGACY_SUPABASE_BRIDGE } from '@/lib/rms-server'
import { grantForRequest } from '@/lib/rms-server'
import { canSee } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
)

// One message for every kind of failure. Saying "wrong password" rather than "no such
// user" is what turns a login form into a way of discovering who exists.
const WRONG = { error: 'That password is not right.' }

function bearer(req: NextRequest): string {
  const h = req.headers.get('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

export async function POST(req: NextRequest) {
  const token = bearer(req)
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const identifier = String(body?.identifier || '').trim()
  const password = String(body?.password || '')
  if (!password) return NextResponse.json(WRONG, { status: 401 })

  // Payroll access is checked before the password is, so somebody with no payroll
  // permission gets told that plainly instead of being asked to type a password that
  // was never going to open anything.
  const grant = await grantForRequest(req)
  if (!canSee(grant, 'Payroll')) {
    return NextResponse.json({ error: 'Payroll is not part of your access.' }, { status: 403 })
  }

  // ── an ESS session ────────────────────────────────────────────────────────
  const ess = verifyEssToken(token)
  if (ess?.employeeId) {
    const { data: emp } = await sb
      .from('employees').select('id, emp_code, office_email, personal_email')
      .eq('id', ess.employeeId).maybeSingle()
    if (!emp) return NextResponse.json(WRONG, { status: 401 })

    // If they typed an identifier, it has to be their own. Confirming your identity
    // with somebody else's employee code is not confirming your identity.
    if (identifier) {
      const typed = await resolveEmployee(sb, identifier)
      if (!typed || typed.id !== emp.id) {
        return NextResponse.json(
          { error: 'That is not the account you are signed in as.' },
          { status: 401 },
        )
      }
    }

    const { data: acct } = await sb
      .from('ess_accounts').select('password_hash, password_salt, status')
      .eq('employee_id', emp.id).maybeSingle()
    if (!acct?.password_hash || !acct.password_salt) return NextResponse.json(WRONG, { status: 401 })
    if (acct.status !== 'ACTIVE') return NextResponse.json({ error: 'Account inactive — contact HR.' }, { status: 403 })
    if (!verifyPassword(password, acct.password_hash, acct.password_salt)) {
      return NextResponse.json(WRONG, { status: 401 })
    }

    const unlock = issueUnlockToken(emp.id)
    if (!unlock) return NextResponse.json({ error: 'Payroll unlock is not configured on this deployment.' }, { status: 500 })
    return NextResponse.json({ ok: true, ...unlock, minutes: UNLOCK_TTL_MINUTES })
  }

  // ── the legacy dashboard login ────────────────────────────────────────────
  if (LEGACY_SUPABASE_BRIDGE) {
    const { data, error } = await sb.auth.getUser(token)
    if (!error && data?.user?.email) {
      if (identifier && identifier.toLowerCase() !== data.user.email.toLowerCase()) {
        return NextResponse.json({ error: 'That is not the account you are signed in as.' }, { status: 401 })
      }
      // signInWithPassword is the only way to check a Supabase password. It mints a
      // session that is thrown away — this route cares about the yes or no, not the
      // token, and the caller keeps the session they already had.
      const probe = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      )
      const { error: pwErr } = await probe.auth.signInWithPassword({ email: data.user.email, password })
      if (pwErr) return NextResponse.json(WRONG, { status: 401 })

      const unlock = issueUnlockToken(data.user.id)
      if (!unlock) return NextResponse.json({ error: 'Payroll unlock is not configured on this deployment.' }, { status: 500 })
      return NextResponse.json({ ok: true, ...unlock, minutes: UNLOCK_TTL_MINUTES })
    }
  }

  return NextResponse.json({ error: 'Your session has expired — sign in again.' }, { status: 401 })
}
