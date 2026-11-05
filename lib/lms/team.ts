// lib/lms/team.ts — a manager's view. Server only.
//
// No module grant is involved: you are a manager because people report to you, so the reach
// comes from the org data, and it ends at your own reports.
import { allRows, audit, LmsError, must, notFound, sb, settingsFor } from './server'
import { notifyPerson } from './notify'
import type { LmsActor } from './access'
import { lmsCaps } from './caps'
import { emptyGrant } from '@/lib/rms/resolve'
import { createAssignment } from './assign'

export async function teamIds(employeeId: string): Promise<string[]> {
  const [{ data: reports }, { data: depts }] = await Promise.all([
    sb.rpc('lms_reports_of', { p_manager: employeeId }),
    sb.from('departments').select('id').eq('hod_employee_id', employeeId),
  ])
  const ids = new Set<string>((reports || []).map((r: any) => (typeof r === 'string' ? r : Object.values(r)[0] as string)))
  const deptIds = (depts || []).map((d: any) => d.id)
  if (deptIds.length) {
    const { data } = await sb.from('employees').select('id').in('department_id', deptIds).eq('employment_status', 'Active')
    for (const e of data || []) ids.add(e.id)
  }
  ids.delete(employeeId)
  return [...ids]
}

export async function teamView(managerId: string, companyId: string) {
  const [ids, settings] = await Promise.all([teamIds(managerId), settingsFor(companyId)])
  if (!ids.length) return { is_manager: false, can_assign: false, people: [], rows: [], requests: [] }
  const [rows, { data: people }] = await Promise.all([
    allRows<any>((f, t) => sb.rpc('lms_report_rows', { p_companies: [companyId], p_employees: ids }).range(f, t) as any),
    sb.from('employees').select('id, emp_code, full_name, designation').in('id', ids).eq('employment_status', 'Active').order('full_name'),
  ])
  const summary = (people || []).map((p: any) => {
    const mine = rows.filter(r => r.employee_id === p.id)
    return {
      ...p, assigned: mine.length, completed: mine.filter(r => r.status === 'COMPLETED').length,
      in_progress: mine.filter(r => r.status === 'IN_PROGRESS').length, overdue: mine.filter(r => r.is_overdue).length, failed: mine.filter(r => r.status === 'FAILED').length,
    }
  })
  const clean = rows.map(r => ({
    enrollment_id: r.enrollment_id, employee_id: r.employee_id, full_name: r.full_name, course_title: r.course_title, status: r.status, display_status: r.display_status,
    mandatory: r.mandatory, due_at: r.due_at, progress_pct: r.progress_pct, completed_at: r.completed_at, score_pct: settings.managers_see_scores ? r.score_pct : null,
  }))
  return {
    is_manager: true, can_assign: settings.managers_can_assign, people: summary, rows: clean.filter(r => r.status !== 'PENDING_APPROVAL'),
    requests: clean.filter(r => r.status === 'PENDING_APPROVAL'),
  }
}

export async function decideRequest(managerId: string, managerName: string, enrollmentId: string, approve: boolean, note: string | null) {
  const { data: e } = await sb.from('lms_enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (!e) throw notFound('That request')
  const { data: l } = await sb.from('lms_learners').select('employee_id').eq('id', e.learner_id).maybeSingle()
  const ids = await teamIds(managerId)
  if (!l?.employee_id || !ids.includes(l.employee_id)) throw notFound('That request')
  if (e.status !== 'PENDING_APPROVAL') throw new LmsError('This request has already been decided.', 409)
  must(await sb.from('lms_enrollments').update({ status: approve ? 'NOT_STARTED' : 'REJECTED', decided_by_name: managerName, decision_note: note }).eq('id', e.id).select('id'))
  const { data: c } = await sb.from('lms_courses').select('title').eq('id', e.course_id).maybeSingle()
  await notifyPerson(l.employee_id, 'LMS_ENROL_DECIDED', approve ? 'Course request approved' : 'Course request declined', `${c?.title}${note ? `: ${note}` : ''}`).catch(() => {})
  await audit({ companyId: e.company_id, actorId: managerId, actorLabel: managerName, action: approve ? 'ENROLMENT_APPROVED' : 'ENROLMENT_DECLINED', entity: 'enrollment', entityId: e.id, detail: { note } })
  return { ok: true }
}

/** A manager assigns published courses to their own reports. An ordinary assignment under
 *  the hood, so it appears in HR's history and reports. */
export async function managerAssign(managerId: string, managerName: string, companyId: string, b: any) {
  const s = await settingsFor(companyId)
  if (!s.managers_can_assign) throw new LmsError('Your company has switched this off.', 403)
  const ids = await teamIds(managerId)
  const picked: string[] = (Array.isArray(b?.employee_ids) ? b.employee_ids : []).map(String)
  if (!picked.length) throw new LmsError('Choose someone from your team.')
  if (picked.some(id => !ids.includes(id))) throw new LmsError('You can assign to your own team only.', 403)
  const g = emptyGrant()
  const actor: LmsActor = { grant: g, caps: { ...lmsCaps(g), assign: true }, employeeId: managerId, label: managerName, companies: [companyId], locationId: null }
  return createAssignment(actor, companyId, { ...b, trigger_type: 'ONCE', targets: picked.map(id => ({ kind: 'EMPLOYEE', value: id })) }, 'MANAGER')
}
