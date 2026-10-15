// app/api/ess/onboarding-approvals/route.ts
//
//   GET                      → { teams, items }  the submitted onboarding forms of the caller's
//                              company, for the teams the caller acts for (IT, Admin, Payroll,
//                              HR Manager), each with every team's status
//   GET ?open=<onboarding_id> → the full form (form_data) and the documents with signed URLs,
//                              for the review drawer
//   POST { onboarding_id, team, action:'approve'|'return', remark } → the team's decision
//
// ESS → Tasks & Approvals → Onboarding approvals. The fourth approval generates the employee
// code (lib/onboarding/approvals.ts).

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { teamsFor, decideApproval, TEAMS, type Team } from '@/lib/onboarding/approvals'
import { reviewPayload } from '@/lib/onboarding/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mailer = () => {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return { t: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>` }
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const teams = teamsFor(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
  if (!teams.length || !ctx.companyId) return NextResponse.json({ teams, items: [] })

  const open = req.nextUrl.searchParams.get('open')
  if (open) {
    const payload = await reviewPayload(sb, open, { companyId: ctx.companyId, maskBank: !teams.includes('PAYROLL') })
    if (!payload) return NextResponse.json({ error: 'Not found in your company' }, { status: 404 })
    return NextResponse.json({ teams, ...payload })
  }

  const { data: rows } = await sb.from('onboarding_candidates')
    .select('id, full_name, designation, department, employment_type, date_of_joining, status, submitted_at, hr_notes')
    .eq('company_id', ctx.companyId).in('status', ['SUBMITTED', 'HR_REVIEW', 'APPROVED']).order('submitted_at', { ascending: true })
  const ids = (rows || []).map((x: any) => x.id)
  const { data: apps } = ids.length ? await sb.from('onboarding_approvals').select('onboarding_id, team, status, acted_by_name, remark, acted_at').in('onboarding_id', ids) : { data: [] as any[] }
  const by = new Map<string, any[]>()
  for (const a of apps || []) { const l = by.get(a.onboarding_id) || []; l.push(a); by.set(a.onboarding_id, l) }
  const items = (rows || []).map((x: any) => {
    const list = by.get(x.id) || []
    const approvals = TEAMS.map(t => list.find(a => a.team === t) || { team: t, status: 'PENDING', acted_by_name: null, remark: null, acted_at: null })
    const mine = teams.filter(t => approvals.find(a => a.team === t)?.status === 'PENDING')
    return { ...x, approvals, waiting_on_me: mine }
  })
  return NextResponse.json({ teams, items })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('An approval is recorded under your own name, so it cannot be actioned while you are viewing somebody else\'s portal.')
  const body = await req.json().catch(() => ({}))
  const team = String(body.team || '').toUpperCase() as Team
  const action = body.action === 'return' ? 'return' : body.action === 'approve' ? 'approve' : null
  const onboardingId = String(body.onboarding_id || '')
  if (!onboardingId || !TEAMS.includes(team) || !action) return NextResponse.json({ error: 'onboarding_id, team and action are required' }, { status: 400 })
  const teams = teamsFor(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
  if (!teams.includes(team)) return forbidden(`You do not act for ${team} approvals.`)
  const { data: oc } = await sb.from('onboarding_candidates').select('id, company_id').eq('id', onboardingId).maybeSingle()
  if (!oc || oc.company_id !== ctx.companyId) return forbidden('This onboarding is not in your company.')
  const { data: me } = await sb.from('employees').select('full_name').eq('id', ctx.caller.employeeId).maybeSingle()
  const out = await decideApproval(sb, {
    onboardingId, team, action, actorId: ctx.caller.employeeId, actorName: me?.full_name || null, remark: String(body.remark || '').trim() || null,
    mail: mailer(), baseUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status || 500 })
  return NextResponse.json(out)
}
