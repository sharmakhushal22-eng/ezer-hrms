// lib/lms/assign.ts — giving learning out, and managing what was given. Server only.
//
// An assignment is an instruction with an audience; the enrolling itself is one transaction
// in the database (lms_apply_assignment, migration 207). What lives here is everything that
// has to be decided first: may this person reach that audience, are those courses
// assignable, and when does it start.
import { audit, LmsError, must, notFound, sb, settingsFor, allRows } from './server'
import { inScope, type LmsActor } from './access'
import { recompute, refreshPaths } from './engine'
import { mailLearner, notifyPerson, shell, appBase, digestHtml } from './notify'

export const TARGET_KINDS = ['COMPANY', 'EMPLOYEE', 'DEPARTMENT', 'DESIGNATION', 'LOCATION', 'TEAM', 'MANAGER', 'GRADE', 'EMPLOYMENT_TYPE', 'EMPLOYEE_CATEGORY', 'CONFIRMATION_STATUS']
const PREBOARD_KINDS = ['COMPANY', 'DEPARTMENT', 'DESIGNATION']
/** Up to this many, people are mailed at once. Beyond it the daily digest carries it, so a
 *  company-wide push cannot run a Gmail account out of its daily allowance mid-request. */
const IMMEDIATE_MAIL_LIMIT = 25

export interface TargetInput { kind: string; value?: string; label?: string; exclude?: boolean }

function cleanTargets(raw: unknown, trigger: string): TargetInput[] {
  const list = (Array.isArray(raw) ? raw : []) as TargetInput[]
  const out = list.filter(t => t?.kind).map(t => ({ kind: String(t.kind), value: String(t.value ?? ''), label: t.label ? String(t.label).slice(0, 200) : undefined, exclude: !!t.exclude }))
  if (!out.some(t => !t.exclude)) throw new LmsError('Choose who this is for.')
  for (const t of out) {
    if (!TARGET_KINDS.includes(t.kind)) throw new LmsError(`Unknown audience type: ${t.kind}.`)
    if (t.kind !== 'COMPANY' && !t.value) throw new LmsError('One of the audience rows has no value.')
    if (trigger === 'PREBOARD' && !PREBOARD_KINDS.includes(t.kind)) throw new LmsError('Candidates can be targeted by company, department or designation only.')
  }
  return out
}

/** Apply the actor's reach to an audience. Org-wide takes the higher permission; a branch
 *  HR's audience is ANDed to their branch, and anyone named must be in it. */
async function scopeTargets(a: LmsActor, company: string, targets: TargetInput[]): Promise<TargetInput[]> {
  const included = targets.filter(t => !t.exclude)
  if (included.some(t => t.kind === 'COMPANY') && !a.caps.automate) throw new LmsError('Assigning to the whole company needs organisation-wide rights.', 403)
  if (!a.locationId) return targets
  if (included.some(t => t.kind === 'COMPANY')) throw new LmsError('Your access covers your branch only.', 403)
  const named = included.filter(t => t.kind === 'EMPLOYEE').map(t => t.value!)
  if (named.length) {
    const { data } = await sb.from('employees').select('id').in('id', named).eq('company_id', company).eq('location_id', a.locationId)
    if ((data || []).length !== new Set(named).size) throw new LmsError('Your access covers your branch only: someone named is outside it.', 403)
  }
  const others = targets.filter(t => t.kind !== 'LOCATION')
  return [...others, { kind: 'LOCATION', value: a.locationId, label: 'Your branch' }]
}

