// app/api/ess/announcements/route.ts — POST { id } marks an announcement read (clears the dot)
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getSessionEmployee } from '@/lib/session';
import { TODAY_TABLES } from '@/lib/today/schema';

export async function POST(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await req.json();
  const sb = createServerClient();
  await sb.from(TODAY_TABLES.announcementReads).upsert({ announcement_id: id, employee_id: me.id }, { onConflict: 'announcement_id,employee_id' });
  return NextResponse.json({ ok: true });
}
