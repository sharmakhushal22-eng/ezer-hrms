// /api/ess/mrf — raise an MRF from the ESS portal, and approve/reject one.
//
// Approval routing (per spec):
//   • Raised by an RM1 (first-line manager)  → the raiser's own manager (the new
//     hire's RM2) → HR Head.
//   • Raised by an RM2 (second-line manager) → HR Head directly.
// Everything is scoped to the raiser's company: the RM2 is the raiser's own
// l1_manager, and the HR Head is whoever holds HR_HEAD in that company.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, notify } from '@/lib/ess/session'

export const dynamic = 'force-dynamic'

type Brief = { id: string; name: string; code: string }

async function empBrief(id: string): Promise<Brief | null> {
  const { data } = await sb.from('employees').select('id, full_name, emp_code').eq('id', id).maybeSingle()
  return data ? { id: data.id, name: data.full_name as string, code: data.emp_code as string } : null
}

/** The HR Head of a company = whoever holds the HR_HEAD role and belongs to it. */
async function hrHeadFor(companyId: string | null): Promise<Brief | null> {
  if (!companyId) return null
  const { data: role } = await sb.from('ess_roles').select('id').eq('role_code', 'HR_HEAD').maybeSingle()
  if (!role) return null
  const { data: urs } = await sb.from('ess_user_roles')
    .select('ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id))')
    .eq('role_id', role.id).eq('is_active', true)
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (e && e.company_id === companyId) return { id: e.id, name: e.full_name, code: e.emp_code }
  }
  return null
}

