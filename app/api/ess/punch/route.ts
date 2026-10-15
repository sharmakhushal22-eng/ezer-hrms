// app/api/ess/punch/route.ts — Punch In / Punch Out for the signed-in employee.
//
// GET  → today's punch state (open or not, first in, last out, the punches)
// POST → { kind: 'in' | 'out', lat?, lng? }
//
// Identity comes from the ESS session only. The rule — punches alternate, IN
// refused while one is open, OUT refused when none is — is lib/attendance/punch.ts,
// shared with the older /api/attendance/punch so no screen can get round it.
// A refusal still returns `state`, so the screen corrects itself to the truth
// instead of showing the wrong button again.
import { NextResponse, type NextRequest } from 'next/server';
import { essCaller } from '@/lib/ess/session';
import { rmsServiceClient as sb } from '@/lib/rms/server';
import { punch, punchState } from '@/lib/attendance/punch';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The signed-in employee — never somebody being viewed. essCaller() honours an
 * employee_id on the request for an admin "viewing as" somebody, which is right
 * for reading a portal and wrong for punching: it would put a punch on THEIR day.
 */
async function me(req: NextRequest, write: boolean) {
  const c = await essCaller(req);
  if (c.error) return { error: c.error };
  if (write && c.caller.viewAs)
    return { error: NextResponse.json({ error: "You cannot punch while viewing somebody else's portal." }, { status: 403 }) };
  const { data: emp } = await sb.from('employees').select('id, date_of_leaving').eq('id', c.caller.employeeId).maybeSingle();
  if (!emp) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  if (emp.date_of_leaving && new Date(emp.date_of_leaving) < new Date())
    return { error: NextResponse.json({ error: 'access ended' }, { status: 403 }) };
  return { id: emp.id as string };
}

export async function GET(req: NextRequest) {
  const m = await me(req, false);
  if ('error' in m) return m.error;
  return NextResponse.json({ state: await punchState(m.id) }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const m = await me(req, true);
  if ('error' in m) return m.error;

  const { kind, lat, lng } = await req.json().catch(() => ({}));
  if (kind !== 'in' && kind !== 'out')
    return NextResponse.json({ error: 'kind must be in|out' }, { status: 400 });

  const out = await punch(m.id, kind, { lat, lng });
  if (!out.ok) return NextResponse.json({ error: out.error, state: out.state }, { status: out.status, headers: NO_STORE });
  // The dial shows the time it actually landed, not when the click happened.
  return NextResponse.json({ ok: true, at: out.at, result: out.result, state: out.state }, { headers: NO_STORE });
}
