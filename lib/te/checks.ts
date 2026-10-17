// lib/te/checks.ts — which of the 55 fraud checks actually run.
//
// WHY THIS FILE EXISTS. Admin → Checks lists all 55 with a switch, and every
// one of them reads as a control that is on. Ten of them are never evaluated:
// not by the rules engine, not by any SQL function. (It was eleven until C8
// was built — the co-traveller double-claim.) An administrator reading that
// screen, or an auditor being shown it, was believing in controls that do not
// execute. A control nobody runs is worse than no control, because it is
// relied upon.
//
// So the screen now says which is which, and this file is where that is
// recorded. It changes no behaviour: a check that does not run did not run
// before this file existed either. What changes is that the module stops
// claiming otherwise.
//
// HOW THE LIST WAS DERIVED, and how it stays true. Every check code was
// searched for in lib/te/engine/te-engine.js outside its catalogue block, and
// in every migration except the two that only seed the catalogue (149 and the
// re-seed in 156). A code found nowhere is evaluated nowhere.
//
// __tests__/checks.test.ts re-derives that from the source on every run, so
// this list cannot drift: implement one of these and the test fails until it
// is removed from the list, and the screen stops calling it unbuilt.

/** Checks declared in the catalogue that nothing evaluates. */
export const NOT_IMPLEMENTED = [
  'C7', 'E4', 'F2', 'F3', 'G6',
] as const

/**
 * C9 IS DELIBERATELY NOT IN THAT LIST, although nothing raises it as a flag.
 *
 * "Employee is past date of leaving" is enforced harder than a flag could: the
 * claimant is refused outright by te_assert_active at trip save, expense save
 * and claim submit, with TE_EMPLOYEE_EXITED. A leaver cannot reach the point
 * where a flag would be raised. The catalogue row is redundant rather than
 * hollow, and saying "not built" about it would be the opposite of the truth.
 */
export const ENFORCED_ELSEWHERE: Record<string, string> = {
  C9: 'Enforced outright: a leaver is refused at save and submit, not flagged.',
}

/** Why each unimplemented check is not implemented. Honest about which are
 *  decisions and which are simply unbuilt — an administrator deciding whether
 *  to rely on one deserves to know the difference. */
export const WHY_NOT: Record<string, string> = {
  C7: 'Not built. Needs the travel timeline and the spend timeline compared journey by journey.',
  E4: 'Needs a GSTIN status provider. None is configured, so there is nothing to ask.',
  F2: 'Not built. Needs the time between a claim arriving and being cleared, per approver.',
  F3: 'Not built. Needs approver-to-employee approval patterns over time.',
  G6: 'Cannot be done from a browser. Detecting a mock-location app needs the device, which a web page is not allowed to inspect.',
}

export type CheckState = 'live' | 'later' | 'unbuilt' | 'enforced'

/** What to say about one check. `isLive` is te_checks.is_live, which means
 *  "evaluated while the person types" and NOT "implemented" — the two were
 *  easy to confuse, and the screen used to show only the first. */
export function checkState(code: string, isLive: boolean): CheckState {
  if (ENFORCED_ELSEWHERE[code]) return 'enforced'
  if ((NOT_IMPLEMENTED as readonly string[]).includes(code)) return 'unbuilt'
  return isLive ? 'live' : 'later'
}

/** The label and tone for that state. */
export function checkStateWords(state: CheckState): { label: string; tone: 'plain' | 't-brand' | 't-warn' | 't-pos'; help: string } {
  if (state === 'live') {
    return { label: 'Checked as they type', tone: 't-brand', help: 'Runs in the form, before the bill is even saved.' }
  }
  if (state === 'later') {
    return { label: 'Checked on the claim', tone: 'plain', help: 'Runs when the claim is submitted and again when Finance verifies it.' }
  }
  if (state === 'enforced') {
    return { label: 'Enforced, not flagged', tone: 't-pos', help: 'Refused outright rather than raised as a flag.' }
  }
  return { label: 'Not running', tone: 't-warn', help: 'Declared in the catalogue and evaluated nowhere. Do not rely on it.' }
}

/** How many of a company's checks actually do something. For the one line an
 *  administrator should see before they trust the list. */
export function checkTally(rows: { code: string; on: boolean; live: boolean }[]): {
  total: number; running: number; unbuilt: number; offByChoice: number
} {
  let running = 0
  let unbuilt = 0
  let offByChoice = 0
  for (const r of rows) {
    const state = checkState(r.code, r.live)
    if (state === 'unbuilt') unbuilt++
    else if (!r.on) offByChoice++
    else running++
  }
  return { total: rows.length, running, unbuilt, offByChoice }
}
