// lib/rms/hierarchy.ts — who reports to whom.
//
// Pure. Everything here works on plain objects, so the chain-walking and the cycle check
// can be tested without a database — which matters, because a cycle that reaches the
// database is a query that never returns.
//
// The levels are the ones the organisation actually uses. The org-chart spreadsheet
// carries L1, L2 and HOD; L3 and L4 are declared so a deeper structure needs data, not a
// migration.

export const RELATIONSHIP_TYPES = ['L1', 'L2', 'L3', 'L4', 'HOD'] as const
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number]

/** The order the chain is presented in. HOD sits last: it is the head of the department
 *  rather than the next rung, and is often the same person as L2. */
export const CHAIN_ORDER: RelationshipType[] = ['L1', 'L2', 'L3', 'L4', 'HOD']

export function isRelationshipType(v: string): v is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(v)
}

export interface Relationship {
  employee_id: string
  manager_employee_id: string
  relationship_type: RelationshipType
}

/** Enough of an employee to show in a manager card. */
export interface ManagerRef {
  id: string
  emp_code: string | null
  full_name: string | null
  designation: string | null
  department: string | null
  office_email: string | null
  personal_email: string | null
}

export interface ManagerSlot {
  relationship_type: RelationshipType
  manager: ManagerRef | null
}

/** The management chain for one employee, in display order, with the levels that exist.
 *  A level nobody is mapped to is simply absent rather than present-and-null, so the UI
 *  never has to render an empty card. */
export function buildChain(
  rels: Relationship[],
  managers: Record<string, ManagerRef>,
): ManagerSlot[] {
  const byType = new Map<RelationshipType, string>()
  for (const r of rels) byType.set(r.relationship_type, r.manager_employee_id)
  return CHAIN_ORDER
    .filter(t => byType.has(t))
    .map(t => ({ relationship_type: t, manager: managers[byType.get(t)!] ?? null }))
}

/** Would adding `employee -> manager` on this level close a loop?
 *
 *  Walks upward from the proposed manager along the same relationship type. Returns the
 *  path when it finds its way back to `employee`, otherwise null. A self-assignment
 *  counts as the shortest possible loop.
 *
 *  `edges` maps employee -> manager for the level being checked. */
export function findCycle(
  employeeId: string,
  managerId: string,
  edges: Map<string, string>,
  maxDepth = 64,
): string[] | null {
  if (employeeId === managerId) return [employeeId, managerId]
  const path = [employeeId, managerId]
  const seen = new Set([employeeId, managerId])
  let cur = managerId
  for (let i = 0; i < maxDepth; i++) {
    const next = edges.get(cur)
    if (!next) return null
    path.push(next)
    if (next === employeeId) return path
    if (seen.has(next)) return path            // a loop that does not include us is still a loop
    seen.add(next)
    cur = next
  }
  return path                                   // ran out of depth: treat as suspect
}

/** Everyone who reports to this manager, directly, on a given level. */
export function directReports(rels: Relationship[], managerId: string, type?: RelationshipType): string[] {
  return rels
    .filter(r => r.manager_employee_id === managerId && (!type || r.relationship_type === type))
    .map(r => r.employee_id)
}

/** Everyone beneath this manager, following L1 downward. Breadth-first and cycle-safe:
 *  an employee already seen is not walked again, so bad data cannot hang the caller. */
export function allReports(rels: Relationship[], managerId: string, maxDepth = 32): string[] {
  const children = new Map<string, string[]>()
  for (const r of rels) {
    if (r.relationship_type !== 'L1') continue
    const arr = children.get(r.manager_employee_id) || []
    arr.push(r.employee_id)
    children.set(r.manager_employee_id, arr)
  }
  const out: string[] = []
  const seen = new Set<string>([managerId])
  let frontier = [managerId]
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = []
    for (const m of frontier) {
      for (const c of children.get(m) || []) {
        if (seen.has(c)) continue
        seen.add(c)
        out.push(c)
        next.push(c)
      }
    }
    frontier = next
  }
  return out
}

/** The upward chain along L1, longest first, for "who could this escalate to". Stops at
 *  the top of the chain or the first repeat. */
export function upwardChain(edges: Map<string, string>, employeeId: string, maxDepth = 32): string[] {
  const out: string[] = []
  const seen = new Set([employeeId])
  let cur = employeeId
  for (let i = 0; i < maxDepth; i++) {
    const next = edges.get(cur)
    if (!next || seen.has(next)) break
    out.push(next)
    seen.add(next)
    cur = next
  }
  return out
}
