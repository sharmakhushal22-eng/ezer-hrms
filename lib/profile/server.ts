// lib/profile/server.ts — server-only helpers for the profile's self-service.
//
// Everything here runs with the service key and is called from an API route
// that has ALREADY resolved the caller with essRoute and refused view-as. No
// function here takes an employee id from the browser.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, notify } from '@/lib/ess/session'
import {
  parseAddress, parseBank, parseEmergency, addressOneLine, formatAddress,
  type Address, type Approvers, type Person, type Emergency,
} from './self-service'

export const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

/** The caller, for a WRITE. Your own record only, from a signed session — the
 *  shared dashboard login and "view as" are refused, exactly as the existing
 *  edit route refuses them, because the change would be filed as somebody
 *  else. */
export async function writer(req: NextRequest): Promise<{ me: string; companyId: string | null; error: null } | { me: null; companyId: null; error: NextResponse }> {
  const { ctx, error } = await essRoute(req)
  if (error) return { me: null, companyId: null, error }
  if (ctx.caller.viewAs) {
    return { me: null, companyId: null, error: bad(ctx.caller.actorEmployeeId === null
      ? 'This session is the shared dashboard login, which is not attached to an employee '
        + 'record. Sign in with your own ESS account to change a profile.'
      : 'You are viewing somebody else\'s portal, so this would be recorded as them. '
        + 'Open your own portal to change your details.', 403) }
  }
  return { me: ctx.caller.employeeId, companyId: ctx.companyId, error: null }
}

// ── who approves ─────────────────────────────────────────────────────────

async function people(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, Person>()
  if (!uniq.length) return out
  const { data } = await sb.from('employees').select('id, full_name, emp_code').in('id', uniq)
  for (const r of (data ?? []) as { id: string; full_name: string; emp_code: string | null }[]) {
    out.set(r.id, { name: r.full_name, code: r.emp_code })
  }
  return out
}

// 105's profile_change_can_act(): who may act at the HR and Payroll stages.
const HR_CODES = ['HR_MANAGER', 'HR_HEAD', 'HR_EXECUTIVE', 'BRANCH_HR', 'CHRO', 'ADMIN_COMPANY', 'ADMIN_SUPER', 'ALL_ACCESS']
const PAY_CODES = ['PAYROLL', 'PAYROLL_ADMIN', 'PAYROLL_MANAGER', 'ADMIN_SUPER', 'ALL_ACCESS']
const SUPER_CODES = ['ADMIN_SUPER', 'ALL_ACCESS']

/** Employees who hold any of these roles AND could act on this company's
 *  requests — 105 scopes everyone but a super admin to their own company. */
