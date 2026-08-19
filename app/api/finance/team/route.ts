// app/api/finance/team/route.ts — who is in finance and what they may do.
//
//   GET   ?company_id=...        the team, with authority
//   PATCH { id, ...changes }     adjust a member's rights
//
// Kept separate from the queue because it answers a different question: not
// "what needs doing" but "who is allowed to do it".
import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/travel/access';
import { requireDashboardUser } from '@/lib/api-auth';
import { errorResponse } from '@/lib/travel/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const companyId = req.nextUrl.searchParams.get('company_id');
    if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    const { data: team, error } = await sb
      .from('finance_team').select('*').eq('company_id', companyId)
      .order('role').order('created_at');
    if (error) throw error;

    const ids = (team ?? []).map((t) => t.employee_id);
    const { data: emps } = ids.length
      ? await sb.from('employees').select('id, emp_code, full_name, designation').in('id', ids)
      : { data: [] };
    const byId = new Map((emps ?? []).map((e) => [e.id, e]));

    return NextResponse.json({
      team: (team ?? []).map((t) => ({ ...t, employee: byId.get(t.employee_id) ?? null })),
    });
  } catch (e) {
    return errorResponse(e, 'Could not load the finance team',
      'The finance tables do not exist yet — migration 053_finance_department.sql has not been run.');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const { id, can_approve, can_disburse, approval_limit, role, is_active } =
      (await req.json()) ?? {};
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (can_approve !== undefined) patch.can_approve = !!can_approve;
    if (can_disburse !== undefined) patch.can_disburse = !!can_disburse;
    if (is_active !== undefined) patch.is_active = !!is_active;
    if (role !== undefined) patch.role = role;
    if (approval_limit !== undefined) {
      patch.approval_limit = approval_limit === null || approval_limit === ''
        ? null
        : Number(approval_limit);
    }

    const { data, error } = await sb
      .from('finance_team').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ member: data });
  } catch (e) {
    return errorResponse(e, 'Could not update that member',
      'The finance tables do not exist yet — migration 053_finance_department.sql has not been run.');
  }
}
