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
import { companyFilter } from '@/lib/rms/resolve'
import { canManage } from '@/lib/rms/resolve'

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
  // 202. Same reason as the line above: a policy column is INERT until it is
  // named here, so the admin screen's new control would have saved silently
  // into nothing — the precise shape of the "my configuration changes do not
  // take effect" bug reported against this module once already.
  'post_final_owner',
  // 203. Inert until named here, same as every column above it.
  'publish_scope',
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

const SCALE_COLS = [
  'policy_id', 'rating_value', 'rating_code', 'rating_label',
  'score_from', 'score_to', 'min_comment_chars',
  'improvement_feedback_mandatory', 'allows_pip_request',
  'colour_hex', 'sort_order', 'is_active',
] as const

function pick(body: Record<string, unknown>, cols: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const c of cols) if (body[c] !== undefined) out[c] = body[c]
  return out
}

async function gate(req: NextRequest) {
  const grant = await grantForRequest(req)
  if (!canManage(grant, 'Performance')) {
    return { error: bad('You need full access to Performance to change this.', 403) } as const
  }
  const actor = await actorFromRequest(req)
  return { grant, actor } as const
}

// ─── GET: everything the editor renders ──────────────────────────────────
export async function GET(req: NextRequest) {
  const g = await gate(req)
  if ('error' in g) return g.error

  const [policies, kras, scale, periods, companies] = await Promise.all([
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
  ])
  const firstError = [policies, kras, scale, periods].find(r => r.error)?.error
  if (firstError) return bad(firstError.message, 500)
  if (companies.error) console.error('[pms] could not read company names:', companies.error)

  return NextResponse.json({
    policies: policies.data ?? [],
    kras:     kras.data ?? [],
    scale:    scale.data ?? [],
    periods:  periods.data ?? [],
    companies: companies.data ?? [],
    // The UI hides attribution-only actions when there is no employee behind
    // the session, rather than letting the button fail on click.
    actor: { employeeId: g.actor.employeeId, name: g.actor.name, legacy: g.actor.legacy },
  })
}

// ─── POST: one write ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const g = await gate(req)
  if ('error' in g) return g.error
  const { actor } = g

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')
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
      const company = companyFilter(g.grant, str('company_id'))
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
      const r = await sb.from('pms_policies').update(fields).eq('id', id).select().single()
      return r.error ? bad(r.error.message) : okay(r.data)
    }

    case 'scale_upsert': {
      const id = str('id')
      const fields = pick(body, SCALE_COLS)
      if (id) {
        const r = await sb.from('pms_rating_scale').update(fields).eq('id', id).select().single()
        return r.error ? bad(r.error.message) : okay(r.data)
      }
      const company = companyFilter(g.grant, str('company_id'))
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
