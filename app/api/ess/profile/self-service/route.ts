// app/api/ess/profile/self-service/route.ts — the structured editors behind
// "Fix" and "Edit profile".
//
//   GET  ?scope=documents                 -> what is on file, and what is asked for
//   POST multipart { payload: JSON, file? }
//        payload.action is one of:
//          identity   { kind: 'aadhaar'|'pan'|'uan', number }   saves (if blank)
//          address    { which: 'present'|'permanent', address, reason? }
//                                       blank -> saves; on file -> request to HR
//          emergency  { slot: 1|2, name, relation, mobile }    saves
//          nominees   { scheme: 'pf'|'gratuity', rows[] }     saves (total 100%)
//          bank       { bank_name, account, ifsc, holder, reason? } request to Payroll
//          document   { doc_type }                             uploads, HR verifies
//
// The rule each action follows is written out at the top of
// lib/profile/self-service.ts. Every write is to the CALLER's own record,
// resolved from a signed session by writer() — no employee id is read from the
// request — and every value is validated here again, whatever the browser did.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import {
  checkAadhaar, checkPan, checkUan, checkAddress, formatAddress, checkEmergency, normaliseMobile,
  formatEmergency, checkNominees, checkBank, formatBank, PROFILE_DOCS, DOC_TYPES_OK, DOC_MAX_BYTES,
  ID_DOC, SCHEME_LABEL, type Address, type NomineeRow,
} from '@/lib/profile/self-service'
import {
  bad, writer, storeDocument, compositeOldValue, notifyFirstApprover, waitingOn, approversFor, DOC_BUCKET,
} from '@/lib/profile/server'
import { docLabel } from '@/lib/onboarding/corrections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const str = (v: unknown) => (typeof v === 'string' ? v : '').trim()

// ── GET: documents ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Documents are personal. Not readable through here in view-as or from the
  // shared dashboard login — the HR screens own that — hence writer().
  const w = await writer(req)
  if (w.error) return w.error
  const me = w.me

  const [mine, onb] = await Promise.all([
    sb.from('employee_documents')
      .select('id, doc_type, doc_name, status, file_path, file_url, mime_type, uploaded_at, verified, verified_at, remarks, created_at')
      .eq('employee_id', me).order('created_at', { ascending: false }),
    sb.from('onboarding_candidates').select('id').eq('employee_id', me).limit(1),
  ])
  if (mine.error) return bad(mine.error.message, 500)

  let carried: Record<string, unknown>[] = []
  const onbId = (onb.data?.[0] as { id: string } | undefined)?.id
  if (onbId) {
    const { data } = await sb.from('onboarding_documents')
      .select('id, doc_code, file_name, storage_path, mime_type, hr_verified, hr_notes, hr_reviewed_at, uploaded_at')
      .eq('onboarding_id', onbId)
    carried = (data ?? []) as Record<string, unknown>[]
  }

  const sign = async (p: unknown) => {
    if (!p) return null
    const { data } = await sb.storage.from(DOC_BUCKET).createSignedUrl(String(p), 60 * 30)
    return data?.signedUrl ?? null
  }

  const docs = await Promise.all([
    ...((mine.data ?? []) as Record<string, unknown>[])
      .filter(d => d.status !== 'superseded')
      .map(async d => ({
        id: d.id, doc_type: d.doc_type, label: d.doc_name || docLabel(String(d.doc_type)),
        status: d.verified ? 'verified' : String(d.status ?? 'uploaded'),
        uploaded_at: d.uploaded_at ?? d.created_at, remarks: d.remarks ?? null,
        source: 'profile', url: await sign(d.file_path ?? d.file_url),
      })),
    ...carried.map(async d => ({
      id: d.id, doc_type: d.doc_code, label: docLabel(String(d.doc_code)),
      status: d.hr_verified ? 'verified' : d.hr_reviewed_at ? 'rejected' : 'uploaded',
      uploaded_at: d.uploaded_at, remarks: d.hr_notes ?? null,
      source: 'onboarding', url: await sign(d.storage_path),
    })),
  ])

  return NextResponse.json({ ok: true, required: PROFILE_DOCS, documents: docs })
}

