// lib/te/server.ts — what every /api/te route is built from. SERVER ONLY.
// Never import this file into a 'use client' component: it reads the service-role key.
//
// A route in this module is always the same four steps:
//
//     export async function POST(req: NextRequest) {
//       return teRoute(req, async t => {
//         const body = await t.body<ExpenseInput>()        // 1 read the request
//         return svc.expenseSave(await t.ctx(), body)       // 2 who is calling  3 ONE service call
//       })                                                  // 4 teRoute turns the result, or the error, into JSON
//     }
//
// No business rule lives in a route. The rules engine decides what is allowed
// and what it is worth; the SQL functions own every state change and all money.
//
// WHY THE SERVICE-ROLE KEY, AND WHY LOUDLY
//   After supabase/migrations/151_te_lockdown.sql only the service role can
//   read a te_ table or call a te_ function. The rest of the app uses
//   `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY` and never says
//   when the first is missing (lib/travel/access.ts serviceClient()). Here that
//   fallback would look like "every screen is empty" in production, so
//   teSupabase() throws a clear error instead.
//
// WHO IS CALLING
//   The repo's own two session kinds, read with the repo's own helpers:
//     ESS session        resolveActor()         lib/travel/actor.ts -> lib/ess-session.ts
//     dashboard session  requireDashboardUser() lib/api-auth.ts
//   The employee id comes out of the verified token. Nothing in the body or the
//   query string can change who the caller is.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resolveActor } from '@/lib/travel/actor'
import { requireDashboardUser } from '@/lib/api-auth'
import { grantForRequest } from '@/lib/rms/server'
import { atLeast, type AccessLevel, type Module } from '@/lib/rms/modules'
import { companyFilter, type Grant } from '@/lib/rms/resolve'
import type { TeCtx, TeDb } from '@/lib/te/engine/te-service.js'
import { TeConfigError, TeHttpError, isUuid, mapTeError, refusalCode, rpcError } from './errors.ts'
import { routesProvider } from './providers/routes.ts'
import { geocodeProviders } from './providers/geocode.ts'
import { rcProvider } from './providers/rc.ts'

// ── the database ────────────────────────────────────────────────────────────

let client: SupabaseClient | null = null

