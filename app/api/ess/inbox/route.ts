// app/api/ess/inbox/route.ts
//
//   GET                       -> { installed, folders, conversations, unread, desks, policy }
//   POST { action: 'start' }  -> open (or reuse) a DIRECT thread
//   POST { action: 'desk' }   -> open a thread with a desk
//   POST { action: 'read' }   -> mark a thread read
//   POST { action: 'mute' | 'star' | 'leave' }
//
// Nothing here trusts an employee_id from the body. The caller is resolved
// from the session by essRoute, exactly as the rest of ESS does, and every
// write is scoped to that person.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import {
  policy, myDesks, canMessage, unreadCount, syncNotifications,
  people, notInstalled, openable,
} from '@/lib/inbox/server'
import { STREAMS } from '@/lib/inbox/streams'

export const dynamic = 'force-dynamic'

/** 080 has not been run yet. Say so plainly — the UI renders a short note
 *  rather than an error, and the bell keeps working off ess_notifications. */
const notReady = () => NextResponse.json({
  installed: false,
  reason: 'The inbox tables are not in the database yet (migration 080).',
  folders: [], conversations: [], unread: 0, desks: [],
})

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  // FOUR ROUND-TRIPS, NOT ELEVEN.
  //
  // Every step below used to be awaited in sequence: probe, sync, policy +
  // desks, participants, desk conversations, conversations, the unread RPC,
  // participants AGAIN, people, allDesks, unreadCount. Measured warm, not one
  // of them is slow — ~20ms a select, ~70-95ms an RPC. They were simply queued,
  // and the route paid a network latency for each. Grouped here into the four
  // phases the data actually requires.
  //
  // The standalone probe goes with them: the participants read in phase B
  // raises the same "tables are missing" error, so noticing an unrun migration
  // no longer costs a round trip of its own.

  // ── A ── depends on nothing.
  //
  // syncNotifications stays AHEAD of the reads rather than beside them: it
  // mirrors the bell into stream threads, and the list below has to see what it
  // creates — that is the whole reason it runs on open rather than on a cron.
  const [, pol, desks, deskRows] = await Promise.all([
    syncNotifications(me),
    policy(),
    myDesks(me),
    allDesks(),
  ])

  // ── B ── depends only on `desks`. Both unread figures are fetched here, so
  // they are still counted AFTER the sync above, exactly as before.
  const [mineRes, unreadTotal, countsRes, deskConvRes] = await Promise.all([
    sb.from('inbox_participants')
      .select('conversation_id, last_read_at, is_muted, is_starred')
      .eq('employee_id', me).is('left_at', null),
    unreadCount(me),
    sb.rpc('inbox_unread_by_conversation', { p_employee: me }),
    desks.length
      ? sb.from('inbox_conversations').select('id').in('desk_id', desks.map(d => d.id)).limit(500)
      : null,
  ])

  // This read is what now reports migration 080 as missing.
  if (mineRes.error) {
    if (notInstalled(mineRes.error)) return notReady()
    return NextResponse.json({ error: mineRes.error.message }, { status: 500 })
  }

  // Threads I am in, plus threads addressed to a desk I staff.
  const mine = mineRes.data
  const ids = new Set((mine ?? []).map(r => r.conversation_id))
  const byConv = new Map((mine ?? []).map(r => [r.conversation_id, r]))
  for (const c of deskConvRes?.data ?? []) ids.add(c.id)

  if (!ids.size) {
    return NextResponse.json({
      installed: true, folders: foldersFrom([], desks), conversations: [],
      unread: 0, desks, policy: pol,
    })
  }

  // ── C ── depends on the id set, and these two do not depend on each other.
  const [convRes, partsRes] = await Promise.all([
    sb.from('inbox_conversations')
      .select('*').in('id', [...ids])
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300),
    // Who else is in each thread, so a DIRECT row can be titled by the person
    // rather than by a subject line nobody writes.
    sb.from('inbox_participants')
      .select('conversation_id, employee_id').in('conversation_id', [...ids]).limit(2000),
  ])
  const convs = convRes.data

  // Per-thread unread, from the same function the badge uses (fetched in B).
  const unreadBy = new Map((countsRes.data ?? []).map((r: any) => [r.conversation_id, Number(r.unread) || 0]))

  const others = new Map<string, string[]>()
  for (const p of partsRes.data ?? []) {
    if (p.employee_id === me) continue
    others.set(p.conversation_id, [...(others.get(p.conversation_id) ?? []), p.employee_id])
  }

  // ── D ── names for the people phase C just turned up.
  const dir = await people([...others.values()].flat())
  const deskById = new Map(deskRows.map(d => [d.id, d]))

  const rows = (convs ?? []).map(c => {
    const mem = (others.get(c.id) ?? []).map(id => dir.get(id)).filter(Boolean)
    const p = byConv.get(c.id)
    return {
      id: c.id,
      kind: c.kind,
      stream: c.kind === 'SYSTEM' ? c.stream_code
            : c.kind === 'DESK'   ? (deskById.get(c.desk_id)?.desk_code ?? 'HR')
            : 'DIRECT',
      title: c.kind === 'DIRECT'
        ? (mem.map((m: any) => m.full_name).join(', ') || 'Conversation')
        : c.kind === 'DESK'
          ? (deskById.get(c.desk_id)?.label ?? 'Desk')
          : (STREAMS.find(s => s.code === c.stream_code)?.label ?? c.stream_code),
      subject: c.subject,
      members: mem.map((m: any) => ({ id: m.id, name: m.full_name, code: m.emp_code,
                                      designation: m.designation, photo: m.photo_url })),
      last_message_at: c.last_message_at,
      preview: c.last_message_preview,
      message_count: c.message_count,
      unread: unreadBy.get(c.id) ?? 0,
      muted: p?.is_muted ?? false,
      starred: p?.is_starred ?? false,
      is_closed: c.is_closed,
      // A desk thread I can see because I staff the desk, not because
      // somebody added me. The UI labels it, so an agent knows they are
      // answering on behalf of the desk.
      as_agent: !byConv.has(c.id),
    }
  })

  return NextResponse.json({
    installed: true,
    folders: foldersFrom(rows, desks),
    conversations: rows,
    unread: unreadTotal,
    desks, policy: pol,
  })
}

