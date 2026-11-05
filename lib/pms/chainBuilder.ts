// lib/pms/chainBuilder.ts — composing an approval chain, and refusing a bad one.
//
// Requested: the chain should be fully customisable and editable — change the
// KRA and approval chains, build a completely new one, all from the admin side.
//
// ── WHY THE VALIDATION IS HERE AND NOT IN THE ROUTE ──────────────────────
//
// The builder has to refuse the same things the database refuses, before the
// write, in sentences an administrator can act on. "violates check constraint
// pms_chain_known_rungs" is true and useless. So the rules exist twice on
// purpose — ENGINE COMPUTES, SQL DECIDES — and keeping this copy in a lib is
// what lets it be tested against the migration's text rather than guessed at.
//
// ── A RUNG IS A COLUMN, NOT A JOB TITLE ──────────────────────────────────
//
// Every offerable rung has to resolve to a person for a given employee, and
// the only thing that can do that is a relationship column on employees. So
// the menu is exactly those columns. "Finance", "Regional Director", "the
// MD's office" are all reasonable-sounding rungs and none of them can be
// offered, because the database cannot say who they are for employee 4821.
//
// ── COVERAGE IS A WARNING, NOT A REFUSAL ─────────────────────────────────
//
// regional_head_id is populated for 0 of 398 active employees (measured
// 2026-11-05). A chain naming it is not broken — chain.ts steps over a rung
// nobody occupies, which is how RM L2 already works for the 137 people who
// have none — so refusing it would be wrong. But choosing it blind is how
// somebody builds a chain that silently does nothing, so the number goes
// next to the choice, read live rather than written here.

import type { Stage } from './chain.ts'

/** A rung an administrator can actually pick, and what resolves it. */
export interface RungChoice {
  stage: Stage
  label: string
  /** The column on employees that says who this is. */
  column: string
  hint: string
}

/**
 * THE OFFERABLE RUNGS, in the order a chain usually runs.
 *
 * EMPLOYEE and HR are deliberately absent: both are fixed. The self rating
 * always starts a chain and HR always ends it, so offering them as draggable
 * rungs would invite somebody to build a chain with no self rating or no
 * publisher and then wonder why the engine put them back.
 */
export const RUNG_CHOICES: readonly RungChoice[] = [
  // THE COLUMN NAMES ARE l1_manager_id AND l2_manager_id, not rm_l1_id and
  // rm_l2_id. 218's COMMENT said the latter, this file was written from that
  // COMMENT, and the test compared the two — so they agreed and were both
  // wrong, and the coverage read asked for columns that do not exist. Probing
  // the live schema is what found it; 219 corrects the COMMENT and
  // 219_pms_chain_rungs_verify.sql asks information_schema rather than the
  // COMMENT. Two sources agreeing is not evidence when one is a copy.
  { stage: 'RM_L1', label: 'Reporting manager (L1)', column: 'l1_manager_id',
    hint: 'The employee’s direct manager.' },
  { stage: 'RM_L2', label: 'Reporting manager (L2)', column: 'l2_manager_id',
    hint: 'Skipped automatically where L1 and L2 are the same person.' },
  { stage: 'HOD', label: 'Head of department', column: 'hod_id',
    hint: 'Set for everybody, so this rung never skips.' },
  { stage: 'SITE_HR', label: 'Site HR', column: 'site_hr_id',
    hint: 'The HR contact for the employee’s location.' },
  { stage: 'REGIONAL_HEAD', label: 'Regional head', column: 'regional_head_id',
    hint: 'Nobody is assigned one yet, so this rung would skip for everybody.' },
] as const

const OFFERABLE = new Set<string>(RUNG_CHOICES.map(r => r.stage))

/** What 218's CHECK accepts. Wider than the menu: EMPLOYEE and HR are fixed. */
export const STORABLE_RUNGS: readonly string[] = [
  'EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'SITE_HR', 'REGIONAL_HEAD', 'HR',
] as const

export const MAX_CHAIN_NAME = 60

export interface ChainDraft {
  name?: string | null
  rungs?: readonly string[] | null
  notes?: string | null
}

/**
 * Why this chain cannot be saved, or null.
 *
 * Returns ONE fault rather than a list, because the builder shows it against
 * the save button and a wall of simultaneous complaints about a half-built
 * chain is noise. The first thing wrong is the thing to fix.
 */