/** role claim of a legacy JWT key ('anon' | 'service_role'), or null for the newer opaque keys. */
function keyRole(key: string): string | null {
  const part = key.split('.')[1]
  if (!part) return null
  try {
    const role = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { role?: unknown }).role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/**
 * The Supabase client of this module: service role, created on first use.
 * Throws TeConfigError (the route answers 503 and logs it) when the URL or the
 * service-role key is missing, or when the "service" key is in fact the browser key.
 */
export function teSupabase(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new TeConfigError('NEXT_PUBLIC_SUPABASE_URL is not set. Travel and Expenses cannot reach the database.')
  if (!key) {
    throw new TeConfigError('SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Travel and Expenses uses only the service-role key (the browser key is locked out by migration 151), so it cannot run without it.')
  }
  if (key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || keyRole(key) === 'anon') {
    throw new TeConfigError('SUPABASE_SERVICE_ROLE_KEY holds the anon (browser) key. Paste the service_role key from Supabase > Project Settings > API.')
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/**
 * The `db` te-service works with: one call, named arguments in, the function's
 * result out. A PostgREST error becomes a thrown Error carrying message, hint,
 * code and details, exactly like engine/tests/support/db.js, so te-service
 * behaves the same here as in its tests.
 */
export function teDb(): TeDb {
  const sb = teSupabase()
  return {
    async rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await sb.rpc(name, args)
      if (error) throw rpcError(error, name)
      return data as T
    },
  }
}

// ── who is calling ──────────────────────────────────────────────────────────

export interface TeActor {
  /** The employee behind the session. null for the legacy shared dashboard login,
   *  which is not attached to an employee row and therefore cannot ACT in this
   *  module (every action records who did it); it can open the read-only admin screens. */
  employeeId: string | null
  kind: 'ess' | 'legacy'
  email: string | null
}

/**
 * The caller, from the verified token. Throws 401 when nobody is signed in and
 * 503 when ESS sessions cannot be verified on this deployment at all.
 */
export async function teActor(req: NextRequest): Promise<TeActor> {
  // An ESS employee acting as themselves: the common case, no network round trip.
  const ess = await resolveActor(req, null, { selfOnly: true })
  if (ess.ok) return { employeeId: ess.employeeId, kind: 'ess', email: null }

  // The legacy shared dashboard login (a Supabase auth session).
  const dash = await requireDashboardUser(req)
  if (!dash.error) return { employeeId: dash.user.employeeId, kind: dash.user.kind, email: dash.user.email }

  // Neither. Keep the repo's own wording and status (401, or 503 when no signing secret is set).
  const status = ess.response.status
  const said = (await ess.response.json().catch(() => null)) as { error?: string } | null
  throw new TeHttpError(status, status === 503 ? 'TE_NOT_CONFIGURED' : 'TE_SIGN_IN', said?.error || 'Sign in to continue.')
}

/**
 * Does this grant hold `module` at `level`?
 *
 * Built from the same parts as requireModule() in lib/api-auth.ts
 * (requireDashboardUser + grantForRequest + a level check), with ONE deliberate
 * difference: requireModule() lets everybody through while the global switch
 * rms_config.enforce_module_access is off (hasLevel returns true when
 * !grant.enforced). For this module that would let any signed-in employee
 * record a Travel Desk booking or edit the company's limits, and the SQL
 * functions behind those routes do not check a role (te_booking_record,
 * te_vehicle_verify, te_workflow_save trust the route). So the level is
 * always checked here. Super admins and the legacy shared login resolve to
 * FULL on every module, as everywhere else. Grant the roles with
 * supabase/migrations/152_te_rbac_grants.sql.
 */
export function teHolds(grant: Grant, module: Module, level: AccessLevel): boolean {
  return grant.isSuperAdmin || atLeast(grant.modules[module], level)
}

// ── the request helper ──────────────────────────────────────────────────────

export interface TeCall {
  req: NextRequest
  /** Service-role Supabase client, for the few reads that are a view and not a function. */
  sb(): SupabaseClient
  db(): TeDb
  /** Who is calling. 401 when nobody is. */
  actor(): Promise<TeActor>
  /** The calling employee's id. 403 for the legacy shared login, which is no employee. */
  employee(): Promise<string>
  /** The ctx te-service takes: database, the acting employee, and the providers that are configured. */
  ctx(): Promise<TeCtx>
  /** The caller's roles, resolved once per request. */
  grant(): Promise<Grant>
  /** true when the caller holds the module at the level. Never throws. */
  holds(module: Module, level?: AccessLevel): Promise<boolean>
  /** 403 unless the caller holds the module at the level. */
  permit(module: Module, level?: AccessLevel): Promise<void>
  /**
   * true when the caller sits on a desk (migration 161's finance_team /
   * travel_desk), resolved once per request. Never throws: a project without
   * 161 applied has no te_on_desk, and that must read as "not on the desk"
   * rather than breaking the route.
   */
  onDesk(kind: 'finance' | 'travel'): Promise<boolean>
  /**
   * true when the caller is on that desk with GROUP scope — one person who
   * answers for every company in the group, which is what travel_desk's own
   * comment says the flag is for: "one row instead of one per company".
   *
   * It was honoured at the door and nowhere else. te_on_desk let them in and
   * then every query filtered to their own company and ?company_id= was
   * refused, so the only group-scoped desk member in the data could serve
   * exactly one of the three companies he was supposed to cover.
   */
  deskIsGroupWide(kind: 'finance' | 'travel'): Promise<boolean>
  /**
   * 403 unless the caller is on the desk OR holds the module by role.
   *
   * WHY BOTH. Desk membership is the real rule and the SQL enforces it — a
   * payout refuses anyone without a finance_team row that may disburse. The
   * route permission is the older, coarser one, and on this data the two had
   * drifted apart in both directions: an HR Head with the Finance role and no
   * finance_team row could read the whole company's money, while the Finance
   * Controller herself, can_disburse and all, was refused at the door because
   * nobody had granted her the dashboard role. Accepting either keeps the
   * route from being stricter than the database it is guarding.
   */
  permitDesk(kind: 'finance' | 'travel', module: Module, level?: AccessLevel): Promise<void>
  /**
   * The company this request is about. An employee's own company; another one
   * (?company_id=) only for a caller whose roles reach across companies. The
   * legacy shared login has no company of its own and must name one.
   */
  company(): Promise<string>
  /** The JSON body, parsed once. 400 when it is not a JSON object. */
  body<T extends object = Record<string, unknown>>(): Promise<T>
  /** ?limit= (default 50, at most 200) and ?offset=. */
  page(): { limit: number; offset: number; from: number; to: number }
}

function makeCall(req: NextRequest): TeCall {
  let actorP: Promise<TeActor> | null = null
  let grantP: Promise<Grant> | null = null
  let companyP: Promise<string> | null = null
  let bodyP: Promise<unknown> | null = null
  const deskP = new Map<string, Promise<boolean>>()

  const t: TeCall = {
    req,
    sb: teSupabase,
    db: teDb,
    actor: () => (actorP ??= teActor(req)),
    async employee() {
      const a = await t.actor()
      if (!a.employeeId) {
        throw new TeHttpError(403, 'TE_NO_EMPLOYEE', 'This sign-in is the shared dashboard login and is not linked to an employee, so it cannot act here. Sign in through ESS with your own account.')
      }
      return a.employeeId
    },
    async ctx() {
      return { db: teDb(), actor: await t.employee(), now: () => Date.now(), ...teProviders() }
    },
    async grant() {
      await t.actor()                                   // 401 first: an empty grant must not read as "403, ask for access"
      return (grantP ??= grantForRequest(req))
    },
    async holds(module, level = 'VIEW') {
      return teHolds(await t.grant(), module, level)
    },
    async permit(module, level = 'VIEW') {
      if (!(await t.holds(module, level))) {
        throw new TeHttpError(403, 'TE_FORBIDDEN', `${module} (${level.toLowerCase()} access) is not part of your role.`)
      }
    },
    async onDesk(kind) {
      const cached = deskP.get(kind)
      if (cached) return cached
      const p = (async () => {
        const id = (await t.actor()).employeeId
        if (!id) return false
        try {
          return await teDb().rpc<boolean>('te_on_desk', { p_kind: kind, p_actor: id }) === true
        } catch {
          return false                                  // migration 161 not applied
        }
      })()
      deskP.set(kind, p)
      return p
    },
    async deskIsGroupWide(kind) {
      const key = `group:${kind}`
      const cached = deskP.get(key)
      if (cached) return cached
      const p = (async () => {
        const id = (await t.actor()).employeeId
        if (!id) return false
        const table = kind === 'finance' ? 'finance_team' : 'travel_desk'
        const { data, error } = await t.sb().from(table)
          .select('id').eq('employee_id', id).eq('is_active', true).eq('is_group_scope', true).limit(1)
        // No column, no table: migration 161 is not applied, and then nobody
        // is group-scoped. Never a reason to fail the request.
        if (error) return false
        return (data?.length ?? 0) > 0
      })()
      deskP.set(key, p)
      return p
    },
    async permitDesk(kind, module, level = 'VIEW') {
      if (await t.onDesk(kind)) return
      if (await t.holds(module, level)) return
      throw new TeHttpError(403, 'TE_FORBIDDEN',
        `This needs a place on the ${kind} desk, or ${module} (${level.toLowerCase()}) access.`)
    },
    company: () => (companyP ??= resolveCompany(t)),
    async body<T extends object>() {
      bodyP ??= req.json().catch(() => { throw new TeHttpError(400, 'TE_BAD_REQUEST', 'The request body is not valid JSON.') })
      const b = await bodyP
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'The request body must be a JSON object.')
      return b as T
    },
    page() {
      const q = req.nextUrl.searchParams
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(q.get('limit')) || 50)))
      const offset = Math.max(0, Math.trunc(Number(q.get('offset')) || 0))
      return { limit, offset, from: offset, to: offset + limit - 1 }
    },
  }
  return t
}

