// The built-in text of the workflow templates must be exactly what each route sent before
// it was moved to Configuration. Each `legacy…` function below is the old route code,
// copied as it was; each test renders the template with the values the route now passes.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKFLOW_TEMPLATES, daysLabel } from '../workflow-templates.ts'
import { SYSTEM_TEMPLATES, blockVarsOf } from '../registry.ts'
import { renderText, stripMarkup, validateTemplate } from '../render.ts'

const def = (key: string) => {
  const d = WORKFLOW_TEMPLATES.find(t => t.key === key)
  if (!d) throw new Error(`no template ${key}`)
  return d
}
const render = (key: string, vars: Record<string, string>) => {
  const d = def(key)
  return {
    subject: stripMarkup(renderText(d.defaults.subject, vars).text.replace(/\s*\n\s*/g, ' ')),
    body: stripMarkup(renderText(d.defaults.body, vars).text),
  }
}

describe('workflow templates — registry', () => {
  test('every key is unique and registered', () => {
    const keys = SYSTEM_TEMPLATES.map(t => t.key)
    assert.equal(new Set(keys).size, keys.length)
    for (const t of WORKFLOW_TEMPLATES) assert.ok(keys.includes(t.key), t.key)
  })
  test('every default is a valid template', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const allowed = t.variables.map(x => x.name)
      const blocks = blockVarsOf(t)
      assert.deepEqual(validateTemplate(t.defaults.subject, allowed.filter(n => !blocks.includes(n)), { required: true }), [], `${t.key} subject`)
      assert.deepEqual(validateTemplate(t.defaults.body, allowed, { required: true, blockVars: blocks }), [], `${t.key} body`)
    }
  })
})

