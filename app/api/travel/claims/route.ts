// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/claims/route.ts
//
//   GET   ?employee_id=...                    my claims
//   GET   ?approver_id=...&stage=RM|HR|FINANCE  approval inbox
//   POST  { employee_id, log_ids[] }          build + submit a claim
//   PATCH { claim_id, action, lines[] }       RM_APPROVE | HR_APPROVE
//                                             | FINANCE_APPROVE | SEND_BACK
//                                             | REJECT | MARK_PAID
//
// APPROVAL CHAIN — RM -> HR Head -> Finance.
// The vendor drop shipped RM -> Finance; the HR Head stage is this repo's
// requirement. The RM leg only runs when travel_policies.rm_stage_enabled is
// true AND the employee actually has an l1_manager_id, so with the shipped
// config a claim goes employee -> HR Head -> Finance.
//
// Line-level partial approval is supported at the FINANCE stage: pass
// lines: [{ id, amount_approved, line_status, finance_remarks }].
// Without it Finance rejects a whole claim over one bad line and the whole
// cycle restarts — which is where 45-day reimbursement cycles come from.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  serviceClient,
  requireWriteAccess,
  requireReadAccess,
  guardResponse,
  getActivePolicy,
  getEmployeeContext,
  resolveApprover,
  firstClaimStage,
  nextClaimStage,
  monthStart,
} from '@/lib/travel/access';
import type { ClaimPendingStatus } from '@/lib/travel/access';
import { requireDashboardUser } from '@/lib/api-auth';
import { resolveActor } from '@/lib/travel/actor';
import { errorResponse } from '@/lib/travel/errors';

export const dynamic = 'force-dynamic';

/** Which approval task a pending status is waiting on. */
const STAGE_OF: Record<ClaimPendingStatus, string> = {
  PENDING_RM: 'CLAIM_RM',
  PENDING_HR: 'CLAIM_HR',
  PENDING_FINANCE: 'CLAIM_FINANCE',
};

/**
 * Tell finance a claim is theirs, or that it no longer is.
 *
 * The finance dashboard reads one queue table rather than joining every module
 * that might need it, so a claim announces itself on arriving at
 * PENDING_FINANCE and settles when it is approved, rejected or paid.
 *
 * Deliberately never throws. Migration 053 may not be applied, and a claim must
 * not fail to progress because the finance queue is unavailable — finance can
 * still work from the travel screen. Failure is logged and swallowed.
 */
async function notifyFinance(
  sb: ReturnType<typeof serviceClient>,
  claim: Record<string, any>,
  action: 'enqueue' | 'APPROVED' | 'REJECTED' | 'SETTLED',
  actedBy?: string | null,
  note?: string | null,
) {
  try {
    if (action === 'enqueue') {
      const { data: emp } = await sb
        .from('employees').select('full_name, emp_code').eq('id', claim.employee_id).maybeSingle();
      await sb.rpc('finance_enqueue', {
        p_company_id: claim.company_id,
        p_module: 'TRAVEL',
        p_ref_table: 'travel_claims',
        p_ref_id: claim.id,
        p_title: `${claim.claim_no} — ${emp?.full_name ?? 'employee'}`,
        p_subtitle: `${emp?.emp_code ?? ''} · ${claim.period_from ?? ''} to ${claim.period_to ?? ''}`.trim(),
        p_employee_id: claim.employee_id,
        p_amount: claim.total_claimed,
        p_flag_count: claim.flag_count ?? 0,
        p_due_at: null,
        p_meta: { claim_no: claim.claim_no, claim_type: claim.claim_type },
      });
    } else {
      await sb.rpc('finance_settle', {
        p_module: 'TRAVEL',
        p_ref_id: claim.id,
        p_status: action,
        p_by: actedBy ?? null,
        p_note: note ?? null,
      });
    }
  } catch {
    // 053 not applied, or the queue is unavailable. The claim is unaffected.
  }
}

