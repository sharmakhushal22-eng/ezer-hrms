// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/rates/route.ts
//
//   GET   ?company_id=...                    the rate card + expense types
//   POST  { company_id, type_code, rate_per_km, effective_from, set_by }
//                                            set a rate (new version, not edit)
//   PATCH { type_id, ...flags }              enable/disable an expense type
//
// RATES ARE VERSIONED, NEVER OVERWRITTEN.
// Setting a new rate inserts a row with a later effective_from. The old row
// stays, so a claim already approved at ₹12/km keeps being explainable at
// ₹12/km after HR moves the rate to ₹14. Editing in place would silently
// rewrite the history of every settled claim.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/travel/errors';
import { serviceClient, getActivePolicy, todayISO } from '@/lib/travel/access';
import { requireDashboardUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    // Money: this sets what the company pays per kilometre. Dashboard
    // session required — it ran open to the internet otherwise.
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const companyId = req.nextUrl.searchParams.get('company_id');
    if (!companyId) {
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
    }

    const policy = await getActivePolicy(sb, companyId);
    if (!policy) {
      return NextResponse.json(
        { error: 'No active travel policy is configured for this company.', code: 'NO_POLICY' },
        { status: 409 }
      );
    }

    const [{ data: types }, { data: rates }] = await Promise.all([
      sb.from('travel_expense_types').select('*')
        .eq('company_id', companyId).order('sort_order'),
      sb.from('travel_mileage_rates').select('*')
        .eq('policy_id', policy.id).order('effective_from', { ascending: false }),
    ]);

    // Who set each rate, resolved in one query rather than per row.
    const setterIds = Array.from(
      new Set((rates ?? []).map((r) => r.set_by).filter(Boolean))
    ) as string[];
    const { data: setters } = setterIds.length
      ? await sb.from('employees').select('id, full_name').in('id', setterIds)
      : { data: [] };
    const nameOf = new Map((setters ?? []).map((s: any) => [s.id, s.full_name]));

    const today = todayISO();
    const withNames = (rates ?? []).map((r) => ({
      ...r,
      set_by_name: r.set_by ? nameOf.get(r.set_by) ?? null : null,
      /** false for a rate dated in the future — scheduled, not yet in force */
      in_force: r.effective_from <= today,
    }));

    return NextResponse.json({
      policy_id: policy.id,
      rm_stage_enabled: policy.rm_stage_enabled,
      types: types ?? [],
      rates: withNames,
    });
  } catch (e) {
    return errorResponse(e, 'Failed to load the rate card',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// POST — set a rate for a travel mode
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // Money: this sets what the company pays per kilometre. Dashboard
    // session required — it ran open to the internet otherwise.
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const {
      company_id,
      type_code,
      rate_per_km,
      effective_from = todayISO(),
      set_by = null,
      notes = null,
    } = (await req.json()) ?? {};

    if (!company_id || !type_code) {
      return NextResponse.json(
        { error: 'company_id and type_code are required' },
        { status: 400 }
      );
    }

    const rate = Number(rate_per_km);
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json(
        { error: 'Enter a rate per kilometre greater than zero.' },
        { status: 400 }
      );
    }
    // A rate this high is far more likely to be a typo than a policy — ₹500/km
    // on a 40 km commute is ₹20,000 for one journey.
    if (rate > 200) {
      return NextResponse.json(
        { error: `₹${rate}/km looks like a mistake. If it is deliberate, set it in two steps.` },
        { status: 400 }
      );
    }

    const policy = await getActivePolicy(sb, company_id);
    if (!policy) {
      return NextResponse.json(
        { error: 'No active travel policy is configured for this company.' },
        { status: 409 }
      );
    }

    const { data: type } = await sb
      .from('travel_expense_types')
      .select('type_code, type_name, calc_method')
      .eq('company_id', company_id).eq('type_code', type_code).maybeSingle();

    if (!type) {
      return NextResponse.json({ error: `Unknown expense type ${type_code}` }, { status: 400 });
    }
    if (type.calc_method !== 'PER_KM') {
      return NextResponse.json(
        { error: `${type.type_name} is not paid by distance, so it has no rate per kilometre.` },
        { status: 400 }
      );
    }

    // Backdating would change what an already-approved claim should have paid.
    if (effective_from < todayISO()) {
      const { count } = await sb
        .from('travel_claims')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company_id)
        .in('status', ['APPROVED', 'PAID'])
        .gte('period_to', effective_from);

      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              `${count} claim${count === 1 ? ' has' : 's have'} already been settled on or after ` +
              `${effective_from}. Choose a later date so settled claims keep the rate they were paid at.`,
            code: 'WOULD_REWRITE_HISTORY',
          },
          { status: 409 }
        );
      }
    }

    // upsert on the unique index (policy, type, vehicle, fuel, cc, date):
    // setting the same mode twice on one date corrects that day's rate rather
    // than failing, but a different date always makes a new version.
    const { data: saved, error } = await sb
      .from('travel_mileage_rates')
      .upsert(
        {
          policy_id: policy.id,
          type_code,
          vehicle_type: null,
          fuel_type: null,
          cc_band: 'NA',
          rate_per_km: rate,
          effective_from,
          rate_label: type.type_name,
          notes,
          set_by,
          set_at: new Date().toISOString(),
        },
        { onConflict: 'policy_id,type_code,vehicle_type,fuel_type,cc_band,effective_from' }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      rate: saved,
      message:
        effective_from > todayISO()
          ? `${type.type_name} will move to ₹${rate}/km from ${effective_from}.`
          : `${type.type_name} is now ₹${rate}/km.`,
    });
  } catch (e) {
    return errorResponse(e, 'Failed to set the rate',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}

// ---------------------------------------------------------------------------
// PATCH — turn an expense type on or off, or change how it is evidenced
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    // Money: this sets what the company pays per kilometre. Dashboard
    // session required — it ran open to the internet otherwise.
    const gate = await requireDashboardUser(req);
    if (gate.error) return gate.error;

    const sb = serviceClient();
    const { type_id, is_active, requires_gps, bill_required, bill_threshold } =
      (await req.json()) ?? {};

    if (!type_id) {
      return NextResponse.json({ error: 'type_id is required' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (is_active !== undefined) patch.is_active = !!is_active;
    if (requires_gps !== undefined) patch.requires_gps = !!requires_gps;
    if (bill_required !== undefined) patch.bill_required = !!bill_required;
    if (bill_threshold !== undefined) patch.bill_threshold = Number(bill_threshold) || 0;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    }

    // Only a distance-priced type can be GPS-evidenced; requiring a recording
    // for a hotel bill would make the type unusable.
    if (patch.requires_gps === true) {
      const { data: t } = await sb
        .from('travel_expense_types').select('calc_method, type_name')
        .eq('id', type_id).maybeSingle();
      if (t && t.calc_method !== 'PER_KM') {
        return NextResponse.json(
          { error: `${t.type_name} is paid on the bill amount, so it cannot be priced from a recorded journey.` },
          { status: 400 }
        );
      }
    }

    const { data, error } = await sb
      .from('travel_expense_types').update(patch).eq('id', type_id).select().single();

    if (error) throw error;
    return NextResponse.json({ type: data });
  } catch (e) {
    return errorResponse(e, 'Failed to update the expense type',
      'The travel tables are not fully migrated — check 049, 050 and 051 have all been run.');
  }
}
