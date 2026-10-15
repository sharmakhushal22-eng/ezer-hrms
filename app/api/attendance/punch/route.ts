// app/api/attendance/punch/route.ts — the older Punch IN / OUT API.
//
// It took employee_id from the request body and ran ess_punch() with the
// service key, so anybody who could reach it could punch for anybody. It now
// takes the employee from the ESS session, like /api/ess/punch, and goes
// through the same rule (lib/attendance/punch.ts): punches alternate. A body
// employee_id that names somebody else is refused.
//
// Kept, rather than deleted, because the mobile app falls back to it when
// /api/ess/punch is missing; the response shape is unchanged for that caller.
import { NextRequest, NextResponse } from 'next/server'
import { essCaller } from '@/lib/ess/session'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { punch, punchState, istDate } from '@/lib/attendance/punch'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

/** The signed-in employee. An admin "viewing as" somebody (employee_id on the
 *  request) is refused for a punch — it would land on the other person's day. */
async function self(req: NextRequest, write: boolean) {
  const c = await essCaller(req)
  if (c.error) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  if (c.caller.viewAs) return { error: NextResponse.json({ error: write ? 'You can only punch for yourself.' : 'You can only read your own punches.' }, { status: 403 }) }
  return { id: c.caller.employeeId }
}

export async function POST(req: NextRequest) {
  const me = await self(req, true)
  if ('error' in me) return me.error
  try {
    const { employee_id, punch_type, latitude, longitude } = await req.json()
    if (employee_id && employee_id !== me.id) return NextResponse.json({ error: 'You can only punch for yourself.' }, { status: 403 })
    if (!['IN', 'OUT'].includes(punch_type)) return NextResponse.json({ error: 'punch_type must be IN or OUT' }, { status: 400 })

    const out = await punch(me.id, punch_type === 'IN' ? 'in' : 'out', { lat: latitude, lng: longitude })
    if (!out.ok) return NextResponse.json({ error: out.error, state: out.state }, { status: out.status, headers: NO_STORE })

    const { data: record } = await sb.from('attendance_records')
      .select('work_in, work_out, total_minutes, late_minutes, status, punch_count')
      .eq('employee_id', me.id).eq('attendance_date', istDate()).maybeSingle()
    return NextResponse.json({ ok: true, punch: out.result, today: record, state: out.state }, { headers: NO_STORE })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const me = await self(req, false)
  if ('error' in me) return me.error
  const { searchParams } = new URL(req.url)
  const asked = searchParams.get('employee_id')
  if (asked && asked !== me.id) return NextResponse.json({ error: 'You can only read your own punches.' }, { status: 403 })
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '') ? searchParams.get('date')! : istDate()

  const [state, record] = await Promise.all([
    punchState(me.id, date),
    sb.from('attendance_records').select('work_in, work_out, total_minutes, late_minutes, status, overtime_minutes, punch_count')
      .eq('employee_id', me.id).eq('attendance_date', date).maybeSingle(),
  ])
  return NextResponse.json({
    date, punches: state.punches, summary: record.data ?? null,
    first_in: state.first_in, last_out: state.last_out, state,
  }, { headers: NO_STORE })
}
