// app/api/flexi/claims/route.ts — Flexi Claims API.
// POST actions: SUBMIT · APPROVE · REJECT · REQUEST_LIMIT · APPROVE_LIMIT_REQUEST ·
//               OVERRIDE_LIMIT · TOGGLE_WINDOW
// GET: claims by employee_id or company_id (+ month/year/status filters).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'SUBMIT') {
      const { window_id, employee_id, company_id, component_code, claim_amount, bill_date, bill_no, agency_name, vendor_desc, remark, supporting_remark } = body
      const { data: win } = await supa.from('flexi_windows').select('status').eq('id', window_id).single()
      if (!win || win.status !== 'OPEN') return NextResponse.json({ error: 'Submission window is closed.' }, { status: 400 })
      if (!(claim_amount > 0)) return NextResponse.json({ error: 'Claim amount must be greater than zero.' }, { status: 400 })

      // Rule-based AI flag (OCR service can override later).
      const ai_flag = claim_amount > 15000 ? 'flag' : 'clear'
      const ai_notes = ai_flag === 'flag' ? 'Amount above ₹15,000 — manual review recommended' : null

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
      const { ids, reviewed_by, approved_by } = body
      if (!ids?.length) return NextResponse.json({ error: 'No claim ids' }, { status: 400 })
      const { error } = await supa.from('flexi_claims')
        .update({ status: 'APPROVED', reviewed_by: reviewed_by || null, approved_by: approved_by || 'Payroll Manager', reviewed_at: new Date().toISOString(), rejection_reason: null })
        .in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, approved: ids.length })
    }

    if (action === 'REJECT') {
      const { ids, reviewed_by, approved_by, rejection_reason, approved_amount } = body
      if (!ids?.length) return NextResponse.json({ error: 'No claim ids' }, { status: 400 })
      if (!rejection_reason?.trim()) return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })

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
      const { employee_id, company_id, fy, component_code, current_limit, requested_limit, reason } = body
      if (!reason?.trim()) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
      const { data, error } = await supa.from('flexi_limit_requests').insert({
        employee_id, company_id, fy, component_code, current_limit, requested_limit, reason, status: 'PENDING',
      }).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, request_id: data?.id })
    }

    if (action === 'APPROVE_LIMIT_REQUEST') {
      const { request_id, approved_by, reject_note } = body
      const { data: r } = await supa.from('flexi_limit_requests').select('*').eq('id', request_id).single()
      if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
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
      const { employee_id, company_id, fy, overrides, reason, approved_by } = body
      if (!reason?.trim()) return NextResponse.json({ error: 'Override reason required' }, { status: 400 })
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

    if (action === 'TOGGLE_WINDOW') {
      const { window_id, new_status } = body
      const { error } = await supa.from('flexi_windows').update({ status: new_status, closed_manually: new_status !== 'OPEN' }).eq('id', window_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
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
    const { data } = await supa.from('flexi_claims')
      .select('*, flexi_claim_files(id, file_name, file_type, file_url, uploaded_at)')
      .eq('employee_id', empId).order('submitted_at', { ascending: false })
    return NextResponse.json({ claims: data })
  }

  if (compId) {
    let q = supa.from('flexi_claims')
      .select('*, employees(emp_code, full_name, department_id, location_id, company_id, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)), flexi_claim_files(id, file_name, file_type, file_url)')
    // 'ALL' = the whole group. Deliberately an explicit token rather than an absent
    // parameter, so a caller that forgot the id still gets the 400 below instead of
    // silently receiving every company's bills.
    if (compId !== 'ALL') q = q.eq('company_id', compId)
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
