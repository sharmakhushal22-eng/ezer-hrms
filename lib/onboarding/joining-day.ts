// lib/onboarding/joining-day.ts — the days around joining, as rules and words.
//
// Three things happen on the calendar before a candidate's first day:
//
//   2 days before   IT, Admin, HR Ops and the HR Manager are told "<name> is joining — prepare
//                   the givables and the onboarding formalities" (once)
//   1 day before    the candidate gets the welcome mail: the day's programme, what to bring,
//                   and a greeting card PDF on the letterhead (once)
//   joining day     if no onboarding link has gone out, the HR Manager is reminded to send
//                   it (once)
//
// Pure: no fetch, no Supabase, no `@/` imports, so it is unit-tested and the cron that applies
// it (joining-day-run.ts) has no rules of its own. Days are counted the way
// lib/recruitment/joining-followup.ts counts them — Indian calendar days.

export const PREP_DAYS_BEFORE = 2
export const WELCOME_DAYS_BEFORE = 1

/** A fixed-hour cron can miss a day (a failed run, a deploy); "≤ N days away and not yet sent"
 *  catches up the next morning instead of skipping the mail for good. Never after joining. */
export const prepDue = (daysToJoin: number | null, sentAt: string | null) =>
  daysToJoin !== null && daysToJoin >= 0 && daysToJoin <= PREP_DAYS_BEFORE && !sentAt
export const welcomeDue = (daysToJoin: number | null, sentAt: string | null) =>
  daysToJoin !== null && daysToJoin >= 0 && daysToJoin <= WELCOME_DAYS_BEFORE && !sentAt
export const linkReminderDue = (daysToJoin: number | null, sentAt: string | null, linkSent: boolean) =>
  daysToJoin === 0 && !sentAt && !linkSent

/** What the teams get ready. */
export const GIVABLES: { team: 'IT' | 'ADMIN' | 'HR'; items: string[] }[] = [
  { team: 'IT', items: ['Laptop / workstation, charger and peripherals', 'Official email account and distribution lists', 'ERP / HRMS / tool access and licences', 'SIM card or phone, if the role needs one', 'Asset tagging and the asset register'] },
  { team: 'ADMIN', items: ['ID card and access card', 'Seat / desk allotment and workstation', 'Joining kit and welcome pack', 'Parking, canteen or cab registration, if applicable', 'Stationery and visiting cards, if applicable'] },
  { team: 'HR', items: ['Onboarding link ready to send on the day', 'Induction schedule and policy briefing', 'Buddy / manager introduction lined up', 'Statutory forms (EPF, ESIC, nominations) and the personal file', 'Bank, PAN and UAN details for payroll'] },
]

export interface ScheduleItem { time: string; title: string; detail?: string }

/** The joining-day programme when the company has not set its own. `report` is "HH:MM". */
export function defaultSchedule(report = '09:30'): ScheduleItem[] {
  const add = (hhmm: string, mins: number) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + mins; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
  return [
    { time: report, title: 'Arrival and welcome', detail: 'Report at the reception; ask for the HR team' },
    { time: add(report, 30), title: 'Joining formalities', detail: 'Document verification and the onboarding form (you will get a link)' },
    { time: add(report, 90), title: 'Induction', detail: 'The company, our values, policies and how we work' },
    { time: add(report, 150), title: 'IT setup', detail: 'Laptop, official email and system access' },
    { time: add(report, 210), title: 'Lunch with the team' },
    { time: add(report, 270), title: 'Meet your manager and team', detail: 'Introductions, your role and the first weeks' },
    { time: add(report, 330), title: 'Workstation, ID card and access card', detail: 'With the Admin team' },
    { time: add(report, 420), title: 'Wrap-up with HR', detail: 'Questions, what happens next, and your first-week plan' },
  ]
}

/** The company's programme if it set one, else the default. */
export function scheduleFor(row: { report_time?: string | null; items?: any } | null | undefined): { report: string; items: ScheduleItem[] } {
  const report = /^\d{2}:\d{2}$/.test(String(row?.report_time || '')) ? String(row!.report_time) : '09:30'
  const own = Array.isArray(row?.items) ? (row!.items as any[]).filter(i => i && i.time && i.title).map(i => ({ time: String(i.time), title: String(i.title), detail: i.detail ? String(i.detail) : undefined })) : []
  return { report, items: own.length ? own : defaultSchedule(report) }
}

export const BRING_ALONG = [
  'Original Aadhaar card and PAN card (and copies)',
  'Four passport-size photographs',
  'A cancelled cheque or bank passbook (salary account)',
  'Education certificates and mark sheets (originals for verification)',
  'Relieving / experience letter and last three salary slips from your previous employer',
  'UAN number, if you already have one',
]

const fmtDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(iso)
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const hhmm12 = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}` }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface JoinerFacts {
  name: string; role: string | null; department: string | null; company: string; doj: string
  mrfNumber: string | null; location: string | null; employmentType: string | null
}

/** 2 days before: to IT / Admin / HR Ops / HR Manager. */
export function prepareMail(f: JoinerFacts, daysToJoin: number): { subject: string; text: string } {
  const when = fmtDay(f.doj)
  const inDays = daysToJoin === 0 ? 'today' : daysToJoin === 1 ? 'tomorrow' : `in ${daysToJoin} days`
  const who = `${f.name}${f.role ? ` (${f.role})` : ''}${f.department ? `, ${f.department}` : ''}${f.mrfNumber ? ` · ${f.mrfNumber}` : ''}`
  const lists = GIVABLES.map(g => `${g.team === 'IT' ? 'IT' : g.team === 'ADMIN' ? 'Admin' : 'HR'}:\n${g.items.map(i => `  • ${i}`).join('\n')}`).join('\n\n')
  return {
    subject: `${f.name} is joining ${inDays} — please prepare the givables`,
    text: `Hi,

${who} is joining ${f.company} on ${when} (${inDays})${f.location ? ` at ${f.location}` : ''}.

Please prepare all the givables and onboarding formalities so the first day goes smoothly:

${lists}

Reply to HR if anything will not be ready in time.

— EZER HRMS`,
  }
}

/** The day before: to the candidate. A joyful note, the programme, what to bring. */
export function welcomeMail(f: JoinerFacts, p: { report: string; items: ScheduleItem[] }, venue: string | null, contact: { name: string | null; phone: string | null; email: string | null }): { subject: string; text: string; html: string } {
  const first = f.name.trim().split(/\s+/)[0] || f.name
  const when = fmtDay(f.doj)
  const subject = `See you tomorrow, ${first}! Your first day at ${f.company}`
  const rows = p.items.map(i => `${hhmm12(i.time)}  ${i.title}${i.detail ? ` — ${i.detail}` : ''}`).join('\n')
  const contactLine = [contact.name, contact.phone, contact.email].filter(Boolean).join(' · ')
  const text = `Dear ${first},

Tomorrow is the day — and we could not be happier. The whole team at ${f.company} is looking forward to welcoming you${f.role ? ` as our new ${f.role}` : ''}!

WHEN      ${when}, please reach by ${hhmm12(p.report)}
WHERE     ${venue || 'our office'}
${contactLine ? `ASK FOR   ${contactLine}\n` : ''}
YOUR FIRST DAY
${rows}

PLEASE BRING ALONG
${BRING_ALONG.map(b => `  • ${b}`).join('\n')}

Your welcome card is attached — we made it just for you. Come with a smile, we have the rest covered.

Welcome aboard,
The ${f.company} team`
  const html = `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;color:#1F2937">
  <div style="background:linear-gradient(135deg,#0B1D4D,#1D4ED8 60%,#38BDF8);color:#fff;padding:28px 28px 24px;border-radius:14px 14px 0 0">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85">Tomorrow is the day</div>
    <div style="font-size:30px;font-weight:700;margin-top:6px">Welcome aboard, ${esc(first)}!</div>
    <div style="font-size:14px;margin-top:8px;opacity:.95">The whole team at ${esc(f.company)} is looking forward to welcoming you${f.role ? ` as our new ${esc(f.role)}` : ''}.</div>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:0;padding:22px 28px;border-radius:0 0 14px 14px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr><td style="padding:6px 0;color:#6B7280;width:110px">When</td><td style="padding:6px 0;font-weight:600">${esc(when)}, please reach by ${hhmm12(p.report)}</td></tr>
      <tr><td style="padding:6px 0;color:#6B7280">Where</td><td style="padding:6px 0;font-weight:600">${esc(venue || 'our office')}</td></tr>
      ${contactLine ? `<tr><td style="padding:6px 0;color:#6B7280">Ask for</td><td style="padding:6px 0;font-weight:600">${esc(contactLine)}</td></tr>` : ''}
    </table>
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#1D4ED8;font-weight:700;margin-bottom:8px">Your first day</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      ${p.items.map(i => `<tr><td style="padding:7px 10px 7px 0;color:#1D4ED8;font-weight:700;white-space:nowrap;vertical-align:top;border-bottom:1px solid #F3F4F6">${hhmm12(i.time)}</td><td style="padding:7px 0;border-bottom:1px solid #F3F4F6"><b>${esc(i.title)}</b>${i.detail ? `<div style="color:#6B7280;font-size:13px">${esc(i.detail)}</div>` : ''}</td></tr>`).join('')}
    </table>
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#1D4ED8;font-weight:700;margin-bottom:8px">Please bring along</div>
    <ul style="margin:0 0 18px;padding-left:18px">${BRING_ALONG.map(b => `<li style="margin:3px 0">${esc(b)}</li>`).join('')}</ul>
    <p style="margin:0 0 6px">Your welcome card is attached — we made it just for you. Come with a smile, we have the rest covered.</p>
    <p style="margin:14px 0 0">Welcome aboard,<br><b>The ${esc(f.company)} team</b></p>
  </div>
</div>`
  return { subject, text, html }
}

/** Joining day, no link sent: to the HR Manager. */
export function linkReminderMail(f: JoinerFacts): { subject: string; text: string } {
  return {
    subject: `${f.name} joins today — send the onboarding link`,
    text: `Hi,

${f.name}${f.role ? ` (${f.role})` : ''} is joining ${f.company} today and no onboarding link has gone out yet.

Please send the onboarding link from Onboarding → Candidates so they can fill in their details and upload their documents during the joining formalities. Their documents from the pre-offer collection are carried into the form already.

— EZER HRMS`,
  }
}