async function actors(codes: string[], companyId: string | null): Promise<{ id: string; rank: number }[]> {
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', codes)
  const roleCode = new Map(((roles ?? []) as { id: string; role_code: string }[]).map(r => [r.id, r.role_code]))
  if (!roleCode.size) return []
  const { data: ur } = await sb.from('ess_user_roles').select('ess_account_id, role_id')
    .in('role_id', [...roleCode.keys()]).eq('is_active', true)
  const byAcct = new Map<string, string[]>()
  for (const r of (ur ?? []) as { ess_account_id: string; role_id: string }[]) {
    byAcct.set(r.ess_account_id, [...(byAcct.get(r.ess_account_id) ?? []), roleCode.get(r.role_id)!])
  }
  if (!byAcct.size) return []
  const { data: accts } = await sb.from('ess_accounts').select('id, employee_id').in('id', [...byAcct.keys()])
  const empRoles = new Map<string, string[]>()
  for (const a of (accts ?? []) as { id: string; employee_id: string }[]) {
    empRoles.set(a.employee_id, [...(empRoles.get(a.employee_id) ?? []), ...(byAcct.get(a.id) ?? [])])
  }
  if (!empRoles.size) return []
  const { data: emps } = await sb.from('employees').select('id, company_id, date_of_leaving').in('id', [...empRoles.keys()])
  const today = new Date().toISOString().slice(0, 10)
  return ((emps ?? []) as { id: string; company_id: string | null; date_of_leaving: string | null }[])
    .filter(e => !e.date_of_leaving || e.date_of_leaving >= today)
    .map(e => {
      const rs = empRoles.get(e.id) ?? []
      const isSuper = rs.some(r => SUPER_CODES.includes(r))
      // A role holder in the same company is who would normally pick it up;
      // a group super admin can, but is the last person to name.
      return { id: e.id, rank: e.company_id === companyId ? (isSuper ? 1 : 0) : isSuper ? 2 : -1 }
    })
    .filter(e => e.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
}

/** The people a request from this employee would reach, by name.
 *
 *  105's profile_change_can_act() lets any HR-role holder in the company act at
 *  the HR stage, and any payroll-role holder at the payroll stage. Naming the
 *  whole pool helps nobody, so this names ONE person who can genuinely act:
 *  the HR person the employee record assigns (hr_manager_id, then hr_head_id,
 *  site_hr_id) or payroll_spoc_id — but only if they actually hold the role in
 *  this company; otherwise the first role holder who does. A name that cannot
 *  approve would send the employee chasing the wrong person. */
export async function approversFor(employeeId: string): Promise<Approvers> {
  const { data } = await sb.from('employees')
    .select('company_id, l1_manager_id, hr_manager_id, hr_head_id, site_hr_id, payroll_spoc_id')
    .eq('id', employeeId).maybeSingle()
  const e = (data ?? {}) as Record<string, string | null>
  const [hrPool, payPool] = await Promise.all([actors(HR_CODES, e.company_id), actors(PAY_CODES, e.company_id)])
  const pick = (assigned: (string | null)[], pool: { id: string }[]) => {
    const ok = new Set(pool.map(p => p.id))
    ok.delete(employeeId)                     // nobody approves their own change
    return assigned.find(id => id && ok.has(id)) ?? pool.find(p => p.id !== employeeId)?.id ?? null
  }
  const hrId = pick([e.hr_manager_id, e.hr_head_id, e.site_hr_id], hrPool)
  const payId = pick([e.payroll_spoc_id], payPool)
  const l1Id = e.l1_manager_id && e.l1_manager_id !== employeeId ? e.l1_manager_id : null
  const map = await people([l1Id, hrId, payId])
  return {
    l1: l1Id ? map.get(l1Id) ?? null : null,
    hr: hrId ? map.get(hrId) ?? null : null,
    payroll: payId ? map.get(payId) ?? null : null,
  }
}

/** "Waiting on Asha Rao (HR)", for a request at a given stage. */
export function waitingOn(status: string, a: Approvers): string | null {
  if (status === 'pending_l1')      return a.l1 ? `${a.l1.name} (line manager)` : 'Your line manager'
  if (status === 'pending_hr')      return a.hr ? `${a.hr.name} (HR)` : 'HR team'
  if (status === 'pending_payroll') return a.payroll ? `${a.payroll.name} (Payroll)` : 'Payroll team'
  return null
}

/** Tell the first approver something is waiting — the same person
 *  approversFor() names on screen. Best effort: a failed notification must
 *  never fail the request that was already filed. */
export async function notifyFirstApprover(employeeId: string, status: string, label: string, who: string) {
  try {
    const a = await approversFor(employeeId)
    const p = status === 'pending_l1' ? a.l1 : status === 'pending_payroll' ? a.payroll : a.hr
    if (!p?.code) return
    const { data } = await sb.from('employees').select('id').eq('emp_code', p.code).maybeSingle()
    const to = (data as { id: string } | null)?.id
    if (to && to !== employeeId) {
      await notify(to, `Profile change to review: ${label}`,
        `${who} asked to change their ${label.toLowerCase()}. Open My Profile to review it.`, '/ess', 'APPROVAL')
    }
  } catch { /* best effort */ }
}

// ── what the editors need to prefill ─────────────────────────────────────

export interface SelfExtras {
  addresses: { present: Address | null; permanent: Address | null }
  emergency: { 1: Emergency | null; 2: Emergency | null }
  ids: { has_pan: boolean; pan_masked: string | null; has_aadhaar: boolean; has_uan: boolean;
         has_bank: boolean; bank_masked: string | null }
  approvers: Approvers
}

const addr = (r: Record<string, unknown>, p: 'res' | 'perm'): Address | null => {
  const line1 = String(r[`${p}_address1`] ?? '').trim()
  if (!line1) return null
  return { line1, line2: String(r[`${p}_address2`] ?? '').trim(), city: String(r[`${p}_city`] ?? '').trim(),
           state: String(r[`${p}_state`] ?? '').trim(), pin: String(r[`${p}_pin`] ?? '').trim() }
}

/** Structured copies of the values the view flattens (091 concatenates the two
 *  address lines and drops city/state/PIN), plus masked identifiers the RPC
 *  strips for anyone but HR. Only ever attached to your OWN profile. */
export async function selfExtras(employeeId: string): Promise<SelfExtras> {
  const [{ data }, approvers] = await Promise.all([
    sb.from('employees').select(
      'res_address1, res_address2, res_city, res_state, res_pin, '
      + 'perm_address1, perm_address2, perm_city, perm_state, perm_pin, '
      + 'emergency_contact_1, emergency_contact_2, pan_number, aadhar_last4, uan_number, '
      + 'bank_account_last4').eq('id', employeeId).maybeSingle(),
    approversFor(employeeId),
  ])
  const r = (data ?? {}) as Record<string, unknown>
  const pan = String(r.pan_number ?? '').trim()
  const e1 = r.emergency_contact_1 ? parseEmergency(r.emergency_contact_1) : null
  const e2 = r.emergency_contact_2 ? parseEmergency(r.emergency_contact_2) : null
  return {
    addresses: { present: addr(r, 'res'), permanent: addr(r, 'perm') },
    emergency: { 1: e1, 2: e2 },
    ids: {
      has_pan: !!pan,
      // Your own PAN, but not in full: the screen is often on a shared monitor,
      // and 091 already decided the full value is HR's to read.
      pan_masked: pan ? `${'•'.repeat(Math.max(0, pan.length - 5))}${pan.slice(-5)}` : null,
      has_aadhaar: !!String(r.aadhar_last4 ?? '').trim(),
      has_uan: !!String(r.uan_number ?? '').trim(),
      has_bank: !!String(r.bank_account_last4 ?? '').trim(),
      bank_masked: r.bank_account_last4 ? `••••${r.bank_account_last4}` : null,
    },
    approvers,
  }
}

// ── composite change requests ────────────────────────────────────────────
//
// 091 gives a request ONE new_value and 105 applies it to ONE column. An
// address is five columns and a bank account four, so these three keys travel
// as readable lines (lib/profile/self-service formats them) and are applied
// here, on final approval, by the requests route — never by 105's
// profile_change_decide, which would write the whole block into one column.

export const COMPOSITE_KEYS = ['present_address', 'permanent_address', 'salary_account']

export function compositePatch(fieldKey: string, newValue: string): Record<string, unknown> | null {
  if (fieldKey === 'present_address' || fieldKey === 'permanent_address') {
    const a = parseAddress(newValue)
    if (!a) return null
    const p = fieldKey === 'present_address' ? 'res' : 'perm'
    return { [`${p}_address1`]: a.line1, [`${p}_address2`]: a.line2 || null,
             [`${p}_city`]: a.city, [`${p}_state`]: a.state, [`${p}_pin`]: a.pin }
  }
  if (fieldKey === 'salary_account') {
    const b = parseBank(newValue)
    if (!b) return null
    return {
      bank_name: b.bank_name, bank_account_number: b.account, bank_account_last4: b.account.slice(-4),
      // The same reversible encoding employees/bulk-upload writes. Not
      // encryption, and not claimed to be — kept so both paths agree.
      bank_account_encrypted: Buffer.from(b.account).toString('base64'),
      ifsc_code: b.ifsc, bank_holder_name: b.holder,
    }
  }
  return null
}

/** The current value of a composite key, as the approver should read it. */
export async function compositeOldValue(employeeId: string, fieldKey: string): Promise<string | null> {
  const { data } = await sb.from('employees').select(
    'res_address1, res_address2, res_city, res_state, res_pin, perm_address1, perm_address2, perm_city, '
    + 'perm_state, perm_pin, bank_name, bank_account_last4, ifsc_code, bank_holder_name').eq('id', employeeId).maybeSingle()
  const r = (data ?? {}) as Record<string, unknown>
  if (fieldKey === 'salary_account') {
    if (!r.bank_account_last4 && !r.bank_name) return null
    return [`Bank: ${r.bank_name ?? '-'}`, `Account: ••••${r.bank_account_last4 ?? '-'}`,
            `IFSC: ${r.ifsc_code ?? '-'}`, `Holder: ${r.bank_holder_name ?? '-'}`].join('\n')
  }
  const a = addr(r, fieldKey === 'present_address' ? 'res' : 'perm')
  return a ? (a.city && a.state && a.pin ? formatAddress(a) : addressOneLine(a)) : null
}

// ── documents ────────────────────────────────────────────────────────────

export const DOC_BUCKET = 'onboarding-docs'

/** Stores a document in the private bucket the onboarding portal already
 *  uses, under employees/<id>/, and records it as 'uploaded' — HR verifies it.
 *  An earlier copy of the same type is marked superseded, not deleted: a
 *  verified document is evidence and stays on file. */
export async function storeDocument(o: {
  employeeId: string; companyId: string | null; docType: string; label: string; file: File
}): Promise<{ id: string; path: string; error: null } | { id: null; path: null; error: string }> {
  const ext = (o.file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin'
  const path = `employees/${o.employeeId}/${o.docType}_${Date.now()}.${ext}`
  const buf = Buffer.from(await o.file.arrayBuffer())
  const up = await sb.storage.from(DOC_BUCKET).upload(path, buf, { contentType: o.file.type || 'application/octet-stream', upsert: false })
  if (up.error) return { id: null, path: null, error: `The file could not be stored: ${up.error.message}` }

  const { data: row, error } = await sb.from('employee_documents').insert({
    company_id: o.companyId, employee_id: o.employeeId, doc_type: o.docType, doc_name: o.label,
    file_path: path, file_url: path, file_size: o.file.size, file_size_kb: Math.ceil(o.file.size / 1024),
    mime_type: o.file.type || null, status: 'uploaded', uploaded_by: o.employeeId,
    uploaded_at: new Date().toISOString(), verified: false,
  }).select('id').single()
  if (error || !row) {
    await sb.storage.from(DOC_BUCKET).remove([path])
    return { id: null, path: null, error: error?.message ?? 'The document could not be recorded.' }
  }
  const id = (row as { id: string }).id
  await sb.from('employee_documents')
    .update({ status: 'superseded', superseded_by: id })
    .eq('employee_id', o.employeeId).eq('doc_type', o.docType).neq('id', id)
    .in('status', ['pending', 'uploaded', 'rejected', 'verified', 'expired'])
  return { id, path, error: null }
}