// ── POST ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const w = await writer(req)
  if (w.error) return w.error
  const me = w.me

  let payload: Record<string, unknown> = {}
  let file: File | null = null
  try {
    const form = await req.formData()
    payload = JSON.parse(String(form.get('payload') ?? '{}'))
    const f = form.get('file')
    file = f && typeof f === 'object' && 'arrayBuffer' in f && (f as File).size > 0 ? f as File : null
  } catch {
    return bad('The form could not be read. Please try again.')
  }
  if (file) {
    if (file.size > DOC_MAX_BYTES) return bad('That file is over 5 MB. A phone photo or a scanned PDF is plenty.')
    if (file.type && !DOC_TYPES_OK.includes(file.type)) return bad('Upload a PDF, JPG, PNG or WebP.')
  }

  const { data: empRow } = await sb.from('employees')
    .select('id, company_id, full_name, aadhar_last4, pan_number, uan_number, res_address1, perm_address1')
    .eq('id', me).maybeSingle()
  if (!empRow) return bad('Your employee record could not be found.', 404)
  const emp = empRow as Record<string, string | null>
  const companyId = emp.company_id ?? w.companyId

  switch (String(payload.action ?? '')) {
    case 'identity':  return identity(me, companyId, emp, payload, file)
    case 'address':   return address(me, emp, payload)
    case 'emergency': return emergency(me, payload)
    case 'nominees':  return nominees(me, companyId, payload)
    case 'bank':      return bank(me, companyId, emp, payload, file)
    case 'document':  return uploadDoc(me, companyId, payload, file)
  }
  return bad('Unknown action.')
}

// ── identity numbers ─────────────────────────────────────────────────────

const ID_COLUMN = { aadhaar: 'aadhar_last4', pan: 'pan_number', uan: 'uan_number' } as const
const ID_LABEL = { aadhaar: 'Aadhaar', pan: 'PAN', uan: 'UAN' } as const

async function identity(me: string, companyId: string | null, emp: Record<string, string | null>,
                        p: Record<string, unknown>, file: File | null) {
  const kind = str(p.kind) as keyof typeof ID_COLUMN
  if (!(kind in ID_COLUMN)) return bad('Which number is this?')
  const raw = str(p.number)
  const err = kind === 'aadhaar' ? checkAadhaar(raw) : kind === 'pan' ? checkPan(raw) : checkUan(raw)
  if (err) return bad(err)

  const clean = raw.replace(/[\s-]/g, '').toUpperCase()
  // Only the last four of an Aadhaar is ever stored on the employee row —
  // 091's schema, and the Aadhaar Act's expectation. The card itself, if you
  // upload it, sits in a private bucket for HR to verify.
  const value = kind === 'aadhaar' ? clean.slice(-4) : clean
  const col = ID_COLUMN[kind]
  const current = String(emp[col] ?? '').trim().toUpperCase()

  if (current && current !== value) {
    return bad(`Your ${ID_LABEL[kind]} is already on file. If it is wrong, ask HR to correct it. `
             + `A number already used for payroll and returns is not changed from here.`, 409)
  }

  if (!current) {
    if (kind !== 'aadhaar') {
      // A PAN or UAN belongs to one person. Two records sharing one is a data
      // error HR has to untangle, so it is stopped here rather than created.
      const { data: dup } = await sb.from('employees').select('id').eq(col, value).neq('id', me).limit(1)
      if (dup?.length) return bad(`That ${ID_LABEL[kind]} is already on another employee's record. Please contact HR.`, 409)
    }
    const { error } = await sb.from('employees').update({ [col]: value }).eq('id', me)
    if (error) return bad(error.message, 500)
  }

  let docNote = ''
  if (file) {
    const s = await storeDocument({ employeeId: me, companyId, docType: ID_DOC[kind], label: docLabel(ID_DOC[kind]), file })
    if (s.error) return bad(`${ID_LABEL[kind]} saved, but ${s.error}`, 500)
    docNote = ' The card is with HR for verification.'
  }
  return NextResponse.json({ ok: true, message: `${ID_LABEL[kind]} saved.${docNote}` })
}

// ── address ──────────────────────────────────────────────────────────────

