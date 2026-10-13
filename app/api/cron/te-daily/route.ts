// GET /api/cron/te-daily — the nightly job of Travel and Expenses (vercel.json).
// Safe to call more often: everything it does is idempotent.
//
// For every company that uses the module, te_daily():
//   · makes sure this month and next month exist as expense months
//   · expires saved lines that crossed the bill-age limit without being claimed
//   · marks advances overdue after the due date plus the grace days
//   · deletes raw GPS pings older than the retention setting
//   · returns the approval steps that have waited longer than the reminder setting
// and this route posts one notification per waiting step to whoever holds it
// (te_notify -> ess_notifications -> the bell and the Inbox).
//
// PROTECTION  Bearer CRON_SECRET, like the repo's other cron routes — with one
// difference: those run unprotected when CRON_SECRET is not set; this one
// refuses, because it deletes location data and sends notifications. Vercel
// sends the header by itself once CRON_SECRET is set on the project.
import { NextRequest, NextResponse } from 'next/server'
import { teDb, teSupabase } from '@/lib/te/server'
import { mapTeError, rpcError } from '@/lib/te/errors'
import { daily } from '@/lib/te/engine/te-service.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set on this deployment, so the nightly job is refused.', code: 'TE_NOT_CONFIGURED' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const db = teDb()
    const sb = teSupabase()
    const only = req.nextUrl.searchParams.get('company_id')
    let q = sb.from('te_settings').select('company_id')
    if (only) q = q.eq('company_id', only)
    const companies = await q
    if (companies.error) throw rpcError(companies.error, 'te_settings')

    const totals = { companies: 0, expired_lines: 0, advances_overdue: 0, pings_purged: 0, reminders: 0, notified: 0, failed: [] as { company_id: string; error: string }[] }
    for (const c of companies.data ?? []) {
      const company = c.company_id as string
      try {
        // One company at a time: one company's bad data must not stop the others' month from opening.
        const r = await daily({ db }, company)
        totals.companies++
        totals.expired_lines += r.expired_lines
        totals.advances_overdue += r.advances_overdue
        totals.pings_purged += r.pings_purged
        totals.reminders += r.reminders.length

        let team: string[] | null = null
        for (const m of r.reminders) {
          // A named approver, or everybody in the Finance team for a team step.
          let to: string[] = m.approver_id ? [m.approver_id] : []
          if (!m.approver_id && m.team_code) {
            team ??= await db.rpc<string[]>('te_finance_members', { p_company_id: company })
            to = team ?? []
          }
          const what = m.entity_type === 'claim' ? 'Claim' : 'Trip plan'
          const days = `${m.days_waiting} day${m.days_waiting === 1 ? '' : 's'}`
          for (const employee of to) {
            await db.rpc('te_notify', {
              p_employee_id: employee,
              // The code starts with CLAIM / TRAVEL so the Inbox files it under Finance (lib/inbox/streams.ts).
              p_code: m.entity_type === 'claim' ? 'CLAIM_WAITING' : 'TRAVEL_WAITING',
              p_title: `${what} ${m.ref_no} is waiting for you`,
              p_body: `It has been waiting ${days}.${m.escalate ? ' It is past the escalation limit.' : ''}`,
              // The same two links te__notify_waiting (migration 147) uses when a step first lands on somebody.
              p_link: m.team_code ? `/dashboard/finance?ref=${m.entity_id}` : `/ess?tab=approvals&ref=${m.entity_id}`,
              p_priority: m.escalate ? 'HIGH' : 'NORMAL',
              p_actor: null,
            })
            totals.notified++
          }
        }
      } catch (e) {
        console.error(`[te] nightly job failed for company ${company}`, e)
        totals.failed.push({ company_id: company, error: mapTeError(e).body.error })
      }
    }
    return NextResponse.json({ ok: totals.failed.length === 0, ...totals }, { status: totals.failed.length && !totals.companies ? 500 : 200 })
  } catch (e) {
    const m = mapTeError(e)
    console.error('[te] nightly job failed', e)
    return NextResponse.json(m.body, { status: m.status })
  }
}
