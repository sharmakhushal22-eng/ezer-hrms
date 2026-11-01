// app/api/onboarding/appointment-letter/route.ts — the Letter of Appointment, once the joiner's
// employee code is generated (Onboarding → the joiner's row → Appointment letter).
//
//   GET  ?onboarding_id=… | ?employee_id=…   -> { draft, to, email, salary_source, last_sent }   the letter, auto-filled
//   POST { onboarding_id | employee_id, draft, action: 'preview' }                  -> application/pdf
//   POST { onboarding_id | employee_id, draft, action: 'send', to, cc?, subject, body, save_to_record? } -> { ok, sent_to, doc_id, record_saved }
//
// save_to_record: the details HR filled in that the record lacked are written to the employee
// (lib/letters/record-save — never over a value already there).
//
// employee_id is for People → Letters → Issue a letter: the same full letter for an employee,
// through their onboarding record when they have one, from the employee record alone when not.
// The caller must hold the employee's company in their role scope.
//
// The draft is whatever the HR Manager left in the popup (lib/onboarding/appointment-letter.ts);
// the PDF is drawn from it as is and mailed to the candidate. Every send is logged in
// onboarding_notifications and onboarding_audit_log, so the popup can say when it last went,
// and saved to the employee's ESS → Profile → My Letters (generated_letters, migration 200) with
// a bell notification; a re-send replaces the copy there.
// Guarded by the Onboarding module or the HR Letters module (People → Letters → Pending letters):
// VIEW to read, EDIT to preview or send.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { allowedCompanies } from '@/lib/rms/resolve'
import { requireModule } from '@/lib/api-auth'
import { sendMail, MAIL_NOT_CONFIGURED } from '@/lib/mail/send'
import { loadAppointment, appointmentLetterPdf } from '@/lib/onboarding/appointment-letter-server'
import { apptProblems, defaultEmail, type ApptDraft, type ApptFields } from '@/lib/onboarding/appointment-letter'
import { docIdFor } from '@/lib/letters/catalog'
import { saveFilledToRecord } from '@/lib/letters/record-save'

export const runtime = 'nodejs' // pdfkit + nodemailer
export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const LETTER_NAME = 'Letter of Appointment'

/** The sent letter into the employee's ESS → My Letters. Never blocks the send: what went
 *  wrong is reported back to the popup instead. */
