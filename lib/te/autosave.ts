// lib/te/autosave.ts — the decisions behind "your work is saved".
//
// The server stores a draft verbatim and asks no questions, which is what makes
// drafts useful. That puts every judgement on this side, and there are only
// three worth making. They live here, away from React, because each one is a
// rule with a wrong answer that users would notice:
//
//   worth saving?   Opening the planner, looking at it and closing it must not
//                   leave a draft behind. A Drafts list that fills up with
//                   things nobody typed is worse than no list, because then the
//                   real half-finished trip is buried among the noise. The test
//                   is exact rather than clever: is this form still identical to
//                   the one that was opened?
//
//   changed?        Autosave runs on a timer. Writing the same bytes again on
//                   every tick is a pointless round trip, and it moves the
//                   draft up a list ordered by updated_at, so an untouched form
//                   left open in a tab would quietly outrank real work.
//
//   what to call it The list has to be readable before anything is opened. A
//                   draft gets the best name the form can give at the moment it
//                   is saved, and is allowed to have none at all — a trip
//                   abandoned on its first screen genuinely has no name yet,
//                   and saying so is better than inventing "Untitled (3)".
//
// LAST WRITE WINS, on purpose. Two tabs editing one draft is a personal
// scratchpad racing itself; the cost of being wrong is one re-typed field, and
// a locking scheme would cost far more than that in complexity and in refusals
// the person cannot act on.
import type { TeDraftKind } from './types'

/**
 * JSON with object keys in a fixed order, so two forms that hold the same
 * values compare equal however they were built. JSON.stringify alone does not:
 * `{a:1,b:2}` and `{b:2,a:1}` are the same form and different strings, and
 * spreading state in React reorders keys all the time.
 *
 * undefined is dropped, as JSON.stringify drops it, so a key that is absent and
 * a key explicitly set to undefined are the same form — which is what the
 * planner means when it clears an optional field.
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o).filter(k => o[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

/** Whether two form states are the same work, ignoring key order. */
export function sameBody(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

/**
 * Has this form been touched since it was opened?
 *
 * `pristine` is the state the form was built with — a new trip's defaults, or
 * the saved trip being edited. Comparing against it is exact: no list of
 * "fields that count", nothing to keep in step as forms gain fields, and no
 * way for a new field to quietly start creating empty drafts.
 */
export function worthSaving(current: unknown, pristine: unknown): boolean {
  return !sameBody(current, pristine)
}

/** Rupees as the list shows them: whole, grouped, no decimals on a round sum. */
function money(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

/** A number the person typed, which may still be '' or nonsense. */
function typedNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * What to call a draft in the list. null means "this form cannot say yet",
 * and the list is expected to show its own wording for that rather than a
 * placeholder pretending to be a name.
 *
 * `label` turns a category code into its name, because an expense draft's best
 * title is usually its category and the codes ('air', 'hotel') are not words
 * anybody chose to read.
 */
export function draftTitle(kind: TeDraftKind, body: unknown, label?: (code: string) => string): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  if (kind === 'trip') {
    // The planner generates a name from the route as soon as it knows one, so
    // this is usually filled in well before the trip is finishable.
    const name = text(b.name)
    if (name) return name
    const purpose = text(b.purpose)
    return purpose ? `${purpose} trip` : null
  }
  if (kind === 'expense') {
    const f = (b.f ?? {}) as Record<string, unknown>
    const cat = text(f.cat)
    const named = cat ? (label?.(cat) || cat) : ''
    const amount = typedNumber(f.claimed) ?? typedNumber(f.bill)
    const merchant = text(f.merchant)
    const head = named || merchant
    if (head && amount !== null) return `${head} · ${money(amount)}`
    if (head) return head
    return amount !== null ? money(amount) : null
  }
  // A claim draft is a reply somebody is composing. The first line of it is the
  // only thing that distinguishes one from another.
  const t = text(b.text)
  if (!t) return null
  const firstLine = t.split('\n')[0]
  // 60 characters all in, ellipsis included, so every row is the same width.
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine
}

/**
 * How a saved-at time reads next to the form: "Saved just now", then the time.
 * Kept here so the planner and the expense form say it the same way.
 */
export function savedAgo(savedAt: number, now: number): string {
  const secs = Math.max(0, Math.round((now - savedAt) / 1000))
  if (secs < 45) return 'Saved just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `Saved ${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  return `Saved ${hours} hour${hours === 1 ? '' : 's'} ago`
}
