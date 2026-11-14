// lib/analytics/server/digest-mail.ts — the two analytics emails, as HTML and text.
//
// Email clients ignore stylesheets and CSS variables, so these carry fixed colours
// inline (the app's light-theme values) — the one place in analytics that may.

import type { Kpi, TeamAnalytics } from '../types.ts'
import type { Briefing, MondayNote } from '../briefs.ts'
import { fmt, delta, dLabel, dLabelLong } from '../format.ts'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const INK = '#16213a', SOFT = '#3d4863', MUTED = '#6b7488', LINE = '#e3e7ef', SUNKEN = '#f4f6fa', BRAND = '#1d5bd8', TINT = '#eaf1ff', GOOD = '#127a4a', BAD = '#b42318'

function frame(title: string, pre: string, body: string, foot: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${SUNKEN};font-family:'DM Sans','Segoe UI',Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SUNKEN};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid ${LINE};border-radius:14px">
<tr><td style="padding:22px 26px 6px;border-top:4px solid ${BRAND};border-radius:14px 14px 0 0">
<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:${BRAND};text-transform:uppercase">EZER HRMS</div>
<div style="font-size:22px;font-weight:600;margin-top:4px">${esc(title)}</div></td></tr>
<tr><td style="padding:6px 26px 22px">${body}</td></tr>
<tr><td style="padding:14px 26px 20px;border-top:1px solid ${LINE};font-size:11px;line-height:1.6;color:${MUTED}">${foot}</td></tr>
</table></td></tr></table></body></html>`
}

const h = (t: string) => `<div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:${MUTED};text-transform:uppercase;margin:20px 0 8px">${esc(t)}</div>`
const p = (t: string, style = '') => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${SOFT};${style}">${esc(t)}</p>`
const button = (href: string, label: string) => `<div style="margin:22px 0 4px"><a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px">${esc(label)}</a></div>`
const box = (label: string, text: string) => `<div style="margin:14px 0;padding:12px 14px;background:${TINT};border:1px solid #c9daff;border-radius:10px"><div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:${BRAND};text-transform:uppercase;margin-bottom:3px">${esc(label)}</div><div style="font-size:14px;line-height:1.5;color:${INK}">${esc(text)}</div></div>`
const rows = (items: [string, string][]) => items.length
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${items.map(([a, b]) => `<tr><td style="padding:5px 0;border-bottom:1px solid ${LINE};color:${INK}">${esc(a)}</td><td style="padding:5px 0;border-bottom:1px solid ${LINE};color:${MUTED};text-align:right">${esc(b)}</td></tr>`).join('')}</table>`
  : p('Nothing this week.', `color:${MUTED}`)

// ── Monday note ─────────────────────────────────────────────────────────────

export function mondayMail(d: TeamAnalytics, n: MondayNote, today: string, link: string): { subject: string; html: string; text: string } {
  const waiting = d.approvals.leave + d.approvals.regularisation + d.performance.awaitingYou
  const week = d.upcoming.filter(u => u.date >= today).slice(0, 8)
  const subject = `Your team this week${waiting ? ` — ${waiting} waiting on you` : ''}`
  const body = [
    `<div style="font-size:16px;font-weight:600;margin:6px 0 4px">${esc(n.greeting)}</div>`,
    p(n.summary),
    box('This week, start with', n.focus),
    h(`Out this week · ${d.outThisWeek.length}`), rows(d.outThisWeek.map(o => [o.name, `${o.type} · ${dLabel(o.from)}–${dLabel(o.to)}`])),
    h(`Waiting on you · ${waiting}`), rows([['Leave requests', String(d.approvals.leave)], ['Attendance corrections', String(d.approvals.regularisation)], ['Reviews to rate', String(d.performance.awaitingYou)]]),
    h(`Dates coming up · ${week.length}`), rows(week.map(u => [u.name, `${u.note} · ${dLabelLong(u.date)}`])),
    n.openers.length ? h('Conversation openers') + n.openers.map(o => `<div style="margin:0 0 10px;padding:10px 12px;border:1px solid ${LINE};border-radius:10px"><div style="font-size:13px;font-weight:600">${esc(o.name)} <span style="font-weight:400;color:${MUTED}">· ${esc(o.signals.slice(0, 3).join(', '))}</span></div><div style="font-size:13px;line-height:1.55;color:${SOFT};font-style:italic;margin-top:4px">“${esc(o.opener)}”</div></div>`).join('') + p('A way to start a one-to-one, not a script. The signs are prompts for a conversation, never a verdict.', `font-size:12px;color:${MUTED}`) : '',
    button(link, 'Open My team'),
  ].join('')
  const foot = `You get this because people report to you in EZER HRMS. ${n.source === 'ai' ? 'Written by AI from your team\'s figures; every number was checked.' : 'Written from your team\'s figures.'} Contains your team's information — please do not forward it. To stop it, open ESS → Insights → My team and untick "Email me this on Mondays".`
  const text = [n.greeting, n.summary, `Start with: ${n.focus}`, `Waiting on you: ${waiting}`, ...n.openers.map(o => `${o.name}: "${o.opener}"`), link].join('\n\n')
  return { subject, html: frame('Your Monday note', `${n.summary}`, body, foot), text }
}

