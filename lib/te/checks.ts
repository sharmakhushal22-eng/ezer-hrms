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
  'E4', 'G6',
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
  E4: 'Needs a GSTIN status provider. None is configured, so there is nothing to ask.',
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

// ── F2 and F3: the words for a report about approvers ───────────────────────
//
// NEITHER IS AN ACCUSATION, and the wording has to carry that. Both have
// ordinary explanations — a small team with one approver, a manager who reads
// the flags on their phone before the claim reaches their desk — and a report
// that reads like a charge sheet gets argued with instead of acted on. These
// say what happened, with the numbers, and leave the question to a person.

/** How long a decision took, in words a person reads rather than seconds. */
export function tookText(secs: number): string {
  if (secs < 1) return 'under a second'
  if (secs < 60) return `${Math.round(secs)} seconds`
  if (secs < 3600) {
    const m = Math.round(secs / 60)
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`
  }
  if (secs < 86400) {
    const h = Math.round(secs / 3600)
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  const d = Math.round(secs / 86400)
  return `${d} ${d === 1 ? 'day' : 'days'}`
}

/** The line under one F2 row. */
export function fastApproverText(r: { flagged: number; fast: number; fastestSecs: number; medianSecs: number }, seconds: number): string {
  return `${r.fast} of ${r.flagged} flagged ${r.flagged === 1 ? 'claim' : 'claims'} decided within ${seconds} seconds.`
    + ` Fastest ${tookText(r.fastestSecs)}, typically ${tookText(r.medianSecs)}.`
}

/** The line under one F3 row. `pairs of theirTotal` is the whole point: a
 *  share, not a count. */
export function pairedApproverText(r: { pairs: number; theirTotal: number; pct: number; employeeName: string }): string {
  return `${r.pairs} of ${r.employeeName}'s ${r.theirTotal} flagged claims in this window, ${r.pct}%.`
}

/** What to say when a report found nothing — which is the usual and the good
 *  answer, and should not read like the report is broken. */
export function approverWatchEmpty(kind: 'f2' | 'f3', seconds: number, pct: number): string {
  return kind === 'f2'
    ? `Nobody has been clearing flagged claims inside ${seconds} seconds.`
    : `No approver is taking more than ${pct}% of one person's flagged claims.`
}
