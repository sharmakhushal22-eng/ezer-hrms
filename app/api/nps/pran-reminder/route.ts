// app/api/nps/pran-reminder/route.ts — chase the employees whose PRAN is still pending.
//
// The first mail goes out at enrolment (POST /api/ess/nps). Nothing chased anyone after
// that, so an enrolment could sit at PENDING_PRAN indefinitely: no PRAN, no contribution,
// and no one told. This is that chase.
//
// POST with { employee_id } to mail one person, or with nothing to mail everyone still
// pending. The same endpoint answers a cron and a button, so an automated nightly run
// and HR pressing "Send reminder" can never drift apart.
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sendPranCreationEmail } from '@/lib/nps/pran-email'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

/** GET — who would be chased, without sending anything. Lets the screen show a count
 *  and lets anyone check the list before firing mail at real people. */
export async function GET() {
  const { data, error } = await supabase.from('nps_declarations')
    .select('employee_id, pran_deadline, pran_email_sent_at, created_at, employees(emp_code, full_name, office_email, personal_email)')
    .eq('status', 'PENDING_PRAN')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const today = new Date().toISOString().slice(0, 10)
  return NextResponse.json({
    pending: (data as any[] || []).map(d => ({
      employee_id: d.employee_id,
      emp_code: d.employees?.emp_code || '',
      full_name: d.employees?.full_name || '',
      email: d.employees?.office_email || d.employees?.personal_email || '',
      deadline: d.pran_deadline,
      overdue: !!d.pran_deadline && d.pran_deadline < today,
      last_mailed: d.pran_email_sent_at,
    })),
  })
}

export async function POST(req: NextRequest) {
  let employee_id: string | undefined
  try { ({ employee_id } = await req.json()) } catch { /* empty body = everyone */ }

  let q = supabase.from('nps_declarations')
    .select('id, employee_id, pran_deadline, employees(emp_code, full_name, office_email, personal_email)')
    .eq('status', 'PENDING_PRAN')
  if (employee_id) q = q.eq('employee_id', employee_id)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = (data as any[]) || []
  if (!rows.length) return NextResponse.json({ sent: 0, failed: 0, results: [], message: 'Nobody is waiting on a PRAN.' })

  const results: any[] = []
  for (const d of rows) {
    const e = d.employees || {}
    const to = e.office_email || e.personal_email
    // No address is a real failure, not a silent skip — somebody has to go and fix it.
    if (!to) { results.push({ emp_code: e.emp_code, sent: false, reason: 'no email address on record' }); continue }

    const r = await sendPranCreationEmail({
      to, employeeName: e.full_name || e.emp_code,
      // A missing deadline would render "Invalid Date"; today reads as due now, which is
      // true enough for somebody who is already overdue.
      deadline: d.pran_deadline || new Date().toISOString().slice(0, 10),
      reminder: true,
    })
    results.push({ emp_code: e.emp_code, sent: r.sent, reason: (r as any).reason })

    if (r.sent) {
      await supabase.from('nps_declarations')
        .update({ pran_email_sent_at: new Date().toISOString() }).eq('id', d.id)
      await supabase.from('nps_audit_log').insert({
        declaration_id: d.id, employee_id: d.employee_id, employee_code: e.emp_code,
        action: 'PRAN_REMINDER_SENT', new_value: { to, deadline: d.pran_deadline },
        source: 'HR',
      })
    }
  }

  const sent = results.filter(r => r.sent).length
  return NextResponse.json({ sent, failed: results.length - sent, results })
}
