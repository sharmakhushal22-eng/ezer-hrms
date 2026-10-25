// lib/exit/mail.ts — SERVER ONLY. The mails of the resignation chain, on top of the bell
// notifications: at every step the employee is told what happened and the approver who acted
// gets a confirmation; when HR sets the final last working day the employee gets the
// "approved — download your documents before your last day" mail. Words live in
// Configuration → Employee lifecycle (resignation.step_employee / step_approver / approved).

import type { SupabaseClient } from '@supabase/supabase-js'
import { renderEmail, employeeScope } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'

const fmt = (d?: string | null) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
const STAGE: Record<string, string> = { RM_L1: 'Reporting manager', RM_L2: 'L2 manager', HOD: 'Head of department', HR_MANAGER: 'HR Manager', EMPLOYEE: 'Employee' }
const ACTION: Record<string, string> = {
  STAMPED: 'is now waiting on', ACKNOWLEDGED: 'acknowledged and forwarded', ACCEPTED_WITH_DATE: 'accepted with a proposed last working day',
  REQUESTED_RETENTION: 'asked to talk before it moves on (retention)', RESUMED: 'resumed the chain', FINAL_LWD_SET: 'set the final last working day', WITHDRAWN: 'withdrew',
}

async function person(sb: SupabaseClient, id: string | null | undefined) {
  if (!id) return null
  const { data } = await sb.from('employees').select('id, full_name, emp_code, designation, office_email, personal_email').eq('id', id).maybeSingle()
  return data ? { ...data, email: (data.office_email || data.personal_email || null) as string | null } : null
}

/** One step of the chain: the employee hears what happened; the approver who acted gets a confirmation. */
export async function mailResignationStep(sb: SupabaseClient, o: { resignationId: string; stage: string; action: string; actorId: string | null; note?: string | null; lwd?: string | null; baseUrl?: string }): Promise<{ employee: boolean; approver: boolean }> {
  const out = { employee: false, approver: false }
  const { data: r } = await sb.from('employee_resignation').select('employee_id, status, current_stage, current_approver_id, date_of_resignation, lwd_as_per_policy, proposed_lwd, final_lwd').eq('id', o.resignationId).maybeSingle()
  if (!r) return out
  const [emp, actor, next] = await Promise.all([person(sb, r.employee_id), person(sb, o.actorId), person(sb, r.current_approver_id)])
  if (!emp) return out
  const base = o.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'
  const scope = await employeeScope(emp.id)
  const vars = {
    employee_name: emp.full_name, emp_code: emp.emp_code || '',
    stage: STAGE[o.stage] || o.stage, actor_name: actor?.full_name || 'HR', actor_code: actor?.emp_code || '',
    action: ACTION[o.action] || o.action.toLowerCase().replace(/_/g, ' '),
    // A submission (STAMPED) is told differently: nobody "acted", it is simply with the first approver now.
    is_stamp: o.action === 'STAMPED' ? 'yes' : '', is_hold: o.action === 'REQUESTED_RETENTION' ? 'yes' : '', has_note: o.note ? 'yes' : '',
    action_line: o.action === 'STAMPED' ? '' : `Your ${(STAGE[o.stage] || o.stage).toLowerCase()}, ${actor?.full_name || 'HR'}, ${ACTION[o.action] || o.action.toLowerCase().replace(/_/g, ' ')}${o.lwd ? ` (${fmt(o.lwd)})` : ''}.`,
    next_line: r.current_stage && o.action !== 'STAMPED' ? `It is now with your ${(STAGE[r.current_stage] || r.current_stage).toLowerCase()}${next?.full_name ? ` (${next.full_name})` : ''}.` : (o.action === 'FINAL_LWD_SET' ? 'The chain is complete.' : ''),
    headline: o.action === 'STAMPED' ? `received, now with your ${r.current_stage ? (STAGE[r.current_stage] || r.current_stage).toLowerCase() : 'manager'}` : o.action === 'FINAL_LWD_SET' ? `approved, last working day ${o.lwd ? fmt(o.lwd) : fmt(r.final_lwd)}` : `${(STAGE[o.stage] || o.stage).toLowerCase()} ${ACTION[o.action] || o.action.toLowerCase().replace(/_/g, ' ')}`,
    note: o.note || '', proposed_lwd: o.lwd ? fmt(o.lwd) : (r.proposed_lwd ? fmt(r.proposed_lwd) : ''),
    policy_lwd: fmt(r.lwd_as_per_policy), next_stage: r.current_stage ? (STAGE[r.current_stage] || r.current_stage) : '', next_approver: next?.full_name || '',
    status: String(r.status).replace(/_/g, ' ').toLowerCase(), portal_link: `${base}/ess`,
  }
  try {
    if (emp.email) { const m = await renderEmail('resignation.step_employee', scope, vars); out.employee = (await sendMail({ to: emp.email, subject: m.subject, text: m.text, html: m.html })).sent }
  } catch (e) { console.warn('resignation step mail (employee) failed', e) }
  try {
    if (actor?.email && actor.id !== emp.id) { const m = await renderEmail('resignation.step_approver', scope, { ...vars, headline: o.action === 'STAMPED' ? 'waiting on you' : 'your action is recorded', action_line: o.action === 'STAMPED' ? '' : `Your action on ${emp.full_name}'s (${emp.emp_code || ''}) resignation is recorded: you ${ACTION[o.action] || o.action.toLowerCase().replace(/_/g, ' ')}${o.lwd ? ` (${fmt(o.lwd)})` : ''}.`, next_line: r.current_stage && o.action !== 'STAMPED' ? `It has moved to the ${(STAGE[r.current_stage] || r.current_stage).toLowerCase()}${next?.full_name ? ` (${next.full_name})` : ''}.` : '' }); out.approver = (await sendMail({ to: actor.email, subject: m.subject, text: m.text, html: m.html })).sent }
  } catch (e) { console.warn('resignation step mail (approver) failed', e) }
  return out
}

/** The chain is complete: HR has set the final last working day. The employee is told to download what they need before the portal closes. */
export async function mailResignationApproved(sb: SupabaseClient, resignationId: string, baseUrl?: string): Promise<boolean> {
  const { data: r } = await sb.from('employee_resignation').select('employee_id, final_lwd, date_of_resignation, notice_shortfall_days, recovery_required, status').eq('id', resignationId).maybeSingle()
  if (!r?.final_lwd) return false
  const emp = await person(sb, r.employee_id)
  if (!emp?.email) return false
  const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com'
  try {
    const m = await renderEmail('resignation.approved', await employeeScope(emp.id), {
      employee_name: emp.full_name, emp_code: emp.emp_code || '', last_working_day: fmt(r.final_lwd), resignation_date: fmt(r.date_of_resignation),
      shortfall_note: Number(r.notice_shortfall_days) > 0 ? `Your last working day is ${r.notice_shortfall_days} day${Number(r.notice_shortfall_days) === 1 ? '' : 's'} short of the notice period; Payroll will work out the recovery in your full and final settlement.` : '',
      portal_link: `${base}/ess`,
    })
    return (await sendMail({ to: emp.email, subject: m.subject, text: m.text, html: m.html })).sent
  } catch (e) { console.warn('resignation approved mail failed', e); return false }
}
