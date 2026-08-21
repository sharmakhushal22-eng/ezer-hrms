// app/api/rms/admin/route.ts — every write that changes who can do what.
//
// These used to happen straight from the browser on the anon key. Migration 028 had
// granted anon FOR ALL on the permission tables, so anybody could grant themselves
// SUPER_ADMIN with one POST from a console. Migration 055 takes that write away; this is
// where the writes moved to.
//
// Three things happen on every action, in this order, and none of them is optional:
//   1. the caller is resolved from their signed token — never from the request body
//   2. the caller is checked for the right to administer roles
//   3. what changed, who changed it and why is written to ess_access_audit
import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, actorFromRequest, rmsServiceClient as sb } from '@/lib/rms-server'
import { canAdministerRoles, SUPER_ADMIN, type AccessLevel } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const today = () => new Date().toISOString().slice(0, 10)

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** One audit row per change, with the reason the screen made the user type. `details`
 *  carries before and after so a reviewer can see what actually moved, not just that
 *  something did. */
async function audit(opts: {
  accountId?: string | null
  action: string
  actor: { employeeId: string | null; name: string | null; legacy: boolean }
  reason?: string | null
  details?: any
}) {
  await sb.from('ess_access_audit').insert({
    ess_account_id: opts.accountId || null,
    action: opts.action,
    performed_by: opts.actor.employeeId,
    // A legacy session has no employee row behind it, so say so rather than leaving a
    // blank that reads like the system did it by itself.
    performed_by_name: opts.actor.name || (opts.actor.legacy ? 'Legacy dashboard login' : 'Unknown'),
    reason: opts.reason || null,
    details: opts.details || null,
  })
}

/** The account row for an employee, created if it does not exist yet. Accounts are made
 *  INACTIVE and without a password — HR still issues credentials from
 *  /dashboard/ess-credentials. This only exists so a role has something to hang off. */
async function accountFor(employeeId: string): Promise<string | null> {
  const { data: found } = await sb.from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle()
  if (found?.id) return found.id as string
  const { data: made } = await sb
    .from('ess_accounts')
    .insert({ employee_id: employeeId, status: 'INACTIVE' })
    .select('id')
    .single()
  return (made?.id as string) ?? null
}

/** How many people currently hold SUPER_ADMIN. Used to refuse the change that would
 *  leave nobody able to repair the permission matrix. The database refuses it too
 *  (migration 055) — this check exists so the screen can say why instead of showing a
 *  constraint violation. */
async function superAdminHolders(): Promise<string[]> {
  const { data: role } = await sb.from('ess_roles').select('id').eq('role_code', SUPER_ADMIN).maybeSingle()
  if (!role?.id) return []
  const { data } = await sb
    .from('ess_user_roles')
    .select('ess_account_id')
    .eq('role_id', role.id)
    .eq('is_active', true)
  return (data || []).map((r: any) => r.ess_account_id as string)
}

