// lib/onboarding/create-employee.ts — SERVER ONLY.
//
// The one place an onboarding becomes an employee: the code is reserved atomically
// (get_next_employee_code, migration 031), the employees row is written
// (onboardingToEmployee), the enrolment/notification/audit rows follow, and the joiner is
// mailed their acknowledgement pack. Called from two places:
//   - lib/onboarding/approvals.ts, automatically, when the fourth team approves
//   - app/api/onboarding/generate-code (HR's manual path, which may type a custom code)
//
// The employee row IS the outcome. If it cannot be written, the onboarding goes back to
// HR review (the reserved number is never reused) and the caller gets the reason.

import { onboardingToEmployee } from './to-employee'
import { buildEmpCode, isValidEmpCode, TYPE_SUFFIX } from '@/lib/employee-code'
import { sendAckEmail } from './ack-email'
import { renderEmail, onboardingScope } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

export interface CreateResult {
  ok: boolean; employee_code?: string; employee_id?: string | null; error?: string; status?: number
  employee_synced?: boolean; docs_emailed?: boolean; dept_matched?: boolean | null; sync_error?: string | null
}

export async function createEmployeeFromOnboarding(supa: any, o: { onboardingId: string; customCode?: string | null; by?: string | null; notes?: string | null; actorType?: 'HR' | 'SYSTEM' }): Promise<CreateResult> {
  const { data: cand, error } = await supa.from('onboarding_candidates')
    .select('id, company_id, employment_type, full_name, email, designation, status')
    .eq('id', o.onboardingId).single()
  if (error || !cand) return { ok: false, error: 'Onboarding record not found', status: 404 }
  if (cand.status === 'EMPLOYEE_CREATED') return { ok: false, error: 'Employee code already generated', status: 409 }
  if (!['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(cand.status)) return { ok: false, error: 'Form not yet submitted by candidate — onboarding incomplete', status: 400 }

  const { data: company } = await supa.from('companies').select('company_code').eq('id', cand.company_id).single()
  const companyCode = (company?.company_code || 'EZ').toUpperCase()
  const employmentType = cand.employment_type || 'Employee'
  const suffix = TYPE_SUFFIX[employmentType] ?? ''
  const autoPattern = new RegExp(`^${companyCode}${suffix}\\d{4}$`)

  // A code typed by HR that is not the auto pattern is honoured; otherwise a fresh number is
  // reserved atomically. Either way numbers are never reused.
  const submitted = (o.customCode || '').trim().toUpperCase()
  const isCustom = submitted.length > 0 && !autoPattern.test(submitted)
  let finalCode: string
  if (isCustom) finalCode = submitted
  else {
    const { data: nextSeq, error: seqErr } = await supa.rpc('get_next_employee_code', { p_company_id: cand.company_id, p_employment_type: employmentType })
    if (seqErr) return { ok: false, error: 'Sequence error: ' + seqErr.message, status: 500 }
    finalCode = buildEmpCode(companyCode, employmentType, nextSeq as number)
  }
  if (!isValidEmpCode(finalCode)) return { ok: false, error: `Invalid format: "${finalCode}". Expected e.g. SSM0001 or SSMINT0001`, status: 400 }

  const [empCheck, candCheck] = await Promise.all([
    supa.from('employees').select('id').eq('emp_code', finalCode).maybeSingle(),
    supa.from('onboarding_candidates').select('id').eq('employee_code', finalCode).neq('id', o.onboardingId).maybeSingle(),
  ])
  if (empCheck.data) return { ok: false, error: `${finalCode} already exists in employees.`, status: 409 }
  if (candCheck.data) return { ok: false, error: `${finalCode} already assigned to another candidate.`, status: 409 }

  const { error: updateErr } = await supa.from('onboarding_candidates').update({
    status: 'EMPLOYEE_CREATED', employee_code: finalCode,
    hr_reviewed_at: new Date().toISOString(), hr_reviewed_by: o.by || null, hr_notes: o.notes || null,
  }).eq('id', o.onboardingId)
  if (updateErr) return { ok: false, error: updateErr.message, status: 500 }

  let sync: any = { ok: false }
  try { sync = await onboardingToEmployee(supa, o.onboardingId, finalCode) }
  catch (e: any) { sync = { error: e?.message || 'sync failed' } }
  if (!sync.ok) {
    const why = sync.error || 'employee record could not be created'
    await supa.from('onboarding_candidates').update({ status: 'HR_REVIEW', employee_code: null, hr_notes: `Employee creation failed (${finalCode}): ${why}` }).eq('id', o.onboardingId)
    await supa.from('onboarding_audit_log').insert({ onboarding_id: o.onboardingId, action: 'EMPLOYEE_SYNC_FAILED', actor_type: o.actorType || 'HR', actor_id: o.by || null, details: { employee_code: finalCode, error: why } })
    return { ok: false, employee_code: finalCode, employee_synced: false, sync_error: why, status: 500, error: `Employee record could not be created: ${why}. The onboarding is back in HR review — fix the data and generate the code again.` }
  }

  await supa.from('onboarding_statutory_enrollment').update({ enrolled_at: new Date().toISOString(), enrolled_by: o.by || null }).eq('onboarding_id', o.onboardingId)
  // "Welcome — your Employee ID" (Configuration → Onboarding). Sent for real, and the log
  // records what happened rather than an unconditional SENT.
  try {
    const scope = await onboardingScope(o.onboardingId)
    const { data: co } = scope.companyId ? await supa.from('companies').select('company_name').eq('id', scope.companyId).maybeSingle() : { data: null }
    const welcome = await renderEmail('onboarding.employee_id', scope, { candidate_name: cand.full_name, employee_code: finalCode, company_name: co?.company_name || '' })
    const welcomeSent = cand.email
      ? await sendMail({ to: cand.email, subject: welcome.subject, text: welcome.text, html: welcome.html })
      : { sent: false, skipped: 'candidate has no email' }
    await supa.from('onboarding_notifications').insert({
      onboarding_id: o.onboardingId, recipient_type: 'CANDIDATE', channel: 'EMAIL',
      subject: welcome.subject, body: welcome.text,
      status: welcomeSent.sent ? 'SENT' : 'FAILED', sent_at: welcomeSent.sent ? new Date().toISOString() : null,
    })
  } catch (e) { console.error('employee-id welcome mail failed', e) }
  await supa.from('onboarding_audit_log').insert({
    onboarding_id: o.onboardingId, action: 'EMPLOYEE_CODE_GENERATED', actor_type: o.actorType || 'HR', actor_id: o.by || null,
    details: { employee_code: finalCode, employment_type: employmentType, company_id: cand.company_id, employee_synced: true, sync_error: null },
  })
  let docsEmailed = false
  try { const r = await sendAckEmail(supa, o.onboardingId, finalCode); docsEmailed = !!r.ok } catch { /* never block code gen */ }

  return { ok: true, employee_code: finalCode, employee_id: sync.employee_id || null, employee_synced: true, docs_emailed: docsEmailed, dept_matched: sync.dept_matched ?? null, sync_error: null }
}
