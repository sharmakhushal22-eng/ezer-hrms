// lib/lms/room.ts — the webinar room. Server only.
//
// A live session (lib/lms/live.ts) can be watched inside EZER Learn: a YouTube or Vimeo live
// stream, or an HLS address, on the stage; or, for a session held in Zoom, Meet or Teams, the
// Join button with the room beside it. Around the stage the room keeps a chat, questions people
// upvote and the host answers, polls, and attendance counted from time spent in the room.
//
// Live updates travel over Supabase Realtime broadcast, and only this file sends them, through
// the REST endpoint with the service key. The channel's name is an HMAC of the session id, handed
// only to people allowed in the room. Browsers listen; the one thing they send each other is
// emoji reactions, which are never stored. Because anyone holding the name could still inject a
// message into the channel, every browser also reloads the room from this API every half minute
// and on returning to the tab, so nothing that did not come from here survives on screen.
//
// Who may do what is decided here on every call, as everywhere in Learning: people on the
// session's list (or anyone in the company, for an open session) may watch and take part; the
// session's named host, and Studio users with assignment rights in that company, run it.
import { createHash, createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { audit, allRows, LmsError, must, notFound, sb } from './server'
import { lmsAdmin, type LmsActor } from './access'
import { lmsLearner, type Learner } from './learner'
import { settleLive } from './live'
import {
  ANSWER_MAX, CHAT_GAP_MS, CHAT_MAX, PRESENT_WINDOW_S, QUESTION_GAP_MS, QUESTION_MAX, attendNeedS, cleanPoll, cleanText, creditBeat, creditOpen,
  mayPost, roomPhase, stageFor, tally,
} from './room-core'

const CHAT_SHOWN = 150
const QUESTIONS_SHOWN = 300
/** A poll's running count goes out at most this often while votes pour in; small polls, every vote. */
const POLL_PUSH_GAP_MS = 1500
const POLL_PUSH_ALWAYS_UNDER = 50

// ── Who is asking ───────────────────────────────────────────────────────────
export interface RoomCaller {
  learner: Learner | null
  actor: LmsActor | null
  host: boolean
  name: string
}

/** Whether a Studio user may run a given session is looked up once a minute, not on every chat line. */
const HOST_TTL_MS = 60_000
const hostCache = new Map<string, { at: number; host: boolean; actor: LmsActor | null }>()

const tokenKey = (req: NextRequest) => createHash('sha256').update(req.headers.get('authorization') || '').digest('base64url').slice(0, 22)

async function sessionRow(id: string) {
  const { data, error } = await sb.from('lms_sessions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw notFound('That session')
  // Read with *, so a database without 227 simply lacks the column: say how to fix it.
  if (!('stream_kind' in data)) throw new Error('column lms_sessions.stream_kind does not exist')
  return data as any
}

async function studioHost(req: NextRequest, s: any, key: string): Promise<{ host: boolean; actor: LmsActor | null }> {
  const k = `${key}:${s.id}`
  const hit = hostCache.get(k)
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit
  const { actor } = await lmsAdmin(req)
  const host = !!actor && (
    (!!actor.employeeId && actor.employeeId === s.host_employee_id) ||
    (actor.caps.assign && (!actor.companies || actor.companies.includes(s.company_id)))
  )
  const out = { at: Date.now(), host, actor }
  hostCache.set(k, out)
  if (hostCache.size > 5000) hostCache.clear()
  return out
}

/** The person behind a room request and their part in it, or the response that refuses them.
 *  `full` also works out Studio host rights for someone who arrived as a learner; the busy
 *  calls (chat, votes, heartbeats) skip that unless the minute-long cache already knows, or the
 *  browser says its person is hosting. Each server instance has its own cache, so the claim is
 *  what keeps a host's chat line from being refused on an instance that has not met them. */
export async function roomCaller(req: NextRequest, id: string, full: boolean): Promise<{ s: any; who: RoomCaller; error: null } | { s: null; who: null; error: NextResponse }> {
  const s = await sessionRow(id)
  const key = tokenKey(req)
  const { learner, error } = await lmsLearner(req)
  if (learner) {
    let host = !!learner.employeeId && learner.employeeId === s.host_employee_id
    let actor: LmsActor | null = null
    if (!host && learner.kind === 'EMPLOYEE' && !learner.readOnly) {
      const hit = hostCache.get(`${key}:${s.id}`)
      if (full || (hit && Date.now() - hit.at < HOST_TTL_MS)) ({ host, actor } = await studioHost(req, s, key))
    }
    return { s, who: { learner, actor, host, name: learner.name }, error: null }
  }
  // Not a learner: a dashboard login running the session from the Studio.
  const st = await studioHost(req, s, key)
  if (st.actor && st.host) return { s, who: { learner: null, actor: st.actor, host: true, name: st.actor.label }, error: null }
  return { s: null, who: null, error: error || NextResponse.json({ error: 'That session was not found.' }, { status: 404 }) }
}

/** The caller's attendee row, and whether they may be in this room at all. */
async function placeOf(s: any, who: RoomCaller) {
  const l = who.learner
  if (!l) return { row: null as any, allowed: who.host }
  const { data: row } = await sb.from('lms_session_attendees').select('*').eq('session_id', s.id).in('learner_id', l.allIds).maybeSingle()
  const onIt = row && row.status !== 'REMOVED'
  const open = !!s.open_registration && s.company_id === l.companyId && l.kind === 'EMPLOYEE'
  return { row: onIt ? row : null, allowed: who.host || !!onIt || open }
}

async function mustEnter(s: any, who: RoomCaller) {
  if (s.room_enabled === false && !who.host) throw new LmsError('This session has no room in EZER Learn. Use Join on the Live sessions page.', 409)
  const p = await placeOf(s, who)
  if (!p.allowed) throw notFound('That session')
  return p
}

// ── The channel ─────────────────────────────────────────────────────────────
const secret = () => process.env.LMS_ROOM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ESS_SESSION_SECRET || 'ezer-room'

/** The channel's name: unguessable without the server's secret, the same for everyone in the room. */
export const topicFor = (sessionId: string) => `room-${createHmac('sha256', secret()).update(`lms-room:${sessionId}`).digest('base64url').slice(0, 32)}`

/** Send one event to everyone in the room. Best effort and quick: the half-minute reload in each
 *  browser catches anything lost, so a slow Realtime never holds up a chat line. */
export async function push(sessionId: string, event: string, payload: unknown): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 1500)
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST', signal: ctl.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: topicFor(sessionId), event, payload }] }),
    })
    return r.ok
  } catch { return false } finally { clearTimeout(t) }
}

