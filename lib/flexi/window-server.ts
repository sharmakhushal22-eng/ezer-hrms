// lib/flexi/window-server.ts — this month's flexi claim window row for a company.
//
// The window runs the 1st–20th of every month on its own (lib/flexi/window.ts): the row for
// the current month is created the first time anybody needs it, and a row set up by hand under
// the old rules (other days, or closed) is brought back to the 1st–20th, OPEN. Whether a bill
// can go in today is the date (windowOpenAt), not this row's status. Server-side only: it
// writes with the caller's (service-role) client.
import { claimWindowFor } from './window'

export interface ClaimWindow { id: string; status: string; opens_at: string | null; closes_at: string | null }

export async function currentClaimWindow(sb: any, companyId: string, now = new Date()): Promise<ClaimWindow | null> {
  const w = claimWindowFor(now)
  const find = () => sb.from('flexi_windows').select('id, status, opens_at, closes_at, open_day, close_day')
    .eq('company_id', companyId).eq('year', w.year).eq('month', w.month)
    .order('created_at', { ascending: true }).limit(1)
  const { data: found } = await find()
  const row = (found as ClaimWindow[] | null)?.[0]
  if (row) {
    const r = row as ClaimWindow & { open_day?: number; close_day?: number }
    if (String(r.status).toUpperCase() !== 'OPEN' || r.open_day !== w.open_day || r.close_day !== w.close_day) {
      await sb.from('flexi_windows').update({ status: 'OPEN', closed_manually: false, open_day: w.open_day, close_day: w.close_day, opens_at: w.opens_at, closes_at: w.closes_at }).eq('id', r.id)
    }
    return { id: r.id, status: 'OPEN', opens_at: w.opens_at, closes_at: w.closes_at }
  }
  const { data: made, error } = await sb.from('flexi_windows').insert({ company_id: companyId, ...w })
    .select('id, status, opens_at, closes_at').maybeSingle()
  if (made) return made as ClaimWindow
  // Two requests raced to create it: the other one's row is the window.
  const { data: again } = await find()
  if ((again as ClaimWindow[] | null)?.[0]) return { id: (again as ClaimWindow[])[0].id, status: 'OPEN', opens_at: w.opens_at, closes_at: w.closes_at }
  console.error('flexi window could not be created', error?.message)
  return null
}
