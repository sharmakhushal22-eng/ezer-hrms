// lib/pms/cycle.ts — where the appraisal cycle is, and what YOU owe it.
//
// The brief for the redesign was that somebody should understand how to
// operate the module just by looking at it. That is not a styling problem.
// A screen is self-explanatory when it can answer three questions without
// the reader knowing anything about appraisals:
//
//     what happens in this process, and in what order   -> STAGES
//     where are we in it right now                      -> stageStates()
//     what is MINE to do, and by when                   -> nextAction()
//
// All three are decided here, as pure functions over data the caller already
// has. Nothing in this file touches Supabase, the clock, or React, so the
// rules can be tested directly — which matters more than usual, because the
// pms_* tables do not exist yet (Nayan owns the database) and none of this
// can be exercised end to end in the app.
//
// WHY THE STAGE IS DERIVED AND NEVER STORED
//
// A stored "current stage" column would be a second source of truth that
// drifts the first time anything is backdated, corrected, or run out of
// order. Everything here is computed from the period's own windows and from
// rows that already exist. If a KRA set is unlocked and re-approved, the
// stage moves back on its own.

/** The seven stages, in the order they happen. Sequence is data. */
export const STAGES = [
  { key: 'kra',      n: 1, label: 'KRA Setting',
    blurb: 'Agree what you will be measured on this period.' },
  { key: 'oneToOne', n: 2, label: 'One-to-One',
    blurb: 'You and your manager discuss those KRAs and both confirm it happened.' },
  { key: 'lock',     n: 3, label: 'Weightage Lock',
    blurb: 'Your manager approves the set. After this the KRAs cannot change.' },
  { key: 'self',     n: 4, label: 'Self Rating',
    blurb: 'Rate your own delivery against each KRA.' },
  { key: 'review',   n: 5, label: 'Manager Review',
    blurb: 'RM L1 rates you, then RM L2 reviews.' },
  { key: 'finalise', n: 6, label: 'HOD Finalise',
    blurb: 'The HOD settles the final rating for the department.' },
  { key: 'result',   n: 7, label: 'Result',
    blurb: 'Your result and feedback are published to you.' },
] as const

export type StageKey = (typeof STAGES)[number]['key']

/** done — behind us. active — happening now. upcoming — not yet.
 *  blocked — its turn, but something earlier is missing. */
export type StageState = 'done' | 'active' | 'upcoming' | 'blocked'

/** An open/close window on the calendar. ISO yyyy-mm-dd, inclusive. */
export interface Window { from: string; to: string }

/** The period being looked at. Mirrors pms_periods. */
export interface Period {
  label: string                 // "Q3 FY 2026-27"
  kra?: Window                  // when KRAs may be written
  self?: Window                 // when self rating is open
  review?: Window               // when RM L1/L2 rate
  finalise?: Window             // when the HOD finalises
  publishedOn?: string | null   // when results went out
}

/** What is true for THIS person in THIS period. Every field is optional so a
 *  caller with a half-loaded screen still gets a sensible answer rather than
 *  a crash — an unknown is treated as "not done yet", never as done. */
export interface Progress {
  kraCount?: number
  weightageTotal?: number
  kraSubmitted?: boolean        // sent to the manager
  kraApproved?: boolean         // manager approved -> weightage locked
  oneToOneLogged?: boolean
  oneToOneBothConfirmed?: boolean
  selfSubmitted?: boolean
  rmL1Done?: boolean
  rmL2Done?: boolean
  finalised?: boolean
  published?: boolean
}

/** Which hats this person wears. Derived from the org chart, not a role table. */
export interface Roles {
  isEmployee?: boolean
  isRM?: boolean
  isHOD?: boolean
  isHRAdmin?: boolean
}

/** Work waiting on this person in other people's cycles. */
export interface Queues {
  kraApprovals?: number         // reportees whose KRAs need approving
  ratingsDue?: number           // reportees to rate
  finalisationsDue?: number     // department rows to finalise
  notStartedInDept?: number     // people who have not written KRAs at all
}

/** The KRA count and weightage rules, from pms_policies. Defaults match the
 *  shipped policy so a screen rendered before config loads still teaches the
 *  right numbers rather than inventing looser ones. */
