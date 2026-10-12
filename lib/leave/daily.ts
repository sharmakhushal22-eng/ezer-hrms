// lib/leave/daily.ts — the once-a-day leave & attendance job. SERVER ONLY.
//
// 1. Balances. Accrual credits at month end, so a balance changes on the 1st
//    even if nobody applies for anything. The stored table (Home, Today, the
//    Leave Report, payroll later) is brought up to date for everybody.
// 2. Reminders. A request that has waited more than two days gets its approver
//    one digest — a bell entry and an email listing everything waiting on them,
//    oldest first. Requests used to wait 87 days with nobody told.
//
// Runs from the existing daily cron (app/api/cron/offer-followup) rather than a
// cron entry of its own, so the project's cron count does not grow; it can also
// be triggered by hand at /api/cron/leave-daily.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { syncAllBalances } from './ledger'
import { contacts, deliver, portalUrl, fmtRange, fmtDates } from './notify'

const WAIT_DAYS = 2

export interface DailyResult { balances: { employees: number; rows: number; error: string | null }; reminded: number }

export async function runLeaveDaily(): Promise<DailyResult> {
  const balances = await syncAllBalances()
  const cutoff = new Date(Date.now() - WAIT_DAYS * 86400000).toISOString()

  const [{ data: leaves }, { data: cancels }, { data: regs }] = await Promise.all([
    sb.from('leave_applications').select('id, employee_id, from_date, to_date, days, applied_at, current_approver_id, leave_types(name)')
      .eq('status', 'PENDING').not('current_approver_id', 'is', null).lt('applied_at', cutoff),
    sb.from('leave_applications').select('id, employee_id, from_date, to_date, cancel_requested_at, cancel_approver_id, leave_types(name)')
      .eq('cancel_status', 'REQUESTED').not('cancel_approver_id', 'is', null).lt('cancel_requested_at', cutoff),
    sb.from('attendance_regularisation').select('id, employee_id, attendance_date, created_at, current_approver_id, request_group')
      .eq('status', 'PENDING').not('current_approver_id', 'is', null).lt('created_at', cutoff),
  ])

  type Line = { approver: string; employee: string; text: string; since: string }
  const lines: Line[] = []
  for (const l of (leaves || []) as any[]) {
    lines.push({ approver: l.current_approver_id, employee: l.employee_id, since: l.applied_at,
      text: `${Number(l.days) || 0} day(s) of ${l.leave_types?.name || 'leave'} (${fmtRange(l.from_date, l.to_date)})` })
  }
  for (const l of (cancels || []) as any[]) {
    lines.push({ approver: l.cancel_approver_id, employee: l.employee_id, since: l.cancel_requested_at,
      text: `cancellation of ${l.leave_types?.name || 'leave'} (${fmtRange(l.from_date, l.to_date)})` })
  }
  const groups = new Map<string, any[]>()
  for (const r of (regs || []) as any[]) { const k = r.request_group || r.id; groups.set(k, [...(groups.get(k) || []), r]) }
  for (const g of groups.values()) {
    lines.push({ approver: g[0].current_approver_id, employee: g[0].employee_id, since: g[0].created_at,
      text: `attendance correction for ${fmtDates(g.map(r => r.attendance_date))}` })
  }
  if (!lines.length) return { balances, reminded: 0 }

  const people = await contacts([...lines.map(l => l.approver), ...lines.map(l => l.employee)])
  const byApprover = new Map<string, Line[]>()
  for (const l of lines) byApprover.set(l.approver, [...(byApprover.get(l.approver) || []), l])

  let reminded = 0
  for (const [approver, list] of byApprover) {
    list.sort((a, b) => a.since.localeCompare(b.since))
    const waited = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86400000)
    const oldest = waited(list[0].since)
    const text = list.slice(0, 20).map(l => `• ${people.get(l.employee)?.name || 'An employee'} — ${l.text}, waiting ${waited(l.since)} day(s)`).join('\n')
      + (list.length > 20 ? `\n• … and ${list.length - 20} more` : '')
    await deliver({
      to: approver,
      bell: { key: 'notify.approvals.reminder', link: '/ess?tab=approvals', vars: { count: list.length, oldest_days: oldest } },
      mail: { key: 'approvals.reminder', vars: {
        approver_name: people.get(approver)?.name || '', count: list.length, oldest_days: oldest, list: text, portal_url: portalUrl('approvals'),
      } },
    })
    reminded++
  }
  return { balances, reminded }
}
