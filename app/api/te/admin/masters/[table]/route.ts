// PUT /api/te/admin/masters/[table] — add or change rows of one master list.
// Body: { "rows": [ { <key>, <columns to change> }, … ] }
//
//   table               key           new rows?
//   te_categories       code          yes
//   te_modes            code          yes
//   te_vehicle_types    code          yes   (a rate change is kept in te_vehicle_rate_history by trigger)
//   te_place_types      code          yes
//   te_stop_reasons     code          yes
//   te_checks           code          no    (the 55 checks are fixed; switch off or change the action)
//   te_grade_policies   grade         yes
//   te_grade_limits     grade + tier  yes
//   te_city_tiers       city          yes
//   te_places           id            yes   (company places only; leave id out for a new one)
//   te_hubs             area + kind   yes
//
// ONE generic handler, strictly whitelisted: which columns exist for each
// table and what a valid value is live in lib/te/admin.ts (MASTERS). A key is
// never renamed, and nothing is deleted: switch a row off with is_active
// (te_checks: is_enabled). All rows of a request are written in one statement,
// so either every row is saved or none is. Every change is audited by trigger.
// Needs full access to the Travel Claims module.
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, rpcError } from '@/lib/te/errors'
import { MASTERS, checkMasterRows, missingForInsert, rowProblem } from '@/lib/te/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Row = Record<string, unknown>

export async function PUT(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params
  return teRoute(req, async t => {
    const body = await t.body<{ rows?: unknown }>()
    const rows = checkMasterRows(table, body.rows)             // 404 for a table that is not in the whitelist
    const spec = MASTERS[table]
    await t.permit('Travel Claims', 'FULL')
    const actor = await t.employee()
    const company = await t.company()
    const sb = t.sb()

    // What exists now, to tell an update from a new row and to complete an updated row.
    let read = sb.from(table).select('*').eq('company_id', company).limit(5000)
    if (table === 'te_places') read = read.is('owner_employee_id', null)
    const existing = await read
    if (existing.error) throw rpcError(existing.error, table)
    const keyOf = (r: Row) => JSON.stringify(spec.key.map(k => r[k] ?? null))
    const byKey = new Map((existing.data as Row[]).map(r => [keyOf(r), r]))

    // A hub points at one of the company's own places.
    if (table === 'te_hubs') {
      const places = await sb.from('te_places').select('id').eq('company_id', company).is('owner_employee_id', null).eq('is_active', true)
      if (places.error) throw rpcError(places.error, 'te_places')
      const ok = new Set((places.data ?? []).map(p => p.id as string))
      rows.forEach((r, i) => {
        if (typeof r.patch.place_id === 'string' && !ok.has(r.patch.place_id)) throw new TeHttpError(400, 'TE_INVALID', `Row ${i + 1}: that place is not an active company place.`, { field: 'place_id', row: i })
      })
    }

    let updated = 0
    let inserted = 0
    const out: Row[] = rows.map((r, i) => {
      const at = `Row ${i + 1}`
      const old = Object.keys(r.key).length === spec.key.length ? byKey.get(keyOf(r.key)) : undefined
      let row: Row
      if (old) {
        updated++
        row = { company_id: company, ...r.key }
        for (const c of Object.keys(spec.cols)) row[c] = c in r.patch ? r.patch[c] : old[c]
      } else {
        // An id that is not one of this company's places must never be written: it could be another company's.
        if (table === 'te_places' && r.key.id) throw new TeHttpError(404, 'TE_INVALID', `${at}: that place is not one of this company's places.`, { row: i })
        const missing = missingForInsert(table, r)
        if (missing === null) throw new TeHttpError(400, 'TE_INVALID', `${at}: new rows cannot be added to this list. Change or switch off an existing one.`, { row: i })
        if (missing.length) throw new TeHttpError(400, 'TE_INVALID', `${at}: a new row also needs ${missing.join(', ').replace(/_/g, ' ')}.`, { field: missing[0], row: i })
        inserted++
        row = { company_id: company, ...r.key, ...r.patch }
        if (table === 'te_places') Object.assign(row, { id: randomUUID(), owner_employee_id: null, created_by: actor, source: r.patch.source ?? 'company' })
      }
      const problem = rowProblem(table, row)
      if (problem) throw new TeHttpError(400, 'TE_INVALID', `${at}: ${problem}`, { row: i })
      if (spec.stampsUpdatedBy) row.updated_by = actor
      return row
    })

    // One INSERT … ON CONFLICT (key) DO UPDATE for all rows. defaultToNull: false makes a
    // column a new row does not carry take its database default instead of NULL.
    const onConflict = table === 'te_places' ? 'id' : ['company_id', ...spec.key].join(',')
    const { data, error } = await sb.from(table).upsert(out, { onConflict, defaultToNull: false }).select('*')
    if (error) throw rpcError(error, table)
    return { table, company_id: company, updated, inserted, rows: data ?? [] }
  })
}
