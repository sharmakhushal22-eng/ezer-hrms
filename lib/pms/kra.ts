// lib/pms/kra.ts — the KRA set an employee writes for themselves. Spec §3.2.
//
// Rules 1 to 4 of §11 live here, together, because they are ONE decision from
// the employee's side: "can I submit this yet?" Spread across a component they
// become four independent booleans, and the screen ends up able to say
// "looks fine" while the database refuses the insert.
//
// WHY THE ERRORS ARE SENTENCES
//
// "Invalid weightage" tells somebody nothing they can act on. Every message
// here names the number they have, the number they need, and the direction to
// move — because the person reading it is not a developer and has no other
// way to find out what is wrong.

import { DEFAULT_RULES, type Rules } from './cycle.ts'

/** §3.2 — these drive the category analytics in §3.6 and §5.3. */
export const CATEGORIES = [
  'BUSINESS', 'PROCESS', 'PEOPLE', 'CUSTOMER', 'COMPLIANCE', 'LEARNING',
] as const
export type Category = typeof CATEGORIES[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  BUSINESS: 'Business', PROCESS: 'Process', PEOPLE: 'People',
  CUSTOMER: 'Customer', COMPLIANCE: 'Compliance', LEARNING: 'Learning',
}

export interface Kra {
  seq_no: number
  kra_title: string
  kpi_metric: string
  target_value: string
  category: Category
  weightage: number
  /**
   * WHERE THIS KRA CAME FROM. pms_employee_goals.source, which has allowed
   * 'MANUAL' | 'LIBRARY' | 'AI_SUGGESTED' | 'CARRIED_FORWARD' since 066 and
   * was never written by anything — every row was saved as the default
   * MANUAL, including rows that were plainly carried over.
   *
   * It matters beyond bookkeeping: a carried-forward KRA arrives already
   * agreed from last quarter, so the one-to-one is reviewing a change rather
   * than settling something new, and the employee should be told which of
   * their KRAs is which.
   */
  source?: 'MANUAL' | 'LIBRARY' | 'AI_SUGGESTED' | 'CARRIED_FORWARD'
  /** The period it was carried from, when it was. */
  carried_from_period_id?: string | null
}

export interface KraFault {
  /** Which row, or null when the fault is about the set as a whole. */
  seq: number | null
  says: string
}

export interface KraCheck {
  count: number
  total: number
  /** Distance from the required total. Negative means short. */
  short: number
  faults: KraFault[]
  /** The only thing a Submit button should look at. */
  canSubmit: boolean
  /** Rows below the per-KRA minimum, by seq_no. */
  thin: number[]
  /** Rows with nothing written in them yet. */
  blank: number[]
}

/**
 * Check the whole set at once.
 *
 * The order of the faults is the order to fix them in: the set-level problems
 * first, because a row-level warning is noise while the total is still wrong.
 */
export function checkKras(kras: Kra[], r: Rules = DEFAULT_RULES): KraCheck {
  const count = kras.length
  const total = kras.reduce((s, k) => s + (Number(k.weightage) || 0), 0)
  const faults: KraFault[] = []

  if (count < r.minKra) {
    faults.push({ seq: null, says:
      `Add ${r.minKra - count} more. A rating needs at least ${r.minKra} KRAs to rest on.` })
  }
  if (count > r.maxKra) {
    faults.push({ seq: null, says:
      `Remove ${count - r.maxKra}. Past ${r.maxKra} the weightages get too thin to mean anything.` })
  }
  if (total !== r.totalWeightage) {
    const d = r.totalWeightage - total
    faults.push({ seq: null, says: d > 0
      ? `${d} short of ${r.totalWeightage}. Weightage has to total exactly ${r.totalWeightage}, not at least.`
      : `${-d} over ${r.totalWeightage}. Take ${-d} off somewhere before this can be sent.` })
  }

  const thin: number[] = [], blank: number[] = []
  for (const k of kras) {
    const w = Number(k.weightage) || 0
    if (!k.kra_title.trim()) { blank.push(k.seq_no); continue }
    if (w < r.minWeightagePerKra) {
      thin.push(k.seq_no)
      faults.push({ seq: k.seq_no, says:
        `Weightage ${w} is below the minimum of ${r.minWeightagePerKra}. A KRA carrying less than that is not worth rating separately.` })
    }
  }
  for (const seq of blank) {
    faults.push({ seq, says: 'This row has no KRA written in it yet.' })
  }

  return {
    count, total, short: total - r.totalWeightage, faults, thin, blank,
    canSubmit: faults.length === 0,
  }
}

/** Rule 2 — the add button is off at the maximum, and says why. */
export function canAdd(kras: Kra[], r: Rules = DEFAULT_RULES):
  { allowed: boolean; reason?: string } {
  return kras.length < r.maxKra
    ? { allowed: true }
    : { allowed: false, reason: `${r.maxKra} is the maximum. Merge two before adding another.` }
}

