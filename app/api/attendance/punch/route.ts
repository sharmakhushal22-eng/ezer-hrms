// app/api/attendance/punch/route.ts — ESS Punch IN / OUT API
// POST → ess_punch() DB fn (geofence + raw insert + process). GET → today's log.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { employee_id, punch_type, latitude, longitude, branch_id } = await req.json()
    if (!employee_id || !punch_type) return NextResponse.json({ error: 'employee_id and punch_type required' }, { status: 400 })
    if (!['IN', 'OUT'].includes(punch_type)) return NextResponse.json({ error: 'punch_type must be IN or OUT' }, { status: 400 })

    const { data, error } = await supabase.rpc('ess_punch', {
      p_employee_id: employee_id, p_punch_type: punch_type,
      p_latitude: latitude ?? null, p_longitude: longitude ?? null, p_branch_id: branch_id ?? null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const today = new Date().toISOString().slice(0, 10)
    const { data: record } = await supabase.from('attendance_records')
      .select('work_in, work_out, total_minutes, late_minutes, status, punch_count')
      .eq('employee_id', employee_id).eq('attendance_date', today).maybeSingle()

    return NextResponse.json({ ok: true, punch: data, today: record })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const employee_id = searchParams.get('employee_id')
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

  const [punches, record] = await Promise.all([
    supabase.from('attendance_punches').select('punch_time, punch_type, source, geofence_status')
      .eq('employee_id', employee_id).eq('punch_date', date).order('punch_time', { ascending: true }),
    supabase.from('attendance_records').select('work_in, work_out, total_minutes, late_minutes, status, overtime_minutes, punch_count')
      .eq('employee_id', employee_id).eq('attendance_date', date).maybeSingle(),
  ])

  return NextResponse.json({
    date, punches: punches.data ?? [], summary: record.data ?? null,
    first_in: punches.data?.find(p => p.punch_type === 'IN')?.punch_time ?? null,
    last_out: [...(punches.data ?? [])].reverse().find(p => p.punch_type === 'OUT')?.punch_time ?? null,
  })
}
