// app/api/analytics/digest/route.ts — the analytics emails' switches, previews and opt-out.
//
// GET                         anyone signed in: is the Monday email on, and have I opted out?
//                             Administrators also get the settings and the recipient list.
// GET ?preview=monday_note|monthly_briefing
//                             my own email as it would go out this week / month (HTML).
// POST {action:'settings', monday_note, monthly_briefing, briefing_recipients}
//                             administrators (as for Manage access); written to ess_access_audit
// POST {action:'optout', kind, off}
//                             myself: stop (or restart) an email for me
// POST {action:'test', kind}  send myself my own preview now (5 an hour)
import { NextRequest, NextResponse } from 'next/server'
import { requireGrant } from '@/lib/rms/authz'
import { sb } from '@/lib/analytics/server/db'
import { canManageAnalytics } from '@/lib/analytics/server/access'
import { digestSettings, optedOut, previewFor, type DigestKind } from '@/lib/analytics/server/digest'
import { sendMail, mailConfigured } from '@/lib/mail/send'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const KINDS: DigestKind[] = ['monday_note', 'monthly_briefing']
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
const MISSING = 'Run migration 233_analytics_digests.sql in the Supabase SQL editor to turn on the analytics emails.'
const tests = new Map<string, number[]>()

export async function GET(req: NextRequest) {
  const gate = await requireGrant(req)
  if (gate.error) return gate.error
  const g = gate.grant
  const sp = req.nextUrl.searchParams
  const kind = sp.get('preview') as DigestKind | null
  if (kind) {
    if (!KINDS.includes(kind)) return bad('Which email?')
    if (!g.employeeId) return bad('Sign in to ESS to preview your own email.', 400)
    const p = await previewFor(kind, g.employeeId)
    if (!p) return bad(kind === 'monday_note' ? 'Nobody reports to you, so there is no Monday note.' : 'You have no People Analytics access, so there is no briefing for you.', 404)
    return NextResponse.json({ subject: p.subject, html: p.html, to: p.to }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const { ready, settings } = await digestSettings()
  const manage = canManageAnalytics(g)
  const me = g.employeeId ? { mondayOptedOut: ready ? await optedOut(g.employeeId, 'monday_note') : false } : null
  let recipients: { id: string; name: string; code: string | null; designation: string | null }[] = []
  if (manage && settings.briefing_recipients.length) {
    const { data } = await sb.from('employees').select('id, full_name, emp_code, designation').in('id', settings.briefing_recipients)
    recipients = ((data || []) as any[]).map(e => ({ id: e.id, name: e.full_name, code: e.emp_code, designation: e.designation }))
  }
  return NextResponse.json({
    ready, mail: mailConfigured(), mondayOn: settings.monday_note, me, manage,
    ...(manage ? { settings, recipients } : {}),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const gate = await requireGrant(req)
  if (gate.error) return gate.error
  const g = gate.grant
  let body: any
  try { body = await req.json() } catch { return bad('Invalid request.') }
  const action = String(body?.action || '')
  const { ready } = await digestSettings()

  if (action === 'settings') {
    if (!canManageAnalytics(g)) return bad('You cannot change the analytics emails.', 403)
    if (!ready) return bad(MISSING, 409)
    const ids = Array.isArray(body.briefing_recipients) ? [...new Set(body.briefing_recipients.filter(isUuid) as string[])].slice(0, 100) : []
    const row = {
      id: 1, monday_note: !!body.monday_note, monthly_briefing: !!body.monthly_briefing, briefing_recipients: ids,
      updated_by: g.employeeId, updated_by_name: g.name || (g.legacy ? 'Legacy dashboard login' : null), updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('analytics_digest_settings').upsert(row, { onConflict: 'id' })
    if (error) return bad(error.message, 500)
    await sb.from('ess_access_audit').insert({ ess_account_id: null, action: 'analytics_digest_settings', performed_by: g.employeeId, performed_by_name: row.updated_by_name || 'Unknown', reason: null, details: row }).then(() => undefined, () => undefined)
    return NextResponse.json({ ok: true })
  }

  const kind = body?.kind as DigestKind
  if (!KINDS.includes(kind)) return bad('Which email?')
  if (!g.employeeId) return bad('Sign in to ESS for this.', 400)

  if (action === 'optout') {
    if (!ready) return bad(MISSING, 409)
    const res = body.off
      ? await sb.from('analytics_digest_optout').upsert({ employee_id: g.employeeId, kind }, { onConflict: 'employee_id,kind' })
      : await sb.from('analytics_digest_optout').delete().eq('employee_id', g.employeeId).eq('kind', kind)
    if (res.error) return bad(res.error.message, 500)
    return NextResponse.json({ ok: true, off: !!body.off })
  }

  if (action === 'test') {
    const now = Date.now(), recent = (tests.get(g.employeeId) || []).filter(t => now - t < 3600_000)
    if (recent.length >= 5) return bad('Five test emails an hour — try again later.', 429)
    if (!mailConfigured()) return bad('Email is not set up on this deployment, so nothing can be sent. Use Preview instead.', 409)
    const p = await previewFor(kind, g.employeeId)
    if (!p) return bad('There is nothing to send you for that email.', 404)
    if (!p.to) return bad('Your employee record has no email address that can receive mail.', 409)
    tests.set(g.employeeId, [...recent, now])
    const r = await sendMail({ to: p.to, subject: `[Test] ${p.subject}`, html: p.html, text: p.text, fromName: 'EZER HRMS' })
    return r.sent ? NextResponse.json({ ok: true, to: p.to }) : bad(r.error || r.skipped || 'Not sent.', 502)
  }
  return bad('Unknown action.')
}