export function chainFault(d: ChainDraft): string | null {
  const name = (d.name ?? '').trim()
  if (!name) return 'Give the chain a name — it is what you pick on a policy.'
  if (name.length > MAX_CHAIN_NAME) {
    return `That name is ${name.length} characters. Keep it under ${MAX_CHAIN_NAME} `
         + 'so it reads on a policy dropdown.'
  }

  const rungs = (d.rungs ?? []).map(r => String(r).trim().toUpperCase())
  const approvers = rungs.filter(r => r !== 'EMPLOYEE' && r !== 'HR')
  if (!approvers.length) {
    return 'A chain needs at least one approver between the employee and HR. '
         + 'As it stands a submission would go straight to publishing.'
  }

  // This one test covers both menus, because OFFERABLE is exactly
  // STORABLE_RUNGS without the two fixed ends and `approvers` has already
  // dropped those — so a storable rung reaching here is an offerable one. A
  // second check for "storable but not offerable" was unreachable, and
  // mutation testing is what showed it: removing it changed no answer.
  //
  // chain-builder.test.ts asserts that relationship directly, so widening
  // 218's whitelist without extending RUNG_CHOICES fails there rather than
  // quietly making this check load-bearing again.
  const unknown = rungs.find(r => !STORABLE_RUNGS.includes(r))
  if (unknown) {
    return `“${unknown}” is not a rung this system can resolve to a person. `
         + 'A rung has to come from a relationship on the employee record.'
  }

  // A duplicate is REFUSED rather than quietly removed. chain.ts dedupes so
  // nothing breaks either way, but an administrator who put the HOD in twice
  // meant something by it, and a chain that silently disagrees with what they
  // typed is one they will not trust the next time they read it.
  const dup = approvers.find((r, i) => approvers.indexOf(r) !== i)
  if (dup) {
    const label = RUNG_CHOICES.find(c => c.stage === dup)?.label ?? dup
    return `${label} appears twice. One approval each — the chain travels `
         + 'in one direction.'
  }

  // EMPLOYEE is the self rating, which is where a chain starts by definition.
  if (rungs.includes('EMPLOYEE') && rungs[0] !== 'EMPLOYEE') {
    return 'The self rating is where a chain starts, so it cannot sit in the '
         + 'middle of one.'
  }
  // Same for HR, at the other end.
  if (rungs.includes('HR') && rungs[rungs.length - 1] !== 'HR') {
    return 'HR publishes, so HR is the last rung. Everything after it would '
         + 'never be reached.'
  }
  return null
}

/**
 * The rungs as they should be stored: the approvers, in order, with the two
 * fixed ends put back. Only call this once chainFault has returned null.
 */
export function normaliseRungs(rungs: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const approvers = (rungs ?? [])
    .map(r => String(r).trim().toUpperCase())
    .filter(r => r !== 'EMPLOYEE' && r !== 'HR')
    .filter(r => OFFERABLE.has(r) && !seen.has(r) && (seen.add(r), true))
  return ['EMPLOYEE', ...approvers, 'HR']
}

/** How many employees have somebody at each rung. */
export type Coverage = Partial<Record<Stage, { have: number; of: number }>>

/**
 * What an administrator should know before saving, without being stopped.
 *
 * Separate from chainFault because these are different kinds of statement:
 * a fault is "this cannot be saved", a warning is "this will be saved and
 * here is what it will do". Mixing them is how a warning gets dismissed as
 * pedantry or a refusal gets read as advice.
 */
export function chainWarnings(
  rungs: readonly string[] | null | undefined,
  coverage: Coverage | null | undefined,
): string[] {
  const out: string[] = []
  const cov = coverage ?? {}
  for (const r of rungs ?? []) {
    const c = cov[r as Stage]
    if (!c || !c.of) continue
    const label = RUNG_CHOICES.find(x => x.stage === r)?.label ?? r
    if (c.have === 0) {
      out.push(`No employee has a ${label.toLowerCase()} assigned, so this rung `
             + 'will be skipped for everybody until somebody fills it in.')
    } else if (c.have < c.of) {
      const miss = c.of - c.have
      out.push(`${miss} of ${c.of} employees have no ${label.toLowerCase()}. `
             + 'The rung is skipped for them and the chain carries on.')
    }
  }
  return out
}

/** The chain in one line, for a policy row or a confirmation. */
export function chainSummary(rungs: readonly string[] | null | undefined): string {
  const SHORT: Record<string, string> = {
    EMPLOYEE: 'Self', RM_L1: 'L1', RM_L2: 'L2', HOD: 'HOD',
    SITE_HR: 'Site HR', REGIONAL_HEAD: 'Regional', HR: 'HR',
  }
  const r = normaliseRungs(rungs)
  return r.map(s => SHORT[s] ?? s).join(' → ')
}

/**
 * Which policies would change behaviour if this chain did.
 *
 * Shown before an edit and before a deactivation. A chain looks like a
 * standalone object in the builder and is not one: three companies share
 * this database and one chain can be running all of them.
 */
export function usedBy(
  chainId: string,
  policies: readonly { id: string; policy_name?: string | null; chain_id?: string | null }[],
): string[] {
  return policies
    .filter(p => p.chain_id === chainId)
    .map(p => (p.policy_name ?? '').trim() || 'an unnamed policy')
}
