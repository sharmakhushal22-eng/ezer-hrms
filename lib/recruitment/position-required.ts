// lib/recruitment/position-required.ts — pure. Designation, department and work location are
// what the offer letter states ("the position of X … in the Y department, based at Z") and what
// onboarding, the statutory forms and the employee record carry. The letter used to drop a
// blank one silently, so an offer could go out without them. Required from the MRF to onboarding:
// the MRF forms, the offer file (verify + send) and the onboarding link all use this one check.

export interface Position { designation?: unknown; department?: unknown; location?: unknown }

const LABEL: Record<keyof Position, string> = { designation: 'Designation', department: 'Department', location: 'Work location' }
const blank = (v: unknown) => v == null || String(v).trim() === '' || String(v).trim() === '—'

/** The labels of what is missing, in letter order (empty = all present). */
export function positionGaps(p: Position): string[] {
  return (Object.keys(LABEL) as (keyof Position)[]).filter(k => blank(p[k])).map(k => LABEL[k])
}

/** One sentence for a refusal, or null when nothing is missing. */
export function positionMessage(p: Position, where: string): string | null {
  const g = positionGaps(p)
  if (!g.length) return null
  const list = g.length === 1 ? g[0] : `${g.slice(0, -1).join(', ')} and ${g[g.length - 1]}`
  return `${list} ${g.length === 1 ? 'is' : 'are'} required ${where}.`
}