async function resolveCompany(t: TeCall): Promise<string> {
  const actor = await t.actor()
  const asked = t.req.nextUrl.searchParams.get('company_id')
  if (asked && !isUuid(asked)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'company_id is not a valid id.')

  let own: string | null = null
  if (actor.employeeId) {
    const { data, error } = await t.sb().from('employees').select('company_id').eq('id', actor.employeeId).maybeSingle()
    if (error) throw rpcError(error, 'employees')
    own = (data?.company_id as string | undefined) ?? null
  }
  if (own && (!asked || asked === own)) return own

  // Somebody else's company, or a caller with none of their own: the roles decide.
  // companyFilter() is the repo's single choke-point for this (lib/rms/resolve.ts).
  const allowed = companyFilter(await t.grant(), asked)
  if (allowed && (!asked || allowed === asked)) return allowed

  // A GROUP-SCOPED DESK MEMBER may work in any company of their own group.
  // That is what the flag means and it reached nothing before: the one
  // group-scoped person in the data could be refused the other two companies
  // he exists to serve. Still their own group only — this widens the reach of
  // a deliberate flag, never of an ordinary desk row.
  if (asked && own && (await t.deskIsGroupWide('travel') || await t.deskIsGroupWide('finance'))) {
    const { data, error } = await t.sb().from('companies').select('id, group_id').in('id', [asked, own])
    if (error) throw rpcError(error, 'companies')
    const mine = data?.find(c => c.id === own)?.group_id ?? null
    const theirs = data?.find(c => c.id === asked)?.group_id ?? null
    if (mine && theirs && mine === theirs) return asked
  }
  if (asked) throw new TeHttpError(403, 'TE_FORBIDDEN', 'You can only work with your own company.')
  throw new TeHttpError(400, 'TE_BAD_REQUEST', 'company_id is required for this sign-in.')
}