/**
 * Rule 1 — deleting the 4th row is blocked.
 *
 * Blocked at the DELETE rather than reported after it: letting the row go and
 * then showing "minimum 4 KRAs" leaves the employee with a set they cannot
 * submit and no obvious way back, since the row they deleted is gone.
 */
export function canDelete(kras: Kra[], r: Rules = DEFAULT_RULES):
  { allowed: boolean; reason?: string } {
  return kras.length > r.minKra
    ? { allowed: true }
    : { allowed: false, reason: `${r.minKra} is the minimum. Edit this one instead of removing it.` }
}

/** What the weightage meter shows. Colour is never the only signal; `says`
 *  carries the same information for anyone who cannot use it. */
export function meter(c: KraCheck, r: Rules = DEFAULT_RULES):
  { tone: 'good' | 'warn' | 'bad'; pct: number; says: string } {
  const pct = Math.min(100, Math.round((c.total / r.totalWeightage) * 100))
  if (c.total === r.totalWeightage) {
    return { tone: 'good', pct, says: `Totals ${r.totalWeightage}. Ready to send.` }
  }
  if (c.total > r.totalWeightage) {
    return { tone: 'bad', pct: 100, says: `${c.total}: that is ${c.short} too many.` }
  }
  return { tone: 'warn', pct, says: `${c.total} of ${r.totalWeightage}, ${-c.short} still to allocate.` }
}

/** Spread 100 across n rows as evenly as whole numbers allow, remainder on
 *  the first. Offered as a starting point, never applied silently. */
export function suggestSplit(n: number, r: Rules = DEFAULT_RULES): number[] {
  if (n <= 0) return []
  const base = Math.floor(r.totalWeightage / n)
  const out = Array(n).fill(base)
  out[0] += r.totalWeightage - base * n
  return out
}

// ── §3's change log ──────────────────────────────────────────────────────

/** One row for pms_audit_log: what a KRA was, and what it became. */
export interface KraChange {
  action: 'ADD' | 'EDIT' | 'DELETE'
  seq_no: number
  /** The goal row's id, when it already existed. */
  record_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
}

/** The fields a change is judged on. Deliberately not `status`, `locked_at`
 *  or the HR override columns: those move for reasons that are not the
 *  employee editing their KRA, and logging them as edits would bury the
 *  changes that were actually agreed. */
const TRACKED = ['kra_title', 'kpi_metric', 'target_value', 'category', 'weightage'] as const

type Row = { id?: string | null; seq_no: number } & Record<string, unknown>

const shape = (r: Row): Record<string, unknown> => {
  const out: Record<string, unknown> = { seq_no: r.seq_no }
  for (const f of TRACKED) out[f] = f === 'weightage' ? Number(r[f]) || 0 : (r[f] ?? null)
  return out
}

const same = (a: Row, b: Row) =>
  TRACKED.every(f => f === 'weightage'
    ? (Number(a[f]) || 0) === (Number(b[f]) || 0)
    : String(a[f] ?? '') === String(b[f] ?? ''))

/**
 * What changed between the saved set and the one being submitted.
 *
 * §3's update: "a JSON log capturing the transition from the old to the new
 * state will be generated". Matched on seq_no, which is what
 * UNIQUE (period_id, employee_id, seq_no) makes the identity of a KRA within
 * a period — and what the upsert keys on, so this diff sees exactly the rows
 * the write will touch.
 *
 * A shorter set leaves a tail that submitKras deletes, and those are reported
 * as DELETE here. Without that, dropping a KRA would be the one modification
 * the log stayed silent about, which is also the one most worth having a
 * record of.
 */
export function diffKras(before: Row[], after: Row[]): KraChange[] {
  const was = new Map(before.map(r => [Number(r.seq_no), r]))
  const now = new Map(after.map(r => [Number(r.seq_no), r]))
  const out: KraChange[] = []

  for (const [seq, b] of now) {
    const a = was.get(seq)
    if (!a) {
      out.push({ action: 'ADD', seq_no: seq, record_id: null,
                 old_value: null, new_value: shape(b) })
    } else if (!same(a, b)) {
      out.push({ action: 'EDIT', seq_no: seq, record_id: (a.id as string) ?? null,
                 old_value: shape(a), new_value: shape(b) })
    }
  }
  for (const [seq, a] of was) {
    if (!now.has(seq)) {
      out.push({ action: 'DELETE', seq_no: seq, record_id: (a.id as string) ?? null,
                 old_value: shape(a), new_value: null })
    }
  }
  return out.sort((x, y) => x.seq_no - y.seq_no)
}
