// app/api/pms/admin/route.ts
//
//   GET                       -> everything the admin editor needs to render
//   POST { action, ...args }  -> one write, from the allowlist below
//
// WHY THIS EXISTS
//
// The dashboard Performance module had NO write path at all — every component
// under components/pms/ reads and none of them writes. The Config tab even
// shows a frequency dropdown, but its onChange only sets React state: it
// re-renders the period preview and saves nothing. That is why the screen
// looked editable and wasn't.
//
// The database has had the whole admin surface all along — pms_hr_kra_action,
// pms_lock_kras, pms_finalise, pms_generate_periods, pms_open_period, plus the
// pms_policies / pms_kra_master / pms_rating_scale tables. This route is the
// missing half.
//
// TWO RULES, BOTH LOAD-BEARING
//
//   1. The ACTOR IS NEVER READ FROM THE BODY. It comes from the bearer token
//      via actorFromRequest. pms_hr_kra_action and pms_finalise both record
//      who acted, and an actor supplied by the caller would make that record
//      worthless.
//   2. Columns are allowlisted per table. A pass-through update would let a
//      caller set company_id and move a policy between companies.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest, actorFromRequest } from '@/lib/rms/server'
import { companyFilter, allowedCompanies } from '@/lib/rms/resolve'
import { canManage } from '@/lib/rms/resolve'
import { isHrRole, pmsRoleOf } from '@/lib/pms/postFinal'
import { authorityOf, authorityFromRow } from '@/lib/pms/authority'
import { chainFault, normaliseRungs, usedBy, RUNG_CHOICES } from '@/lib/pms/chainBuilder'
import { policyKpiRangeFault } from '@/lib/pms/kpi'
import { scopeVerdict, scopeRefusal } from '@/lib/pms/tenancy'

export const dynamic = 'force-dynamic'

const bad  = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const okay = (data: unknown = null) => NextResponse.json({ ok: true, data })

/** Columns an admin may set. Deliberate omissions:
 *  • id, company_id, created_at, created_by — identity and provenance.
 *  • periods_per_year — GENERATED ALWAYS; Postgres rejects any write to it.
 *  • payout_linkage_enabled — locked false by CHECK in 066. A toggle for it
 *    would fail every time it was used, so it is not offered at all. */
const POLICY_COLS = [
  'policy_code', 'policy_name', 'frequency',
  'applies_department_ids', 'applies_grades', 'applies_location_ids',
  'applies_employment_types', 'applies_to_all',
  'min_kra_count', 'max_kra_count', 'total_weightage', 'min_weightage_per_kra',
  'kra_created_by', 'one_to_one_mandatory', 'mid_period_checkin',
  'final_review_one_to_one', 'approval_chain', 'who_can_finalise',
  'self_rating_mandatory', 'rating_scale_type', 'new_joiner_cutoff_days',
  'include_notice_period', 'include_exited', 'is_active',
  // §13.2(3). Allowlisted rather than assumed: this file names every column a
  // caller may write, so a new policy field is inert until it is listed here
  // — which is the right default for a table that decides how everybody is
  // rated, but it does mean the list has to be kept up.
  'carry_forward_kras',
  // 211 and 217. What the HR Head may do, which until now was spread
  // between two tabs and four files — see lib/pms/authority.ts. Listed
  // here because the same rule applies: a policy column is inert until a
  // caller is allowed to write it.
  // post_final_owner and publish_scope are already listed below.
  'hr_head_final_rating', 'hr_head_can_override', 'hr_head_can_direct',
  'rating_upload_by',
  // 205. Same reason again: WHO the HR Head is, so the HOD's published-results
  // banner can name a person instead of saying "HR". Not a permission —
  // post_final_owner and §2's matrix still decide who may act.
  'hr_head_id',
  // 202. Same reason as the line above: a policy column is INERT until it is
  // named here, so the admin screen's new control would have saved silently
  // into nothing — the precise shape of the "my configuration changes do not
  // take effect" bug reported against this module once already.
  'post_final_owner',
  // 203. Inert until named here, same as every column above it.
  'publish_scope',
  // 218. WHICH COMPOSED CHAIN THIS POLICY USES. Sits alongside approval_chain
  // rather than replacing it: null here means fall back to the three presets,
  // so a policy nobody has touched is appraised exactly as it was. Inert until
  // named here, same as every column above it.
  'chain_id',
  // 221. HOW MANY KPIs ONE KRA MAY HOLD, default 1 to 5. The same kind of rule
  // as min_kra_count/max_kra_count four lines up, and inert until named here.
  // The pair CHECK pms_policies_kpi_range refuses min > max, so a bad pair is
  // rejected by the database rather than saved and discovered later.
  'min_kpi_per_kra', 'max_kpi_per_kra',
] as const

