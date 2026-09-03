// lib/pms/policy.ts — which policy an employee falls under, and what it allows.
//
// Spec §6.2. A company can run several policies at once — Sales monthly,
// Leadership half-yearly, Workmen annual — and rule 14 of the master list is
// absolute: an employee is in EXACTLY ONE active policy.
//
// THE OVERLAP RULE, AND WHY THE ORDER IS NOT ARBITRARY
//
//     location > grade > department > all
//
// The narrowest match wins. A Sales person at the Pune plant matches both
// "Sales · monthly" and "Pune · quarterly"; location is narrower, so Pune
// wins. Resolving it any other way would put somebody on two cycles at once,
// and every downstream count — fill status, completion, the leaderboard —
// would double-count them without anything looking wrong.
//
// Ties are refused rather than guessed. Two policies of the same specificity
// matching one person is a configuration mistake, and picking one silently
// hides it until an appraisal goes to the wrong chain.

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL'

/** How many periods a year each frequency produces. Spec §6.1. */
export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, ANNUAL: 1,
}

/** Narrowest first. The index IS the precedence — do not reorder casually. */
export const SCOPES = ['location', 'grade', 'department', 'all'] as const
export type Scope = (typeof SCOPES)[number]

export interface Policy {
  id: string
  name: string
  frequency: Frequency
  isActive: boolean
  /** null on a dimension means "does not constrain on this dimension". */
  locationId?: string | null
  grades?: string[] | null
  departmentId?: string | null
  minKra: number
  maxKra: number
  totalWeightage: number
  minWeightagePerKra: number
  whoCanFinalise: 'RM1_RM2_HOD' | 'RM2_HOD' | 'HOD_ONLY'
}

export interface Person {
  locationId?: string | null
  grade?: string | null
  departmentId?: string | null
}

/** The narrowest dimension this policy constrains on, or null if it matches
 *  nobody in particular (which is the catch-all). */
export function scopeOf(p: Policy): Scope {
  if (p.locationId) return 'location'
  if (p.grades && p.grades.length) return 'grade'
  if (p.departmentId) return 'department'
  return 'all'
}

/** Does this policy apply to this person at all? Every constraint it sets
 *  must match; a constraint it does not set is not a filter. */
export function matches(p: Policy, who: Person): boolean {
  if (!p.isActive) return false
  if (p.locationId && p.locationId !== who.locationId) return false
  if (p.grades && p.grades.length && !(who.grade && p.grades.includes(who.grade))) return false
  if (p.departmentId && p.departmentId !== who.departmentId) return false
  return true
}

export type Resolution =
  | { ok: true; policy: Policy }
  | { ok: false; reason: string; candidates: Policy[] }

/**
 * The one policy this person is on.
 *
 * Returns a REASON rather than a policy when it cannot decide, because both
 * failure modes are configuration faults an admin must see: nobody covered,
 * or two equally-narrow policies claiming the same person.
 */
export function resolvePolicy(policies: Policy[], who: Person): Resolution {
  const hits = policies.filter(p => matches(p, who))
  if (hits.length === 0) {
    return { ok: false, candidates: [],
      reason: 'No active policy covers this person. They cannot be appraised until one does.' }
  }
  const rank = (p: Policy) => SCOPES.indexOf(scopeOf(p))
  const best = Math.min(...hits.map(rank))
  const narrowest = hits.filter(p => rank(p) === best)
  if (narrowest.length > 1) {
    return { ok: false, candidates: narrowest,
      reason: `${narrowest.length} policies of the same scope claim this person `
            + `(${narrowest.map(p => p.name).join(', ')}). Exactly one must apply — `
            + 'narrow one of them or switch it off.' }
  }
  return { ok: true, policy: narrowest[0] }
}

/** Everyone a policy set leaves uncovered or double-claimed, for the admin
 *  screen. An overlap found at configuration time is a five-minute fix; the
 *  same overlap found at finalisation is an appraisal in the wrong chain. */
export function conflicts(policies: Policy[], people: (Person & { id: string })[]) {
  const uncovered: string[] = []
  const contested: { id: string; names: string[] }[] = []
  for (const who of people) {
    const r = resolvePolicy(policies, who)
    if (r.ok) continue
    if (r.candidates.length) contested.push({ id: who.id, names: r.candidates.map(p => p.name) })
    else uncovered.push(who.id)
  }
  return { uncovered, contested }
}

// ── periods ──────────────────────────────────────────────────────────────

export interface PeriodWindow { code: string; label: string; start: string; end: string }

/**
 * What pms_generate_periods() will produce, previewed before it is called.
 *
 * The database does the real generation. This exists so the config screen can
 * show an admin what changing the frequency will actually create BEFORE they
 * save it — "Quarterly (4 periods)" in a dropdown does not tell anybody that
 * Q1 runs April to June.
 */
export function previewPeriods(freq: Frequency, fyStartISO: string): PeriodWindow[] {
  const n = PERIODS_PER_YEAR[freq]
  const months = 12 / n
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fyStartISO)
  if (!m) return []
  const y0 = Number(m[1]), mo0 = Number(m[2]) - 1
  // FULL names, matching lib/pms/language.ts. Two modules naming the same
  // month two different ways is how a period reads as "Apr to Jun" on one
  // screen and "April to June" on the next.
  const MON = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  const out: PeriodWindow[] = []
  for (let i = 0; i < n; i++) {
    const s = new Date(Date.UTC(y0, mo0 + i * months, 1))
    const e = new Date(Date.UTC(y0, mo0 + (i + 1) * months, 0))   // day 0 = last of prev
    const pre = freq === 'MONTHLY' ? 'M' : freq === 'QUARTERLY' ? 'Q'
              : freq === 'HALF_YEARLY' ? 'H' : 'A'
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear()
    out.push({
      code: `${pre}${freq === 'MONTHLY' ? String(i + 1).padStart(2, '0') : i + 1}`,
      // Months in words, never "Q3". The reader should not have to know that
      // the financial year starts in April to read their own cycle.
      label: months === 1
        ? `${MON[s.getUTCMonth()]} ${s.getUTCFullYear()}`
        : sameYear
          ? `${MON[s.getUTCMonth()]} to ${MON[e.getUTCMonth()]} ${e.getUTCFullYear()}`
          : `${MON[s.getUTCMonth()]} ${s.getUTCFullYear()} to ${MON[e.getUTCMonth()]} ${e.getUTCFullYear()}`,
      start: iso(s), end: iso(e),
    })
  }
  return out
}
