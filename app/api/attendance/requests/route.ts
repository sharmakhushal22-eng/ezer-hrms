// app/api/attendance/requests/route.ts — HR's view of every leave and
// attendance request, and HR's override.
//
//   GET  ?status=PENDING|DECIDED &kind=ALL|LEAVE|CANCEL|REGULARISATION &company=
//        → every request in the caller's company scope, with who it is waiting
//          on and for how long, and (for leave) the balance before and after.
//   POST { kind, id, action: 'approve'|'decline', note }
//        → decide on the approver's behalf (they are away, or the request is
//          stuck with nobody). Same functions as Tasks & Approvals
//          (lib/leave/workflow.ts), so the balance check, the attendance write
//          and the notifications are identical; the employee sees HR's name.
//
// Before this there was no screen anywhere that listed leave across the
// company: a request stuck with an absent manager was invisible to HR.
//
// VIEW on Attendance to look, EDIT to decide. A caller pinned to one company
// sees and decides only that company's requests.
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { grantForRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import { companyFilter } from '@/lib/rms/resolve'
import { ledgersFor } from '@/lib/leave/ledger'
import { decideLeave, decideLeaveCancel, decideRegularisation, type Actor } from '@/lib/leave/workflow'
import { contacts, istToday } from '@/lib/leave/notify'
import { isUuid } from '@/lib/config/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Kind = 'LEAVE' | 'CANCEL' | 'REGULARISATION'

export interface RequestRow {
  kind: Kind
  id: string
  employee: { id: string; name: string; code: string | null; company_id: string | null }
  title: string
  from_date: string
  to_date: string
  days: number
  status: string
  stage: string | null
  waiting_on: { id: string; name: string } | null
  waiting_days: number | null
  raised_at: string | null
  reason: string | null
  balance: { label: string; available: number | null; after: number | null } | null
  decided_by: string | null
  remark: string | null
  dates_passed: boolean
}

const daysSince = (ts: string | null | undefined) =>
  ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : null

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) out.push(...(((await fetch(ids.slice(i, i + 200))).data || []) as T[]))
  return out
}

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Attendance', 'VIEW')
  if (gate.error) return gate.error
  const grant = await grantForRequest(req)
  const sp = req.nextUrl.searchParams
  const decided = sp.get('status') === 'DECIDED'
  const kind = (sp.get('kind') || 'ALL').toUpperCase()
  const co = companyFilter(grant, sp.get('company'))

  let eq = sb.from('employees').select('id, full_name, emp_code, company_id')
  if (co) eq = eq.eq('company_id', co)
  const { data: emps } = await eq
  const empBy = new Map(((emps || []) as any[]).map(e => [e.id, e]))
  const ids = [...empBy.keys()]
  if (!ids.length) return NextResponse.json({ rows: [] })

  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const want = (k: Kind) => kind === 'ALL' || kind === k

  const [leaves, cancels, regs] = await Promise.all([
    want('LEAVE') ? inChunks<any>(ids, c => {
      let q = sb.from('leave_applications').select('id, employee_id, leave_type_id, from_date, to_date, days, half_day, reason, status, approval_stage, current_approver_id, applied_at, resolved_at, approver, remark, leave_types(name, short_name)').in('employee_id', c)
      q = decided ? q.in('status', ['APPROVED', 'REJECTED']).gte('resolved_at', since) : q.eq('status', 'PENDING')
      return q
    }) : Promise.resolve([]),
    want('CANCEL') ? inChunks<any>(ids, c => {
      let q = sb.from('leave_applications').select('id, employee_id, from_date, to_date, days, status, cancel_status, cancel_reason, cancel_requested_at, cancel_approver_id, cancel_decided_at, cancel_decided_by, cancel_remark, leave_types(name, short_name)').in('employee_id', c)
      q = decided ? q.in('cancel_status', ['APPROVED', 'DECLINED']).gte('cancel_decided_at', since) : q.eq('cancel_status', 'REQUESTED')
      return q
    }) : Promise.resolve([]),
    want('REGULARISATION') ? inChunks<any>(ids, c => {
      let q = sb.from('attendance_regularisation').select('id, employee_id, attendance_date, requested_in, requested_out, reason, status, current_approver_id, created_at, reviewed_at, reviewed_by, review_remark, request_group').in('employee_id', c)
      q = decided ? q.in('status', ['APPROVED', 'REJECTED']).gte('reviewed_at', since) : q.eq('status', 'PENDING')
      return q
    }) : Promise.resolve([]),
  ])

  const people = await contacts([
    ...leaves.map(l => l.current_approver_id), ...cancels.map(l => l.cancel_approver_id), ...regs.map(r => r.current_approver_id),
  ])
  const waiting = (id: string | null) => { const c = id ? people.get(id) : null; return c ? { id: c.id, name: c.name } : null }
  const ledgers = decided ? new Map() : await ledgersFor(leaves.map(l => l.employee_id)).catch(() => new Map())
  const today = istToday()
  const emp = (id: string) => { const e = empBy.get(id); return { id, name: e?.full_name || 'Employee', code: e?.emp_code || null, company_id: e?.company_id || null } }

  const rows: RequestRow[] = []
  for (const l of leaves) {
    const days = Number(l.days) || 0
    const b = ledgers.get(l.employee_id)?.byType.get(l.leave_type_id)
    rows.push({
      kind: 'LEAVE', id: l.id, employee: emp(l.employee_id),
      title: `${l.leave_types?.name || 'Leave'}${l.half_day ? ' (half day)' : ''}`,
      from_date: l.from_date, to_date: l.to_date, days, status: l.status,
      stage: l.approval_stage === 'L1' ? 'Manager stage' : l.approval_stage === 'HR' ? 'HR stage' : null,
      waiting_on: l.status === 'PENDING' ? waiting(l.current_approver_id) : null,
      waiting_days: l.status === 'PENDING' ? daysSince(l.applied_at) : null,
      raised_at: l.applied_at, reason: l.reason,
      balance: b && b.available != null && b.policy === 'ACCRUAL'
        ? { label: b.short_name, available: b.available, after: Math.round((b.available - days) * 10) / 10 } : null,
      decided_by: l.status === 'PENDING' ? null : l.approver, remark: l.remark,
      dates_passed: l.status === 'PENDING' && l.from_date < today,
    })
  }
  for (const l of cancels) {
    rows.push({
      kind: 'CANCEL', id: l.id, employee: emp(l.employee_id),
      title: `Cancel approved ${l.leave_types?.name || 'leave'}`,
      from_date: l.from_date, to_date: l.to_date, days: Number(l.days) || 0,
      status: l.cancel_status === 'REQUESTED' ? 'PENDING' : l.cancel_status, stage: null,
      waiting_on: l.cancel_status === 'REQUESTED' ? waiting(l.cancel_approver_id) : null,
      waiting_days: l.cancel_status === 'REQUESTED' ? daysSince(l.cancel_requested_at) : null,
      raised_at: l.cancel_requested_at, reason: l.cancel_reason, balance: null,
      decided_by: l.cancel_decided_by, remark: l.cancel_remark,
      dates_passed: l.cancel_status === 'REQUESTED' && l.from_date <= today,
    })
  }
  // A date-range correction is one row here, as it is in Tasks & Approvals.
  const groups = new Map<string, any[]>()
  for (const r of regs) { const k = r.request_group || r.id; groups.set(k, [...(groups.get(k) || []), r]) }
  for (const [gid, g] of groups) {
    const dates = g.map(r => r.attendance_date).sort()
    const r0 = g[0]
    rows.push({
      kind: 'REGULARISATION', id: gid, employee: emp(r0.employee_id),
      title: `Attendance correction · ${String(r0.requested_in).slice(0, 5)}–${String(r0.requested_out).slice(0, 5)}`,
      from_date: dates[0], to_date: dates[dates.length - 1], days: g.length,
      status: r0.status, stage: null,
      waiting_on: r0.status === 'PENDING' ? waiting(r0.current_approver_id) : null,
      waiting_days: r0.status === 'PENDING' ? daysSince(r0.created_at) : null,
      raised_at: r0.created_at, reason: r0.reason, balance: null,
      decided_by: r0.reviewed_by, remark: r0.review_remark, dates_passed: false,
    })
  }
  // Oldest waiting first: those are the ones somebody needs to chase.
  rows.sort((a, b) => decided
    ? String(b.raised_at).localeCompare(String(a.raised_at))
    : (b.waiting_days ?? 0) - (a.waiting_days ?? 0))
  return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Attendance', 'EDIT')
  if (gate.error) return gate.error
  const grant = await grantForRequest(req)
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const kind = String(body.kind || '').toUpperCase() as Kind
  const id = String(body.id || '')
  const action = String(body.action || '').toLowerCase()
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  if (!['LEAVE', 'CANCEL', 'REGULARISATION'].includes(kind)) return NextResponse.json({ error: 'Unknown request kind.' }, { status: 400 })
  if (action !== 'approve' && action !== 'decline') return NextResponse.json({ error: 'Action must be approve or decline.' }, { status: 400 })
  if (!isUuid(id)) return NextResponse.json({ error: 'That is not a request id.' }, { status: 400 })
  if (action === 'decline' && !note) return NextResponse.json({ error: 'Give a reason — the employee reads it.' }, { status: 400 })

  // Company scope: a caller pinned to one company decides only its requests.
  const pinned = companyFilter(grant, null)
  if (pinned) {
    const { data: rows } = kind === 'REGULARISATION'
      ? await sb.from('attendance_regularisation').select('employee_id').or(`id.eq.${id},request_group.eq.${id}`).limit(1)
      : await sb.from('leave_applications').select('employee_id').eq('id', id).limit(1)
    const owner = rows?.[0]?.employee_id
    if (owner) {
      const { data: e } = await sb.from('employees').select('company_id').eq('id', owner).maybeSingle()
      if (e?.company_id !== pinned) return NextResponse.json({ error: 'That request belongs to another company.' }, { status: 403 })
    }
  }

  const actor: Actor = {
    employeeId: grant.employeeId,
    name: grant.employeeId ? (grant.name || 'HR') : 'HR',
    isSuperAdmin: grant.isSuperAdmin,
    override: true,
  }
  const approve = action === 'approve'
  const out = kind === 'LEAVE' ? await decideLeave(id, actor, approve, note)
    : kind === 'CANCEL' ? await decideLeaveCancel(id, actor, approve, note)
    : await decideRegularisation(id, actor, approve, note)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })

  await sb.from('ess_access_audit').insert({
    actor_employee_id: grant.employeeId, actor_label: grant.name || 'dashboard',
    action: `HR_OVERRIDE_${kind}_${approve ? 'APPROVED' : 'DECLINED'}`, target_employee_id: null,
    detail: { id, note },
  })
  return NextResponse.json(out)
}
