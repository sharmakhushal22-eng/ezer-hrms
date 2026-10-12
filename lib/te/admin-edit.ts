// lib/te/admin-edit.ts — editing the policy, safely.
//
// Admin screens change what EVERYONE is paid from now on. That makes two
// things worth doing carefully, and both live here rather than in the forms:
//
//   1. Knowing whether anything actually changed, so a screen can warn before
//      navigating away and can refuse to send an empty save.
//   2. Validating an approval chain before it is saved. A broken chain is not
//      discovered by the admin who saved it — it is discovered by the first
//      employee whose claim goes nowhere, or worse, to nobody.
//
// What is NOT here: whether a rate or a limit is sensible. That is the
// company's business. The screens say what a change affects; they do not
// second-guess the number.
import type { TeWorkflowLevel, TeWorkflowCondition } from './types.ts'

/** Did anything change? A deep compare over plain JSON, which is all these
 *  config rows ever are. */
export function isDirty<T>(original: T, draft: T): boolean {
  return JSON.stringify(original) !== JSON.stringify(draft)
}

/** The rows that differ, for a save that should send only what moved. */
export function changedRows<T extends { id?: string; c?: string }>(original: T[], draft: T[]): T[] {
  const before = new Map(original.map(r => [keyOf(r), JSON.stringify(r)]))
  return draft.filter(r => before.get(keyOf(r)) !== JSON.stringify(r))
}

const keyOf = (r: { id?: string; c?: string }) => r.id ?? r.c ?? ''

// ── the approval chain ──────────────────────────────────────────────────────

export const WHO_LABEL: Record<TeWorkflowLevel['who'], string> = {
  rm: 'Their reporting manager',
  rm2: 'Their manager’s manager',
  hod: 'The head of department',
  person: 'A named person',
  finance: 'The Finance team',
}

export const CONDITION_LABEL: Record<TeWorkflowCondition['t'], string> = {
  amount: 'Only above an amount',
  scope: 'Only for one kind of trip',
  postFacto: 'Only when it was not approved beforehand',
  exception: 'Only when it breaks a policy limit',
  risk: 'Only at or above a risk band',
}

export interface ChainProblem {
  /** The level it is about, or -1 for the chain as a whole. */
  at: number
  text: string
  /** false when it is worth saying but does not stop a save. */
  blocks: boolean
}

/**
 * What is wrong with this chain.
 *
 * The rules are about what happens to a real claim travelling through it, not
 * about tidiness:
 *   · a chain with no levels approves nothing, so everything would sit for ever
 *   · a level naming nobody cannot be resolved to a person, and the claim stops
 *   · the same approver twice is a formality, not a control
 *   · a Finance level before an approval level inverts the order the money is
 *     checked in: Finance verifies what a manager has already agreed to
 */
export function chainProblems(levels: TeWorkflowLevel[]): ChainProblem[] {
  const out: ChainProblem[] = []
  if (!levels.length) {
    return [{ at: -1, blocks: true, text: 'A chain with no levels would leave every claim waiting for nobody.' }]
  }

  levels.forEach((l, i) => {
    if (!l.label.trim()) out.push({ at: i, blocks: true, text: 'Give the level a name. The employee sees it on their claim.' })
    if (l.who === 'person' && !l.person) {
      out.push({ at: i, blocks: true, text: 'Choose the person. A level naming nobody stops the claim here.' })
    }
    for (const c of l.when) {
      if (c.t === 'amount' && !(Number(c.v) > 0)) {
        out.push({ at: i, blocks: true, text: 'Set the amount this level applies above.' })
      }
      if ((c.t === 'scope' || c.t === 'risk') && !c.v) {
        out.push({ at: i, blocks: true, text: `Choose which ${c.t === 'scope' ? 'kind of trip' : 'risk band'} this level applies to.` })
      }
    }
  })

  // The same person twice adds a step without adding a check.
  const named = levels.map((l, i) => ({ i, key: l.who === 'person' ? `person:${l.person}` : l.who })).filter(x => x.key !== 'person:')
  named.forEach((x, n) => {
    const first = named.findIndex(y => y.key === x.key)
    if (first < n) {
      out.push({ at: x.i, blocks: false, text: 'The same approver is already on an earlier level. The second one adds a step but not a check.' })
    }
  })

  // Finance checks what a manager has already agreed to, so it comes after.
  const lastApprove = levels.map(l => l.kind).lastIndexOf('approve')
  const firstFinance = levels.map(l => l.kind).indexOf('finance')
  if (firstFinance !== -1 && lastApprove !== -1 && firstFinance < lastApprove) {
    out.push({ at: firstFinance, blocks: true, text: 'Finance verifies what a manager has agreed to, so a Finance level cannot come before an approval level.' })
  }

  return out
}

/** Can this chain be saved? */
export function chainBlocked(levels: TeWorkflowLevel[]): boolean {
  return chainProblems(levels).some(p => p.blocks)
}

/** A new level, ready to edit. */
export function newLevel(kind: 'approve' | 'finance'): TeWorkflowLevel {
  return {
    kind,
    label: kind === 'finance' ? 'Finance check' : 'Approval',
    who: kind === 'finance' ? 'finance' : 'rm',
    person: '',
    when: [],
  }
}

/** Said next to Save, so an admin knows the blast radius before they commit.
 *  Policy is frozen onto a trip when it is approved, so past trips are safe —
 *  which is the part people assume wrongly in both directions. */
export function whatChangingAffects(area: 'rates' | 'limits' | 'checks' | 'categories' | 'gps' | 'workflow'): string {
  const common = 'Trips already approved keep the policy they were approved under.'
  switch (area) {
    case 'rates': return `New claims are paid at the new rate from now on. ${common}`
    case 'limits': return `New claims are measured against the new limits from now on. ${common}`
    case 'checks': return 'Applies to claims checked from now on. Flags already raised stay as they are.'
    case 'categories': return 'Applies to lines added from now on. Lines already saved keep their category.'
    case 'gps': return `Applies to legs started from now on. ${common}`
    case 'workflow': return 'Applies to claims and trips submitted from now on. Anything already in an approval chain keeps the chain it started in.'
  }
}
