// lib/notifications/dispatch.ts — send a notification to the right people.
//
// One entry point, `notify()`. Callers name the CODE and the subject employee;
// this resolves recipients from org structure and writes the rows. Nothing
// outside this file should insert into ess_notifications directly, or the
// routing rules end up restated in a dozen places and drift.
//
// ── RESOLUTION ──────────────────────────────────────────────────────────────
// Recipients come from the org, not from a role table: you are an RM because
// people report to you, an HOD because a department points at you. Same rule
// as PMS. user_roles has 0 rows, so anything keyed on it would silently send
// to nobody.
//
// ── FAILING QUIETLY IS THE POINT ────────────────────────────────────────────
// A notification is never the reason a business action fails. If leave is
// approved and the insert breaks, the leave stays approved and we log. Every
// path here returns rather than throws.
//
// ── THE CODE GOES IN `category` ─────────────────────────────────────────────
// ess_notifications (migration 021) has no notification_code column. `category`
// is free TEXT and already holds codes like 'BIRTHDAY', so the code lives
// there and the feature works against today's schema. 075 adds the real
// column; this file writes both once it exists, via NOTIF_HAS_CODE.

import { rmsServiceClient as sb } from '@/lib/rms/server'
import { def, type Audience } from './catalogue'

/** True since 075 was applied (02-Sep-2026). All four columns it adds —
 *  notification_code, priority, read_at, actor_employee_id — were confirmed present
 *  on ess_notifications before this was flipped; inserting an unknown column fails
 *  the whole row, so this must never lead the migration. */
const NOTIF_HAS_CODE = true

export interface NotifyOptions {
  /** The employee the event is ABOUT. Recipients are resolved relative to them. */
  subjectId: string
  code: string
  title: string
  body?: string
  /** Overrides the catalogue's default landing page. */
  link?: string
  /** For PEER codes — the explicit recipient, e.g. the person being wished. */
  toEmployeeId?: string
  /** Skip resolution and send to exactly these people. */
  toOverride?: string[]
}

interface Row { employee_id: string; category: string; title: string; body: string | null; link: string | null; is_read: boolean }

/** Who should receive `audience`, given the employee the event is about. */
async function resolve(audience: Audience, subjectId: string, toEmployeeId?: string): Promise<string[]> {
  if (audience === 'PEER') return toEmployeeId ? [toEmployeeId] : []
  if (audience === 'SELF') return [subjectId]

  const { data: emp } = await sb.from('employees')
    .select('id, l1_manager_id, l2_manager_id, hod_id, department_id, company_id')
    .eq('id', subjectId).maybeSingle()
  if (!emp) return []

  switch (audience) {
    case 'RM_L1': return emp.l1_manager_id ? [emp.l1_manager_id] : []
    case 'RM_L2': return emp.l2_manager_id ? [emp.l2_manager_id] : []

    case 'HOD': {
      // Same order the PMS resolver uses: the per-person override first, then
      // the department. No fallback to L2 — a notification sent to the wrong
      // approver is worse than one nobody receives, because it looks handled.
      if (emp.hod_id) return [emp.hod_id]
      if (!emp.department_id) return []
      const { data: d } = await sb.from('departments')
        .select('hod_employee_id').eq('id', emp.department_id).maybeSingle()
      return d?.hod_employee_id ? [d.hod_employee_id] : []
    }

    // Functional audiences resolve through ess_roles/ess_user_roles, scoped to
    // the subject's company. Deliberately NOT user_roles, which has 0 rows and
    // would resolve to nobody every time.
    case 'HR_MANAGER': return byRole(['HR_MANAGER', 'HR_HEAD', 'CHRO'], emp.company_id)
    case 'HR_HEAD':    return byRole(['HR_HEAD', 'CHRO'], emp.company_id)
    case 'FINANCE':    return byRole(['FINANCE_EXECUTIVE', 'CFO'], emp.company_id)
    case 'PAYROLL':    return byRole(['PAYROLL', 'PAYROLL_ADMIN'], emp.company_id)
    case 'IT_ADMIN':   return byRole(['IT', 'ADMIN_COMPANY', 'ADMIN_SUPER'], emp.company_id)

    case 'MD': {
      if (!emp.company_id) return []
      const { data: c } = await sb.from('companies')
        .select('md_employee_id').eq('id', emp.company_id).maybeSingle()
      return c?.md_employee_id ? [c.md_employee_id] : []
    }
    default: return []
  }
}

/**
 * Employees holding any of `roleCodes`, in one company.
 *
 * The join is ess_roles -> ess_user_roles -> ess_accounts -> employees. Note
 * ess_user_roles keys on ess_account_id, NOT employee_id, and the role table
 * is ess_roles, not roles — verified against the live schema, because getting
 * either wrong makes this return nobody silently rather than erroring.
 *
 * Only 8 role assignments exist today across 270 accounts, so most functional
 * audiences resolve to a handful of people or none. That is a data gap, not a
 * bug here.
 */
