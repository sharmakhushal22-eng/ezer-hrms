// app/api/ess/onboarding-approvals/route.ts
//
//   GET                      → { teams, items }  the onboardings of the caller's company that
//                              the HR Manager has accepted, for the head teams the caller acts
//                              for (IT, Admin, Payroll), each with every team's status
//   GET ?open=<onboarding_id> → the full form (form_data), the documents with signed URLs, and
//                              each team's checklist so far, for the review drawer
//   POST { onboarding_id, team, action:'approve'|'return'|'save', remark, checklist }
//                              the head's decision — approve needs the checklist complete —
//                              or a checklist save without deciding
//
// ESS → HRIS → Tasks & Approvals → Onboarding approvals. The HR Manager accepts the form from
// the onboarding card (Review form), not here. When the third head approves, the HR Manager
// assigns the role and generates the code (lib/onboarding/approvals.ts).

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden } from '@/lib/ess/session'
import { teamsFor, decideApproval, TEAMS, HEAD_TEAMS, type Team } from '@/lib/onboarding/approvals'
import { CHECKLISTS, isHeadTeam } from '@/lib/onboarding/checklists'
import { reviewPayload } from '@/lib/onboarding/review'
import { loadSalaryBreakdown } from '@/lib/onboarding/salary-breakdown'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mailer = () => {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return { t: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>` }
}
const headTeamsOf = (roles: string[], superAdmin: boolean) => teamsFor(roles, superAdmin).filter((t): t is Team => t !== 'HR_MANAGER')
const COLUMN_KEYS = [...new Set(HEAD_TEAMS.flatMap(t => CHECKLISTS[t].fields.filter(f => f.column).map(f => f.key)))]

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const teams = headTeamsOf(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
  if (!teams.length || !ctx.companyId) return NextResponse.json({ teams, items: [] })

  const open = req.nextUrl.searchParams.get('open')
  if (open) {
    const payload = await reviewPayload(sb, open, { companyId: ctx.companyId, maskBank: !teams.includes('PAYROLL') })
    if (!payload) return NextResponse.json({ error: 'Not found in your company' }, { status: 404 })
    // Each head's checklist: what the row holds, else what the candidate's columns already say
    // (the offer's CTC for Payroll, for instance).
    const { data: cols } = await sb.from('onboarding_candidates').select(['id', 'candidate_id', 'offered_ctc', 'location_id', 'form_data', ...COLUMN_KEYS].join(', ')).eq('id', open).maybeSingle()
    // Payroll approves the salary structure, so their form carries the breakdown: the saved
    // negotiation model, the offer letter, or the CTC model on the CTC held — and the CTC and
    // basic % of the checklist start from it.
    const salary = teams.includes('PAYROLL') && cols ? await loadSalaryBreakdown(sb, cols as any) : null
    const checklists: Record<string, any> = {}
    for (const t of HEAD_TEAMS) {
      const row = payload.approvals.find((a: any) => a.team === t)
      const fromCols: Record<string, any> = {}
      for (const f of CHECKLISTS[t].fields) if (f.column && cols && (cols as any)[f.key] != null) fromCols[f.key] = (cols as any)[f.key]
      if (t === 'PAYROLL') {
        if (fromCols.annual_ctc == null) fromCols.annual_ctc = salary?.annual_ctc || (cols as any)?.offered_ctc || null
        if (fromCols.basic_pct == null && salary?.basic_pct != null) fromCols.basic_pct = salary.basic_pct
      }
      checklists[t] = { ...fromCols, ...(row?.checklist || {}) }
    }
    return NextResponse.json({ teams, ...payload, checklists, salary })
  }

  const { data: rows } = await sb.from('onboarding_candidates')
    .select('id, full_name, designation, department, employment_type, date_of_joining, status, submitted_at, hr_notes')
    .eq('company_id', ctx.companyId).in('status', ['HR_REVIEW', 'APPROVED']).order('submitted_at', { ascending: true })
  const ids = (rows || []).map((x: any) => x.id)
  const { data: apps } = ids.length ? await sb.from('onboarding_approvals').select('onboarding_id, team, status, acted_by_name, remark, acted_at').in('onboarding_id', ids) : { data: [] as any[] }
  const by = new Map<string, any[]>()
  for (const a of apps || []) { const l = by.get(a.onboarding_id) || []; l.push(a); by.set(a.onboarding_id, l) }
  const items = (rows || []).flatMap((x: any) => {
    const list = by.get(x.id) || []
    const approvals = TEAMS.map(t => list.find(a => a.team === t) || { team: t, status: 'PENDING', acted_by_name: null, remark: null, acted_at: null })
    // Only once the HR Manager has accepted does it reach the heads.
    if (approvals.find(a => a.team === 'HR_MANAGER')?.status !== 'APPROVED') return []
    const mine = teams.filter(t => approvals.find(a => a.team === t)?.status === 'PENDING')
    return [{ ...x, approvals, waiting_on_me: mine }]
  })
  return NextResponse.json({ teams, items })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so there is nobody to record the approval for. Sign in again with your own ESS account.'
      : 'An approval is recorded under your own name, so it cannot be actioned while you are viewing somebody else\'s portal. Open your own portal to approve.')
  }
  const body = await req.json().catch(() => ({}))
  const team = String(body.team || '').toUpperCase() as Team
  const action = body.action === 'return' ? 'return' : body.action === 'approve' ? 'approve' : body.action === 'save' ? 'save' : null
  const onboardingId = String(body.onboarding_id || '')
  if (!onboardingId || !isHeadTeam(team) || !action) return NextResponse.json({ error: 'onboarding_id, team (IT | ADMIN | PAYROLL) and action are required' }, { status: 400 })
  const teams = headTeamsOf(ctx.menu.roles || [], !!ctx.grant.isSuperAdmin)
  if (!teams.includes(team)) return forbidden(`You do not act for ${team} approvals.`)
  const { data: oc } = await sb.from('onboarding_candidates').select('id, company_id, candidate_id, offered_ctc, annual_ctc, pt_state, location_id, form_data').eq('id', onboardingId).maybeSingle()
  if (!oc || oc.company_id !== ctx.companyId) return forbidden('This onboarding is not in your company.')
  const { data: me } = await sb.from('employees').select('full_name').eq('id', ctx.caller.employeeId).maybeSingle()
  const checklist: Record<string, any> | null = body.checklist && typeof body.checklist === 'object' ? { ...body.checklist } : null
  // Payroll approves a salary structure: the breakdown for the CTC they confirmed is kept with
  // the approval, and the basic % of the checklist follows it.
  let extra: Record<string, any> | null = null
  if (team === 'PAYROLL' && checklist && action !== 'return') {
    const s = await loadSalaryBreakdown(sb, oc as any, Number(checklist.annual_ctc) || null)
    if (s.source !== 'none') {
      if (s.basic_pct != null) checklist.basic_pct = s.basic_pct
      extra = { salary_breakdown: { source: s.source, label: s.label, annual_ctc: s.annual_ctc, basic_monthly: s.basic_monthly, basic_pct: s.basic_pct, rows: s.rows, note: s.note || null } }
    }
  }
  const out = await decideApproval(sb, {
    onboardingId, team, action, actorId: ctx.caller.employeeId, actorName: me?.full_name || null, remark: String(body.remark || '').trim() || null,
    checklist, extra,
    mail: mailer(), baseUrl: process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin,
  })
  if (!out.ok) return NextResponse.json({ error: out.error, missing: out.missing }, { status: out.status || 500 })
  return NextResponse.json(out)
}