// ── Shapes ──────────────────────────────────────────────────────────────────
interface MsgRow {
  id: string; learner_id: string | null; author_name: string; is_host: boolean; kind: 'CHAT' | 'QUESTION'; body: string; anonymous: boolean
  upvotes: number; answered_at: string | null; answer: string | null; hidden_at: string | null; created_at: string
}
const MSG_COLS = 'id, learner_id, author_name, is_host, kind, body, anonymous, upvotes, answered_at, answer, hidden_at, created_at'

/** A message as one viewer may see it. An anonymous question carries no name except for the
 *  host, and nobody else is ever sent who wrote what. */
function shape(m: MsgRow, host: boolean, mine: Set<string>) {
  return {
    id: m.id, kind: m.kind, body: m.body, author: m.anonymous && !host ? 'Anonymous' : m.author_name, anonymous: m.anonymous, is_host: m.is_host,
    upvotes: m.upvotes, answered_at: m.answered_at, answer: m.answer, hidden: !!m.hidden_at, created_at: m.created_at,
    mine: !!m.learner_id && mine.has(m.learner_id),
  }
}
const publicShape = (m: MsgRow) => shape(m, false, new Set())

function pollShape(p: any, counts: number[] | null, myVote: number | null) {
  return {
    id: p.id, question: p.question, options: p.options as string[], status: p.status, show_results: p.show_results, created_at: p.created_at,
    counts, total: counts ? counts.reduce((a, b) => a + b, 0) : null, my_vote: myVote,
  }
}

