// app/api/letters/studio/route.ts — People → Letters.
//
//   GET ?search=<code or name>            -> { employees }   in the companies the caller may issue letters in
//   GET ?employee_id=…                    -> { employee, values, onboarding_id }   the record's details for the form
//   GET ?pending=1                        -> { items }   coded joiners whose appointment letter has not gone out
//   GET ?recent=1                         -> { items }   the letters issued lately
//   POST { action: 'preview', type, employee_id, values }        -> application/pdf (nothing saved)
//   POST { action: 'send', type, employee_id, values, to? }      -> { ok, doc_id, ess, sent_to }
//
// The letters and their wording are lib/letters/catalog.ts; the record's details
// lib/letters/facts.ts; the PDF lib/letters/render-pdf.ts. A sent letter is stored (bucket
// generated-letters, generated_letters row with its document ID), mailed to the employee's
// registered address, and — for the letters the spec shows in ESS — released to ESS with a
// bell notification. Guarded by HR Letters (VIEW to look, EDIT to preview or send), in the
// companies the caller's roles are valid in.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { allowedCompanies } from '@/lib/rms/resolve'
import { sendMail } from '@/lib/mail/send'
import { LETTER_BY_CODE, missingFields, docIdFor, type Values } from '@/lib/letters/catalog'
import { employeeFacts } from '@/lib/letters/facts'
import { letterPdf } from '@/lib/letters/render-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const today = () => new Date().toISOString().slice(0, 10)