async function allDesks() {
  const { data } = await sb.from('inbox_desks')
    .select('id, desk_code, label, description, accent').eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

/** Folder counts, derived from the rows we already have rather than another
 *  round of queries. An empty folder is still listed — its absence would read
 *  as "this does not exist" instead of "nothing here yet". */
function foldersFrom(rows: any[], _desks: any[]) {
  const count = (pred: (r: any) => boolean) => {
    const list = rows.filter(pred)
    return { total: list.length, unread: list.reduce((n, r) => n + (r.unread || 0), 0) }
  }
  return [
    { code: 'ALL',     label: 'All',       ...count(() => true) },
    { code: 'UNREAD',  label: 'Unread',    ...count(r => r.unread > 0) },
    { code: 'STARRED', label: 'Starred',   ...count(r => r.starred) },
    ...STREAMS.map(s => ({
      code: s.code, label: s.label, hint: s.hint,
      ...count(r => r.stream === s.code || (s.code === 'DIRECT' && r.kind === 'DIRECT')),
    })),
  ]
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  const probe = await sb.from('inbox_conversations').select('id').limit(1)
  if (probe.error && notInstalled(probe.error)) return notReady()

  if (action === 'start') {
    const to: string[] = Array.isArray(body.to) ? body.to.filter(Boolean) : []
    if (!to.length) return NextResponse.json({ error: 'Pick somebody to write to.' }, { status: 400 })

    const pol = await policy()
    if (to.length + 1 > pol.max_direct_members) {
      return NextResponse.json({ error: `A conversation can hold ${pol.max_direct_members} people.` }, { status: 400 })
    }
    if (to.length > 1 && !pol.allow_group_threads) {
      return NextResponse.json({ error: 'Group conversations are switched off.' }, { status: 403 })
    }
    // Reach is checked per recipient, by the database function, so the answer
    // is the same one any other caller would get.
    for (const t of to) {
      if (!(await canMessage(me, t))) {
        return NextResponse.json({ error: 'Your access does not include that person.' }, { status: 403 })
      }
    }

    // Reuse an existing 1:1 rather than starting a second thread with the same
    // person — otherwise a year of conversation ends up in twelve threads.
    if (to.length === 1) {
      const { data: existing } = await sb.from('inbox_conversations')
        .select('id, inbox_participants!inner(employee_id)')
        .eq('kind', 'DIRECT').eq('inbox_participants.employee_id', me).limit(200)
      // ONE query for all the candidates, not one query per candidate.
      //
      // This was a loop with an await inside it, so starting a conversation
      // cost an extra round trip for every DIRECT thread the sender already
      // had — a price that grew the more somebody used their inbox.
      const candidates = (existing ?? []).map(c => c.id)
      if (candidates.length) {
        const { data: members } = await sb.from('inbox_participants')
          .select('conversation_id, employee_id')
          .in('conversation_id', candidates).is('left_at', null)

        const byConv = new Map<string, Set<string>>()
        for (const m of members ?? []) {
          const s = byConv.get(m.conversation_id) ?? new Set<string>()
          s.add(m.employee_id)
          byConv.set(m.conversation_id, s)
        }
        for (const cid of candidates) {
          const set = byConv.get(cid)
          if (set && set.size === 2 && set.has(me) && set.has(to[0])) {
            return NextResponse.json({ id: cid, reused: true })
          }
        }
      }
    }

    const { data: conv, error: ce } = await sb.from('inbox_conversations')
      .insert({ kind: 'DIRECT', subject: body.subject || null, created_by: me })
      .select('id').single()
    if (ce || !conv) return NextResponse.json({ error: ce?.message || 'Could not start it.' }, { status: 500 })

    await sb.from('inbox_participants').insert([
      { conversation_id: conv.id, employee_id: me, role: 'OWNER', last_read_at: new Date().toISOString() },
      ...to.map(t => ({ conversation_id: conv.id, employee_id: t, role: 'MEMBER', added_by: me })),
    ])
    return NextResponse.json({ id: conv.id })
  }

  if (action === 'desk') {
    const pol = await policy()
    if (!pol.allow_desk_threads) {
      return NextResponse.json({ error: 'Desk conversations are switched off.' }, { status: 403 })
    }
    const code = String(body.desk_code || '')
    const { data: desk } = await sb.from('inbox_desks')
      .select('id, label, desk_code').eq('desk_code', code).eq('is_active', true).maybeSingle()
    if (!desk) return NextResponse.json({ error: 'No such desk.' }, { status: 404 })

    const { data: conv, error: ce } = await sb.from('inbox_conversations')
      .insert({ kind: 'DESK', desk_id: desk.id, subject: body.subject || desk.label, created_by: me })
      .select('id').single()
    if (ce || !conv) return NextResponse.json({ error: ce?.message || 'Could not start it.' }, { status: 500 })

    // Only the employee is a participant. Agents reach it through the desk,
    // so the thread follows whoever staffs it rather than whoever staffed it.
    await sb.from('inbox_participants').insert({
      conversation_id: conv.id, employee_id: me, role: 'OWNER',
      last_read_at: new Date().toISOString(),
    })
    return NextResponse.json({ id: conv.id })
  }

  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 })
  const gate = await openable(me, id)
  if (gate.why) return NextResponse.json({ error: 'Not your conversation.' }, { status: gate.why === 'not-found' ? 404 : 403 })

  if (action === 'read') {
    await sb.from('inbox_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', id).eq('employee_id', me)
    return NextResponse.json({ ok: true, unread: await unreadCount(me) })
  }
  if (action === 'mute' || action === 'star') {
    const col = action === 'mute' ? 'is_muted' : 'is_starred'
    await sb.from('inbox_participants').update({ [col]: !!body.value })
      .eq('conversation_id', id).eq('employee_id', me)
    return NextResponse.json({ ok: true })
  }
  if (action === 'leave') {
    await sb.from('inbox_participants').update({ left_at: new Date().toISOString() })
      .eq('conversation_id', id).eq('employee_id', me)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
