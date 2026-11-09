// lib/lms/live.ts — live sessions (webinars). Server only.
//
// The call happens in the company's own Zoom, Meet or Teams: a session here holds the link,
// not the video. What EZER Learn adds is everything around the call — who is invited, a
// calendar invitation, reminders, attendance, the recording for those who missed it — and
// the link to courses: a course's LIVE lesson is done once the learner attended one of that
// course's sessions, or watched enough of its recording.
//
// Mail follows the assignment rule (lib/lms/assign.ts): a small invitation goes at once, a
// big one is finished by the daily job, so a company-wide webinar cannot use up the Gmail
// allowance inside one request. What each person has been sent is on their attendee row.
import { audit, allRows, LmsError, mediaUrl, must, notFound, sb, settingsFor } from './server'
import { inScope, type LmsActor } from './access'
import { TARGET_KINDS, type TargetInput } from './assign'
import { recompute } from './engine'
import { learnUrl, mailLearner, notifyPerson, shell } from './notify'
import {
  buildIcs, canCheckIn, canJoin, creditRecording, endsAt, newCheckinCode, phaseOf, sameCode, whenWords, RECORDING_DONE_PCT,
} from './live-core'
import type { Learner } from './learner'

const IMMEDIATE_MAIL_LIMIT = 25
const SESSION_COLS = 'id, company_id, title, description, course_id, host_name, host_employee_id, starts_at, duration_min, join_url, location, capacity, open_registration, status, checkin_code, recording_asset_id, sequence, cancel_reason, created_by_name, created_at, updated_at, completed_at'
const ACTIVE = ['INVITED', 'REGISTERED']

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function cleanUrl(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw new LmsError('The meeting link must be a full https:// address (Zoom, Google Meet or Teams).')
  return s.slice(0, 1000)
}

function sessionFields(b: any, partial: boolean) {
  const out: Record<string, unknown> = {}
  const has = (k: string) => b && Object.prototype.hasOwnProperty.call(b, k)
  if (!partial || has('title')) {
    const t = String(b?.title ?? '').trim()
    if (!t) throw new LmsError('Give the session a title.')
    out.title = t.slice(0, 200)
  }
  if (has('description')) out.description = String(b.description ?? '').trim().slice(0, 5000) || null
  if (!partial || has('starts_at')) {
    const d = new Date(String(b?.starts_at || ''))
    if (Number.isNaN(d.getTime())) throw new LmsError('Choose when the session starts.')
    out.starts_at = d.toISOString()
  }
  if (!partial || has('duration_min')) {
    const n = Math.round(Number(b?.duration_min ?? 60))
    if (!(n >= 5 && n <= 600)) throw new LmsError('A session runs between 5 minutes and 10 hours.')
    out.duration_min = n
  }
  if (has('join_url')) out.join_url = cleanUrl(b.join_url)
  if (has('location')) out.location = String(b.location ?? '').trim().slice(0, 300) || null
  if (has('host_name')) out.host_name = String(b.host_name ?? '').trim().slice(0, 200) || null
  if (has('host_employee_id')) out.host_employee_id = b.host_employee_id || null
  if (has('capacity')) {
    const c = b.capacity === '' || b.capacity == null ? null : Math.round(Number(b.capacity))
    if (c != null && !(c > 0)) throw new LmsError('Seats must be a number above zero, or left empty for no limit.')
    out.capacity = c
  }
  if (has('open_registration')) out.open_registration = !!b.open_registration
  if (has('course_id')) out.course_id = b.course_id || null
  return out
}

async function sessionRow(id: string) {
  const { data } = await sb.from('lms_sessions').select(SESSION_COLS).eq('id', id).maybeSingle()
  if (!data) throw notFound('That session')
  return data as any
}

async function mine(a: LmsActor, id: string) {
  const s = await sessionRow(id)
  inScope(a, s.company_id, 'That session')
  return s
}

// ── Mail ────────────────────────────────────────────────────────────────────
function organizer() {
  const email = process.env.GMAIL_USER
  return email ? { name: process.env.GMAIL_FROM_NAME || 'EZER Learn', email } : null
}

function detailsHtml(s: any, extra = '') {
  const rows = [
    ['When', whenWords(s.starts_at, s.duration_min)],
    s.host_name ? ['Host', s.host_name] : null,
    s.location ? ['Where', s.location] : null,
    s.join_url ? ['Meeting link', `<a href="${esc(s.join_url)}">${esc(s.join_url)}</a>`] : null,
  ].filter(Boolean) as string[][]
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${k === 'Meeting link' ? v : esc(v)}</td></tr>`).join('')}</table>${s.description ? `<div style="white-space:pre-wrap;margin-bottom:10px">${esc(s.description)}</div>` : ''}${extra}`
}

type MailKind = 'invite' | 'update' | 'cancel' | 'day_before' | 'same_day' | 'missed'

