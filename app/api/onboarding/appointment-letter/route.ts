// app/api/onboarding/appointment-letter/route.ts — the Letter of Appointment, once the joiner's
// employee code is generated (Onboarding → the joiner's row → Appointment letter).
//
//   GET  ?onboarding_id=…          -> { draft, to, email, salary_source, last_sent }   the letter, auto-filled
//   POST { onboarding_id, draft, action: 'preview' }                  -> application/pdf
//   POST { onboarding_id, draft, action: 'send', to, cc?, subject, body } -> { ok, sent_to }
//
// The draft is whatever the HR Manager left in the popup (lib/onboarding/appointment-letter.ts);
// the PDF is drawn from it as is and mailed to the candidate. Every send is logged in
// onboarding_notifications and onboarding_audit_log, so the popup can say when it last went,
// and saved to the employee's ESS → Profile → My Letters (generated_letters, migration 200) with
// a bell notification; a re-send replaces the copy there.
// Guarded by the Onboarding module or the HR Letters module (People → Letters → Pending letters):
// VIEW to read, EDIT to preview or send.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { sendMail, MAIL_NOT_CONFIGURED } from '@/lib/mail/send'
import { loadAppointment, appointmentLetterPdf } from '@/lib/onboarding/appointment-letter-server'
import { apptProblems, defaultEmail, type ApptDraft, type ApptFields } from '@/lib/onboarding/appointment-letter'
import { docIdFor } from '@/lib/letters/catalog'

export const runtime = 'nodejs' // pdfkit + nodemailer
export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const LETTER_NAME = 'Letter of Appointment'

/** The sent letter into the employee's ESS → My Letters. Never blocks the send: what went
 *  wrong is reported back to the popup instead. */
async function saveToEss(o: { employeeId: string; companyId: string | null; pdf: { name: string; content: Buffer }; by: string | null; byName?: string | null; to?: string | null; companyCode?: string | null; empCode?: string | null; fields?: unknown }): Promise<string | null> {
  const now = new Date().toISOString()
  const path = `appointment/${o.employeeId}/${Date.now()}_${o.pdf.name}`
  const up = await sb.storage.from('generated-letters').upload(path, o.pdf.content, { contentType: 'application/pdf', upsert: false })
  if (up.error) return `the PDF could not be stored (${up.error.message})`
  // Only the latest appointment letter stays in My Letters.
  await sb.from('generated_letters').update({ published_to_ess_at: null }).eq('employee_id', o.employeeId).eq('letter_name', LETTER_NAME).not('published_to_ess_at', 'is', null)
  const row = {
    template_id: null, letter_name: LETTER_NAME, employee_id: o.employeeId, company_id: o.companyId, file_url: path,
    letter_date: now.slice(0, 10), generated_by: o.by, generated_at: now, emailed_at: now, published_to_ess_at: now,
  }
  // With the People → Letters columns (migration 204): APT and its document ID; without them before that.
  const prefix = docIdFor('APT', o.companyCode || '', o.empCode || '', now, 0).replace(/-000$/, '')
  const { count } = await sb.from('generated_letters').select('id', { count: 'exact', head: true }).like('doc_id', `${prefix}-%`)
  let { error } = await sb.from('generated_letters').insert({ ...row, letter_type: 'APT', doc_id: docIdFor('APT', o.companyCode || '', o.empCode || '', now, (count || 0) + 1), sent_to: o.to || null, generated_by_name: o.byName || null, fields: o.fields ?? null })
  if (error && /letter_type|doc_id|sent_to|generated_by_name|fields/.test(error.message)) ({ error } = await sb.from('generated_letters').insert(row))
  if (error) {
    await sb.storage.from('generated-letters').remove([path]).then(() => null, () => null)
    return /letter_name|template_id|null value/i.test(error.message) ? 'run migration 200_appointment_letter_in_ess.sql in Supabase' : error.message
  }
  await sb.from('ess_notifications').insert({ employee_id: o.employeeId, category: 'RECRUITMENT', title: 'Your Letter of Appointment', body: 'Your Letter of Appointment is in Profile → My Letters. Download it, sign every page and share it with HR.', link: '/ess/letters', is_read: false }).then(() => null, () => null)
  return null
}