/** A period's own windows, and its status.
 *
 *  WHY THIS EXISTS. pms_generate_periods lays the windows out from the
 *  frequency and nothing could change them afterwards — there was no
 *  period_update at all. So a window that was set wrongly, or one that has
 *  simply passed, could not be corrected from the product: an employee who
 *  missed the self-rating window saw "Ask your manager to reopen it" and
 *  nobody, manager or admin, had any way to do it.
 *
 *  period_start, period_end, period_code and period_no are NOT here. Those are
 *  the period's identity; moving them would silently re-date work already
 *  recorded against it. Windows are scheduling, which is a different thing. */
const PERIOD_COLS = [
  'kra_window_from', 'kra_window_to',
  'checkin_from', 'checkin_to',
  'self_rating_from', 'self_rating_to',
  'rm_review_from', 'rm_review_to',
  'finalise_from', 'finalise_to',
  'result_publish_date', 'status',
] as const

const KRA_COLS = [
  'department_id', 'designation', 'grade', 'kra_title', 'kpi_metric',
  'suggested_target', 'category', 'suggested_weightage', 'is_active',
] as const

/**
 * THE COURSE CATALOGUE (215). company_id is NOT here: a row either belongs
 * to one company or to the whole group, and which it is gets decided on
 * insert from the grant, exactly as a KRA does — not patched later by
 * whatever the browser happened to send.
 */
const CATALOGUE_COLS = [
  'course_name', 'provider', 'skill', 'category', 'level', 'url',
  'duration_hours', 'notes', 'is_active',
] as const

/**
 * A COMPOSED CHAIN (218). Only three fields are a caller's to set.
 *
 * `rungs` is NOT here: it never comes through pick() at all. It is rebuilt by
 * normaliseRungs from what the browser sent, so what lands in the column is
 * always the two fixed ends plus deduplicated, upper-cased, whitelisted
 * approvers — never the array as posted. A pass-through would let a caller
 * store a rung the builder cannot draw and the engine cannot resolve.
 */
const CHAIN_COLS = ['name', 'notes', 'is_active'] as const

const SCALE_COLS = [
  'policy_id', 'rating_value', 'rating_code', 'rating_label',
  'score_from', 'score_to', 'min_comment_chars',
  'improvement_feedback_mandatory', 'allows_pip_request',
  // 209, the mirror of allows_pip_request. Inert until named here, same as
  // every other column this route gates.
  'allows_recognition',
  'colour_hex', 'sort_order', 'is_active',
] as const

function pick(body: Record<string, unknown>, cols: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const c of cols) if (body[c] !== undefined) out[c] = body[c]
  return out
}

/**
 * ACTIONS HR MAY TAKE WITHOUT MANAGING THE MODULE.
 *
 * Everything else behind this route is admin CONFIGURATION — the policy, the
 * KRA library, the rating scale, generating and opening periods — and HR does
 * not configure the module.
 *
 * The bulk rating upload is not configuration. It is HR's own job: §2 grants
 * bulk_upload_ratings to HR Manager, HR Head and Admin, and to nobody else.
 * It shared this route only because the route happened to be where the RPC
 * was called from, and so inherited a gate meant for the editor — which left
 * HR able to open Final Rating Upload, parse a file and build a validated
 * batch, only to be refused at the commit.
 */
const HR_ACTIONS = new Set(['upload_commit'])

/**
 * WHY THE TEST IS pmsRoleOf AND NOT canSeeScreen('pms.upload').
 *
 * The screen key looks like the natural answer and is the wrong one: it is
 * held by L1_MANAGER, L2_MANAGER and HOD as well, which is exactly how
 * Publish Results became reachable by every line manager when it borrowed
 * that key. Gating a bulk override on it would let any line manager rewrite
 * final ratings for the whole period.
 *
 * pmsRoleOf is the reading the publish path already uses, so the two cannot
 * drift into disagreeing about who counts as HR, and it maps an unknown role
 * to EMPLOYEE rather than to anything privileged.
 */
/**
 * 217: WHO MAY COMMIT A RATING UPLOAD IS A POLICY QUESTION NOW.
 *
 * Read per period, because the policy is per company and an HR Head spans
 * three of them. Unreadable, or a period this request does not name, falls
 * back to the behaviour before 217 — a permissions lookup that fails shut
 * would close the route on a database hiccup, and the people it closes it
 * on cannot fix it.
 */
async function uploadAllowed(grant: Awaited<ReturnType<typeof grantForRequest>>,
                             periodId: string | null): Promise<boolean> {
  const role = pmsRoleOf(grant.roles, grant.isSuperAdmin)
  if (!periodId) return isHrRole(role)
  const r = await sb.from('pms_periods')
    .select('pms_policies!inner(hr_head_final_rating, hr_head_can_override,'
          + ' hr_head_can_direct, rating_upload_by)')
    .eq('id', periodId).limit(1).maybeSingle()
  if (r.error || !r.data) return isHrRole(role)
  const pol = (r.data as unknown as { pms_policies?: Record<string, unknown> }).pms_policies
  return authorityOf(role, authorityFromRow(pol)).upload
}

