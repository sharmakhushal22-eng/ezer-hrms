// lib/pms/rollup.ts — one row per person becomes one sentence for HR.
//
// The admin screens all answer the same question at different zoom levels:
// how far has the organisation got, and who is holding it up. That is a
// counting job, and counting jobs are where quiet errors live — a status
// nobody mapped falls into the wrong bucket and the totals still add up, so
// the mistake is invisible.
//
// So: pure functions, no fetching, and an explicit `unknown` bucket. A row
// whose status the app does not recognise is counted as unknown and SAID so,
// never folded into "not started" to make the arithmetic look tidy.

// Explicit .ts extension: tsconfig has allowImportingTsExtensions, and node
// --test resolves this file directly, where an extensionless specifier does
// not resolve at all.
import { FILL_ORDER, FILL_LABEL, type FillStatus } from './status.ts'

/** One row of vw_pms_fill_status, narrowed to what a roll-up needs. */
export interface FillRow {
  employee_name?: string | null
  employee_code?: string | null
  department_id?: string | null
  fill_status?: string | null
  kra_count?: number | null
  total_weightage?: number | null
}

export interface Rollup {
  total: number
  counts: Record<FillStatus, number>
  unknown: number
  /** 0–1. Finalised over total. */
  done: number
  /** People who cannot be rated at all yet. The number HR chases first. */
  notStarted: number
}

export function rollUp(rows: FillRow[]): Rollup {
  const counts = Object.fromEntries(FILL_ORDER.map(s => [s, 0])) as Record<FillStatus, number>
  let unknown = 0
  for (const r of rows) {
    const s = (r.fill_status ?? '') as FillStatus
    if (FILL_ORDER.includes(s)) counts[s]++
    else unknown++
  }
  const total = rows.length
  return {
    total, counts, unknown,
    done: total ? counts.FINALISED / total : 0,
    notStarted: counts.NOT_STARTED,
  }
}

export interface DeptRollup extends Rollup { departmentId: string | null }

/** Same counting, split by department, worst first — because the list exists
 *  to be worked down, and the department with the most people who have not
 *  started is where an hour of chasing buys the most. */
export function byDepartment(rows: FillRow[]): DeptRollup[] {
  const groups = new Map<string | null, FillRow[]>()
  for (const r of rows) {
    const k = r.department_id ?? null
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([departmentId, rs]) => ({ departmentId, ...rollUp(rs) }))
    .sort((a, b) => b.notStarted - a.notStarted || b.total - a.total)
}

/**
 * The one line that goes at the top of the admin screen.
 *
 * Deliberately not a percentage on its own: "62% complete" tells an HR admin
 * nothing they can act on. What they need is the count that is blocking and
 * what it blocks.
 */
export function readiness(r: Rollup): { headline: string; detail: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (r.total === 0) {
    return { headline: 'Nobody is enrolled in this period yet', tone: 'neutral',
      detail: 'Once a period is active and employees are attached to it, their progress appears here.' }
  }
  if (r.notStarted > 0) {
    const pct = Math.round((r.notStarted / r.total) * 100)
    return {
      headline: `${r.notStarted} of ${r.total} have not written any KRAs`,
      tone: r.notStarted > r.total / 2 ? 'bad' : 'warn',
      detail: `That is ${pct}% of the people in this cycle, and they cannot be rated at all until they do. `
            + 'Chasing them now costs less than an exception at finalisation.',
    }
  }
  if (r.done === 1) {
    return { headline: 'Every rating is finalised', tone: 'good',
      detail: 'Nothing is outstanding for this period.' }
  }
  const left = r.total - r.counts.FINALISED
  return {
    headline: `${left} of ${r.total} still to finalise`, tone: 'warn',
    detail: 'Everyone has started. What remains is sitting with managers and HODs rather than with employees.',
  }
}

/** Rows for a distribution bar: label, count, share. Zero-count states are
 *  kept, because an empty column is information — it says nobody is stuck
 *  there — and dropping them makes the bar change shape between loads. */
export function distribution(r: Rollup): { key: FillStatus; label: string; n: number; share: number }[] {
  return FILL_ORDER.map(key => ({
    key, label: FILL_LABEL[key], n: r.counts[key],
    share: r.total ? r.counts[key] / r.total : 0,
  }))
}
