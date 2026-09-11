// app/api/ess/notifications/route.ts
//
//   GET  ?employee_id=…   -> { personal: [...], role: [...], unread }
//   POST { action: 'read', id } | { action: 'read_all' }
//
// The bell reads through here rather than querying ess_notifications from the
// browser, for two reasons:
//
//   1. It syncs first. Notifications only ever existed for things that HAPPENED
//      after the feature was built; work already sitting in somebody's queue
//      produced nothing. deriveFor() computes what should be there from current
//      data and the missing rows are written before the list is returned, so
//      the bell is right on first open rather than after the next event.
//
//   2. It splits personal from role-based. "Your leave was approved" and "three
//      people are waiting on you" are different kinds of message, and a single
//      flat list buries the second under the first.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute } from '@/lib/ess/session'
import { deriveFor, isRoleScoped } from '@/lib/notifications/derive'
import { def, isHigh } from '@/lib/notifications/catalogue'

/**
 * Write the derived notifications this person is missing.
 *
 * Dedupe is on `link`, which carries the source row's id, so a leave request
 * produces exactly one notification however many times this runs. Summary rows
 * (proofs, PMS) have a fixed link and are deduped on code instead — their
 * COUNT changes, so the title is refreshed rather than a second row added.
 */
async function sync(me: string): Promise<number> {
  const want = await deriveFor(me)
  if (!want.length) return 0

  const { data: have } = await sb.from('ess_notifications')
    .select('id, category, link, title').eq('employee_id', me)
  const byLink = new Map((have ?? []).map(r => [r.link, r]))

  const insert: Record<string, unknown>[] = []
  for (const w of want) {
    const existing = byLink.get(w.link)
    if (!existing) {
      insert.push({
        employee_id: me, category: w.code, title: w.title,
        body: w.body ?? null, link: w.link, is_read: false,
      })
      continue
    }
    // A summary whose count moved — update in place. Adding a second "3 proofs
    // awaiting" beside "2 proofs awaiting" is how a bell becomes noise.
    if (existing.title !== w.title) {
      await sb.from('ess_notifications')
        .update({ title: w.title, body: w.body ?? null, is_read: false })
        .eq('id', existing.id)
    }
  }
  if (!insert.length) return 0
  const { error } = await sb.from('ess_notifications').insert(insert)
  if (error) { console.warn('[notifications] sync insert failed:', error.message); return 0 }
  return insert.length
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId

  // Best-effort: a sync failure must not stop somebody reading the bell.
  let synced = 0
  try { synced = await sync(me) } catch (e) { console.warn('[notifications] sync skipped:', e) }

  const { data, error } = await sb.from('ess_notifications')
    .select('id, category, title, body, link, is_read, created_at')
    .eq('employee_id', me).order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(n => ({
    ...n,
    label: def(n.category ?? '')?.label ?? n.category,
    high: isHigh(n.category ?? ''),
    role_scoped: isRoleScoped(n.category ?? ''),
  }))

  return NextResponse.json({
    personal: rows.filter(n => !n.role_scoped),
    role:     rows.filter(n => n.role_scoped),
    unread:   rows.filter(n => !n.is_read).length,
    synced,
  })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId

  const body = await req.json().catch(() => null) as { action?: string; id?: string } | null
  const action = body?.action

  if (action === 'read_all') {
    // Scoped to this employee. An UPDATE on ess_notifications without the
    // employee filter would mark the whole company's notifications read.
    const { error } = await sb.from('ess_notifications')
      .update({ is_read: true }).eq('employee_id', me).eq('is_read', false)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'read' && body?.id) {
    const { error } = await sb.from('ess_notifications')
      .update({ is_read: true }).eq('id', body.id).eq('employee_id', me)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "action must be 'read' or 'read_all'" }, { status: 400 })
}