// ── Monthly executive briefing ──────────────────────────────────────────────

export function briefingMail(b: Briefing, kpis: Kpi[], scope: string, link: string): { subject: string; html: string; text: string } {
  const subject = `Executive briefing — ${b.window.month}`
  const kpiRows = kpis.slice(0, 8).map(k => {
    const dd = delta(k.value, k.prev ?? null, k.fmt)
    const good = dd && k.good !== 'neutral' && dd.dir !== 'flat' ? (k.good === 'up') === (dd.dir === 'up') : null
    return `<td style="padding:8px;border:1px solid ${LINE};border-radius:8px;vertical-align:top;width:25%"><div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:${MUTED};text-transform:uppercase">${esc(k.label)}</div><div style="font-size:18px;font-weight:700;margin-top:3px">${esc(fmt(k.value, k.fmt))}</div>${dd ? `<div style="font-size:11px;color:${good == null ? MUTED : good ? GOOD : BAD}">${dd.dir === 'up' ? '▲' : dd.dir === 'down' ? '▼' : ''} ${esc(dd.text)}</div>` : ''}</td>`
  })
  const grid = [] as string[]
  for (let i = 0; i < kpiRows.length; i += 4) grid.push(`<tr>${kpiRows.slice(i, i + 4).join('')}</tr>`)
  const body = [
    p(`${scope} · ${b.window.label}`, `font-size:12px;color:${MUTED}`),
    `<div style="font-size:17px;font-weight:600;line-height:1.4;margin:6px 0 14px">${esc(b.headline)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate">${grid.join('')}</table>`,
    h('What changed'), b.changes.map(c => `<div style="margin:0 0 10px"><div style="font-size:14px;font-weight:600;color:${c.good == null ? INK : c.good ? GOOD : BAD}">${c.dir === 'up' ? '▲' : '▼'} ${esc(c.title)}</div>${c.detail ? `<div style="font-size:13px;color:${SOFT};line-height:1.5">${esc(c.detail)}</div>` : ''}</div>`).join('') || p('No headline figure moved much.'),
    h('Likely causes'), b.causes.map(c => p(`• ${c.text}`)).join('') || p('No single department, site or weekday stands behind the changes.'),
    h('Three things to do'), b.actions.map((a, i) => `<div style="margin:0 0 10px;padding:10px 12px;background:${SUNKEN};border-radius:10px"><div style="font-size:14px;font-weight:600">${i + 1}. ${esc(a.action)}</div><div style="font-size:12px;color:${MUTED};margin-top:3px">${esc(a.owner)} · ${esc(a.when)}${a.why ? ` · why: ${esc(a.why)}` : ''}</div></div>`).join(''),
    button(link, 'Open People Analytics'),
  ].join('')
  const foot = `You get this because HR added you to the monthly briefing in EZER HRMS. ${b.source === 'ai' ? 'Written by AI from the figures; every number was checked against them.' : 'Written from the figures by fixed rules.'} It covers the part of the organisation your analytics access covers. Confidential — please do not forward.`
  const text = [subject, b.headline, ...b.changes.map(c => `- ${c.title}: ${c.detail}`), 'Likely causes:', ...b.causes.map(c => `- ${c.text}`), 'To do:', ...b.actions.map((a, i) => `${i + 1}. ${a.action} (${a.owner}, ${a.when})`), link].join('\n')
  return { subject, html: frame(subject, b.headline, body, foot), text }
}
