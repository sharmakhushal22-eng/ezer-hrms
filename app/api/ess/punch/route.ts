// app/api/ess/punch/route.ts — POST { kind:'in'|'out', lat?, lng? } → ess_punch()
//
// TWO EDITS FROM THE DROP.
//
// 1. The handler passes its request to getSessionEmployee(); identity here is a
//    bearer token on the request, invisible to a no-argument helper.
//
// 2. THE RPC SIGNATURE IS NOT THE ONE THE PACKAGE ASSUMED. It was written
//    against ess_punch(p_employee_id, p_kind 'in'|'out', p_lat, p_lng,
//    p_source) from a migration called 087_mobile_app.sql, which was never in
//    this repo — 087 here is 087_social_and_inbox.sql, something else entirely.
//    The function does exist, with different parameter names and uppercase
//    punch types:
//
//        ess_punch(p_employee_id, p_punch_type 'IN'|'OUT',
//                  p_latitude, p_longitude, p_branch_id)
//
//    Called the package's way it fails with PGRST202 and the dial does nothing.
//    Geofence and miss-punch rules already live inside the function; this only
//    translates the arguments and hands the RPC's own message back as a toast.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getSessionEmployee } from '@/lib/session';
import { TODAY_RPC } from '@/lib/today/schema';

export async function POST(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (me.date_of_leaving && new Date(me.date_of_leaving) < new Date())
    return NextResponse.json({ error: 'access ended' }, { status: 403 });

  const { kind, lat, lng } = await req.json();
  if (kind !== 'in' && kind !== 'out')
    return NextResponse.json({ error: 'kind must be in|out' }, { status: 400 });

  const sb = createServerClient();
  const { data, error } = await sb.rpc(TODAY_RPC.punch, {
    p_employee_id: me.id,
    p_punch_type: kind === 'in' ? 'IN' : 'OUT',   // the function takes uppercase
    p_latitude: lat ?? null,
    p_longitude: lng ?? null,
    p_branch_id: null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // The dial shows the time it actually landed, not when the click happened.
  const at = (data as { punch_time?: string } | null)?.punch_time ?? new Date().toISOString();
  return NextResponse.json({ ok: true, at, result: data });
}
