// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/trips/route.ts
//
//   GET    ?employee_id=...            my trips + trips I am a traveller on
//   POST   { ...trip, travellers[] }   create a trip (group travel supported)
//   PATCH  { trip_id, action }         SUBMIT | APPROVE | REJECT | ACTIVATE | CLOSE | CANCEL
//
// Group travel note: each traveller's entitlement is FROZEN into
// entitlement_snapshot at creation, so a mid-trip promotion or a rate-card
// change on the 1st cannot silently rewrite an already-computed pooled limit.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  serviceClient,
  requireWriteAccess,
  requireReadAccess,
  guardResponse,
  getActivePolicy,
} from '@/lib/travel/access';
import { findEntitlement } from '@/lib/travel/calc';

export const dynamic = 'force-dynamic';

interface TravellerInput {
  employee_id?: string;
  guest_name?: string;
  guest_company?: string;
  guest_designation?: string;
}

// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const sb = serviceClient();
    const employeeId = req.nextUrl.searchParams.get('employee_id');
    const status = req.nextUrl.searchParams.get('status');

    if (!employeeId) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }

    const access = await requireReadAccess(sb, employeeId);
    if (!access.ok) return guardResponse(access.guard);

    // trips I lead
    let q = sb
      .from('travel_trips')
      .select('*, travel_trip_travellers(*)')
      .eq('employee_id', employeeId)
      .order('from_date', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data: mine, error } = await q;
    if (error) throw error;

    // trips I am a co-traveller on
    const { data: asTraveller } = await sb
      .from('travel_trip_travellers')
      .select('trip_id, travel_trips(*)')
      .eq('employee_id', employeeId)
      .eq('traveller_type', 'INTERNAL')
      .eq('status', 'CONFIRMED');

    return NextResponse.json({
      trips: mine ?? [],
      joined_trips: (asTraveller ?? []).map((r) => r.travel_trips).filter(Boolean),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load trips' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const sb = serviceClient();
    const body = await req.json();

    const {
      employee_id,
      trip_type = 'OUTSTATION',
      purpose,
      client_name = null,
      from_city = null,
      to_city = null,
      from_date,
      to_date,
      travel_mode = null,
      hotel_required = false,
      estimated_cost = null,
      advance_requested = 0,
      travellers = [] as TravellerInput[],
    } = body ?? {};

    if (!employee_id || !purpose || !from_date || !to_date) {
      return NextResponse.json(
        { error: 'employee_id, purpose, from_date and to_date are required' },
        { status: 400 }
      );
    }
    if (to_date < from_date) {
      return NextResponse.json({ error: 'End date cannot be before start date.' }, { status: 400 });
    }

    // guard against the trip START date — a trip into a closed month is pointless
    const access = await requireWriteAccess(sb, employee_id, from_date);
    if (!access.ok) return guardResponse(access.guard);

    const emp = access.employee!;
    const policy = access.policy!;

    // `body` is untyped JSON, so the destructured default does not carry its
    // annotation through — restate it here or every callback below infers any.
    const travellerList: TravellerInput[] = Array.isArray(travellers) ? travellers : [];

    const internal = travellerList.filter((t) => t.employee_id);
    const guests = travellerList.filter((t) => !t.employee_id && t.guest_name);

    if (internal.length + 1 > policy.max_travellers_per_trip) {
      return NextResponse.json(
        {
          error: `A trip can have at most ${policy.max_travellers_per_trip} travellers. For anything larger, raise it as an event budget instead.`,
        },
        { status: 400 }
      );
    }
    if (guests.length > 0 && !policy.guest_travel_enabled) {
      return NextResponse.json(
        { error: 'External guests are not enabled for your company. Ask HR to switch it on.' },
        { status: 400 }
      );
    }
    if (guests.length > policy.max_guests_per_trip) {
      return NextResponse.json(
        { error: `At most ${policy.max_guests_per_trip} external guests per trip.` },
        { status: 400 }
      );
    }
    if (policy.guest_travel_enabled) {
      const bad = guests.find((g) => !g.guest_company || !g.guest_designation);
      if (bad) {
        return NextResponse.json(
          { error: `Company and designation are required for guest "${bad.guest_name}".` },
          { status: 400 }
        );
      }
    }

    // ---- city class -----------------------------------------------------
    let toCityClass: 'METRO' | 'TIER2' | 'OTHER' = 'OTHER';
    if (to_city) {
      const { data: cityRow } = await sb
        .from('travel_city_class')
        .select('city_class')
        .eq('company_id', emp.company_id)
        .ilike('city_name', to_city)
        .maybeSingle();
      toCityClass = (cityRow?.city_class as typeof toCityClass) ?? 'OTHER';
    }

    // ---- entitlement snapshots ------------------------------------------
    const { data: entitlements } = await sb
      .from('travel_entitlements')
      .select('*')
      .eq('policy_id', policy.id);

    const { data: types } = await sb
      .from('travel_expense_types')
      .select('type_code')
      .eq('company_id', emp.company_id)
      .eq('is_active', true);

    const typeCodes = (types ?? []).map((t) => t.type_code);

    const snapshotFor = (grade: string | null) => {
      const snap: Record<string, number> = {};
      for (const code of typeCodes) {
        const e = findEntitlement(entitlements ?? [], grade, toCityClass, code);
        if (e?.limit_value != null) snap[code] = Number(e.limit_value);
      }
      return snap;
    };

    // ---- create trip ----------------------------------------------------
    const { data: tripNoRow } = await sb.rpc('travel_next_trip_no', {
      p_company_id: emp.company_id,
    });

    const isGroup = internal.length + guests.length > 0;

    const { data: trip, error } = await sb
      .from('travel_trips')
      .insert({
        company_id: emp.company_id,
        trip_no: tripNoRow as unknown as string,
        employee_id,
        trip_type,
        purpose,
        client_name,
        from_city,
        to_city,
        to_city_class: toCityClass,
        from_date,
        to_date,
        travel_mode,
        hotel_required,
        estimated_cost,
        advance_requested: policy.trip_advance_enabled ? advance_requested : 0,
        is_group_trip: isGroup,
        traveller_count: internal.length + 1,
        guest_count: guests.length,
        status: 'DRAFT',
      })
      .select()
      .single();

    if (error) throw error;

    // ---- travellers -----------------------------------------------------
    const rows: Record<string, unknown>[] = [
      {
        trip_id: trip.id,
        traveller_type: 'LEADER',
        employee_id,
        grade_snapshot: emp.grade,
        entitlement_snapshot: snapshotFor(emp.grade),
        status: 'CONFIRMED',
        joined_date: from_date,
        added_by: employee_id,
      },
    ];

    if (internal.length > 0) {
      const ids = internal.map((t) => t.employee_id!) as string[];
      const { data: coEmps } = await sb
        .from('employees')
        .select('id, grade, full_name')
        .in('id', ids);

      for (const t of internal) {
        const ce = (coEmps ?? []).find((x) => x.id === t.employee_id);
        rows.push({
          trip_id: trip.id,
          traveller_type: 'INTERNAL',
          employee_id: t.employee_id,
          grade_snapshot: ce?.grade ?? null,
          entitlement_snapshot: snapshotFor(ce?.grade ?? null),
          status: 'CONFIRMED',
          joined_date: from_date,
          added_by: employee_id,
        });
      }
    }

    for (const g of guests) {
      rows.push({
        trip_id: trip.id,
        traveller_type: 'GUEST',
        guest_name: g.guest_name,
        guest_company: g.guest_company ?? null,
        guest_designation: g.guest_designation ?? null,
        grade_snapshot: 'GUEST',
        entitlement_snapshot: { FOOD: Number(policy.guest_per_head_limit) },
        status: 'CONFIRMED',
        joined_date: from_date,
        added_by: employee_id,
      });
    }

    const { data: savedTravellers } = await sb
      .from('travel_trip_travellers')
      .insert(rows)
      .select();

    // ---- pooled limit preview for the UI --------------------------------
    const foodPool = (savedTravellers ?? []).reduce((s, t) => {
      const snap = (t.entitlement_snapshot ?? {}) as Record<string, number>;
      return s + Number(snap.FOOD ?? 0);
    }, 0);

    return NextResponse.json({
      trip,
      travellers: savedTravellers ?? [],
      preview: {
        traveller_count: rows.length,
        pooled_food_limit_per_day: foodPool,
        pooling_method: policy.group_limit_method,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create trip' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const sb = serviceClient();
    const { trip_id, action, actioned_by, remarks } = (await req.json()) ?? {};

    if (!trip_id || !action) {
      return NextResponse.json({ error: 'trip_id and action are required' }, { status: 400 });
    }

    const { data: trip } = await sb
      .from('travel_trips')
      .select('*')
      .eq('id', trip_id)
      .maybeSingle();

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const policy = await getActivePolicy(sb, trip.company_id);
    const patch: Record<string, unknown> = {};
    let stage: string | null = null;

    switch (action) {
      case 'SUBMIT': {
        const access = await requireWriteAccess(sb, trip.employee_id, trip.from_date);
        if (!access.ok) return guardResponse(access.guard);
        patch.status = 'PENDING_RM';
        stage = 'TRIP_RM';
        break;
      }
      case 'APPROVE':
        patch.status = 'APPROVED';
        patch.approved_by = actioned_by ?? null;
        patch.approved_at = new Date().toISOString();
        break;
      case 'REJECT':
        patch.status = 'REJECTED';
        patch.rejection_reason = remarks ?? null;
        break;
      case 'ACTIVATE':
        patch.status = 'ACTIVE';
        break;
      case 'CLOSE':
        patch.status = 'CLOSED';
        break;
      case 'CANCEL':
        patch.status = 'CANCELLED';
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const { data: updated, error } = await sb
      .from('travel_trips')
      .update(patch)
      .eq('id', trip_id)
      .select()
      .single();

    if (error) throw error;

    if (stage === 'TRIP_RM') {
      const due = new Date();
      due.setDate(due.getDate() + (policy?.rm_sla_days ?? 3));

      await sb.from('travel_approvals').insert({
        trip_id,
        stage: 'TRIP_RM',
        approver_id: null, // resolved from employees.l1_manager_id by the inbox
        sla_due_at: due.toISOString(),
      });

      // co-travellers' managers: notify, do not block
      if (policy?.cotraveller_approval_mode === 'LEADER_RM_WITH_NOTIFY') {
        const { data: co } = await sb
          .from('travel_trip_travellers')
          .select('id, employee_id')
          .eq('trip_id', trip_id)
          .eq('traveller_type', 'INTERNAL');

        if (co && co.length) {
          await sb
            .from('travel_trip_travellers')
            .update({ rm_notified_at: new Date().toISOString() })
            .in('id', co.map((c) => c.id));
        }
      }
    }

    if (action === 'APPROVE' || action === 'REJECT') {
      await sb
        .from('travel_approvals')
        .update({
          approver_id: actioned_by ?? null,
          action: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          remarks: remarks ?? null,
          actioned_at: new Date().toISOString(),
        })
        .eq('trip_id', trip_id)
        .eq('stage', 'TRIP_RM')
        .is('actioned_at', null);
    }

    return NextResponse.json({ trip: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update trip' },
      { status: 500 }
    );
  }
}
