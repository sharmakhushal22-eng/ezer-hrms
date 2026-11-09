// lib/pms/bulkPublish.ts — releasing many results at once.
//
// Requested: "Bulk publish at one click for multiple employees with
// different employee ids in multiple departments filter by
// group/branch/company. Default filter: selected all."
//
// ── WHAT BULK DOES NOT RELAX ─────────────────────────────────────────────
//
// Every person in a batch goes through the SAME publishFaults the card uses
// on one person. A batch is a convenience for results that are already
// prepared, not a second route with weaker rules — the owner chose that
// explicitly over waiving the appreciation remark and over settling the 211
// attestation in bulk. Somebody who is not ready is skipped and named, with
// the reason, so a batch of two hundred never leaves anybody guessing.
//
// ── "GROUP" ──────────────────────────────────────────────────────────────
//
// The whole group of companies, which is what the owner meant: a scope
// ABOVE company rather than a column. The columns actually named unit,
// business_unit and branch_mapping exist and are empty on all 400
// employees, so filtering on them would have produced a control that
// silently matched nobody.
//
// ── "BRANCH" ─────────────────────────────────────────────────────────────
//
// The locations table: ten of them, typed Factory, Branch, Head Office and
// Corporate Office. Branch is the word the request used and the word the
// data uses.

import { publishFaults, type GateInput } from './publishGate.ts'

export interface BulkRow extends GateInput {
  employeeId: string
  periodId?: string | null
  code: string
  name: string
  companyName?: string | null
  departmentId?: string | null
  departmentName?: string | null
  locationId?: string | null
  locationName?: string | null
  published?: boolean
}

/** Null means "all", which is where every filter starts. */
export interface BulkFilter {
  company?: string | null
  department?: string | null
  location?: string | null
}

export const ALL = null

/**
 * The people a filter selects.
 *
 * ALREADY-PUBLISHED ROWS ARE DROPPED HERE, not reported as blocked. They are
 * not a problem to be explained; they are simply done, and listing them as
 * skipped in every batch would bury the people who genuinely need attention.
 */
export function selectRows(rows: BulkRow[] | null | undefined, f: BulkFilter = {}): BulkRow[] {
  return (rows ?? []).filter(r => {
    if (r.published) return false
    if (f.company && (r.companyName ?? '') !== f.company) return false
    if (f.department && (r.departmentId ?? '') !== f.department) return false
    if (f.location && (r.locationId ?? '') !== f.location) return false
    return true
  })
}

export interface BulkSplit {
  ready: BulkRow[]
  /** Settled by the chain, but missing something HR has to supply. */
  blocked: { row: BulkRow; faults: string[] }[]
  /** Not settled yet. A number, never a list. */
  inChain: number
}

/**
 * Who can go out, who cannot, and who is not a candidate at all.
 *
 * THE THIRD GROUP IS THE POINT. An appraisal with no final rating is not
 * "not ready to publish" — nobody has rated the person yet, and HR has
 * nothing to do about it. Counting it among the blocked drowns the real
 * work: MEASURED on this database, the first version reported 129 not
 * ready, of which 128 were simply people the chain had not started, and
 * the one row that genuinely needed attention was the last line of a
 * table nobody would read to the end.
 *
 * It is the same mistake the publish queue once made with 392 rows, and
 * the same fix: a number and a sentence.
 */
export function split(rows: BulkRow[]): BulkSplit {
  const ready: BulkRow[] = []
  const blocked: { row: BulkRow; faults: string[] }[] = []
  let inChain = 0
  for (const r of rows) {
    if (r.finalRating === null || r.finalRating === undefined) { inChain++; continue }
    const faults = publishFaults(r)
    if (faults.length) blocked.push({ row: r, faults })
    else ready.push(r)
  }
  const byCode = (a: BulkRow, b: BulkRow) => a.code.localeCompare(b.code)
  return {
    ready: ready.sort(byCode),
    blocked: blocked.sort((a, b) => byCode(a.row, b.row)),
    inChain,
  }
}

/**
 * Why a batch is held up, counted by reason.
 *
 * "14 have no appreciation remark" is a morning's work somebody can plan.
 * Fourteen separate rows each saying the same sentence is a list to scroll
 * past.
 */
export function blockedSummary(blocked: BulkSplit['blocked']): { reason: string; n: number }[] {
  const by = new Map<string, number>()
  for (const b of blocked) {
    // The FIRST fault only: it is the one to fix first, and counting a
    // person once under each of their three problems would make the totals
    // add up to more than the people.
    const first = b.faults[0] ?? 'Not ready.'
    by.set(first, (by.get(first) ?? 0) + 1)
  }
  return [...by.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n)
}

/** The distinct values a filter can offer, built from the rows in hand. */
export function choices(rows: BulkRow[] | null | undefined): {
  companies: string[]
  departments: { id: string; name: string }[]
  locations: { id: string; name: string }[]
} {
  const co = new Set<string>()
  const dep = new Map<string, string>()
  const loc = new Map<string, string>()
  for (const r of rows ?? []) {
    if (r.companyName) co.add(r.companyName)
    if (r.departmentId) dep.set(r.departmentId, r.departmentName || 'Unnamed department')
    if (r.locationId) loc.set(r.locationId, r.locationName || 'Unnamed location')
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return {
    companies: [...co].sort(),
    departments: [...dep.entries()].map(([id, name]) => ({ id, name })).sort(byName),
    locations: [...loc.entries()].map(([id, name]) => ({ id, name })).sort(byName),
  }
}

export interface BulkOutcome {
  published: string[]
  failed: { code: string; name: string; message: string }[]
}

/**
 * A sentence for what just happened.
 *
 * Written here so the screen and any later caller say the same thing, and
 * so the counts cannot disagree with the lists they describe.
 */
export function outcomeText(o: BulkOutcome, skipped: number): string {
  const n = o.published.length
  const parts: string[] = [
    n === 0 ? 'Nothing was published.'
      : `${n} ${n === 1 ? 'result is' : 'results are'} now with the ${n === 1 ? 'employee' : 'employees'}.`,
  ]
  if (o.failed.length) {
    parts.push(`${o.failed.length} ${o.failed.length === 1 ? 'was refused' : 'were refused'} by the server and ${o.failed.length === 1 ? 'is' : 'are'} listed below.`)
  }
  if (skipped) {
    parts.push(`${skipped} ${skipped === 1 ? 'was' : 'were'} not ready and ${skipped === 1 ? 'was' : 'were'} left alone.`)
  }
  return parts.join(' ')
}
