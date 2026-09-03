/**
 * EZER · Wall of Fame · access helpers
 * -------------------------------------------------------------------------
 * Every route in this module goes through here. Do not write ad-hoc permission
 * checks anywhere else — the database triggers depend on the session identity
 * that setSessionEmployee() establishes, and a route that skips it will fail
 * with 42501 even when the user is fully authorised.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type WallPermission =
  | 'wof.view'
  | 'wof.shoutout.create'
  | 'wof.nominate'
  | 'wof.react'
  | 'wof.endorse'
  | 'wof.shortlist'
  | 'wof.publish'
  | 'wof.unpublish'
  | 'wof.moderate'
  | 'wof.configure'
  | 'wof.badge.manage'
  | 'wof.board.manage'
  | 'wof.report.view'
  | 'wof.admin.grant'
  | 'wof.module.activate';

export type AdminLevel = 'board_operator' | 'wall_moderator' | 'wall_admin' | 'wall_owner';

/**
 * Establish who is acting, for this connection, for this request.
 * MUST be called before any read or write in the module.
 */
export async function setSessionEmployee(
  supabase: SupabaseClient,
  employeeId: string,
  companyId?: string
): Promise<void> {
  await supabase.rpc('set_config', {
    setting_name: 'app.current_employee_id',
    new_value: employeeId,
    is_local: true,
  });
  if (companyId) {
    await supabase.rpc('set_config', {
      setting_name: 'app.current_company_id',
      new_value: companyId,
      is_local: true,
    });
  }
}

/** The single permission gate. Mirrors wof_can() exactly — never reimplement it in TS. */
export async function wofCan(
  supabase: SupabaseClient,
  employeeId: string,
  permission: WallPermission,
  companyId?: string,
  branchId?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('wof_can', {
    p_employee: employeeId,
    p_permission: permission,
    p_company: companyId ?? null,
    p_branch: branchId ?? null,
  });
  if (error) return false;
  return data === true;
}

/**
 * Human-readable reason for a denial. Render this inline on a disabled screen
 * rather than returning a 404 — see CLAUDE.md, "Denial is a state, not a 404".
 */
export async function wofExplain(
  supabase: SupabaseClient,
  employeeId: string,
  permission: WallPermission,
  companyId?: string
): Promise<string> {
  const { data, error } = await supabase.rpc('wof_explain_access', {
    p_employee: employeeId,
    p_permission: permission,
    p_company: companyId ?? null,
  });
  if (error) return 'You do not have access to this.';
  return (data as string) ?? 'You do not have access to this.';
}

export async function isWallAdmin(
  supabase: SupabaseClient,
  employeeId: string,
  companyId: string,
  minLevel: AdminLevel = 'wall_admin',
  branchId?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_wall_admin', {
    p_employee: employeeId,
    p_company: companyId,
    p_min_level: minLevel,
    p_branch: branchId ?? null,
  });
  if (error) return false;
  return data === true;
}

/** Standard shape for a denied response. */
export function deny(reason: string) {
  return Response.json({ error: 'forbidden', reason }, { status: 403 });
}

/**
 * Guard wrapper for a route handler.
 *
 *   export const POST = withWallPermission('wof.shoutout.create', async (ctx, req) => { ... });
 */
export function withWallPermission<T>(
  permission: WallPermission,
  handler: (
    ctx: { supabase: SupabaseClient; employeeId: string; companyId: string },
    req: Request
  ) => Promise<T>
) {
  return async function (
    req: Request,
    ctx: { supabase: SupabaseClient; employeeId: string; companyId: string }
  ) {
    await setSessionEmployee(ctx.supabase, ctx.employeeId, ctx.companyId);
    const allowed = await wofCan(ctx.supabase, ctx.employeeId, permission, ctx.companyId);
    if (!allowed) {
      return deny(await wofExplain(ctx.supabase, ctx.employeeId, permission, ctx.companyId));
    }
    return handler(ctx, req);
  };
}