describe('workflow templates — same text as before', () => {
  test('offer follow-up, candidate and HR', () => {
    const legacyCand = (name: string, role: string) => `Dear ${name},

We recently sent you an offer of employment${role ? ` for the position of ${role}` : ''}, and we haven't yet received your confirmation.

If you'd like to accept the offer, simply REPLY to this email confirming your acceptance. If you have any questions before deciding, reply here and our HR team will be glad to help.

We hope to welcome you on board soon.

Warm regards,
HR Team`
    const legacyHr = (name: string, role: string, candEmail: string) => `Hi,

This is an automated reminder: ${name}${role ? ` (${role})` : ''} was sent an offer more than 48 hours ago and has NOT confirmed acceptance yet.

Please reach out to the candidate to get their response.
Candidate email: ${candEmail || '—'}

— EZER HRMS`
    for (const role of ['Store Manager', '']) {
      const c = render('offer.followup.candidate', { candidate_name: 'Priya', role })
      assert.equal(c.body, legacyCand('Priya', role))
      assert.equal(c.subject, `Action needed — confirm your offer${role ? ` (${role})` : ''}`)
      const h = render('offer.followup.hr', { candidate_name: 'Priya', role, candidate_email: 'p@x.com' })
      assert.equal(h.body, legacyHr('Priya', role, 'p@x.com'))
      assert.equal(h.subject, "Follow up: Priya hasn't accepted the offer")
    }
  })

  test('onboarding setup and stay-in-touch reminders', () => {
    for (const n of [0, 1, 3]) {
      const legacy = `Hi,

Asha (Analyst) is joining on 17/10/2026 — that's ${n} day${n === 1 ? '' : 's'} away.

Please complete the onboarding setup before the joining date:
  • Laptop / workstation
  • Official email + ERP / system access
  • SIM / phone (if applicable)
  • ID card & access card
  • Seat / desk allotment
  • Joining kit & welcome pack

Kindly ensure everything is ready so the candidate has a smooth first day.

— EZER HRMS`
      const r = render('onboarding.setup_reminder', { candidate_name: 'Asha', role: 'Analyst', joining_date: '17/10/2026', days_left: daysLabel(n) })
      assert.equal(r.body, legacy)
      assert.equal(r.subject, `Onboarding setup — Asha joins in ${n} day${n === 1 ? '' : 's'}`)
    }
    const s = render('onboarding.stay_in_touch', { candidate_name: 'Asha', role: '', joining_date: '17/12/2026', days_left: '45 days' })
    assert.equal(s.body, `Hi,

Asha is joining on 17/12/2026 — still 45 days away.

Please reach out and keep the candidate engaged so they stay committed until their joining date. A quick check-in call or message helps reduce last-minute drop-offs.

— EZER HRMS`)
    assert.equal(s.subject, 'Stay in touch — Asha (joining 17/12/2026)')
  })

  test('documents submitted', () => {
    // lib/recruitment/collect-docs.ts submittedEmail, as it was.
    const legacy = (candidateName: string, jobTitle: string, companyName: string, uploaded: number, resubmission: boolean) => ({
      subject: `${resubmission ? 'Re-submitted' : 'Documents submitted'}: ${candidateName || 'Candidate'}${jobTitle ? ` — ${jobTitle}` : ''}`,
      body: `Hi,

${candidateName || 'The candidate'}${jobTitle ? ` (${jobTitle})` : ''}${companyName ? ` at ${companyName}` : ''} has ${resubmission ? 're-submitted' : 'submitted'} their documents through the secure upload link.

${uploaded} document${uploaded === 1 ? '' : 's'} ${uploaded === 1 ? 'has' : 'have'} been received. You can review, download or reject them from Recruitment → Negotiation → Pre-negotiation Checks → Review Documents.

— EZER HRMS`.replace(/\n{3,}/g, '\n\n'),
    })
    for (const [job, co, n, re] of [['Analyst', 'SRS', 3, false], ['', '', 1, true]] as const) {
      const r = render('doc_collection.submitted', {
        candidate_name: 'Ravi', job_title: job, company_name: co,
        submission_label: re ? 'Re-submitted' : 'Documents submitted', submitted_verb: re ? 're-submitted' : 'submitted',
        uploaded_summary: `${n} document${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} been received`,
      })
      assert.deepEqual(r, legacy('Ravi', job, co, n, re))
    }
  })

  test('the three verification codes', () => {
    assert.deepEqual(render('doc_collection.otp', { otp: '123456', validity_minutes: '10' }), {
      subject: 'Your document upload verification code: 123456',
      body: 'Your one-time verification code is 123456. It is valid for 10 minutes.\n\nIf you did not request this, please ignore this email.',
    })
    assert.deepEqual(render('salary_view.otp', { candidate_name: 'Candidate', company_name: 'HR Team', otp: '123456', validity_minutes: '10' }), {
      subject: 'Your salary offer verification code: 123456',
      body: 'Dear Candidate,\n\nYour one-time code to open your salary offer from HR Team is 123456. It is valid for 10 minutes.\n\nIf you did not request this, please ignore this email.',
    })
    assert.equal(render('onboarding.otp', { candidate_name: 'Asha', otp: '123456' }).body,
      "Dear Asha,\n\nYour onboarding verification code (OTP) is: 123456\n\nThis code is valid for 10 minutes. Enter it on your onboarding page to continue.\n\nIf you didn't request this, you can safely ignore this email.\n\nWarm regards,\nHR Team")
  })

  test('offer approval mails (head and manager)', () => {
    const lines = 'Candidate              Priya — Analyst\nOffered CTC            ₹10,00,000 per annum'
    const legacy = (audience: 'head' | 'manager', attachments: string[], headNames: string[]) => {
      const attachNote = attachments.length
        ? `\n\nAttached: ${attachments.join('; ')}.\nThe CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.`
        : ''
      const dear = audience === 'head' ? 'Dear HR Head,' : 'Dear HR Manager,'
      const intro = audience === 'head'
        ? 'An offer is waiting for your review and approval.'
        : `This candidate's offer has been submitted to the HR Head${headNames.length ? ` (${headNames.join(', ')})` : ''} and is yet to be approved. It already appears under Recruitment → Send Offers; the Send Offer button unlocks the moment the HR Head approves it.`
      const cta = audience === 'head' ? 'Review and approve' : 'Open Send Offers'
      return `${dear}\n\n${intro}\n\n${lines}${attachNote}\n\n${cta}: https://x/y\n\n— EZER HRMS`
    }
    for (const att of [['MRF M-1', 'CTC break-up acknowledgement'], []]) {
      const vars = { candidate_name: 'Priya', role: 'Analyst', ctc_lakh: '₹10 L', details: lines, attachments: att.join('; '), review_url: 'https://x/y' }
      assert.equal(render('offer.approval.head', vars).body, legacy('head', att, []))
      assert.equal(render('offer.approval.manager', { ...vars, head_names: 'Nayan' }).body, legacy('manager', att, ['Nayan']))
      assert.equal(render('offer.approval.manager', { ...vars, head_names: '' }).body, legacy('manager', att, []))
    }
    assert.equal(render('offer.approval.head', { candidate_name: 'Priya', role: 'Analyst', ctc_lakh: '₹10 L', details: '', attachments: '', review_url: '' }).subject, 'Offer approval required — Priya (Analyst) · ₹10 L')
  })

  test('offer accepted (hiring manager and candidate)', () => {
    const on = '14 Oct 2026, 11:20 am', pkg = '₹10,00,000 a year'
    for (const [doj, note, pdf] of [['01 Nov 2026', 'ok', true], ['', '', false]] as const) {
      const legacyHm = `Hi,\n\nPriya has accepted the salary offer for Analyst (M-1) on ${on}.\n\nOffered: ${pkg}${doj ? `\nProposed joining: ${doj}` : ''}${note ? `\nCandidate's note: ${note}` : ''}${pdf ? `\n\nThe salary break-up is attached as a PDF. It is password-protected — the password is the candidate's registered mobile number.` : ''}\n\nNext step: raise the offer approval request to the HR Head from Recruitment → Offer Approval.\n\n— EZER HRMS`
      assert.equal(render('offer.accepted.hiring_manager', { candidate_name: 'Priya', role: 'Analyst', mrf_number: 'M-1', accepted_on: on, package: pkg, proposed_doj: doj, candidate_note: note, pdf_attached: pdf ? 'yes' : '' }).body, legacyHm)
      const legacyC = `Dear Priya,\n\nThank you — we have recorded your acceptance of the salary offer for the Analyst role on ${on}.\n\nOffered: ${pkg}${pdf ? `\n\nYour salary break-up is attached as a PDF. It is password-protected — the password is your registered mobile number (digits only).` : ''}\n\nOur team will be in touch with the next steps and your offer letter.\n\nRegards,\nEZER HR Team`
      assert.equal(render('offer.accepted.candidate', { candidate_name: 'Priya', role: 'Analyst', accepted_on: on, package: pkg, pdf_attached: pdf ? 'yes' : '', sender_name: 'EZER HR Team' }).body, legacyC)
    }
  })

  test('activation approval', () => {
    for (const ctcLine of ['CTC: ₹10,00,000 · Basic 50%', '']) {
      const legacy = `Hi,\n\nPlease review and approve the joining activation for:\n\n` +
        `Candidate: Asha\nDesignation: Analyst\nDate of joining: 2026-11-01\n` +
        (ctcLine ? `${ctcLine}\n` : '') +
        `\nApproval role: Payroll\n\n` +
        `Open EZER HRMS → Onboarding → Asha → Activation to record your approval.\n\n— EZER HRMS`
      assert.equal(render('onboarding.activation_approval', { candidate_name: 'Asha', designation: 'Analyst', joining_date: '2026-11-01', ctc_line: ctcLine, approval_role: 'Payroll' }).body, legacy)
    }
  })

  test('transfer email, loan mails', () => {
    for (const link of ['https://x/l', '']) {
      const legacy = `Dear Ravi,\n\n` + `A transfer has been initiated for you, effective 01 November 2026.\n\n` +
        (link ? `View your transfer letter: ${link}\n\n` : '') + `Please acknowledge your acceptance in the EZER ESS portal.\n\n— EZER HR`
      assert.equal(render('transfer.notice', { employee_name: 'Ravi', effective_date: '01 November 2026', letter_link: link }).body, legacy)
    }
    assert.equal(render('loan.approved_finance', { amount: '200000', tenure_months: '12', agreement_number: 'LA-1' }).body,
      'A loan request has been fully approved.\nAmount: 200000\nTenure: 12 months\nAgreement: LA-1\nAction: review signed agreement, then disburse via Finance.')
    assert.equal(render('loan.exit_alert', { employee_name: 'Ravi', emp_code: 'S1', loan_number: 'LN-1', outstanding: '5' }).body,
      'Ravi (S1) has an exit/resignation date set.\nOutstanding loan: 5\nAction: recover outstanding first; balance to flow into FNF settlement.')
  })

  test('acceptance letters — the email carries the letter text as before', () => {
    const letter = render('acceptance.fresher.letter', { candidate_name: 'Asha', role: 'Analyst', company_name: 'SRS', doj: '01 Nov' })
    const paragraphs = [
      'Congratulations and welcome to SRS! We are pleased to confirm your joining as Analyst.',
      'Please report on your date of joining with the required documents. Our HR team will guide you through the onboarding formalities and your workspace setup.',
      'We are excited to have you begin your career with us and look forward to a great journey together.',
    ]
    assert.equal(letter.body, paragraphs.join('\n\n'))
    assert.equal(letter.subject, 'JOINING CONFIRMATION LETTER')
    const mail = render('acceptance.fresher.email', { candidate_name: 'Asha', role: 'Analyst', company_name: 'SRS', doj: '01 Nov', letter_body: letter.body })
    assert.equal(mail.body, `Dear Asha,\n\n${paragraphs.join('\n\n')}\n\nWarm regards,\nSRS — Human Resources`)
    assert.equal(mail.subject, 'Joining Confirmation — Analyst | SRS')
    assert.equal(render('acceptance.experienced.email', { candidate_name: 'A', role: 'Analyst', company_name: 'SRS', doj: '', letter_body: '' }).subject, 'Acceptance Confirmed & Next Steps — Analyst | SRS')
  })

  test('notifications', () => {
    const joinBits = (l: string, p: string) => `${l ? ` Join: ${l}` : ''}${p ? ` · Passcode: ${p}` : ''}`
    for (const [l, p] of [['https://m', '12'], ['', '']]) {
      assert.equal(render('notify.interview.main', { candidate_name: 'Priya', round: 'L1', interview_time: 'Mon', meet_link: l, meet_passcode: p }).body,
        `You are the main interviewer for the L1 round on Mon.${joinBits(l, p)} Acknowledge it in Tasks & Approvals, then give your feedback after the interview.`)
      assert.equal(render('notify.interview.panel', { candidate_name: 'Priya', round: 'L1', interview_time: 'Mon', meet_link: l, meet_passcode: p, main_interviewer: 'Rahul' }).body,
        `You've been added as a panelist for the L1 round on Mon.${joinBits(l, p)} Main interviewer: Rahul. Acknowledge it in Tasks & Approvals.`)
    }
    assert.equal(render('notify.offer.approved', { candidate_name: 'Priya', role: 'Analyst', ctc_lakh: '₹10 L', mrf_number: 'M-1', comment: 'ok' }).body,
      'The HR Head approved the ₹10 L offer for Priya · M-1. Comment: “ok” Send the offer letter from Recruitment → Send Offers.')
    assert.equal(render('notify.offer.rejected', { candidate_name: 'Priya', role: '', ctc_lakh: '₹10 L', mrf_number: '', comment: '' }).body,
      'The HR Head rejected the ₹10 L offer for Priya. Revise the negotiation and raise a fresh approval request.')
    assert.equal(render('notify.offer.rejected', { candidate_name: 'Priya', role: '', ctc_lakh: '₹10 L', mrf_number: '', comment: '' }).subject, 'Offer rejected — Priya')
    assert.equal(render('notify.leave.approved', { days_label: daysLabel(1), from_date: '14 Oct', approver_name: 'Anita', note: '' }).body, '1 day from 14 Oct — approved by Anita.')
    assert.equal(render('notify.leave.declined', { days_label: daysLabel(2), from_date: '14 Oct', approver_name: 'Anita', note: 'busy' }).body, '2 days from 14 Oct — declined by Anita: busy.')
    assert.equal(render('notify.resignation.submitted', { employee_name: 'Ravi', emp_code: 'S1', stage: 'L1' }).body, 'Ravi · S1 has submitted a resignation. It is waiting on you (L1).')
    assert.equal(render('notify.mrf.sent_back', { mrf_label: 'Analyst (M-1)', actor_name: 'Anita', note: 'fix' }).body, 'Analyst (M-1) was sent back by Anita: “fix”. Open Tasks & Approvals to edit and resubmit it.')
  })
})
