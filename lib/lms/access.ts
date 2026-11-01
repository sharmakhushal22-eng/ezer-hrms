// lib/lms/access.ts — who is asking, and how far their reach extends. Server only.
//
// Two questions, as everywhere else in the app: may this person do this kind of thing
// (caps, from their modules), and on whose data (scope, from their roles). Every admin
// route starts here, and a row from another company answers 404 rather than 403, so a
// guessed id reveals nothing about whether it exists.
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
import { grantForRequest } from '@/lib/rms/server'
import { allowedCompanies, companyFilter, type Grant } from '@/lib/rms/resolve'
import { LMS_MODULES, hasAnyLmsCap, lmsCaps, moduleOfCap, type LmsCap, type LmsCaps } from './caps'
import { LmsError, notFound, sb } from './server'

export interface LmsActor {
  grant: Grant
  caps: LmsCaps
  employeeId: string | null
  label: string
  /** Null: every company, for a cross-company role. */
  companies: string[] | null
  /** Set when every role that grants Learning is branch-scoped: they see that branch only. */
  locationId: string | null
}

/** Are all the roles that open Learning for this person limited to their branch? */
async function branchOnly(g: Grant): Promise<boolean> {
  const scoped = (g.roles || []).filter(r => String(r.role_code).toUpperCase() !== 'EMPLOYEE')
  if (!scoped.length || g.isSuperAdmin || g.legacy) return false
  const { data } = await sb.from('role_permissions').select('role_id, access_level')
    .in('role_id', scoped.map(r => r.id)).in('module', LMS_MODULES)
  const granting = new Set((data || []).filter((p: any) => p.access_level !== 'NONE').map((p: any) => p.role_id))
  const roles = scoped.filter(r => granting.has(r.id))
  return roles.length > 0 && roles.every(r => String(r.scope || '').toUpperCase() === 'BRANCH')
}

/** The signed-in admin, or the response that refuses them. `need` may be one capability or
 *  several, any of which will do. */
export async function lmsAdmin(req: NextRequest, need?: LmsCap | LmsCap[]): Promise<{ actor: LmsActor; error: null } | { actor: null; error: NextResponse }> {
  const auth = await requireDashboardUser(req)
  if (auth.error) return { actor: null, error: auth.error }
  const grant = await grantForRequest(req)
  const caps = lmsCaps(grant)
  const list = need === undefined ? null : Array.isArray(need) ? need : [need]
  const allowed = list ? list.some(c => caps[c]) : hasAnyLmsCap(caps)
  if (!allowed) return { actor: null, error: NextResponse.json({ error: 'Learning is not part of your access.' }, { status: 403 }) }

  const open = grant.crossCompany || !grant.companyId
  let locationId: string | null = null
  if (grant.employeeId && await branchOnly(grant)) {
    const { data } = await sb.from('employees').select('location_id').eq('id', grant.employeeId).maybeSingle()
    locationId = (data?.location_id as string) || null
  }
  const companies = open ? null : [...new Set(LMS_MODULES.flatMap(m => allowedCompanies(grant, m)))]
  return {
    actor: { grant, caps, employeeId: grant.employeeId, label: grant.name || grant.empCode || 'Dashboard login', companies, locationId },
    error: null,
  }
}

/** The companies a read covers, narrowed to `requested` where the caller may. */
export async function readCompanies(a: LmsActor, requested?: string | null): Promise<string[]> {
  if (a.companies) {
    if (requested && requested !== 'ALL') {
      if (!a.companies.includes(requested)) throw new LmsError('That company is not part of your access.', 403)
      return [requested]
    }
    return a.companies
  }
  if (requested && requested !== 'ALL') return [requested]
  const { data } = await sb.from('companies').select('id')
  return (data || []).map((c: any) => c.id)
}

/** The one company a write lands in. A person with a single company never has to say which;
 *  a cross-company caller must, because guessing would put a course in the wrong tenant. */
export function writeCompany(a: LmsActor, requested: string | null | undefined, cap: LmsCap): string {
  const id = companyFilter(a.grant, requested || null, moduleOfCap(cap))
  if (!id) throw new LmsError('Choose a company first.', 400)
  if (a.companies && !a.companies.includes(id)) throw new LmsError('That company is not part of your access.', 403)
  return id
}

/** Is this row's company one the actor may touch? Answers "not found" when not. */
export function inScope(a: LmsActor, companyId: string | null | undefined, what = 'That'): void {
  if (!companyId || (a.companies && !a.companies.includes(companyId))) throw notFound(what)
}
