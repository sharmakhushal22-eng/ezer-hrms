// lib/leave/ledger.ts — leave balances, computed once and kept in the table.
// SERVER ONLY (service role).
//
// THE PROBLEM. leave_balances had 0 rows. The Leave tab computed balances live
// from approved requests and was right; Home, the Today tile and the dashboard
// Leave Report read the empty table and said "0 days". Approving leave changed
// nothing that those screens could see.
//
// THE FIX. One computation (lib/leave/policy.ts on top of lib/leave/accrual.ts)
// and one writer. Every screen asks this module, and syncBalances() writes the
// same figures into leave_balances whenever they can change — a request
// approved, cancelled or withdrawn, the Leave tab opened, the daily job, the
// Leave Report run. `accrued` and `used` are written; `opening` and `encashed`
// are HR's (the leave upload) and are never touched here.
//
// That stored table is also the hand-off to payroll: approved days per type per
// FY, LWP included, already in the table it will read. See leaveDaysForPeriod()
// at the bottom for the per-month view payroll will want.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { leaveYearOf, leaveFyLabel, leaveFyStartYear, leavePolicyFy } from '@/lib/ess/leave-year'
import type { LeaveApplicationLike } from './accrual'
import { computeTypeBalance, type LeaveTypeLike, type TypeBalance } from './policy'

export interface LeaveTypeRow extends LeaveTypeLike {
  application_mode: string | null
  allow_half_day: boolean | null
  approval_by: string | null
  eligible_from: string | null
  min_tenure_days: number | null
  is_active: boolean | null
}

export interface LedgerEmployee {
  id: string
  company_id: string | null
  company_doj: string | null
  group_doj: string | null
  date_of_leaving: string | null
}

export interface EmployeeLedger {
  year: string
  fyLabel: string
  /** Every active leave type, in sort order. */
  types: LeaveTypeRow[]
  byType: Map<string, TypeBalance>
  /** Headline types only — the ones that make up "your leave balance". */
  headline: TypeBalance[]
  headlineTotal: number
}

const EMP_COLS = 'id, company_id, company_doj, group_doj, date_of_leaving'

export async function activeLeaveTypes(): Promise<LeaveTypeRow[]> {
  const { data } = await sb.from('leave_types').select('*').eq('is_active', true).order('sort_order')
  return (data || []) as LeaveTypeRow[]
}

/** resolve_leave_quota per company — branch null resolves the company default. */
async function quotasFor(companyIds: string[], year: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  await Promise.all([...new Set(companyIds.filter(Boolean))].map(async co => {
    const { data } = await sb.rpc('resolve_leave_quota', { p_company_id: co, p_branch_id: null, p_fy: leavePolicyFy(year) })
    const m = new Map<string, number>()
    for (const q of (data || []) as Record<string, unknown>[]) m.set(String(q.leave_type_id), Number(q.annual_quota) || 0)
    out.set(co, m)
  }))
  return out
}

type AppRow = LeaveApplicationLike & { id: string; employee_id: string }

/** Run an `.in('employee_id', …)` query 200 ids at a time. The caller names the
 *  row shape; supabase-js types embedded relations as arrays, hence `any`. */
async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await fetch(ids.slice(i, i + 200))
    out.push(...((data || []) as T[]))
  }
  return out
}

/**
 * Balances for many employees in a handful of queries. Used by the single-
 * employee helpers below, the approvals queue, the HR Requests screen and the
 * nightly sync, so all of them agree to the decimal.
 */
