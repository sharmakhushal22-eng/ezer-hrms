import { NextRequest, NextResponse } from 'next/server';
import { resolveEmployeeId, svc } from '@/lib/profile/access';
import { writer } from '@/lib/profile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ess/profile/request
 * { code, fieldKey, fieldLabel, newValue, reason }
 * Routing (RM L1 then HR, or straight to Payroll for bank fields) is decided
 * by raise_profile_change_request() in the database, not here.
 */
export async function POST(req: NextRequest) {
  // writer(), not essViewerId(): the latter answers the VIEWED employee in
  // view-as, so the shared dashboard login could file requests as anybody.
  // The live screen uses POST /api/ess/profile { action: 'request' }; this is
  // the vendor shell's path, kept working but held to the same rule.
  const w = await writer(req);
  if (w.error) return w.error;
  const viewerId = w.me;

  const b = await req.json().catch(() => ({}));
  const { code, fieldKey, fieldLabel, newValue, reason } = b ?? {};
  if (!fieldKey || !newValue) {
    return NextResponse.json({ error: 'fieldKey and newValue are required' }, { status: 400 });
  }

  const targetId = !code || code === 'me' ? viewerId : await resolveEmployeeId(code);
  if (!targetId) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (targetId !== viewerId) {
    return NextResponse.json(
      { error: 'forbidden', message: 'You can only raise a request on your own profile.' },
      { status: 403 }
    );
  }

  const { data, error } = await svc().rpc('raise_profile_change_request', {
    p_employee_id: targetId,
    p_requested_by: viewerId,
    p_field_key: fieldKey,
    p_field_label: fieldLabel ?? fieldKey,
    p_new_value: String(newValue),
    p_reason: reason ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, requestId: data });
}