async function saveToEss(o: { employeeId: string; companyId: string | null; pdf: { name: string; content: Buffer }; by: string | null; byName?: string | null; to?: string | null; docId: string; fields?: unknown; companyCode?: string | null; empCode?: string | null }): Promise<string | null> {
  const now = new Date().toISOString()
  const path = `documents/${(o.companyCode || 'CO').replace(/[^A-Za-z0-9]/g, '')}/${(o.empCode || o.employeeId).replace(/[^A-Za-z0-9-]/g, '')}/APT/${Date.now()}_${o.pdf.name}`
  const up = await sb.storage.from('generated-letters').upload(path, o.pdf.content, { contentType: 'application/pdf', upsert: false })
  if (up.error) return `the PDF could not be stored (${up.error.message})`
  // Only the latest appointment letter stays in My Letters.
  await sb.from('generated_letters').update({ published_to_ess_at: null }).eq('employee_id', o.employeeId).eq('letter_name', LETTER_NAME).not('published_to_ess_at', 'is', null)
  const row = {
    template_id: null, letter_name: LETTER_NAME, employee_id: o.employeeId, company_id: o.companyId, file_url: path,
    letter_date: now.slice(0, 10), generated_by: o.by, generated_at: now, emailed_at: now, published_to_ess_at: now,
  }
  // With the People → Letters columns (migration 204): APT and its document ID; without them before that.
  let { error } = await sb.from('generated_letters').insert({ ...row, letter_type: 'APT', doc_id: o.docId, sent_to: o.to || null, generated_by_name: o.byName || null, fields: o.fields ?? null })
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

/** The next document ID for this employee's appointment letter today (APT-{Co}-{Emp}-{YYYYMMDD}-{Seq}). */
async function nextDocId(companyCode: string, empCode: string) {
  const day = new Date().toISOString().slice(0, 10)
  const prefix = docIdFor('APT', companyCode, empCode, day, 0).replace(/-000$/, '')
  const { count } = await sb.from('generated_letters').select('id', { count: 'exact', head: true }).like('doc_id', `${prefix}-%`)
  return docIdFor('APT', companyCode, empCode, day, (count || 0) + 1)
}

/** The letter for the request's onboarding_id or employee_id, refused outside the caller's companies. */
async function contextFor(req: NextRequest, ref: { onboarding_id?: any; employee_id?: any }) {
  const onboardingId = String(ref.onboarding_id || ''), employeeId = String(ref.employee_id || '')
  if (!onboardingId && !employeeId) return { error: bad('onboarding_id or employee_id required') }
  const ctx = await loadAppointment(sb, onboardingId ? { onboardingId } : { employeeId })
  if (!ctx) return { error: bad(onboardingId ? 'Onboarding record not found.' : 'Employee not found.', 404) }
  if (!ctx.onboarding.employee_code) return { error: bad('Generate the employee code first — the appointment letter follows it.', 409) }
  const g = await grantForRequest(req)
  if (!(g.crossCompany || g.isSuperAdmin || g.legacy || !g.companyId)) {
    const scope = [...new Set([...allowedCompanies(g, 'HR Letters'), ...allowedCompanies(g, 'Onboarding')])]
    if (!ctx.onboarding.company_id || !scope.includes(ctx.onboarding.company_id)) return { error: bad('This employee belongs to another company.', 403) }
  }
  return { ctx }
}

async function lastSent(onboardingId: string | null) {
  if (!onboardingId) return null
  const { data } = await sb.from('onboarding_audit_log').select('created_at, details').eq('onboarding_id', onboardingId).eq('action', 'APPOINTMENT_LETTER_SENT').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data ? { at: data.created_at, to: (data.details as any)?.to || null, by: (data.details as any)?.by_name || null } : null
}

/** The draft from the browser, kept to the shape and sizes the PDF expects: every field takes
 *  the type of the loaded one (number, yes/no or text). */
function cleanDraft(raw: any, base: ApptDraft): ApptDraft {
  const str = (v: any, max = 300) => String(v ?? '').slice(0, max)
  const n = (v: any) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 ? x : 0 }
  const rf = raw?.fields || {}
  const fields = { ...base.fields } as Record<string, any>
  for (const [k, v] of Object.entries(base.fields)) {
    if (!(k in rf)) continue
    fields[k] = typeof v === 'number' ? n(rf[k]) : typeof v === 'boolean' ? !!rf[k] : str(rf[k], /address/.test(k) ? 400 : 200)
  }
  const sections = Array.isArray(raw?.sections) ? raw.sections.slice(0, 40).map((x: any) => ({ key: str(x?.key, 40), heading: str(x?.heading, 120), body: str(x?.body, 8000), inline: !!x?.inline })) : base.sections
  const KINDS = ['row', 'head', 'sum', 'total', 'ded', 'net', 'extra']
  const annexure = Array.isArray(raw?.annexure) ? raw.annexure.slice(0, 40).map((x: any) => ({ label: str(x?.label, 80), monthly: n(x?.monthly), annual: n(x?.annual), bold: !!x?.bold, kind: KINDS.includes(x?.kind) ? x.kind : 'row' })).filter((x: any) => x.label.trim()) : base.annexure
  return { fields: fields as ApptFields, sections, annexure }
}

export async function GET(req: NextRequest) {
  const gate = await gateFor(req, 'VIEW')
  if (gate.error) return gate.error
  const sp = req.nextUrl.searchParams
  const r = await contextFor(req, { onboarding_id: sp.get('onboarding_id'), employee_id: sp.get('employee_id') })
  if (r.error) return r.error
  const ctx = r.ctx
  return NextResponse.json({ draft: ctx.draft, to: ctx.to, email: defaultEmail(ctx.draft.fields), salary_source: ctx.salary_source, last_sent: await lastSent(ctx.onboarding.id), onboarding_id: ctx.onboarding.id })
}