function slaDaysFor(stage: string, policy: { rm_sla_days?: number; hr_sla_days?: number; finance_sla_days?: number } | null): number {
  if (stage === 'CLAIM_RM') return policy?.rm_sla_days ?? 3;
  if (stage === 'CLAIM_HR') return policy?.hr_sla_days ?? 3;
  return policy?.finance_sla_days ?? 3;
}

// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const sb = serviceClient();
    const p = req.nextUrl.searchParams;
    const employeeId = p.get('employee_id');
    const approverId = p.get('approver_id');
    const stage = p.get('stage');
    const claimId = p.get('claim_id');

    // ---- one claim, opened up ---------------------------------------------
    // Approvers need the individual expense lines to action anything: Finance
    // approves line by line, and HR wants to see what it is signing off.
    if (claimId) {
      // Refuse before the lookup when there is no token at all, so a stranger
      // cannot tell a missing claim from one they are not allowed to see.
      if (!req.headers.get('authorization')) {
        return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
      }

      const { data: claim } = await sb
        .from('v_travel_claim_summary').select('*').eq('id', claimId).maybeSingle();
      if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

      // A claim is somebody's expense detail — amounts, dates, places they were.
      // An employee may open their own; a dashboard user may open any, which is
      // how HR and Finance review one.
      const actor = await resolveActor(req, claim.employee_id);
      if (!actor.ok) return actor.response;
      if (!actor.onBehalf && actor.employeeId !== claim.employee_id) {
        return NextResponse.json(
          { error: 'You can only open your own claims.' },
          { status: 403 },
        );
      }

      const { data: lines } = await sb
        .from('travel_claim_lines').select('*')
        .eq('claim_id', claimId).order('expense_date', { ascending: true });

      const lineIds = (lines ?? []).map((l) => l.id);
      const { data: flags } = lineIds.length
        ? await sb.from('travel_flags').select('*').in('claim_line_id', lineIds)
        : { data: [] };

      const { data: approvals } = await sb
        .from('travel_approvals').select('*')
        .eq('claim_id', claimId).order('created_at', { ascending: true });

      return NextResponse.json({
        claim,
        lines: lines ?? [],
        flags: flags ?? [],
        approvals: approvals ?? [],
      });
    }

    // ---- approval inbox --------------------------------------------------
    // An inbox exposes other people's expense claims, so it needs a dashboard
    // session. "My claims" further down goes through resolveActor instead,
    // because an ESS employee cannot satisfy this gate.
    if (approverId) {
      const gate = await requireDashboardUser(req);
      if (gate.error) return gate.error;

      const access = await requireReadAccess(sb, approverId);
      if (!access.ok) return guardResponse(access.guard);

      // Finance sees the whole company — it is not a per-reportee inbox.
      if (stage === 'FINANCE') {
        const { data } = await sb
          .from('v_travel_claim_summary')
          .select('*')
          .eq('company_id', access.employee!.company_id)
          .eq('status', 'PENDING_FINANCE')
          .order('submitted_at', { ascending: true });
        return NextResponse.json({ claims: data ?? [] });
      }

      // RM and HR Head are both "people who report to me" inboxes — they differ
      // only in which employee column points at the approver.
      const isHr = stage === 'HR';
      const linkColumn = isHr ? 'hr_head_id' : 'l1_manager_id';
      const waitingOn = isHr ? 'PENDING_HR' : 'PENDING_RM';

      const { data: reportees } = await sb
        .from('employees')
        .select('id')
        .eq(linkColumn, approverId);

      const ids = (reportees ?? []).map((r) => r.id);
      if (ids.length === 0) return NextResponse.json({ claims: [] });

      // Chunked because an HR Head can own hundreds of employees and a single
      // .in() with that many UUIDs overruns the PostgREST URL length limit.
      const claims: unknown[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await sb
          .from('v_travel_claim_summary')
          .select('*')
          .in('employee_id', ids.slice(i, i + 100))
          .eq('status', waitingOn)
          .order('submitted_at', { ascending: true });
        claims.push(...(data ?? []));
      }

      return NextResponse.json({ claims });
    }

    // ---- my claims -------------------------------------------------------
      // requireReadAccess checks the employee is active and the month is open. It
      // does not check WHO is asking — so the id comes from the signed ESS session,
      // and a supplied one is only honoured for a dashboard user.
      const actor = await resolveActor(req, employeeId);
      if (!actor.ok) return actor.response;
      const actingEmployeeId = actor.employeeId;

    const access = await requireReadAccess(sb, actingEmployeeId);
    if (!access.ok) return guardResponse(access.guard);

    const { data, error } = await sb
      .from('v_travel_claim_summary')
      .select('*')
      .eq('employee_id', actingEmployeeId)
      // The view exposes submitted_at, not created_at. Ordering on a column the
      // view does not have made every "my claims" call a 500.
      .order('submitted_at', { ascending: false, nullsFirst: false });

    if (error) throw error;
    return NextResponse.json({ claims: data ?? [] });
  } catch (e) {
    return errorResponse(e, 'Failed to load claims',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// POST — build a claim from logged travel and submit it
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const sb = serviceClient();
    const {
      employee_id: bodyEmployeeId,
      log_ids = [],
      trip_id = null,
      claim_type = trip_id ? 'TRIP_SETTLEMENT' : 'MONTHLY_LOCAL',
    } = (await req.json()) ?? {};

    // Submitting a claim is always an employee acting for themselves. From here
    // employee_id is the verified one — the body's copy is not used again.
    const claimActor = await resolveActor(req, bodyEmployeeId, { selfOnly: true });
    if (!claimActor.ok) return claimActor.response;
    const employee_id = claimActor.employeeId;

    if (!Array.isArray(log_ids) || log_ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one travel log is required' },
        { status: 400 }
      );
    }

    const { data: logs, error: logErr } = await sb
      .from('travel_logs')
      .select('*')
      .in('id', log_ids)
      .eq('employee_id', employee_id)
      .is('claim_id', null)
      .neq('status', 'CANCELLED');

    if (logErr) throw logErr;
    if (!logs || logs.length === 0) {
      return NextResponse.json(
        { error: 'No unclaimed travel logs found for the selected entries.' },
        { status: 400 }
      );
    }

    const dates = logs.map((l) => l.log_date).sort();
    const periodFrom = dates[0];
    const periodTo = dates[dates.length - 1];

    // every log's month must be open, and the employee must still be active
    for (const d of Array.from(new Set(dates.map((x) => monthStart(x))))) {
      const access = await requireWriteAccess(sb, employee_id, d);
      if (!access.ok) return guardResponse(access.guard);
    }

    const access = await requireWriteAccess(sb, employee_id, periodTo);
    if (!access.ok) return guardResponse(access.guard);

    const emp = access.employee!;
    const policy = access.policy!;

    const { data: period } = await sb
      .from('travel_periods')
      .select('id')
      .eq('company_id', emp.company_id)
      .eq('period_month', monthStart(periodTo))
      .maybeSingle();

    // ---- advance adjustment ---------------------------------------------
    let advance = 0;
    if (trip_id) {
      const { data: trip } = await sb
        .from('travel_trips')
        .select('advance_approved')
        .eq('id', trip_id)
        .maybeSingle();
      advance = Number(trip?.advance_approved ?? 0);
    }

    const totalClaimed = logs.reduce((s, l) => s + Number(l.total_amount ?? 0), 0);
    const netPayable = Math.max(totalClaimed - advance, 0);
    const recovery = Math.max(advance - totalClaimed, 0);

    // ---- claim header ----------------------------------------------------
    const { data: claimNo } = await sb.rpc('travel_next_claim_no', {
      p_company_id: emp.company_id,
    });

    const now = new Date().toISOString();

    // RM -> HR Head -> Finance, skipping any stage with nobody mapped to it.
    const entryStatus = firstClaimStage(emp, policy);

    const { data: claim, error } = await sb
      .from('travel_claims')
      .insert({
        company_id: emp.company_id,
        claim_no: claimNo as unknown as string,
        employee_id,
        claim_type,
        trip_id,
        period_id: period?.id ?? null,
        period_from: periodFrom,
        period_to: periodTo,
        total_claimed: totalClaimed,
        advance_adjusted: Math.min(advance, totalClaimed),
        net_payable: netPayable,
        recovery_amount: recovery,
        status: entryStatus,
        submitted_at: now,
        first_submitted_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    // ---- lines -----------------------------------------------------------
    const lines = logs.map((l) => ({
      claim_id: claim.id,
      travel_log_id: l.id,
      type_code: l.type_code,
      expense_date: l.log_date,
      city: l.city,
      city_class: l.city_class,
      description: [l.purpose, l.client_name].filter(Boolean).join(' — '),
      paid_by: employee_id,
      is_shared: l.is_shared,
      consumer_count: (l.passenger_count ?? 0) + 1,
      amount_claimed: Number(l.total_amount ?? 0),
      line_status: 'PENDING' as const,
    }));

    const { data: savedLines } = await sb.from('travel_claim_lines').insert(lines).select();

    // point the logs and the share ledger at the new claim
    await sb
      .from('travel_logs')
      .update({ claim_id: claim.id, status: 'CLAIMED' })
      .in('id', logs.map((l) => l.id));

    for (const sl of savedLines ?? []) {
      await sb
        .from('travel_claim_line_shares')
        .update({ claim_line_id: sl.id })
        .eq('travel_log_id', sl.travel_log_id);

      // Point each journey's flags at the claim line, so the approver screen —
      // which reads flags by claim_line_id — actually finds them.
      await sb
        .from('travel_flags')
        .update({ claim_line_id: sl.id })
        .eq('travel_log_id', sl.travel_log_id);
    }

    // flag_count drives the "⚑ n to review" badge on the claim. Unresolved
    // only: a MISSING_BILL that has since been satisfied is not a concern.
    const { count: openFlags } = await sb
      .from('travel_flags')
      .select('id', { count: 'exact', head: true })
      .in('travel_log_id', logs.map((l) => l.id))
      .is('resolved_at', null);

    if (openFlags && openFlags > 0) {
      await sb.from('travel_claims').update({ flag_count: openFlags }).eq('id', claim.id);
      claim.flag_count = openFlags;
    }

    // ---- first approval task ---------------------------------------------
    const entryStage = STAGE_OF[entryStatus];
    const due = new Date();
    due.setDate(due.getDate() + slaDaysFor(entryStage, policy));

    await sb.from('travel_approvals').insert({
      claim_id: claim.id,
      stage: entryStage,
      // Finance is a team rather than a named person, so its task starts
      // unassigned and is stamped with whoever actions it.
      approver_id:
        entryStage === 'CLAIM_RM' ? resolveApprover(emp, 'CLAIM_RM')
        : entryStage === 'CLAIM_HR' ? resolveApprover(emp, 'CLAIM_HR')
        : null,
      sla_due_at: due.toISOString(),
    });

    // If it went straight to finance, they need to know now.
    if (entryStatus === 'PENDING_FINANCE') await notifyFinance(sb, claim, 'enqueue');

    const withWhom =
      entryStatus === 'PENDING_RM' ? 'your reporting manager'
      : entryStatus === 'PENDING_HR' ? 'the HR Head'
      : 'Finance';

    return NextResponse.json({
      claim,
      lines: savedLines ?? [],
      message: `${claim.claim_no} submitted — now with ${withWhom} for approval.`,
    });
  } catch (e) {
    return errorResponse(e, 'Failed to submit claim',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// PATCH — approval actions
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    // Approving, rejecting and marking paid all move money. Dashboard only.
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const { claim_id, action, actioned_by, remarks, lines, payroll_run_id } =
      (await req.json()) ?? {};

    if (!claim_id || !action) {
      return NextResponse.json({ error: 'claim_id and action are required' }, { status: 400 });
    }

    const { data: claim } = await sb
      .from('travel_claims')
      .select('*')
      .eq('id', claim_id)
      .maybeSingle();

    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    // a locked period freezes everything, including approvals
    const { data: period } = await sb
      .from('travel_periods')
      .select('status, period_label')
      .eq('id', claim.period_id)
      .maybeSingle();

    if (period?.status === 'LOCKED' && action !== 'MARK_PAID') {
      return NextResponse.json(
        {
          error: `${period.period_label} is locked. This claim can no longer be actioned.`,
          code: 'PERIOD_LOCKED',
        },
        { status: 409 }
      );
    }

    const policy = await getActivePolicy(sb, claim.company_id);
    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();

    switch (action) {
      // RM and HR Head behave identically — approve, stamp the timestamp, and
      // open the next stage's task. Only the claim's own status decides what
      // "next" is, so an approver cannot skip ahead by posting the wrong action.
      case 'RM_APPROVE':
      case 'HR_APPROVE': {
        const expected = action === 'RM_APPROVE' ? 'PENDING_RM' : 'PENDING_HR';
        if (claim.status !== expected) {
          return NextResponse.json(
            {
              error: `This claim is ${claim.status.replace('PENDING_', 'with ').toLowerCase()}, not awaiting your approval.`,
              code: 'WRONG_STAGE',
            },
            { status: 409 }
          );
        }

        const emp = await getEmployeeContext(sb, claim.employee_id);
        if (!emp) {
          return NextResponse.json({ error: 'Employee record not found' }, { status: 404 });
        }

        const next = nextClaimStage(expected, emp, policy);
        patch.status = next;
        patch[action === 'RM_APPROVE' ? 'rm_actioned_at' : 'hr_actioned_at'] = now;

        if (next !== 'APPROVED') {
          const nextStage = STAGE_OF[next];
          const due = new Date();
          due.setDate(due.getDate() + slaDaysFor(nextStage, policy));

          await sb.from('travel_approvals').insert({
            claim_id,
            stage: nextStage,
            approver_id:
              nextStage === 'CLAIM_HR' ? resolveApprover(emp, 'CLAIM_HR') : null,
            sla_due_at: due.toISOString(),
          });
        }

        if (next === 'PENDING_FINANCE') {
          await notifyFinance(sb, { ...claim, ...patch, id: claim_id }, 'enqueue');
        }

        await closeTask(sb, claim_id, STAGE_OF[expected], actioned_by, 'APPROVED', remarks);
        break;
      }

      case 'FINANCE_APPROVE': {
        if (claim.status !== 'PENDING_FINANCE') {
          return NextResponse.json(
            {
              error: `This claim is not with Finance yet (currently ${claim.status}).`,
              code: 'WRONG_STAGE',
            },
            { status: 409 }
          );
        }

        // line-level partial approval
        let approved = 0;
        if (Array.isArray(lines) && lines.length > 0) {
          for (const l of lines) {
            const claimed = Number(l.amount_claimed ?? 0);
            const ok = Number(l.amount_approved ?? 0);
            await sb
              .from('travel_claim_lines')
              .update({
                amount_approved: ok,
                amount_unclaimable: Math.max(claimed - ok, 0),
                line_status: l.line_status ?? (ok === 0 ? 'REJECTED' : ok < claimed ? 'PARTIAL' : 'APPROVED'),
                finance_remarks: l.finance_remarks ?? null,
                supplier_gstin: l.supplier_gstin ?? null,
                invoice_no: l.invoice_no ?? null,
                invoice_date: l.invoice_date ?? null,
                taxable_value: l.taxable_value ?? null,
                cgst: l.cgst ?? null,
                sgst: l.sgst ?? null,
                igst: l.igst ?? null,
                place_of_supply: l.place_of_supply ?? null,
                cost_centre: l.cost_centre ?? null,
                project_code: l.project_code ?? null,
              })
              .eq('id', l.id);
            approved += ok;
          }
        } else {
          // Approve in full. Each line's amount_approved has to be written as
          // its claimed amount — the drop left them null here, so a fully
          // approved claim showed a total on the header with nothing approved
          // against any line, and the GST/payout export had nothing to read.
          const { data: allLines } = await sb
            .from('travel_claim_lines')
            .select('id, amount_claimed')
            .eq('claim_id', claim_id);

          for (const l of allLines ?? []) {
            await sb
              .from('travel_claim_lines')
              .update({
                amount_approved: Number(l.amount_claimed ?? 0),
                amount_unclaimable: 0,
                line_status: 'APPROVED',
              })
              .eq('id', l.id);
          }

          approved = (allLines ?? []).reduce((s, l) => s + Number(l.amount_claimed ?? 0), 0);
        }

        const advance = Number(claim.advance_adjusted ?? 0);
        patch.status = 'APPROVED';
        patch.finance_actioned_at = now;
        patch.total_approved = approved;
        patch.net_payable = Math.max(approved - advance, 0);
        patch.recovery_amount = Math.max(advance - approved, 0);

        await notifyFinance(sb, { ...claim, id: claim_id }, 'APPROVED', actioned_by, remarks);
        await closeTask(sb, claim_id, 'CLAIM_FINANCE', actioned_by, 'APPROVED', remarks);
        break;
      }

      case 'SEND_BACK': {
        // release the logs so the employee can edit them again.
        // first_submitted_at is NOT touched, so a finance query does not
        // restart the 90-day clock against the employee.
        patch.status = 'SENT_BACK';
        await sb
          .from('travel_logs')
          .update({ claim_id: null, status: 'LOGGED' })
          .eq('claim_id', claim_id);
        await closeTask(sb, claim_id, null, actioned_by, 'SENT_BACK', remarks);
        break;
      }

      case 'REJECT': {
        patch.status = 'REJECTED';
        await sb
          .from('travel_logs')
          .update({ claim_id: null, status: 'LOGGED' })
          .eq('claim_id', claim_id);
        await notifyFinance(sb, { ...claim, id: claim_id }, 'REJECTED', actioned_by, remarks);
        await closeTask(sb, claim_id, null, actioned_by, 'REJECTED', remarks);
        break;
      }

      case 'MARK_PAID': {
        // Only a fully approved claim can be paid — otherwise a claim still
        // sitting with HR could be marked paid straight out of the inbox.
        if (claim.status !== 'APPROVED') {
          return NextResponse.json(
            {
              error: `Only an approved claim can be marked paid (currently ${claim.status}).`,
              code: 'WRONG_STAGE',
            },
            { status: 409 }
          );
        }
        patch.status = 'PAID';
        patch.paid_at = now;
        await notifyFinance(sb, { ...claim, id: claim_id }, 'SETTLED', actioned_by, remarks);
        patch.payroll_run_id = payroll_run_id ?? null;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const { data: updated, error } = await sb
      .from('travel_claims')
      .update(patch)
      .eq('id', claim_id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ claim: updated });
  } catch (e) {
    return errorResponse(e, 'Failed to action claim',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
async function closeTask(
  sb: ReturnType<typeof serviceClient>,
  claimId: string,
  stage: string | null,
  approverId: string | null | undefined,
  action: string,
  remarks: string | null | undefined
) {
  let q = sb
    .from('travel_approvals')
    .update({
      approver_id: approverId ?? null,
      action,
      remarks: remarks ?? null,
      actioned_at: new Date().toISOString(),
    })
    .eq('claim_id', claimId)
    .is('actioned_at', null);

  if (stage) q = q.eq('stage', stage);
  await q;
}
