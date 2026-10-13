// GET /api/te/admin/config — everything the admin screens show for one company:
//   config    te_config(): the settings and masters in the shape the rules engine reads
//   masters   te_masters(): city tiers, hub regions, hubs and the company's places
//   settings  the raw te_settings row, for the settings form (PATCH /api/te/admin/settings)
// Needs full access to the Travel Claims module.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { rpcError } from '@/lib/te/errors'
import { config } from '@/lib/te/engine/te-service.js'
import type { TeMasters } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    const db = t.db()
    // te_config does not look at the actor; the legacy shared login (no employee) may read it too.
    const cfg = await config({ db, actor: (await t.actor()).employeeId ?? '' }, company)
    const [masters, settings] = await Promise.all([
      db.rpc<TeMasters>('te_masters', { p_company_id: company, p_employee_id: null }),
      t.sb().from('te_settings').select('*').eq('company_id', company).maybeSingle(),
    ])
    if (settings.error) throw rpcError(settings.error, 'te_settings')
    return { company_id: company, config: cfg, masters, settings: settings.data }
  })
}
