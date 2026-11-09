// lib/pms/tenancy.ts — whose row is this, and may this caller touch it?
//
// ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────
//
// Three organisations share this database. Each runs its own PMS, and their
// policies are all called "Standard Quarterly".
//
// The admin route gated every write on canManage(grant, 'Performance'),
// which is an ACCESS LEVEL — it answers "may this person configure
// Performance" and says nothing whatever about WHOSE. Company scoping is a
// separate thing in this product: companyFilter in lib/rms/resolve.ts,
// whose own comment calls it "the single choke-point that stops '' / 'ALL'
// from leaking other companies".
//
// That choke-point sat on the four INSERT paths and on none of the eleven
// that address an existing row by an id read straight from the request body
// — all of them running through the service-role client, so RLS was not
// behind them either.
//
// The decision itself is four booleans and a list. Leaving it inline in the
// route meant it could only ever be checked by reading the source for the
// shape of an if-statement, which is how the gap got there. Here it is a
// function with a return value, and tenancy.test.ts asks it questions.
//
// ENGINE COMPUTES, SQL DECIDES does not apply to this one, and it is worth
// saying why: there is no SQL behind it. The service-role key bypasses RLS,
// so this IS the decision, not an explanation of one made elsewhere. That is
// the argument for making it testable rather than merely readable.

/** What a caller may do with one row, given who they are and who owns it. */
export type ScopeVerdict =
  /** Theirs, or they reach across companies anyway. */
  | 'ALLOWED'
  /** Owned by no single company. Editing it would change every company. */
  | 'WHOLE_GROUP'
  /** Owned by a company this caller's roles are not valid in. */
  | 'ANOTHER_COMPANY'

export interface ScopeQuestion {
  /** grant.crossCompany — a super admin, or a role scoped ORG. */
  crossCompany: boolean
  /** grant.companyId. Null for the legacy shared login, which has no
   *  employee row and so no company of its own. */
  companyId: string | null | undefined
  /** allowedCompanies(grant, 'Performance') — where these roles are valid. */
  allowed: readonly string[]
  /** The row's company_id. Null means the whole group. */
  owner: string | null | undefined
  /**
   * Whether a group-owned row is acceptable here.
   *
   * This separates EDITING a row from POINTING AT one. A chain with no
   * company belongs to the whole group: changing it changes every company,
   * so that takes group reach. But one company's policy may perfectly well
   * USE it — that is what a group library is for. Editing passes false;
   * referencing passes true.
   */
  groupIsFine?: boolean
}

/**
 * Whether this caller may act on this row.
 *
 * ── THE FIRST TEST IS COPIED FROM companyFilter ON PURPOSE ───────────────
 *
 * `crossCompany || !companyId` is companyFilter's own first branch, word for
 * word. A caller it lets choose any company is a caller this must not stop,
 * or the two disagree and the product acquires a second, contradictory idea
 * of who is scoped. It also happens to be what keeps the legacy shared
 * dashboard login working exactly as it does today: no employee row, no
 * companyId, no narrowing.
 *
 * Everything below that line is the case the route never handled: a role
 * granting Performance = FULL inside ONE company.
 */
export function scopeVerdict(q: ScopeQuestion): ScopeVerdict {
  if (q.crossCompany || !q.companyId) return 'ALLOWED'

  if (q.owner === null || q.owner === undefined) {
    return q.groupIsFine ? 'ALLOWED' : 'WHOLE_GROUP'
  }

  // An empty `allowed` is NOT read as "everything". allowedCompanies falls
  // back to [companyId] and only returns nothing when there is no company at
  // all — which the branch above has already let through. Reaching here with
  // an empty list means the roles are valid nowhere, and nowhere includes
  // this row.
  return q.allowed.includes(q.owner) ? 'ALLOWED' : 'ANOTHER_COMPANY'
}

/**
 * What to tell somebody who was refused.
 *
 * The other company is deliberately not named. A refusal should not double
 * as a way to enumerate what else is on this database — and the person
 * reading it cannot act on the name anyway.
 */
export function scopeRefusal(v: Exclude<ScopeVerdict, 'ALLOWED'>): string {
  return v === 'WHOLE_GROUP'
    ? 'This belongs to the whole group rather than to one company, so '
    + 'changing it would change it everywhere. Only a role that spans every '
    + 'company can do that.'
    : 'That belongs to another company. Your Performance role is not valid '
    + 'there.'
}