/**
 * HOW MANY EMPLOYEES HAVE SOMEBODY AT EACH RUNG (218).
 *
 * The chain builder shows this against each choice, because a rung nobody
 * occupies is skipped rather than refused — so picking one blind is how
 * somebody builds a chain that silently does less than it looks like it does.
 * Measured 2026-11-05, 398 active employees: hod_id 398, l1_manager_id 395,
 * site_hr_id 395, l2_manager_id 261 — deliberately absent where L1 and L2 are
 * the same person — and regional_head_id 0.
 *
 * COUNTS, NOT ROWS. `head: true` with an exact count asks Postgres for the
 * number and transfers no rows, so this is six cheap reads rather than 398
 * employees' relationship columns crossing the wire to be counted in JS.
 *
 * NON-FATAL, and chainWarnings treats an absent count as "say nothing" rather
 * than as zero — inventing "nobody has one" out of a failed read would raise a
 * false alarm about every rung at once.
 */
async function rungCoverage(): Promise<Record<string, { have: number; of: number }> | null> {
  const live = () => sb.from('employees')
    .select('id', { count: 'exact', head: true }).is('date_of_leaving', null)
  const cols = RUNG_CHOICES.map(c => [c.stage, c.column] as const)
  const [total, ...each] = await Promise.all([
    live(), ...cols.map(([, col]) => live().not(col, 'is', null)),
  ])
  if (total.error || total.count == null) {
    console.error('[pms] rung coverage unreadable:', total.error)
    return null
  }
  const out: Record<string, { have: number; of: number }> = {}
  each.forEach((r, i) => {
    if (r.error || r.count == null) {
      /**
       * A FAILED RUNG IS LOGGED, NOT ONLY SKIPPED.
       *
       * Silence here hid a real bug for a whole commit: RUNG_CHOICES named
       * rm_l1_id and rm_l2_id, which do not exist on employees, so both reads
       * failed and the builder showed no coverage for the two rungs most of
       * the company actually uses. "This rung says nothing" and "this rung
       * cannot be read" look identical on screen, and only one of them is
       * somebody's mistake.
       */
      console.error(`[pms] rung coverage failed for ${cols[i][0]} `
                  + `(employees.${cols[i][1]}):`, r.error)
      return
    }
    out[cols[i][0]] = { have: r.count, of: total.count! }
  })
  return out
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * WHICH COMPANY'S ROW IS THIS, AND MAY THIS CALLER TOUCH IT?
 * ════════════════════════════════════════════════════════════════════════
 *
 * canManage(grant, 'Performance') is an ACCESS LEVEL. It answers "may this
 * person configure Performance" and says nothing whatever about WHOSE
 * Performance. Company scoping in this product is a separate thing —
 * companyFilter, whose own comment calls it "the single choke-point that
 * stops '' / 'ALL' from leaking other companies".
 *
 * That choke-point was on all four INSERT paths and none of the eleven that
 * address an existing row, every one of which reads its id straight from the
 * request body and runs through rmsServiceClient — the SERVICE ROLE key, so
 * RLS is not behind it either. Three organisations share this database. A
 * Performance=FULL admin scoped to one of them could rewrite the other two's
 * policies, rating bands, periods, KRA library and chains, using ids this
 * route's own GET hands over unfiltered.
 *
 * ── WHY THIS LIVES IN gate() AND NOT AT FIFTEEN CALL SITES ───────────────
 *
 * Because the failure mode is FORGETTING. The insert paths prove the author
 * knew the rule and applied it where it was in view; what went wrong is that
 * nothing connected the cases. A check inside the switch would be fifteen
 * chances to leave one out, and the sixteenth action somebody adds next year
 * would be the one that slips. Declared in a map and run before the switch,
 * an omission is a missing KEY — and admin-route-tenancy.test.ts fails on a
 * case that has no entry.
 *
 * ── FAIL CLOSED, UNLIKE uploadAllowed ────────────────────────────────────
 *
 * uploadAllowed deliberately falls back to pre-217 behaviour when its read
 * fails, and says why: a permissions lookup that fails shut would close the
 * route on a database hiccup. That is right for a question about what a
 * feature allows and wrong for a tenancy boundary. A hiccup here must not
 * hand somebody another company's data, so an unreadable row is refused —
 * transiently, and the message says to try again.
 */
const SCOPED_BY: Record<string, {
  /** Where the row lives. */
  table: 'pms_policies' | 'pms_periods' | 'pms_rating_scale'
       | 'pms_kra_master' | 'pms_chain' | 'pms_training_catalogue'
  /** Body keys that may carry its id, in the order the case reads them.
   *  An action whose keys are all absent is creating rather than editing,
   *  and creation is already pinned by companyFilter. */
  keys: readonly string[]
}> = {
  kra_upsert:           { table: 'pms_kra_master',         keys: ['id'] },
  kra_set_active:       { table: 'pms_kra_master',         keys: ['id'] },
  catalogue_upsert:     { table: 'pms_training_catalogue', keys: ['id'] },
  catalogue_set_active: { table: 'pms_training_catalogue', keys: ['id'] },
  chain_upsert:         { table: 'pms_chain',              keys: ['id'] },
  chain_set_active:     { table: 'pms_chain',              keys: ['id'] },
  policy_update:        { table: 'pms_policies',           keys: ['id'] },
  scale_upsert:         { table: 'pms_rating_scale',       keys: ['id'] },
  // Keyed on the POLICY, not a period: this one creates the periods.
  periods_generate:     { table: 'pms_policies',           keys: ['policy_id'] },
  period_update:        { table: 'pms_periods',    keys: ['period_id', 'id'] },
  period_open:          { table: 'pms_periods',            keys: ['period_id'] },
  finalise:             { table: 'pms_periods',            keys: ['period_id'] },
  kra_action:           { table: 'pms_periods',            keys: ['period_id'] },
  kra_lock:             { table: 'pms_periods',            keys: ['period_id'] },
  upload_commit:        { table: 'pms_periods',            keys: ['period_id'] },
}

type Grant = Awaited<ReturnType<typeof grantForRequest>>
type ScopedTable = (typeof SCOPED_BY)[keyof typeof SCOPED_BY]['table']

/**
 * Refuse one row that belongs to a company this caller's roles are not valid
 * in. Returns a response to send, or null to carry on.
 *
 * The first test mirrors companyFilter's first branch EXACTLY: a caller who
 * already reaches beyond their own company — a super admin, an ORG-scoped
 * role, or the legacy shared dashboard login, which has no employee row and
 * therefore no company — is the same caller companyFilter lets pick any
 * company. Nothing changes for them, which is what keeps today's dashboard
 * working while the gap closes for everybody else.
 *
 * `groupIsFine` separates EDITING a row from POINTING AT one. A chain with no
 * company belongs to the whole group: changing it changes every company, so
 * that takes group reach — but a single company's policy may perfectly well
 * USE it, which is what the group library is for.
 */
async function rowOutOfScope(
  grant: Grant, table: ScopedTable, id: string,
  opts: { groupIsFine?: boolean } = {},
): Promise<NextResponse | null> {
  // Asked before the read, so an unrestricted caller costs no round trip.
  // scopeVerdict asks it again — it has to, being pure — and they agree
  // because tenancy.ts copied the test from companyFilter.
  if (grant.crossCompany || !grant.companyId) return null

  const r = await sb.from(table).select('company_id').eq('id', id).maybeSingle()
  if (r.error) {
    return bad('Could not check which company this belongs to, so nothing '
             + 'was changed. Try again in a moment.', 503)
  }
  if (!r.data) {
    return bad('That no longer exists. Reload the screen — somebody may have '
             + 'removed it.', 404)
  }

  const verdict = scopeVerdict({
    crossCompany: grant.crossCompany,
    companyId: grant.companyId,
    allowed: allowedCompanies(grant, 'Performance'),
    owner: r.data.company_id as string | null,
    groupIsFine: opts.groupIsFine,
  })
  return verdict === 'ALLOWED' ? null : bad(scopeRefusal(verdict), 403)
}

/** The same question asked of whatever row THIS ACTION names. */
async function outOfScope(
  grant: Grant, action: string, body: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (grant.crossCompany || !grant.companyId) return null

  const rule = SCOPED_BY[action]
  if (!rule) return null            // not an action that names a row

  const id = rule.keys
    .map(k => typeof body[k] === 'string' ? (body[k] as string).trim() : '')
    .find(v => v.length > 0)
  if (!id) return null              // creating, not editing

  return rowOutOfScope(grant, rule.table, id)
}

async function gate(req: NextRequest, action?: string,
                    body?: Record<string, unknown>) {
  const grant = await grantForRequest(req)
  const periodId = typeof body?.period_id === 'string' ? body.period_id : null
  const manages = canManage(grant, 'Performance')
  const hrMay = !!action && HR_ACTIONS.has(action)
             && await uploadAllowed(grant, periodId)
  if (!manages && !hrMay) {
    return { error: bad(action && HR_ACTIONS.has(action)
      ? 'A bulk rating upload is HR\'s to commit. This account is not an HR '
        + 'Manager, HR Head or Admin.'
      : 'You need full access to Performance to change this.', 403) } as const
  }
  // AFTER the level check and before anything is written: knowing WHAT a
  // caller may do comes first, WHOSE row it is second.
  if (action) {
    const wrongCompany = await outOfScope(grant, action, body ?? {})
    if (wrongCompany) return { error: wrongCompany } as const
  }
  const actor = await actorFromRequest(req)
  return { grant, actor } as const
}

// ─── GET: everything the editor renders ──────────────────────────────────
export async function GET(req: NextRequest) {
  const g = await gate(req)
  if ('error' in g) return g.error

  const [policies, kras, scale, periods, companies, people, catalogue,
         chains] = await Promise.all([
    sb.from('pms_policies').select('*').order('policy_name'),
    sb.from('pms_kra_master').select('*').order('kra_title').limit(500),
    sb.from('pms_rating_scale').select('*').order('sort_order'),
    sb.from('pms_periods').select('*').order('period_start', { ascending: true }).limit(200),
    // EVERY COMPANY RUNS ITS OWN PERIODS, so "Q2 2026-27" appears once per
    // company and the lists could not tell them apart. On the window editor
    // that is confusing; on "Open a period" it is dangerous, because opening
    // enrols everybody and cannot be undone from the screen. The name is what
    // makes the choice legible.
    sb.from('companies').select('id,company_name'),
    // 205: the HR Head picker. Active employees only, with their company, so
    // the dropdown on a policy offers that company's people rather than the
    // whole group — three organisations share this database and the employee
    // codes repeat across them.
    //
    // Non-fatal, like the company names above: if this read fails the editor
    // still renders and the HR Head field simply has nobody to offer.
    sb.from('employees').select('id,emp_code,full_name,company_id')
      .is('date_of_leaving', null).order('emp_code').limit(5000),
    // 215. Non-fatal too, and for a sharper reason than the others: this
    // table may not exist yet on a database where 215 has not run, and the
    // rest of Setup & Controls has nothing to do with it.
    sb.from('pms_training_catalogue').select('*')
      .order('course_name').limit(1000),
    // 218. Non-fatal for the same reason as the catalogue.
    sb.from('pms_chain').select('*').order('name').limit(200),
  ])
  const firstError = [policies, kras, scale, periods].find(r => r.error)?.error
  if (firstError) return bad(firstError.message, 500)
  if (companies.error) console.error('[pms] could not read company names:', companies.error)
  if (people.error) console.error('[pms] could not read the employee list:', people.error)
  if (catalogue.error) console.error('[pms] training catalogue unreadable:', catalogue.error)
  if (chains.error) console.error('[pms] chain library unreadable:', chains.error)

  // After the batch above rather than inside it: six count reads that only the
  // chain builder uses should not sit in the path that decides whether the
  // whole editor renders.
  const coverage = chains.error ? null : await rungCoverage()

  return NextResponse.json({
    policies: policies.data ?? [],
    kras:     kras.data ?? [],
    scale:    scale.data ?? [],
    periods:  periods.data ?? [],
    companies: companies.data ?? [],
    people: people.data ?? [],
    catalogue: catalogue.data ?? [],
    chains:    chains.data ?? [],
    coverage,
    // The UI hides attribution-only actions when there is no employee behind
    // the session, rather than letting the button fail on click.
    actor: { employeeId: g.actor.employeeId, name: g.actor.name, legacy: g.actor.legacy },
  })
}

// ─── POST: one write ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // READ BEFORE GATING, because the gate depends on WHICH action is being
  // asked for — the upload is HR's, the rest is admin configuration.
  // Parsing JSON has no side effects, and an unparseable body yields an
  // empty action, which matches no case and is refused as admin-only.
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')

  // The WHOLE BODY goes to the gate now, not just the period. 217 made the
  // upload's answer depend on which company's policy it lands in, and the
  // scope check needs whichever id this particular action names — a policy,
  // a period, a band, a chain. Nothing is written from it there; gate reads.
  const g = await gate(req, action, body)
  if ('error' in g) return g.error
  const { actor } = g

  const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim())
    ? (body[k] as string).trim() : null

  // Actions that write a person's name into the record. The legacy shared
  // dashboard login is not attached to an employee, so it cannot sign them.
  const NEEDS_ACTOR = new Set(['kra_action', 'kra_lock', 'finalise'])
  if (NEEDS_ACTOR.has(action) && !actor.employeeId) {
    return bad('This action is recorded against a named person, and this '
             + 'session is the shared dashboard login. Sign in with your own '
             + 'ESS account to do it.', 403)
  }

  switch (action) {

    // ── KRA library ────────────────────────────────────────────────────
    case 'kra_upsert': {
      const id = str('id')
      const fields = pick(body, KRA_COLS)
      if (!id && !fields.kra_title) return bad('A KRA needs a title.')
      if (id) {
        const r = await sb.from('pms_kra_master').update(fields).eq('id', id).select().single()
        return r.error ? bad(r.error.message) : okay(r.data)
      }
      const company = companyFilter(g.grant, str('company_id'), 'Performance')
      if (!company) return bad('Which company is this KRA for?')
      const r = await sb.from('pms_kra_master')
        .insert({ ...fields, company_id: company }).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // Deactivate rather than delete: a KRA may already be referenced by an
    // employee's goals for a live period, and removing the row would orphan
    // them mid-cycle.
    case 'kra_set_active': {
      const id = str('id')
      if (!id) return bad('Which KRA?')
      const r = await sb.from('pms_kra_master')
        .update({ is_active: body.is_active === true }).eq('id', id).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // ── the training catalogue (215) ───────────────────────────────────
    //
    // The corpus the AI suggestion retrieves from. Until it has rows every
    // suggestion is a skill area, because the model is not allowed to name
    // a course it cannot vouch for.
    case 'catalogue_upsert': {
      const id = str('id')
      const fields = pick(body, CATALOGUE_COLS)
      if (!id && !fields.course_name) return bad('A course needs a name.')
      // THE SKILL IS NOT OPTIONAL. Retrieval scores it three times higher
      // than the title, so a row without one is a course the suggestion
      // engine can never find — present in the catalogue and invisible in
      // practice, which is worse than absent.
      if (!id && !String(fields.skill ?? '').trim()) {
        return bad('Say what this course teaches, in the words a manager '
                 + 'would use in a review. It is what the suggestion '
                 + 'matches on \u2014 a course with no skill is one the AI '
                 + 'can never surface.')
      }
      if (id) {
        const r = await sb.from('pms_training_catalogue')
          .update(fields).eq('id', id).select().single()
        return r.error ? bad(r.error.message) : okay(r.data)
      }
      /**
       * NULL COMPANY MEANS THE WHOLE GROUP, and that is a deliberate
       * choice rather than a missing value — so it is only honoured when
       * the person actually works across companies. For everybody else
       * companyFilter pins it to theirs.
       */
      const wantsGroup = body.company_id === null
      const company = wantsGroup && g.grant.crossCompany
        ? null : companyFilter(g.grant, str('company_id'))
      if (!company && !wantsGroup) return bad('Which company is this course for?')
      const r = await sb.from('pms_training_catalogue')
        .insert({ ...fields, company_id: company }).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // Retired, not deleted: a suggestion already in somebody's bin points
    // at this row, and removing it would leave them holding a reference to
    // a course nobody can look up.
    case 'catalogue_set_active': {
      const id = str('id')
      if (!id) return bad('Which course?')
      const r = await sb.from('pms_training_catalogue')
        .update({ is_active: body.is_active === true }).eq('id', id).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // ── the chain library (218) ────────────────────────────────────────
    //
    // chainFault runs HERE as well as in the browser, and that is not
    // belt-and-braces: the browser copy exists to explain, this one exists
    // to refuse. A posted body never reached the browser's validation.
    case 'chain_upsert': {
      const id = str('id')
      const fields = pick(body, CHAIN_COLS)
      const posted = Array.isArray(body.rungs) ? body.rungs.map(String) : null

      // An edit that changes only the notes leaves the rungs alone. An edit
      // that sends them has to survive the same check a new chain does.
      if (posted || !id) {
        const fault = chainFault({
          name: (fields.name as string | undefined) ?? (id ? 'unchanged' : ''),
          rungs: posted ?? [],
        })
        if (fault) return bad(fault)
      }
      const patch: Record<string, unknown> = { ...fields }
      if (posted) patch.rungs = normaliseRungs(posted)

      if (id) {
        /**
         * AN EDIT DOES NOT REACH APPRAISALS ALREADY RUNNING.
         *
         * pms_overall_rating.chain_shape and chain_snapshot_at freeze the
         * chain per appraisal when it starts, so nobody mid-review finds a
         * rung has appeared or vanished beneath them — which is what the
         * user chose when asked ("keep the chain they started on"). Nothing
         * here has to enforce that; it is worth saying because the opposite
         * assumption is the natural one.
         */
        const r = await sb.from('pms_chain')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id).select().single()
        return r.error ? bad(r.error.message) : okay(r.data)
      }
      // NULL COMPANY MEANS THE WHOLE GROUP, honoured only for somebody who
      // actually works across companies — same rule as a KRA or a course.
      const wantsGroup = body.company_id === null
      const company = wantsGroup && g.grant.crossCompany
        ? null : companyFilter(g.grant, str('company_id'))
      if (!company && !wantsGroup) return bad('Which company is this chain for?')
      const r = await sb.from('pms_chain')
        .insert({ ...patch, company_id: company }).select().single()
      return r.error
        ? bad(r.error.message.includes('pms_chain_company_id_name_key')
            ? 'There is already a chain with that name here. Pick another name '
              + 'so the two can be told apart on a policy.'
            : r.error.message)
        : okay(r.data)
    }

    /**
     * Retired, not deleted — and REFUSED while a policy still points at it.
     *
     * Deactivating a chain in use would leave the policy's chain_id pointing
     * at it and the chain still deciding, so the switch would read as off and
     * behave as on. Naming the policies is the only useful response: the fix
     * is to move them first, and nobody can do that without knowing which.
     */
    case 'chain_set_active': {
      const id = str('id')
      if (!id) return bad('Which chain?')
      const off = body.is_active !== true
      if (off) {
        const pol = await sb.from('pms_policies')
          .select('id,policy_name,chain_id').eq('chain_id', id)
        if (pol.error) return bad(pol.error.message, 500)
        const names = usedBy(id, pol.data ?? [])
        if (names.length) {
          return bad(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} `
            + 'still using this chain. Point '
            + `${names.length === 1 ? 'it' : 'them'} at another chain first — `
            + 'switching this off while it is in use would leave it running '
            + 'and look as though it had stopped.')
        }
      }
      const r = await sb.from('pms_chain')
        .update({ is_active: !off, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // ── Per-employee KRA approvals ─────────────────────────────────────
    case 'kra_action': {
      const employee = str('employee_id'), period = str('period_id')
      const what = (str('kra_action_type') ?? '').toUpperCase()
      const reason = str('reason')
      if (!employee || !period) return bad('Which employee, and which period?')
      if (!['EDIT', 'REISSUE', 'TERMINATE'].includes(what)) {
        return bad('The action must be EDIT, REISSUE or TERMINATE.')
      }
      if (!reason) return bad('A reason is required. It goes into the audit log.')
      if (what === 'EDIT' && !str('goal_id')) return bad('EDIT needs the goal to edit.')

      const r = await sb.rpc('pms_hr_kra_action', {
        p_employee_id: employee, p_period_id: period, p_action: what,
        p_actor_id: actor.employeeId, p_reason: reason, p_goal_id: str('goal_id'),
      })
      if (r.error) return bad(r.error.message)
      // Returns a one-row table (ok, affected, message) — surface its own
      // wording rather than inventing a success line that might contradict it.
      const row = Array.isArray(r.data) ? r.data[0] : r.data
      return okay(row)
    }

    case 'kra_lock': {
      const employee = str('employee_id'), period = str('period_id')
      if (!employee || !period) return bad('Which employee, and which period?')
      const r = await sb.rpc('pms_lock_kras', {
        p_employee_id: employee, p_period_id: period, p_manager_id: actor.employeeId,
      })
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // ── Policy and rating scale ────────────────────────────────────────
    case 'policy_update': {
      const id = str('id')
      if (!id) return bad('Which policy?')
      const fields = pick(body, POLICY_COLS)
      if (!Object.keys(fields).length) return bad('Nothing to change.')

      /**
       * WHERE THIS POLICY IS BEING POINTED, as well as whose it is.
       *
       * gate() has checked the policy itself. chain_id is in POLICY_COLS, so
       * this edit can also hang the policy off a chain — and another
       * company's chain is a configuration nobody here should be reading,
       * let alone appraising against. A GROUP chain is fine and is the whole
       * point of the group library, hence groupIsFine.
       */
      if (typeof fields.chain_id === 'string' && fields.chain_id.trim()) {
        const wrongCompany = await rowOutOfScope(
          g.grant, 'pms_chain', fields.chain_id.trim(), { groupIsFine: true })
        if (wrongCompany) return wrongCompany
      }

      /**
       * THE KPI RANGE, EXPLAINED BEFORE THE DATABASE REFUSES IT.
       *
       * CHECK pms_policies_kpi_range is still what makes this impossible;
       * this only makes the refusal legible. Without it the admin screen
       * showed the constraint violation verbatim, which names no field and
       * no value — and because one constraint covers three different
       * mistakes, there was no way to tell which had been made.
       *
       * THE STORED ROW IS READ because this is a PATCH. A body that sends
       * only max_kpi_per_kra still has to hold against the minimum already
       * stored, and judging the pair on the half that was sent would pass
       * writes the database then rejects — which is the bug, not a fix for
       * it. Only read when one of the two is actually being changed.
       */
      const touchesKpiRange = fields.min_kpi_per_kra !== undefined
                           || fields.max_kpi_per_kra !== undefined
      if (touchesKpiRange) {
        const cur = await sb.from('pms_policies')
          .select('min_kpi_per_kra, max_kpi_per_kra').eq('id', id).single()
        if (cur.error) return bad(cur.error.message, cur.error.code === 'PGRST116' ? 404 : 500)
        const fault = policyKpiRangeFault(
          (fields.min_kpi_per_kra ?? cur.data.min_kpi_per_kra) as number,
          (fields.max_kpi_per_kra ?? cur.data.max_kpi_per_kra) as number,
        )
        if (fault) return bad(fault)
      }

      const r = await sb.from('pms_policies').update(fields).eq('id', id).select().single()
      // A constraint can still fire — a concurrent edit, or a rule this
      // route does not model. Saying so beats the raw violation text.
      if (r.error?.message.includes('pms_policies_kpi_range')) {
        return bad('That leaves the KPI range impossible: the minimum has to '
                 + 'be at least 1, the maximum at least the minimum, and the '
                 + 'maximum no more than 20. Reload the policy and try again '
                 + '— somebody may have changed it since this screen loaded.')
      }
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    case 'scale_upsert': {
      const id = str('id')
      const fields = pick(body, SCALE_COLS)

      /**
       * THE DESTINATION IS A SCOPE QUESTION TOO.
       *
       * gate() has already checked the BAND this edits. policy_id is in
       * SCALE_COLS, so the band can also be pointed somewhere — and a band
       * of ours attached to another company's policy is the same leak
       * wearing different clothes. It applies on insert as well: company_id
       * comes from companyFilter and would be ours while the policy it hangs
       * off is not.
       */
      if (typeof fields.policy_id === 'string' && fields.policy_id.trim()) {
        const wrongCompany = await rowOutOfScope(
          g.grant, 'pms_policies', fields.policy_id.trim())
        if (wrongCompany) return wrongCompany
      }

      if (id) {
        const r = await sb.from('pms_rating_scale').update(fields).eq('id', id).select().single()
        return r.error ? bad(r.error.message) : okay(r.data)
      }
      const company = companyFilter(g.grant, str('company_id'), 'Performance')
      if (!company) return bad('Which company is this band for?')
      const r = await sb.from('pms_rating_scale')
        .insert({ ...fields, company_id: company }).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // ── Cycle control ──────────────────────────────────────────────────
    case 'periods_generate': {
      const policy = str('policy_id'), fy = str('fy'), start = str('fy_start')
      if (!policy || !fy || !start) return bad('Policy, financial year and its start date are all needed.')
      const r = await sb.rpc('pms_generate_periods', {
        p_policy_id: policy, p_fy: fy, p_fy_start: start,
      })
      return r.error ? bad(r.error.message) : okay({ created: r.data })
    }

    // Correcting a period's windows — including reopening one that has closed.
    //
    // A window that has passed is the common case: the employee's screen says
    // "You missed the self-rating window" and offers to have it reopened, and
    // until now that offer led nowhere. Moving a window changes who may act and
    // when; it does not change what has already been recorded.
    case 'period_update': {
      const id = str('period_id') || str('id')
      if (!id) return bad('Which period?')
      const fields = pick(body, PERIOD_COLS)
      if (!Object.keys(fields).length) return bad('Nothing to change.')
      // A window has to end on or after it starts, or it is open to nobody and
      // the screens read it as "no window configured" instead of "closed".
      for (const [from, to, what] of [
        ['kra_window_from', 'kra_window_to', 'KRA'],
        ['checkin_from', 'checkin_to', 'check-in'],
        ['self_rating_from', 'self_rating_to', 'self-rating'],
        ['rm_review_from', 'rm_review_to', 'manager review'],
        ['finalise_from', 'finalise_to', 'finalise'],
      ] as const) {
        const a = fields[from] as string | undefined, b = fields[to] as string | undefined
        if (a && b && a > b) return bad(`The ${what} window would end before it starts.`)
      }
      const r = await sb.from('pms_periods').update(fields).eq('id', id).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    // Opening a period ENROLS EVERY ELIGIBLE EMPLOYEE and writes a row each.
    // There is no close_period to undo it — reversing means deleting those
    // rows by hand. So it takes an explicit confirm flag that the UI only
    // sets after the person types the period's name.
    case 'period_open': {
      const period = str('period_id')
      if (!period) return bad('Which period?')
      if (body.confirm !== true) {
        return bad('Opening a period enrols every eligible employee and cannot '
                 + 'be undone from this screen. Confirm to continue.', 428)
      }
      const r = await sb.rpc('pms_open_period', { p_period_id: period })
      return r.error ? bad(r.error.message) : okay({ message: r.data })
    }

    // ── Finalisation ───────────────────────────────────────────────────
    case 'finalise': {
      const employee = str('employee_id'), period = str('period_id')
      const role = str('actor_role')
      const rating = Number(body.rating)
      if (!employee || !period) return bad('Which employee, and which period?')
      if (!role) return bad('Which role are you finalising as?')
      if (!Number.isFinite(rating)) return bad('A rating is required.')
      const r = await sb.rpc('pms_finalise', {
        p_employee_id: employee, p_period_id: period,
        p_actor_id: actor.employeeId, p_actor_role: role,
        p_rating: rating, p_reason: str('reason'),
      })
      return r.error ? bad(r.error.message) : okay({ message: r.data })
    }

    /**
     * §6.4 — commit a bulk rating upload.
     *
     * The rows go to the database UNCHECKED by this route, deliberately.
     * pms_commit_rating_upload re-validates every one of them against the
     * live tables, and that is where the decision belongs: a check here would
     * be a third copy of the same rules, able to disagree with both the
     * browser preview and the function.
     *
     * One RPC, so one transaction. A loop here would be the part-applied
     * batch the whole feature is built to prevent.
     */
    case 'upload_commit': {
      const period = str('period_id')
      if (!period) return bad('Which period is this upload for?')
      if (!Array.isArray(body.rows)) return bad('No rows were sent.')
      if (!body.rows.length) return bad('That file had no data rows.')
      // Attributable or not at all — the function refuses a null actor too,
      // but saying it here costs nothing and names the fix.
      if (!actor.employeeId) {
        return bad('This session is the shared dashboard login, which is not '
                 + 'attached to an employee record. A bulk override is recorded '
                 + 'against a named person, so sign in with your own account.')
      }
      const r = await sb.rpc('pms_commit_rating_upload', {
        p_period_id: period, p_actor_id: actor.employeeId,
        p_actor_role: str('actor_role') || 'HR_MANAGER',
        p_rows: body.rows,
      })
      if (r.error) return bad(r.error.message)
      const res = (r.data ?? {}) as { ok?: boolean; message?: string }
      // A refused batch is not a transport failure: it returns ok:false with
      // a sentence for the admin, and the attempt is logged either way.
      return res.ok === false
        ? bad(String(res.message ?? 'The upload was refused.'))
        : okay(r.data as Record<string, unknown>)
    }

    default:
      return bad(`Unknown action '${action}'.`)
  }
}
