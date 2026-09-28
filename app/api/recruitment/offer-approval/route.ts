// app/api/recruitment/offer-approval/route.ts
//
//   POST { action:'submitted', request_id }  -> tell the company's HR Head(s) an offer is waiting
//                                                for review (ESS notification + bell, deep link to
//                                                the HR Head tab).
//   POST { action:'decided',   request_id }  -> after the HR Head approves / rejects, tell the
//                                                recruiter(s) on the MRF and the HR managers who
//                                                send the offer.
//
// The offer-approval writes themselves stay in the dashboard (browser-side); this route only
// routes the notifications, which need the service role and the ESS role tables.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notify } from '@/lib/ess/session'

export const runtime = 'nodejs'

type Person = { id: string; name: string; code: string | null; role: string }

/** Active holders of the given ESS roles inside one company. */
async function roleHolders(companyId: string | null, roleCodes: string[]): Promise<Person[]> {
  if (!companyId) return []
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', roleCodes)
  const roleIds = (roles || []).map((r: any) => r.id)
  if (!roleIds.length) return []
  const codeOf: Record<string, string> = {}
  ;(roles || []).forEach((r: any) => { codeOf[r.id] = r.role_code })
  const { data: urs } = await sb.from('ess_user_roles')
    .select('role_id, ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id))')
    .in('role_id', roleIds).eq('is_active', true)
  const seen = new Set<string>(); const out: Person[] = []
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (e && e.company_id === companyId && !seen.has(e.id)) { seen.add(e.id); out.push({ id: e.id, name: e.full_name, code: e.emp_code, role: codeOf[u.role_id] }) }
  }
  return out
}

const lakh = (n: any) => `₹${(Number(n || 0) / 100000).toFixed(2)}L`

// GET ?company_ids=a,b  -> { heads: { [company_id]: [{ id, name, code }] } }  (who approves, per company)
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const heads: Record<string, { id: string; name: string; code: string | null }[]> = {}
  await Promise.all(ids.map(async id => { heads[id] = (await roleHolders(id, ['HR_HEAD'])).map(({ id, name, code }) => ({ id, name, code })) }))
  return NextResponse.json({ heads })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const requestId = String(body?.request_id || '')
  if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })

  const { data: r } = await sb.from('offer_approval_requests')
    .select('id, candidate_id, mrf_id, company_id, status, offered_ctc, proposed_doj, hike_pct, hr_head_comments, hr_head_action')
    .eq('id', requestId).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Offer approval request not found' }, { status: 404 })

  const [{ data: cand }, { data: mrf }] = await Promise.all([
    sb.from('candidates').select('full_name, designation, company_id, mrf_id').eq('id', r.candidate_id).maybeSingle(),
    r.mrf_id ? sb.from('manpower_requisitions').select('mrf_number, designation, position, assigned_recruiter_ids, requested_by, company_id').eq('id', r.mrf_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const companyId = r.company_id || cand?.company_id || (mrf as any)?.company_id || null
  const who = cand?.full_name || 'a candidate'
  const role = (mrf as any)?.designation || (mrf as any)?.position || cand?.designation || ''
  const ref = (mrf as any)?.mrf_number ? ` · ${(mrf as any).mrf_number}` : ''

  // ── Recruiter → HR Head: "review and approve" ──
  if (body.action === 'submitted') {
    const heads = await roleHolders(companyId, ['HR_HEAD'])
    if (!heads.length) return NextResponse.json({ ok: true, notified: 0, warning: 'No HR Head is set for this company — nobody was notified.' })
    await Promise.all(heads.map(h => notify(
      h.id,
      `Offer approval — ${who}${role ? ` (${role})` : ''}`,
      `An offer of ${lakh(r.offered_ctc)} for ${who}${role ? `, ${role}` : ''}${ref} is waiting for your review and approval${r.proposed_doj ? ` (proposed DOJ ${new Date(r.proposed_doj).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Open Recruitment → HR Head to approve or reject.`,
      '/ess-portal?module=recruitment&tab=hrhead',
      'APPROVAL',
    ).catch(() => null)))
    return NextResponse.json({ ok: true, notified: heads.length, to: heads.map(h => `${h.name} (${h.code})`) })
  }

  // ── HR Head → recruiter(s) + HR managers: the decision ──
  if (body.action === 'decided') {
    const approved = r.status === 'HR_HEAD_APPROVED' || r.hr_head_action === 'APPROVED'
    const rejected = r.status === 'HR_HEAD_REJECTED' || r.hr_head_action === 'REJECTED'
    if (!approved && !rejected) return NextResponse.json({ error: 'This request has not been decided yet' }, { status: 409 })
    const recruiterIds: string[] = Array.isArray((mrf as any)?.assigned_recruiter_ids) ? (mrf as any).assigned_recruiter_ids : []
    const managers = approved ? await roleHolders(companyId, ['HR_MANAGER']) : []
    const targets = new Set<string>([...recruiterIds, ...managers.map(m => m.id)])
    if ((mrf as any)?.requested_by && !approved) targets.add((mrf as any).requested_by)   // the raiser hears about a rejection too
    const note = r.hr_head_comments ? ` Comment: “${r.hr_head_comments}”` : ''
    await Promise.all([...targets].map(id => notify(
      id,
      approved ? `Offer approved — ${who}${role ? ` (${role})` : ''}` : `Offer rejected — ${who}${role ? ` (${role})` : ''}`,
      approved
        ? `The HR Head approved the ${lakh(r.offered_ctc)} offer for ${who}${ref}.${note} Send the offer letter from Recruitment → Send Offers.`
        : `The HR Head rejected the ${lakh(r.offered_ctc)} offer for ${who}${ref}.${note} Revise the negotiation and raise a fresh approval request.`,
      approved ? '/ess-portal?module=recruitment&tab=sendoffer' : '/ess-portal?module=recruitment&tab=offerapproval',
      'APPROVAL',
    ).catch(() => null)))
    return NextResponse.json({ ok: true, notified: targets.size, outcome: approved ? 'APPROVED' : 'REJECTED' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
