// GET /api/te/desk — the Travel Desk's work list for the caller's company:
//   to_book    tickets and hotel stays on approved trips that the desk still has to book (v_te_to_book)
//   vehicles   vehicles whose RC could not be checked automatically and wait for a person to look at the photo
// Needs the dashboard Travel Claims permission (edit).
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { rpcError } from '@/lib/te/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    await t.permit('Travel Claims', 'EDIT')
    const company = await t.company()
    const sb = t.sb()
    const [book, veh] = await Promise.all([
      sb.from('v_te_to_book').select('*').eq('company_id', company).order('on_date', { ascending: true }).limit(500),
      sb.from('te_employee_vehicles')
        .select('id, employee_id, reg_no, vehicle_type_code, declared_type_code, ownership, rc_file_url, created_at')
        .eq('company_id', company).eq('is_active', true).eq('is_verified', false).order('created_at', { ascending: true }).limit(500),
    ])
    if (book.error) throw rpcError(book.error, 'v_te_to_book')
    if (veh.error) throw rpcError(veh.error, 'te_employee_vehicles')

    // Names for both lists in one read (no embedded join: these tables have several links to employees).
    const ids = [...new Set([...(book.data ?? []).map(r => r.employee_id as string), ...(veh.data ?? []).map(r => r.employee_id as string)])]
    const names = new Map<string, { emp_code: string | null; full_name: string | null }>()
    if (ids.length) {
      const { data, error } = await sb.from('employees').select('id, emp_code, full_name').in('id', ids)
      if (error) throw rpcError(error, 'employees')
      for (const e of data ?? []) names.set(e.id as string, { emp_code: e.emp_code as string | null, full_name: e.full_name as string | null })
    }
    const withName = <T extends { employee_id: unknown }>(r: T) => ({ ...r, ...(names.get(r.employee_id as string) ?? { emp_code: null, full_name: null }) })
    return { company_id: company, to_book: (book.data ?? []).map(withName), vehicles: (veh.data ?? []).map(withName) }
  })
}
