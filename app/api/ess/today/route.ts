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
import { ledgerFor } from '@/lib/leave/ledger';
import { punchState } from '@/lib/attendance/punch';
import { rmsServiceClient as sb } from '@/lib/rms/server';

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

  // Leave balance, from the same ledger as the Leave tab and Home. The RPC's
  // own figure sums accrued − used over every stored row — every year and
  // every type, Maternity entitlement and LWP included — so it is replaced.
  try {
    const ledger = await ledgerFor(me.id);
    if (ledger) {
      payload.leave = {
        total: ledger.headlineTotal,
        accrued_this_month: 0,
        by_type: Object.fromEntries(ledger.headline.map(b => [b.name, b.available ?? 0])),
      };
    }
  } catch {
    // keep the RPC's figure rather than blank the tile
  }

  // Punch state, from the punches themselves (lib/attendance/punch.ts). The RPC
  // finds today's record with `current_date`, which is UTC: from midnight to
  // 05:30 IST it reported yesterday, and the dial offered Punch In again.
  // open / last_in say whether the employee is at work right now — the record
  // alone cannot, once somebody has punched out and back in.
  try {
    const st = await punchState(me.id);
    payload.today = {
      punch_in: st.first_in, punch_out: st.open ? null : st.last_out,
      open: st.open, last_in: st.last_in, work_mode: null,
    };
  } catch {
    // keep the RPC's answer
  }

  // The week strip hardcoded Saturday and Sunday as off. These companies work
  // Saturdays; the configured weekly offs and the published holiday calendar
  // decide it instead, as they do on the Attendance tab.
  try {
    const week = (payload.week as { date: string; is_off: boolean }[] | undefined) || [];
    if (week.length) {
      const day = (d: string) => String(d).slice(0, 10);
      const [offR, holR] = await Promise.all([
        sb.rpc('resolve_weekly_offs', { p_employee_id: me.id, p_from: day(week[0].date), p_to: day(week[week.length - 1].date) }),
        sb.rpc('resolve_holidays', { p_employee_id: me.id }),
      ]);
      if (!offR.error && !holR.error) {
        const off = new Set<string>([
          ...((offR.data || []) as { off_date: string }[]).map(r => String(r.off_date)),
          ...((holR.data || []) as { holiday_date: string }[]).map(r => String(r.holiday_date)),
        ]);
        payload.week = week.map(d => ({ ...d, is_off: off.has(day(d.date)) }));
      }
    }
  } catch {
    // keep the RPC's answer
  }

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

  // Never cached. This was private, max-age=30: punch, open another tab, come
  // back within half a minute and the browser served the pre-punch payload —
  // so Punch In was offered, and pressed, again.
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