async function assertItems(company: string, items: any[]) {
  if (!items.length) throw new LmsError('Choose at least one course or path.')
  const courseIds = items.filter(i => i.course_id).map(i => i.course_id)
  const pathIds = items.filter(i => i.path_id).map(i => i.path_id)
  if (courseIds.length) {
    const { data } = await sb.from('lms_courses').select('id, title, status').in('id', courseIds).eq('company_id', company)
    if ((data || []).length !== new Set(courseIds).size) throw notFound('One of those courses')
    const off = (data || []).filter((c: any) => c.status !== 'PUBLISHED')
    if (off.length) throw new LmsError(`Only published courses can be assigned: ${off.map((c: any) => c.title).join(', ')}.`, 409)
  }
  if (pathIds.length) {
    const { data } = await sb.from('lms_paths').select('id, title, status').in('id', pathIds).eq('company_id', company)
    if ((data || []).length !== new Set(pathIds).size) throw notFound('One of those paths')
    const off = (data || []).filter((p: any) => p.status !== 'PUBLISHED')
    if (off.length) throw new LmsError(`Only published paths can be assigned: ${off.map((p: any) => p.title).join(', ')}.`, 409)
  }
}

export async function previewAudience(a: LmsActor, company: string, body: any) {
  const trigger = String(body?.trigger_type || 'ONCE')
  if (trigger === 'PREBOARD') {
    const targets = cleanTargets(body?.targets, trigger)
    const rows = must(await sb.rpc('lms_match_candidates', { p_company: company, p_targets: targets })) as any[]
    return { count: (rows || []).length, sample: [] }
  }
  const targets = cleanTargets(body?.targets, trigger)
  const since = trigger === 'ON_JOIN' ? new Date(Date.now() - Number(body?.join_window_days ?? 30) * 86_400_000).toISOString().slice(0, 10) : null
  return must(await sb.rpc('lms_audience_preview', { p_company: company, p_targets: targets, p_joined_since: since, p_location: a.locationId }))
}

export async function createAssignment(a: LmsActor, company: string, b: any, source: 'MANUAL' | 'IMPORT' | 'MANAGER' = 'MANUAL') {
  const trigger = String(b?.trigger_type || 'ONCE')
  if (!['ONCE', 'DYNAMIC', 'ON_JOIN', 'PREBOARD'].includes(trigger)) throw new LmsError('Unknown assignment type.')
  if (trigger !== 'ONCE' && !a.caps.automate) throw new LmsError('Automatic assignment needs organisation-wide rights.', 403)

  const items = (Array.isArray(b?.items) ? b.items : []).filter((i: any) => i?.course_id || i?.path_id)
  await assertItems(company, items)
  const targets = await scopeTargets(a, company, cleanTargets(b?.targets, trigger))

  const dueMode = String(b?.due_mode || (b?.due_date ? 'FIXED' : 'AFTER_ASSIGN'))
  if (dueMode === 'FIXED' && !b?.due_date) throw new LmsError('Choose the due date.')
  if (['AFTER_ASSIGN', 'AFTER_JOIN', 'BEFORE_JOIN'].includes(dueMode) && b?.due_days == null) {
    const s = await settingsFor(company)
    b = { ...b, due_days: s.default_due_days }
  }
  const startAt = b?.start_at ? new Date(b.start_at) : null
  if (startAt && Number.isNaN(startAt.getTime())) throw new LmsError('That start date is not valid.')
  const scheduled = !!startAt && startAt.getTime() > Date.now()

  const firstTitle = await itemTitle(items[0])
  const made = must(await sb.from('lms_assignments').insert({
    company_id: company, name: String(b?.name || '').trim() || `${firstTitle}${items.length > 1 ? ` + ${items.length - 1} more` : ''}`,
    trigger_type: trigger, source, mandatory: b?.mandatory ?? true, priority: b?.priority || 'NORMAL', due_mode: dueMode,
    due_date: b?.due_date || null, due_days: b?.due_days ?? null, start_at: startAt?.toISOString() || null,
    join_window_days: b?.join_window_days ?? 30, reminder_every_days: b?.reminder_every_days ?? null,
    include_completed: !!b?.include_completed, status: scheduled ? 'SCHEDULED' : 'ACTIVE', note: b?.note || null,
    created_by_id: a.employeeId, created_by_name: a.label,
  }).select('*').single()) as any

  must(await sb.from('lms_assignment_items').insert(items.map((i: any, n: number) => ({
    company_id: company, assignment_id: made.id, course_id: i.course_id || null, path_id: i.path_id || null, position: n, due_days: i.due_days ?? null,
  }))).select('id'))
  must(await sb.from('lms_assignment_targets').insert(targets.map(t => ({
    company_id: company, assignment_id: made.id, kind: t.kind, value: t.value ?? '', label: t.label || null, exclude: !!t.exclude,
  }))).select('id'))

  const result = scheduled ? { matched: 0, enrolled: 0, scheduled: true } : must(await sb.rpc('lms_apply_assignment', { p_assignment: made.id })) as any
  await audit({ companyId: company, actorId: a.employeeId, actorLabel: a.label, action: 'ASSIGNMENT_CREATED', entity: 'assignment', entityId: made.id, detail: { name: made.name, trigger, source, items: items.length, targets, result } })
  if (!scheduled && result.enrolled > 0 && result.enrolled <= IMMEDIATE_MAIL_LIMIT) await mailNewEnrolments(made.id).catch(e => console.warn('[lms] assignment mail', e?.message))
  return { id: made.id, name: made.name, ...result }
}