export async function POST(req: NextRequest) {
  const grant = await grantForRequest(req)
  if (!grant.employeeId && !grant.legacy) {
    return bad('Sign in to continue.', 401)
  }
  if (!canAdministerRoles(grant)) {
    return bad('You do not have permission to change roles.', 403)
  }
  const actor = await actorFromRequest(req)

  let body: any
  try { body = await req.json() } catch { return bad('Invalid request') }
  const action = String(body?.action || '')
  const reason = body?.reason ? String(body.reason).trim() : ''

  switch (action) {
    // ── assign / replace / add / remove roles for one or many people ─────────
    case 'assign_roles': {
      const employeeIds: string[] = Array.isArray(body.employee_ids) ? body.employee_ids : []
      const roleIds: string[]     = Array.isArray(body.role_ids) ? body.role_ids : []
      const mode: 'replace' | 'add' | 'remove' = body.mode || 'replace'
      if (!employeeIds.length) return bad('Pick at least one employee.')
      if (!reason) return bad('A reason is required for any role change.')
      if (mode !== 'replace' && !roleIds.length) return bad('Pick at least one role.')

      const holders = await superAdminHolders()
      const { data: superRole } = await sb.from('ess_roles').select('id').eq('role_code', SUPER_ADMIN).maybeSingle()

      const results: { employee_id: string; ok: boolean; message?: string }[] = []

      for (const employeeId of employeeIds) {
        const acctId = await accountFor(employeeId)
        if (!acctId) { results.push({ employee_id: employeeId, ok: false, message: 'Could not create an ESS account' }); continue }

        const { data: current } = await sb
          .from('ess_user_roles').select('role_id, is_active').eq('ess_account_id', acctId)
        const active = new Set((current || []).filter((r: any) => r.is_active).map((r: any) => r.role_id as string))

        let next: Set<string>
        if (mode === 'replace')      next = new Set(roleIds)
        else if (mode === 'add')     next = new Set([...active, ...roleIds])
        else                         next = new Set([...active].filter(id => !roleIds.includes(id)))

        // The rule that keeps the door open: never let the last SUPER_ADMIN go.
        if (superRole?.id && active.has(superRole.id) && !next.has(superRole.id) && holders.length <= 1) {
          results.push({ employee_id: employeeId, ok: false, message: 'This is the only Super Admin — assign another one first.' })
          continue
        }

        // Grant what is new or was previously withdrawn. valid_from is set to today, so
        // effective dating is populated from the first row rather than backfilled later.
        for (const roleId of next) {
          await sb.from('ess_user_roles').upsert({
            ess_account_id: acctId, role_id: roleId,
            is_active: true, valid_from: today(), valid_to: null,
            assigned_by: actor.employeeId, assigned_at: new Date().toISOString(),
          }, { onConflict: 'ess_account_id,role_id' })
        }
        // Withdraw the rest by closing them rather than deleting. The row stays as a
        // record that the person once held it, and the audit entry carries the detail.
        const removed = [...active].filter(id => !next.has(id))
        if (removed.length) {
          await sb.from('ess_user_roles')
            .update({ is_active: false, valid_to: today() })
            .eq('ess_account_id', acctId).in('role_id', removed)
        }

        await audit({
          accountId: acctId, action: 'ROLE_ASSIGN', actor, reason,
          details: { employee_id: employeeId, mode, before: [...active], after: [...next] },
        })
        results.push({ employee_id: employeeId, ok: true })
      }

      return NextResponse.json({ ok: true, results })
    }

    // ── the permission matrix ────────────────────────────────────────────────
    case 'set_permission': {
      const role_id = String(body.role_id || '')
      const module  = String(body.module || '')
      const level   = String(body.access_level || 'NONE') as AccessLevel
      if (!role_id || !module) return bad('role_id and module are required.')
      if (!['NONE', 'VIEW', 'EDIT', 'FULL'].includes(level)) return bad('Unknown access level.')

      const { error } = await sb.from('role_permissions').upsert(
        { role_id, module, access_level: level, updated_at: new Date().toISOString() },
        { onConflict: 'role_id,module' },
      )
      if (error) return bad(error.message, 500)

      await audit({ action: 'PERMISSION_SET', actor, reason: reason || null, details: { role_id, module, access_level: level } })
      return NextResponse.json({ ok: true })
    }

    // ── approval rights ──────────────────────────────────────────────────────
    case 'set_approval_right': {
      const role_id = String(body.role_id || '')
      const approval_type = String(body.approval_type || '')
      if (!role_id || !approval_type) return bad('role_id and approval_type are required.')
      const patch: any = {}
      for (const k of ['can_approve', 'can_reject', 'can_initiate']) {
        if (k in body) patch[k] = !!body[k]
      }
      const { error } = await sb.from('role_approval_rights').upsert(
        { role_id, approval_type, ...patch }, { onConflict: 'role_id,approval_type' },
      )
      if (error) return bad(error.message, 500)

      await audit({ action: 'APPROVAL_RIGHT_SET', actor, reason: reason || null, details: { role_id, approval_type, ...patch } })
      return NextResponse.json({ ok: true })
    }

    // ── activate / deactivate an ESS account ────────────────────────────────
    case 'set_status': {
      const employee_id = String(body.employee_id || '')
      const status = String(body.status || '')
      if (!employee_id || !['ACTIVE', 'INACTIVE', 'LOCKED'].includes(status)) return bad('Unknown status.')
      const acctId = await accountFor(employee_id)
      if (!acctId) return bad('Could not find or create that account.', 500)

      const patch: any = { status, updated_at: new Date().toISOString() }
      if (status === 'INACTIVE') {
        patch.deactivated_at = new Date().toISOString()
        patch.deactivation_reason = reason || null
        patch.deactivated_by = actor.employeeId
      }
      const { error } = await sb.from('ess_accounts').update(patch).eq('id', acctId)
      if (error) return bad(error.message, 500)

      await audit({ accountId: acctId, action: status === 'ACTIVE' ? 'ACCOUNT_ACTIVATE' : 'ACCOUNT_DEACTIVATE', actor, reason, details: { employee_id, status } })
      return NextResponse.json({ ok: true })
    }

    // ── create the ESS account for somebody who has none ────────────────────
    case 'create_account': {
      const employee_id = String(body.employee_id || '')
      if (!employee_id) return bad('employee_id is required.')
      const acctId = await accountFor(employee_id)
      if (!acctId) return bad('Could not create the account.', 500)
      await audit({ accountId: acctId, action: 'ACCOUNT_CREATE', actor, reason: reason || null, details: { employee_id } })
      return NextResponse.json({ ok: true, account_id: acctId })
    }

    default:
      return bad('Unknown action.')
  }
}