/** Either module lets the caller in: Onboarding (the onboarding team) or HR Letters (People →
 *  Letters — the HR Head sends letters without being given the rest of onboarding). */
async function gateFor(req: NextRequest, level: 'VIEW' | 'EDIT') {
  const a = await requireModule(req, 'Onboarding', level)
  if (!a.error) return a
  const b = await requireModule(req, 'HR Letters', level)
  return b.error ? a : b
}

async function lastSent(onboardingId: string) {
  const { data } = await sb.from('onboarding_audit_log').select('created_at, details').eq('onboarding_id', onboardingId).eq('action', 'APPOINTMENT_LETTER_SENT').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data ? { at: data.created_at, to: (data.details as any)?.to || null, by: (data.details as any)?.by_name || null } : null
}

/** The draft from the browser, kept to the shape and sizes the PDF expects. */
function cleanDraft(raw: any, base: ApptDraft): ApptDraft {
  const s = (v: any, max = 300) => String(v ?? '').slice(0, max)
  const n = (v: any) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 ? x : 0 }
  const rf = raw?.fields || {}
  const b = base.fields
  const fields: ApptFields = {
    salutation: s(rf.salutation ?? b.salutation, 10), name: s(rf.name ?? b.name, 120), emp_code: s(rf.emp_code ?? b.emp_code, 40),
    letter_date: s(rf.letter_date ?? b.letter_date, 10), designation: s(rf.designation ?? b.designation, 120), department: s(rf.department ?? b.department, 120),
    company_name: s(rf.company_name ?? b.company_name, 160), doj: s(rf.doj ?? b.doj, 10), place: s(rf.place ?? b.place, 120),
    ctc_annual: n(rf.ctc_annual ?? b.ctc_annual), jb_total: n(rf.jb_total ?? b.jb_total), jb_first: n(rf.jb_first ?? b.jb_first), jb_second: n(rf.jb_second ?? b.jb_second),
    esop_value: n(rf.esop_value ?? b.esop_value), esop_vesting: s(rf.esop_vesting ?? b.esop_vesting, 160),
    probation_notice_days: n(rf.probation_notice_days ?? b.probation_notice_days), notice_days: n(rf.notice_days ?? b.notice_days),
    jurisdiction: s(rf.jurisdiction ?? b.jurisdiction, 80), medical: s(rf.medical ?? b.medical, 200),
    gratuity_annual: n(rf.gratuity_annual ?? b.gratuity_annual), gratuity_in_ctc: rf.gratuity_in_ctc != null ? !!rf.gratuity_in_ctc : b.gratuity_in_ctc,
  }
  const sections = Array.isArray(raw?.sections) ? raw.sections.slice(0, 40).map((x: any) => ({ key: s(x?.key, 40), heading: s(x?.heading, 120), body: s(x?.body, 8000), inline: !!x?.inline })) : base.sections
  const annexure = Array.isArray(raw?.annexure) ? raw.annexure.slice(0, 30).map((x: any) => ({ label: s(x?.label, 80), monthly: n(x?.monthly), annual: n(x?.annual), bold: !!x?.bold })).filter((x: any) => x.label.trim()) : base.annexure
  return { fields, sections, annexure }
}

export async function GET(req: NextRequest) {
  const gate = await gateFor(req, 'VIEW')
  if (gate.error) return gate.error
  const id = req.nextUrl.searchParams.get('onboarding_id') || ''
  if (!id) return bad('onboarding_id required')
  const ctx = await loadAppointment(sb, id)
  if (!ctx) return bad('Onboarding record not found.', 404)
  if (!ctx.onboarding.employee_code) return bad('Generate the employee code first — the appointment letter follows it.', 409)
  return NextResponse.json({ draft: ctx.draft, to: ctx.to, email: defaultEmail(ctx.draft.fields), salary_source: ctx.salary_source, last_sent: await lastSent(id) })
}