function roomFlags(s: any, now = Date.now()) {
  return {
    phase: roomPhase(s, now), live_started_at: s.live_started_at, live_ended_at: s.live_ended_at,
    room_chat: s.room_chat !== false, room_questions: s.room_questions !== false, pinned_message_id: s.pinned_message_id || null,
  }
}

async function viewers(sessionId: string, now = Date.now()) {
  const { count } = await sb.from('lms_session_attendees').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)
    .gte('room_last_beat_at', new Date(now - PRESENT_WINDOW_S * 1000).toISOString())
  return count || 0
}

// ── Reading the room ────────────────────────────────────────────────────────
export async function roomState(s: any, who: RoomCaller, now = Date.now()) {
  const { row } = await mustEnter(s, who)
  const host = who.host
  const mineIds = new Set(who.learner?.allIds || [])
  const [chatRes, qRes, pollsRes, n, course, rec] = await Promise.all([
    sb.from('lms_session_messages').select(MSG_COLS).eq('session_id', s.id).eq('kind', 'CHAT').order('created_at', { ascending: false }).limit(CHAT_SHOWN),
    sb.from('lms_session_messages').select(MSG_COLS).eq('session_id', s.id).eq('kind', 'QUESTION').order('created_at', { ascending: false }).limit(QUESTIONS_SHOWN),
    sb.from('lms_session_polls').select('*').eq('session_id', s.id).order('created_at', { ascending: false }).limit(50),
    viewers(s.id, now),
    s.course_id ? sb.from('lms_courses').select('title').eq('id', s.course_id).maybeSingle() : Promise.resolve({ data: null as any }),
    s.recording_asset_id ? sb.from('lms_assets').select('status').eq('id', s.recording_asset_id).maybeSingle() : Promise.resolve({ data: null as any }),
  ])
  const chat = (must(chatRes) as MsgRow[]).reverse()
  const questions = must(qRes) as MsgRow[]
  const polls = must(pollsRes) as any[]
  const pollIds = polls.map(p => p.id), qIds = questions.map(q => q.id)
  const [votes, myVotes] = await Promise.all([
    pollIds.length ? allRows<any>((f, t) => sb.from('lms_session_poll_votes').select('poll_id, learner_id, option_idx').in('poll_id', pollIds).range(f, t) as any) : Promise.resolve([] as any[]),
    who.learner && qIds.length ? sb.from('lms_session_votes').select('message_id').in('learner_id', who.learner.allIds).in('message_id', qIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const visible = (m: MsgRow) => host || !m.hidden_at
  let pinned: MsgRow | null = null
  if (s.pinned_message_id) {
    pinned = [...chat, ...questions].find(m => m.id === s.pinned_message_id) || null
    if (!pinned) pinned = ((await sb.from('lms_session_messages').select(MSG_COLS).eq('id', s.pinned_message_id).maybeSingle()).data as MsgRow) || null
    if (pinned?.hidden_at) pinned = null
  }
  const { stage } = stageFor(s.stream_kind, s.stream_url)
  const need = attendNeedS(s.duration_min, s.room_attend_pct)
  return {
    session: {
      id: s.id, title: s.title, description: s.description, host_name: s.host_name, starts_at: s.starts_at,
      ends_at: new Date(new Date(s.starts_at).getTime() + s.duration_min * 60_000).toISOString(), duration_min: s.duration_min,
      status: s.status, course_title: course?.data?.title || null, stream_kind: s.stream_kind || 'MEETING', has_link: !!s.join_url, location: s.location,
      has_recording: !!s.recording_asset_id && rec?.data?.status === 'READY' && s.status !== 'CANCELLED',
      ...roomFlags(s, now),
    },
    stage,
    // The meeting link goes to the host as is; everyone else asks for it through Join, which
    // hands it out only while the session is open (lib/lms/live.ts).
    host_join_url: host ? s.join_url || null : null,
    checkin_code: host ? s.checkin_code : null,
    me: {
      name: who.name, host, learner: !!who.learner, read_only: !!who.learner?.readOnly,
      can_post: !who.learner?.readOnly && (!!who.learner || host),
      attended: !!row?.attended, attendance_by: row?.attendance_by || null, room_seconds: Number(row?.room_seconds || 0), need_s: need,
    },
    topic: topicFor(s.id),
    viewers: n,
    chat: chat.filter(visible).map(m => shape(m, host, mineIds)),
    questions: questions.filter(visible).map(m => shape(m, host, mineIds)),
    my_votes: ((myVotes as any).data || []).map((v: any) => v.message_id),
    polls: polls.map(p => {
      const mine = votes.find(v => v.poll_id === p.id && mineIds.has(v.learner_id))
      const counts = tally((p.options as string[]).length, votes.filter(v => v.poll_id === p.id))
      const see = host || (p.show_results && (mine || p.status === 'CLOSED'))
      return pollShape(p, see ? counts : null, mine ? mine.option_idx : null)
    }),
    pinned: pinned ? shape(pinned, host, mineIds) : null,
    server_now: new Date(now).toISOString(),
  }
}

// ── Taking part ─────────────────────────────────────────────────────────────
function mustAct(who: RoomCaller) {
  if (who.learner?.readOnly) throw new LmsError('You are viewing someone else\'s portal. Only they can take part.', 403)
}

async function lastPost(sessionId: string, learnerId: string, kind: 'CHAT' | 'QUESTION') {
  const { data } = await sb.from('lms_session_messages').select('created_at').eq('session_id', sessionId).eq('learner_id', learnerId).eq('kind', kind)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data?.created_at as string) || null
}

export async function postMessage(s: any, who: RoomCaller, kind: 'CHAT' | 'QUESTION', b: { body?: unknown; anonymous?: unknown }, now = Date.now()) {
  mustAct(who)
  await mustEnter(s, who)
  const phase = roomPhase(s, now)
  if (phase === 'cancelled') throw new LmsError('This session was cancelled.', 409)
  if (kind === 'CHAT' && s.room_chat === false && !who.host) throw new LmsError('The host has turned chat off.', 409)
  if (kind === 'QUESTION') {
    if (s.room_questions === false) throw new LmsError('The host is not taking questions right now.', 409)
    if (!who.learner) throw new LmsError('Questions are asked by attendees.', 409)
  }
  const body = cleanText(b.body, kind === 'CHAT' ? CHAT_MAX : QUESTION_MAX)
  if (!body) throw new LmsError(`Write something first (up to ${kind === 'CHAT' ? CHAT_MAX : QUESTION_MAX} characters).`)
  if (who.learner && !who.host && !mayPost(await lastPost(s.id, who.learner.id, kind), now, kind === 'CHAT' ? CHAT_GAP_MS : QUESTION_GAP_MS))
    throw new LmsError(kind === 'CHAT' ? 'Slow down a little: one message every two seconds.' : 'One question every ten seconds, please.', 429)
  const row = must(await sb.from('lms_session_messages').insert({
    company_id: s.company_id, session_id: s.id, learner_id: who.learner?.id || null, author_name: who.name.slice(0, 120), is_host: who.host,
    kind, body, anonymous: kind === 'QUESTION' && !!b.anonymous,
  }).select(MSG_COLS).single()) as MsgRow
  await push(s.id, 'msg', publicShape(row))
  return { message: shape(row, who.host, new Set(who.learner?.allIds || [])) }
}

/** One upvote per person per question; pressing again takes it back. The count is recounted
 *  from the votes, so two people voting at once cannot lose one. */
export async function voteQuestion(s: any, who: RoomCaller, messageId: string, on: boolean) {
  mustAct(who)
  if (!who.learner) throw new LmsError('Votes are for attendees.', 409)
  await mustEnter(s, who)
  const { data: m } = await sb.from('lms_session_messages').select(MSG_COLS).eq('id', messageId).eq('session_id', s.id).eq('kind', 'QUESTION').maybeSingle()
  if (!m || m.hidden_at) throw notFound('That question')
  if (on) {
    const { error } = await sb.from('lms_session_votes').insert({ message_id: messageId, learner_id: who.learner.id })
    if (error && error.code !== '23505') throw error
  } else {
    must(await sb.from('lms_session_votes').delete().eq('message_id', messageId).in('learner_id', who.learner.allIds).select('message_id'))
  }
  const { count } = await sb.from('lms_session_votes').select('message_id', { count: 'exact', head: true }).eq('message_id', messageId)
  const next = must(await sb.from('lms_session_messages').update({ upvotes: count || 0 }).eq('id', messageId).select(MSG_COLS).single()) as MsgRow
  await push(s.id, 'msg', publicShape(next))
  return { upvotes: next.upvotes, voted: on }
}

const lastPollPush = new Map<string, number>()

async function pollCounts(p: any) {
  const votes = await allRows<any>((f, t) => sb.from('lms_session_poll_votes').select('option_idx').eq('poll_id', p.id).range(f, t) as any)
  return tally((p.options as string[]).length, votes)
}

/** Tell the room about a poll. Results go to everyone only when the poll shows them; otherwise
 *  the host's screen reloads to see the count. */
async function pushPoll(s: any, p: any, force: boolean) {
  const counts = await pollCounts(p)
  const total = counts.reduce((a, b) => a + b, 0)
  const last = lastPollPush.get(p.id) || 0
  if (!force && total >= POLL_PUSH_ALWAYS_UNDER && Date.now() - last < POLL_PUSH_GAP_MS) return counts
  lastPollPush.set(p.id, Date.now())
  if (lastPollPush.size > 2000) lastPollPush.clear()
  await push(s.id, 'poll', { ...pollShape(p, p.show_results ? counts : null, null), total })
  return counts
}

export async function votePoll(s: any, who: RoomCaller, pollId: string, option: number) {
  mustAct(who)
  if (!who.learner) throw new LmsError('Polls are answered by attendees.', 409)
  await mustEnter(s, who)
  const { data: p } = await sb.from('lms_session_polls').select('*').eq('id', pollId).eq('session_id', s.id).maybeSingle()
  if (!p) throw notFound('That poll')
  if (p.status !== 'OPEN') throw new LmsError('This poll has closed.', 409)
  const idx = Math.floor(Number(option))
  if (!(idx >= 0 && idx < (p.options as string[]).length)) throw new LmsError('Choose one of the answers.')
  const { data: had } = await sb.from('lms_session_poll_votes').select('option_idx').eq('poll_id', pollId).in('learner_id', who.learner.allIds).maybeSingle()
  if (had) throw new LmsError('You have already answered this poll.', 409)
  const { error } = await sb.from('lms_session_poll_votes').insert({ poll_id: pollId, learner_id: who.learner.id, option_idx: idx })
  if (error?.code === '23505') throw new LmsError('You have already answered this poll.', 409)
  if (error) throw error
  const counts = await pushPoll(s, p, false)
  return { poll: pollShape(p, p.show_results ? counts : null, idx) }
}

/** A heartbeat from an open room. It counts time towards attendance on the server's clock, and
 *  answers with how many are watching. Entering the room is joining: someone invited is now
 *  registered, and someone joining an open session gets a place on its list. */
export async function roomBeat(s: any, who: RoomCaller, now = Date.now()) {
  const n = await viewers(s.id, now)
  const l = who.learner
  if (!l || l.readOnly) return { viewers: n, room_seconds: 0, need_s: attendNeedS(s.duration_min, s.room_attend_pct), attended: false }
  const { row, allowed } = await mustEnter(s, who)
  if (!allowed) throw notFound('That session')
  const at = new Date(now).toISOString()
  const open = creditOpen(s, now)
  const need = attendNeedS(s.duration_min, s.room_attend_pct)
  if (!row) {
    // An open session's first visitor: on the list from now, the clock starting with this beat.
    if (s.status !== 'SCHEDULED') return { viewers: n, room_seconds: 0, need_s: need, attended: false }
    const { error } = await sb.from('lms_session_attendees').insert({ company_id: s.company_id, session_id: s.id, learner_id: l.id, status: 'REGISTERED', source: 'SELF', registered_at: at, joined_at: open ? at : null, room_last_beat_at: at })
    if (error && error.code !== '23505') throw error
    return { viewers: n + 1, room_seconds: 0, need_s: need, attended: false }
  }
  const add = creditBeat({ lastBeatAt: row.room_last_beat_at, now, open })
  const seconds = Math.round((Number(row.room_seconds || 0) + add) * 10) / 10
  const earn = open && !row.attended && seconds >= need
  const patch: Record<string, unknown> = { room_seconds: seconds, room_last_beat_at: at }
  if (open && !row.joined_at) patch.joined_at = at
  if (open && (row.status === 'INVITED' || row.status === 'DECLINED')) { patch.status = 'REGISTERED'; patch.registered_at = row.registered_at || at }
  // Attendance from the room never replaces the host's tick or the code: it only adds one.
  if (earn) Object.assign(patch, { attended: true, attended_at: at, attendance_by: 'ROOM' })
  must(await sb.from('lms_session_attendees').update(patch).eq('id', row.id).select('id'))
  if (earn) await settleLive([row.learner_id], s.course_id)
  return { viewers: n, room_seconds: seconds, need_s: need, attended: !!row.attended || earn }
}

// ── Running the room ────────────────────────────────────────────────────────
/** Someone who is not in the room at all hears "not found", as for any other session they
 *  cannot see; an attendee hears that hosting is not theirs. */
async function mustHost(s: any, who: RoomCaller) {
  if (who.host) return
  await mustEnter(s, who)
  throw new LmsError('Only the host can do that.', 403)
}

async function hostMessage(s: any, id: string) {
  const { data } = await sb.from('lms_session_messages').select(MSG_COLS).eq('id', id).eq('session_id', s.id).maybeSingle()
  if (!data) throw notFound('That message')
  return data as MsgRow
}

const auditBy = (s: any, who: RoomCaller, action: string, detail?: Record<string, unknown>) =>
  audit({ companyId: s.company_id, actorId: who.actor?.employeeId || who.learner?.employeeId || null, actorLabel: who.name, action, entity: 'session', entityId: s.id, detail })

async function setSession(s: any, patch: Record<string, unknown>) {
  const next = must(await sb.from('lms_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id).select('*').single()) as any
  return next
}

export async function hostAction(s: any, who: RoomCaller, b: any, now = Date.now()) {
  await mustHost(s, who)
  const at = new Date(now).toISOString()
  switch (b.action) {
    case 'go_live': {
      if (s.status === 'CANCELLED') throw new LmsError('This session was cancelled.', 409)
      const next = await setSession(s, { live_started_at: s.live_started_at && !s.live_ended_at ? s.live_started_at : at, live_ended_at: null })
      await auditBy(s, who, 'SESSION_WENT_LIVE')
      await push(s.id, 'state', roomFlags(next, now))
      return { session: roomFlags(next, now) }
    }
    case 'end': {
      const next = await setSession(s, { live_ended_at: at, live_started_at: s.live_started_at || at })
      await auditBy(s, who, 'SESSION_ENDED_LIVE')
      await push(s.id, 'state', roomFlags(next, now))
      return { session: roomFlags(next, now) }
    }
    case 'settings': {
      const patch: Record<string, unknown> = {}
      if (typeof b.room_chat === 'boolean') patch.room_chat = b.room_chat
      if (typeof b.room_questions === 'boolean') patch.room_questions = b.room_questions
      if (!Object.keys(patch).length) throw new LmsError('Nothing to change.')
      const next = await setSession(s, patch)
      await push(s.id, 'state', roomFlags(next, now))
      return { session: roomFlags(next, now) }
    }
    case 'pin': {
      const id = b.message_id ? String(b.message_id) : null
      let m: MsgRow | null = null
      if (id) { m = await hostMessage(s, id); if (m.hidden_at) throw new LmsError('A hidden message cannot be pinned.', 409) }
      const next = await setSession(s, { pinned_message_id: id })
      await push(s.id, 'state', { ...roomFlags(next, now), pinned: m ? publicShape(m) : null })
      return { session: roomFlags(next, now), pinned: m ? shape(m, true, new Set()) : null }
    }
    case 'hide':
    case 'unhide': {
      const m = await hostMessage(s, String(b.message_id || ''))
      const hide = b.action === 'hide'
      const next = must(await sb.from('lms_session_messages').update(hide ? { hidden_at: at, hidden_by_name: who.name } : { hidden_at: null, hidden_by_name: null }).eq('id', m.id).select(MSG_COLS).single()) as MsgRow
      if (hide && s.pinned_message_id === m.id) { const ns = await setSession(s, { pinned_message_id: null }); await push(s.id, 'state', { ...roomFlags(ns, now), pinned: null }) }
      await auditBy(s, who, hide ? 'SESSION_MESSAGE_HIDDEN' : 'SESSION_MESSAGE_SHOWN', { message_id: m.id, kind: m.kind })
      await push(s.id, hide ? 'hide' : 'msg', hide ? { id: m.id } : publicShape(next))
      return { message: shape(next, true, new Set()) }
    }
    case 'answer': {
      const m = await hostMessage(s, String(b.message_id || ''))
      if (m.kind !== 'QUESTION') throw new LmsError('Only questions are answered.')
      const undo = !!b.undo
      const answer = undo ? null : (b.answer == null || String(b.answer).trim() === '' ? null : cleanText(b.answer, ANSWER_MAX))
      if (!undo && b.answer != null && String(b.answer).trim() !== '' && !answer) throw new LmsError(`An answer is up to ${ANSWER_MAX} characters.`)
      const next = must(await sb.from('lms_session_messages').update(undo ? { answered_at: null, answer: null } : { answered_at: m.answered_at || at, answer }).eq('id', m.id).select(MSG_COLS).single()) as MsgRow
      await push(s.id, 'msg', publicShape(next))
      return { message: shape(next, true, new Set()) }
    }
    case 'poll': {
      const c = cleanPoll(b.question, b.options)
      if ('problem' in c) throw new LmsError(c.problem)
      const p = must(await sb.from('lms_session_polls').insert({ company_id: s.company_id, session_id: s.id, question: c.question, options: c.options, show_results: b.show_results !== false, created_by_name: who.name }).select('*').single()) as any
      await push(s.id, 'poll', { ...pollShape(p, p.show_results ? c.options.map(() => 0) : null, null), total: 0 })
      return { poll: pollShape(p, c.options.map(() => 0), null) }
    }
    case 'poll_close':
    case 'poll_open': {
      const { data: p0 } = await sb.from('lms_session_polls').select('*').eq('id', String(b.poll_id || '')).eq('session_id', s.id).maybeSingle()
      if (!p0) throw notFound('That poll')
      const close = b.action === 'poll_close'
      const p = must(await sb.from('lms_session_polls').update(close ? { status: 'CLOSED', closed_at: at } : { status: 'OPEN', closed_at: null }).eq('id', p0.id).select('*').single()) as any
      const counts = await pushPoll(s, p, true)
      return { poll: pollShape(p, counts, null) }
    }
    default: throw new LmsError('Unknown action.')
  }
}
