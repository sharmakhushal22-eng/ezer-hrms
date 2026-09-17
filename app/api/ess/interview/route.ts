// app/api/ess/interview/route.ts
//
//   GET                                  -> { invites: [...] }  (the caller's own interview tasks)
//   POST { action:'acknowledge', invite_id }
//   POST { action:'feedback', invite_id, feedback }
//
// The interviewer's half of the flow, reached from ESS → Tasks & Approvals.
// Acknowledge flips the invite to 'acknowledged' (the button then becomes "Give
// feedback"); submitting the 8-parameter feedback flips it to 'submitted' and
// notifies the hiring manager who scheduled it.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, notify as essNotify } from '@/lib/ess/session'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const { data, error } = await sb.from('interview_invites')
    .select('*').eq('interviewer_id', me).order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invites: data || [] })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const body = await req.json().catch(() => null) as any
  const action = body?.action
  const inviteId = body?.invite_id
  if (!inviteId) return NextResponse.json({ error: 'invite_id is required' }, { status: 400 })

  // The invite must belong to this interviewer.
  const { data: inv } = await sb.from('interview_invites').select('*').eq('id', inviteId).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'No such interview task' }, { status: 404 })
  if (inv.interviewer_id !== me) return NextResponse.json({ error: 'This interview task is not yours' }, { status: 403 })

  if (action === 'acknowledge') {
    if (inv.status === 'invited') {
      const { error } = await sb.from('interview_invites')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }).eq('id', inviteId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, status: 'acknowledged' })
  }

  if (action === 'feedback') {
    const fb = body?.feedback
    if (!fb || typeof fb !== 'object') return NextResponse.json({ error: 'feedback payload is required' }, { status: 400 })
    const { error } = await sb.from('interview_invites')
      .update({ status: 'submitted', feedback: fb, submitted_at: new Date().toISOString(),
        // acknowledging is implied by giving feedback, if they skipped the button
        acknowledged_at: inv.acknowledged_at || new Date().toISOString() })
      .eq('id', inviteId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Tell the hiring manager the feedback is in.
    if (inv.scheduled_by) {
      const me2 = await sb.from('employees').select('full_name').eq('id', me).maybeSingle()
      const who = me2.data?.full_name || 'An interviewer'
      await essNotify(
        inv.scheduled_by,
        `Interview feedback in — ${inv.candidate_name || 'candidate'} (${inv.round})`,
        `${who} submitted feedback for the ${inv.round} round${fb.band ? ` · ${fb.total}/80 (${fb.band})` : ''}.`,
        '/dashboard/recruitment',
        'INTERVIEW',
      ).catch(() => null)
    }
    return NextResponse.json({ ok: true, status: 'submitted' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
