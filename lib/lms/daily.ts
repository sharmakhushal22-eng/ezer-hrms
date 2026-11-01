// lib/lms/daily.ts — the nightly run: everything that happens without anyone asking. Server only.
//
// Each step is independent and safe to repeat: the sweep is idempotent in SQL, reminders are
// fenced by lms_reminder_log's unique key, and a person gets one mail however much is due.
import { daysUntil } from './core'
import { allRows, audit, sb, settingsFor, type LmsSettings } from './server'
import { appBase, digestHtml, mailLearner, notifyPerson, shell, type DigestLine } from './notify'
import { preboardingSweep } from './preboarding'
import { publishProblems } from './core'

/** Mails per run. Gmail caps a day's sending, and what does not go today goes tomorrow. */
const MAIL_BUDGET = 300

async function publishScheduled(now: number) {
  const out = { published: 0, held: [] as string[] }
  const { data: due } = await sb.from('lms_courses').select('id, company_id, title').lte('publish_at', new Date(now).toISOString()).neq('status', 'ARCHIVED')
  for (const c of due || []) {
    const { data: v } = await sb.from('lms_course_versions').select('*').eq('course_id', c.id).in('status', ['DRAFT', 'IN_REVIEW']).maybeSingle()
    if (!v) continue
    const [{ data: modules }, { data: lessons }, { data: quizzes }] = await Promise.all([
      sb.from('lms_modules').select('*').eq('version_id', v.id),
      sb.from('lms_lessons').select('*').eq('version_id', v.id),
      sb.from('lms_quizzes').select('*').eq('version_id', v.id),
    ])
    const qIds = (quizzes || []).map((q: any) => q.id), aIds = (lessons || []).map((l: any) => l.asset_id).filter(Boolean)
    const [{ data: qs }, { data: assets }] = await Promise.all([
      qIds.length ? sb.from('lms_questions').select('*').in('quiz_id', qIds) : Promise.resolve({ data: [] as any[] }),
      aIds.length ? sb.from('lms_assets').select('id, status').in('id', aIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const problems = publishProblems(v, modules as any[] || [],
      (lessons || []).map((l: any) => ({ ...l, asset_ready: l.asset_id ? (assets || []).find((a: any) => a.id === l.asset_id)?.status === 'READY' : undefined })),
      (quizzes || []).map((q: any) => ({ ...q, questions: (qs || []).filter((x: any) => x.quiz_id === q.id).map((x: any) => ({ ...x, marks: Number(x.marks) })) })))
    if (problems.length) {
      await sb.from('lms_courses').update({ publish_at: null }).eq('id', c.id)
      await audit({ companyId: c.company_id, actorLabel: 'Scheduled publish', action: 'COURSE_PUBLISH_HELD', entity: 'course', entityId: c.id, detail: { problems } })
      out.held.push(c.title)
      continue
    }
    const { error } = await sb.rpc('lms_publish_version', { p_version: v.id, p_by: 'Scheduled publish' })
    if (error) { out.held.push(c.title); continue }
    await audit({ companyId: c.company_id, actorLabel: 'Scheduled publish', action: 'COURSE_PUBLISHED', entity: 'course', entityId: c.id, detail: { version: v.version_no } })
    out.published++
  }
  return out
}

interface Open { id: string; company_id: string; learner_id: string; course_id: string; due_at: string | null; mandatory: boolean; assignment_id: string | null; notified_at: string | null; source: string; status: string; last_escalated_at: string | null }

async function reminders(now: number) {
  const open = await allRows<Open>((f, t) => sb.from('lms_enrollments')
    .select('id, company_id, learner_id, course_id, due_at, mandatory, assignment_id, notified_at, source, status, last_escalated_at')
    .in('status', ['NOT_STARTED', 'IN_PROGRESS']).order('id').range(f, t) as any)
  const out = { considered: open.length, due_soon: 0, overdue: 0, mailed: 0, escalated: 0, held_back: 0 }
  if (!open.length) return out

  const companies = [...new Set(open.map(e => e.company_id))]
  const settings = new Map<string, LmsSettings>()
  for (const c of companies) settings.set(c, await settingsFor(c))
  const learnerIds = [...new Set(open.map(e => e.learner_id))], courseIds = [...new Set(open.map(e => e.course_id))], asgIds = [...new Set(open.map(e => e.assignment_id).filter(Boolean))] as string[]
  const chunk = async <T>(ids: string[], fn: (part: string[]) => PromiseLike<{ data: T[] | null }>) => {
    const res: T[] = []
    for (let i = 0; i < ids.length; i += 300) res.push(...(((await fn(ids.slice(i, i + 300))).data || [])))
    return res
  }
  const [learners, courses, asgs] = await Promise.all([
    chunk<any>(learnerIds, p => sb.from('lms_learners').select('id, employee_id, full_name, email').in('id', p)),
    chunk<any>(courseIds, p => sb.from('lms_courses').select('id, title').in('id', p)),
    chunk<any>(asgIds, p => sb.from('lms_assignments').select('id, reminder_every_days').in('id', p)),
  ])
  const L = new Map(learners.map(x => [x.id, x])), C = new Map(courses.map(x => [x.id, x.title])), A = new Map(asgs.map(x => [x.id, x.reminder_every_days]))

  // Decide who is owed what today, per learner.
  const due = new Map<string, { fresh: Open[]; soon: Open[]; late: Open[] }>()
  const put = (id: string, k: 'fresh' | 'soon' | 'late', e: Open) => {
    const b = due.get(id) || { fresh: [], soon: [], late: [] }
    b[k].push(e); due.set(id, b)
  }
  const claim = async (e: Open, kind: string) => {
    const r = await sb.from('lms_reminder_log').upsert({ company_id: e.company_id, enrollment_id: e.id, kind }, { onConflict: 'enrollment_id,kind,day', ignoreDuplicates: true }).select('id')
    return (r.data || []).length > 0
  }
  const managers = new Map<string, { name: string; lines: string[] }>()
  for (const e of open) {
    const s = settings.get(e.company_id)!
    if (!s.enabled) continue
    if (!e.notified_at) put(e.learner_id, 'fresh', e)
    if (!e.due_at) continue
    const left = daysUntil(e.due_at, now)
    if (left >= 0) {
      if (s.reminder_days_before.includes(left) && await claim(e, 'DUE_SOON')) { put(e.learner_id, 'soon', e); out.due_soon++ }
      continue
    }
    const every = (e.assignment_id && A.get(e.assignment_id)) || s.overdue_every_days
    if ((-left) % every === 1 % every && await claim(e, 'OVERDUE')) { put(e.learner_id, 'late', e); out.overdue++ }
    const l = L.get(e.learner_id)
    const quiet = !e.last_escalated_at || now - new Date(e.last_escalated_at).getTime() > 7 * 86_400_000
    if (l?.employee_id && -left >= s.escalate_after_days && quiet && await claim(e, 'ESCALATION')) {
      const { data: emp } = await sb.from('employees').select('l1_manager_id').eq('id', l.employee_id).maybeSingle()
      if (emp?.l1_manager_id) {
        const m = managers.get(emp.l1_manager_id) || { name: '', lines: [] }
        m.lines.push(`${l.full_name}: ${C.get(e.course_id)}`)
        managers.set(emp.l1_manager_id, m)
        await sb.from('lms_enrollments').update({ last_escalated_at: new Date(now).toISOString() }).eq('id', e.id)
      }
    }
  }

  // One bell and at most one mail per person.
  let budget = MAIL_BUDGET
  const toLine = (e: Open): DigestLine => ({ title: String(C.get(e.course_id) || 'Course'), due: e.due_at, mandatory: e.mandatory })
  for (const [learnerId, b] of due) {
    const l = L.get(learnerId)
    if (!l) continue
    const s = settings.get(b.fresh[0]?.company_id || b.soon[0]?.company_id || b.late[0]?.company_id)!
    if (l.employee_id) {
      if (b.late.length) await notifyPerson(l.employee_id, 'LMS_OVERDUE', 'Training overdue', b.late.map(e => C.get(e.course_id)).join(', ')).catch(() => {})
      else if (b.soon.length) await notifyPerson(l.employee_id, 'LMS_DUE_SOON', 'Training due soon', b.soon.map(e => C.get(e.course_id)).join(', ')).catch(() => {})
    }
    if (s.email_enabled) {
      if (budget <= 0) { out.held_back++; continue }
      budget--
      const portal = l.employee_id ? `${appBase()}/ess/learning` : null
      const sections = [
        { heading: 'Overdue', lines: b.late.map(toLine) }, { heading: 'Due soon', lines: b.soon.map(toLine) }, { heading: 'New for you', lines: b.fresh.map(toLine) },
      ]
      const titles = sections.flatMap(x => x.lines.map(y => y.title))
      // A candidate has no portal to link to: their link was mailed once and is not stored.
      const r = await mailLearner(l.email, b.late.length ? 'Your training is overdue' : b.soon.length ? 'Training due soon' : 'New learning for you',
        shell({ title: 'Your learning', body: digestHtml(l.full_name, sections), ...(portal ? { cta: { label: 'Open my learning', href: portal } } : { foot: 'Open the link HR sent you to continue.' }) }),
        `Your learning: ${titles.join(', ')}. ${portal || ''}`)
      if ((r as any).sent) out.mailed++
    }
    const ids = b.fresh.map(e => e.id)
    if (ids.length) await sb.from('lms_enrollments').update({ notified_at: new Date(now).toISOString() }).in('id', ids)
  }

  for (const [managerId, m] of managers) {
    await notifyPerson(managerId, 'LMS_TEAM_OVERDUE', 'Team training overdue', `${m.lines.length} overdue: ${m.lines.slice(0, 3).join('; ')}${m.lines.length > 3 ? '…' : ''}`).catch(() => {})
    out.escalated++
  }
  return out
}

export async function runLmsDaily(now = Date.now()) {
  const scheduled = await publishScheduled(now)
  // Candidates convert before the joiner rules run, so a course finished before joining is
  // recognised rather than assigned to them all over again.
  const pre = await preboardingSweep()
  const { data: sweep, error } = await sb.rpc('lms_daily_sweep')
  if (error) throw new Error(error.message)
  const rem = await reminders(now)
  return { scheduled, sweep, preboarding: pre, reminders: rem }
}