async function address(me: string, emp: Record<string, string | null>, p: Record<string, unknown>) {
  const which = str(p.which) === 'permanent' ? 'permanent' : 'present'
  const a0 = (p.address ?? {}) as Record<string, unknown>
  const a: Address = { line1: str(a0.line1), line2: str(a0.line2), city: str(a0.city), state: str(a0.state), pin: str(a0.pin) }
  const err = checkAddress(a)
  if (err) return bad(err)

  const prefix = which === 'present' ? 'res' : 'perm'
  const key = `${which}_address`
  const label = which === 'present' ? 'Present address' : 'Permanent address'
  const patch = { [`${prefix}_address1`]: a.line1, [`${prefix}_address2`]: a.line2 || null,
                  [`${prefix}_city`]: a.city, [`${prefix}_state`]: a.state, [`${prefix}_pin`]: a.pin }

  // Filling a blank is yours to do. Nothing downstream was computed from an
  // address that did not exist, so there is nothing for HR to re-check.
  if (!String(emp[`${prefix}_address1`] ?? '').trim()) {
    const { error } = await sb.from('employees').update(patch).eq('id', me)
    if (error) return bad(error.message, 500)
    return NextResponse.json({ ok: true, message: `${label} saved.` })
  }

  // Changing one that is on file moves Professional Tax state and HRA
  // exemption, so it goes through 105's HR chain like before — routed by the
  // database (raise_profile_change_request), not decided here.
  const reason = str(p.reason)
  if (!reason) return bad('A reason is required. HR reads it when they review the change.')
  const old = await compositeOldValue(me, key)
  const nv = formatAddress(a)
  if (old && old === nv) return bad('That is the address already on file.')

  const pending = await sb.from('profile_change_requests').select('id')
    .eq('employee_id', me).eq('field_key', key).in('status', ['pending_l1', 'pending_hr', 'pending_payroll']).limit(1)
  if (pending.data?.length) return bad(`You already have a ${label.toLowerCase()} change waiting. Withdraw it from Change history to send a new one.`, 409)

  const { data: id, error } = await sb.rpc('raise_profile_change_request', {
    p_employee_id: me, p_requested_by: me, p_field_key: key,
    p_field_label: label, p_new_value: nv, p_reason: reason,
  })
  if (error) {
    if (/not configured/i.test(error.message)) {
      return bad(`${label} has no approval route configured yet (migration 101 seeds it).`, 503)
    }
    return bad(error.message, 500)
  }
  // 091 reads only address line 1 as the "from" value. The approver should see
  // the whole address being replaced, in the same shape as the new one.
  if (old) await sb.from('profile_change_requests').update({ old_value: old }).eq('id', id as string)
  return requested(me, id as string, label, String(emp.full_name ?? 'An employee'))
}

async function requested(me: string, id: string, label: string, who: string) {
  const { data } = await sb.from('profile_change_requests').select('status').eq('id', id).maybeSingle()
  const status = String((data as { status?: string } | null)?.status ?? 'pending_hr')
  const a = await approversFor(me)
  await notifyFirstApprover(me, status, label, who)
  return NextResponse.json({ ok: true, request_id: id, status, waiting_on: waitingOn(status, a),
    message: `Sent. Waiting on ${waitingOn(status, a) ?? 'review'}.` })
}

// ── emergency contact ────────────────────────────────────────────────────

async function emergency(me: string, p: Record<string, unknown>) {
  const slot = Number(p.slot) === 2 ? 2 : 1
  const e = { name: str(p.name), relation: str(p.relation), mobile: str(p.mobile) }
  const err = checkEmergency(e)
  if (err) return bad(err)
  e.mobile = normaliseMobile(e.mobile).value!
  // The single text column the profile, the ID card and completeness read,
  // plus the structured columns the employee master already has.
  const patch = slot === 1
    ? { emergency_contact_1: formatEmergency(e), emergency_name: e.name, emergency_relation: e.relation, emergency_mobile: e.mobile }
    : { emergency_contact_2: formatEmergency(e), emergency2_name: e.name, emergency2_relation: e.relation, emergency2_mobile: e.mobile }
  const { error } = await sb.from('employees').update(patch).eq('id', me)
  if (error) return bad(error.message, 500)
  return NextResponse.json({ ok: true, message: 'Emergency contact saved.' })
}

// ── nominees ─────────────────────────────────────────────────────────────

