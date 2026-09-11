// app/api/rms/admin/route.ts — every write that changes who can do what, or who reports
// to whom.
//
// Three things happen on every action, in this order, and none is optional:
//   1. the caller is resolved from their signed token — never from the request body
//   2. the caller is checked for the right to administer roles
//   3. what changed, who changed it and why is written to ess_access_audit
//
// This exists so an HR administrator can move somebody's manager or grant a permission
// through the application rather than through a developer and a deployment.
import { NextRequest, NextResponse } from 'next/server'
import { grantForRequest, actorFromRequest, rmsServiceClient as sb } from '@/lib/rms/server'
import { canAdministerRoles } from '@/lib/rms/resolve'
import { isRelationshipType } from '@/lib/rms/hierarchy'
import type { AccessLevel } from '@/lib/rms/modules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const today = () => new Date().toISOString().slice(0, 10)
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** One audit row per change, carrying the reason the screen made the user type. `details`
 *  holds before and after, so a reviewer can see what actually moved rather than only
 *  that something did. */
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
    // blank that reads as though the system did it by itself.
    performed_by_name: opts.actor.name || (opts.actor.legacy ? 'Legacy dashboard login' : 'Unknown'),
    reason: opts.reason || null,
    details: opts.details || null,
  })
}

/** The ESS account for an employee, created if missing. Accounts are made INACTIVE and
 *  without a password — HR still issues credentials separately. This exists only so a
 *  role has something to hang off. */
async function accountFor(employeeId: string): Promise<string | null> {
  const { data: found } = await sb.from('ess_accounts').select('id').eq('employee_id', employeeId).maybeSingle()
  if (found?.id) return found.id as string
  const { data: made } = await sb.from('ess_accounts')
    .insert({ employee_id: employeeId, status: 'INACTIVE' }).select('id').single()
  return (made?.id as string) ?? null
}