async function itemTitle(i: any): Promise<string> {
  const { data } = i.course_id
    ? await sb.from('lms_courses').select('title').eq('id', i.course_id).maybeSingle()
    : await sb.from('lms_paths').select('title').eq('id', i.path_id).maybeSingle()
  return data?.title || 'Learning'
}

/** The immediate mail for a small assignment. notified_at keeps the digest from repeating it. */
async function mailNewEnrolments(assignmentId: string) {
  const { data: rows } = await sb.from('lms_enrollments').select('id, learner_id, course_id, due_at, mandatory, company_id').eq('assignment_id', assignmentId).is('notified_at', null)
  if (!rows?.length) return
  const s = await settingsFor(rows[0].company_id)
  const ids = rows.map((r: any) => r.id)
  if (s.email_enabled) {
    const [{ data: learners }, { data: courses }] = await Promise.all([
      sb.from('lms_learners').select('id, full_name, email, kind').in('id', [...new Set(rows.map((r: any) => r.learner_id))]),
      sb.from('lms_courses').select('id, title').in('id', [...new Set(rows.map((r: any) => r.course_id))]),
    ])
    const title = new Map((courses || []).map((c: any) => [c.id, c.title]))
    for (const l of (learners || []) as any[]) {
      if (l.kind !== 'EMPLOYEE') continue
      const lines = rows.filter((r: any) => r.learner_id === l.id).map((r: any) => ({ title: String(title.get(r.course_id)), due: r.due_at, mandatory: r.mandatory }))
      await mailLearner(l.email, 'New learning assigned to you',
        shell({ title: 'New learning for you', body: digestHtml(l.full_name, [{ heading: 'Assigned to you', lines }]), cta: { label: 'Open my learning', href: `${appBase()}/ess/learning` } }),
        `New learning has been assigned to you: ${lines.map(x => x.title).join(', ')}. ${appBase()}/ess/learning`)
    }
  }
  await sb.from('lms_enrollments').update({ notified_at: new Date().toISOString() }).in('id', ids)
}

