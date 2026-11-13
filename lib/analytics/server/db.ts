// lib/analytics/server/db.ts — reading enough rows, safely, with the service client.
//
// PostgREST caps a response at 1000 rows and says nothing when it does, so every
// read that can exceed that pages through `.range()`. Lists of ids go into `.in()`
// 150 at a time, under the URL-length limit that the rest of this codebase also
// observes.

import { rmsServiceClient } from '@/lib/rms/server'
import { fyStartYear } from '../period.ts'
import type { EmpLite } from '../metrics.ts'

export const sb = rmsServiceClient

const PAGE = 1000
/** Hard ceiling per read, so a mistaken filter cannot pull a whole table into memory. */
const MAX_ROWS = 120_000

type Builder = { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }

/** Every row a query matches, page by page. `make` must build a fresh, ORDERED query.
 *  Pages are fetched four at a time: a 50,000-row attendance window is 50 pages, and one
 *  after another that is the whole wait. */
export async function all<T>(make: () => Builder, label = 'query'): Promise<T[]> {
  const first = await make().range(0, PAGE - 1)
  if (first.error) throw new Error(`${label}: ${first.error.message}`)
  const out: T[] = (Array.isArray(first.data) ? first.data : []) as T[]
  if (out.length < PAGE) return out          // most reads: one request and done
  const WAVE = 4
  for (let base = PAGE; base < MAX_ROWS; base += PAGE * WAVE) {
    const pages = await Promise.all(Array.from({ length: WAVE }, (_, k) => {
      const from = base + k * PAGE
      return make().range(from, from + PAGE - 1)
    }))
    let short = false
    for (const { data, error } of pages) {
      if (error) throw new Error(`${label}: ${error.message}`)
      const rows = (Array.isArray(data) ? data : []) as T[]
      out.push(...rows)
      if (rows.length < PAGE) { short = true; break }
    }
    if (short) break
  }
  return out
}

/** The same query run over ids in chunks, results concatenated. */
export async function inChunks<T>(ids: string[], make: (chunk: string[]) => Builder, label = 'query', size = 150): Promise<T[]> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const out: T[] = []
  for (let i = 0; i < uniq.length; i += size) {
    out.push(...(await all<T>(() => make(uniq.slice(i, i + size)), label)))
  }
  return out
}

/** A read that may legitimately be missing (a table not migrated on this install). */
export async function soft<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p } catch { return [] }
}

export const EMP_COLS = 'id, emp_code, full_name, company_id, department_id, location_id, designation, grade, employment_type, gender, date_of_birth, company_doj, group_doj, date_of_leaving, last_working_date, relieving_date, employment_status, l1_manager_id, confirmation_status, probation_months, confirmation_date, is_test'

export function toEmp(r: Record<string, any>): EmpLite {
  return {
    id: r.id,
    code: r.emp_code ?? null,
    name: r.full_name || r.emp_code || 'Unnamed',
    company_id: r.company_id ?? null,
    department_id: r.department_id ?? null,
    location_id: r.location_id ?? null,
    designation: r.designation ?? null,
    grade: r.grade ?? null,
    type: r.employment_type ?? null,
    gender: r.gender ?? null,
    dob: r.date_of_birth ?? null,
    doj: r.company_doj || r.group_doj || null,
    exit: r.date_of_leaving || r.last_working_date || r.relieving_date || null,
    status: r.employment_status ?? null,
    l1: r.l1_manager_id ?? null,
    confirmation: r.confirmation_status ?? null,
    probation_months: r.probation_months ?? null,
    confirmation_date: r.confirmation_date ?? null,
  }
}

/** Leave balances are written to whole and half days (lib/leave/accrual floorHalf); the
 *  ledger can still carry an unrounded accrual, so analytics floors the same way. */
export const floorHalf = (x: number) => Math.floor((Number(x) || 0) * 2) / 2

export const leaveYear = (today: string) => String(fyStartYear(today))

export const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** Open resignations: filed and not yet over, withdrawn or settled. */
export const OPEN_RESIGNATION = new Set(['INITIATED', 'PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER', 'RETENTION_HOLD', 'RECOVERY_PENDING', 'SUBMITTED', 'APPROVED'])

export const STAGE_LABEL: Record<string, string> = {
  INITIATED: 'Filed', PENDING_RM_L1: 'With L1 manager', PENDING_RM_L2: 'With L2 manager', PENDING_HOD: 'With HOD',
  PENDING_HR_MANAGER: 'With HR', RETENTION_HOLD: 'Retention talk', RECOVERY_PENDING: 'Recovery pending', SUBMITTED: 'Submitted', APPROVED: 'Approved',
}
