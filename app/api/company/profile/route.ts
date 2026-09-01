// app/api/company/profile/route.ts — the only authorised way to change the
// company master.
//
//   GET                       -> { canEdit, reason, actor }   the client asks
//                                 whether to show the Edit button
//   PATCH { entity, id, patch }        update a row
//   POST  { entity, company_id, row }  create a row
//   DELETE { entity, id }              soft-delete (status = 'Inactive')
//
// Every one of them resolves the caller's grant FIRST and refuses before
// touching a row. The client cannot be trusted to have hidden the button:
// until now these tables were written straight from the browser with the anon
// key, so the authorisation was "whoever can load the page".
//
// Writes go through the service client, which is why the check above it has to
// be right — this route is the thing standing between a visitor and the PAN,
// the bank account and the statutory register.

import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import { companyEditRight, EDITABLE, IMMUTABLE } from '@/lib/company/authz'

/** Strip anything the caller is not allowed to set. Returns the cleaned patch
 *  and what was dropped, so a rejected field is reported rather than silently
 *  ignored — a form that appears to save a field it did not is worse than one
 *  that refuses. */
function clean(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (IMMUTABLE.has(k)) { dropped.push(k); continue }
    out[k] = v === '' ? null : v
  }
  return { out, dropped }
}

async function audit(rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const { error } = await sb.from('company_master_audit').insert(rows)
  // An audit failure must not roll back a legitimate edit, but it must not
  // pass unnoticed either.
  if (error) console.warn('[company/profile] audit insert failed:', error.message)
}

export async function GET(req: NextRequest) {
  const g = await grantForRequest(req)
  const right = companyEditRight(g)
  return NextResponse.json(right)
}

export async function PATCH(req: NextRequest) {
  const g = await grantForRequest(req)
  const right = companyEditRight(g)
  if (!right.canEdit) return NextResponse.json({ error: right.reason }, { status: 403 })

  const body = await req.json().catch(() => null) as
    { entity?: string; id?: string; patch?: Record<string, unknown> } | null
  const map = body?.entity ? EDITABLE[body.entity] : undefined
  if (!map || !body?.id) {
    return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })
  }

  const { out, dropped } = clean(body.patch ?? {})
  if (!Object.keys(out).length) {
    return NextResponse.json({ error: 'Nothing to update', dropped }, { status: 400 })
  }

  const { data: before } = await sb.from(map.table).select('*').eq('id', body.id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'No such row' }, { status: 404 })

  const { error } = await sb.from(map.table).update(out).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit(Object.keys(out)
    .filter(k => String((before as any)[k] ?? '') !== String(out[k] ?? ''))
    .map(k => ({
      entity_type: map.entity, entity_id: body.id,
      company_id: (before as any).company_id ?? null,
      action: 'UPDATE', field: k,
      old_value: (before as any)[k] == null ? null : String((before as any)[k]),
      new_value: out[k] == null ? null : String(out[k]),
      changed_by: right.actor,
      note: right.reason,
    })))

  return NextResponse.json({ ok: true, dropped })
}

export async function POST(req: NextRequest) {
  const g = await grantForRequest(req)
  const right = companyEditRight(g)
  if (!right.canEdit) return NextResponse.json({ error: right.reason }, { status: 403 })

  const body = await req.json().catch(() => null) as
    { entity?: string; company_id?: string; row?: Record<string, unknown> } | null
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 })
  const map = body.entity ? EDITABLE[body.entity] : undefined
  if (!map) return NextResponse.json({ error: 'Unknown entity' }, { status: 400 })
  if (!body.company_id && map.entity !== 'GROUP') {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 })
  }

  const { out } = clean(body.row ?? {})
  const row = { ...out, ...(body.company_id ? { company_id: body.company_id } : {}) }

  const { data, error } = await sb.from(map.table).insert(row).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit([{
    entity_type: map.entity, entity_id: data?.id ?? null, company_id: body.company_id ?? null,
    action: 'CREATE', field: null, old_value: null,
    new_value: JSON.stringify(out).slice(0, 500),
    changed_by: right.actor, note: right.reason,
  }])
  return NextResponse.json({ ok: true, id: data?.id })
}

export async function DELETE(req: NextRequest) {
  const g = await grantForRequest(req)
  const right = companyEditRight(g)
  if (!right.canEdit) return NextResponse.json({ error: right.reason }, { status: 403 })

  const body = await req.json().catch(() => null) as { entity?: string; id?: string } | null
  const map = body?.entity ? EDITABLE[body.entity] : undefined
  if (!map || !body?.id) return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })

  const { data: before } = await sb.from(map.table).select('*').eq('id', body.id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'No such row' }, { status: 404 })

  // ── SOFT delete, deliberately ──────────────────────────────────────────
  // A location or a registration is referenced by payroll runs, attendance
  // rows and letters that have already gone out. Removing the row would break
  // those, and "we deleted the branch" is not an acceptable answer to why a
  // payslip cannot render. status='Inactive' takes it out of every list —
  // loadHierarchy already filters on status='Active' — while leaving the
  // history intact.
  const { error } = await sb.from(map.table).update({ status: 'Inactive' }).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit([{
    entity_type: map.entity, entity_id: body.id,
    company_id: (before as any).company_id ?? null,
    action: 'DELETE', field: 'status',
    old_value: (before as any).status ?? null, new_value: 'Inactive',
    changed_by: right.actor, note: right.reason,
  }])
  return NextResponse.json({ ok: true, soft: true })
}
