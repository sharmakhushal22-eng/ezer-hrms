// ============================================================================
// EZER HRMS — Finance
// app/api/finance/queue/route.ts
//
//   GET   ?company_id=...[&module=TRAVEL][&status=PENDING]   the finance queue
//   PATCH { item_id, action, note }                          action an item
//
// One endpoint for everything finance has to action, regardless of which module
// raised it. The queue is a single table (finance_work_items) written by the
// owning module, so adding payroll or vendor invoices later needs no change
// here — they enqueue, and they appear.
//
// Authority is checked against finance_team, not against "is signed in":
// approving money is not something every dashboard user should be able to do,
// and the Finance & Accounts department contains interns.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/travel/access';
import { requireDashboardUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const p = req.nextUrl.searchParams;
    const companyId = p.get('company_id');
    if (!companyId) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
    }

    let q = sb.from('finance_work_items').select('*').eq('company_id', companyId);
    const mod = p.get('module');
    const status = p.get('status') ?? 'PENDING';
    if (mod) q = q.eq('module_code', mod);
    if (status !== 'ALL') q = q.eq('status', status);

    const { data: items, error } = await q.order('raised_at', { ascending: true });
    if (error) throw error;

    // Names, resolved in one query rather than per row.
    const empIds = Array.from(new Set((items ?? []).map((i) => i.employee_id).filter(Boolean))) as string[];
    const { data: emps } = empIds.length
      ? await sb.from('employees').select('id, emp_code, full_name').in('id', empIds)
      : { data: [] };
    const byId = new Map((emps ?? []).map((e) => [e.id, e]));

    const { data: modules } = await sb
      .from('finance_modules').select('*').order('sort_order');

    return NextResponse.json({
      items: (items ?? []).map((i) => ({
        ...i,
        employee: i.employee_id ? byId.get(i.employee_id) ?? null : null,
      })),
      modules: modules ?? [],
      totals: {
        count: (items ?? []).length,
        value: (items ?? []).reduce((s, i) => s + Number(i.amount ?? 0), 0),
        flagged: (items ?? []).filter((i) => (i.flag_count ?? 0) > 0).length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load the finance queue' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — approve, reject or mark an item paid.
//
// The queue does not own the record; the module does. So each action is applied
// to the source first, and the queue entry only follows once that succeeded.
// Doing it the other way round would leave finance showing "paid" for a claim
// the travel module never marked paid.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const { item_id, action, note, acting_employee_id } = (await req.json()) ?? {};

    if (!item_id || !action) {
      return NextResponse.json({ error: 'item_id and action are required' }, { status: 400 });
    }
    const ALLOWED = ['APPROVE', 'REJECT', 'MARK_PAID'];
    if (!ALLOWED.includes(action)) {
      return NextResponse.json({ error: `action must be one of ${ALLOWED.join(', ')}` }, { status: 400 });
    }

    const { data: item } = await sb
      .from('finance_work_items').select('*').eq('id', item_id).maybeSingle();
    if (!item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });

    // ---- authority ---------------------------------------------------------
    if (acting_employee_id) {
      const { data: member } = await sb
        .from('finance_team')
        .select('role, can_approve, can_disburse, approval_limit')
        .eq('employee_id', acting_employee_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!member) {
        return NextResponse.json(
          { error: 'You are not on the finance team, so you cannot action this.', code: 'NOT_FINANCE' },
          { status: 403 },
        );
      }
      if (action !== 'MARK_PAID' && !member.can_approve) {
        return NextResponse.json(
          { error: 'Your finance role does not include approving claims.', code: 'NO_APPROVE_RIGHT' },
          { status: 403 },
        );
      }
      if (action === 'MARK_PAID' && !member.can_disburse) {
        return NextResponse.json(
          { error: 'Approving and releasing payment are separate rights, and you do not hold the second.', code: 'NO_DISBURSE_RIGHT' },
          { status: 403 },
        );
      }
      const amount = Number(item.amount ?? 0);
      if (action === 'APPROVE' && member.approval_limit != null && amount > Number(member.approval_limit)) {
        return NextResponse.json(
          {
            error: `This claim is ₹${amount.toLocaleString('en-IN')}, above your approval limit of ₹${Number(member.approval_limit).toLocaleString('en-IN')}. It needs someone more senior.`,
            code: 'OVER_APPROVAL_LIMIT',
          },
          { status: 403 },
        );
      }
    }

    // ---- apply to the owning module first -----------------------------------
    if (item.module_code === 'TRAVEL') {
      const travelAction =
        action === 'APPROVE' ? 'FINANCE_APPROVE' : action === 'REJECT' ? 'REJECT' : 'MARK_PAID';

      const res = await fetch(new URL('/api/travel/claims', req.nextUrl.origin), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: req.headers.get('authorization') ?? '',
        },
        body: JSON.stringify({
          claim_id: item.ref_id,
          action: travelAction,
          actioned_by: acting_employee_id ?? null,
          remarks: note ?? null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return NextResponse.json(
          { error: body.error || 'The travel module refused that action.', code: body.code ?? null },
          { status: res.status },
        );
      }
    } else {
      return NextResponse.json(
        { error: `${item.module_code} is registered but not yet wired for actions.`, code: 'MODULE_NOT_WIRED' },
        { status: 501 },
      );
    }

    // ---- then the queue ------------------------------------------------------
    const settleAs = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'SETTLED';
    const { error } = await sb.rpc('finance_settle', {
      p_module: item.module_code,
      p_ref_id: item.ref_id,
      p_status: settleAs,
      p_by: acting_employee_id ?? null,
      p_note: note ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, status: settleAs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not action that item' },
      { status: 500 },
    );
  }
}
