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
  // 'light', matching the product default in lib/ui/theme-resolve.ts. This said
  // 'auto', which meant an employee who had never touched Today's theme button
  // was handed "follow the OS" by the server on every load — re-seeding the
  // client-side wipe that reset their nav-toggle choice.
  return NextResponse.json(data ?? { theme: 'light', time_format: '24', date_format: 'long' });
}

export async function PUT(req: NextRequest) {
  const me = await getSessionEmployee(req);
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const b = await req.json();
  const sb = createServerClient();

  // MERGE, do not replace.
  //
  // Every field used to fall back to a default when absent, so a caller sending
  // only { theme } silently reset that employee's time and date formats. The
  // nav-bar theme toggle sends exactly that — it knows the theme and nothing
  // else — so without this, changing the theme would quietly undo two unrelated
  // preferences.
  const { data: cur } = await sb.from(TODAY_TABLES.prefs)
    .select('theme,time_format,date_format').eq('employee_id', me.id).maybeSingle();

  // Absent → keep what is stored. Present but invalid → the default, so a bad
  // value cannot be written and cannot persist either.
  const pick = (v: unknown, allowed: string[], current: string | undefined, fallback: string) =>
    typeof v === 'string' && allowed.includes(v) ? v : (current ?? fallback);

  const row = {
    employee_id: me.id,
    theme:       pick(b.theme,       THEMES, cur?.theme,       'light'),   // default, not 'auto'
    time_format: pick(b.time_format, TIMES,  cur?.time_format, '24'),
    date_format: pick(b.date_format, DATES,  cur?.date_format, 'long'),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from(TODAY_TABLES.prefs).upsert(row, { onConflict: 'employee_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...row });
}
