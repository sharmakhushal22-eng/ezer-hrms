// lib/te/flag-review.ts — resolving a flag. Screens a4, a4b.
//
// A check fires and becomes a flag on a claim. Somebody then has to say what
// it means: either the thing it found is real (confirm) or it is not (dismiss).
// Until that happens the claim carries an open flag and the risk band stays
// where the checks put it.
//
// WHO. Only Finance resolves a flag. A manager approving a trip sees flags as
// context for the money, but a manager dismissing the check that guards the
// money would defeat the point of having it. The stage decides, not a role
// name — the server already tells us which stage the claim is at.
//
// WHY A DISMISSAL MUST SAY WHY. The flag report counts dismissals per check,
// and treats a check dismissed almost every time as noise worth turning off.
// A dismissal with no reason is indistinguishable from a check that should
// never have fired, so the two cannot be told apart later unless the reason
// is captured now. Confirming needs no note: the flag already says what it
// found, and confirming only agrees with it.
export type FlagVerdict = 'dismissed' | 'confirmed'

export interface FlagOffer {
  verdict: FlagVerdict
  label: string
  /** The consequence, said before the click. */
  effect: string
  /** true = styled as the destructive choice. */
  grave: boolean
}

const DISMISS: FlagOffer = {
  verdict: 'dismissed',
  label: 'Dismiss',
  effect: 'The check was wrong about this claim. The flag stops counting against it, and your reason is kept on the flag.',
  grave: false,
}
const CONFIRM: FlagOffer = {
  verdict: 'confirmed',
  label: 'Confirm',
  effect: 'The check was right. The flag stays on the claim and counts towards its risk.',
  grave: true,
}

/** Is this flag still waiting on somebody? Anything that is not open has been
 *  answered, including statuses this build has not seen. */
export const isFlagOpen = (status: string): boolean => status === 'open'

/** How many of these still need an answer. */
export const openFlags = (flags: { status: string }[]): number =>
  flags.filter(f => isFlagOpen(f.status)).length

/**
 * What may be done to one flag, here, now.
 *
 * Empty means "show it, offer nothing": a flag already resolved, a claim at a
 * manager's stage, or a viewer who may not act at all.
 */
export function flagOffers(status: string, stage: 'manager' | 'finance' | null, mayAct: boolean): FlagOffer[] {
  if (!mayAct || stage !== 'finance' || !isFlagOpen(status)) return []
  return [DISMISS, CONFIRM]
}

/** Must the person say why? Only for a dismissal — see the header. */
export const flagNoteRequired = (verdict: FlagVerdict): boolean => verdict === 'dismissed'

/** Why a resolve cannot be sent yet, or '' when it can. */
export function whyFlagNotReady(verdict: FlagVerdict, note: string): string {
  if (flagNoteRequired(verdict) && !note.trim()) {
    return 'Say why the check was wrong. The flag report counts dismissals, and one with no reason cannot be told from a check that should be switched off.'
  }
  return ''
}

/** What a resolved flag reads as (screen a4b). */
export function flagResolvedText(status: string, note: string): string {
  const said = note.trim()
  if (status === 'dismissed') return said ? `Dismissed: ${said}` : 'Dismissed.'
  if (status === 'confirmed') return said ? `Confirmed: ${said}` : 'Confirmed.'
  return said
}

/** The chip tone for a flag, by what has happened to it rather than by how bad
 *  it looked when it fired: a dismissed critical flag is no longer critical. */
export function flagTone(status: string, blocking: boolean): string {
  if (status === 'dismissed') return 'plain'
  if (status === 'confirmed') return 't-crit'
  return blocking ? 't-crit' : 't-warn'
}
