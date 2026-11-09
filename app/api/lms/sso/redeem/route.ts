// app/api/lms/sso/redeem/route.ts — LMS side of the hand-off: a code from HRMS becomes a session
// on this domain (lib/lms/sso.ts). Public by design: the code is the credential, it is signed,
// and it is dead a minute after it was issued.
//
//   ESS employee   a fresh ESS token, exactly what /api/ess-auth/login would have issued.
//   Legacy login   a single-use magic-link hash the browser verifies with Supabase, so this
//                  domain gets its own Supabase session. Sharing the HRMS refresh token instead
//                  would break both: Supabase rotates it, and a reused one revokes the session.
import { NextRequest, NextResponse } from 'next/server'
import { issueEssToken } from '@/lib/ess-session'
import { verifyHandoff } from '@/lib/lms/sso'
import { sb } from '@/lib/lms/server'

export const runtime = 'nodejs'

const EXPIRED = { error: 'That sign-in link has expired. Open Learning from EZER HRMS again, or sign in here.' }
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  let body: { code?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const who = verifyHandoff(typeof body?.code === 'string' ? body.code : null)
  if (!who) return NextResponse.json(EXPIRED, { status: 401 })

  if (who.kind === 'ess') {
    const [{ data: emp }, { data: account }] = await Promise.all([
      sb.from('employees').select('id, full_name, office_email, personal_email').eq('id', who.employeeId).maybeSingle(),
      sb.from('ess_accounts').select('status').eq('employee_id', who.employeeId).maybeSingle(),
    ])
    if (!emp || account?.status !== 'ACTIVE') return NextResponse.json({ error: 'Account inactive. Contact HR.' }, { status: 403 })
    const token = issueEssToken(emp.id)
    if (!token) return NextResponse.json({ error: 'Sign-in is not available on this deployment.' }, { status: 503 })
    return NextResponse.json({
      kind: 'ess', employee_id: emp.id, name: emp.full_name,
      email: String(emp.office_email || emp.personal_email || '').toLowerCase(), token,
    }, { headers: NO_STORE })
  }

  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: who.email })
  if (error || !data?.properties?.hashed_token || data.user?.id !== who.userId) return NextResponse.json(EXPIRED, { status: 401 })
  // Same rule as the dashboard sign-in (app/page.tsx): an admin who is also an employee carries
  // the employee id, with no ESS token, so calls fall back to the Supabase session.
  const addr = who.email.toLowerCase()
  const { data: emp } = await sb.from('employees').select('id, full_name')
    .or(`office_email.ilike.${addr},personal_email.ilike.${addr}`).limit(1).maybeSingle()
  return NextResponse.json({
    kind: 'legacy', email: addr, token_hash: data.properties.hashed_token,
    employee: emp ? { id: emp.id, name: emp.full_name } : null,
  }, { headers: NO_STORE })
}