async function byRole(roleCodes: string[], companyId: string | null): Promise<string[]> {
  const { data: roles } = await sb.from('ess_roles').select('id, role_code').in('role_code', roleCodes)
  const roleIds = (roles ?? []).map(r => r.id)
  if (!roleIds.length) return []

  const { data: links } = await sb.from('ess_user_roles')
    .select('ess_account_id').in('role_id', roleIds).eq('is_active', true)
  const accountIds = Array.from(new Set((links ?? []).map(l => l.ess_account_id).filter(Boolean)))
  if (!accountIds.length) return []

  const { data: accounts } = await sb.from('ess_accounts')
    .select('employee_id').in('id', accountIds)
  const ids = Array.from(new Set((accounts ?? []).map(a => a.employee_id).filter(Boolean)))
  if (!ids.length) return []

  // Scope to the subject's company and drop leavers — a three-company instance
  // should not tell all of HR about one department's event.
  let qb = sb.from('employees').select('id').in('id', ids).is('date_of_leaving', null)
  if (companyId) qb = qb.eq('company_id', companyId)
  const { data: emps } = await qb
  return (emps ?? []).map(e => e.id)
}

export interface NotifyResult {
  /** Rows written. */
  sent: number
  /** Recipients with no active ESS account — the row exists, but they cannot
   *  log in to read it. 128 of 398 active employees are in this position, so
   *  this is common, not exotic. Callers should surface it rather than
   *  reporting plain success: telling somebody "wished!" for a message that
   *  can never be seen is worse than telling them nothing. */
  undeliverable: { employee_id: string; full_name: string }[]
}

/**
 * Send one notification. Returns how many rows were written and who among the
 * recipients cannot actually read them. 0 sent is a normal outcome (nobody
 * holds the role, no HOD is mapped) and never an exception.
 */
export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  const empty: NotifyResult = { sent: 0, undeliverable: [] }
  const d = def(opts.code)
  if (!d) {
    console.warn(`[notify] unknown code ${opts.code} — not sent`)
    return empty
  }

  try {
    const to = opts.toOverride?.length
      ? opts.toOverride
      : await resolve(d.audience, opts.subjectId, opts.toEmployeeId)

    // Nobody should be told about their own action — approving your own leave
    // request should not put a row in your bell.
    const recipients = Array.from(new Set(to.filter(Boolean)))
      .filter(id => d.audience === 'SELF' || d.audience === 'PEER' || id !== opts.subjectId)
    if (!recipients.length) return empty

    // Who among them can actually open the portal. The row is still written
    // for everyone — an account may be created later and the history should
    // survive — but the caller is told who cannot see it.
    const { data: accts } = await sb.from('ess_accounts')
      .select('employee_id').in('employee_id', recipients).eq('status', 'ACTIVE')
    const canLogIn = new Set((accts ?? []).map(a => a.employee_id))
    const blindIds = recipients.filter(id => !canLogIn.has(id))
    let undeliverable: NotifyResult['undeliverable'] = []
    if (blindIds.length) {
      const { data: names } = await sb.from('employees').select('id, full_name').in('id', blindIds)
      undeliverable = (names ?? []).map(n => ({ employee_id: n.id, full_name: n.full_name }))
    }

    const rows: Row[] = recipients.map(employee_id => ({
      employee_id,
      category: opts.code,                 // the code lives here — see header
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? d.link,
      is_read: false,
      ...(NOTIF_HAS_CODE ? { notification_code: opts.code, priority: d.priority } : {}),
    }))

    const { error } = await sb.from('ess_notifications').insert(rows)
    if (error) { console.warn(`[notify] ${opts.code} insert failed: ${error.message}`); return empty }
    if (undeliverable.length) {
      console.warn(`[notify] ${opts.code}: ${undeliverable.length} recipient(s) have no active ESS account`)
    }
    return { sent: rows.length, undeliverable }
  } catch (e) {
    // Never let a notification take down the action that triggered it.
    console.warn(`[notify] ${opts.code} threw:`, e)
    return empty
  }
}

/** Fan one event out to several audiences — build note 3: ROLE_CHANGED and
 *  HRHEAD_ROLE_GOVERNANCE are the same change, two recipients, one write each. */
export async function notifyMany(list: NotifyOptions[]): Promise<NotifyResult> {
  const out: NotifyResult = { sent: 0, undeliverable: [] }
  for (const o of list) {
    const r = await notify(o)
    out.sent += r.sent
    out.undeliverable.push(...r.undeliverable)
  }
  return out
}
