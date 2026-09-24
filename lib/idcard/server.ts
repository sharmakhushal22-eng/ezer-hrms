// lib/idcard/server.ts — resolving a request into "may they, and how far".
//
// Server only. This is the layer between a NextRequest and the pure decisions
// in ./authz: it fetches the two facts those decisions need (which locations a
// BRANCH role was assigned, and where the caller themselves sits) and stamps
// the audit trail.
//
// Nothing here decides policy. Policy is in authz.ts, which is pure and tested;
// this file only supplies it with truthful inputs and refuses to invent them.

import type { NextRequest } from 'next/server'
import { grantForRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import type { Grant } from '@/lib/rms/resolve'
import { canExportIdCards, idCardScope, type IdCardScope } from './authz'

export interface IdCardCaller {
  grant: Grant
  scope: IdCardScope
  /** Null for the legacy shared login — which canExportIdCards already refuses,
   *  precisely because a download it made could not be attributed to anybody. */
  actorEmployeeId: string | null
  actorLabel: string | null
  roleCodes: string[]
}

/**
 * Which locations this caller's BRANCH-scoped assignments cover.
 *
 * TOLERANT OF THE MIGRATION NOT BEING RUN. ess_user_roles.location_id arrives
 * in 131; until then PostgREST answers the select with an error, which must
 * read as "no assigned locations" and fall through to the caller's own desk —
 * not as a crash that takes the screen down. lib/rms/server.ts already does
 * exactly this for role_screen_access before migration 123, so the shape is the
 * house one rather than a new invention.
 */
async function assignedLocations(employeeId: string): Promise<string[]> {
  const { data: acct } = await sb
    .from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle()
  if (!acct?.id) return []

  const res = await sb
    .from('ess_user_roles')
    .select('location_id')
    .eq('ess_account_id', acct.id)
    .eq('is_active', true)
    .then(r => r, () => ({ data: [] as { location_id: string | null }[] }))

  return ((res as { data?: { location_id?: string | null }[] })?.data || [])
    .map(r => r.location_id)
    .filter((v): v is string => !!v)
}

/** Where the caller sits. The fallback branch when no assignment names one. */
async function ownLocation(employeeId: string): Promise<string | null> {
  const { data } = await sb
    .from('employees').select('location_id').eq('id', employeeId).maybeSingle()
  return (data?.location_id as string) ?? null
}

/**
 * Resolve a request into a caller and their reach.
 *
 * Returns a `none` scope rather than throwing when the caller may not export —
 * every route then has one shape to check, and there is no path where a thrown
 * error is mistaken for an allowed request.
 */
export async function idCardCaller(req: NextRequest): Promise<IdCardCaller> {
  const grant = await grantForRequest(req)
  const roleCodes = grant.roles.map(r => String(r.role_code || '').toUpperCase())
  const base: IdCardCaller = {
    grant,
    scope: { kind: 'none' },
    actorEmployeeId: grant.employeeId,
    actorLabel: grant.name ?? grant.empCode ?? null,
    roleCodes,
  }

  if (!canExportIdCards(grant) || !grant.employeeId) return base

  const [assigned, own] = await Promise.all([
    assignedLocations(grant.employeeId),
    ownLocation(grant.employeeId),
  ])

  return { ...base, scope: idCardScope(grant, assigned, own) }
}

/**
 * Narrow a Supabase query to the caller's scope.
 *
 * This is the FIRST of two checks. The second is scopeAllows() applied per row
 * on the way out, in the route. Two checks because this one can be forgotten by
 * a future edit and the query would still return rows — whereas a row that
 * fails the second check never reaches a response body. Belt and braces is the
 * right posture when the payload is somebody's identity document.
 */
export function applyScope<T extends {
  eq(col: string, val: string): T
  in(col: string, vals: string[]): T
}>(q: T, scope: IdCardScope): T {
  switch (scope.kind) {
    case 'all': return q
    case 'company': return q.eq('company_id', scope.companyId)
    case 'locations': {
      const narrowed = scope.companyId ? q.eq('company_id', scope.companyId) : q
      return narrowed.in('location_id', scope.locationIds)
    }
    case 'none':
      // Impossible in practice — routes refuse a `none` scope before querying —
      // but an id that cannot exist is the safe way to express "nothing".
      return q.eq('id', '00000000-0000-0000-0000-000000000000')
  }
}

export interface DownloadRecord {
  subjectEmployeeId: string
  subjectEmpCode: string | null
}

/**
 * Record what was taken.
 *
 * One row per SUBJECT, not one per click: a bulk export of forty cards writes
 * forty rows sharing a batch_size of forty. A single row saying "40 cards" is
 * unusable for the question this table exists to answer — "was this person's
 * card ever pulled, and by whom".
 *
 * Failure to log is deliberately NOT fatal to the download. Refusing a
 * legitimate export because an audit insert failed would be the wrong trade for
 * HR staff doing their job; the error is returned so the route can surface it.
 */
export async function recordDownloads(
  caller: IdCardCaller,
  subjects: DownloadRecord[],
  opts: { format: string; sides: string; source?: string; ip?: string | null; userAgent?: string | null },
): Promise<{ logged: number; error: string | null }> {
  if (!subjects.length) return { logged: 0, error: null }

  const rows = subjects.map(s => ({
    actor_employee_id: caller.actorEmployeeId,
    actor_label: caller.actorLabel,
    actor_role_codes: caller.roleCodes,
    subject_employee_id: s.subjectEmployeeId,
    subject_emp_code: s.subjectEmpCode,
    format: opts.format,
    sides: opts.sides,
    batch_size: subjects.length,
    source: opts.source ?? 'admin',
    ip: opts.ip || null,
    user_agent: opts.userAgent || null,
  }))

  const { error } = await sb.from('id_card_downloads').insert(rows)
  return { logged: error ? 0 : rows.length, error: error?.message ?? null }
}

/** The client's address, as far as we can honestly tell. x-forwarded-for is a
 *  list when proxies chain; the first entry is the original client. */
export function callerIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return req.headers.get('x-real-ip')
}
