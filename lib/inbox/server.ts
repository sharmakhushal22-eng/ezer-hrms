// lib/inbox/server.ts — the server side of the ESS inbox.
//
// Everything that decides WHO CAN SEE WHAT lives here, and every route goes
// through it. The tables are never read from the browser: the anon key ships
// in every page load, so a private conversation queried client-side would be
// a private conversation anyone could query. Reads use the service role and
// are gated by the functions below.

import { rmsServiceClient as sb } from '@/lib/rms/server'
import { streamFor, type StreamCode } from './streams'

export interface DeskRow {
  id: string; desk_code: string; label: string
  description: string | null; accent: string | null
}

export interface PolicyRow {
  reach_mode: 'GROUP' | 'COMPANY' | 'CHAIN_HR' | 'NO_COLD_UP'
  allow_desk_threads: boolean
  allow_group_threads: boolean
  max_direct_members: number
  always_reachable_desks: string[]
}

const FALLBACK_POLICY: PolicyRow = {
  reach_mode: 'GROUP', allow_desk_threads: true, allow_group_threads: true,
  max_direct_members: 25, always_reachable_desks: ['HR', 'PAYROLL'],
}

/** The one policy row. Falls back to the permissive default rather than
 *  failing closed — an inbox that stops working because a settings row is
 *  missing is a worse outcome than one that is briefly too open, and the
 *  row is seeded by the migration. */
export async function policy(): Promise<PolicyRow> {
  const { data, error } = await sb.from('inbox_policy').select('*').eq('id', 1).maybeSingle()
  if (error || !data) return FALLBACK_POLICY
  return { ...FALLBACK_POLICY, ...data } as PolicyRow
}

/** Desks this employee currently staffs. Resolved every time rather than
 *  cached on the conversation, so moving somebody off the HR desk takes
 *  their access to HR threads with them the same second. */
export async function myDesks(employeeId: string): Promise<DeskRow[]> {
  const { data } = await sb
    .from('inbox_desk_agents')
    .select('desk_id, inbox_desks!inner(id, desk_code, label, description, accent, is_active)')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
  return (data ?? [])
    .map((r: any) => r.inbox_desks)
    .filter((d: any) => d && d.is_active)
}

/**
 * May this person open this conversation?
 *
 * Two ways in, and only two: you are a participant who has not left, or you
 * staff the desk the thread is addressed to. Returns the conversation when
 * allowed so the caller does not fetch it twice.
 */
export async function openable(employeeId: string, conversationId: string) {
  const { data: conv } = await sb
    .from('inbox_conversations').select('*').eq('id', conversationId).maybeSingle()
  if (!conv) return { conv: null, why: 'not-found' as const }

  const { data: part } = await sb
    .from('inbox_participants')
    .select('id, last_read_at, is_muted, is_starred, left_at')
    .eq('conversation_id', conversationId).eq('employee_id', employeeId).maybeSingle()

  if (part && !part.left_at) return { conv, part, why: null }

  if (conv.desk_id) {
    const desks = await myDesks(employeeId)
    if (desks.some(d => d.id === conv.desk_id)) {
      return { conv, part: part ?? null, why: null, asAgent: true as const }
    }
  }
  return { conv: null, why: 'forbidden' as const }
}

/** Wraps the SQL function so the route and the database cannot disagree
 *  about reach. If the function is missing — 080 not yet applied — this
 *  returns false and the route says so, rather than silently allowing. */
export async function canMessage(from: string, to: string): Promise<boolean> {
  const { data, error } = await sb.rpc('inbox_can_message', { p_from: from, p_to: to })
  if (error) return false
  return data === true
}

/** Unread, from the same function the bell uses. */
export async function unreadCount(employeeId: string): Promise<number> {
  const { data, error } = await sb.rpc('inbox_unread_count', { p_employee: employeeId })
  if (error) return 0
  return Number(data) || 0
}

/**
 * Find or create this employee's thread for one notification stream.
 *
 * One SYSTEM conversation per person per stream, so "Payroll" is a single
 * running thread rather than forty separate one-line conversations. The
 * lookup is by (kind, stream_code, participant) because a stream thread has
 * exactly one participant — its owner.
 */
export async function streamThread(employeeId: string, stream: StreamCode): Promise<string | null> {
  const { data: existing } = await sb
    .from('inbox_conversations')
    .select('id, inbox_participants!inner(employee_id)')
    .eq('kind', 'SYSTEM').eq('stream_code', stream)
    .eq('inbox_participants.employee_id', employeeId)
    .limit(1)
  if (existing && existing.length) return existing[0].id

  const { data: conv, error } = await sb.from('inbox_conversations')
    .insert({ kind: 'SYSTEM', stream_code: stream, subject: stream, created_by: employeeId })
    .select('id').single()
  if (error || !conv) return null

  await sb.from('inbox_participants')
    .insert({ conversation_id: conv.id, employee_id: employeeId, role: 'OWNER' })
  return conv.id
}

/**
 * Mirror the employee's notifications into their stream threads.
 *
 * The bell and the inbox show the same events, and this is what keeps them
 * one thing rather than two lists that drift. Dedupe is on
 * (conversation, notification_code, link) — the same key the bell's own sync
 * uses — so running this on every inbox open is idempotent.
 *
 * Deliberately additive: it never deletes. A notification the employee has
 * already read stays in the thread as history, because a conversation you
 * can only see the unread half of is not a conversation.
 */
export async function syncNotifications(employeeId: string): Promise<number> {
  const { data: notes } = await sb
    .from('ess_notifications')
    .select('id, category, title, body, link, created_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: true })
    .limit(400)
  if (!notes || !notes.length) return 0

  // What is already mirrored, so this stays idempotent.
  const { data: seen } = await sb
    .from('inbox_messages')
    .select('notification_code, link, conversation_id, inbox_conversations!inner(kind)')
    .eq('inbox_conversations.kind', 'SYSTEM')
    .eq('kind', 'NOTIFICATION')
    .limit(2000)
  const have = new Set((seen ?? []).map((r: any) => `${r.notification_code}|${r.link}`))

  const threads = new Map<string, string>()
  const rows: any[] = []
  for (const n of notes) {
    const code = n.category || ''
    const key = `${code}|${n.link ?? ''}`
    if (have.has(key)) continue
    const stream = streamFor(code)
    let convId = threads.get(stream)
    if (!convId) {
      const made = await streamThread(employeeId, stream)
      if (!made) continue
      threads.set(stream, made); convId = made
    }
    rows.push({
      conversation_id: convId, sender_employee_id: null, kind: 'NOTIFICATION',
      body: [n.title, n.body].filter(Boolean).join('\n'),
      notification_code: code, link: n.link, created_at: n.created_at,
    })
    have.add(key)
  }
  if (!rows.length) return 0
  const { error } = await sb.from('inbox_messages').insert(rows)
  return error ? 0 : rows.length
}

/** Names and photos for a set of employee ids, in one round trip. */
export async function people(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map<string, any>()
  const { data } = await sb.from('employees')
    .select('id, full_name, emp_code, designation, photo_url, department_id, company_id')
    .in('id', uniq)
  return new Map((data ?? []).map((e: any) => [e.id, e]))
}

/** True when 080 has not been applied yet. Every route checks this once so
 *  the UI can say "not enabled yet" instead of showing a broken screen. */
export function notInstalled(err: any): boolean {
  const m = String(err?.message || err?.code || '')
  return m.includes('PGRST205') || m.includes('does not exist') || m.includes('42P01')
}
