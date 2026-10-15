// lib/config/access.ts — who may read and edit Configuration templates.
//
//   Super Admin             Global defaults and every company's templates.
//   'Configuration' module  granted in Roles → Module Access: VIEW reads, EDIT edits —
//                           only for the person's OWN company. Global is read-only
//                           for them (they can see what their company inherits).
//   Everyone else           nothing.
//
// The module grant is checked even while app-wide module enforcement is off
// (rms_config.enforce_module_access) — templates are what candidates and employees
// receive, so "nobody restricted it yet" must not mean "anyone may rewrite them".
//
// The legacy shared dashboard login carries no employee. When its email belongs to an
// employee, that employee's own roles decide; when it does not (the shared admin
// account) it keeps the full access it has everywhere else in the portal, and its
// edits are recorded as "legacy login".
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { grantForEmployee, grantForRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import { atLeast, type AccessLevel } from '@/lib/rms/modules'
import type { Grant } from '@/lib/rms/resolve'

export interface ConfigActor {
  employeeId: string | null
  name: string
  /** Global defaults + every company. */
  isSuper: boolean
  /** The one company a non-super editor is limited to. */
  companyId: string | null
  level: AccessLevel
}

export function canViewScope(a: ConfigActor, companyId: string | null): boolean {
  if (a.isSuper) return true
  if (!atLeast(a.level, 'VIEW')) return false
  return companyId === null || companyId === a.companyId
}

export function canEditScope(a: ConfigActor, companyId: string | null): boolean {
  if (a.isSuper) return true
  if (!atLeast(a.level, 'EDIT')) return false
  return companyId !== null && companyId === a.companyId
}

async function employeeByEmail(email: string | null): Promise<{ id: string } | null> {
  const addr = (email || '').trim().toLowerCase()
  if (!addr || !/^[^\s@,()]+@[^\s@,()]+$/.test(addr)) return null
  const { data } = await sb.from('employees').select('id')
    .or(`office_email.ilike.${addr},personal_email.ilike.${addr}`).limit(1).maybeSingle()
  return (data as { id: string } | null) ?? null
}

/** The caller as a Configuration actor, or a 401/403 response to return as-is. */
export async function configActor(
  req: NextRequest,
  need: AccessLevel = 'VIEW',
): Promise<{ actor: ConfigActor; error: null } | { actor: null; error: NextResponse }> {
  const base = await requireDashboardUser(req)
  if (base.error) return { actor: null, error: base.error }

  let grant: Grant
  let legacyShared = false
  if (base.user.kind === 'legacy') {
    const emp = await employeeByEmail(base.user.email)
    if (emp) grant = await grantForEmployee(emp.id)
    else { grant = await grantForRequest(req); legacyShared = true }
  } else {
    grant = await grantForRequest(req)
  }

  const isSuper = grant.isSuperAdmin || legacyShared
  const level: AccessLevel = isSuper ? 'FULL' : ((grant.modules['Configuration'] as AccessLevel) || 'NONE')
  const actor: ConfigActor = {
    employeeId: grant.employeeId,
    name: legacyShared ? `Legacy login (${base.user.email || 'shared'})` : (grant.name || 'Unknown'),
    isSuper,
    companyId: grant.companyId,
    level,
  }

  if (!atLeast(level, need)) {
    return { actor: null, error: NextResponse.json({ error: 'Configuration is not part of your access.' }, { status: 403 }) }
  }
  return { actor, error: null }
}