export async function ledgersFor(employeeIds: string[], asOf: Date = new Date()): Promise<Map<string, EmployeeLedger>> {
  const ids = [...new Set(employeeIds.filter(Boolean))]
  const out = new Map<string, EmployeeLedger>()
  if (!ids.length) return out

  const year = leaveYearOf(asOf)
  const fyStartYear = leaveFyStartYear(year)
  const fyFrom = `${fyStartYear}-04-01`, fyTo = `${fyStartYear + 1}-03-31`

  const [types, emps, stored, apps] = await Promise.all([
    activeLeaveTypes(),
    inChunks<LedgerEmployee>(ids, c => sb.from('employees').select(EMP_COLS).in('id', c)),
    inChunks<{ employee_id: string; leave_type_id: string; opening: number; encashed: number }>(ids, c =>
      sb.from('leave_balances').select('employee_id, leave_type_id, opening, encashed').eq('year', year).in('employee_id', c)),
    inChunks<AppRow>(ids, c =>
      sb.from('leave_applications').select('id, employee_id, leave_type_id, status, from_date, days')
        .in('employee_id', c).in('status', ['APPROVED', 'PENDING']).gte('from_date', fyFrom).lte('from_date', fyTo)),
  ])
  const quotas = await quotasFor(emps.map(e => e.company_id || ''), year)

  const storedBy = new Map<string, { opening: number; encashed: number }>()
  for (const s of stored) storedBy.set(`${s.employee_id}:${s.leave_type_id}`, s)
  const appsBy = new Map<string, AppRow[]>()
  for (const a of apps) { const l = appsBy.get(a.employee_id) || []; l.push(a); appsBy.set(a.employee_id, l) }

  for (const e of emps) {
    const q = quotas.get(e.company_id || '')
    const byType = new Map<string, TypeBalance>()
    for (const t of types) {
      byType.set(t.id, computeTypeBalance({
        type: t,
        quota: q?.get(t.id) ?? (Number(t.annual_quota) || 0),
        fyStartYear,
        doj: e.company_doj || e.group_doj,
        lwd: e.date_of_leaving,
        stored: storedBy.get(`${e.id}:${t.id}`) ?? null,
        applications: appsBy.get(e.id) || [],
        asOf,
      }))
    }
    const headline = [...byType.values()].filter(b => b.headline)
    out.set(e.id, {
      year, fyLabel: leaveFyLabel(year), types, byType, headline,
      headlineTotal: Math.round(headline.reduce((s, b) => s + (b.available || 0), 0) * 10) / 10,
    })
  }
  return out
}

export async function ledgerFor(employeeId: string, asOf?: Date): Promise<EmployeeLedger | null> {
  return (await ledgersFor([employeeId], asOf)).get(employeeId) ?? null
}

/**
 * Write the computed figures into leave_balances.
 *
 * Only `accrued`, `used` and `updated_at` are sent, so PostgREST's merge
 * upsert leaves HR's `opening` and `encashed` exactly as they were. A row is
 * written when there is something to say (accrued or used non-zero) or when one
 * already exists — so a type somebody has never touched does not grow a row of
 * zeros, and a balance that drops back to zero is still corrected.
 *
 * Per-occurrence types (Maternity, Paternity) are stored only once used: their
 * "accrued" is an entitlement, and a 180-day row for every woman on the payroll
 * would read as a balance in every report that sums the table.
 */
