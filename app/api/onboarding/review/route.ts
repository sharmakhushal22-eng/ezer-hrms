// app/api/onboarding/review/route.ts — the HR Manager's review of a submitted onboarding form,
// from the onboarding card (dashboard and ESS → Onboarding).
//
//   GET  ?onboarding_id=…                      the form, documents (signed URLs + verdicts), team
//                                              approvals and the last review
//   POST { onboarding_id, outcome: 'ACCEPTED'|'RETURNED', documents:[{doc_code, ok, reason}],
//          details:[{section, field, reason}], note }
//        ACCEPTED → the HR Manager's team approval (the fourth approval generates the code)
//        RETURNED → link reopens 48h, the candidate is mailed every rejected document and
//                   flagged detail with its reason; the card shows Resend link until resubmitted
//
// Guarded by the Onboarding module (VIEW to read, EDIT to decide), on either session.
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { reviewPayload, applyReview } from '@/lib/onboarding/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mailer = () => {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return { t: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>` }
}

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  const id = req.nextUrl.searchParams.get('onboarding_id') || ''
  if (!id) return NextResponse.json({ error: 'onboarding_id required' }, { status: 400 })
  const payload = await reviewPayload(sb as any, id, { maskBank: false })
  if (!payload) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })
  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding', 'EDIT')
  if (gate.error) return gate.error
  const body = await req.json().catch(() => ({}))
  const onboardingId = String(body.onboarding_id || '')
  const outcome = body.outcome === 'ACCEPTED' ? 'ACCEPTED' : body.outcome === 'RETURNED' ? 'RETURNED' : null
  if (!onboardingId || !outcome) return NextResponse.json({ error: 'onboarding_id and outcome (ACCEPTED | RETURNED) are required' }, { status: 400 })
  const documents = Array.isArray(body.documents) ? body.documents.filter((d: any) => d && d.doc_code).map((d: any) => ({ doc_code: String(d.doc_code), ok: d.ok !== false, reason: d.reason ? String(d.reason) : null })) : []
  const details = Array.isArray(body.details) ? body.details.filter((d: any) => d && d.field).map((d: any) => ({ section: d.section ? String(d.section) : null, field: String(d.field), reason: d.reason ? String(d.reason) : '' })) : []
  // The reviewer's name: the employee behind an ESS session, else the legacy login's email.
  const { user } = gate
  const { data: me } = user.employeeId ? await sb.from('employees').select('full_name').eq('id', user.employeeId).maybeSingle() : { data: null as any }
  const out = await applyReview(sb as any, {
    onboardingId, outcome, documents, details, note: body.note ? String(body.note) : null,
    actorId: user.employeeId, actorName: me?.full_name || user.email || null,
    mail: mailer(), baseUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
  })
  if (!out.ok) return NextResponse.json({ error: out.error, needs_managers: !!out.needs_managers }, { status: out.status || 500 })
  return NextResponse.json(out)
}