export async function POST(req: NextRequest) {
  const grant = await grantForRequest(req)
  if (!grant.employeeId && !grant.legacy) return bad('Sign in to continue.', 401)
  if (!canAdministerRoles(grant)) return bad('You do not have permission to change roles.', 403)
  const actor = await actorFromRequest(req)

  let body: any
  try { body = await req.json() } catch { return bad('Invalid request') }
  const action = String(body?.action || '')
  const reason = body?.reason ? String(body.reason).trim() : ''

  switch (action) {
    // ── functional roles ─────────────────────────────────────────────────────
    case 'assign_roles': {
      const employeeIds: string[] = Array.isArray(body.employee_ids) ? body.employee_ids : []
      const roleIds: string[] = Array.isArray(body.role_ids) ? body.role_ids : []
      const mode: 'replace' | 'add' | 'remove' = body.mode || 'replace'
      if (!employeeIds.length) return bad('Pick at least one employee.')
      if (!reason) return bad('A reason is required for any role change.')
      if (mode !== 'replace' && !roleIds.length) return bad('Pick at least one role.')

      const results: { employee_id: string; ok: boolean; message?: string }[] = []
      for (const employeeId of employeeIds) {
        const acctId = await accountFor(employeeId)
        if (!acctId) { results.push({ employee_id: employeeId, ok: false, message: 'Could not create an ESS account' }); continue }

        const { data: current } = await sb.from('ess_user_roles')
          .select('role_id, is_active').eq('ess_account_id', acctId)
        const active = new Set((current || []).filter((r: any) => r.is_active).map((r: any) => r.role_id as string))

        let next: Set<string>
        if (mode === 'replace')   next = new Set(roleIds)
        else if (mode === 'add')  next = new Set([...active, ...roleIds])
        else                      next = new Set([...active].filter(id => !roleIds.includes(id)))

        for (const roleId of next) {
          await sb.from('ess_user_roles').upsert(
            { ess_account_id: acctId, role_id: roleId, is_active: true, assigned_by: actor.employeeId, assigned_at: new Date().toISOString() },
            { onConflict: 'ess_account_id,role_id' },
          )
        }
        const removed = [...active].filter(id => !next.has(id))
        if (removed.length) {
          await sb.from('ess_user_roles').update({ is_active: false })
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

    case 'set_permission': {
      const role_id = String(body.role_id || '')
      // Not called `module`: assigning to that name inside a Next.js route confuses the
      // CommonJS interop, and the linter is right to refuse it.
      const moduleName = String(body.module || '')
      const level = String(body.access_level || 'NONE') as AccessLevel
      if (!role_id || !moduleName) return bad('role_id and module are required.')
      if (!['NONE', 'VIEW', 'EDIT', 'FULL'].includes(level)) return bad('Unknown access level.')

      const { error } = await sb.from('role_permissions').upsert(
        { role_id, module: moduleName, access_level: level, updated_at: new Date().toISOString() },
        { onConflict: 'role_id,module' },
      )
      if (error) return bad(error.message, 500)
      await audit({ action: 'PERMISSION_SET', actor, reason: reason || null, details: { role_id, module: moduleName, access_level: level } })
      return NextResponse.json({ ok: true })
    }

    // ── the reporting structure ──────────────────────────────────────────────
    // Changing somebody's manager is data, not a deployment. The database refuses a
    // cycle and refuses a self-assignment; this turns those into a readable message
    // rather than a constraint violation.
    case 'set_relationship': {
      const employee_id = String(body.employee_id || '')
      const manager_employee_id = String(body.manager_employee_id || '')
      const relationship_type = String(body.relationship_type || '')
      if (!employee_id || !manager_employee_id) return bad('employee_id and manager_employee_id are required.')
      if (!isRelationshipType(relationship_type)) return bad('Unknown relationship type.')
      if (!reason) return bad('A reason is required for a reporting-line change.')
      if (employee_id === manager_employee_id) return bad('An employee cannot be their own manager.')

      const { data: before } = await sb.from('employee_relationships')
        .select('manager_employee_id').eq('employee_id', employee_id)
        .eq('relationship_type', relationship_type).is('valid_to', null).maybeSingle()

      // Close the current one rather than deleting it, so the record of having reported
      // to somebody survives the change.
      if (before) {
        await sb.from('employee_relationships').update({ valid_to: today() })
          .eq('employee_id', employee_id).eq('relationship_type', relationship_type).is('valid_to', null)
      }
      const { error } = await sb.from('employee_relationships').insert({
        employee_id, manager_employee_id, relationship_type,
        source: 'MANUAL', valid_from: today(),
      })
      if (error) {
        // Put the old one back before reporting, so a refused change leaves nothing worse
        // than it found.
        if (before) {
          await sb.from('employee_relationships').update({ valid_to: null })
            .eq('employee_id', employee_id).eq('relationship_type', relationship_type).eq('valid_to', today())
        }
        return bad(error.message.replace(/^.*ERROR:\s*/, ''), 400)
      }

      await audit({
        action: 'RELATIONSHIP_SET', actor, reason,
        details: { employee_id, relationship_type, before: before?.manager_employee_id ?? null, after: manager_employee_id },
      })
      return NextResponse.json({ ok: true })
    }

    case 'clear_relationship': {
      const employee_id = String(body.employee_id || '')
      const relationship_type = String(body.relationship_type || '')
      if (!employee_id || !isRelationshipType(relationship_type)) return bad('employee_id and a valid relationship_type are required.')
      if (!reason) return bad('A reason is required for a reporting-line change.')

      const { error } = await sb.from('employee_relationships').update({ valid_to: today() })
        .eq('employee_id', employee_id).eq('relationship_type', relationship_type).is('valid_to', null)
      if (error) return bad(error.message, 500)

      await audit({ action: 'RELATIONSHIP_CLEAR', actor, reason, details: { employee_id, relationship_type } })
      return NextResponse.json({ ok: true })
    }

    default:
      return bad('Unknown action.')
  }
}
