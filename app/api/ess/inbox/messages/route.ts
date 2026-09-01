// app/api/ess/inbox/messages/route.ts
//
//   GET  ?id=<conversation>   -> the thread, oldest first
//   POST { id, body }         -> reply
//
// Both go through openable(), which is the only place that decides whether
// somebody may see a conversation. There is no second path in.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { openable, people, myDesks, unreadCount, notInstalled } from '@/lib/inbox/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 })

  const gate = await openable(me, id)
  if (gate.why) {
    return NextResponse.json(
      { error: gate.why === 'not-found' ? 'That conversation is gone.' : 'Not your conversation.' },
      { status: gate.why === 'not-found' ? 404 : 403 })
  }

  const { data: msgs, error: me2 } = await sb.from('inbox_messages')
    .select('*').eq('conversation_id', id)
    .order('created_at', { ascending: true }).limit(500)
  if (me2) {
    if (notInstalled(me2)) return NextResponse.json({ installed: false, messages: [] })
    return NextResponse.json({ error: me2.message }, { status: 500 })
  }

  const dir = await people((msgs ?? []).map((m: any) => m.sender_employee_id).filter(Boolean))
  const { data: desks } = await sb.from('inbox_desks').select('id, label, desk_code, accent')
  const deskById = new Map((desks ?? []).map((d: any) => [d.id, d]))

  // Opening a thread is reading it. Done here rather than asking the client to
  // send a second call it might forget.
  await sb.from('inbox_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', id).eq('employee_id', me)

  // Reading a notification HERE has to clear it on the bell as well, or the
  // employee reads everything in the inbox and the badge still says 6. The
  // notification rows are the single source of truth for "read"; the inbox
  // mirrors them, so the mirror marks the original.
  if (gate.conv?.kind === 'SYSTEM') {
    const codes = [...new Set((msgs ?? [])
      .filter((m: any) => m.kind === 'NOTIFICATION' && m.notification_code)
      .map((m: any) => m.notification_code as string))]
    if (codes.length) {
      await sb.from('ess_notifications')
        .update({ is_read: true })
        .eq('employee_id', me).eq('is_read', false).in('category', codes)
    }
  }

  return NextResponse.json({
    installed: true,
    conversation: gate.conv,
    as_agent: !!(gate as any).asAgent,
    messages: (msgs ?? []).map((m: any) => {
      const who = m.sender_employee_id ? dir.get(m.sender_employee_id) : null
      const desk = m.sender_desk_id ? deskById.get(m.sender_desk_id) : null
      return {
        id: m.id,
        kind: m.kind,
        body: m.deleted_at ? null : m.body,
        deleted: !!m.deleted_at,
        link: m.link,
        notification_code: m.notification_code,
        created_at: m.created_at,
        edited_at: m.edited_at,
        mine: m.sender_employee_id === me,
        // A desk answer shows the desk to the employee AND the person who
        // wrote it — the migration stores both precisely so this is possible.
        sender: desk
          ? { name: desk.label, desk: true, by: who?.full_name ?? null, accent: desk.accent }
          : who
            ? { name: who.full_name, code: who.emp_code, designation: who.designation, photo: who.photo_url }
            : null,
      }
    }),
    unread: await unreadCount(me),
  })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || '')
  const text = String(b.body || '').trim()

  if (!id) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: 'That message is too long.' }, { status: 400 })

  const gate = await openable(me, id)
  if (gate.why) return NextResponse.json({ error: 'Not your conversation.' }, { status: 403 })
  if (gate.conv?.is_closed) return NextResponse.json({ error: 'This conversation is closed.' }, { status: 409 })
  // A notification stream is the system talking to you. Replying into it
  // would produce a message with no reader, which is worse than no reply box.
  if (gate.conv?.kind === 'SYSTEM') {
    return NextResponse.json({ error: 'This is a notification feed — there is nobody to reply to.' }, { status: 409 })
  }

  // Answering as the desk, when that is how you got in.
  let senderDesk: string | null = null
  if ((gate as any).asAgent && gate.conv?.desk_id) senderDesk = gate.conv.desk_id
  else if (gate.conv?.desk_id) {
    const desks = await myDesks(me)
    if (desks.some(d => d.id === gate.conv!.desk_id)) senderDesk = gate.conv!.desk_id
  }

  const { data: msg, error: ie } = await sb.from('inbox_messages').insert({
    conversation_id: id, sender_employee_id: me, sender_desk_id: senderDesk,
    kind: 'TEXT', body: text, reply_to_id: b.reply_to || null,
  }).select('id, created_at').single()
  if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })

  // An agent who answers a desk thread joins it, so it appears in their own
  // list afterwards rather than only under the desk.
  if (senderDesk) {
    await sb.from('inbox_participants')
      .upsert({ conversation_id: id, employee_id: me, role: 'MEMBER',
                last_read_at: new Date().toISOString() },
              { onConflict: 'conversation_id,employee_id' })
  } else {
    await sb.from('inbox_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', id).eq('employee_id', me)
  }

  return NextResponse.json({ id: msg?.id, created_at: msg?.created_at })
}
