// lib/rms/authz.ts — server-side authorization for API routes, in one place.
//
// Three questions every route that touches somebody else's data has to answer, in order:
//
//   1. Who is calling?            requireGrant()  — 401 when nobody is signed in
//   2. May they use this module?  requireAccess() — 403 below the needed level
//   3. On this company's records? requireCompany() — 403 outside the companies their roles cover
//
// The browser-side helpers in lib/rms/resolve (hasLevel, canSee, canEdit, canManage) open up
// when rms_config.enforce_module_access is off, because they decide what the SIDEBAR shows
// and a half-seeded role table must not hide the dashboard on roll-out morning. That is the
// wrong default for an API gate: a route that waves everyone through while a flag is off is
// not a gate. Everything here ignores `enforced` and asks what the roles actually grant —
// the same stance lib/lms/caps.ts and lib/idcard/authz.ts already take on their own.
//
// `actorId()` is the only acceptable source for "who did this" on a write. A body field
// named approver_id / actioned_by / performed_by is the caller's claim, not a fact.
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, rmsServiceClient as sbAdmin } from '@/lib/rms/server'
import { allowedCompanies, type Grant } from '@/lib/rms/resolve'
import { atLeast, type AccessLevel, type Module } from '@/lib/rms/modules'

export type Gate =
  | { grant: Grant; error: null }
  | { grant: null; error: NextResponse }

export const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status })

/** Signed in at all? An ESS session resolves to an employee; the legacy dashboard login to
 *  `legacy`. An empty grant is neither and is refused with 401. */
export function isSignedIn(g: Grant): boolean {
  return !!g.employeeId || g.legacy
}

/** Module access as the roles grant it, with no roll-out bypass. Super admins hold
 *  everything; the legacy login is FULL on every module (lib/rms/server.ts legacyGrant). */
export function holds(g: Grant, module: Module, level: AccessLevel = 'VIEW'): boolean {
  if (level === 'NONE') return true
  if (g.isSuperAdmin || g.legacy) return true
  return atLeast(g.modules[module], level)
}

/** Any of several modules at the level — "Travel Claims or Finance", say. */
export function holdsAny(g: Grant, modules: Module[], level: AccessLevel = 'VIEW'): boolean {
  return modules.some(m => holds(g, m, level))
}

/** Is `companyId` one the caller's roles are valid in (for `module` when given)? A
 *  cross-company role, a super admin and the legacy login may reach every company. A record
 *  with no company (null) is treated as in scope — the route decides whether such rows exist. */
export function inCompany(g: Grant, companyId: string | null | undefined, module?: Module | null): boolean {
  if (!companyId) return true
  if (g.isSuperAdmin || g.legacy || g.crossCompany) return true
  if (!g.companyId) return false
  return allowedCompanies(g, module ?? null).includes(companyId)
}

/** The verified actor behind a write: the employee id from the session. The legacy login has
 *  no employee row, so it yields null and a route that needs a named actor should refuse. */
export function actorId(g: Grant): string | null {
  return g.employeeId ?? null
}

export async function requireGrant(req: NextRequest): Promise<Gate> {
  const grant = await grantForRequest(req)
  if (!isSignedIn(grant)) return { grant: null, error: refuse(401, 'Sign in first.') }
  return { grant, error: null }
}

/** Signed in AND holding `module` at `level` (strictly — see the file comment). */
export async function requireAccess(req: NextRequest, module: Module | Module[], level: AccessLevel = 'VIEW'): Promise<Gate> {
  const base = await requireGrant(req)
  if (base.error) return base
  const mods = Array.isArray(module) ? module : [module]
  if (!holdsAny(base.grant, mods, level)) {
    return { grant: null, error: refuse(403, `${mods.join(' / ')} is not part of your access.`) }
  }
  return base
}

export type SubjectGate =
  | { grant: Grant; subjectId: string; onBehalf: boolean; error: null }
  | { grant: null; subjectId: null; onBehalf: false; error: NextResponse }

/**
 * The common ESS shape: a route acts on an employee — the caller themself, or somebody HR
 * is acting for. `asked` is the employee_id the request named (query or body); it is
 * honoured only when it IS the caller, or when the caller holds `module` at `level` in that
 * employee's company. Anything else is an impersonation attempt and is refused.
 *
 * The legacy dashboard login has no employee of its own, so it must name one and is then
 * treated as staff (it is FULL on every module).
 */
export async function requireSelfOrModule(
  req: NextRequest,
  asked: string | null | undefined,
  module: Module,
  level: AccessLevel = 'VIEW',
): Promise<SubjectGate> {
  const gate = await requireGrant(req)
  if (gate.error) return { grant: null, subjectId: null, onBehalf: false, error: gate.error }
  const g = gate.grant
  const me = g.employeeId
  const target = asked ? String(asked) : me
  if (!target) return { grant: null, subjectId: null, onBehalf: false, error: refuse(400, 'employee_id is required for the dashboard login.') }
  if (me && target === me) return { grant: g, subjectId: me, onBehalf: false, error: null }

  if (!holds(g, module, level)) return { grant: null, subjectId: null, onBehalf: false, error: refuse(403, 'You can only act on your own records.') }
  const { data: emp } = await sbAdmin.from('employees').select('company_id').eq('id', target).maybeSingle()
  if (!emp) return { grant: null, subjectId: null, onBehalf: false, error: refuse(404, 'Employee not found.') }
  if (!inCompany(g, emp.company_id as string | null, module)) {
    return { grant: null, subjectId: null, onBehalf: false, error: refuse(403, 'This employee belongs to a company outside your access.') }
  }
  return { grant: g, subjectId: target, onBehalf: true, error: null }
}

/** 403 when the record's company is outside the caller's scope; null when it is fine. */
export function requireCompany(g: Grant, companyId: string | null | undefined, module?: Module | null): NextResponse | null {
  return inCompany(g, companyId, module) ? null : refuse(403, 'This record belongs to a company outside your access.')
}

/** Constant-time equality for shared secrets (cron, exports). `a === b` returns on the first
 *  differing byte, which leaks the secret one character at a time to a patient caller. */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  // Node's timingSafeEqual needs equal lengths, checked above.
  return crypto.timingSafeEqual(a, b)
}
