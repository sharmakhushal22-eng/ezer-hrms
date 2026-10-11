// app/api/recruitment/offer-revise/route.ts — the HR Head edits an offer and approves it.
//
//   POST { request_id, offered_ctc, variable_pct, joining_bonus, joining_bonus_freq,
//          retention_bonus, esop_value, esop_vesting, proposed_doj, comment }
//
// Used when the HR Manager sends an offer back for revision (Offers → Revision), and on any offer
// still waiting for the HR Head. A changed CTC is recomputed with the same Automated CTC model and
// the same inputs (state, minimum wage, gratuity, bonus, HRA cap) the recruiter's calculation
// used, so the salary break-up on the letter follows the new CTC. The revised calculation is kept
// on the request (revised_calculation); the candidate's original negotiation is left as it was.
// Saving approves the offer: it goes straight to Send Offers.

import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { computeCtc } from '@/lib/recruitment/ctc-model'
import { linkStatementRows } from '@/lib/recruitment/ctc-statement'
import { notifyDecided } from '@/lib/recruitment/offer-approval-notify'
import { actorName } from '@/lib/recruitment/actor'

export const runtime = 'nodejs'
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const num = (v: any) => (v === '' || v == null) ? 0 : Number(v)
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment', 'EDIT')
  if (gate.error) return gate.error
  const grant = await grantForRequest(req)
  const isHead = grant.legacy || grant.isSuperAdmin || (grant.roles || []).some((r: any) => r.role_code === 'HR_HEAD')
  if (!isHead) return bad('Only the HR Head can edit an offer.', 403)

  const b = await req.json().catch(() => null) as any
  if (!b?.request_id) return bad('request_id is required')
  const { data: r } = await sb.from('offer_approval_requests').select('*').eq('id', String(b.request_id)).maybeSingle()
  if (!r) return bad('Offer request not found', 404)
  if (r.status !== 'SUBMITTED') return bad('Only an offer waiting for the HR Head can be edited.', 409)
  const { data: neg } = r.ctc_negotiation_id
    ? await sb.from('ctc_negotiations').select('*').eq('id', r.ctc_negotiation_id).maybeSingle()
    : await sb.from('ctc_negotiations').select('*').eq('candidate_id', r.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const patch: any = {}
  const changes: Record<string, { from: any; to: any }> = {}
  const set = (k: string, v: any) => { if (String(r[k] ?? '') !== String(v ?? '')) { changes[k] = { from: r[k] ?? null, to: v } } patch[k] = v }

  for (const k of ['joining_bonus', 'retention_bonus', 'esop_value'] as const) {
    if (b[k] === undefined) continue
    const v = num(b[k]); if (!isFinite(v) || v < 0) return bad(`${k.replace(/_/g, ' ')} must be a positive amount`)
    set(k, v)
  }
  if (b.joining_bonus_freq !== undefined) set('joining_bonus_freq', String(b.joining_bonus_freq || '') || null)
  if (b.esop_vesting !== undefined) set('esop_vesting', String(b.esop_vesting || '') || null)
  if (b.proposed_doj !== undefined) {
    const d = String(b.proposed_doj || '')
    if (!d || isNaN(+new Date(d))) return bad('Enter a valid date of joining')
    set('proposed_doj', d)
    patch.days_to_join = Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000))
  }

  // Compensation — recomputed, never just overwritten.
  const ctc = b.offered_ctc === undefined ? Number(r.offered_ctc) : num(b.offered_ctc)
  const vPct = b.variable_pct === undefined ? Number(r.offered_variable_pct ?? neg?.variable_pct ?? 0) : num(b.variable_pct)
  const ctcChanged = Math.round(ctc) !== Math.round(Number(r.offered_ctc || 0)) || Number(vPct) !== Number(r.offered_variable_pct ?? neg?.variable_pct ?? 0)
  if (ctcChanged) {
    if (neg?.is_stipend) return bad('This is a stipend offer — change the stipend from Negotiation and raise a fresh request.')
    if (!(ctc > 0)) return bad('Enter the annual CTC')
    if (!(vPct >= 0 && vPct < 100)) return bad('Variable % must be between 0 and 99')
    const base = r.revised_calculation || neg?.calculation_data || {}
    if (!base.state || base.minWage == null) return bad('The original salary calculation is missing its inputs — revise this offer from Negotiation instead.')
    const model = computeCtc({
      ctcAnnual: ctc, variableAnnual: Math.round(ctc * vPct / 100), minWage: Number(base.minWage), state: base.state,
      gratuity: base.gratuity, bonusPct: Number(base.bonusPct) || 0, bonusMode: base.bonusMode, epfCeiling: base.epfCeiling, hraMax: base.hraMax,
    })
    if (!model.ok) return bad(`A CTC of ${inr(ctc)} is below the minimum for ${base.state}: the fixed part must be at least ${inr(model.minReqFixedAnn)} a year to cover basic wages, PF/ESIC, gratuity and bonus.`)
    const revised = {
      ...base, ...model,
      joining_bonus: patch.joining_bonus ?? r.joining_bonus ?? base.joining_bonus ?? 0,
      retention_bonus: patch.retention_bonus ?? r.retention_bonus ?? base.retention_bonus ?? 0,
      esop: patch.esop_value ?? r.esop_value ?? base.esop ?? 0,
    }
    const link = linkStatementRows(revised, ctc)
    set('offered_ctc', ctc)
    set('offered_variable_pct', vPct)
    patch.revised_calculation = revised
    patch.monthly_inhand = link ? Math.round(link.inHand) : Math.round(model.inHand)
    const prev = Number(r.prev_total_ctc || neg?.current_ctc || 0)
    patch.hike_pct = prev > 0 ? Math.round((ctc - prev) / prev * 1000) / 10 : r.hike_pct
  } else if (r.revised_calculation && ('joining_bonus' in patch || 'retention_bonus' in patch || 'esop_value' in patch)) {
    patch.revised_calculation = { ...r.revised_calculation, joining_bonus: patch.joining_bonus ?? r.joining_bonus, retention_bonus: patch.retention_bonus ?? r.retention_bonus, esop: patch.esop_value ?? r.esop_value }
  }

  const by = await actorName(gate.user)
  const now = new Date().toISOString()
  const comment = String(b.comment || '').trim() || (Object.keys(changes).length ? 'Offer revised by the HR Head' : 'Approved')
  const { error } = await sb.from('offer_approval_requests').update({
    ...patch, revised_at: now, revised_by: by,
    status: 'HR_HEAD_APPROVED', hr_head_action: 'APPROVED', hr_head_comments: comment, hr_head_actioned_at: now,
  }).eq('id', r.id).eq('status', 'SUBMITTED')
  if (error) return bad(error.message.includes('revis') ? 'Run migration 134 in Supabase first (revision columns are missing).' : error.message, 500)

  // The offer file (Send Offers) must be verified again against the revised offer.
  const { data: cand } = await sb.from('candidates').select('application_details, company_id').eq('id', r.candidate_id).maybeSingle()
  if (cand?.application_details && typeof cand.application_details === 'object' && cand.application_details.offer_verification) {
    const ad = { ...cand.application_details }; delete ad.offer_verification
    await sb.from('candidates').update({ application_details: ad }).eq('id', r.candidate_id)
  }
  await sb.from('recruitment_audit_logs').insert({ candidate_id: r.candidate_id, company_id: r.company_id || cand?.company_id || null, action_type: 'OFFER_REVISED_BY_HR_HEAD', details: { request_id: r.id, by, changes, comment }, created_at: now })
  const n = await notifyDecided(sb as any, r.id).catch(() => null)
  return NextResponse.json({ ok: true, changes, notified: n && 'notified' in n ? n.notified : 0 })
}