export async function syncBalances(employeeIds: string[], asOf?: Date): Promise<{ employees: number; rows: number; error: string | null }> {
  const ledgers = await ledgersFor(employeeIds, asOf)
  if (!ledgers.size) return { employees: 0, rows: 0, error: null }
  const year = [...ledgers.values()][0].year
  const ids = [...ledgers.keys()]
  const existing = new Set((await inChunks<{ employee_id: string; leave_type_id: string }>(ids, c =>
    sb.from('leave_balances').select('employee_id, leave_type_id').eq('year', year).in('employee_id', c)))
    .map(r => `${r.employee_id}:${r.leave_type_id}`))

  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  for (const [empId, l] of ledgers) {
    for (const b of l.byType.values()) {
      const has = existing.has(`${empId}:${b.leave_type_id}`)
      const accrued = b.policy === 'ACCRUAL' ? b.accrued : b.policy === 'PER_OCCURRENCE' && b.used > 0 ? b.quota : 0
      if (!has && accrued === 0 && b.used === 0) continue
      rows.push({ employee_id: empId, leave_type_id: b.leave_type_id, year, accrued, used: b.used, updated_at: now })
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('leave_balances')
      .upsert(rows.slice(i, i + 500), { onConflict: 'employee_id,leave_type_id,year' })
    if (error) return { employees: ledgers.size, rows: i, error: error.message }
  }
  return { employees: ledgers.size, rows: rows.length, error: null }
}

/** Never let a balance write fail the action that caused it. */
export async function syncBalancesQuietly(employeeIds: string[]): Promise<void> {
  try {
    const r = await syncBalances(employeeIds)
    if (r.error) console.warn('[leave] balance sync:', r.error)
  } catch (e) {
    console.warn('[leave] balance sync failed:', e)
  }
}

/** Every active employee, optionally one company. The daily job and the Leave Report use this. */
export async function syncAllBalances(companyId?: string | null): Promise<{ employees: number; rows: number; error: string | null }> {
  let q = sb.from('employees').select('id').eq('employment_status', 'Active')
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q
  const ids = (data || []).map((r: { id: string }) => r.id)
  let employees = 0, rows = 0
  for (let i = 0; i < ids.length; i += 200) {
    const r = await syncBalances(ids.slice(i, i + 200))
    if (r.error) return { employees: employees + r.employees, rows: rows + r.rows, error: r.error }
    employees += r.employees; rows += r.rows
  }
  return { employees, rows, error: null }
}

// ═══════════════════════════════════════════════════════════════════════════
// Payroll hand-off
// ═══════════════════════════════════════════════════════════════════════════

export interface PeriodLeave {
  employee_id: string
  /** Working days of approved leave inside the period, per leave type short name. */
  byType: Record<string, number>
  /** Of those, the days on unpaid types (is_paid = false) — what payroll deducts. */
  unpaidDays: number
  paidDays: number
}

/**
 * Approved leave inside a pay period, counted on working days only.
 *
 * NOT CALLED YET — payroll is still being designed. It exists so that when the
 * payroll run is built, "how many LWP days did this person have in October" is
 * one call and gives the same answer the Leave tab does. A request that crosses
 * the period boundary is clipped to it; weekly offs and holidays inside the
 * request are not counted, exactly as the apply route counts them.
 */
export async function leaveDaysForPeriod(employeeIds: string[], from: string, to: string): Promise<Map<string, PeriodLeave>> {
  const ids = [...new Set(employeeIds.filter(Boolean))]
  const out = new Map<string, PeriodLeave>()
  if (!ids.length) return out
  const apps = await inChunks<{ employee_id: string; from_date: string; to_date: string; half_day: boolean | null; leave_types: { short_name: string | null; is_paid: boolean | null } | null }>(ids, c =>
    sb.from('leave_applications').select('employee_id, from_date, to_date, half_day, leave_types(short_name, is_paid)')
      .in('employee_id', c).eq('status', 'APPROVED').lte('from_date', to).gte('to_date', from))
  const byEmp = new Map<string, typeof apps>()
  for (const a of apps) { const l = byEmp.get(a.employee_id) || []; l.push(a); byEmp.set(a.employee_id, l) }

  for (const id of ids) {
    const mine = byEmp.get(id) || []
    const rec: PeriodLeave = { employee_id: id, byType: {}, unpaidDays: 0, paidDays: 0 }
    if (mine.length) {
      const [offR, holR] = await Promise.all([
        sb.rpc('resolve_weekly_offs', { p_employee_id: id, p_from: from, p_to: to }),
        sb.rpc('resolve_holidays', { p_employee_id: id }),
      ])
      const off = new Set<string>([
        ...((offR.data || []) as { off_date: string }[]).map(r => String(r.off_date)),
        ...((holR.data || []) as { holiday_date: string }[]).map(r => String(r.holiday_date)),
      ])
      for (const a of mine) {
        const s = a.from_date > from ? a.from_date : from
        const e = a.to_date < to ? a.to_date : to
        let n = 0
        for (let t = Date.parse(s + 'T00:00:00Z'); t <= Date.parse(e + 'T00:00:00Z'); t += 86400000) {
          if (!off.has(new Date(t).toISOString().slice(0, 10))) n++
        }
        if (a.half_day) n = Math.min(n, 0.5)
        const k = a.leave_types?.short_name || 'LEAVE'
        rec.byType[k] = (rec.byType[k] || 0) + n
        if (a.leave_types?.is_paid === false) rec.unpaidDays += n; else rec.paidDays += n
      }
    }
    out.set(id, rec)
  }
  return out
}
