// app/api/esign/mine/route.ts — "Documents to sign" in the employee's own ESS.
//
// GET                    every envelope the signed-in employee is a signer on (matched by
//                        employee id, or by their office / personal e-mail)
// POST { signer_id }     a fresh signing link for one of them, when it is their turn —
//                        the page still asks for the e-mail OTP, the ESS login alone is
//                        not treated as a signature-grade identity check.
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { sb, issueLink, signUrl, appBase, migrationHint, logEvent } from '@/lib/esign/server'
import { loadLink } from '@/lib/esign/signer'

export const runtime = 'nodejs'

async function myRows(employeeId: string) {
  const { data: emp } = await sb.from('employees').select('office_email, personal_email').eq('id', employeeId).maybeSingle()
  const emails = [emp?.office_email, emp?.personal_email].filter(Boolean).map(e => String(e).toLowerCase())
  const cols = 'id, envelope_id, order_no, name, email, status, role_label, signed_at, invited_at, esign_envelopes(id, envelope_no, title, category, status, created_by_name, created_at, expires_at, completed_at, signing_order)'
  const [a, b] = await Promise.all([
    sb.from('esign_signers').select(cols).eq('employee_id', employeeId),
    emails.length ? sb.from('esign_signers').select(cols).in('email', emails) : Promise.resolve({ data: [] as any[], error: null }),
  ])
  if (a.error) throw a.error
  const all = new Map<string, any>()
  for (const r of [...(a.data || []), ...((b as any).data || [])]) all.set(r.id, r)
  return [...all.values()]
}

export async function GET(req: NextRequest) {
  const gate = await requireDashboardUser(req)
  if (gate.error) return gate.error
  if (!gate.user.employeeId) return NextResponse.json({ items: [] })
  try {
    const rows = await myRows(gate.user.employeeId)
    const items = rows.filter(r => r.esign_envelopes && r.esign_envelopes.status !== 'DRAFT').map(r => ({
      signer_id: r.id, status: r.status, signed_at: r.signed_at, invited_at: r.invited_at, role_label: r.role_label,
      envelope: r.esign_envelopes,
    })).sort((x, y) => String(y.envelope.created_at).localeCompare(String(x.envelope.created_at)))
    return NextResponse.json({ items })
  } catch (e: any) {
    const hint = migrationHint(e)
    if (hint) return NextResponse.json({ items: [], setup: hint })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireDashboardUser(req)
  if (gate.error) return gate.error
  if (!gate.user.employeeId) return NextResponse.json({ error: 'Only an employee session can sign.' }, { status: 403 })
  const { signer_id } = await req.json().catch(() => ({}))
  const rows = await myRows(gate.user.employeeId)
  const mine = rows.find(r => r.id === signer_id)
  if (!mine) return NextResponse.json({ error: 'That document is not addressed to you.' }, { status: 404 })
  if (mine.status === 'WAITING') return NextResponse.json({ error: 'Someone before you still has to sign. You will get an e-mail when it is your turn.' }, { status: 409 })
  const token = await issueLink(mine.id)
  const st = await loadLink(token)
  if (st?.blocked && st.blocked.code !== 'SIGNED' && st.blocked.code !== 'COMPLETED') return NextResponse.json({ error: st.blocked.message }, { status: 409 })
  await logEvent(mine.envelope_id, 'OPENED', { signerId: mine.id, actor: `${mine.name} (from ESS)`, req })
  return NextResponse.json({ url: signUrl(appBase(req), token) })
}