// ── providers ───────────────────────────────────────────────────────────────

let providers: Pick<TeCtx, 'routes' | 'rc' | 'geocode' | 'reverseGeocode'> | null = null

/**
 * The outside services te-service may use. Each one is ABSENT (the key is not
 * on the object) when its env var is not configured; te-service then takes its
 * documented fallback. A setting that names a provider which does not exist
 * throws, on every request, until it is fixed.
 *   GOOGLE_MAPS_API_KEY  routes, geocode, reverseGeocode
 *   TE_RC_PROVIDER       rc
 */
export function teProviders(): Pick<TeCtx, 'routes' | 'rc' | 'geocode' | 'reverseGeocode'> {
  if (providers) return providers
  const out: Pick<TeCtx, 'routes' | 'rc' | 'geocode' | 'reverseGeocode'> = {}
  const routes = routesProvider()
  if (routes) out.routes = routes
  const geo = geocodeProviders()
  if (geo.geocode) out.geocode = geo.geocode
  if (geo.reverseGeocode) out.reverseGeocode = geo.reverseGeocode
  const rc = rcProvider()
  if (rc) out.rc = rc
  providers = out
  return out
}

/** The ctx for one employee. Routes normally use t.ctx(); this is for code that has no request (tests). */
export async function teContext(req: NextRequest): Promise<TeCtx> {
  return makeCall(req).ctx()
}

// ── the wrapper ─────────────────────────────────────────────────────────────

/**
 * Run a route. `fn` returns the JSON to send (or a NextResponse, for a CSV).
 * Every failure goes through mapTeError() (lib/te/errors.ts), so the browser
 * always gets { error, code, … } and the status says what kind of no it was.
 *
 * A company created after migration 149 ran has no te_settings row; the first
 * call for it comes back TE_NOT_SET_UP. When that is truly the reason (no row),
 * the company is seeded here (te_seed_company never overwrites anything) and
 * the call is made once more. Nothing was written the first time: TE_NOT_SET_UP
 * is raised before any write, and a refusal rolls its transaction back.
 */
export async function teRoute(req: NextRequest, fn: (t: TeCall) => Promise<unknown>): Promise<NextResponse> {
  const t = makeCall(req)
  try {
    return send(await fn(t))
  } catch (first) {
    let failure: unknown = first
    if (refusalCode(first) === 'TE_NOT_SET_UP') {
      try {
        if (await seedIfMissing(t)) return send(await fn(t))
      } catch (second) {
        failure = second
      }
    }
    const m = mapTeError(failure)
    if (m.log) console.error(`[te] ${req.method} ${req.nextUrl.pathname} -> ${m.status}`, failure)
    return NextResponse.json(m.body, { status: m.status })
  }
}

