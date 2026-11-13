// app/api/flexi/claims/route.ts — Flexi Claims API.
// POST actions: SUBMIT · APPROVE · REJECT · REQUEST_LIMIT · APPROVE_LIMIT_REQUEST ·
//               OVERRIDE_LIMIT  (TOGGLE_WINDOW is refused: the window runs the 1st–20th on its own)
// GET: claims by employee_id or company_id (+ month/year/status filters).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { companyFilter } from '@/lib/rms/resolve'
import { requireAccess, requireSelfOrModule, inCompany, refuse } from '@/lib/rms/authz'
import { resolveFlexi, COMP_NAMES } from '@/lib/flexi/resolve-server'
import { FY } from '@/lib/flexi/claims'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

// Who may do what here, from the session (none of this was checked before — any request
// could approve claims, raise somebody's tax-free limits or read a whole company's bills):
//   SUBMIT / REQUEST_LIMIT      the employee themself (Flexi staff may file for someone)
//   APPROVE / REJECT / limits   Flexi Claims EDIT, on claims of a company in the caller's scope
//   GET ?employee_id            the employee, or Flexi Claims VIEW in their company
//   GET ?company_id             Flexi Claims VIEW, pinned to the caller's companies

/** The claims named by `ids`, refusing the whole batch if any is outside the caller's companies. */
async function claimsInScope(ids: string[], g: Parameters<typeof inCompany>[0]) {
  const { data } = await supa.from('flexi_claims').select('id, company_id, claim_amount').in('id', ids)
  const rows = data ?? []
  if (rows.length !== ids.length) return { error: refuse(404, 'One or more claims were not found.'), rows }
  if (rows.some(r => !inCompany(g, r.company_id, 'Flexi Claims'))) return { error: refuse(403, 'Some of these claims belong to a company outside your access.'), rows }
  return { error: null, rows }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'SUBMIT') {
      const { employee_id: asked, component_code, claim_amount, bill_date, bill_no, agency_name, vendor_desc, remark, supporting_remark } = body
      const who = await requireSelfOrModule(req, asked, 'Flexi Claims', 'EDIT')
      if (who.error) return who.error
      const employee_id = who.subjectId
      if (!(claim_amount > 0)) return NextResponse.json({ error: 'Claim amount must be greater than zero.' }, { status: 400 })
      // A bill must be dated inside the current financial year (1 Apr – 31 Mar) and never in
      // the future — the client enforces this too, but the server is the one that must hold.
      if (bill_date) {
        const fyStart = `${FY.slice(0, 4)}-04-01`, fyEnd = `${Number(FY.slice(0, 4)) + 1}-03-31`
        const today = new Date().toISOString().slice(0, 10)
        if (bill_date < fyStart || bill_date > fyEnd) return NextResponse.json({ error: `The bill date must be in the current financial year (FY ${FY}).` }, { status: 400 })
        if (bill_date > today) return NextResponse.json({ error: 'The bill date cannot be in the future.' }, { status: 400 })
      }
      // The window is the 1st–20th of every month, on its own (lib/flexi/window): the claim
      // goes on this month's window for the employee's company, whatever window_id the caller
      // sent. Inside it, what refuses a bill is the balance — the same resolver /api/ess/flexi
      // enforces, so the web and the app agree on what is left.
      const f = await resolveFlexi(String(employee_id || ''))
      if (!f.companyId || !f.window?.id) return NextResponse.json({ error: 'The employee’s company could not be found.' }, { status: 400 })
      if (!f.windowOpen) return NextResponse.json({ error: `Bills can be submitted from the 1st to the 20th of the month. The window opens again on ${new Date(`${f.diagnostics.reopensOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}.` }, { status: 400 })
      const head = f.heads.find(h => h.code === String(component_code || '').toUpperCase())
      if (!head) return NextResponse.json({ error: `${COMP_NAMES[component_code] || component_code} is not one of this employee’s flexi components this year.` }, { status: 400 })
      if (head.available <= 0) return NextResponse.json({ error: `Nothing is left on ${head.name}: the balance is ₹0, so no more bills can be submitted for it.` }, { status: 409 })
      if (Number(claim_amount) > head.available) return NextResponse.json({ error: `Only ₹${Math.round(head.available).toLocaleString('en-IN')} is left on ${head.name}; this bill is ₹${Math.round(Number(claim_amount)).toLocaleString('en-IN')}.` }, { status: 409 })
      const window_id = f.window.id, company_id = f.companyId

      // Rule-based AI flag (OCR service can override later).
      const ai_flag = claim_amount > 15000 ? 'flag' : 'clear'
      const ai_notes = ai_flag === 'flag' ? 'Amount above ₹15,000: manual review recommended' : null

      // agency_name is the vendor/agency; keep vendor_desc in sync for backward compat.
      const agency = agency_name || vendor_desc || null
      const { data: claim, error } = await supa.from('flexi_claims').insert({
        window_id, employee_id, company_id, component_code,
        claim_amount, bill_date: bill_date || null, bill_no: bill_no || null,
        agency_name: agency, vendor_desc: agency,
        remark: remark || null, supporting_remark: supporting_remark || null,
        status: 'PENDING', ai_flag, ai_notes,
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, claim_id: claim.id })
    }

    if (action === 'APPROVE') {
      const { ids } = body
      if (!ids?.length) return NextResponse.json({ error: 'No claim ids' }, { status: 400 })
      const gate = await requireAccess(req, 'Flexi Claims', 'EDIT')
      if (gate.error) return gate.error
      const scope = await claimsInScope(ids, gate.grant)
      if (scope.error) return scope.error
      const reviewer = gate.grant.name || gate.grant.empCode || 'Payroll'
      const { error } = await supa.from('flexi_claims')
        .update({ status: 'APPROVED', reviewed_by: gate.grant.employeeId, approved_by: reviewer, reviewed_at: new Date().toISOString(), rejection_reason: null })
        .in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, approved: ids.length })
    }

    if (action === 'REJECT') {
      const { ids, rejection_reason, approved_amount } = body
      if (!ids?.length) return NextResponse.json({ error: 'No claim ids' }, { status: 400 })
      if (!rejection_reason?.trim()) return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })
      const gate = await requireAccess(req, 'Flexi Claims', 'EDIT')
      if (gate.error) return gate.error
      const scope = await claimsInScope(ids, gate.grant)
      if (scope.error) return scope.error
      const reviewed_by = gate.grant.employeeId, approved_by = gate.grant.name || gate.grant.empCode || 'Payroll'

      // Partial rejection: ₹3,000 claimed but only ₹2,000 has a valid bill → ₹1,000 is
      // what loses its exemption. The rejected part is what Payroll taxes (sql99), so it
      // is stored explicitly rather than inferred from the status alone.
      // Only offered for a single claim — a shared amount across a bulk selection would
      // be meaningless.
      const partial = ids.length === 1 && approved_amount !== undefined && approved_amount !== null && approved_amount !== ''
      const patch: Record<string, any> = {
        status: 'REJECTED', reviewed_by: reviewed_by || null,
        approved_by: approved_by || 'Payroll Manager',
        reviewed_at: new Date().toISOString(), rejection_reason,
      }
      if (partial) {
        const { data: claim } = await supa.from('flexi_claims').select('claim_amount').eq('id', ids[0]).single()
        const claimed = Number(claim?.claim_amount) || 0
        const ok = Math.max(0, Math.min(Number(approved_amount) || 0, claimed))
        patch.approved_amount = ok
        patch.rejected_amount = claimed - ok
        // Everything proven → nothing to tax, so it is an approval, not a rejection.
        if (ok >= claimed) { patch.status = 'APPROVED'; patch.rejection_reason = null }
      } else {
        // Rejected outright: the whole claim is taxable.
        patch.approved_amount = 0
      }

      const { error } = await supa.from('flexi_claims').update(patch).in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, rejected: ids.length, partial })
    }

    if (action === 'REQUEST_LIMIT') {
      const { employee_id: asked, fy, component_code, current_limit, requested_limit, reason } = body
      if (!reason?.trim()) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
      const who = await requireSelfOrModule(req, asked, 'Flexi Claims', 'EDIT')
      if (who.error) return who.error
      const employee_id = who.subjectId
      // The company is the employee's, from their record — not whatever the body says.
      const { data: emp } = await supa.from('employees').select('company_id').eq('id', employee_id).maybeSingle()
      const { data, error } = await supa.from('flexi_limit_requests').insert({
        employee_id, company_id: emp?.company_id ?? null, fy, component_code, current_limit, requested_limit, reason, status: 'PENDING',
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, request_id: data?.id })
    }

    if (action === 'APPROVE_LIMIT_REQUEST') {
      const { request_id, reject_note } = body
      const gate = await requireAccess(req, 'Flexi Claims', 'EDIT')
      if (gate.error) return gate.error
      const { data: r } = await supa.from('flexi_limit_requests').select('*').eq('id', request_id).single()
      if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
      if (!inCompany(gate.grant, r.company_id, 'Flexi Claims')) return refuse(403, 'This request belongs to a company outside your access.')
      const approved_by = gate.grant.name || gate.grant.empCode || 'Payroll'
      if (reject_note) {
        await supa.from('flexi_limit_requests').update({ status: 'REJECTED', reviewed_by: approved_by || null, reviewed_at: new Date().toISOString(), rejection_note: reject_note }).eq('id', request_id)
        return NextResponse.json({ success: true, rejected: true })
      }
      await supa.from('flexi_limit_requests').update({ status: 'APPROVED', reviewed_by: approved_by || null, reviewed_at: new Date().toISOString() }).eq('id', request_id)
      await supa.from('flexi_limit_overrides').upsert({
        employee_id: r.employee_id, company_id: r.company_id, fy: r.fy, component_code: r.component_code,
        original_limit: r.current_limit, override_limit: r.requested_limit,
        override_reason: `Employee request approved: ${r.reason}`, approved_by: approved_by || null, is_active: true,
      }, { onConflict: 'employee_id,fy,component_code' })
      return NextResponse.json({ success: true })
    }

    if (action === 'OVERRIDE_LIMIT') {
      const { employee_id, fy, overrides, reason } = body
      if (!reason?.trim()) return NextResponse.json({ error: 'Override reason required' }, { status: 400 })
      // Raising somebody's tax-free limits is a Payroll decision, scoped to their company.
      const gate = await requireAccess(req, 'Flexi Claims', 'EDIT')
      if (gate.error) return gate.error
      const { data: emp } = await supa.from('employees').select('company_id').eq('id', String(employee_id || '')).maybeSingle()
      if (!emp) return refuse(404, 'Employee not found.')
      if (!inCompany(gate.grant, emp.company_id, 'Flexi Claims')) return refuse(403, 'This employee belongs to a company outside your access.')
      const company_id = emp.company_id, approved_by = gate.grant.name || gate.grant.empCode || 'Payroll'
      const rows = Object.entries(overrides || {}).filter(([, v]) => v).map(([code, limit]) => ({
        employee_id, company_id, fy, component_code: code,
        override_limit: Number(limit), override_reason: reason, approved_by: approved_by || null, is_active: true,
      }))
      if (rows.length) {
        const { error } = await supa.from('flexi_limit_overrides').upsert(rows, { onConflict: 'employee_id,fy,component_code' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, count: rows.length })
    }

    // The claim window runs the 1st–20th on its own (lib/flexi/window); nobody closes it by hand.
    if (action === 'TOGGLE_WINDOW') {
      return NextResponse.json({ error: 'The flexi claim window opens on the 1st and closes after the 20th of every month on its own; it is not closed by hand.' }, { status: 410 })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams: p } = new URL(req.url)
  const empId = p.get('employee_id')
  const compId = p.get('company_id')
  const status = p.get('status')
  const month = p.get('month')
  const year = p.get('year')

  if (empId) {
    // The employee's own history, or Flexi staff looking at an employee of their company.
    const who = await requireSelfOrModule(req, empId, 'Flexi Claims', 'VIEW')
    if (who.error) return who.error
    const { data } = await supa.from('flexi_claims')
      .select('*, flexi_claim_files(id, file_name, file_type, file_url, uploaded_at)')
      .eq('employee_id', who.subjectId).order('submitted_at', { ascending: false })
    return NextResponse.json({ claims: data })
  }

  if (compId) {
    // Flexi staff only. Pin to the caller's own company unless a cross-company (super-admin)
    // role: a non-cross caller asking for another company — or 'ALL' — is forced back to theirs.
    const gate = await requireAccess(req, 'Flexi Claims', 'VIEW')
    if (gate.error) return gate.error
    const company = companyFilter(gate.grant, compId, 'Flexi Claims')
    let q = supa.from('flexi_claims')
      .select('*, employees(emp_code, full_name, department_id, location_id, company_id, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)), flexi_claim_files(id, file_name, file_type, file_url)')
    if (company) q = q.eq('company_id', company)
    if (status) q = q.eq('status', status)
    if (month && year) {
      const m = Number(month)
      q = q.gte('submitted_at', `${year}-${String(m).padStart(2, '0')}-01`)
           .lt('submitted_at', m >= 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`)
    }
    const { data } = await q.order('submitted_at', { ascending: false })
    return NextResponse.json({ claims: data })
  }

  return NextResponse.json({ error: 'employee_id or company_id required' }, { status: 400 })
}