/** The companies the caller may issue letters in (null = every company). */
async function scopeOf(req: NextRequest): Promise<string[] | null> {
  const g = await grantForRequest(req)
  return g.crossCompany || g.isSuperAdmin || g.legacy || !g.companyId ? null : allowedCompanies(g, 'HR Letters')
}
const inScope = (scope: string[] | null, companyId: string | null) => !scope || (!!companyId && scope.includes(companyId))

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters')
  if (gate.error) return gate.error
  const sp = req.nextUrl.searchParams
  const scope = await scopeOf(req)

  if (sp.has('search')) {
    const q = String(sp.get('search') || '').trim().replace(/[%,()]/g, ' ')
    if (q.length < 2) return NextResponse.json({ employees: [] })
    let qq = sb.from('employees').select('id, emp_code, full_name, designation, employment_status, company_id, companies!employees_company_id_fkey(company_name)')
      .or(`emp_code.ilike.%${q}%,full_name.ilike.%${q}%`).neq('is_test', true).order('emp_code').limit(15)
    if (scope) qq = qq.in('company_id', scope)
    const { data } = await qq
    return NextResponse.json({ employees: ((data as any[]) || []).map(e => ({ id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation, status: e.employment_status, company: e.companies?.company_name || null })) })
  }

  if (sp.get('employee_id')) {
    const f = await employeeFacts(sb, String(sp.get('employee_id')))
    if (!f) return bad('Employee not found.', 404)
    if (!inScope(scope, f.employee.company_id)) return bad('This employee belongs to another company.', 403)
    return NextResponse.json({ employee: f.employee, values: f.values, onboarding_id: f.onboardingId })
  }

  if (sp.get('pending')) {
    let q = sb.from('onboarding_candidates').select('id, full_name, employee_code, employee_id, designation, date_of_joining, email, company_id, updated_at').eq('status', 'EMPLOYEE_CREATED').order('updated_at', { ascending: false }).limit(500)
    if (scope) q = q.in('company_id', scope)
    const { data: coded } = await q
    const ids = ((coded as any[]) || []).map(c => c.id)
    const sent = new Set<string>()
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from('onboarding_audit_log').select('onboarding_id').eq('action', 'APPOINTMENT_LETTER_SENT').in('onboarding_id', ids.slice(i, i + 150))
      for (const r of (data as any[]) || []) sent.add(r.onboarding_id)
    }
    const items = ((coded as any[]) || []).filter(c => !sent.has(c.id))
    return NextResponse.json({ items })
  }

  if (sp.get('recent')) {
    let q = sb.from('generated_letters').select('id, letter_name, letter_type, doc_id, letter_date, generated_at, emailed_at, published_to_ess_at, sent_to, generated_by_name, company_id, employees!generated_letters_employee_id_fkey(full_name, emp_code)')
      .order('generated_at', { ascending: false }).limit(40)
    if (scope) q = q.in('company_id', scope)
    let { data, error } = await q
    if (error) ({ data } = await sb.from('generated_letters').select('id, letter_name, letter_date, generated_at, emailed_at, published_to_ess_at, company_id').order('generated_at', { ascending: false }).limit(40) as any)
    return NextResponse.json({ items: data || [] })
  }
  return bad('Say what to fetch.')
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'HR Letters', 'EDIT')
  if (gate.error) return gate.error
  const b = await req.json().catch(() => ({}))
  const def = LETTER_BY_CODE[String(b.type || '')]
  if (!def) return bad('Pick the letter to send.')
  const f = await employeeFacts(sb, String(b.employee_id || ''))
  if (!f) return bad('Pick the employee.', 404)
  if (!inScope(await scopeOf(req), f.employee.company_id)) return bad('This employee belongs to another company.', 403)

  // The form's values over the record's; only the letter's own fields, trimmed and bounded.
  const values: Values = { ...f.values }
  for (const fld of def.fields) if (b.values && fld.key in b.values) values[fld.key] = String(b.values[fld.key] ?? '').slice(0, fld.type === 'textarea' ? 4000 : 300).trim()
  if (!values.company_name) values.company_name = f.company?.company_name || ''
  const missing = missingFields(def, values)
  if (missing.length) return bad(`Fill in ${missing.join(', ')}.`)

  // The next number for this employee, letter and day.
  const date = today()
  const prefix = docIdFor(def.code, f.company?.company_code || '', f.employee.emp_code || '', date, 0).replace(/-000$/, '')
  const { count } = await sb.from('generated_letters').select('id', { count: 'exact', head: true }).like('doc_id', `${prefix}-%`)
  const docId = docIdFor(def.code, f.company?.company_code || '', f.employee.emp_code || '', date, (count || 0) + 1)
  let pdf: { name: string; content: Buffer }
  try { pdf = await letterPdf({ company: f.company, def, doc: def.build(values), values, docId, date }) }
  catch (e: any) { console.error('letter PDF failed', e); return bad(`Could not draw the letter: ${e?.message || 'PDF error'}`, 500) }

  if (b.action === 'preview') {
    return new Response(new Uint8Array(pdf.content), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name}"`, 'Cache-Control': 'no-store' } })
  }
  if (b.action !== 'send') return bad("action must be 'preview' or 'send'")

  const to = String(b.to || f.employee.email || '').trim()
  if (!EMAIL.test(to)) return bad('The employee has no registered email. Enter the address to send it to.')
  const { user } = gate
  const { data: me } = user.employeeId ? await sb.from('employees').select('full_name, emp_code').eq('id', user.employeeId).maybeSingle() : { data: null as any }
  const byName = me ? `${me.full_name}${me.emp_code ? ` (${me.emp_code})` : ''}` : user.email || 'HR'
  const now = new Date().toISOString()

  // Stored first: a letter that cannot be kept is not sent.
  const path = `documents/${(f.company?.company_code || 'CO').replace(/[^A-Za-z0-9]/g, '')}/${(f.employee.emp_code || f.employee.id).replace(/[^A-Za-z0-9-]/g, '')}/${def.code}/${pdf.name}`
  const up = await sb.storage.from('generated-letters').upload(path, pdf.content, { contentType: 'application/pdf', upsert: false })
  if (up.error) return bad(`Could not store the letter: ${up.error.message}`, 500)
  const row = {
    template_id: null, letter_name: def.name, employee_id: f.employee.id, company_id: f.employee.company_id, file_url: path,
    letter_date: date, generated_by: user.employeeId || null, generated_at: now, published_to_ess_at: def.ess ? now : null,
  }
  let { data: ins, error } = await sb.from('generated_letters').insert({ ...row, letter_type: def.code, doc_id: docId, fields: values, sent_to: to, generated_by_name: byName }).select('id').single()
  if (error && /letter_type|doc_id|fields|sent_to|generated_by_name/.test(error.message)) {
    ({ data: ins, error } = await sb.from('generated_letters').insert(row).select('id').single())
  }
  if (error) { await sb.storage.from('generated-letters').remove([path]).then(() => null, () => null); return bad(error.message, 500) }

  const subject = `${def.name}${f.company?.company_name ? ` — ${f.company.company_name}` : ''}`
  const text = `Dear ${f.employee.full_name},\n\nPlease find attached your ${def.name} (${docId}).${def.ess ? ' A copy is also in your ESS portal under My Letters.' : ''}\n\nFor any clarification, reply to this email.\n\nRegards,\nHR Team\n${f.company?.company_name || ''}`.trim()
  const mail = await sendMail({ to, subject, text, html: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'), attachments: [{ filename: pdf.name, content: pdf.content, contentType: 'application/pdf' }] })
  if (mail.sent) await sb.from('generated_letters').update({ emailed_at: new Date().toISOString() }).eq('id', ins!.id).then(() => null, () => null)
  if (def.ess) await sb.from('ess_notifications').insert({ employee_id: f.employee.id, category: 'RECRUITMENT', title: `Your ${def.name}`, body: `Your ${def.name} is in Profile → My Letters.`, link: '/ess/letters', is_read: false }).then(() => null, () => null)
  // An appointment letter for a coded joiner takes them off Pending letters.
  if (def.code === 'APT' && f.onboardingId) {
    await sb.from('onboarding_audit_log').insert({ onboarding_id: f.onboardingId, action: 'APPOINTMENT_LETTER_SENT', actor_type: 'HR', actor_id: user.employeeId || null, details: { to, by_name: byName, doc_id: docId, via: 'People → Letters' } }).then(() => null, () => null)
  }
  await sb.from('ess_access_audit').insert({ action: 'LETTER_ISSUED', performed_by: user.employeeId || null, performed_by_name: byName, reason: def.name, details: { employee_id: f.employee.id, emp_code: f.employee.emp_code, doc_id: docId, letter_type: def.code, sent_to: to, emailed: mail.sent } }).then(() => null, () => null)
  return NextResponse.json({ ok: true, doc_id: docId, id: ins!.id, ess: def.ess, sent_to: to, emailed: !!mail.sent, mail_error: mail.sent ? null : (mail.error || mail.skipped || 'not sent') })
}