function send(result: unknown): NextResponse {
  if (result instanceof NextResponse) return result
  return NextResponse.json(result === undefined || result === null ? { ok: true } : result)
}

/** Seeds the caller's company when it has no settings row. false = it was already set up
 *  (the refusal has another cause, e.g. "nobody is set up to verify claims"). */
async function seedIfMissing(t: TeCall): Promise<boolean> {
  const company = await t.company()
  const { data, error } = await t.sb().from('te_settings').select('company_id').eq('company_id', company).maybeSingle()
  if (error) throw rpcError(error, 'te_settings')
  if (data) return false
  const actor = await t.actor()
  await t.db().rpc('te_seed_company', { p_company_id: company, p_actor: actor.employeeId })
  console.warn(`[te] seeded Travel and Expenses for company ${company} on first use`)
  return true
}

// ── two things several routes need ──────────────────────────────────────────

/**
 * Does the caller's ROLE reach this record? true when they hold one of the
 * modules at the level AND the record belongs to a company they may see.
 * Used where the SQL function trusts the route to have checked (p_admin = true,
 * Travel Desk bookings, vehicle verification).
 */
export async function teStaffFor(
  t: TeCall,
  table: 'te_trips' | 'te_claims' | 'te_bookings' | 'te_employee_vehicles',
  id: string,
  modules: Module[],
  level: AccessLevel = 'VIEW',
): Promise<boolean> {
  let held = false
  for (const m of modules) held = held || (await t.holds(m, level))
  if (!held) return false
  const { data, error } = await t.sb().from(table).select('company_id').eq('id', id).maybeSingle()
  if (error) throw rpcError(error, table)
  if (!data) return false
  const recordCo = data.company_id as string
  if (companyFilter(await t.grant(), recordCo) === recordCo) return true

  // A GROUP-SCOPED DESK MEMBER reaches the rest of their own group. The same
  // flag resolveCompany honours for reading: without this the Travel Desk
  // could open another company's work list and then be refused every booking
  // in it, which is worse than not seeing it at all. The company must still
  // be in their group, and they must still hold the module.
  if (await t.deskIsGroupWide('travel') || await t.deskIsGroupWide('finance')) {
    const me = (await t.actor()).employeeId
    if (!me) return false
    const { data: mine, error: e1 } = await t.sb().from('employees').select('company_id').eq('id', me).maybeSingle()
    if (e1) throw rpcError(e1, 'employees')
    const ownCo = mine?.company_id as string | undefined
    if (!ownCo) return false
    const { data: cos, error: e2 } = await t.sb().from('companies').select('id, group_id').in('id', [ownCo, recordCo])
    if (e2) throw rpcError(e2, 'companies')
    const a = cos?.find(c => c.id === ownCo)?.group_id ?? null
    const b = cos?.find(c => c.id === recordCo)?.group_id ?? null
    if (a && b && a === b) return true
  }
  return false
}

/** 403 unless teStaffFor() says yes. */
export async function tePermitFor(
  t: TeCall,
  table: 'te_trips' | 'te_claims' | 'te_bookings' | 'te_employee_vehicles',
  id: string,
  module: Module,
  level: AccessLevel,
): Promise<void> {
  if (!(await teStaffFor(t, table, id, [module], level))) {
    throw new TeHttpError(403, 'TE_FORBIDDEN', `${module} (${level.toLowerCase()} access) is not part of your role, or this record belongs to another company.`)
  }
}

/**
 * Open one trip or claim. The SQL lets in the owner, the people on its
 * approval chain and the company's Finance team. Somebody else is let in only
 * when their ROLE says so (Travel Claims or Finance, view) and the record
 * belongs to a company they may see; the SQL is then told p_admin = true.
 */
export async function teOpen<T>(t: TeCall, kind: 'trip' | 'claim', id: string, read: (admin: boolean) => Promise<T>): Promise<T> {
  try {
    return await read(false)
  } catch (e) {
    if (refusalCode(e) !== 'TE_FORBIDDEN') throw e
    if (!(await teStaffFor(t, kind === 'trip' ? 'te_trips' : 'te_claims', id, ['Travel Claims', 'Finance']))) throw e
    return read(true)
  }
}

/** A file download response. */
export function teCsvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  })
}
