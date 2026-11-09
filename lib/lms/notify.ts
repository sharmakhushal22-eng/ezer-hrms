// lib/lms/notify.ts — telling people. Server only.
//
// Bell rows go through the existing dispatcher. Email is deliberately batched: a
// company-wide assignment must not fire 2,000 mails from inside a request, or from a Gmail
// account with a daily limit. So an assignment writes bell rows at once (in SQL), and the
// daily job sends each person ONE digest of everything new or due. Small assignments mail
// straight away. Every mail respects deliverable(), so seeded addresses are never tried.
import { notify } from '@/lib/notifications/dispatch'
import { sendMail, type MailAttachment } from '@/lib/mail/send'
import { deliverable } from '@/lib/leave/notify'
import { sb } from './server'

export const appBase = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezerhrms.com').replace(/\/+$/, '')
/** EZER Learn itself, not the ESS page that used to hold it: `learnUrl('/team')`. */
export const learnUrl = (path = '') => `${appBase()}/learning${path}`

export async function notifyPerson(employeeId: string, code: string, title: string, body: string, link = '/learning') {
  await notify({ subjectId: employeeId, code, title, body, link, toOverride: [employeeId] })
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** One table with inline styles, so it survives Gmail and Outlook. Hex is fine here: this is
 *  mail, not the app theme. */
export function shell(o: { title: string; body: string; cta?: { label: string; href: string }; foot?: string }) {
  const btn = o.cta ? `<tr><td style="padding:6px 32px 26px"><a href="${esc(o.cta.href)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:9px">${esc(o.cta.label)}</a></td></tr>` : ''
  return `<!doctype html><html><body style="margin:0;background:#f1f5fb;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5fb;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #dbe4f3;overflow:hidden">
<tr><td style="background:#0f2554;padding:18px 32px"><span style="color:#9fbfff;font-size:11px;font-weight:700;letter-spacing:.14em">EZER LEARN</span></td></tr>
<tr><td style="padding:26px 32px 8px"><div style="font-size:19px;font-weight:700;line-height:1.35">${esc(o.title)}</div></td></tr>
<tr><td style="padding:6px 32px 16px;font-size:14px;line-height:1.6;color:#334155">${o.body}</td></tr>
${btn}
${o.foot ? `<tr><td style="padding:16px 32px 22px;border-top:1px solid #e5ebf5;font-size:11.5px;line-height:1.55;color:#64748b">${esc(o.foot)}</td></tr>` : ''}
</table></td></tr></table></body></html>`
}

export interface DigestLine { title: string; due: string | null; mandatory: boolean }

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })

export function digestHtml(name: string, sections: { heading: string; lines: DigestLine[] }[]) {
  const list = (lines: DigestLine[]) => `<ul style="margin:6px 0 14px;padding-left:20px">${lines.map(l =>
    `<li style="margin:3px 0"><b>${esc(l.title)}</b>${l.mandatory ? ' <span style="color:#b91c1c">(mandatory)</span>' : ''}${l.due ? ` · due ${esc(when(l.due))}` : ''}</li>`).join('')}</ul>`
  return `Dear ${esc(name)},<br><br>` + sections.filter(s => s.lines.length).map(s => `<b>${esc(s.heading)}</b>${list(s.lines)}`).join('')
}

export async function mailLearner(to: string | null | undefined, subject: string, html: string, text: string, attachments?: MailAttachment[]) {
  if (!deliverable(to)) return { sent: false, skipped: 'undeliverable' as const }
  return sendMail({ to: to!, subject, html, text, fromName: 'EZER Learn', attachments })
}

export interface OverdueLine { name: string; course: string; due: string | null }

/** The manager's mail: who in their team is overdue, on what, and since when. */
export function teamOverdueHtml(managerName: string, lines: OverdueLine[]) {
  const late = (iso: string | null) => {
    if (!iso) return ''
    const days = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
    return ` · due ${esc(when(iso))}, ${days} day${days === 1 ? '' : 's'} overdue`
  }
  return `Dear ${esc(managerName)},<br><br>These people in your team have mandatory or assigned training past its due date:` +
    `<ul style="margin:8px 0 14px;padding-left:20px">${lines.map(l => `<li style="margin:3px 0"><b>${esc(l.name)}</b> — ${esc(l.course)}<span style="color:#b91c1c">${late(l.due)}</span></li>`).join('')}</ul>` +
    'A word from you usually helps. You can see where each of them is from My team in EZER Learn.'
}

/** The learner's manager, for an escalation. */
export async function managerOf(employeeId: string): Promise<string | null> {
  const { data } = await sb.from('employees').select('l1_manager_id').eq('id', employeeId).maybeSingle()
  return (data?.l1_manager_id as string) || null
}

export { deliverable }
