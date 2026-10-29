// lib/te/other-reason.ts — "Other" is not a reason.
//
// THE PROBLEM THIS SOLVES. Every "why" on a trip offers a list and ends with
// Other: why you are travelling, why GPS was not used, why there was no prior
// approval, why a journey was not recorded. Picking Other and moving on leaves
// the approver a single word to decide on, and the one case that most needed
// explaining is the one that arrives with none.
//
// SO THE BOX APPEARS THE MOMENT OTHER IS PICKED, and it is required. Not a
// placeholder on a permanently visible optional field saying "Needed for
// Other" — which is what three of these screens did, and which is read by
// nobody who has already picked one of the listed reasons.
//
// WHY A MINIMUM LENGTH AND NOT JUST "NOT EMPTY". A required field that accepts
// "." is a required field in name only. Ten characters is low enough to never
// obstruct somebody with something real to say and high enough to stop "na",
// "-", "other" and "personal". It is a floor on effort, not a judgement of the
// answer.
//
// WHERE THE NOTE GOES. te_trips.purpose is free text — the database only
// checks it is not blank — so an explained Other is stored as
// "Other — <what they wrote>" in that one column. The approver then reads the
// real reason everywhere purpose is already shown, and no new column has to be
// threaded through te_trip_save, te_trip_json, te_legs and four screens. This
// is the same fold TeLegMissed already does for a skipped journey.
//
// THE RULE IS ALSO IN SQL. Migration 163 refuses a bare Other, because a rule
// that only exists in the browser is not a rule. This file is what the form
// uses to say so before the round trip.

/** The option that always needs explaining. */
export const OTHER = 'Other'

/** How much writing counts as an explanation. */
export const MIN_WHY = 10

/** The separator between the choice and its explanation, once folded. Spaced
 *  en dash: it reads as a sentence and does not collide with a plain hyphen
 *  somebody types inside their own reason. */
const JOIN = ' — '

/** Did they pick Other? Tolerant of case and of an already-folded value, so
 *  this is safe to call on a draft and on something read back from the
 *  database. */
export function isOther(choice: string | null | undefined): boolean {
  const v = (choice ?? '').trim().toLowerCase()
  return v === 'other' || v.startsWith('other' + JOIN.toLowerCase()) || v.startsWith('other —') || v.startsWith('other -')
}

/** Why this explanation is not good enough yet, or '' when it is. Returns ''
 *  for any choice that is not Other: those explain themselves. */
export function whyProblem(choice: string | null | undefined, note: string | null | undefined): string {
  if (!isOther(choice)) return ''
  const n = (note ?? '').trim()
  if (!n) return 'Say in your own words why. “Other” on its own does not tell your approver anything.'
  if (n.length < MIN_WHY) return `That is too short to be a reason. Write at least ${MIN_WHY} characters.`
  // Restating the word is not explaining it — including "other other" and
  // "OTHER!!!", which a bare equality check would let through. Strip every
  // occurrence of the word and every non-letter; if nothing is left, nothing
  // was said. A real reason that happens to contain it ("Another supplier
  // meeting") keeps plenty of letters and passes.
  if (!n.toLowerCase().replace(/other/g, '').replace(/[^a-z]/g, '')) {
    return 'Write what the reason actually was, not the word “Other”.'
  }
  return ''
}

/** true when the form should be showing the box. */
export function needsExplanation(choice: string | null | undefined): boolean {
  return isOther(choice)
}

/** The one string to store. A listed reason is itself; an explained Other
 *  carries its explanation. */
export function foldOther(choice: string, note: string | null | undefined): string {
  if (!isOther(choice)) return choice
  const n = (note ?? '').trim()
  return n ? `${OTHER}${JOIN}${n}` : OTHER
}

/** The inverse, for reopening something already saved. A value that was never
 *  folded comes back as itself with no note, so this is safe on any input. */
export function splitOther(stored: string | null | undefined): { choice: string; note: string } {
  const v = (stored ?? '').trim()
  if (!v) return { choice: '', note: '' }
  // [\s\S] rather than the s flag: a note may be typed across lines, and the
  // dotAll flag needs an es2018 target this project does not set.
  const m = v.match(/^other\s*(?:—|-)\s*([\s\S]+)$/i)
  if (m) return { choice: OTHER, note: m[1].trim() }
  // A bare "other" in any casing normalises to the option as the list spells
  // it, or the picker would show nothing selected.
  if (v.toLowerCase() === 'other') return { choice: OTHER, note: '' }
  return { choice: v, note: '' }
}

/** What to call the box, given what it is explaining. The wording is the
 *  screen's only chance to say what a useful answer looks like. */
export function whyLabel(what: 'purpose' | 'gps' | 'approval' | 'journey'): { label: string; hint: string } {
  if (what === 'purpose') {
    return {
      label: 'Why are you travelling?',
      hint: 'In your own words. Your approver sees this instead of the word “Other”.',
    }
  }
  if (what === 'gps') {
    return { label: 'What happened?', hint: 'Why the journey could not be tracked on the day.' }
  }
  if (what === 'approval') {
    return { label: 'Why was there no prior approval?', hint: 'What made it impossible to ask first.' }
  }
  return { label: 'Why was this journey not recorded?', hint: 'What happened on the day.' }
}