async function mailOne(s: any, who: { name: string; email: string | null }, kind: MailKind) {
  const page = learnUrl(`/live/${s.id}`)
  const ics = (kind === 'invite' || kind === 'update' || kind === 'cancel') && who.email
    ? buildIcs({ id: s.id, sequence: s.sequence, title: s.title, description: s.description, starts_at: s.starts_at, duration_min: s.duration_min, join_url: s.join_url, location: s.location, organizer: organizer(), attendee: { name: who.name, email: who.email }, cancelled: kind === 'cancel', page })
    : null
  const subject = {
    invite: `Invitation: ${s.title} — ${whenWords(s.starts_at)}`,
    update: `Updated: ${s.title} — ${whenWords(s.starts_at)}`,
    cancel: `Cancelled: ${s.title}`,
    day_before: `Tomorrow: ${s.title}`,
    same_day: `Today: ${s.title} at ${whenWords(s.starts_at).split(', ')[1]}`,
    missed: `The recording of ${s.title} is ready`,
  }[kind]
  const lead = {
    invite: 'You are invited to a live session. The invitation is attached, so you can add it to your calendar in one click.',
    update: 'The details of this live session have changed. The attached invitation updates your calendar.',
    cancel: `This live session has been cancelled${s.cancel_reason ? `: ${esc(s.cancel_reason)}` : '.'} The attachment removes it from your calendar.`,
    day_before: 'A reminder that this live session is tomorrow.',
    same_day: 'This live session is today. Join from EZER Learn up to 15 minutes before it starts.',
    missed: 'You missed the live session, so here is its recording. Watching it counts the same as attending.',
  }[kind]
  const html = shell({
    title: s.title,
    body: `Dear ${esc(who.name)},<br><br>${lead}${kind === 'cancel' ? '' : detailsHtml(s)}`,
    cta: kind === 'cancel' ? undefined : { label: kind === 'missed' ? 'Watch the recording' : 'Open in EZER Learn', href: page },
  })
  return mailLearner(who.email, subject, html, `${lead.replace(/<[^>]+>/g, '')} ${s.title}, ${whenWords(s.starts_at, s.duration_min)}. ${page}`, ics
    ? [{ filename: kind === 'cancel' ? 'cancelled.ics' : 'invite.ics', content: Buffer.from(ics, 'utf8'), contentType: `text/calendar; charset=utf-8; method=${kind === 'cancel' ? 'CANCEL' : 'REQUEST'}` }]
    : undefined)
}

/** Invitations and updates still owed for one session: everyone whose last mail carried an
 *  older version of it. `limit` caps a request; the daily job sends the rest. */
export async function mailOwed(sessionId: string, limit: number): Promise<{ sent: number; left: number }> {
  const s = await sessionRow(sessionId)
  if (s.status !== 'SCHEDULED' || endsAt(s) < Date.now()) return { sent: 0, left: 0 }
  const settings = await settingsFor(s.company_id)
  const rows = must(await sb.from('lms_session_attendees').select('id, learner_id, invite_mailed_seq').eq('session_id', s.id).in('status', ACTIVE)) as any[]
  const owed = rows.filter(r => r.invite_mailed_seq == null || r.invite_mailed_seq < s.sequence)
  if (!owed.length) return { sent: 0, left: 0 }
  const batch = owed.slice(0, limit)
  const { data: people } = await sb.from('lms_learners').select('id, full_name, email, employee_id').in('id', batch.map(r => r.learner_id))
  const P = new Map((people || []).map((p: any) => [p.id, p]))
  let sent = 0
  for (const r of batch) {
    const p: any = P.get(r.learner_id)
    if (!p) continue
    if (p.employee_id && r.invite_mailed_seq == null) await notifyPerson(p.employee_id, 'LMS_ASSIGNED', 'Live session invitation', `${s.title} · ${whenWords(s.starts_at)}`, `/learning/live/${s.id}`).catch(() => {})
    if (settings.email_enabled) {
      const m = await mailOne(s, { name: p.full_name, email: p.email }, r.invite_mailed_seq == null ? 'invite' : 'update').catch(() => ({ sent: false }))
      if ((m as any).sent) sent++
    }
    await sb.from('lms_session_attendees').update({ invite_mailed_at: new Date().toISOString(), invite_mailed_seq: s.sequence }).eq('id', r.id)
  }
  return { sent, left: owed.length - batch.length }
}

// ── HR: sessions ────────────────────────────────────────────────────────────
export async function listSessions(a: LmsActor, companies: string[]) {
  const rows = must(await sb.from('lms_sessions').select(SESSION_COLS).in('company_id', companies).order('starts_at', { ascending: false }).limit(300)) as any[]
  if (!rows.length) return []
  const att = await allRows<any>((f, t) => sb.from('lms_session_attendees').select('session_id, status, attended, recording_done').in('session_id', rows.map(r => r.id)).range(f, t) as any)
  const courseIds = [...new Set(rows.map(r => r.course_id).filter(Boolean))]
  const { data: courses } = courseIds.length ? await sb.from('lms_courses').select('id, title').in('id', courseIds) : { data: [] as any[] }
  const C = new Map((courses || []).map((c: any) => [c.id, c.title]))
  const now = Date.now()
  return rows.map(s => {
    const mine = att.filter(x => x.session_id === s.id)
    const active = mine.filter(x => ACTIVE.includes(x.status))
    return {
      ...s, phase: phaseOf(s, now), course_title: s.course_id ? C.get(s.course_id) || null : null,
      counts: { invited: active.length, registered: active.filter(x => x.status === 'REGISTERED').length, attended: mine.filter(x => x.attended).length, watched: mine.filter(x => x.recording_done && !x.attended).length },
    }
  })
}

