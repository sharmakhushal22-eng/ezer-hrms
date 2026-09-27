// app/api/ess/interview/route.ts
//
//   GET                                  -> { invites: [...] }  (the caller's own interview tasks)
//   POST { action:'acknowledge', invite_id }
//   POST { action:'feedback', invite_id, feedback }   (MAIN interviewer only)
//
// The interviewer's half of the flow, reached from ESS → Tasks & Approvals.
// Every invitee (main interviewer + panelists) sees the details and acknowledges;
// only the MAIN interviewer may submit feedback. The feedback carries a decision
// (Hold / Reject / Shortlist) that moves the candidate, and the hiring manager who
// scheduled the round is told.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, notify as essNotify } from '@/lib/ess/session'
import { applyInterviewDecision, DECISION_LABEL, distinctRounds, isDecision, roundOrdinal } from '@/lib/recruitment/interview-decision'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const me = r.ctx.caller.employeeId
  const { data, error } = await sb.from('interview_invites')
    .select('*').eq('interviewer_id', me).order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // The MRF's "questions to ask" ride along so the feedback form can show them.
  const mrfIds = [...new Set((data || []).map((i: any) => i.mrf_id).filter(Boolean))]
  const qByMrf = new Map<string, string[]>()
  if (mrfIds.length) {
    const { data: mrfs } = await sb.from('manpower_requisitions').select('id, ctq_questions').in('id', mrfIds)
    for (const m of mrfs || []) qByMrf.set(m.id, Array.isArray(m.ctq_questions) ? m.ctq_questions : [])
  }
  return NextResponse.json({ invites: (data || []).map((i: any) => ({ ...i, questions: qByMrf.get(i.mrf_id) || [] })) })
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
    if ((inv.role || 'MAIN') !== 'MAIN') return NextResponse.json({ error: 'Only the main interviewer records feedback for this round' }, { status: 403 })
    if (inv.status === 'submitted') return NextResponse.json({ error: 'Feedback for this round is already submitted' }, { status: 409 })
    const fb = body?.feedback
    if (!fb || typeof fb !== 'object') return NextResponse.json({ error: 'feedback payload is required' }, { status: 400 })
    if (!isDecision(fb.decision)) return NextResponse.json({ error: 'Choose Hold, Reject or Shortlist' }, { status: 400 })
    if (fb.decision !== 'SHORTLIST' && !String(fb.decision_remark || '').trim()) return NextResponse.json({ error: 'A remark is required for Hold / Reject' }, { status: 400 })

    const patch: any = { status: 'submitted', feedback: fb, submitted_at: new Date().toISOString(),
      // acknowledging is implied by giving feedback, if they skipped the button
      acknowledged_at: inv.acknowledged_at || new Date().toISOString(),
      decision: fb.decision, decision_remark: fb.decision_remark || null }
    let up = await sb.from('interview_invites').update(patch).eq('id', inviteId)
    if (up.error && (up.error.code === '42703' || up.error.code === 'PGRST204')) {   // migration 131 not applied yet
      const { decision: _d, decision_remark: _m, ...rest } = patch
      up = await sb.from('interview_invites').update(rest).eq('id', inviteId)
    }
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })

    // The decision moves the candidate.
    let stage: string | null = null
    if (inv.candidate_id) {
      const { data: all } = await sb.from('interview_invites').select('round').eq('candidate_id', inv.candidate_id).order('created_at', { ascending: true })
      const rounds = distinctRounds((all || []) as any[])
      try { stage = await applyInterviewDecision(sb as any, inv.candidate_id, inv.round, fb.decision, roundOrdinal(rounds, inv.round)) } catch { /* reported below via stage=null */ }
    }

    // Tell the hiring manager the feedback (and decision) is in.
    if (inv.scheduled_by) {
      const me2 = await sb.from('employees').select('full_name').eq('id', me).maybeSingle()
      const who = me2.data?.full_name || 'The main interviewer'
      await essNotify(
        inv.scheduled_by,
        `Interview feedback in — ${inv.candidate_name || 'candidate'} (${inv.round}) · ${DECISION_LABEL[fb.decision as keyof typeof DECISION_LABEL]}`,
        `${who} submitted feedback for the ${inv.round} round${fb.band ? ` · ${fb.total}/80 (${fb.band})` : ''}. Decision: ${DECISION_LABEL[fb.decision as keyof typeof DECISION_LABEL]}${fb.decision_remark ? ` — ${fb.decision_remark}` : ''}.`,
        '/dashboard/recruitment',
        'INTERVIEW',
      ).catch(() => null)
    }
    return NextResponse.json({ ok: true, status: 'submitted', decision: fb.decision, stage })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
