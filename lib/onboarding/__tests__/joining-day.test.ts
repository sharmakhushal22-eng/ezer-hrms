// lib/onboarding/__tests__/joining-day.test.ts — the three mails around joining day:
// prepare (2 days before, once), welcome (the day before, once), send-the-link (the day).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepDue, welcomeDue, linkReminderDue, defaultSchedule, scheduleFor, prepareMail, welcomeMail, linkReminderMail, GIVABLES } from '../joining-day.ts'

test('prepare is due 2 days before, catches up to the day, never after, once', () => {
  assert.equal(prepDue(3, null), false)
  assert.equal(prepDue(2, null), true)
  assert.equal(prepDue(1, null), true)      // missed yesterday's run → still goes out
  assert.equal(prepDue(0, null), true)
  assert.equal(prepDue(-1, null), false)
  assert.equal(prepDue(2, '2026-10-11T09:00:00Z'), false)
  assert.equal(prepDue(null, null), false)
})

test('welcome is due the day before (or the day itself if missed), once', () => {
  assert.equal(welcomeDue(2, null), false)
  assert.equal(welcomeDue(1, null), true)
  assert.equal(welcomeDue(0, null), true)
  assert.equal(welcomeDue(-1, null), false)
  assert.equal(welcomeDue(1, '2026-10-12T09:00:00Z'), false)
})

test('the link reminder only on the day, only when no link went out', () => {
  assert.equal(linkReminderDue(0, null, false), true)
  assert.equal(linkReminderDue(0, null, true), false)
  assert.equal(linkReminderDue(1, null, false), false)
  assert.equal(linkReminderDue(0, '2026-10-13T09:00:00Z', false), false)
})

test('the default programme starts at the reporting time and runs the day', () => {
  const s = defaultSchedule('10:00')
  assert.equal(s[0].time, '10:00')
  assert.equal(s[1].time, '10:30')
  assert.equal(s[s.length - 1].time, '17:00')
  assert.ok(s.some(i => /IT setup/.test(i.title)) && s.some(i => /manager/.test(i.title)))
})

test('a company programme replaces the default; a bad one falls back', () => {
  const own = scheduleFor({ report_time: '09:00', items: [{ time: '09:00', title: 'Tea with the MD' }, { time: '', title: 'dropped' }] })
  assert.deepEqual(own.items, [{ time: '09:00', title: 'Tea with the MD', detail: undefined }])
  const fb = scheduleFor({ report_time: '9am', items: 'nope' })
  assert.equal(fb.report, '09:30'); assert.equal(fb.items.length, defaultSchedule().length)
  assert.equal(scheduleFor(null).report, '09:30')
})

const F = { name: 'Arun Varma', role: 'Sales Executive', department: 'Sales', company: 'Sharma Trading Corporation', doj: '2026-10-20', mrfNumber: 'MRF-0042', location: 'Ahmedabad Branch', employmentType: 'Employee' }

test('the prepare mail names the joiner, the day and every team’s givables', () => {
  const m = prepareMail(F, 2)
  assert.equal(m.subject, 'Arun Varma is joining in 2 days — please prepare the givables')
  assert.match(m.text, /Arun Varma \(Sales Executive\), Sales · MRF-0042 is joining Sharma Trading Corporation on Tuesday, 20 October 2026 \(in 2 days\) at Ahmedabad Branch/)
  for (const g of GIVABLES) for (const i of g.items) assert.ok(m.text.includes(i), i)
  assert.match(prepareMail(F, 0).subject, /joining today/)
})

test('the welcome mail is warm, has the programme, the venue and what to bring', () => {
  const m = welcomeMail(F, scheduleFor({ report_time: '09:30', items: [] }), 'Plot 12, Ring Road, Ahmedabad', { name: 'Riya Nair (HR)', phone: '98765 43210', email: null })
  assert.equal(m.subject, 'See you tomorrow, Arun! Your first day at Sharma Trading Corporation')
  assert.match(m.text, /we could not be happier/)
  assert.match(m.text, /please reach by 9:30 AM/)
  assert.match(m.text, /Plot 12, Ring Road, Ahmedabad/)
  assert.match(m.text, /ASK FOR   Riya Nair \(HR\) · 98765 43210/)
  assert.match(m.text, /9:30 AM  Arrival and welcome/)
  assert.match(m.text, /cancelled cheque/)
  assert.match(m.html, /Welcome aboard, Arun!/)
  assert.match(m.html, /<b>Induction<\/b>/)
})

test('the link reminder tells the HR Manager where to go', () => {
  const m = linkReminderMail(F)
  assert.equal(m.subject, 'Arun Varma joins today — send the onboarding link')
  assert.match(m.text, /Onboarding → Candidates/)
})