async function nominees(me: string, companyId: string | null, p: Record<string, unknown>) {
  const scheme = str(p.scheme)
  if (scheme !== 'pf' && scheme !== 'gratuity') return bad('Which nomination is this?')
  if (!companyId) return bad('Your record has no company, so a nomination cannot be filed. Please contact HR.', 409)
  const rows: NomineeRow[] = (Array.isArray(p.rows) ? p.rows : []).map((r: Record<string, unknown>) => ({
    name: str(r.name), relation: str(r.relation), dob: str(r.dob), share: String(r.share ?? ''),
  }))
  const err = checkNominees(rows)
  if (err) return bad(err)

  // A nominee is a family member. employee_nominations has no date of birth
  // (091) — the family record does, and Form 2 needs it for a minor — so each
  // nominee is matched to, or added as, a family member and linked by id.
  const { data: fam } = await sb.from('employee_family_members')
    .select('id, member_name, relation, date_of_birth').eq('employee_id', me)
  const family = (fam ?? []) as { id: string; member_name: string; relation: string; date_of_birth: string | null }[]
  const memberIds: string[] = []
  for (const r of rows) {
    const hit = family.find(f => f.member_name.trim().toLowerCase() === r.name.toLowerCase()
                              && f.relation.toLowerCase() === r.relation.toLowerCase())
    if (hit) {
      if (r.dob && !hit.date_of_birth) await sb.from('employee_family_members').update({ date_of_birth: r.dob }).eq('id', hit.id)
      memberIds.push(hit.id)
      continue
    }
    const { data: m, error } = await sb.from('employee_family_members').insert({
      company_id: companyId, employee_id: me, member_name: r.name, relation: r.relation, date_of_birth: r.dob || null,
    }).select('id').single()
    if (error || !m) return bad(`Could not add ${r.name} to your family details: ${error?.message ?? 'unknown error'}`, 500)
    memberIds.push((m as { id: string }).id)
  }

  // Replace the scheme's set as a whole. The share trigger (091) refuses a
  // total above 100, so the old rows go first; if the new insert fails they
  // are put back, so a failed save never leaves you with no nominee.
  const { data: old } = await sb.from('employee_nominations').select('*').eq('employee_id', me).eq('scheme', scheme)
  const del = await sb.from('employee_nominations').delete().eq('employee_id', me).eq('scheme', scheme)
  if (del.error) return bad(del.error.message, 500)
  const ins = await sb.from('employee_nominations').insert(rows.map((r, i) => ({
    company_id: companyId, employee_id: me, scheme, member_id: memberIds[i],
    nominee_name: r.name, relation: r.relation, share_percent: Number(r.share), is_filed: false,
  })))
  if (ins.error) {
    if (old?.length) await sb.from('employee_nominations').insert(old)
    return bad(ins.error.message, 500)
  }
  return NextResponse.json({ ok: true, message: `${SCHEME_LABEL[scheme]} nominees saved. HR files the form.` })
}

// ── salary account ───────────────────────────────────────────────────────

async function bank(me: string, companyId: string | null, emp: Record<string, string | null>,
                    p: Record<string, unknown>, file: File | null) {
  const b = { bank_name: str(p.bank_name), account: str(p.account).replace(/[\s-]/g, ''),
              ifsc: str(p.ifsc).toUpperCase(), holder: str(p.holder) }
  const err = checkBank(b)
  if (err) return bad(err)
  if (!companyId) return bad('Your record has no company, so this cannot be routed. Please contact HR.', 409)

  const pending = await sb.from('profile_change_requests').select('id')
    .eq('employee_id', me).in('field_key', ['salary_account', 'bank_name', 'ifsc', 'bank_holder_name'])
    .in('status', ['pending_l1', 'pending_hr', 'pending_payroll']).limit(1)
  if (pending.data?.length) return bad('A salary account change is already waiting with Payroll. Withdraw it from Change history to send a new one.', 409)

  let attachment: string | null = null
  if (file) {
    const s = await storeDocument({ employeeId: me, companyId, docType: 'BANK_PROOF', label: docLabel('BANK_PROOF'), file })
    if (s.error) return bad(s.error, 500)
    attachment = s.path
  }

  // Filed directly rather than through raise_profile_change_request: the
  // account number has no profile_field_config row (101 seeds bank name, IFSC
  // and holder separately), and one account is one decision — four separate
  // requests could be half-approved into an account that does not exist. The
  // stage is the one 105 gives every payroll-routed field: Payroll, single step.
  const { data: row, error } = await sb.from('profile_change_requests').insert({
    company_id: companyId, employee_id: me, field_key: 'salary_account', field_label: 'Salary account',
    old_value: await compositeOldValue(me, 'salary_account'), new_value: formatBank(b),
    reason: str(p.reason) || 'Salary account update', route_to: 'payroll', status: 'pending_payroll',
    requested_by: me, attachment_path: attachment,
  }).select('id').single()
  if (error || !row) return bad(error?.message ?? 'The request could not be filed.', 500)
  return requested(me, (row as { id: string }).id, 'Salary account', String(emp.full_name ?? 'An employee'))
}

// ── a document on its own ────────────────────────────────────────────────

async function uploadDoc(me: string, companyId: string | null, p: Record<string, unknown>, file: File | null) {
  const docType = str(p.doc_type)
  const def = PROFILE_DOCS.find(d => d.code === docType)
  if (!def) return bad('Unknown document type.')
  if (!file) return bad('Choose a file to upload.')
  const s = await storeDocument({ employeeId: me, companyId, docType, label: def.label, file })
  if (s.error) return bad(s.error, 500)
  return NextResponse.json({ ok: true, message: `${def.label} uploaded. HR will verify it.` })
}