export async function listAssignments(companies: string[]) {
  const rows = must(await sb.from('lms_assignments').select('*').in('company_id', companies).order('created_at', { ascending: false }).limit(500)) as any[]
  const ids = rows.map(r => r.id)
  if (!ids.length) return []
  const [items, targets] = await Promise.all([
    sb.from('lms_assignment_items').select('assignment_id, course_id, path_id, due_days').in('assignment_id', ids).order('position'),
    sb.from('lms_assignment_targets').select('assignment_id, kind, value, label, exclude').in('assignment_id', ids),
  ])
  const courseIds = [...new Set((items.data || []).map((i: any) => i.course_id).filter(Boolean))]
  const pathIds = [...new Set((items.data || []).map((i: any) => i.path_id).filter(Boolean))]
  const [courses, paths] = await Promise.all([
    courseIds.length ? sb.from('lms_courses').select('id, title').in('id', courseIds) : { data: [] },
    pathIds.length ? sb.from('lms_paths').select('id, title').in('id', pathIds) : { data: [] },
  ])
  const nm = new Map([...((courses as any).data || []), ...((paths as any).data || [])].map((c: any) => [c.id, c.title]))
  return rows.map(r => ({
    ...r,
    items: (items.data || []).filter((i: any) => i.assignment_id === r.id).map((i: any) => ({ ...i, title: nm.get(i.course_id || i.path_id) })),
    targets: (targets.data || []).filter((t: any) => t.assignment_id === r.id),
  }))
}

export async function assignmentAction(a: LmsActor, id: string, action: string, b: any) {
  const { data: x } = await sb.from('lms_assignments').select('*').eq('id', id).maybeSingle()
  if (!x) throw notFound('That assignment')
  inScope(a, x.company_id, 'That assignment')
  const log = (act: string, detail: Record<string, unknown> = {}) => audit({ companyId: x.company_id, actorId: a.employeeId, actorLabel: a.label, action: act, entity: 'assignment', entityId: id, detail })
  switch (action) {
    case 'pause':
    case 'resume':
      if (!a.caps.automate) throw new LmsError('This needs organisation-wide rights.', 403)
      must(await sb.from('lms_assignments').update({ status: action === 'pause' ? 'PAUSED' : 'ACTIVE' }).eq('id', id).select('id'))
      await log(action === 'pause' ? 'ASSIGNMENT_PAUSED' : 'ASSIGNMENT_RESUMED')
      return { ok: true }
    case 'apply': {
      const r = must(await sb.rpc('lms_apply_assignment', { p_assignment: id }))
      await log('ASSIGNMENT_APPLIED', { result: r })
      return r
    }
    case 'cancel': {
      must(await sb.from('lms_assignments').update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancelled_by_name: a.label }).eq('id', id).select('id'))
      // Nobody loses work: only enrolments nobody has begun are withdrawn, and only if asked.
      let withdrawn = 0
      if (b?.withdraw_not_started) {
        const rows = must(await sb.from('lms_enrollments').update({ status: 'CANCELLED', decision_note: `Assignment cancelled by ${a.label}` }).eq('assignment_id', id).eq('status', 'NOT_STARTED').select('id')) as any[]
        withdrawn = rows.length
      }
      await log('ASSIGNMENT_CANCELLED', { withdrawn })
      return { ok: true, withdrawn }
    }
    default:
      throw new LmsError('Unknown action.')
  }
}

