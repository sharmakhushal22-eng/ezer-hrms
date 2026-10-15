// lib/leave/notify.ts — bell now, email after the response. SERVER ONLY.
//
// Leave and attendance used to tell people only through the bell, so an
// approver who was not in the portal never knew anything was waiting. Every
// event in lib/leave/workflow.ts now sends both: the in-app notification
// (immediately — it is one insert and the screen the user is looking at may
// depend on it) and an email (deferred with next/server `after`, so a Gmail
// round trip never sits between somebody clicking Approve and the screen
// updating). Both use Configuration templates, so HR can change the words.
import { after } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { notifyFromTemplate } from '@/lib/config/notify'
import { renderEmail, employeeScope, type ScopeArg } from '@/lib/config/store'
import { sendMail } from '@/lib/mail/send'
import type { Vars } from '@/lib/config/render'

export interface Contact { id: string; name: string; code: string | null; email: string | null }

/** Name, code and the address mail goes to (office first, then personal). */
export async function contacts(ids: (string | null | undefined)[]): Promise<Map<string, Contact>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, Contact>()
  if (!uniq.length) return out
  const { data } = await sb.from('employees').select('id, full_name, emp_code, office_email, personal_email').in('id', uniq)
  for (const e of (data || []) as { id: string; full_name: string | null; emp_code: string | null; office_email: string | null; personal_email: string | null }[]) {
    out.set(e.id, {
      id: e.id, name: e.full_name || 'Employee', code: e.emp_code,
      email: (e.office_email || e.personal_email || '').trim() || null,
    })
  }
  return out
}

/**
 * Addresses that cannot receive mail. The seeded employees carry addresses like
 * rajesh.mehtaSRS1@dummy.ezer — sending to them only bounces back into the
 * company Gmail. Reserved test domains are skipped for the same reason.
 */
export function deliverable(email: string | null | undefined): email is string {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false
  const domain = email.split('@')[1].toLowerCase()
  return !/(\.ezer|\.invalid|\.test|\.local|\.example|^example\.(com|org|net))$/.test(domain)
}

/** The portal, deep-linked: approvers to Tasks & Approvals, employees to their tab. */
export function portalUrl(tab: 'approvals' | 'leave' | 'attendance'): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  return `${base}/ess?tab=${tab}`
}

/** Run after the response when inside a request; otherwise now. Never throws. */
export function later(fn: () => Promise<unknown>): void {
  const safe = async () => { try { await fn() } catch (e) { console.warn('[leave] deferred task failed:', e) } }
  try { after(safe) } catch { void safe() }
}

export interface Delivery {
  to: string | null | undefined
  /** In-app notification (bell + Tasks & Approvals). */
  bell?: { key: string; vars: Vars; link?: string }
  /** Email template, sent after the response. */
  mail?: { key: string; vars: Vars }
  scope?: ScopeArg
}

/** Send one person their bell entry now and their email later. */
export async function deliver(d: Delivery): Promise<void> {
  if (!d.to) return
  const scope = d.scope ?? await employeeScope(d.to)
  if (d.bell) await notifyFromTemplate(d.to, d.bell.key, d.bell.vars, { scope, link: d.bell.link })
  if (d.mail) {
    const to = d.to, mail = d.mail
    later(async () => {
      const c = (await contacts([to])).get(to)
      if (!c || !deliverable(c.email)) return
      const m = await renderEmail(mail.key, scope, mail.vars)
      const r = await sendMail({ to: c.email, subject: m.subject, text: m.text, html: m.html, fromName: 'EZER HRMS' })
      if (!r.sent && !r.skipped) console.warn(`[leave] email ${mail.key} to ${c.email} failed:`, r.error)
    })
  }
}

// ── Formatting shared by the workflow, the queue and the emails ─────────────

export const fmtDay = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'

export const fmtRange = (from: string, to?: string | null) =>
  to && to !== from ? `${fmtDay(from)} – ${fmtDay(to)}` : fmtDay(from)

/** "09 Oct 2026", "09 Oct 2026 – 11 Oct 2026", or "03 Oct 2026 – 10 Oct 2026 (7 days)" when days in between are left out. */
export function fmtDates(dates: string[]): string {
  const ds = [...new Set(dates)].sort()
  if (!ds.length) return '—'
  if (ds.length === 1) return fmtDay(ds[0])
  const span = (Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 86400000 + 1
  // Gaps are usually weekly offs or holidays the request skipped, so the span
  // still reads right; the count says how many days are actually in it.
  return span === ds.length ? fmtRange(ds[0], ds[ds.length - 1]) : `${fmtRange(ds[0], ds[ds.length - 1])} (${ds.length} days)`
}

export const daysWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** The IST calendar date — what attendance_date and leave dates mean. */
export const istToday = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
