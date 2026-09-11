// app/api/ess/today/route.ts — GET → ess_today_payload(employee_id)
//
// TWO EDITS FROM THE DROP.
//
// 1. The handler passes its request to getSessionEmployee(). Identity here is a
//    signed bearer token on the request, invisible to a no-argument helper.
//
// 2. APPROVALS ARE MERGED HERE. The spec has `pending` as action items ∪
//    ess_my_approvals(), but that function does not exist in this repo — the
//    drop cites 087_mobile_app.sql, which was never here. Rather than write a
//    second approvals query in SQL and let it drift, migration 111 returns the
//    action items and this route folds in lib/ess/pending.ts, the same builder
//    /api/ess/approvals already uses. One approvals implementation, two callers.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getSessionEmployee } from '@/lib/session';
import { TODAY_RPC } from '@/lib/today/schema';
import { essRoute } from '@/lib/ess/session';
import { buildPending } from '@/lib/ess/pending';

export const dynamic = 'force-dynamic';

interface PendingEntry {
  kind: 'action' | 'approval'; id: string; type: string; title: string;
  description: string | null; due_on: string | null; cta_label: string; cta_route: string;
}

export async function GET(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (me.date_of_leaving && new Date(me.date_of_leaving) < new Date())
    return NextResponse.json({ error: 'access ended' }, { status: 403 });     // hard rule: no reads after LWD

  const sb = createServerClient();
  const { data, error } = await sb.rpc(TODAY_RPC.payload, { p_employee_id: me.id });
  if (error) {
    // A missing function is a deployment state, not a fault in the caller. Say
    // which migration is missing rather than handing a PostgREST code to
    // somebody looking at a blank tab.
    const missing = error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? '');
    return NextResponse.json(
      { error: missing
          ? 'The Today tab is not installed yet (migration 111). Ask your administrator to run it.'
          : error.message,
        installed: missing ? false : undefined },
      { status: missing ? 503 : 500 });
  }

  const payload = data as Record<string, unknown> & { pending?: PendingEntry[] };

  // Approvals, from the app's own builder. A failure here must not blank the
  // whole tab: the rest of Today is unrelated, so it degrades to action items.
  try {
    const r = await essRoute(req);
    if (!r.error && r.ctx.canApprovals) {
      const approvals = await buildPending(r.ctx);
      const mapped: PendingEntry[] = approvals.map(a => ({
        kind: 'approval',
        id: a.id,
        type: a.kind.toLowerCase(),
        title: a.what,
        description: a.who,
        due_on: null,
        cta_label: a.mine ? (a.actions[0] ?? 'Review') : 'View',
        cta_route: a.link ?? '/dashboard/ess?tab=approvals',
      }));
      payload.pending = [...(payload.pending ?? []), ...mapped];
    }
  } catch {
    // action items alone; the card still renders
  }

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