/** HR's actions on one person's enrolment. */
export async function enrollmentAction(a: LmsActor, id: string, action: string, b: any) {
  const { data: e } = await sb.from('lms_enrollments').select('*').eq('id', id).maybeSingle()
  if (!e) throw notFound('That enrolment')
  inScope(a, e.company_id, 'That enrolment')
  if (a.locationId) {
    const { data: l } = await sb.from('lms_learners').select('employee_id').eq('id', e.learner_id).maybeSingle()
    const { data: emp } = l?.employee_id ? await sb.from('employees').select('location_id').eq('id', l.employee_id).maybeSingle() : { data: null as any }
    if (emp?.location_id !== a.locationId) throw notFound('That enrolment')
  }
  const log = (act: string, detail: Record<string, unknown> = {}) => audit({ companyId: e.company_id, actorId: a.employeeId, actorLabel: a.label, action: act, entity: 'enrollment', entityId: id, detail })
  const reason = String(b?.reason || '').trim()

  switch (action) {
    case 'extend': {
      const due = b?.due_date ? new Date(`${b.due_date}T23:59:59+05:30`) : null
      if (!due || Number.isNaN(due.getTime())) throw new LmsError('Choose the new due date.')
      must(await sb.from('lms_enrollments').update({ due_at: due.toISOString() }).eq('id', id).select('id'))
      await log('ENROLMENT_EXTENDED', { from: e.due_at, to: due.toISOString(), reason })
      return { ok: true }
    }
    case 'waive': {
      if (!reason) throw new LmsError('Record why this is being waived.')
      if (e.status === 'COMPLETED') throw new LmsError('This is already complete.', 409)
      must(await sb.from('lms_enrollments').update({ status: 'WAIVED', decided_by_name: a.label, decision_note: reason }).eq('id', id).select('id'))
      await refreshPaths(e.learner_id, e.company_id)
      await log('ENROLMENT_WAIVED', { reason })
      return { ok: true }
    }
    case 'cancel': {
      if (e.status === 'COMPLETED') throw new LmsError('A completed record stays on file.', 409)
      must(await sb.from('lms_enrollments').update({ status: 'CANCELLED', decided_by_name: a.label, decision_note: reason || null }).eq('id', id).select('id'))
      await log('ENROLMENT_CANCELLED', { reason })
      return { ok: true }
    }
    case 'grant_attempts': {
      const n = Math.max(1, Math.min(10, Number(b?.attempts) || 1))
      if (!b?.lesson_id) throw new LmsError('Choose the quiz.')
      const { data: p } = await sb.from('lms_lesson_progress').select('id, extra_attempts').eq('enrollment_id', id).eq('lesson_id', b.lesson_id).maybeSingle()
      if (!p) throw notFound('That quiz attempt')
      must(await sb.from('lms_lesson_progress').update({ extra_attempts: (p.extra_attempts || 0) + n }).eq('id', p.id).select('id'))
      const after = await recompute(id)
      await log('ATTEMPTS_GRANTED', { lesson_id: b.lesson_id, attempts: n, reason })
      return { ok: true, status: after.status }
    }
    case 'reassign': {
      // A fresh cycle: the failed or completed record stays exactly as it was.
      if (['NOT_STARTED', 'IN_PROGRESS', 'PENDING_APPROVAL'].includes(e.status)) throw new LmsError('This person is already enrolled.', 409)
      const { data: c } = await sb.from('lms_courses').select('published_version_id, status').eq('id', e.course_id).single()
      if (c?.status !== 'PUBLISHED' || !c.published_version_id) throw new LmsError('This course is not published any more.', 409)
      const { data: top } = await sb.from('lms_enrollments').select('cycle_no').eq('learner_id', e.learner_id).eq('course_id', e.course_id).order('cycle_no', { ascending: false }).limit(1).maybeSingle()
      const due = b?.due_date ? new Date(`${b.due_date}T23:59:59+05:30`).toISOString() : e.due_at && new Date(e.due_at).getTime() > Date.now() ? e.due_at : null
      const made = must(await sb.from('lms_enrollments').insert({
        company_id: e.company_id, learner_id: e.learner_id, course_id: e.course_id, version_id: c.published_version_id, assignment_id: e.assignment_id,
        source: 'RETAKE', mandatory: e.mandatory, priority: e.priority, due_at: due, cycle_no: (top?.cycle_no || e.cycle_no) + 1, assigned_by_id: a.employeeId, assigned_by_name: a.label,
      }).select('id').single()) as any
      await log('ENROLMENT_REASSIGNED', { new_enrollment: made.id, reason })
      return { ok: true, id: made.id }
    }
    case 'remind': {
      const { data: l } = await sb.from('lms_learners').select('employee_id, email, full_name').eq('id', e.learner_id).maybeSingle()
      const { data: c } = await sb.from('lms_courses').select('title').eq('id', e.course_id).maybeSingle()
      if (l?.employee_id) await notifyPerson(l.employee_id, 'LMS_DUE_SOON', 'Reminder from HR', c?.title || 'Your training')
      await log('REMINDER_SENT')
      return { ok: true }
    }
    default:
      throw new LmsError('Unknown action.')
  }
}

