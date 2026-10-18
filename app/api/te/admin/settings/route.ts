// PATCH /api/te/admin/settings — change the company's Travel and Expense
// settings. Body: only the columns that change, e.g. { "bill_age_days": 60 }.
//
// Which columns, and what a valid value is: lib/te/admin.ts (SETTINGS), which
// mirrors the CHECK constraints of te_settings. The JSON groups (gps_rules,
// vehicle_rules, fuel_prices, limit_basis, breach_actions, risk_weights,
// risk_bands, extra) are merged key by key into what is stored.
// The database bumps `version` and writes the audit row (trigger in 145).
// Needs full access to the Travel Claims module, and a named employee: the
// change is recorded against a person.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, rpcError } from '@/lib/te/errors'
import { checkSettingsPatch } from '@/lib/te/admin'
import { config } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(req: NextRequest) {
  return teRoute(req, async t => {
    const body = await t.body()
    await t.permit('Travel Claims', 'FULL')
    const actor = await t.employee()
    const company = await t.company()
    const sb = t.sb()
    const db = t.db()

    // Raises TE_NOT_SET_UP for a company with no settings row; teRoute then seeds it and runs this again.
    await config({ db, actor }, company)
    const cur = await sb.from('te_settings').select('*').eq('company_id', company).maybeSingle()
    if (cur.error) throw rpcError(cur.error, 'te_settings')
    const patch = checkSettingsPatch(body, (cur.data ?? {}) as Record<string, unknown>)

    if (typeof patch.fallback_approver_id === 'string') {
      const e = await sb.from('employees').select('id').eq('id', patch.fallback_approver_id).eq('company_id', company).maybeSingle()
      if (e.error) throw rpcError(e.error, 'employees')
      if (!e.data) throw new TeHttpError(400, 'TE_INVALID', 'The fallback approver must be an employee of this company.', { field: 'fallback_approver_id' })
    }

    const { data, error } = await sb.from('te_settings').update({ ...patch, updated_by: actor }).eq('company_id', company).select('*').maybeSingle()
    if (error) throw rpcError(error, 'te_settings')
    return { company_id: company, settings: data, config: await config({ db, actor }, company) }
  })
}