export async function sessionDetail(a: LmsActor, id: string) {
  const s = await mine(a, id)
  const rows = await allRows<any>((f, t) => sb.from('lms_session_attendees').select('*').eq('session_id', id).order('created_at').range(f, t) as any)
  const learnerIds = rows.map(r => r.learner_id)
  const people = learnerIds.length ? await allRows<any>((f, t) => sb.from('lms_learners').select('id, full_name, email, employee_id, designation').in('id', learnerIds).range(f, t) as any) : []
  const empIds = people.map(p => p.employee_id).filter(Boolean)
  const emps = empIds.length ? await allRows<any>((f, t) => sb.from('employees').select('id, emp_code, location_id').in('id', empIds).range(f, t) as any) : []
  const E = new Map(emps.map(e => [e.id, e])), P = new Map(people.map(p => [p.id, p]))
  let list = rows.map(r => {
    const p = P.get(r.learner_id) || {}
    const e: any = E.get(p.employee_id) || {}
    return { ...r, name: p.full_name || 'Someone', email: p.email || null, designation: p.designation || null, emp_code: e.emp_code || null, location_id: e.location_id || null }
  })
  // A branch HR sees their branch's people only, as everywhere else in Learning.
  if (a.locationId) list = list.filter(x => x.location_id === a.locationId)
  const [{ data: course }, { data: rec }] = await Promise.all([
    s.course_id ? sb.from('lms_courses').select('id, title, code').eq('id', s.course_id).maybeSingle() : Promise.resolve({ data: null as any }),
    s.recording_asset_id ? sb.from('lms_assets').select('id, original_name, duration_s, size_bytes, status').eq('id', s.recording_asset_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ])
  return { session: { ...s, phase: phaseOf(s) }, course, recording: rec, attendees: list }
}

export async function createSession(a: LmsActor, company: string, b: any) {
  const f = sessionFields(b, false)
  if (!f.join_url && !String(b?.location || '').trim()) throw new LmsError('Add the meeting link, or a room if it is held in person.')
  if (f.course_id) {
    const { data: c } = await sb.from('lms_courses').select('id').eq('id', f.course_id as string).eq('company_id', company).maybeSingle()
    if (!c) throw notFound('That course')
  }
  const made = must(await sb.from('lms_sessions').insert({
    ...f, company_id: company, checkin_code: newCheckinCode(), created_by_id: a.employeeId, created_by_name: a.label,
    host_name: (f.host_name as string) || a.label,
  }).select(SESSION_COLS).single()) as any
  await audit({ companyId: company, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_CREATED', entity: 'session', entityId: made.id, detail: { title: made.title, starts_at: made.starts_at } })
  const invited = Array.isArray(b?.targets) && b.targets.length ? await inviteToSession(a, made.id, { targets: b.targets }) : null
  return { session: made, invited }
}

/** Change a session. A change people would put in a calendar (time, length, link, room)
 *  bumps its sequence, so everyone invited gets the updated invitation. */
export async function updateSession(a: LmsActor, id: string, b: any) {
  const s = await mine(a, id)
  if (s.status === 'CANCELLED') throw new LmsError('This session was cancelled. Create a new one instead.', 409)
  const f = sessionFields(b, true)
  if (f.course_id) {
    const { data: c } = await sb.from('lms_courses').select('id').eq('id', f.course_id as string).eq('company_id', s.company_id).maybeSingle()
    if (!c) throw notFound('That course')
  }
  const calendar = ['starts_at', 'duration_min', 'join_url', 'location', 'title'].some(k => k in f && String(f[k] ?? '') !== String(s[k] ?? ''))
  const next = must(await sb.from('lms_sessions').update({ ...f, updated_at: new Date().toISOString(), ...(calendar ? { sequence: s.sequence + 1 } : {}) }).eq('id', id).select(SESSION_COLS).single()) as any
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_UPDATED', entity: 'session', entityId: id, detail: { fields: Object.keys(f) } })
  const mailed = calendar && next.status === 'SCHEDULED' ? await mailOwed(id, IMMEDIATE_MAIL_LIMIT) : null
  return { session: next, mailed }
}

export async function cancelSession(a: LmsActor, id: string, reason: string) {
  const s = await mine(a, id)
  if (s.status !== 'SCHEDULED') throw new LmsError('Only a scheduled session can be cancelled.', 409)
  const next = must(await sb.from('lms_sessions').update({ status: 'CANCELLED', cancel_reason: reason || null, sequence: s.sequence + 1, updated_at: new Date().toISOString() }).eq('id', id).select(SESSION_COLS).single()) as any
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_CANCELLED', entity: 'session', entityId: id, detail: { reason } })
  // Everyone who was sent the invitation hears, however many: the event must leave their calendars.
  const rows = must(await sb.from('lms_session_attendees').select('learner_id, invite_mailed_at').eq('session_id', id).in('status', ACTIVE)) as any[]
  const told = rows.filter(r => r.invite_mailed_at)
  const settings = await settingsFor(s.company_id)
  let mailed = 0
  if (told.length) {
    const people = await allRows<any>((f, t) => sb.from('lms_learners').select('id, full_name, email, employee_id').in('id', told.map(r => r.learner_id)).range(f, t) as any)
    for (const p of people.slice(0, 400)) {
      if (p.employee_id) await notifyPerson(p.employee_id, 'LMS_ASSIGNED', 'Live session cancelled', next.title, '/learning/live').catch(() => {})
      if (settings.email_enabled && ((await mailOne(next, { name: p.full_name, email: p.email }, 'cancel').catch(() => ({ sent: false }))) as any).sent) mailed++
    }
  }
  return { session: next, mailed }
}

/** Close the session: it happened. Attendance can still be corrected afterwards. */
export async function completeSession(a: LmsActor, id: string) {
  const s = await mine(a, id)
  if (s.status === 'CANCELLED') throw new LmsError('A cancelled session cannot be marked as held.', 409)
  const next = must(await sb.from('lms_sessions').update({ status: 'COMPLETED', completed_at: s.completed_at || new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).select(SESSION_COLS).single()) as any
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_COMPLETED', entity: 'session', entityId: id })
  const missed = next.recording_asset_id ? await mailMissed(id, IMMEDIATE_MAIL_LIMIT) : null
  return { session: next, missed }
}

export async function setRecording(a: LmsActor, id: string, assetId: string | null) {
  const s = await mine(a, id)
  if (assetId) {
    const { data: asset } = await sb.from('lms_assets').select('id, company_id, kind, status').eq('id', assetId).maybeSingle()
    if (!asset || asset.company_id !== s.company_id) throw notFound('That recording')
    if (asset.kind !== 'VIDEO' || asset.status !== 'READY') throw new LmsError('The recording must be an uploaded MP4 video.')
  }
  const next = must(await sb.from('lms_sessions').update({ recording_asset_id: assetId, updated_at: new Date().toISOString() }).eq('id', id).select(SESSION_COLS).single()) as any
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: assetId ? 'SESSION_RECORDING_ADDED' : 'SESSION_RECORDING_REMOVED', entity: 'session', entityId: id })
  const missed = assetId && next.status === 'COMPLETED' ? await mailMissed(id, IMMEDIATE_MAIL_LIMIT) : null
  return { session: next, missed }
}

// ── HR: people ──────────────────────────────────────────────────────────────
export async function inviteToSession(a: LmsActor, id: string, b: { targets?: unknown }) {
  const s = await mine(a, id)
  if (s.status !== 'SCHEDULED') throw new LmsError('Only a scheduled session takes new invitations.', 409)
  const targets = (Array.isArray(b?.targets) ? b.targets : []) as TargetInput[]
  const clean = targets.filter(t => t?.kind && TARGET_KINDS.includes(t.kind)).map(t => ({ kind: t.kind, value: String(t.value ?? ''), exclude: !!t.exclude }))
  if (!clean.some(t => !t.exclude)) throw new LmsError('Choose who to invite.')
  if (clean.some(t => !t.exclude && t.kind === 'COMPANY') && !a.caps.automate) throw new LmsError('Inviting the whole company needs organisation-wide rights.', 403)
  let ids = await allRows<string>((f, t) => sb.rpc('lms_match_employees', { p_company: s.company_id, p_targets: clean }).range(f, t) as any)
  ids = ids.map((x: any) => (typeof x === 'string' ? x : x?.lms_match_employees || x)).filter(Boolean)
  if (a.locationId && ids.length) {
    const inBranch = await allRows<any>((f, t) => sb.from('employees').select('id').in('id', ids).eq('location_id', a.locationId!).range(f, t) as any)
    ids = inBranch.map(e => e.id)
  }
  if (!ids.length) return { matched: 0, invited: 0, mailed: 0, left: 0 }
  must(await sb.rpc('lms_ensure_learners', { p_company: s.company_id, p_employees: ids }))
  const learners = await allRows<any>((f, t) => sb.from('lms_learners').select('id').eq('company_id', s.company_id).in('employee_id', ids).range(f, t) as any)
  const existing = await allRows<any>((f, t) => sb.from('lms_session_attendees').select('learner_id, status').eq('session_id', id).range(f, t) as any)
  const have = new Map(existing.map(x => [x.learner_id, x.status]))
  const fresh = learners.filter(l => !have.has(l.id)).map(l => ({ company_id: s.company_id, session_id: id, learner_id: l.id, status: 'INVITED', source: 'INVITED', invited_by_name: a.label }))
  for (let i = 0; i < fresh.length; i += 500) must(await sb.from('lms_session_attendees').insert(fresh.slice(i, i + 500)).select('id'))
  // Someone taken off earlier and asked again is simply back on the list.
  const back = learners.filter(l => have.get(l.id) === 'REMOVED' || have.get(l.id) === 'DECLINED').map(l => l.id)
  if (back.length) await sb.from('lms_session_attendees').update({ status: 'INVITED', invite_mailed_seq: null }).eq('session_id', id).in('learner_id', back)
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_INVITED', entity: 'session', entityId: id, detail: { targets: clean, matched: ids.length, added: fresh.length + back.length } })
  const m = await mailOwed(id, IMMEDIATE_MAIL_LIMIT)
  return { matched: ids.length, invited: fresh.length + back.length, mailed: m.sent, left: m.left }
}

export async function removeAttendee(a: LmsActor, id: string, learnerId: string) {
  const s = await mine(a, id)
  must(await sb.from('lms_session_attendees').update({ status: 'REMOVED' }).eq('session_id', id).eq('learner_id', learnerId).select('id'))
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_ATTENDEE_REMOVED', entity: 'session', entityId: id, detail: { learner_id: learnerId } })
  return { ok: true }
}

/** The host's register. `learners` are ticked as attended (or not); `all` ticks everyone on
 *  the list. A tick counts at once for the session's course. */
export async function markAttendance(a: LmsActor, id: string, b: { learners?: string[]; attended?: boolean; all?: boolean }) {
  const s = await mine(a, id)
  if (s.status === 'CANCELLED') throw new LmsError('Nobody attends a cancelled session.', 409)
  if (Date.now() < new Date(s.starts_at).getTime() - 15 * 60_000) throw new LmsError('Attendance opens when the session starts.', 409)
  const attended = b.attended !== false
  const now = new Date().toISOString()
  let q = sb.from('lms_session_attendees').update(attended
    ? { attended: true, attended_at: now, attendance_by: 'HOST', marked_by_name: a.label }
    : { attended: false, attended_at: null, attendance_by: null, marked_by_name: a.label }).eq('session_id', id)
  if (b.all) q = q.in('status', ACTIVE)
  else {
    const ids = (b.learners || []).filter(Boolean)
    if (!ids.length) throw new LmsError('Choose who attended.')
    q = q.in('learner_id', ids)
  }
  const rows = must(await q.select('learner_id')) as any[]
  await audit({ companyId: s.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'SESSION_ATTENDANCE', entity: 'session', entityId: id, detail: { attended, count: rows.length, all: !!b.all } })
  if (attended) await settleLive(rows.map(r => r.learner_id), s.course_id)
  return { ok: true, count: rows.length }
}

// ── Learner ─────────────────────────────────────────────────────────────────
function forLearner(s: any, r: any | null, now: number) {
  const phase = phaseOf(s, now)
  const seatsTaken = s._taken ?? null
  return {
    id: s.id, title: s.title, description: s.description, host_name: s.host_name, starts_at: s.starts_at, ends_at: new Date(endsAt(s)).toISOString(),
    duration_min: s.duration_min, location: s.location, status: s.status, phase, course_id: s.course_id, course_title: s._course || null,
    cancel_reason: s.cancel_reason, has_link: !!s.join_url,
    capacity: s.capacity, seats_left: s.capacity != null && seatsTaken != null ? Math.max(0, s.capacity - seatsTaken) : null,
    has_recording: !!s.recording_asset_id && s.status !== 'CANCELLED',
    me: r ? {
      status: r.status, registered: r.status === 'REGISTERED', invited: r.source === 'INVITED' && r.status !== 'REMOVED',
      attended: !!r.attended, recording_done: !!r.recording_done, joined_at: r.joined_at,
      recording_pct: s._duration ? Math.min(100, Math.round((Number(r.recording_watched_s) / s._duration) * 100)) : 0,
      recording_position_s: Number(r.recording_position_s || 0),
    } : null,
    can_join: canJoin(s, now) && !!s.join_url && (!r || r.status !== 'REMOVED'),
    can_check_in: canCheckIn(s, now) && !!r && ACTIVE.includes(r.status) && !r.attended,
    open: !!s.open_registration,
  }
}

async function decorate(rows: any[]) {
  if (!rows.length) return rows
  const ids = rows.map(r => r.id)
  const [taken, courses, recs] = await Promise.all([
    allRows<any>((f, t) => sb.from('lms_session_attendees').select('session_id').in('session_id', ids).eq('status', 'REGISTERED').range(f, t) as any),
    (async () => { const c = [...new Set(rows.map(r => r.course_id).filter(Boolean))]; return c.length ? ((await sb.from('lms_courses').select('id, title').in('id', c)).data || []) : [] })(),
    (async () => { const a = rows.map(r => r.recording_asset_id).filter(Boolean); return a.length ? ((await sb.from('lms_assets').select('id, duration_s').in('id', a)).data || []) : [] })(),
  ])
  const T = new Map<string, number>()
  for (const x of taken) T.set(x.session_id, (T.get(x.session_id) || 0) + 1)
  const C = new Map((courses as any[]).map(c => [c.id, c.title])), D = new Map((recs as any[]).map(r => [r.id, Number(r.duration_s || 0)]))
  return rows.map(r => ({ ...r, _taken: T.get(r.id) || 0, _course: r.course_id ? C.get(r.course_id) : null, _duration: r.recording_asset_id ? D.get(r.recording_asset_id) || 0 : 0 }))
}

/** Sessions this person can see: the ones they are on, and the open ones of their company. */
async function visible(l: Learner): Promise<{ sessions: any[]; rows: Map<string, any> }> {
  const mineRows = (await sb.from('lms_session_attendees').select('*').in('learner_id', l.allIds)).data || []
  const ids = [...new Set(mineRows.filter((r: any) => r.status !== 'REMOVED').map((r: any) => r.session_id))]
  const [onList, open] = await Promise.all([
    ids.length ? sb.from('lms_sessions').select(SESSION_COLS).in('id', ids) : Promise.resolve({ data: [] as any[] }),
    l.kind === 'EMPLOYEE' ? sb.from('lms_sessions').select(SESSION_COLS).eq('company_id', l.companyId).eq('open_registration', true).neq('status', 'CANCELLED').gte('starts_at', new Date(Date.now() - 45 * 86_400_000).toISOString()) : Promise.resolve({ data: [] as any[] }),
  ])
  const byId = new Map<string, any>()
  for (const s of [...(onList.data || []), ...(open.data || [])]) byId.set(s.id, s)
  const rows = new Map<string, any>()
  for (const r of mineRows as any[]) if (r.status !== 'REMOVED') rows.set(r.session_id, r)
  return { sessions: [...byId.values()], rows }
}

export async function mySessions(l: Learner, now = Date.now()) {
  const { sessions, rows } = await visible(l)
  const all = (await decorate(sessions)).map(s => forLearner(s, rows.get(s.id) || null, now))
  const upcoming = all.filter(s => s.phase !== 'ended' && s.phase !== 'cancelled').sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = all.filter(s => s.phase === 'ended' && (s.me || s.has_recording)).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  const cancelled = all.filter(s => s.phase === 'cancelled' && s.me && new Date(s.starts_at).getTime() > now - 7 * 86_400_000)
  return { upcoming, past, cancelled }
}

async function mySession(l: Learner, id: string) {
  const s = await sessionRow(id)
  const { data: r } = await sb.from('lms_session_attendees').select('*').eq('session_id', id).in('learner_id', l.allIds).maybeSingle()
  const onIt = r && r.status !== 'REMOVED'
  if (!onIt && !(s.open_registration && s.company_id === l.companyId && l.kind === 'EMPLOYEE')) throw notFound('That session')
  return { s, r: onIt ? r : null }
}

export async function sessionForLearner(l: Learner, id: string, now = Date.now()) {
  const { s, r } = await mySession(l, id)
  const [d] = await decorate([s])
  return forLearner(d, r, now)
}

export async function register(l: Learner, id: string, on: boolean) {
  const { s, r } = await mySession(l, id)
  if (s.status !== 'SCHEDULED' || phaseOf(s) === 'ended') throw new LmsError('This session is no longer taking registrations.', 409)
  if (on) {
    if (s.capacity != null && r?.status !== 'REGISTERED') {
      const { count } = await sb.from('lms_session_attendees').select('id', { count: 'exact', head: true }).eq('session_id', id).eq('status', 'REGISTERED')
      if ((count || 0) >= s.capacity) throw new LmsError('Every seat is taken. Ask the host whether more can be added.', 409)
    }
    const at = new Date().toISOString()
    if (r) must(await sb.from('lms_session_attendees').update({ status: 'REGISTERED', registered_at: at }).eq('id', r.id).select('id'))
    else must(await sb.from('lms_session_attendees').insert({ company_id: s.company_id, session_id: id, learner_id: l.id, status: 'REGISTERED', source: 'SELF', registered_at: at }).select('id'))
    // Someone who signs up on their own gets the calendar invitation too.
    await mailOwed(id, 1).catch(() => {})
  } else {
    if (!r) return { ok: true }
    must(await sb.from('lms_session_attendees').update({ status: r.source === 'SELF' ? 'REMOVED' : 'DECLINED' }).eq('id', r.id).select('id'))
  }
  return { ok: true }
}

/** The meeting link, only while the room is open. Pressing Join is noted for the host. */
export async function join(l: Learner, id: string, now = Date.now()) {
  const { s, r } = await mySession(l, id)
  if (!s.join_url) throw new LmsError('This session is held in person: see where above.', 409)
  if (!canJoin(s, now)) throw new LmsError(phaseOf(s, now) === 'upcoming' ? 'Join opens 15 minutes before the start.' : 'This session has ended.', 409)
  if (!l.readOnly) {
    const at = new Date(now).toISOString()
    if (r) await sb.from('lms_session_attendees').update({ joined_at: r.joined_at || at, ...(r.status === 'INVITED' || r.status === 'DECLINED' ? { status: 'REGISTERED', registered_at: r.registered_at || at } : {}) }).eq('id', r.id)
    else await sb.from('lms_session_attendees').insert({ company_id: s.company_id, session_id: id, learner_id: l.id, status: 'REGISTERED', source: 'SELF', registered_at: at, joined_at: at })
  }
  return { url: s.join_url }
}

export async function checkIn(l: Learner, id: string, code: string, now = Date.now()) {
  const { s, r } = await mySession(l, id)
  if (!r || !ACTIVE.includes(r.status)) throw new LmsError('Register for the session first.', 409)
  if (!canCheckIn(s, now)) throw new LmsError('Attendance can be recorded from the start of the session until an hour after it ends.', 409)
  if (!sameCode(code, s.checkin_code)) throw new LmsError('That code does not match. The host reads it out during the session.')
  if (!r.attended) must(await sb.from('lms_session_attendees').update({ attended: true, attended_at: new Date(now).toISOString(), attendance_by: 'CODE' }).eq('id', r.id).select('id'))
  await settleLive([r.learner_id], s.course_id)
  return { ok: true, attended: true }
}

export async function openRecording(l: Learner, id: string, now = Date.now()) {
  const { s, r } = await mySession(l, id)
  if (!s.recording_asset_id || s.status === 'CANCELLED') throw new LmsError('This session has no recording yet.', 409)
  const { data: a } = await sb.from('lms_assets').select('id, kind, storage_path, play_url, play_url_expires_at, poster_path, duration_s, status').eq('id', s.recording_asset_id).maybeSingle()
  if (!a || a.status !== 'READY') throw new LmsError('The recording is still being prepared.', 409)
  let row = r
  if (!l.readOnly) {
    const at = new Date(now).toISOString()
    if (row) await sb.from('lms_session_attendees').update({ recording_opened_at: row.recording_opened_at || at, recording_last_beat_at: at }).eq('id', row.id)
    else row = must(await sb.from('lms_session_attendees').insert({ company_id: s.company_id, session_id: id, learner_id: l.id, status: 'REGISTERED', source: 'SELF', recording_opened_at: at, recording_last_beat_at: at }).select('*').single())
  }
  return { url: await mediaUrl(a as any, now), duration_s: Number(a.duration_s || 0), position_s: Number(row?.recording_position_s || 0), watched_s: Number(row?.recording_watched_s || 0), done: !!row?.recording_done }
}

export async function recordingBeat(l: Learner, id: string, b: { played_s?: unknown; position?: unknown }, now = Date.now()) {
  const { s, r } = await mySession(l, id)
  if (!r) throw new LmsError('Open the recording first.', 409)
  const { data: a } = await sb.from('lms_assets').select('duration_s').eq('id', s.recording_asset_id).maybeSingle()
  const duration = Number(a?.duration_s || 0)
  const since = r.recording_last_beat_at || r.recording_opened_at || new Date(now).toISOString()
  const c = creditRecording({ watchedS: Number(r.recording_watched_s || 0), claimedS: Number(b.played_s) || 0, elapsedS: (now - new Date(since).getTime()) / 1000, durationS: duration })
  const justDone = c.done && !r.recording_done
  await sb.from('lms_session_attendees').update({
    recording_watched_s: c.watchedS, recording_position_s: Math.max(0, Math.min(Number(b.position) || 0, duration || 0)),
    recording_last_beat_at: new Date(now).toISOString(), ...(c.done ? { recording_done: true } : {}),
  }).eq('id', r.id)
  if (justDone) await settleLive([r.learner_id], s.course_id)
  return { watched_s: c.watchedS, done: !!r.recording_done || c.done, pct: duration ? Math.min(100, Math.round(c.watchedS / duration * 100)) : 0 }
}

export async function icsFor(l: Learner, id: string) {
  const { s } = await mySession(l, id)
  const { data: me } = await sb.from('lms_learners').select('full_name, email').eq('id', l.id).maybeSingle()
  return buildIcs({
    id: s.id, sequence: s.sequence, title: s.title, description: s.description, starts_at: s.starts_at, duration_min: s.duration_min,
    join_url: s.join_url, location: s.location, organizer: organizer(), attendee: me?.email ? { name: me.full_name, email: me.email } : null,
    cancelled: s.status === 'CANCELLED', page: learnUrl(`/live/${s.id}`),
  })
}

// ── Courses ─────────────────────────────────────────────────────────────────
/** Tick the LIVE lessons of this course for these learners' open enrolments. Never untick. */
export async function settleLive(learnerIds: string[], courseId: string | null) {
  if (!courseId || !learnerIds.length) return
  const { data: ens } = await sb.from('lms_enrollments').select('id, company_id, version_id').in('learner_id', learnerIds).eq('course_id', courseId).in('status', ['NOT_STARTED', 'IN_PROGRESS'])
  for (const e of (ens || []) as any[]) {
    const { data: lessons } = await sb.from('lms_lessons').select('id').eq('version_id', e.version_id).eq('kind', 'LIVE')
    if (!lessons?.length) continue
    must(await sb.from('lms_lesson_progress').upsert(lessons.map((x: any) => ({ company_id: e.company_id, enrollment_id: e.id, lesson_id: x.id, content_done: true })), { onConflict: 'enrollment_id,lesson_id' }).select('id'))
    await recompute(e.id)
  }
}

/** What a course's LIVE lesson shows: that course's sessions, and whether this learner has
 *  already earned it. Earned elsewhere (a session before they enrolled) counts here too. */
export async function liveForCourse(l: Learner, courseId: string, now = Date.now()) {
  const { data: rows } = await sb.from('lms_sessions').select(SESSION_COLS).eq('course_id', courseId).neq('status', 'CANCELLED').order('starts_at')
  const sessions = await decorate((rows || []) as any[])
  const ids = sessions.map(s => s.id)
  const { data: mineRows } = ids.length ? await sb.from('lms_session_attendees').select('*').in('session_id', ids).in('learner_id', l.allIds) : { data: [] as any[] }
  const R = new Map(((mineRows || []) as any[]).filter(r => r.status !== 'REMOVED').map(r => [r.session_id, r]))
  const list = sessions.map(s => forLearner(s, R.get(s.id) || null, now))
    // Past sessions matter only for their recording, or because this person attended.
    .filter(s => s.phase !== 'ended' || s.has_recording || s.me?.attended)
  const earned = [...R.values()].some(r => r.attended || r.recording_done)
  if (earned && !l.readOnly) await settleLive(l.allIds, courseId)
  return { sessions: list, earned, recording_pct: RECORDING_DONE_PCT }
}

// ── The daily job ───────────────────────────────────────────────────────────
async function mailMissed(sessionId: string, limit: number): Promise<number> {
  const s = await sessionRow(sessionId)
  if (s.status !== 'COMPLETED' || !s.recording_asset_id) return 0
  const settings = await settingsFor(s.company_id)
  const rows = must(await sb.from('lms_session_attendees').select('id, learner_id').eq('session_id', s.id).eq('status', 'REGISTERED').eq('attended', false).eq('recording_done', false).is('missed_mailed_at', null).limit(limit)) as any[]
  if (!rows.length) return 0
  const { data: people } = await sb.from('lms_learners').select('id, full_name, email, employee_id').in('id', rows.map(r => r.learner_id))
  const P = new Map((people || []).map((p: any) => [p.id, p]))
  let sent = 0
  for (const r of rows) {
    const p: any = P.get(r.learner_id)
    if (p?.employee_id) await notifyPerson(p.employee_id, 'LMS_ASSIGNED', 'Recording ready', s.title, `/learning/live/${s.id}`).catch(() => {})
    if (p && settings.email_enabled && ((await mailOne(s, { name: p.full_name, email: p.email }, 'missed').catch(() => ({ sent: false }))) as any).sent) sent++
    await sb.from('lms_session_attendees').update({ missed_mailed_at: new Date().toISOString() }).eq('id', r.id)
  }
  return sent
}

const istDay = (t: number) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10)

/** Run by /api/cron/lms-daily (06:00 IST): invitations still owed, the day-before and
 *  same-day reminders, and the recording for people who registered and missed it. */
export async function liveDaily(now = Date.now(), budget = 300) {
  const out = { invites: 0, reminders: 0, missed: 0 }
  const today = istDay(now), tomorrow = istDay(now + 86_400_000)
  const { data: soon } = await sb.from('lms_sessions').select(SESSION_COLS).eq('status', 'SCHEDULED')
    .gte('starts_at', new Date(now - 6 * 3600_000).toISOString()).lte('starts_at', new Date(now + 3 * 86_400_000).toISOString())
  for (const s of (soon || []) as any[]) {
    if (budget <= 0) break
    const m = await mailOwed(s.id, budget)
    out.invites += m.sent; budget -= m.sent
    const day = istDay(new Date(s.starts_at).getTime())
    const kind = day === tomorrow ? 'day_before' : day === today && new Date(s.starts_at).getTime() > now ? 'same_day' : null
    if (!kind) continue
    const col = kind === 'day_before' ? 'day_before_mailed_at' : 'same_day_mailed_at'
    const settings = await settingsFor(s.company_id)
    const rows = must(await sb.from('lms_session_attendees').select('id, learner_id').eq('session_id', s.id).in('status', ACTIVE).is(col, null).limit(Math.max(0, budget))) as any[]
    if (!rows.length) continue
    const { data: people } = await sb.from('lms_learners').select('id, full_name, email, employee_id').in('id', rows.map(r => r.learner_id))
    const P = new Map((people || []).map((p: any) => [p.id, p]))
    for (const r of rows) {
      const p: any = P.get(r.learner_id)
      if (p?.employee_id) await notifyPerson(p.employee_id, 'LMS_DUE_SOON', kind === 'day_before' ? 'Live session tomorrow' : 'Live session today', `${s.title} · ${whenWords(s.starts_at)}`, `/learning/live/${s.id}`).catch(() => {})
      if (p && settings.email_enabled && ((await mailOne(s, { name: p.full_name, email: p.email }, kind).catch(() => ({ sent: false }))) as any).sent) { out.reminders++; budget-- }
      await sb.from('lms_session_attendees').update({ [col]: new Date(now).toISOString() }).eq('id', r.id)
    }
  }
  const { data: done } = await sb.from('lms_sessions').select('id').eq('status', 'COMPLETED').not('recording_asset_id', 'is', null).gte('starts_at', new Date(now - 30 * 86_400_000).toISOString())
  for (const s of (done || []) as any[]) {
    if (budget <= 0) break
    const n = await mailMissed(s.id, budget)
    out.missed += n; budget -= n
  }
  return out
}
