// app/api/recruitment/interview-invite/route.ts
//
//   GET  ?candidate_id=…            -> { invites: [...] }  (all rounds, for the hiring manager's popup)
//   POST { action:'schedule', … }   -> creates one invite per interviewer, mails the
//                                       candidate + interviewers, and drops an ESS
//                                       acknowledge task on each interviewer.
//
// The hiring manager schedules a round from the candidate popup. This is the
// server half: it fans the one schedule out to one row per interviewer, sends
// the meeting invite by email, and raises the in-app acknowledgement.
//
// Email is best-effort — if Gmail SMTP is not configured the invites and the
// ESS tasks are still created, and the response says email was skipped.

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify as essNotify } from '@/lib/ess/session'

export const runtime = 'nodejs' // nodemailer needs Node, not Edge

const empEmail = (e: any) => e?.office_email || e?.personal_email || null

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get('candidate_id')
  if (!candidateId) return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 })
  const { data, error } = await sb.from('interview_invites')
    .select('*').eq('candidate_id', candidateId).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invites: data || [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  if (!body || body.action !== 'schedule')
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const { candidate_id, mrf_id, company_id, round, interviewer_ids, scheduled_at, meet_link, scheduled_by } = body
  if (!candidate_id || !round) return NextResponse.json({ error: 'candidate_id and round are required' }, { status: 400 })
  const ids: string[] = Array.isArray(interviewer_ids) ? interviewer_ids.filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ error: 'Select at least one interviewer' }, { status: 400 })

  // candidate + interviewers + scheduler, in as few round-trips as possible
  const [{ data: cand }, { data: emps }, { data: sched }] = await Promise.all([
    sb.from('candidates').select('full_name, email, designation').eq('id', candidate_id).maybeSingle(),
    sb.from('employees').select('id, emp_code, full_name, office_email, personal_email').in('id', ids),
    scheduled_by ? sb.from('employees').select('full_name').eq('id', scheduled_by).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const empById = new Map((emps || []).map((e: any) => [e.id, e]))
  const schedName = (sched as any)?.full_name || 'The hiring manager'

  const rows = ids.map(id => {
    const e: any = empById.get(id)
    return {
      candidate_id, mrf_id: mrf_id || null, company_id: company_id || null, round,
      interviewer_id: id, interviewer_emp_code: e?.emp_code || null,
      interviewer_name: e?.full_name || null, interviewer_email: empEmail(e),
      scheduled_at: scheduled_at || null, meet_link: meet_link || null,
      scheduled_by: scheduled_by || null, scheduled_by_name: schedName,
      candidate_name: cand?.full_name || null, candidate_email: cand?.email || null,
      status: 'invited',
    }
  })

  const { data: inserted, error } = await sb.from('interview_invites').insert(rows).select('id, interviewer_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // In-app ESS acknowledge task for every interviewer (surfaces in Tasks & Approvals + bell).
  const when = scheduled_at ? new Date(scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'a time to be confirmed'
  await Promise.all(ids.map(id =>
    essNotify(
      id,
      `Interview to conduct — ${cand?.full_name || 'a candidate'} (${round})`,
      `You've been added as an interviewer for the ${round} round on ${when}. Acknowledge it in Tasks & Approvals, then give your feedback.`,
      '/ess?tab=approvals',
      'INTERVIEW',
    ).catch(() => null),
  ))

  // Email — best effort.
  let emailed = 0, emailSkipped: string | null = null
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (user && pass) {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    const from = `"${process.env.GMAIL_FROM_NAME || 'EZER HR Team'}" <${user}>`
    const linkLine = meet_link ? `\nJoin link: ${meet_link}` : ''
    const role = cand?.designation ? ` for the ${cand.designation} role` : ''
    const tasks: Promise<any>[] = []
    // candidate
    if (cand?.email) {
      tasks.push(t.sendMail({
        from, to: cand.email, subject: `Interview scheduled — ${round}`,
        text: `Dear ${cand.full_name || 'Candidate'},\n\nYour ${round} interview${role} is scheduled for ${when}.${linkLine}\n\nPlease join on time. All the best.\n\n${schedName}`,
      }).then(() => { emailed++ }).catch(() => null))
    }
    // interviewers
    for (const id of ids) {
      const e: any = empById.get(id); const to = empEmail(e)
      if (!to) continue
      tasks.push(t.sendMail({
        from, to, subject: `Interview to conduct — ${cand?.full_name || 'Candidate'} (${round})`,
        text: `Hi ${e.full_name || ''},\n\nYou've been added as an interviewer for ${cand?.full_name || 'a candidate'} — ${round} round, scheduled for ${when}.${linkLine}\n\nPlease acknowledge it in ESS → Tasks & Approvals, then record your feedback after the interview.\n\n${schedName}`,
      }).then(() => { emailed++ }).catch(() => null))
    }
    await Promise.all(tasks)
  } else {
    emailSkipped = 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD) — invites and ESS tasks were still created.'
  }

  return NextResponse.json({ ok: true, invited: inserted?.length || 0, emailed, emailSkipped })
}