// The people an HR Head can assign an approved MRF to — only Hiring Managers / Recruiters
// (the role that actually runs the hiring), never the broader HR team.
const HR_ROLE_CODES = ['RECRUITER']
async function hrTeamFor(companyId: string | null): Promise<(Brief & { role: string })[]> {
  if (!companyId) return []
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', HR_ROLE_CODES)
  const roleIds = (roles || []).map((r: any) => r.id)
  if (!roleIds.length) return []
  const roleByCode: Record<string, string> = {}
  ;(roles || []).forEach((r: any) => { roleByCode[r.id] = r.role_code })
  const { data: urs } = await sb.from('ess_user_roles')
    .select('role_id, ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id))')
    .in('role_id', roleIds).eq('is_active', true)
  const seen = new Set<string>(); const out: (Brief & { role: string })[] = []
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (e && e.company_id === companyId && !seen.has(e.id)) {
      seen.add(e.id); out.push({ id: e.id, name: e.full_name, code: e.emp_code, role: roleByCode[u.role_id] })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId
  const canRaise = ctx.menu.is_rm || ctx.menu.is_hod || ctx.canApprovals

  // All independent reads in parallel — one round-trip's worth of latency, not six.
  const [allRes, mineRes, deptsRes, hrOptions, meRes] = await Promise.all([
    sb.from('manpower_requisitions')
      .select('id, mrf_number, designation, position, job_title, no_of_openings, openings, reason, reason_for_hire, urgency, status, approval_chain, raised_by_name, raised_by_role, department_id, company_id, location_id, created_at, requested_by, mrf_type, hiring_type, employment_type, work_mode, grade, job_code, business_unit, currency, budget_min, budget_max, pay_period, compensation_type, target_joining_date, validity_date, business_justification, skills_required, good_to_have_skills, experience_min, experience_max, education_min, education_max, cost_center, is_budgeted, headcount_ref, sourcing_mode, departments:department_id(dept_name), companies:company_id(company_name), locations:location_id(location_name)')
      .eq('status', 'SUBMITTED').order('created_at', { ascending: false }).limit(500),
    sb.from('manpower_requisitions')
      .select('*, departments:department_id(dept_name)')
      .eq('requested_by', me).order('created_at', { ascending: false }).limit(60),
    sb.from('departments').select('id, dept_name').eq('company_id', ctx.companyId).eq('status', 'Active').order('dept_name'),
    hrTeamFor(ctx.companyId),
    sb.from('employees').select('full_name, emp_code, l1_manager_id').eq('id', me).maybeSingle(),
  ])

  const toApprove = (allRes.data || []).filter((m: any) => {
    const chain = Array.isArray(m.approval_chain) ? m.approval_chain : []
    return chain.find((s: any) => s.status === 'PENDING')?.approver_id === me
  })

  // Auto-fill for the raise form: RM1 = the raiser, RM2 = the raiser's own manager.
  const meRow: any = meRes.data
  const rm2 = meRow?.l1_manager_id ? await empBrief(meRow.l1_manager_id as string) : null
  const raiser = {
    rm1: meRow ? { name: meRow.full_name, code: meRow.emp_code } : null,
    rm2: rm2 ? { name: rm2.name, code: rm2.code } : null,
  }

  // MRFs an HR Head assigned to me to run the hiring — for the "assigned to you" block in
  // Tasks & Approvals. Resilient: if the acknowledged column isn't there yet, treat all as
  // un-acknowledged rather than failing the whole request.
  let myAssignments: any[] = []
  const asgRes = await sb.from('manpower_requisitions')
    .select('id, designation, position, mrf_number, no_of_openings, openings, assigned_recruiter, acknowledged_recruiter_ids, departments:department_id(dept_name)')
    .contains('assigned_recruiter_ids', [me]).eq('status', 'APPROVED').order('created_at', { ascending: false }).limit(100)
  if (!asgRes.error) {
    myAssignments = (asgRes.data || []).map((m: any) => ({ ...m, acknowledged: Array.isArray(m.acknowledged_recruiter_ids) && m.acknowledged_recruiter_ids.includes(me) }))
  } else {
    const alt = await sb.from('manpower_requisitions')
      .select('id, designation, position, mrf_number, no_of_openings, openings, assigned_recruiter, departments:department_id(dept_name)')
      .contains('assigned_recruiter_ids', [me]).eq('status', 'APPROVED').order('created_at', { ascending: false }).limit(100)
    myAssignments = (alt.data || []).map((m: any) => ({ ...m, acknowledged: false }))
  }

  return NextResponse.json({ canRaise, toApprove, mine: mineRes.data || [], departments: deptsRes.data || [], hrOptions, raiser, myAssignments })
}

export async function POST(req: NextRequest) {
  const r = await essRoute(req); if (r.error) return r.error
  const { ctx } = r
  if (ctx.caller.viewAs) return forbidden('MRF actions cannot be done while viewing as somebody else.')
  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  // ── Raise a new MRF ────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!(ctx.menu.is_rm || ctx.menu.is_hod || ctx.canApprovals)) return forbidden('You do not have rights to raise an MRF.')
    const designation = String(body.designation || '').trim()
    if (!designation) return NextResponse.json({ error: 'Designation is required.' }, { status: 400 })

    // DRAFT can be half-finished and routes to nobody; SUBMITTED builds the approval chain.
    const status = body.status === 'DRAFT' ? 'DRAFT' : 'SUBMITTED'

    const { data: meRow } = await sb.from('employees')
      .select('id, full_name, company_id, department_id, l1_manager_id').eq('id', me).maybeSingle()
    if (!meRow) return forbidden()

    // Resubmit / edit-after-send-back: scrap the previous requisition (only the raiser's
    // own, and only while it is still their draft / awaiting approval / needs revision).
    const replaceId = String(body.replace_id || '')
    if (replaceId) {
      const { data: old } = await sb.from('manpower_requisitions').select('id, requested_by, status').eq('id', replaceId).maybeSingle()
      if (old && old.requested_by === me && ['SUBMITTED', 'DRAFT', 'NEEDS_REVISION'].includes(String(old.status))) {
        await sb.from('manpower_requisitions').delete().eq('id', replaceId)
      }
    }

    // Is the raiser an RM2 (a second-line manager)? Read it off the grant essRoute
    // already loaded — no extra round trips. Then fetch the RM2 (raiser's manager) and
    // the HR Head in parallel.
    const isRM2 = (ctx.grant.roles || []).some((r: any) => r.role_code === 'L2_MANAGER')
    const [rm2Brief, hh] = await Promise.all([
      (!isRM2 && meRow.l1_manager_id) ? empBrief(meRow.l1_manager_id as string) : Promise.resolve(null),
      hrHeadFor(meRow.company_id as string),
    ])

    const chain: any[] = []
    if (rm2Brief) {
      chain.push({ order: 1, role: 'RM2', approver_id: rm2Brief.id, approver_name: rm2Brief.name, approver_code: rm2Brief.code, status: 'PENDING', acted_at: null, comment: null })
    }
    if (hh && hh.id !== me) chain.push({ order: chain.length + 1, role: 'HR_HEAD', approver_id: hh.id, approver_name: hh.name, approver_code: hh.code, status: chain.length ? 'WAITING' : 'PENDING', acted_at: null, comment: null })
    if (status === 'SUBMITTED' && !chain.length) return NextResponse.json({ error: 'No approver could be found — your company has no HR Head / manager set. Please contact HR.' }, { status: 400 })

    const openings = Math.max(1, Number(body.openings) || 1)
    const nOrNull = (v: any) => (v === '' || v === null || v === undefined) ? null : (Number(v) || null)
    const sOrNull = (v: any) => { const s = String(v ?? '').trim(); return s || null }
    const isBudgeted = body.is_budgeted === '' || body.is_budgeted == null ? null : (body.is_budgeted === 'yes' || body.is_budgeted === true)
    const reason = sOrNull(body.reason)

    const { data: created, error } = await sb.from('manpower_requisitions').insert({
      // company & department are LOCKED to the raiser — never taken from the client.
      company_id: meRow.company_id,
      department_id: meRow.department_id || null,
      designation, position: designation,
      job_title: sOrNull(body.job_title) || designation,
      no_of_openings: openings, openings,
      mrf_type: sOrNull(body.mrf_type), hiring_type: sOrNull(body.hiring_type),
      urgency: sOrNull(body.urgency) || 'MEDIUM',
      business_unit: sOrNull(body.business_unit), grade: sOrNull(body.grade), job_code: sOrNull(body.job_code),
      employment_type: sOrNull(body.employment_type) || 'Employee',
      work_mode: sOrNull(body.work_mode), location_id: body.location_id || null, shift_schedule: sOrNull(body.shift_schedule),
      cost_center: sOrNull(body.cost_center), is_budgeted: isBudgeted, headcount_ref: sOrNull(body.headcount_ref),
      currency: sOrNull(body.currency) || 'INR', budget_min: nOrNull(body.budget_min), budget_max: nOrNull(body.budget_max),
      compensation_type: sOrNull(body.compensation_type), pay_period: sOrNull(body.pay_period), duration_months: nOrNull(body.duration_months),
      reason, reason_for_hire: reason,
      outgoing_employee_id: body.outgoing_employee_id || null, exit_reason: sOrNull(body.exit_reason),
      business_justification: sOrNull(body.business_justification),
      target_joining_date: body.target_joining_date || null, validity_date: body.validity_date || null,
      experience_min: nOrNull(body.experience_min), experience_max: nOrNull(body.experience_max),
      education_min: sOrNull(body.education_min), education_max: sOrNull(body.education_max),
      previous_company_preference: sOrNull(body.previous_company_preference),
      skills_required: sOrNull(body.skills_required), good_to_have_skills: sOrNull(body.good_to_have_skills),
      job_description: sOrNull(body.job_description),
      sourcing_mode: sOrNull(body.sourcing_mode), sourcing_channels: Array.isArray(body.sourcing_channels) ? body.sourcing_channels : [],
      status,
      requested_by: me,
      raised_by_name: sOrNull(body.raised_by_name) || meRow.full_name,
      raised_by_role: sOrNull(body.raised_by_role) || (isRM2 ? 'RM2' : 'RM1'),
      reporting_manager_id: me,                        // new hire's RM1 = the raiser
      rm2_id: (meRow.l1_manager_id as string) || null, // new hire's RM2 = raiser's manager
      hod_id: body.hod_id || null,
      approval_chain: chain,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: created.id, status })
  }

  // ── Approve / reject / send back for revision ──────────────────────────────
  if (action === 'approve' || action === 'reject' || action === 'revise') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const { data: mrf } = await sb.from('manpower_requisitions').select('id, status, approval_chain, requested_by, designation, position, mrf_number').eq('id', id).maybeSingle()
    if (!mrf) return NextResponse.json({ error: 'MRF not found' }, { status: 404 })
    const chain = Array.isArray(mrf.approval_chain) ? mrf.approval_chain.map((s: any) => ({ ...s })) : []
    const cur = chain.find((s: any) => s.status === 'PENDING')
    if (!cur) return NextResponse.json({ error: 'This MRF is not awaiting approval.' }, { status: 400 })
    if (cur.approver_id !== me && !ctx.grant.isSuperAdmin) return forbidden('This MRF is not waiting on you.')

    const now = new Date().toISOString()
    const note = String(body.note || '').trim() || null

    // Send back for revision — the approver spotted something; the raiser (RM1) fixes it
    // and resubmits, which re-enters the chain from the top.
    if (action === 'revise') {
      if (!note) return NextResponse.json({ error: 'Add a remark explaining what to fix.' }, { status: 400 })
      cur.status = 'REVISION'; cur.acted_at = now; cur.comment = note
      await sb.from('manpower_requisitions').update({ approval_chain: chain, status: 'NEEDS_REVISION', remarks: note }).eq('id', id)
      const label = `${mrf.designation || mrf.position || 'your requisition'}${mrf.mrf_number ? ` (${mrf.mrf_number})` : ''}`
      await notify(mrf.requested_by as string, 'MRF sent back for changes',
        `${label} was sent back by ${cur.approver_name || 'an approver'}: “${note}”. Open Tasks & Approvals to edit and resubmit it.`, '/ess?tab=approvals', 'MRF')
      return NextResponse.json({ ok: true })
    }

    if (action === 'reject') {
      cur.status = 'REJECTED'; cur.acted_at = now; cur.comment = note
      await sb.from('manpower_requisitions').update({ approval_chain: chain, status: 'REJECTED' }).eq('id', id)
      return NextResponse.json({ ok: true })
    }

    cur.status = 'APPROVED'; cur.acted_at = now; cur.comment = note
    const next = chain.find((s: any) => s.status === 'WAITING')
    const patch: any = { approval_chain: chain }
    if (next) next.status = 'PENDING'   // advance the chain to the next approver
    else patch.status = 'APPROVED'       // no next step → fully approved
    // At the HR Head step, the approval carries the HR assignment — the people who
    // will run the hiring. Scoped to the HR Head's own company on the client too.
    const assignedHr: string[] = (cur.role === 'HR_HEAD' && Array.isArray(body.assigned_hr_ids)) ? body.assigned_hr_ids.slice(0, 20).map((x: any) => String(x)) : []
    if (assignedHr.length) {
      patch.assigned_recruiter_ids = assignedHr
      const briefs = await Promise.all(assignedHr.map((x: string) => empBrief(x)))
      patch.assigned_recruiter = briefs.filter(Boolean).map((b: any) => `${b.name} (${b.code})`).join(', ') || null
    }
    await sb.from('manpower_requisitions').update(patch).eq('id', id)

    // Tell each assigned hiring manager they've been given this requisition to run — they
    // acknowledge it in Tasks & Approvals and pick up the MRF in Recruitment.
    if (assignedHr.length) {
      const { data: info } = await sb.from('manpower_requisitions').select('designation, position, mrf_number').eq('id', id).maybeSingle()
      const label = `${info?.designation || info?.position || 'a role'}${info?.mrf_number ? ` (${info.mrf_number})` : ''}`
      await Promise.all(assignedHr.map(hid => notify(hid, 'You have been assigned an MRF',
        `You have been assigned to hire for ${label}. Acknowledge it in Tasks & Approvals, then run the hiring in Recruitment.`, '/ess?tab=approvals', 'MRF')))
    }
    return NextResponse.json({ ok: true })
  }

  // ── Acknowledge an assignment (the hiring manager confirms it) ──────────────
  if (action === 'acknowledge') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const { data: mrf } = await sb.from('manpower_requisitions').select('assigned_recruiter_ids, acknowledged_recruiter_ids').eq('id', id).maybeSingle()
    if (!mrf) return NextResponse.json({ error: 'MRF not found' }, { status: 404 })
    if (!Array.isArray(mrf.assigned_recruiter_ids) || !mrf.assigned_recruiter_ids.includes(me)) return forbidden('This MRF is not assigned to you.')
    const ack = Array.isArray(mrf.acknowledged_recruiter_ids) ? mrf.acknowledged_recruiter_ids : []
    if (!ack.includes(me)) {
      const { error } = await sb.from('manpower_requisitions').update({ acknowledged_recruiter_ids: [...ack, me] }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
