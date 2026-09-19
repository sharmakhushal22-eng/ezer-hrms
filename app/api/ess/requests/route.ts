// app/api/ess/requests/route.ts — the ESS requests desk: letters and services.
//
// WHY THIS ROUTE EXISTS
//
// Four tables with no endpoint between them — ess_letter_requests,
// generated_letters, letter_templates and ess_service_requests — so both
// clients read and wrote them straight from the browser and the phone on the
// anon key. Raising a request is a write, and a write on the anon key names
// its own actor: the employee_id came from the client, which is the hole the
// ESS session layer exists to close.
//
// GET  → issued letters, letter requests and service requests, in one call.
// POST → raise either kind, with the employee taken from the session.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
//
// It notifies nobody. Letter requests are worked from an HR screen, and a
// service request only reaches the portal's approval queue when its type is
// one of the live ones (LOAN, RESIGNATION, PROFILE_UPDATE — see
// APPROVAL_TYPES in lib/supabase-ess.ts). A request of any other type sits in
// the table until somebody looks, and inventing a notification that points at
// a queue it will never appear in would be a lie told politely.
//
// It also does not interpret `assigned_to`. The web sends 'HR' by default and
// the app sends 'IC' for a POSH complaint — a routing decision that belongs
// with whoever designs the desks, not with a transport route.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

interface IssuedRow {
  id: string
  template_id: string | null
  letter_date: string | null
  file_url: string | null
}
interface TemplateRow { id: string; name: string | null }
interface LetterRequestRow {
  id: string
  letter_type: string
  purpose: string | null
  custom_details: string | null
  status: string | null
  requested_at: string | null
  letter_url: string | null
  rejection_reason: string | null
}
interface ServiceRow {
  id: string
  request_type: string
  request_data: Record<string, unknown> | null
  status: string | null
  is_confidential: boolean | null
  assigned_to: string | null
  submitted_at: string | null
  resolved_at: string | null
  resolution_note: string | null
}

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : [])

// A letter request still waiting on somebody, per the CHECK constraint in
// migration 021. Service requests get no such guard on purpose: two IT
// problems in a week are two real requests, not a duplicate.
const OPEN_LETTER = ['REQUESTED', 'APPROVED']

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId

  const [issuedR, letterReqR, serviceR] = await Promise.all([
    // Only what HR has actually released to ESS. A generated letter that has
    // not been published is not the employee's to see yet.
    sb.from('generated_letters')
      .select('id, template_id, letter_date, file_url')
      .eq('employee_id', me).not('published_to_ess_at', 'is', null)
      .order('letter_date', { ascending: false }).limit(50),
    sb.from('ess_letter_requests')
      .select('id, letter_type, purpose, custom_details, status, requested_at, letter_url, rejection_reason')
      .eq('employee_id', me).order('requested_at', { ascending: false }).limit(20),
    sb.from('ess_service_requests')
      .select('id, request_type, request_data, status, is_confidential, assigned_to, submitted_at, resolved_at, resolution_note')
      .eq('employee_id', me).order('submitted_at', { ascending: false }).limit(30),
  ])

  const issued = rows<IssuedRow>(issuedR.data)

  // The template name, resolved here rather than by an embed: generated_letters
  // is written by the letter generator and the relationship is not one this
  // route should depend on being declared.
  const ids = [...new Set(issued.map(l => l.template_id).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await sb.from('letter_templates').select('id, name').in('id', ids)
    for (const t of rows<TemplateRow>(data)) names.set(t.id, t.name ?? 'Letter')
  }

  const letterRequests = rows<LetterRequestRow>(letterReqR.data)
  const serviceRequests = rows<ServiceRow>(serviceR.data)

  return NextResponse.json({
    letters: {
      issued: issued.map(l => ({
        id: l.id,
        name: l.template_id ? names.get(l.template_id) ?? 'Letter' : 'Letter',
        letter_date: l.letter_date,
        file_url: l.file_url,
      })),
      requests: letterRequests.map(x => ({
        id: x.id,
        letter_type: x.letter_type,
        purpose: x.purpose,
        details: x.custom_details,
        status: x.status ?? 'REQUESTED',
        requested_at: x.requested_at,
        letter_url: x.letter_url,
        rejection_reason: x.rejection_reason,
      })),
    },
    service: {
      requests: serviceRequests.map(x => ({
        id: x.id,
        request_type: x.request_type,
        detail: typeof x.request_data?.detail === 'string' ? x.request_data.detail : null,
        status: x.status ?? 'PENDING',
        confidential: !!x.is_confidential,
        assigned_to: x.assigned_to,
        submitted_at: x.submitted_at,
        resolved_at: x.resolved_at,
        resolution_note: x.resolution_note,
      })),
    },
    diagnostics: {
      noIssuedLetters: !issued.length,
      noLetterRequests: !letterRequests.length,
      noServiceRequests: !serviceRequests.length,
    },
  })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('A request cannot be raised while viewing as somebody else.')

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
  const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  const kind = text(body.kind).toLowerCase()

  // ── A letter ────────────────────────────────────────────────────────────
  if (kind === 'letter') {
    const letterType = text(body.letter_type, 80)
    if (!letterType) return bad('Say which letter you need.')
    const purpose = text(body.purpose)
    const details = text(body.details ?? body.custom_details, 1000)

    // A second request for the same letter while the first is still open adds
    // nothing but a duplicate for HR to close.
    const { data: open } = await sb.from('ess_letter_requests')
      .select('id, status').eq('employee_id', me)
      .eq('letter_type', letterType).in('status', OPEN_LETTER).limit(1)
    if (rows<{ id: string }>(open).length) {
      return bad(`You already have a ${letterType.toLowerCase()} request waiting. HR will update it here.`, 409)
    }

    const { data, error } = await sb.from('ess_letter_requests').insert({
      employee_id: me,                    // the session's, never the body's
      letter_type: letterType,
      purpose: purpose || null,
      custom_details: details || null,
    }).select('id, status, requested_at').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await audit(ctx.caller, 'LETTER_REQUESTED', me, { letter_type: letterType })
    const row = data as { id?: string; status?: string } | null
    return NextResponse.json({ ok: true, kind: 'letter', id: row?.id, status: row?.status ?? 'REQUESTED' })
  }

  // ── A service request ───────────────────────────────────────────────────
  if (kind === 'service') {
    const requestType = text(body.request_type, 80)
    const detail = text(body.detail, 2000)
    if (!requestType) return bad('Say what kind of request this is.')
    if (!detail) return bad('Describe the request. Whoever picks it up reads this.')

    const { data, error } = await sb.from('ess_service_requests').insert({
      employee_id: me,
      request_type: requestType,
      request_data: { detail },
      is_confidential: body.confidential === true,
      // 'HR' on the web, 'IC' for a POSH complaint on the phone. Passed
      // through, not decided here.
      assigned_to: text(body.assigned_to, 40) || 'HR',
    }).select('id, status, submitted_at').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await audit(ctx.caller, 'SERVICE_REQUEST_RAISED', me, {
      request_type: requestType,
      confidential: body.confidential === true,
    })
    const row = data as { id?: string; status?: string } | null
    return NextResponse.json({ ok: true, kind: 'service', id: row?.id, status: row?.status ?? 'PENDING' })
  }

  return bad("kind must be 'letter' or 'service'.")
}
