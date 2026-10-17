// lib/te/desks.ts — who is on which desk, and which branches that leaves
// covered. Pure: no fetching, no React.
//
// THE LADDER IS DEFINED IN SQL, in te_desk_members (migration 161). It is
// mirrored here for ONE purpose: so the admin screen can show an administrator
// what their configuration actually resolves to, per branch, before they save
// it. "Ludhiana Factory is served by the company desk, not its own" is the
// sentence that stops somebody leaving a branch uncovered by accident.
//
// THE MIRROR IS A RISK AND IS WORTH NAMING. Two copies of one policy can
// drift. The SQL is the authority — it decides who may actually act — and this
// file only ever describes. If the two disagree the screen is wrong and the
// system is right, which is the safe way round. `coverage` is tested against
// the same cases the SQL comment documents, so a change to one that is not
// made to the other should fail a test rather than ship.
import type { Uuid } from './types.ts'

export type DeskKind = 'finance' | 'travel'
export const DESK_KINDS: DeskKind[] = ['finance', 'travel']

/** What each desk is called, and what the right it grants is called. */
export const DESK_NAME: Record<DeskKind, { label: string; right: string; table: string }> = {
  finance: { label: 'Finance desk', right: 'can_approve', table: 'finance_team' },
  travel: { label: 'Travel desk', right: 'can_book', table: 'travel_desk' },
}

/** One row of a desk, as the admin screen holds it. */
export interface DeskMember {
  id?: Uuid
  companyId: Uuid
  /** null = every branch of that company. */
  locationId: Uuid | null
  employeeId: Uuid
  /** can_approve for Finance, can_book for Travel. */
  active: boolean
  able: boolean
  groupScope: boolean
  /** Finance only. null = no ceiling. */
  limit?: number | null
  /** Finance only. */
  disburse?: boolean
}

/** How a row's reach reads on screen. */
export function scopeLabel(m: Pick<DeskMember, 'locationId' | 'groupScope'>, branchName?: string | null): string {
  if (m.groupScope) return 'Every company in the group'
  if (m.locationId === null) return 'Every branch of this company'
  return branchName || 'One branch'
}

/** Which ladder step answers for a branch, and who. Mirrors te_desk_members.
 *  `members` may hold every company's rows; only this company's are read. */
export function coverage(
  members: DeskMember[],
  companyId: Uuid,
  locationId: Uuid,
  /** Every company id that shares this company's group, this one included. */
  groupCompanies: Uuid[] = [companyId],
): { via: 'branch' | 'company' | 'group' | 'nobody'; who: Uuid[] } {
  const usable = (m: DeskMember) => m.active && m.able
  // 1. the branch — a row with no location answers for every branch, so it
  //    counts here rather than falling through to step 2.
  const branch = members.filter(m => usable(m) && m.companyId === companyId && (m.locationId === locationId || m.locationId === null))
  if (branch.length) return { via: 'branch', who: branch.map(m => m.employeeId) }
  // 2. the company, whatever branch
  const company = members.filter(m => usable(m) && m.companyId === companyId)
  if (company.length) return { via: 'company', who: company.map(m => m.employeeId) }
  // 3. the group
  const group = members.filter(m => usable(m) && m.groupScope && groupCompanies.includes(m.companyId))
  if (group.length) return { via: 'group', who: group.map(m => m.employeeId) }
  return { via: 'nobody', who: [] }
}

/** The sentence under a branch on the admin screen. Says plainly when a branch
 *  is not served by its own people, because that is the thing an administrator
 *  is on this screen to find. */
export function coverageNote(c: ReturnType<typeof coverage>, branchName: string): string {
  const n = c.who.length
  if (c.via === 'branch') return `${n} ${n === 1 ? 'person' : 'people'} at ${branchName}.`
  if (c.via === 'company') return `Nobody at ${branchName} — falls back to ${n} ${n === 1 ? 'person' : 'people'} elsewhere in the company.`
  if (c.via === 'group') return `Nobody in this company — falls back to ${n} group-wide ${n === 1 ? 'member' : 'members'}.`
  return `Nobody answers for ${branchName}. Requests raised here cannot be processed.`
}

/** True when a branch is served by somebody other than its own people, which
 *  the screen flags without calling it an error — a fallback is a design, not
 *  a fault, until it is nobody. */
export function isFallback(c: ReturnType<typeof coverage>): boolean {
  return c.via === 'company' || c.via === 'group'
}

/** Why this row cannot be saved, or '' when it can. Mirrors the constraints in
 *  migration 161 so the screen refuses before the database has to. */
export function deskRowProblem(m: DeskMember, kind: DeskKind): string {
  if (!m.companyId) return 'Choose a company.'
  if (!m.employeeId) return 'Choose a person.'
  if (m.groupScope && m.locationId !== null) {
    // A person who answers for other companies is not answering for one
    // branch of one of them. The ladder reads group scope at step 3, where
    // branches no longer apply.
    return 'Somebody who answers for the whole group cannot also be tied to one branch.'
  }
  if (kind === 'finance' && m.limit != null) {
    if (!Number.isFinite(m.limit) || m.limit < 0) return 'An approval limit cannot be negative.'
    if (m.limit === 0) return 'A limit of zero would stop them approving anything. Switch off their approval right instead.'
  }
  return ''
}

/** Two rows are the same desk seat. Matches the unique index in 161, which
 *  treats a null branch as a real value rather than as "no conflict". */
export function sameSeat(a: DeskMember, b: DeskMember): boolean {
  return a.companyId === b.companyId && a.employeeId === b.employeeId && (a.locationId ?? null) === (b.locationId ?? null)
}

/** What switching this person off would leave behind. Called before a save so
 *  the screen can warn rather than let somebody empty a desk by accident. */
export function removalWarning(
  members: DeskMember[],
  removing: DeskMember,
  companyId: Uuid,
  locations: { id: Uuid; name: string }[],
  groupCompanies: Uuid[] = [companyId],
): string {
  const after = members.map(m => (sameSeat(m, removing) ? { ...m, active: false } : m))
  const lost = locations.filter(l => {
    const before = coverage(members, companyId, l.id, groupCompanies)
    const now = coverage(after, companyId, l.id, groupCompanies)
    return before.via !== now.via
  })
  if (!lost.length) return ''
  const dead = lost.filter(l => coverage(after, companyId, l.id, groupCompanies).via === 'nobody')
  if (dead.length) return `This would leave ${dead.map(l => l.name).join(', ')} with nobody at all.`
  return `${lost.map(l => l.name).join(', ')} would fall back to another branch.`
}
