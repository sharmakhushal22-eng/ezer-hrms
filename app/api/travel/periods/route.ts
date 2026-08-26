// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/periods/route.ts
//
// Backend control for opening and closing expense months.
//
//   GET    ?company_id=...&months=12    list periods
//   POST   { company_id, period_month } create/open a month
//   PATCH  { period_id, action, ... }   OPEN | CLOSE | REOPEN | LOCK | WINDOW
//
// Rules enforced here and again by the DB trigger:
//   · CLOSED can be reopened, but only with a reason of 10+ characters
//   · LOCKED is permanent — paid through payroll, never reopenable
//   · every action writes a row to travel_period_audit
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireModule } from '@/lib/api-auth';
import { errorResponse } from '@/lib/travel/errors';
import { serviceClient, monthStart } from '@/lib/travel/access';

export const dynamic = 'force-dynamic';

function labelFor(monthISO: string): string {
  const d = new Date(monthISO + 'T00:00:00');
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// GET — list periods, newest first
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    // Opening, closing and locking an expense month is an HR/Finance
    // action, not an employee one.
    const gate = await requireModule(req, 'Travel Claims');
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const companyId = req.nextUrl.searchParams.get('company_id');
    const months = Number(req.nextUrl.searchParams.get('months') ?? 12);

    if (!companyId) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
    }

    const { data, error } = await sb
      .from('travel_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('period_month', { ascending: false })
      .limit(months);

    if (error) throw error;

    // pending claim volume per period, so HR can see what closing would strand
    const ids = (data ?? []).map((p) => p.id);
    let counts: Record<string, { draft: number; pending: number; total: number }> = {};

    if (ids.length) {
      const { data: claims } = await sb
        .from('travel_claims')
        .select('period_id, status')
        .in('period_id', ids);

      counts = (claims ?? []).reduce((acc, c) => {
        const k = c.period_id as string;
        acc[k] = acc[k] ?? { draft: 0, pending: 0, total: 0 };
        acc[k].total += 1;
        if (c.status === 'DRAFT') acc[k].draft += 1;
        // PENDING_HR counts as in-flight too — a month with claims still sitting
        // with the HR Head is not safe to lock.
        if (['SUBMITTED', 'PENDING_RM', 'PENDING_HR', 'PENDING_FINANCE', 'SENT_BACK']
              .includes(c.status))
          acc[k].pending += 1;
        return acc;
      }, {} as typeof counts);
    }

    return NextResponse.json({
      periods: (data ?? []).map((p) => ({
        ...p,
        claim_counts: counts[p.id] ?? { draft: 0, pending: 0, total: 0 },
      })),
    });
  } catch (e) {
    return errorResponse(e, 'Failed to load periods',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// POST — create (and open) a month
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // Opening, closing and locking an expense month is an HR/Finance
    // action, not an employee one.
    const gate = await requireModule(req, 'Travel Claims');
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const body = await req.json();
    const { company_id, period_month, actioned_by, submit_open_from, submit_open_till, remarks } =
      body ?? {};

    if (!company_id || !period_month) {
      return NextResponse.json(
        { error: 'company_id and period_month are required' },
        { status: 400 }
      );
    }

    const first = monthStart(period_month);

    const { data: existing } = await sb
      .from('travel_periods')
      .select('id, period_label, status')
      .eq('company_id', company_id)
      .eq('period_month', first)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `${existing.period_label} already exists (${existing.status}).`, period: existing },
        { status: 409 }
      );
    }

    const autoClose = new Date(first + 'T00:00:00');
    autoClose.setMonth(autoClose.getMonth() + 1);
    autoClose.setDate(5);

    const { data, error } = await sb
      .from('travel_periods')
      .insert({
        company_id,
        period_month: first,
        period_label: labelFor(first),
        status: 'OPEN',
        submit_open_from: submit_open_from ?? null,
        submit_open_till: submit_open_till ?? null,
        auto_close_on: autoClose.toISOString().slice(0, 10),
        remarks: remarks ?? null,
        created_by: actioned_by ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    await sb.from('travel_period_audit').insert({
      period_id: data.id,
      company_id,
      action: 'CREATED',
      to_status: 'OPEN',
      reason: remarks ?? 'Opened from admin console',
      actioned_by: actioned_by ?? null,
    });

    return NextResponse.json({ period: data });
  } catch (e) {
    return errorResponse(e, 'Failed to create period',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// PATCH — OPEN | CLOSE | REOPEN | LOCK | WINDOW
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    // Opening, closing and locking an expense month is an HR/Finance
    // action, not an employee one.
    const gate = await requireModule(req, 'Travel Claims');
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const body = await req.json();
    const {
      period_id,
      action,
      reason,
      actioned_by,
      payroll_run_id,
      submit_open_from,
      submit_open_till,
    } = body ?? {};

    if (!period_id || !action) {
      return NextResponse.json({ error: 'period_id and action are required' }, { status: 400 });
    }

    const { data: period, error: readErr } = await sb
      .from('travel_periods')
      .select('*')
      .eq('id', period_id)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 });
    }

    if (period.status === 'LOCKED' && action !== 'LOCK') {
      return NextResponse.json(
        {
          error: `${period.period_label} is locked — it has been paid through payroll and cannot be changed.`,
          code: 'PERIOD_LOCKED',
        },
        { status: 409 }
      );
    }

    const patch: Record<string, unknown> = {};
    let auditAction = action;

    switch (action) {
      case 'CLOSE': {
        // warn (do not block) if drafts would be stranded
        const { count } = await sb
          .from('travel_claims')
          .select('id', { count: 'exact', head: true })
          .eq('period_id', period_id)
          .eq('status', 'DRAFT');

        patch.status = 'CLOSED';
        patch.closed_by = actioned_by ?? null;
        patch.closed_at = new Date().toISOString();
        auditAction = 'CLOSED';

        const res = await applyPatch(sb, period_id, patch, {
          period,
          action: auditAction,
          reason: reason ?? 'Closed from admin console',
          actioned_by,
          meta: { stranded_drafts: count ?? 0 },
        });
        return NextResponse.json({
          period: res,
          warning:
            (count ?? 0) > 0
              ? `${count} draft claim(s) in this month can no longer be submitted.`
              : null,
        });
      }

      case 'OPEN':
      case 'REOPEN': {
        if (period.status === 'CLOSED') {
          if (!reason || String(reason).trim().length < 10) {
            return NextResponse.json(
              { error: 'Reopening a closed month needs a reason of at least 10 characters.' },
              { status: 400 }
            );
          }
          patch.reopened_by = actioned_by ?? null;
          patch.reopened_at = new Date().toISOString();
          patch.reopen_reason = String(reason).trim();
          auditAction = 'REOPENED';
        } else {
          auditAction = 'OPENED';
        }
        patch.status = 'OPEN';
        break;
      }

      case 'LOCK': {
        patch.status = 'LOCKED';
        patch.locked_by = actioned_by ?? null;
        patch.locked_at = new Date().toISOString();
        patch.payroll_run_id = payroll_run_id ?? null;
        auditAction = 'LOCKED';
        break;
      }

      case 'WINDOW': {
        patch.submit_open_from = submit_open_from ?? null;
        patch.submit_open_till = submit_open_till ?? null;
        auditAction = 'WINDOW_CHANGED';
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const updated = await applyPatch(sb, period_id, patch, {
      period,
      action: auditAction,
      reason: reason ?? null,
      actioned_by,
    });

    return NextResponse.json({ period: updated });
  } catch (e) {
    return errorResponse(e, 'Failed to update period',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
async function applyPatch(
  sb: ReturnType<typeof serviceClient>,
  periodId: string,
  patch: Record<string, unknown>,
  audit: {
    period: { status: string; company_id: string };
    action: string;
    reason: string | null;
    actioned_by?: string | null;
    meta?: Record<string, unknown>;
  }
) {
  const { data, error } = await sb
    .from('travel_periods')
    .update(patch)
    .eq('id', periodId)
    .select()
    .single();

  if (error) throw error;

  await sb.from('travel_period_audit').insert({
    period_id: periodId,
    company_id: audit.period.company_id,
    action: audit.action,
    from_status: audit.period.status,
    to_status: (patch.status as string) ?? audit.period.status,
    reason: audit.reason,
    actioned_by: audit.actioned_by ?? null,
    meta: audit.meta ?? null,
  });

  return data;
}
