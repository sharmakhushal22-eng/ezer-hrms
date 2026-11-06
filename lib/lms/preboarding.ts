// lib/lms/preboarding.ts — learning before day one. Server only.
//
// A candidate gets a personal link, proves the mailbox with a one-time code, and then sees
// their assigned courses and nothing else. They hold no ESS account: their token is a
// different kind (lib/lms/candidate-session.ts) that only the /api/lms/me routes accept.
//
// When the employee record is created the same learner row becomes theirs, so everything
// they did carries over, and the link dies at that moment.
import { loadJoiners } from '@/lib/recruitment/joiners'
import { audit, LmsError, must, notFound, sb, settingsFor } from './server'
import { inScope, type LmsActor } from './access'
import { hashLinkToken, issueCandidateToken, newLinkToken, newOtp, otpHmac } from './candidate-session'
import { appBase, deliverable, mailLearner, shell } from './notify'

const OTP_TTL_MS = 10 * 60_000
const MAX_OTP_TRIES = 5
const MAX_OTP_SENDS = 8
const CLOSED = ['EMPLOYEE_CREATED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']

const mask = (e: string | null) => {
  if (!e) return ''
  const [u, d] = e.split('@')
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`
}

/** Everyone HR could invite: those in onboarding, and accepted offers not there yet. */
export async function listCandidates(companies: string[], locationId: string | null = null) {
  const [{ data: ob }, joiners, learners] = await Promise.all([
    sb.from('onboarding_candidates').select('id, candidate_id, company_id, location_id, full_name, email, designation, department_id, date_of_joining, status').in('company_id', companies).order('date_of_joining', { ascending: true }).limit(500),
    loadJoiners(sb).catch(() => ({ joiners: [] as any[] })),
    sb.from('lms_learners').select('id, full_name, email, kind, status, onboarding_candidate_id, recruit_candidate_id, date_of_joining, designation, company_id, converted_at').in('company_id', companies).or('kind.eq.CANDIDATE,converted_at.not.is.null').limit(1000),
  ])
  // A branch-limited person sees joiners of their branch. A candidate with no location on
  // record can only be someone they invited themselves, so those rest on invited_by below.
  const inBranch = (obId: string | null) => !locationId || (ob || []).some((c: any) => c.id === obId && c.location_id === locationId)
  const allLearners = (learners.data || []) as any[]
  const ids = allLearners.map(l => l.id)
  const [{ data: access }, { data: enrols }] = await Promise.all([
    ids.length ? sb.from('lms_candidate_access').select('learner_id, invited_at, invited_by_name, last_login_at, token_expires_at, revoked_at').in('learner_id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? sb.from('lms_enrollments').select('learner_id, status').in('learner_id', ids).not('status', 'in', '(CANCELLED,REJECTED)') : Promise.resolve({ data: [] as any[] }),
  ])
  const ls = locationId
    ? allLearners.filter(l => inBranch(l.onboarding_candidate_id))
    : allLearners
  const invited = ls.map(l => {
    const acc = (access || []).find((a: any) => a.learner_id === l.id)
    const mine = (enrols || []).filter((e: any) => e.learner_id === l.id)
    return { ...l, invited_at: acc?.invited_at || null, last_login_at: acc?.last_login_at || null, token_expires_at: acc?.token_expires_at || null, revoked_at: acc?.revoked_at || null, assigned: mine.length, completed: mine.filter((e: any) => e.status === 'COMPLETED').length }
  })
  const has = (onb?: string | null, rec?: string | null) => allLearners.some(l => (onb && l.onboarding_candidate_id === onb) || (rec && l.recruit_candidate_id === rec))
  const pending: any[] = []
  for (const c of (ob || []) as any[]) {
    if (CLOSED.includes(c.status) || has(c.id, c.candidate_id) || !inBranch(c.id)) continue
    pending.push({ source: 'ONBOARDING', onboarding_candidate_id: c.id, recruit_candidate_id: c.candidate_id, company_id: c.company_id, full_name: c.full_name, email: c.email, designation: c.designation, department_id: c.department_id, date_of_joining: c.date_of_joining })
  }
  const inOb = new Set((ob || []).map((c: any) => c.candidate_id).filter(Boolean))
  for (const j of (joiners.joiners || []) as any[]) {
    if (!j.companyId || !companies.includes(j.companyId) || inOb.has(j.cand.id) || has(null, j.cand.id)) continue
    if (locationId && j.mrf?.location_id !== locationId) continue
    pending.push({ source: 'OFFER', onboarding_candidate_id: null, recruit_candidate_id: j.cand.id, company_id: j.companyId, full_name: j.cand.full_name, email: j.cand.email, designation: j.role, department_id: j.mrf?.department_id || null, date_of_joining: j.doj })
  }
  return { invited, pending }
}

async function issueLink(learnerId: string, company: string, by: string, days: number) {
  const { token, hash } = newLinkToken()
  const expires = new Date(Date.now() + days * 86_400_000).toISOString()
  const { data: cur } = await sb.from('lms_candidate_access').select('session_version').eq('learner_id', learnerId).maybeSingle()
  must(await sb.from('lms_candidate_access').upsert({
    learner_id: learnerId, company_id: company, token_hash: hash, token_expires_at: expires, invited_at: new Date().toISOString(), invited_by_name: by,
    session_version: (cur?.session_version || 0) + 1, otp_hmac: null, otp_expires_at: null, otp_attempts: 0, otp_sent_count: 0, revoked_at: null,
  }, { onConflict: 'learner_id' }).select('learner_id'))
  return { token, link: `${appBase()}/learn/${token}`, expires }
}

async function mailInvite(l: { full_name: string; email: string | null }, company: string, link: string, expires: string) {
  const { data: co } = await sb.from('companies').select('company_name').eq('id', company).maybeSingle()
  const name = co?.company_name || 'your new company'
  const day = new Date(expires).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
  return mailLearner(l.email, `Before you join ${name}: your learning`,
    shell({
      title: `Welcome to ${name}`,
      body: `Dear ${String(l.full_name).replace(/[<>&]/g, '')},<br><br>A few short lessons are ready for you to go through before your first day. You will confirm your e-mail with a one-time code, and your progress is saved as you go.<br><br><span style="color:#64748b;font-size:12.5px">This link is valid until ${day}.</span>`,
      cta: { label: 'Start learning', href: link },
      foot: 'This link is personal to you. Please do not forward it.',
    }),
    `Before you join ${name}, a few short lessons are ready for you: ${link}`)
}

/** Invite one person. Applies every active pre-joining template that fits them, plus
 *  anything HR picked by hand. */
export async function inviteCandidate(a: LmsActor, company: string, b: any) {
  const s = await settingsFor(company)
  if (!s.preboarding_enabled) throw new LmsError('Pre-joining learning is switched off in Learning settings.', 409)
  const email = String(b?.email || '').trim().toLowerCase()
  const name = String(b?.full_name || '').trim()
  if (!name) throw new LmsError('Enter the candidate\'s name.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LmsError('Enter a valid e-mail: the one-time code goes there.')

  const { data: already } = await sb.from('lms_learners').select('id, kind, status').eq('company_id', company).eq('kind', 'CANDIDATE').ilike('email', email).maybeSingle()
  let learnerId = already?.id as string | undefined
  if (learnerId) {
    must(await sb.from('lms_learners').update({ status: 'ACTIVE', full_name: name }).eq('id', learnerId).select('id'))
  } else {
    const made = must(await sb.from('lms_learners').insert({
      company_id: company, kind: 'CANDIDATE', full_name: name, email, designation: b?.designation || null, department_id: b?.department_id || null,
      date_of_joining: b?.date_of_joining || null, onboarding_candidate_id: b?.onboarding_candidate_id || null, recruit_candidate_id: b?.recruit_candidate_id || null,
    }).select('id').single()) as any
    learnerId = made.id
  }
  const { link, expires } = await issueLink(learnerId!, company, a.label, s.preboarding_link_days)

  const { data: tpl } = await sb.from('lms_assignments').select('id').eq('company_id', company).eq('trigger_type', 'PREBOARD').eq('status', 'ACTIVE')
  let enrolled = 0
  for (const t of tpl || []) enrolled += Number(((await sb.rpc('lms_apply_assignment', { p_assignment: t.id })).data as any)?.enrolled || 0)
  const items = (Array.isArray(b?.items) ? b.items : []).filter((i: any) => i?.course_id || i?.path_id)
  if (items.length) {
    const asg = must(await sb.from('lms_assignments').insert({
      company_id: company, name: `Pre-joining: ${name}`, trigger_type: 'ONCE', mandatory: b?.mandatory ?? true, due_mode: b?.date_of_joining ? 'BEFORE_JOIN' : 'AFTER_ASSIGN', due_days: b?.date_of_joining ? 1 : s.default_due_days, created_by_id: a.employeeId, created_by_name: a.label, last_applied_at: new Date().toISOString(),
    }).select('id').single()) as any
    must(await sb.from('lms_assignment_items').insert(items.map((i: any, n: number) => ({ company_id: company, assignment_id: asg.id, course_id: i.course_id || null, path_id: i.path_id || null, position: n }))).select('id'))
    const n = Number(must(await sb.rpc('lms_enrol_learners', { p_assignment: asg.id, p_learners: [learnerId] }))) || 0
    if (n) await sb.from('lms_assignments').update({ enrolled_count: n }).eq('id', asg.id)
    enrolled += n
  }
  const sent = await mailInvite({ full_name: name, email }, company, link, expires)
  await audit({ companyId: company, actorId: a.employeeId, actorLabel: a.label, action: 'CANDIDATE_INVITED', entity: 'learner', entityId: learnerId, detail: { enrolled, mailed: !!(sent as any).sent } })
  // The link goes back to HR too, for a mailbox that bounces. Only its hash is stored, so
  // this response is the one place outside the mail where it exists.
  return { learner_id: learnerId, enrolled, mailed: !!(sent as any).sent, deliverable: deliverable(email), link }
}

async function candidateOf(a: LmsActor, learnerId: string) {
  const { data: l } = await sb.from('lms_learners').select('*').eq('id', learnerId).maybeSingle()
  if (!l || l.kind !== 'CANDIDATE') throw notFound('That candidate')
  inScope(a, l.company_id, 'That candidate')
  if (a.locationId) {
    const { data: ob } = l.onboarding_candidate_id
      ? await sb.from('onboarding_candidates').select('location_id').eq('id', l.onboarding_candidate_id).maybeSingle()
      : { data: null as any }
    if (ob?.location_id !== a.locationId) throw notFound('That candidate')
  }
  return l
}

export async function resendInvite(a: LmsActor, learnerId: string) {
  const l = await candidateOf(a, learnerId)
  const s = await settingsFor(l.company_id)
  const { link, expires } = await issueLink(l.id, l.company_id, a.label, s.preboarding_link_days)
  must(await sb.from('lms_learners').update({ status: 'ACTIVE' }).eq('id', l.id).select('id'))
  const sent = await mailInvite(l, l.company_id, link, expires)
  await audit({ companyId: l.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'CANDIDATE_RESENT', entity: 'learner', entityId: l.id })
  return { mailed: !!(sent as any).sent, link }
}

export async function revokeCandidate(a: LmsActor, learnerId: string) {
  const l = await candidateOf(a, learnerId)
  const { data: acc } = await sb.from('lms_candidate_access').select('session_version').eq('learner_id', l.id).maybeSingle()
  must(await sb.from('lms_learners').update({ status: 'REVOKED' }).eq('id', l.id).select('id'))
  must(await sb.from('lms_candidate_access').update({ revoked_at: new Date().toISOString(), session_version: (acc?.session_version || 0) + 1 }).eq('learner_id', l.id).select('learner_id'))
  await sb.from('lms_enrollments').update({ status: 'CANCELLED', decision_note: `Access revoked by ${a.label}` }).eq('learner_id', l.id).in('status', ['NOT_STARTED', 'IN_PROGRESS'])
  await audit({ companyId: l.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'CANDIDATE_REVOKED', entity: 'learner', entityId: l.id })
  return { ok: true }
}

// ── The candidate's own sign-in ─────────────────────────────────────────────
/** An invalid, expired or revoked link all look the same from outside. */
async function linkRow(token: string) {
  const { data: acc } = await sb.from('lms_candidate_access').select('*').eq('token_hash', hashLinkToken(token)).maybeSingle()
  if (!acc || acc.revoked_at || new Date(acc.token_expires_at).getTime() < Date.now()) throw new LmsError('This link is not valid any more. Ask HR for a new one.', 404)
  const { data: l } = await sb.from('lms_learners').select('id, company_id, full_name, email, kind, status').eq('id', acc.learner_id).maybeSingle()
  if (!l || l.kind !== 'CANDIDATE' || l.status !== 'ACTIVE') throw new LmsError('This link is not valid any more. Ask HR for a new one.', 404)
  return { acc, l }
}

export async function openLink(token: string) {
  const { l } = await linkRow(token)
  const { data: co } = await sb.from('companies').select('company_name').eq('id', l.company_id).maybeSingle()
  return { first_name: String(l.full_name).split(' ')[0], company: co?.company_name || null, email: mask(l.email) }
}

export async function sendOtp(token: string) {
  const { acc, l } = await linkRow(token)
  if (acc.otp_sent_count >= MAX_OTP_SENDS) throw new LmsError('Too many codes sent. Ask HR for a new link.', 429)
  const otp = newOtp()
  must(await sb.from('lms_candidate_access').update({
    otp_hmac: otpHmac(l.id, otp), otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(), otp_attempts: 0, otp_sent_count: acc.otp_sent_count + 1,
  }).eq('learner_id', l.id).select('learner_id'))
  const sent = await mailLearner(l.email, `${otp} is your EZER Learn code`,
    shell({ title: 'Your one-time code', body: `Use this code to open your learning:<br><br><span style="font-size:28px;font-weight:700;letter-spacing:.2em">${otp}</span><br><br><span style="color:#64748b;font-size:12.5px">It is valid for 10 minutes.</span>` }),
    `Your EZER Learn code is ${otp}. It is valid for 10 minutes.`)
  return { sent: !!(sent as any).sent, email: mask(l.email) }
}

export async function verifyOtp(token: string, otp: string) {
  const { acc, l } = await linkRow(token)
  if (!acc.otp_hmac || !acc.otp_expires_at || new Date(acc.otp_expires_at).getTime() < Date.now()) throw new LmsError('That code has expired. Send a new one.', 400)
  if (acc.otp_attempts >= MAX_OTP_TRIES) throw new LmsError('Too many wrong codes. Send a new one.', 429)
  if (otpHmac(l.id, String(otp || '').trim()) !== acc.otp_hmac) {
    await sb.from('lms_candidate_access').update({ otp_attempts: acc.otp_attempts + 1 }).eq('learner_id', l.id)
    throw new LmsError('That code is not right.', 400)
  }
  // Single use.
  must(await sb.from('lms_candidate_access').update({ otp_hmac: null, otp_expires_at: null, otp_attempts: 0, last_login_at: new Date().toISOString() }).eq('learner_id', l.id).select('learner_id'))
  const session = issueCandidateToken(l.id, acc.session_version)
  if (!session) throw new LmsError('Sign-in is not available right now.', 503)
  return { session, name: l.full_name }
}

// ── Joining ─────────────────────────────────────────────────────────────────
/** The onboarding hook: a candidate just became an employee. Best effort, because the
 *  employee record is the outcome and learning must never be the reason it fails; the daily
 *  job finds anything this misses. Their onboarding courses follow. */
export async function onEmployeeCreated(onboardingId: string, employeeId: string) {
  const { data: emp } = await sb.from('employees').select('company_id, office_email, personal_email').eq('id', employeeId).maybeSingle()
  if (!emp) return { converted: false }
  const { data: ob } = await sb.from('onboarding_candidates').select('candidate_id, email').eq('id', onboardingId).maybeSingle()
  const { data: rows } = await sb.from('lms_learners').select('id, onboarding_candidate_id, recruit_candidate_id, email').eq('company_id', emp.company_id).eq('kind', 'CANDIDATE')
  const emails = [ob?.email, emp.office_email, emp.personal_email].filter(Boolean).map(e => String(e).toLowerCase())
  const hit = (rows || []).find((l: any) => l.onboarding_candidate_id === onboardingId)
    || (rows || []).find((l: any) => ob?.candidate_id && l.recruit_candidate_id === ob.candidate_id)
    || (rows || []).find((l: any) => l.email && emails.includes(String(l.email).toLowerCase()))
  let converted = false
  if (hit) {
    const r = must(await sb.rpc('lms_convert_candidate', { p_learner: hit.id, p_employee: employeeId })) as any
    converted = !!r?.converted
  }
  const enrolled = must(await sb.rpc('lms_on_join', { p_employee: employeeId }))
  return { converted, enrolled }
}

/** Daily: conversions the hook missed, and candidates a PREBOARD template should reach. */
export async function preboardingSweep() {
  const out = { converted: 0, invited: 0, errors: [] as string[] }
  const { data: open } = await sb.from('lms_learners').select('id, onboarding_candidate_id, company_id').eq('kind', 'CANDIDATE').eq('status', 'ACTIVE').not('onboarding_candidate_id', 'is', null)
  for (const l of open || []) {
    const { data: ob } = await sb.from('onboarding_candidates').select('employee_id').eq('id', l.onboarding_candidate_id).maybeSingle()
    if (ob?.employee_id) {
      const r = await onEmployeeCreated(l.onboarding_candidate_id, ob.employee_id).catch(e => { out.errors.push(String(e?.message || e)); return { converted: false } })
      if (r.converted) out.converted++
    }
  }
  const { data: tpl } = await sb.from('lms_assignments').select('company_id').eq('trigger_type', 'PREBOARD').eq('status', 'ACTIVE')
  const companies = [...new Set((tpl || []).map((t: any) => t.company_id))]
  const today = new Date().toISOString().slice(0, 10)
  for (const company of companies) {
    const s = await settingsFor(company)
    if (!s.enabled || !s.preboarding_enabled) continue
    const { pending } = await listCandidates([company])
    for (const p of pending.filter(x => x.email && x.date_of_joining && x.date_of_joining >= today).slice(0, 30)) {
      const system: LmsActor = { grant: {} as any, caps: {} as any, employeeId: null, label: 'Automatic', companies: [company], locationId: null }
      await inviteCandidate(system, company, p).then(() => { out.invited++ }).catch(e => out.errors.push(String(e?.message || e)))
    }
  }
  return out
}