export interface Rules {
  minKra: number
  maxKra: number
  totalWeightage: number
  minWeightagePerKra: number
}

export const DEFAULT_RULES: Rules = {
  minKra: 4, maxKra: 10, totalWeightage: 100, minWeightagePerKra: 5,
}

// ── dates ────────────────────────────────────────────────────────────────
// `today` is always passed in. Reading the clock in here would make every
// rule below untestable and would differ between server and browser render.

/** Is `day` inside the window? Undefined window means "no window configured",
 *  which is open rather than shut — a missing config must not silently lock
 *  people out of their own appraisal. */
export function inWindow(w: Window | undefined, day: string): boolean {
  if (!w) return true
  return day >= w.from && day <= w.to
}

/** Days from `day` to the window's close. Negative once it has passed. */
export function daysLeft(w: Window | undefined, day: string): number | null {
  if (!w) return null
  const ms = Date.parse(w.to + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')
  if (Number.isNaN(ms)) return null
  return Math.round(ms / 86400000)
}

/** "2027-01-01" -> "1 Jan 2027". ISO dates are for storage; nobody reads a
 *  deadline in them, and a screen meant to explain itself cannot print one. */
export function humanDate(iso: string | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

// ── where the cycle is ───────────────────────────────────────────────────

/** True when the KRA set satisfies the policy and can be submitted. */
export function kraSetValid(p: Progress, r: Rules = DEFAULT_RULES): boolean {
  const n = p.kraCount ?? 0
  return n >= r.minKra && n <= r.maxKra && (p.weightageTotal ?? 0) === r.totalWeightage
}

/**
 * Fill in the earlier steps that a later one proves must have happened.
 *
 * Callers assemble Progress from whatever rows they managed to read, and
 * those rows are not a chain — an approved KRA set is a row on its own, and
 * nothing says "and it was submitted first". Reading the raw flags in order
 * therefore told somebody whose set was already APPROVED to go and write
 * their KRAs, because `kraSubmitted` happened to be undefined.
 *
 * currentStage() reads strictly backwards from the latest evidence and was
 * never fooled. nextAction() reads forwards, looking for the first thing
 * undone, so it needs the earlier flags to actually be there. Normalising
 * once, here, keeps the two from ever disagreeing again.
 */
export function settled(p: Progress): Progress {
  const out: Progress = { ...p }
  if (out.published) out.finalised = true
  if (out.finalised) out.rmL2Done = true
  if (out.rmL2Done) out.rmL1Done = true
  if (out.rmL1Done) out.selfSubmitted = true
  if (out.selfSubmitted) out.kraApproved = true
  if (out.kraApproved) { out.oneToOneBothConfirmed = true; out.kraSubmitted = true }
  if (out.oneToOneBothConfirmed) out.oneToOneLogged = true
  if (out.kraSubmitted) out.kraApproved = out.kraApproved ?? false
  return out
}

/**
 * The stage the cycle has REACHED — the first one that is not finished.
 *
 * Read strictly forward: a stage counts as complete only when its own
 * evidence exists, so a missing row can never let the cycle appear further
 * along than it is.
 */
export function currentStage(raw: Progress): StageKey {
  const p = settled(raw)
  if (p.published) return 'result'
  if (p.finalised) return 'result'
  if (p.rmL2Done) return 'finalise'
  if (p.rmL1Done) return 'review'
  if (p.selfSubmitted) return 'review'
  if (p.kraApproved) return 'self'
  if (p.oneToOneBothConfirmed) return 'lock'
  if (p.kraSubmitted) return 'oneToOne'
  return 'kra'
}

/**
 * Every stage's state, for the stepper.
 *
 * BLOCKED is the state that does the teaching. A stage is blocked when the
 * calendar says it is open but its precondition has not been met — self
 * rating during the self-rating window with the KRAs still unapproved, say.
 * Without it the stepper would show "active" and the reader would look for a
 * control that is correctly disabled, with nothing explaining why.
 */
export function stageStates(
  period: Period, raw: Progress, today: string,
): Record<StageKey, StageState> {
  const p = settled(raw)
  const at = currentStage(p)
  const reached = STAGES.findIndex(s => s.key === at)
  const out = {} as Record<StageKey, StageState>

  STAGES.forEach((s, i) => {
    if (i < reached) { out[s.key] = 'done'; return }
    if (i > reached) { out[s.key] = 'upcoming'; return }

    // the stage we are at
    if (s.key === 'result') { out[s.key] = p.published ? 'done' : 'active'; return }

    const w = s.key === 'self' ? period.self
            : s.key === 'review' ? period.review
            : s.key === 'finalise' ? period.finalise
            : s.key === 'kra' ? period.kra
            : undefined

    if (w && !inWindow(w, today)) {
      // Its window is open elsewhere on the calendar but not now. Before the
      // window it is simply upcoming; after it, the cycle has stalled here.
      out[s.key] = today < w.from ? 'upcoming' : 'blocked'
      return
    }
    // The window is open (or unconfigured). Blocked only if an earlier step
    // that this one depends on is missing.
    if (s.key === 'self' && !p.kraApproved) { out[s.key] = 'blocked'; return }
    if (s.key === 'lock' && !p.oneToOneBothConfirmed) { out[s.key] = 'blocked'; return }
    out[s.key] = 'active'
  })
  return out
}

// ── what is mine to do ───────────────────────────────────────────────────

export type Urgency = 'none' | 'info' | 'due' | 'overdue'

export interface Action {
  /** Imperative, in the reader's own terms. "Write your KRAs", not "KRA entry". */
  title: string
  /** Why it is being asked of them. One sentence, plain. */
  why: string
  /** The control that does it. */
  cta: string
  /** Which tab to open. */
  tab: string
  urgency: Urgency
  /** Days to the window's close, when there is one. */
  daysLeft?: number | null
  /** Set when the action cannot be done yet, and says what is in the way. */
  blockedBy?: string
}

function urgencyOf(d: number | null | undefined): Urgency {
  if (d === null || d === undefined) return 'info'
  if (d < 0) return 'overdue'
  if (d <= 3) return 'due'
  return 'info'
}

/**
 * The one thing this person should do next, or nothing.
 *
 * ORDER IS DELIBERATE: own work before other people's. Somebody who is both
 * an RM and an employee is shown their own overdue self-rating before their
 * approval queue, because their own is the one nobody else can unblock. A
 * queue of ten is still only a hint of volume; their own missing row stops
 * their own appraisal.
 */
export function nextAction(
  period: Period, raw: Progress, roles: Roles, q: Queues, today: string,
  rules: Rules = DEFAULT_RULES,
): Action | null {
  const p = settled(raw)
  const stage = currentStage(p)

  if (roles.isEmployee !== false) {
    // 1. KRAs not written or not valid yet
    if (!p.kraSubmitted) {
      const n = p.kraCount ?? 0
      const total = p.weightageTotal ?? 0
      const d = daysLeft(period.kra, today)
      if (n === 0) {
        return { title: 'Write your KRAs', tab: 'mine', urgency: urgencyOf(d), daysLeft: d,
          cta: 'Add your first KRA',
          why: `Your KRAs are what you will be rated on this period. You need between ${rules.minKra} and ${rules.maxKra}, and their weightage must add up to exactly ${rules.totalWeightage}.` }
      }
      if (!kraSetValid(p, rules)) {
        const short = n < rules.minKra
          ? `you have ${n} of at least ${rules.minKra}`
          : n > rules.maxKra ? `you have ${n}, more than the ${rules.maxKra} allowed`
          : `weightage adds to ${total}, not ${rules.totalWeightage}`
        return { title: 'Finish your KRA set', tab: 'mine', urgency: urgencyOf(d), daysLeft: d,
          cta: 'Fix and send to manager',
          why: `Almost there — ${short}. Your manager cannot approve the set until it satisfies both rules.` }
      }
      return { title: 'Send your KRAs to your manager', tab: 'mine', urgency: urgencyOf(d), daysLeft: d,
        cta: 'Send to manager',
        why: `${n} KRAs totalling ${total}. Your manager reviews them with you before they are locked.` }
    }

    // 2. one-to-one
    if (!p.oneToOneBothConfirmed) {
      return { title: 'Confirm your one-to-one', tab: 'oneone', urgency: 'info',
        cta: p.oneToOneLogged ? 'Confirm the discussion' : 'Log the discussion',
        why: p.oneToOneLogged
          ? 'Your manager has logged the discussion. Both of you confirm it before the KRAs are locked.'
          : 'Before your KRAs are locked, you and your manager talk them through and both confirm it happened.' }
    }

    // 3. self rating
    if (!p.selfSubmitted) {
      const d = daysLeft(period.self, today)
      if (!p.kraApproved) {
        return { title: 'Waiting on your manager', tab: 'mine', urgency: 'info',
          cta: 'See your KRAs',
          blockedBy: 'Your KRAs have not been approved yet.',
          why: 'Self rating opens once your manager approves and locks your KRA set. Nothing to do until then.' }
      }
      if (!inWindow(period.self, today)) {
        // BEFORE and AFTER the window are opposite situations and must never
        // share a message. "Not open yet" shown to somebody who has MISSED
        // the deadline is worse than saying nothing: it tells them to relax
        // when they need to talk to their manager today.
        const early = period.self ? today < period.self.from : false
        if (early) {
          const opens = humanDate(period.self?.from)
          return { title: 'Self rating is not open yet', tab: 'self', urgency: 'info',
            cta: 'See your KRAs', blockedBy: 'The self-rating window has not started.',
            why: `Your KRAs are locked and nothing is owed until ${opens}, when self rating opens. Reviewing them now is the useful thing to do.` }
        }
        if (period.self) {
          const closed = humanDate(period.self.to)
          const over = daysLeft(period.self, today)
          return { title: 'You missed the self-rating window', tab: 'self', urgency: 'overdue',
            daysLeft: over, cta: 'Ask your manager to reopen it',
            blockedBy: `Self rating closed on ${closed}.`,
            why: 'Your manager can still rate you without it, but your own view of your delivery will not be on record. Ask them to reopen the window if it matters to you.' }
        }
        return { title: 'Self rating is not open yet', tab: 'self', urgency: 'info',
          cta: 'See your KRAs', blockedBy: 'No self-rating window is set.',
          why: 'Your KRAs are locked. Self rating opens once your HR team sets the window for this period.' }
      }
      return { title: 'Rate yourself', tab: 'self', urgency: urgencyOf(d), daysLeft: d,
        cta: 'Start self rating',
        why: 'Score your own delivery against each KRA. Your manager sees this alongside their own rating, so it is your chance to make the case.' }
    }
  }

  // 4. other people's work — RM, then HOD
  if (roles.isRM) {
    if (q.kraApprovals) {
      return { title: `Approve ${q.kraApprovals} KRA set${q.kraApprovals > 1 ? 's' : ''}`,
        tab: 'team', urgency: 'due', cta: 'Open the approval queue',
        why: 'Your reportees cannot start rating themselves until you approve and lock their KRAs.' }
    }
    if (q.ratingsDue) {
      const d = daysLeft(period.review, today)
      return { title: `Rate ${q.ratingsDue} reportee${q.ratingsDue > 1 ? 's' : ''}`,
        tab: 'team', urgency: urgencyOf(d), daysLeft: d, cta: 'Open the rating queue',
        why: 'They have submitted their self ratings. Yours is compared against theirs, and the gap is what the one-to-one is about.' }
    }
  }

  if (roles.isHOD && q.finalisationsDue) {
    const d = daysLeft(period.finalise, today)
    return { title: `Finalise ${q.finalisationsDue} rating${q.finalisationsDue > 1 ? 's' : ''}`,
      tab: 'dept', urgency: urgencyOf(d), daysLeft: d, cta: 'Open the finalisation queue',
      why: 'Both managers have rated. You settle the final number, and publishing releases it to the employee.' }
  }

  if (roles.isHRAdmin && q.notStartedInDept) {
    return { title: `${q.notStartedInDept} people have not written KRAs`,
      tab: 'fill', urgency: 'due', cta: 'See who is missing',
      why: 'They cannot be rated at all this period until they do. Chasing them now is cheaper than an exception later.' }
  }

  // 5. nothing owed
  if (stage === 'result' && p.published) return null
  return null
}