export interface ImportRow { emp_code?: unknown; course_code?: unknown; due_date?: unknown; mandatory?: unknown }

/** Bulk assignment from Excel. `commit: false` checks every row and reports; only a clean
 *  file can be committed, so a half-right sheet never half-applies. */
export async function importAssignments(a: LmsActor, company: string, body: { rows?: ImportRow[]; commit?: boolean }) {
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) throw new LmsError('The file has no rows.')
  if (rows.length > 5000) throw new LmsError('Import at most 5,000 rows at a time.')
  const [emps, courses] = await Promise.all([
    allRows<any>((f, t) => sb.from('employees').select('id, emp_code, full_name, location_id').eq('company_id', company).eq('employment_status', 'Active').range(f, t)),
    allRows<any>((f, t) => sb.from('lms_courses').select('id, code, title').eq('company_id', company).eq('status', 'PUBLISHED').range(f, t)),
  ])
  const empBy = new Map(emps.map(e => [String(e.emp_code).toUpperCase(), e]))
  const courseBy = new Map(courses.map(c => [String(c.code).toUpperCase(), c]))
  const errors: { row: number; error: string }[] = []
  const groups = new Map<string, { course: any; due: string | null; mandatory: boolean; employees: any[] }>()

  rows.forEach((r, i) => {
    const row = i + 2   // the spreadsheet's own row number: its heading is row 1
    const code = String(r.emp_code ?? '').trim().toUpperCase(), cc = String(r.course_code ?? '').trim().toUpperCase()
    const emp = empBy.get(code), course = courseBy.get(cc)
    if (!emp) errors.push({ row, error: `No active employee ${code || '(blank)'} in this company.` })
    else if (a.locationId && emp.location_id !== a.locationId) errors.push({ row, error: `${code} is outside your branch.` })
    if (!course) errors.push({ row, error: `No published course ${cc || '(blank)'}.` })
    const dueRaw = String(r.due_date ?? '').trim()
    const due = dueRaw ? (Number.isNaN(new Date(dueRaw).getTime()) ? null : new Date(dueRaw).toISOString().slice(0, 10)) : null
    if (dueRaw && !due) errors.push({ row, error: `Due date "${dueRaw}" is not a date.` })
    const mandatory = !/^(n|no|false|0|optional)$/i.test(String(r.mandatory ?? 'yes').trim())
    if (!emp || !course || (dueRaw && !due)) return
    const key = `${course.id}|${due || ''}|${mandatory}`
    const g = groups.get(key) || { course, due, mandatory, employees: [] }
    if (!g.employees.some(e => e.id === emp.id)) g.employees.push(emp)
    groups.set(key, g)
  })

  const summary = [...groups.values()].map(g => ({ course: g.course.title, code: g.course.code, due_date: g.due, mandatory: g.mandatory, employees: g.employees.length }))
  if (errors.length || !body.commit) return { ok: !errors.length, committed: false, errors: errors.slice(0, 200), error_count: errors.length, summary }

  let enrolled = 0
  for (const g of groups.values()) {
    const r = await createAssignment(a, company, {
      name: `Excel import: ${g.course.title}`, trigger_type: 'ONCE', mandatory: g.mandatory, due_mode: g.due ? 'FIXED' : 'NONE', due_date: g.due,
      items: [{ course_id: g.course.id }], targets: g.employees.map(e => ({ kind: 'EMPLOYEE', value: e.id, label: e.emp_code })),
    }, 'IMPORT')
    enrolled += Number((r as any).enrolled || 0)
  }
  return { ok: true, committed: true, enrolled, errors: [], error_count: 0, summary }
}
