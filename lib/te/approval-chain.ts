// lib/te/approval-chain.ts — where a request has got to in its approval chain.
//
// The travel desk is told a trip is "waiting for approval" and that is all it
// is told. On a two-step chain that is the difference between a trip the desk
// can expect to book tomorrow and one that has not been looked at: R1 approved
// and the Head of department still to come is nothing like nobody having
// touched it. The desk books tickets against a date, so knowing which it is
// decides whether to hold a fare now or wait.
//
// te_approval_steps already holds all of it — one row per step, in order, with
// who it belongs to and whether they have acted. Nothing read it outside the
// employee's own trip screen, and that screen only showed it while the trip was
// still pending, which is exactly when the desk cannot see the trip at all.
//
// This turns those rows into the two things a screen needs: a sentence for the
// row, and the steps themselves for anyone who wants the detail.

/** One step of te_approval_steps, as the desk and the trip screen read it. */
export interface ChainStep {
  stepNo: number
  /** 'Reporting manager (R1)', 'Head of department', … as stored. */
  roleLabel: string
  status: 'pending' | 'approved' | 'auto' | 'rejected' | 'sent_back' | 'cancelled' | string
  /** The named approver, or null for a team step. */
  who: string | null
  /** Who actually acted, which is not the same person when it was delegated. */
  actedBy?: string | null
  actedAt?: string | null
}

export interface ChainState {
  /** Steps that have been settled one way or another. */
  done: number
  total: number
  /** The step everybody is waiting on, or null when there is nothing to wait for. */
  waitingOn: ChainStep | null
  /** 'waiting' · 'part' (some approved, more to come) · 'approved' · 'sent_back' · 'rejected' */
  state: 'waiting' | 'part' | 'approved' | 'sent_back' | 'rejected' | 'none'
  /** One line for a desk row. Says what has happened and what is next. */
  text: string
}

/** An approval that counts as settled in the approver's favour. */
const PASSED = new Set(['approved', 'auto'])

/** Shortens 'Reporting manager (R1)' to 'R1' where the label carries one, so a
 *  chain fits on one line. Anything without a bracketed code is left alone. */
export function shortRole(label: string): string {
  const m = label.match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : label
}

/** A list joined the way a person says it: "a", "a and b", "a, b and c". */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Where this request has got to.
 *
 * `steps` must be in step order. A rejection or a send-back ends the story —
 * the steps after it never ran and reporting "1 of 3" for them would suggest
 * the chain is still moving when it has stopped.
 */
export function chainState(steps: ChainStep[]): ChainState {
  if (!steps.length) {
    // A trip can be approved with no chain at all: a short local trip that
    // needs nobody. Saying "0 of 0 approved" would be a strange way to put it.
    return { done: 0, total: 0, waitingOn: null, state: 'none', text: 'No approval needed' }
  }
  const total = steps.length

  const rejected = steps.find(s => s.status === 'rejected')
  if (rejected) {
    return {
      done: steps.filter(s => PASSED.has(s.status)).length, total, waitingOn: null, state: 'rejected',
      text: `Rejected by ${rejected.who ?? shortRole(rejected.roleLabel)}`,
    }
  }
  const sentBack = steps.find(s => s.status === 'sent_back')
  if (sentBack) {
    return {
      done: steps.filter(s => PASSED.has(s.status)).length, total, waitingOn: null, state: 'sent_back',
      text: `Sent back by ${sentBack.who ?? shortRole(sentBack.roleLabel)}`,
    }
  }

  const passed = steps.filter(s => PASSED.has(s.status))
  const waitingOn = steps.find(s => s.status === 'pending') ?? null

  if (!waitingOn) {
    return {
      done: passed.length, total, waitingOn: null, state: 'approved',
      text: `Approved by ${listed(passed.map(s => shortRole(s.roleLabel)))}`,
    }
  }
  const next = waitingOn.who ?? shortRole(waitingOn.roleLabel)
  if (!passed.length) {
    // Nobody has looked yet. Say who it is sitting with, because that is the
    // only actionable fact on the row.
    return {
      done: 0, total, waitingOn, state: 'waiting',
      text: total > 1 ? `Waiting on ${next}, then ${total - 1} more` : `Waiting on ${next}`,
    }
  }
  // THE CASE THIS FILE EXISTS FOR: part way through. "Waiting for approval" and
  // "R1 approved, waiting on the Head of department" are the same status and
  // very different news.
  return {
    done: passed.length, total, waitingOn, state: 'part',
    text: `${listed(passed.map(s => shortRole(s.roleLabel)))} approved · waiting on ${next}`,
  }
}

/** The chip tone for a chain state, in this module's own vocabulary. */
export function chainTone(state: ChainState['state']): 'pos' | 'warn' | 'crit' | 'plain' {
  if (state === 'approved' || state === 'none') return 'pos'
  if (state === 'rejected') return 'crit'
  if (state === 'sent_back') return 'warn'
  return 'warn'
}
