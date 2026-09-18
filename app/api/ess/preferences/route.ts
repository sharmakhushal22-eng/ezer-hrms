// app/api/ess/preferences/route.ts//
// ONE EDIT FROM THE DROP: the handlers take the request and pass it to
// getSessionEmployee(). Identity here is a signed bearer token on the request,
// so a helper with no argument cannot see it. lib/session.ts explains why that
// resolves through essCaller() rather than being re-derived.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getSessionEmployee } from '@/lib/session';
import { TODAY_TABLES } from '@/lib/today/schema';

const THEMES = ['auto', 'light', 'dark'], TIMES = ['12', '24'], DATES = ['long', 'short', 'dmy', 'mdy', 'iso'];

export async function GET(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const sb = createServerClient();
  const { data } = await sb.from(TODAY_TABLES.prefs).select('theme,time_format,date_format').eq('employee_id', me.id).maybeSingle();
  return NextResponse.json(data ?? { theme: 'auto', time_format: '24', date_format: 'long' });
}

export async function PUT(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const b = await req.json();
  const row = {
    employee_id: me.id,
    theme: THEMES.includes(b.theme) ? b.theme : 'auto',
    time_format: TIMES.includes(b.time_format) ? b.time_format : '24',
    date_format: DATES.includes(b.date_format) ? b.date_format : 'long',
    updated_at: new Date().toISOString(),
  };
  const sb = createServerClient();
  const { error } = await sb.from(TODAY_TABLES.prefs).upsert(row, { onConflict: 'employee_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...row });
}