export async function POST(req: NextRequest) {
  const gate = await gateFor(req, 'EDIT')
  if (gate.error) return gate.error
  const b = await req.json().catch(() => ({}))
  const r0 = await contextFor(req, b)
  if (r0.error) return r0.error
  const ctx = r0.ctx
  const id = ctx.onboarding.id
  const draft = cleanDraft(b.draft, ctx.draft)
  const problems = apptProblems(draft.fields)
  if (problems.length) return bad(`Fill in ${problems.join(', ')}.`)
  // The reference number printed on the letter: the next one on a send, a draft mark on a preview.
  const docId = await nextDocId(ctx.company?.company_code || '', ctx.onboarding.employee_code || '')
  draft.fields.ref_no = b.action === 'send' ? docId : `${docId} (draft)`

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
  if (id) await sb.from('onboarding_notifications').insert({
    onboarding_id: id, recipient_type: 'CANDIDATE', channel: 'EMAIL', subject, body: `Letter of Appointment (${pdf.name}) to ${to}`,
    status: r.sent ? 'SENT' : 'FAILED', sent_at: r.sent ? new Date().toISOString() : null,
  }).then(() => null, () => null)
  if (r.skipped) return bad(`${MAIL_NOT_CONFIGURED} Set GMAIL_USER and GMAIL_APP_PASSWORD.`, 502)
  if (!r.sent) return bad(r.error || 'The email could not be sent.', 502)
  if (id) await sb.from('onboarding_audit_log').insert({
    onboarding_id: id, action: 'APPOINTMENT_LETTER_SENT', actor_type: 'HR', actor_id: user.employeeId || null,
    details: { to, cc, by_name: byName, employee_code: ctx.onboarding.employee_code, ctc_annual: draft.fields.ctc_annual, doj: draft.fields.doj, doc_id: docId },
  }).then(() => null, () => null)
  await sb.from('ess_access_audit').insert({ action: 'LETTER_ISSUED', performed_by: user.employeeId || null, performed_by_name: byName, reason: LETTER_NAME, details: { employee_id: ctx.onboarding.employee_id, emp_code: ctx.onboarding.employee_code, doc_id: docId, letter_type: 'APT', sent_to: to, emailed: true } }).then(() => null, () => null)
  const essError = ctx.onboarding.employee_id
    ? await saveToEss({ employeeId: ctx.onboarding.employee_id, companyId: ctx.company?.id || null, pdf, by: user.employeeId || null, byName, to, docId,
        companyCode: ctx.company?.company_code || null, empCode: ctx.onboarding.employee_code, fields: draft.fields }).catch((e: any) => e?.message || 'could not save')
    : 'there is no employee record yet'
  // The details HR filled in, back to the employee record when they ticked the box.
  const record = b.save_to_record && ctx.onboarding.employee_id
    ? await saveFilledToRecord(sb, ctx.onboarding.employee_id, ctx.draft.fields as any, draft.fields as any).catch((e: any) => ({ saved: [] as string[], skipped: [String(e?.message || 'could not save')] }))
    : { saved: [] as string[], skipped: [] as string[] }
  if (record.saved.length) await sb.from('ess_access_audit').insert({ action: 'EMPLOYEE_UPDATED_FROM_LETTER', performed_by: user.employeeId || null, performed_by_name: byName, reason: LETTER_NAME, details: { employee_id: ctx.onboarding.employee_id, emp_code: ctx.onboarding.employee_code, saved: record.saved } }).then(() => null, () => null)
  return NextResponse.json({ ok: true, sent_to: to, doc_id: docId, record_saved: record.saved, record_skipped: record.skipped, ess_saved: !essError, ess_error: essError, last_sent: { at: new Date().toISOString(), to, by: byName } })
}