export async function POST(req: NextRequest) {
  const gate = await gateFor(req, 'EDIT')
  if (gate.error) return gate.error
  const b = await req.json().catch(() => ({}))
  const id = String(b.onboarding_id || '')
  if (!id) return bad('onboarding_id required')
  const ctx = await loadAppointment(sb, id)
  if (!ctx) return bad('Onboarding record not found.', 404)
  if (!ctx.onboarding.employee_code) return bad('Generate the employee code first — the appointment letter follows it.', 409)
  const draft = cleanDraft(b.draft, ctx.draft)
  const problems = apptProblems(draft.fields)
  if (problems.length) return bad(`Fill in ${problems.join(', ')}.`)

  let pdf: { name: string; content: Buffer }
  try { pdf = await appointmentLetterPdf(ctx.company, draft) }
  catch (e: any) { console.error('appointment letter PDF failed', e); return bad(`Could not draw the letter: ${e?.message || 'PDF error'}`, 500) }

  if (b.action === 'preview') {
    return new Response(new Uint8Array(pdf.content), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name}"`, 'Cache-Control': 'no-store' } })
  }
  if (b.action !== 'send') return bad("action must be 'preview' or 'send'")

  const to = String(b.to || '').trim()
  if (!EMAIL.test(to)) return bad('Give the candidate’s email address.')
  const cc = String(b.cc || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
  if (cc.some(x => !EMAIL.test(x))) return bad('One of the CC addresses is not an email.')
  const subject = String(b.subject || '').trim().slice(0, 200)
  const text = String(b.body || '').trim().slice(0, 5000)
  if (!subject || !text) return bad('The email needs a subject and a message.')

  const r = await sendMail({ to, cc, subject, text, html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'), attachments: [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }] })
  const { user } = gate
  const { data: me } = user.employeeId ? await sb.from('employees').select('full_name, emp_code').eq('id', user.employeeId).maybeSingle() : { data: null as any }
  const byName = me ? `${me.full_name}${me.emp_code ? ` (${me.emp_code})` : ''}` : user.email || 'HR'
  await sb.from('onboarding_notifications').insert({
    onboarding_id: id, recipient_type: 'CANDIDATE', channel: 'EMAIL', subject, body: `Letter of Appointment (${pdf.name}) to ${to}`,
    status: r.sent ? 'SENT' : 'FAILED', sent_at: r.sent ? new Date().toISOString() : null,
  }).then(() => null, () => null)
  if (r.skipped) return bad(`${MAIL_NOT_CONFIGURED} Set GMAIL_USER and GMAIL_APP_PASSWORD.`, 502)
  if (!r.sent) return bad(r.error || 'The email could not be sent.', 502)
  await sb.from('onboarding_audit_log').insert({
    onboarding_id: id, action: 'APPOINTMENT_LETTER_SENT', actor_type: 'HR', actor_id: user.employeeId || null,
    details: { to, cc, by_name: byName, employee_code: ctx.onboarding.employee_code, ctc_annual: draft.fields.ctc_annual, doj: draft.fields.doj },
  }).then(() => null, () => null)
  const essError = ctx.onboarding.employee_id
    ? await saveToEss({ employeeId: ctx.onboarding.employee_id, companyId: ctx.company?.id || null, pdf, by: user.employeeId || null, byName, to,
        companyCode: ctx.company?.company_code || null, empCode: ctx.onboarding.employee_code, fields: draft.fields }).catch((e: any) => e?.message || 'could not save')
    : 'there is no employee record yet'
  return NextResponse.json({ ok: true, sent_to: to, ess_saved: !essError, ess_error: essError, last_sent: { at: new Date().toISOString(), to, by: byName } })
}
