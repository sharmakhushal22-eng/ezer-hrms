// app/api/ess/announcements/route.ts
//
//   GET  → { announcements: [...], unread, diagnostics }
//   POST { id } marks an announcement read (clears the dot)
//
// WHY THE GET EXISTS
//
// This route was POST-only, so a client that wanted to *show* announcements
// had nowhere to ask. The Android app therefore reads a table directly — and
// reads a different one: `ess_announcements`, which is anon-readable and
// empty, while Today's payload serves `company_announcements`, which is
// correctly closed to anon. Two tables, two answers, and the one the phone can
// reach is the one nobody writes to.
//
// The GET below serves the same rows Today does, through the service role,
// scoped to the caller's company — so the app can stop reading a table
// altogether and both clients show the same announcements.
//
// `audience` is deliberately not interpreted here. Today's payload ignores it
// too, and inventing targeting semantics in a second place is how the two
// clients would start disagreeing again.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getSessionEmployee } from '@/lib/session';
import { TODAY_TABLES } from '@/lib/today/schema';
import { rmsServiceClient as sb } from '@/lib/rms/server';
import { essRoute } from '@/lib/ess/session';

export const dynamic = 'force-dynamic';

interface AnnouncementRow {
  id: string;
  title: string;
  body: string | null;
  is_pinned: boolean | null;
  cta_label: string | null;
  cta_route: string | null;
  published_at: string;
  expires_at: string | null;
}

export async function GET(req: NextRequest) {
  const r = await essRoute(req);
  if (r.error) return r.error;
  const me = r.ctx.caller.employeeId;
  const companyId = r.ctx.companyId;

  // No company on the employee record means no audience to draw from — an
  // empty list with the reason, rather than every company's notices.
  if (!companyId) {
    return NextResponse.json({
      announcements: [], unread: 0,
      diagnostics: { noCompany: true, noAnnouncements: true },
    });
  }

  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 20;

  const [listR, readR] = await Promise.all([
    sb.from(TODAY_TABLES.announcements)
      .select('id, title, body, is_pinned, cta_label, cta_route, published_at, expires_at')
      .eq('company_id', companyId)
      // Expired notices are not news. The partial index in migration 111 is on
      // exactly this predicate.
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(limit),
    sb.from(TODAY_TABLES.announcementReads)
      .select('announcement_id')
      .eq('employee_id', me),
  ]);

  if (listR.error) return NextResponse.json({ error: listR.error.message }, { status: 500 });

  const read = new Set<string>(
    (Array.isArray(readR.data) ? readR.data : [])
      .map(x => String((x as { announcement_id?: unknown }).announcement_id ?? '')),
  );
  const rows = (Array.isArray(listR.data) ? listR.data : []) as unknown as AnnouncementRow[];

  const announcements = rows.map(a => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: !!a.is_pinned,
    cta_label: a.cta_label,
    cta_route: a.cta_route,
    published_at: a.published_at,
    unread: !read.has(a.id),
  }));

  return NextResponse.json({
    announcements,
    unread: announcements.filter(a => a.unread).length,
    diagnostics: { noCompany: false, noAnnouncements: !announcements.length },
  });
}

export async function POST(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await req.json();
  const sb = createServerClient();
  await sb.from(TODAY_TABLES.announcementReads).upsert({ announcement_id: id, employee_id: me.id }, { onConflict: 'announcement_id,employee_id' });
  return NextResponse.json({ ok: true });
}
