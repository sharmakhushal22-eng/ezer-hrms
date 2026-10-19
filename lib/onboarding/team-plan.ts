// lib/onboarding/team-plan.ts — pure. The reporting-line plan for a joiner's team, drawn up at
// code generation (Generate code on the onboarding card, step "Team").
//
// The HR Manager pastes the employee IDs of the people who will report to the joiner. The
// joiner's own managers were set on the review sheet (Assign managers: L1, L2, HOD). The
// chain of everyone under the joiner then shifts one step down:
//
//   a direct report         L1 = the joiner        L2 = the joiner's L1     HOD = the joiner's L2
//   somebody under them     L1 = (unchanged)       L2 = the joiner          HOD = the joiner's L1
//   and so on down the existing L1 tree — each level: L2 = the manager's L1, HOD = the manager's L2.
//
// The joiner has no employee id until the row is written, so the plan carries NEW in its place
// and lib/onboarding/hr-assignment.ts substitutes the real id when it applies the plan.

export type Level = 'L1' | 'L2' | 'HOD'
export interface Chain { l1: string | null; l2: string | null; hod: string | null }
export interface TeamPerson extends Chain {
  id: string; emp_code: string; full_name: string; designation?: string | null; department?: string | null
}
export interface PlannedMember {
  id: string; emp_code: string; full_name: string; designation: string | null; department: string | null
  /** 1 = reports to the joiner directly, 2 = reports to a direct report, … */
  level: number
  /** The member they report to (null for a direct report — that is the joiner). */
  via: string | null
  before: Chain
  after: Chain
  changed: Level[]
}
export interface TeamPlan {
  members: PlannedMember[]
  /** Pasted ids / codes that matched nobody, or direct reports who cannot be in the team (the joiner's own managers). Blocks the plan. */
  problems: string[]
  /** Somebody deeper in the tree who is the joiner's own manager — a loop in today's data. Skipped with their branch; the plan goes ahead. */
  warnings: string[]
}

/** Stands for the joiner until their employee row exists. */
export const NEW = '__joiner__'
const MAX_DEPTH = 6

/** What somebody who reports to `manager` gets: L1 is the manager, L2 the manager's L1, HOD the manager's L2 (their HOD when they have no L2). */
export function chainUnder(managerId: string, manager: Chain): Chain {
  return { l1: managerId, l2: manager.l1, hod: manager.l2 || manager.hod || null }
}

const diff = (before: Chain, after: Chain): Level[] => {
  const out: Level[] = []
  if ((before.l1 || null) !== (after.l1 || null)) out.push('L1')
  if ((before.l2 || null) !== (after.l2 || null)) out.push('L2')
  if ((before.hod || null) !== (after.hod || null)) out.push('HOD')
  return out
}

/**
 * The plan. `joiner` is the joiner's own chain (from Assign managers); `directIds` the people
 * HR pasted; `people` everybody in the company with their current chain; `reportsOf` the
 * current direct (L1) reports of an employee. `exclude` are members HR unticked — left as they
 * are, and the tree is not followed below them.
 */
export function planTeam(joiner: Chain, directIds: string[], people: Map<string, TeamPerson>, reportsOf: (managerId: string) => string[], o: { exclude?: Iterable<string>; maxDepth?: number } = {}): TeamPlan {
  const exclude = new Set(o.exclude || [])
  const maxDepth = o.maxDepth ?? MAX_DEPTH
  const members: PlannedMember[] = []
  const problems: string[] = [], warnings: string[] = []
  const managers = new Set([joiner.l1, joiner.l2, joiner.hod].filter((x): x is string => !!x))
  const direct = [...new Set(directIds.filter(Boolean))]
  const directSet = new Set(direct)
  const seen = new Set<string>()

  const place = (id: string, level: number, via: string | null, managerChain: Chain, managerId: string) => {
    const p = people.get(id)
    if (!p) { problems.push(`${id} was not found in this company`); return }
    if (managers.has(id)) {
      // A direct report cannot be the joiner's own manager. Deeper down it is a loop in today's
      // data (the manager's chain leads back under the joiner): that branch is left alone.
      if (level === 1) problems.push(`${p.full_name} (${p.emp_code}) is the joiner's own manager and cannot report to them`)
      else warnings.push(`${p.full_name} (${p.emp_code}) is the joiner's own manager but sits under ${people.get(via || '')?.full_name || 'the team'} today — left as they are, with the people under them`)
      return
    }
    if (seen.has(id)) return
    seen.add(id)
    if (exclude.has(id)) return
    const before: Chain = { l1: p.l1 || null, l2: p.l2 || null, hod: p.hod || null }
    const after = chainUnder(managerId, managerChain)
    members.push({ id, emp_code: p.emp_code, full_name: p.full_name, designation: p.designation ?? null, department: p.department ?? null, level, via, before, after, changed: diff(before, after) })
    if (level >= maxDepth) return
    for (const r of reportsOf(id)) if (!directSet.has(r) && !seen.has(r) && r !== id) place(r, level + 1, id, after, id)
  }
  for (const id of direct) place(id, 1, null, joiner, NEW)
  return { members, problems, warnings }
}

/** The plan with the joiner's real employee id in place of NEW. */
export function withJoinerId(plan: PlannedMember[], employeeId: string): PlannedMember[] {
  const sub = (v: string | null) => (v === NEW ? employeeId : v)
  return plan.map(m => ({ ...m, via: m.via, after: { l1: sub(m.after.l1), l2: sub(m.after.l2), hod: sub(m.after.hod) } }))
}

/** "2 direct reports and 3 people under them · 11 reporting-line changes" */
export function summarisePlan(members: PlannedMember[]): string {
  if (!members.length) return 'Nobody reports to them yet'
  const direct = members.filter(m => m.level === 1).length
  const deeper = members.length - direct
  const changes = members.reduce((n, m) => n + m.changed.length, 0)
  return `${direct} direct report${direct === 1 ? '' : 's'}${deeper ? ` and ${deeper} ${deeper === 1 ? 'person' : 'people'} under them` : ''} · ${changes} reporting-line change${changes === 1 ? '' : 's'}`
}

/** The ESS roles the team itself decides — never ticked by hand on the Generate code wizard:
 *  somebody with direct reports is an L1 manager; with people under those, an L2 manager too;
 *  three levels down, the HOD as well. */
export const MANAGER_ROLE_CODES = ['L1_MANAGER', 'L2_MANAGER', 'HOD'] as const
export function autoRoleCodes(members: Pick<PlannedMember, 'level'>[]): string[] {
  const depth = members.reduce((d, m) => Math.max(d, m.level), 0)
  return MANAGER_ROLE_CODES.filter((_, i) => depth >= i + 1)
}

/** Pasted text → the ids / codes in it: commas, spaces, new lines, semicolons all separate. */
export function parseCodes(text: string): string[] {
  return [...new Set(String(text || '').split(/[\s,;|]+/).map(s => s.trim().toUpperCase()).filter(Boolean))]
}
