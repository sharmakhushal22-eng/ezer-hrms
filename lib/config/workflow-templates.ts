// lib/config/workflow-templates.ts — built-in text of every other email, letter and in-app
// notification the portal sends: recruitment follow-ups and approvals, onboarding, transfer,
// resignation, payroll & finance, leave.
//
// Pure: no database. As in registry.ts, THE BUILT-IN WORDING IS TODAY'S WORDING, moved here
// from the route that used to hard-code it, so until somebody edits a template in
// Configuration every workflow sends exactly what it sent before.
// lib/config/__tests__/workflow-templates.test.ts checks the defaults against the old text.
//
// A variable marked `block` is drawn by the code (a facts table, a list of steps) and the
// template only decides where it goes — on a line of its own.

import type { TemplateDef, TemplateVar } from './registry.ts'

const v = (name: string, label: string, sample: string, block?: boolean): TemplateVar =>
  ({ name, label, sample, ...(block ? { block } : {}) })

// ── Shared variables ─────────────────────────────────────────────────────────

const CANDIDATE = v('candidate_name', 'Candidate name', 'Priya Sharma')
const ROLE = v('role', 'Role / designation (may be empty)', 'Senior Sales Manager')
const COMPANY = v('company_name', 'Company name', 'Sharma Retail Solutions Pvt Ltd')
const EMPLOYEE = v('employee_name', 'Employee name', 'Rajesh Mehta')
const EMP_CODE = v('emp_code', 'Employee code', 'SRS0042')
const OTP = v('otp', 'One-time code', '482913')
const OTP_MIN = v('validity_minutes', 'Code validity (minutes)', '10')
const CTC_LAKH = v('ctc_lakh', 'Offered CTC (lakh)', '₹18.5 L')
const MRF_NO = v('mrf_number', 'MRF number (may be empty)', 'MRF-SRS-0021')
const NOTE = v('note', 'Remark', 'Please revise the joining bonus.')
const FROM_DATE = v('from_date', 'Leave from', '14 Oct 2026')
const DAYS_LABEL = v('days_label', 'Days, with unit', '2 days')
const ACTOR = v('actor_name', 'Who acted', 'Anita Verma')
const STAGE = v('stage', 'Approval stage', 'L1')
const ROUND = v('round', 'Interview round', 'L1 Interview')
const WHEN = v('interview_time', 'Interview date & time', '14 Oct 2026, 11:00 am')
const MEET = v('meet_link', 'Meeting link (may be empty)', 'https://meet.google.com/abc-defg-hij')
const PASS = v('meet_passcode', 'Meeting passcode (may be empty)', '482913')
const MRF_LABEL = v('mrf_label', 'Requisition (role and MRF number)', 'Senior Sales Manager (MRF-SRS-0021)')
const PACKAGE = v('package', 'Accepted package', '₹18,50,000 a year')
const DAYS_LEFT = v('days_left', 'Days to joining, with unit', '3 days')
const JOIN_DATE = v('joining_date', 'Date of joining', '17/10/2026')
const REVIEW_URL = v('review_url', 'Link to review', 'https://app.example.com/offer-approve/7c1e…')
const APPROVER_NAME = v('approver_name', 'Approver', 'Anita Verma')
const APPROVER_ROLE = v('approver_role', 'How the approver relates to the employee', 'Reporting manager')
const LEAVE_TYPE = v('leave_type', 'Leave type', 'Casual Leave')
const DATES = v('dates', 'Dates', '14 Oct 2026 – 15 Oct 2026')
const DAY_COUNT = v('day_count', 'Number of days', '2')
const REASON = v('reason', 'Reason given (may be empty)', 'Family function')
const DECISION = v('decision', 'approved / declined', 'approved')
const BALANCE_LINE = v('balance_line', 'Balance before and after (may be empty)', '7.5 days of EL left; 5.5 after this request')
const PORTAL_URL = v('portal_url', 'Link to the portal', 'https://app.example.com/ess?tab=approvals')
const COUNT = v('count', 'How many', '3')
const OLDEST_DAYS = v('oldest_days', 'Days the oldest has waited', '4')

const RS = 'Recruitment' as const, OB = 'Onboarding' as const, LC = 'Employee lifecycle' as const
const PF = 'Payroll & finance' as const, LV = 'Leave & attendance' as const

const email = (d: Omit<TemplateDef, 'channel' | 'subjectLabel'>): TemplateDef => ({ ...d, channel: 'EMAIL', subjectLabel: 'Subject' })
const letter = (d: Omit<TemplateDef, 'channel' | 'subjectLabel'>): TemplateDef => ({ ...d, channel: 'LETTER', subjectLabel: 'Letter title' })
const notification = (d: Omit<TemplateDef, 'channel' | 'subjectLabel'>): TemplateDef => ({ ...d, channel: 'NOTIFICATION', subjectLabel: 'Title' })

// ── Emails ───────────────────────────────────────────────────────────────────

const APPROVAL_ATTACH = `{{#if attachments}}Attached: {{attachments}}.
The CTC break-up acknowledgement is password-protected — the password is the candidate's registered mobile number.{{/if}}`
const APPROVAL_VARS = [
  CANDIDATE, ROLE, CTC_LAKH,
  v('details', 'Offer facts (drawn as a table — only lines with a value)', 'Candidate               Priya Sharma — Senior Sales Manager\nOffered CTC             ₹18,50,000 per annum\nProposed DOJ            01 Nov 2026', true),
  v('attachments', 'Attached files (may be empty)', 'MRF MRF-SRS-0021; interview summary (2 of 3 candidate(s) interviewed); CTC break-up acknowledgement'),
  REVIEW_URL,
]

const ACCEPT_LETTER_VARS = [CANDIDATE, v('role', 'Role', 'Senior Sales Manager'), COMPANY, v('doj', 'Date of joining', '01 Nov 2026')]

const PRAN_STEPS = v('pran_steps', 'Due date and the three PRAN steps (drawn as a highlighted box)', '3 days left — due by 17 October 2026\n1. Fill in the PRAN creation form (CSRF/eNPS)\n2. Generate your PRAN via the NSDL/Protean eNPS portal\n3. Resubmit your new PRAN number in ESS → Payroll → NPS', true)
const PRAN_TAIL = `{{pran_steps}}

Your NPS contribution takes effect from the 1st of next month once your PRAN is submitted. If not provided within 3 days, your enrolment will need to be re-initiated.

For any questions or help with the form, please contact the **Payroll team**.

This is an automated message from EZER HRMS.`

export const WORKFLOW_EMAILS: TemplateDef[] = [
  // ── Recruitment ──
  email({
    key: 'doc_collection.otp', module: RS,
    label: 'Document upload — verification code',
    description: 'The one-time code a candidate asks for to open the secure document-upload link.',
    usedIn: 'Candidate document-upload page → Send code',
    recipient: 'Candidate',
    variables: [OTP, OTP_MIN],
    defaults: {
      subject: 'Your document upload verification code: {{otp}}',
      body: `Your one-time verification code is **{{otp}}**. It is valid for {{validity_minutes}} minutes.

If you did not request this, please ignore this email.`,
    },
  }),
  email({
    key: 'doc_collection.submitted', module: RS,
    label: 'Documents submitted — recruiter',
    description: 'Tells the recruiter who sent the upload link (and everyone CC\'d) that the candidate has submitted.',
    usedIn: 'Candidate document-upload page → Submit',
    recipient: 'Recruiter who sent the link (+ CC)',
    variables: [
      CANDIDATE, v('job_title', 'Job title (may be empty)', 'Senior Sales Manager'), COMPANY,
      v('submission_label', '"Documents submitted" or "Re-submitted"', 'Documents submitted'),
      v('submitted_verb', '"submitted" or "re-submitted"', 'submitted'),
      v('uploaded_summary', 'How many were received', '5 documents have been received'),
    ],
    defaults: {
      subject: '{{submission_label}}: {{candidate_name}}{{#if job_title}} — {{job_title}}{{/if}}',
      body: `Hi,

{{candidate_name}}{{#if job_title}} ({{job_title}}){{/if}}{{#if company_name}} at {{company_name}}{{/if}} has {{submitted_verb}} their documents through the secure upload link.

{{uploaded_summary}}. You can review, download or reject them from Recruitment → Negotiation → Pre-negotiation Checks → Review Documents.

— EZER HRMS`,
    },
  }),
  email({
    key: 'salary_view.otp', module: RS,
    label: 'Salary offer — verification code',
    description: 'The one-time code a candidate asks for to open the salary break-up link.',
    usedIn: 'Candidate salary-offer page → Send code',
    recipient: 'Candidate',
    variables: [CANDIDATE, COMPANY, OTP, OTP_MIN],
    defaults: {
      subject: 'Your salary offer verification code: {{otp}}',
      body: `Dear {{candidate_name}},

Your one-time code to open your salary offer from **{{company_name}}** is **{{otp}}**. It is valid for {{validity_minutes}} minutes.

If you did not request this, please ignore this email.`,
    },
  }),
  email({
    key: 'offer.accepted.hiring_manager', module: RS,
    label: 'Salary offer accepted — hiring manager',
    description: 'Sent when the candidate accepts on the salary link, with the salary break-up PDF attached.',
    usedIn: 'Candidate salary-offer page → Accept',
    recipient: 'Hiring manager(s) on the MRF (HR Head and HR Manager for a confidential search)',
    variables: [
      CANDIDATE, ROLE, MRF_NO, v('accepted_on', 'Accepted on', '14 Oct 2026, 11:20 am'), PACKAGE,
      v('proposed_doj', 'Proposed joining (may be empty)', '01 Nov 2026'),
      v('candidate_note', "Candidate's note (may be empty)", 'Can join a week earlier if needed.'),
      v('pdf_attached', 'Set when the PDF is attached', 'yes'),
    ],
    defaults: {
      subject: 'Offer accepted — {{candidate_name}}{{#if role}} ({{role}}){{/if}}',
      body: `Hi,

{{candidate_name}} has accepted the salary offer{{#if role}} for {{role}}{{/if}}{{#if mrf_number}} ({{mrf_number}}){{/if}} on {{accepted_on}}.

Offered: {{package}}{{#if proposed_doj}}
Proposed joining: {{proposed_doj}}{{/if}}{{#if candidate_note}}
Candidate's note: {{candidate_note}}{{/if}}{{#if pdf_attached}}

The salary break-up is attached as a PDF. It is password-protected — the password is the candidate's registered mobile number.{{/if}}

Next step: raise the offer approval request to the HR Head from Recruitment → Offer Approval.

— EZER HRMS`,
    },
  }),
  email({
    key: 'offer.accepted.candidate', module: RS,
    label: 'Salary offer accepted — candidate',
    description: 'Confirms to the candidate what they accepted on the salary link, with the salary break-up PDF.',
    usedIn: 'Candidate salary-offer page → Accept',
    recipient: 'Candidate',
    variables: [
      CANDIDATE, ROLE, v('accepted_on', 'Accepted on', '14 Oct 2026, 11:20 am'), PACKAGE,
      v('pdf_attached', 'Set when the PDF is attached', 'yes'), v('sender_name', 'Sender name', 'EZER HR Team'),
    ],
    defaults: {
      subject: 'You have accepted the offer{{#if role}} — {{role}}{{/if}}',
      body: `Dear {{candidate_name}},

Thank you — we have recorded your acceptance of the salary offer{{#if role}} for the {{role}} role{{/if}} on {{accepted_on}}.

Offered: {{package}}{{#if pdf_attached}}

Your salary break-up is attached as a PDF. It is password-protected — the password is your registered mobile number (digits only).{{/if}}

Our team will be in touch with the next steps and your offer letter.

Regards,
{{sender_name}}`,
    },
  }),
  email({
    key: 'offer.approval.head', module: RS,
    label: 'Offer approval request — HR Head',
    description: 'Asks the HR Head to review and approve an offer. Only facts with a value are listed; the MRF, interview summary and CTC break-up are attached.',
    usedIn: 'Recruitment → Offer Approval → Submit to HR Head',
    recipient: 'HR Head(s) of the company (+ CC picked on the form)',
    variables: APPROVAL_VARS,
    defaults: {
      subject: 'Offer approval required — {{candidate_name}}{{#if role}} ({{role}}){{/if}}{{#if ctc_lakh}} · {{ctc_lakh}}{{/if}}',
      body: `Dear HR Head,

An offer is waiting for your review and approval.

{{details}}

${APPROVAL_ATTACH}

Review and approve: {{review_url}}

— EZER HRMS`,
    },
  }),
  email({
    key: 'offer.approval.manager', module: RS,
    label: 'Offer awaiting HR Head — HR Manager',
    description: 'Tells the HR Manager(s) an offer is with the HR Head; Send Offer unlocks once it is approved.',
    usedIn: 'Recruitment → Offer Approval → Submit to HR Head',
    recipient: 'HR Manager(s) of the company',
    variables: [...APPROVAL_VARS, v('head_names', 'HR Head name(s) (may be empty)', 'Nayan Ahuja')],
    defaults: {
      subject: 'Offer awaiting HR Head approval — {{candidate_name}}{{#if role}} ({{role}}){{/if}}{{#if ctc_lakh}} · {{ctc_lakh}}{{/if}}',
      body: `Dear HR Manager,

This candidate's offer has been submitted to the HR Head{{#if head_names}} ({{head_names}}){{/if}} and is yet to be approved. It already appears under Recruitment → Send Offers; the Send Offer button unlocks the moment the HR Head approves it.

{{details}}

${APPROVAL_ATTACH}

Open Send Offers: {{review_url}}

— EZER HRMS`,
    },
  }),
  email({
    key: 'offer.revision.head', module: RS,
    label: 'Offer revision requested — HR Head',
    description: 'Sent when the HR Manager sends a sent offer back to the HR Head to revise.',
    usedIn: 'Recruitment → Offers → candidate reply → Revision',
    recipient: 'HR Head(s) of the company',
    variables: [v('requested_by', 'Sent back by', 'Anita Verma'), CANDIDATE, ROLE, NOTE, REVIEW_URL],
    defaults: {
      subject: 'Offer revision requested — {{candidate_name}}',
      body: `Dear HR Head,

{{requested_by}} has sent the offer for {{candidate_name}}{{#if role}} ({{role}}){{/if}} back for revision.

Reason: {{note}}

Please edit the offer and approve it: {{review_url}}

— EZER HRMS`,
    },
  }),
  email({
    key: 'offer.followup.candidate', module: RS,
    label: 'Offer follow-up — candidate',
    description: 'Daily job: reminds a candidate who has not confirmed a sent offer for 48 hours. Sent once.',
    usedIn: 'Automatic (daily offer follow-up)',
    recipient: 'Candidate',
    variables: [CANDIDATE, ROLE],
    defaults: {
      subject: 'Action needed — confirm your offer{{#if role}} ({{role}}){{/if}}',
      body: `Dear {{candidate_name}},

We recently sent you an offer of employment{{#if role}} for the position of {{role}}{{/if}}, and we haven't yet received your confirmation.

If you'd like to accept the offer, simply REPLY to this email confirming your acceptance. If you have any questions before deciding, reply here and our HR team will be glad to help.

We hope to welcome you on board soon.

Warm regards,
HR Team`,
    },
  }),
  email({
    key: 'offer.followup.hr', module: RS,
    label: 'Offer follow-up — HR',
    description: 'Daily job: tells the candidate\'s HR contact that a sent offer is unconfirmed after 48 hours.',
    usedIn: 'Automatic (daily offer follow-up)',
    recipient: "Candidate's HR contact",
    variables: [CANDIDATE, ROLE, v('candidate_email', 'Candidate email', 'priya.sharma@example.com')],
    defaults: {
      subject: "Follow up: {{candidate_name}} hasn't accepted the offer",
      body: `Hi,

This is an automated reminder: {{candidate_name}}{{#if role}} ({{role}}){{/if}} was sent an offer more than 48 hours ago and has NOT confirmed acceptance yet.

Please reach out to the candidate to get their response.
Candidate email: {{candidate_email}}

— EZER HRMS`,
    },
  }),
  email({
    key: 'acceptance.experienced.email', module: RS,
    label: 'Offer acceptance (experienced) — email',
    description: 'The email the "Offer acceptance & resignation advisory" letter is attached to. {{letter_body}} is the letter\'s text.',
    usedIn: 'Recruitment → Pre-onboarding → Accepted → Experienced',
    recipient: 'Candidate',
    variables: [...ACCEPT_LETTER_VARS, v('letter_body', 'The letter text', 'Thank you for accepting our offer for the position of Senior Sales Manager…')],
    defaults: {
      subject: 'Acceptance Confirmed & Next Steps — {{role}} | {{company_name}}',
      body: `Dear {{candidate_name}},

{{letter_body}}

Warm regards,
{{company_name}} — Human Resources`,
    },
  }),
  email({
    key: 'acceptance.fresher.email', module: RS,
    label: 'Joining confirmation (fresher) — email',
    description: 'The email the "Joining confirmation" letter is attached to. {{letter_body}} is the letter\'s text.',
    usedIn: 'Recruitment → Pre-onboarding → Accepted → Fresher',
    recipient: 'Candidate',
    variables: [...ACCEPT_LETTER_VARS, v('letter_body', 'The letter text', 'Congratulations and welcome to Sharma Retail Solutions Pvt Ltd!…')],
    defaults: {
      subject: 'Joining Confirmation — {{role}} | {{company_name}}',
      body: `Dear {{candidate_name}},

{{letter_body}}

Warm regards,
{{company_name}} — Human Resources`,
    },
  }),

  // ── Onboarding ──
  email({
    key: 'onboarding.otp', module: OB,
    label: 'Onboarding — verification code',
    description: 'The one-time code a new joiner asks for on the onboarding page.',
    usedIn: 'New joiner onboarding page → Send OTP',
    recipient: 'New joiner',
    variables: [CANDIDATE, OTP],
    defaults: {
      subject: 'Your onboarding OTP: {{otp}}',
      body: `Dear {{candidate_name}},

Your onboarding verification code (OTP) is: **{{otp}}**

This code is valid for 10 minutes. Enter it on your onboarding page to continue.

If you didn't request this, you can safely ignore this email.

Warm regards,
HR Team`,
    },
  }),
  email({
    key: 'onboarding.form_submitted', module: OB,
    label: 'Joining form submitted — HR',
    description: 'Tells HR a new joiner has submitted the joining form and it is ready for review.',
    usedIn: 'New joiner onboarding page → Submit',
    recipient: 'Onboarding HR SPOC (else whoever sent the link, else the default HR address)',
    variables: [CANDIDATE, ROLE, v('review_link', 'Link to the review page', 'https://app.example.com/onboarding/review/7c1e…')],
    defaults: {
      subject: 'New Joining Form Submitted — {{candidate_name}}',
      body: `{{candidate_name}} has submitted their joining form. Please review and approve.{{#if review_link}}

Review it here: {{review_link}}{{/if}}

— EZER HRMS`,
    },
  }),
  email({
    key: 'onboarding.employee_id', module: OB,
    label: 'Welcome — your Employee ID',
    description: 'Sent to the new joiner when HR generates the employee code.',
    usedIn: 'Onboarding → HR review → Generate employee code',
    recipient: 'New joiner',
    variables: [CANDIDATE, v('employee_code', 'Employee code', 'SRS0042'), COMPANY],
    defaults: {
      subject: 'Welcome aboard! Your Employee ID: {{employee_code}}',
      body: `Dear {{candidate_name}},

Your joining process is complete. Your Employee ID is {{employee_code}}.

You can now login to EZER ESS portal. Login credentials will follow in a separate email.

Welcome to the team!`,
    },
  }),
  email({
    key: 'onboarding.ess_credentials', module: OB,
    label: 'Your EZER ESS login',
    description: 'Sent to the new joiner with the employee code when HR generates it: the login ID, a temporary password (changed on first login) and the portal link.',
    usedIn: 'Onboarding → Generate code',
    recipient: 'New joiner',
    variables: [CANDIDATE, v('employee_code', 'Employee code', 'SRS0042'), v('login_id', 'Login ID (the employee code)', 'SRS0042'), v('login_email', 'Email that also works as the login ID (may be empty)', 'priya.sharma@company.com'), v('temp_password', 'Temporary password', 'Kq7m-Xw2p-R9tz'), v('login_link', 'ESS login page', 'https://app.ezerhrms.com/ess-login'), COMPANY],
    defaults: {
      subject: 'Your EZER ESS login — {{employee_code}}',
      body: `Dear {{candidate_name}},

Welcome to {{company_name}}! Your employee code is {{employee_code}}, and your EZER ESS account is ready.

Login: {{login_link}}
Login ID: {{login_id}}{{#if login_email}} (or your email {{login_email}}){{/if}}
Temporary password: {{temp_password}}

You will be asked to set your own password the first time you sign in. Please do not share this password; if you did not expect this email, tell HR.

Welcome to the team!`,
    },
  }),
  email({
    key: 'onboarding.welcome_ack', module: OB,
    label: 'Policy acknowledgement — new joiner',
    description: 'The acknowledgement document emailed with the code. This text opens it; the details table, the policies and the declaration are added by the system.',
    usedIn: 'Onboarding → HR review → Generate employee code',
    recipient: 'New joiner',
    variables: [EMPLOYEE, v('employee_code', 'Employee code', 'SRS0042'), v('company_name', 'Company name ("the team" when unknown)', 'Sharma Retail Solutions Pvt Ltd')],
    defaults: {
      subject: 'Welcome to {{company_name}} — Documents & Policy Acknowledgement ({{employee_code}})',
      body: `Dear {{employee_name}},

Welcome aboard! Your joining is confirmed and your Employee ID is **{{employee_code}}**. Below is your acknowledgement document with the policies you accepted during onboarding.`,
    },
  }),
  email({
    key: 'onboarding.activation_approval', module: OB,
    label: 'Activation approval request',
    description: 'Asks the L1 manager / Payroll to approve a new joiner\'s activation. The CTC line goes to Payroll only.',
    usedIn: 'Onboarding → Activation wizard → Send approval emails',
    recipient: 'L1 manager, Payroll',
    variables: [
      CANDIDATE, v('designation', 'Designation', 'Senior Sales Manager'), v('joining_date', 'Date of joining', '2026-11-01'),
      v('ctc_line', 'CTC line (Payroll only; may be empty)', 'CTC: ₹18,50,000 · Basic 50%'),
      v('approval_role', 'Approval role', 'L1 / Reporting Manager'),
    ],
    defaults: {
      subject: 'Action needed: approve activation for {{candidate_name}}',
      body: `Hi,

Please review and approve the joining activation for:

Candidate: {{candidate_name}}
Designation: {{designation}}
Date of joining: {{joining_date}}{{#if ctc_line}}
{{ctc_line}}{{/if}}

Approval role: {{approval_role}}

Open EZER HRMS → Onboarding → {{candidate_name}} → Activation to record your approval.

— EZER HRMS`,
    },
  }),
  email({
    key: 'onboarding.setup_reminder', module: OB,
    label: 'Onboarding setup reminder — HR',
    description: 'Daily job: 3 days before joining, asks HR to get the laptop, access, ID card etc. ready. Sent once.',
    usedIn: 'Automatic (daily offer follow-up)',
    recipient: "Candidate's HR contact",
    variables: [CANDIDATE, ROLE, JOIN_DATE, DAYS_LEFT],
    defaults: {
      subject: 'Onboarding setup — {{candidate_name}} joins in {{days_left}}',
      body: `Hi,

{{candidate_name}}{{#if role}} ({{role}}){{/if}} is joining on {{joining_date}} — that's {{days_left}} away.

Please complete the onboarding setup before the joining date:
  • Laptop / workstation
  • Official email + ERP / system access
  • SIM / phone (if applicable)
  • ID card & access card
  • Seat / desk allotment
  • Joining kit & welcome pack

Kindly ensure everything is ready so the candidate has a smooth first day.

— EZER HRMS`,
    },
  }),
  email({
    key: 'onboarding.stay_in_touch', module: OB,
    label: 'Stay in touch reminder — HR',
    description: 'Daily job: when joining is more than 30 days away, nudges HR every 10 days to keep the candidate engaged.',
    usedIn: 'Automatic (daily offer follow-up)',
    recipient: "Candidate's HR contact",
    variables: [CANDIDATE, ROLE, JOIN_DATE, v('days_left', 'Days to joining, with unit', '45 days')],
    defaults: {
      subject: 'Stay in touch — {{candidate_name}} (joining {{joining_date}})',
      body: `Hi,

{{candidate_name}}{{#if role}} ({{role}}){{/if}} is joining on {{joining_date}} — still {{days_left}} away.

Please reach out and keep the candidate engaged so they stay committed until their joining date. A quick check-in call or message helps reduce last-minute drop-offs.

— EZER HRMS`,
    },
  }),

  // ── Employee lifecycle ──
  email({
    key: 'transfer.notice', module: LC,
    label: 'Transfer — email to employee',
    description: 'Sent with the link to the transfer letter when a transfer is initiated.',
    usedIn: 'Employees → employee → Transfer',
    recipient: 'Employee',
    variables: [EMPLOYEE, v('effective_date', 'Effective date', '01 November 2026'), v('letter_link', 'Transfer letter link (may be empty)', 'https://app.example.com/api/transfer/generate-letter?id=…')],
    defaults: {
      subject: 'Transfer Letter — action required',
      body: `Dear {{employee_name}},

A transfer has been initiated for you, effective {{effective_date}}.

{{#if letter_link}}View your transfer letter: {{letter_link}}{{/if}}

Please acknowledge your acceptance in the EZER ESS portal.

— EZER HR`,
    },
  }),
  email({
    key: 'resignation.recovery_payroll', module: LC,
    label: 'Notice-period recovery — Payroll',
    description: 'Sent to Payroll when a resignation is processed with a notice-period shortfall.',
    usedIn: 'Employees → employee → Resignation (with shortfall)',
    recipient: 'Payroll team',
    variables: [
      EMPLOYEE, EMP_CODE, v('designation', 'Designation', 'Store Manager'), v('department', 'Department', 'Retail Operations'),
      v('official_email', 'Official email', 'rajesh.mehta@example.com'), v('resignation_date', 'Date of resignation', '2026-10-01'),
      v('notice_days', 'Notice period (policy), days', '60'), v('lwd_policy', 'LWD as per policy', '2026-11-30'),
      v('lwd_confirmed', 'LWD confirmed by the employee', '2026-10-31'), v('shortfall_days', 'Shortfall, days', '30'),
    ],
    defaults: {
      subject: 'Notice-period recovery needed — {{employee_name}} ({{shortfall_days}}d shortfall)',
      body: `Hi Payroll Team,

A resignation has been processed with a NOTICE-PERIOD SHORTFALL. Please calculate the recovery and proceed.

Employee:        {{employee_name}} ({{emp_code}})
Designation:     {{designation}}
Department:      {{department}}
Official email:  {{official_email}}

Date of resignation:   {{resignation_date}}
Notice period (policy):{{notice_days}} days
LWD as per policy:     {{lwd_policy}}
LWD confirmed by emp:  {{lwd_confirmed}}
Notice shortfall:      {{shortfall_days}} day(s)

Action: Calculate the recovery amount, update the resignation record, and send the
recovery intimation to the employee's official email.

— EZER HRMS`,
    },
  }),

  // ── Payroll & finance ──
  email({
    key: 'loan.approved_finance', module: PF,
    label: 'Loan approved — Finance',
    description: 'Tells Finance a loan is fully approved and ready for agreement and disbursement (loan types set to notify Finance).',
    usedIn: 'Loans → admin approval',
    recipient: 'Payroll / Finance',
    variables: [v('amount', 'Amount', '200000'), v('tenure_months', 'Tenure (months)', '12'), v('agreement_number', 'Agreement number', 'LA-2026-0042')],
    defaults: {
      subject: 'Loan approved — ready for agreement & disbursement ({{agreement_number}})',
      body: `A loan request has been fully approved.
Amount: {{amount}}
Tenure: {{tenure_months}} months
Agreement: {{agreement_number}}
Action: review signed agreement, then disburse via Finance.`,
    },
  }),
  email({
    key: 'loan.exit_alert', module: PF,
    label: 'Exiting employee with a loan — HR',
    description: 'Alerts HR when an employee with an active loan gets an exit date.',
    usedIn: 'Payroll → loan sync',
    recipient: 'HR',
    variables: [EMPLOYEE, EMP_CODE, v('loan_number', 'Loan number', 'LN-2026-0042'), v('outstanding', 'Outstanding principal', '85000')],
    defaults: {
      subject: 'ALERT: Exiting employee has active loan ({{loan_number}})',
      body: `{{employee_name}} ({{emp_code}}) has an exit/resignation date set.
Outstanding loan: {{outstanding}}
Action: recover outstanding first; balance to flow into FNF settlement.`,
    },
  }),
  email({
    key: 'nps.pran_creation', module: PF,
    label: 'NPS — create your PRAN',
    description: 'Sent on NPS enrolment to an employee who has no PRAN yet.',
    usedIn: 'ESS → Payroll → NPS → Enrol',
    recipient: 'Employee',
    variables: [EMPLOYEE, PRAN_STEPS],
    defaults: {
      subject: 'Action required: Create your NPS PRAN within 3 days',
      body: `Dear {{employee_name}},

Thank you for opting into the corporate NPS. Since you don't have an existing PRAN, you'll need to create one before your contribution can begin.

${PRAN_TAIL}`,
    },
  }),
  email({
    key: 'nps.pran_reminder', module: PF,
    label: 'NPS — PRAN still pending (reminder)',
    description: 'The chase for anyone whose PRAN is still pending. "overdue" is set once the due date has passed, "on_time" before it.',
    usedIn: 'Payroll → NPS report → Send PRAN reminders',
    recipient: 'Employee',
    variables: [EMPLOYEE, PRAN_STEPS, v('overdue', 'Set when the due date has passed', ''), v('on_time', 'Set while the due date is still ahead', 'yes')],
    defaults: {
      subject: '{{#if overdue}}Overdue: your NPS PRAN is still pending{{/if}}{{#if on_time}}Reminder: your NPS PRAN is still pending{{/if}}',
      body: `Dear {{employee_name}},

Your corporate NPS enrolment is still waiting on your PRAN. Until it is submitted, no contribution starts — nothing has been deducted, and nothing has been credited to you.

${PRAN_TAIL}`,
    },
  }),

  // ── Leave & attendance ──
  // The bell carries the short version of each of these; the email is for the
  // person who is not sitting in the portal when it happens.
  email({
    key: 'leave.request.approver', module: LV,
    label: 'Leave request — to the approver',
    description: 'Sent to whoever the request is waiting on: the reporting manager, or HR for types approved by HR.',
    usedIn: 'ESS → Leave → Apply; Tasks & Approvals → Approve (manager stage, for types approved by both)',
    recipient: 'Leave approver',
    variables: [APPROVER_NAME, EMPLOYEE, EMP_CODE, DAYS_LABEL, LEAVE_TYPE, DATES, REASON, BALANCE_LINE, PORTAL_URL],
    defaults: {
      subject: 'Leave request from {{employee_name}} — {{days_label}} of {{leave_type}}',
      body: `Hi {{approver_name}},

{{employee_name}}{{#if emp_code}} ({{emp_code}}){{/if}} has applied for {{days_label}} of {{leave_type}} and it is waiting on you.

Dates: {{dates}}
{{#if reason}}Reason: {{reason}}
{{/if}}{{#if balance_line}}Balance: {{balance_line}}
{{/if}}
Approve or decline it in EZER HRMS → Tasks & Approvals:
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'leave.decision.employee', module: LV,
    label: 'Leave decision — to the employee',
    description: 'Tells the employee their leave request was approved or declined, by whom, and any remark.',
    usedIn: 'Tasks & Approvals → Leave → Approve / Decline; Attendance & Leave → Requests (HR)',
    recipient: 'Employee',
    variables: [EMPLOYEE, DECISION, DAYS_LABEL, LEAVE_TYPE, DATES, APPROVER_NAME, NOTE, PORTAL_URL],
    defaults: {
      subject: 'Your {{leave_type}} request was {{decision}}',
      body: `Dear {{employee_name}},

Your request for {{days_label}} of {{leave_type}} ({{dates}}) was {{decision}} by {{approver_name}}.
{{#if note}}
Remark: {{note}}
{{/if}}
You can see the request and your balance in EZER HRMS → Leave:
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'leave.cancel.approver', module: LV,
    label: 'Leave cancellation request — to the approver',
    description: 'An employee wants to cancel leave that was already approved. The days go back to their balance only if the approver agrees.',
    usedIn: 'ESS → Leave → Request cancellation',
    recipient: 'Leave approver',
    variables: [APPROVER_NAME, EMPLOYEE, EMP_CODE, DAYS_LABEL, LEAVE_TYPE, DATES, REASON, PORTAL_URL],
    defaults: {
      subject: '{{employee_name}} wants to cancel approved {{leave_type}}',
      body: `Hi {{approver_name}},

{{employee_name}}{{#if emp_code}} ({{emp_code}}){{/if}} has asked to cancel {{days_label}} of approved {{leave_type}} ({{dates}}).
{{#if reason}}
Reason: {{reason}}
{{/if}}
Approve or decline the cancellation in EZER HRMS → Tasks & Approvals:
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'leave.cancel.employee', module: LV,
    label: 'Leave cancellation decision — to the employee',
    description: 'Tells the employee whether their approved leave was cancelled.',
    usedIn: 'Tasks & Approvals → Leave cancellation → Approve / Decline',
    recipient: 'Employee',
    variables: [EMPLOYEE, DECISION, DAYS_LABEL, LEAVE_TYPE, DATES, APPROVER_NAME, NOTE, PORTAL_URL],
    defaults: {
      subject: 'Leave cancellation {{decision}} — {{leave_type}}, {{dates}}',
      body: `Dear {{employee_name}},

Your request to cancel {{days_label}} of {{leave_type}} ({{dates}}) was {{decision}} by {{approver_name}}.
{{#if note}}
Remark: {{note}}
{{/if}}
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'attendance.correction.approver', module: LV,
    label: 'Attendance correction — to the approver',
    description: 'An employee has asked to correct missed or wrong punches; the attendance changes only once this is approved.',
    usedIn: 'ESS → Attendance → Raise regularisation',
    recipient: 'Reporting manager (or HR when there is none)',
    variables: [APPROVER_NAME, EMPLOYEE, EMP_CODE, DATES, DAY_COUNT, v('times', 'Requested times', '09:30 – 18:30'), REASON, PORTAL_URL],
    defaults: {
      subject: 'Attendance correction from {{employee_name}} — {{dates}}',
      body: `Hi {{approver_name}},

{{employee_name}}{{#if emp_code}} ({{emp_code}}){{/if}} has asked to correct their attendance and it is waiting on you.

Dates: {{dates}} ({{day_count}} day(s))
Times: {{times}}
{{#if reason}}Reason: {{reason}}
{{/if}}
Approve or decline it in EZER HRMS → Tasks & Approvals:
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'attendance.correction.employee', module: LV,
    label: 'Attendance correction decision — to the employee',
    description: 'Tells the employee whether their attendance correction was approved (and their attendance updated) or declined.',
    usedIn: 'Tasks & Approvals → Attendance correction → Approve / Decline',
    recipient: 'Employee',
    variables: [EMPLOYEE, DECISION, DATES, APPROVER_NAME, NOTE, PORTAL_URL],
    defaults: {
      subject: 'Your attendance correction was {{decision}} — {{dates}}',
      body: `Dear {{employee_name}},

Your attendance correction for {{dates}} was {{decision}} by {{approver_name}}.
{{#if note}}
Remark: {{note}}
{{/if}}
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
  email({
    key: 'approvals.reminder', module: LV,
    label: 'Requests waiting — daily reminder',
    description: 'Sent each morning to anyone with leave, cancellation or attendance requests that have waited more than two days.',
    usedIn: 'Daily job (09:30 IST)',
    recipient: 'Approver',
    variables: [APPROVER_NAME, COUNT, OLDEST_DAYS, v('list', 'The waiting requests, one per line', '• Kiran Reddy — 2 days of Earned Leave (13 Oct), waiting 4 days'), PORTAL_URL],
    defaults: {
      subject: '{{count}} request(s) waiting on you in EZER HRMS',
      body: `Hi {{approver_name}},

These requests are waiting for your decision — the oldest for {{oldest_days}} day(s):

{{list}}

Open Tasks & Approvals to approve or decline them:
{{portal_url}}

This is an automated message from EZER HRMS.`,
    },
  }),
]

// ── Letters ──────────────────────────────────────────────────────────────────

export const WORKFLOW_LETTERS: TemplateDef[] = [
  letter({
    key: 'acceptance.experienced.letter', module: RS,
    label: 'Offer acceptance & resignation advisory (experienced)',
    description: 'The PDF letter sent when an experienced candidate accepts. Position and date of joining are shown by the system.',
    usedIn: 'Recruitment → Pre-onboarding → Accepted → Experienced',
    recipient: 'Candidate',
    variables: ACCEPT_LETTER_VARS,
    defaults: {
      subject: 'OFFER ACCEPTANCE & RESIGNATION ADVISORY',
      body: `Thank you for accepting our offer for the position of {{role}} at {{company_name}}. We are delighted to have you join us.

As your next step, kindly submit your resignation to your current employer and share your acceptance / relieving documentation with us. Please keep us informed of your last working day so we can finalise your date of joining.

Do ensure all notice-period formalities are completed in time for a smooth transition. We look forward to welcoming you on board.`,
    },
  }),
  letter({
    key: 'acceptance.fresher.letter', module: RS,
    label: 'Joining confirmation letter (fresher)',
    description: 'The PDF letter sent when a fresher accepts. Position and date of joining are shown by the system.',
    usedIn: 'Recruitment → Pre-onboarding → Accepted → Fresher',
    recipient: 'Candidate',
    variables: ACCEPT_LETTER_VARS,
    defaults: {
      subject: 'JOINING CONFIRMATION LETTER',
      body: `Congratulations and welcome to {{company_name}}! We are pleased to confirm your joining as {{role}}.

Please report on your date of joining with the required documents. Our HR team will guide you through the onboarding formalities and your workspace setup.

We are excited to have you begin your career with us and look forward to a great journey together.`,
    },
  }),
  letter({
    key: 'transfer.letter', module: LC,
    label: 'Transfer letter',
    description: 'The letter the employee opens from ESS or the transfer email. Letterhead, date and reference are added by the system; {{transfer_details}} is the list of what changes.',
    usedIn: 'Employees → employee → Transfer',
    recipient: 'Employee',
    variables: [
      EMPLOYEE, EMP_CODE,
      v('from_posting', 'From (branch or company)', 'Gurugram Cyber City'),
      v('to_posting', 'To (branch or company)', 'Mumbai Nariman Point'),
      v('effective_date', 'Effective date', '01 November 2026'),
      v('transfer_details', 'What changes (location, manager, designation, department, benefit)', 'New Location: Mumbai Nariman Point\nNew Reporting Manager: Anita Verma\nTransfer Benefit: Relocation assistance', true),
      v('new_company', 'New company (inter-company transfers only)', 'Sharma Trading Corporation'),
      v('group_doj', 'Group date of joining (inter-company only)', '12 March 2019'),
      v('old_company_last_day', 'Last day in the current company (inter-company only; may be empty)', '31 October 2026'),
      COMPANY,
    ],
    defaults: {
      subject: 'TRANSFER LETTER',
      body: `Dear **{{employee_name}}** ({{emp_code}}),

This is to inform you that you are being transferred from **{{from_posting}}** to **{{to_posting}}** with effect from **{{effective_date}}**.

Details of your transfer:

{{transfer_details}}

{{#if new_company}}New Company: **{{new_company}}**. Your Group Date of Joining (**{{group_doj}}**) remains unchanged for all seniority and gratuity purposes.{{/if}}{{#if old_company_last_day}} Your last working day in the current company is **{{old_company_last_day}}**.{{/if}}

Please acknowledge your acceptance through the EZER ESS portal or by replying to this email.

For **{{company_name}}**,

**Human Resources**`,
    },
  }),
  letter({
    key: 'loan.agreement', module: PF,
    label: 'Loan agreement',
    description: 'The printable loan agreement. The employee and loan details, the repayment schedule and the signature are added by the system; this is its title and terms.',
    usedIn: 'ESS → Loans → Agreement',
    recipient: 'Employee',
    variables: [EMPLOYEE, EMP_CODE, COMPANY, v('agreement_number', 'Agreement number', 'LA-2026-0042'), v('principal', 'Principal', '₹2,00,000'), v('tenure_months', 'Tenure (months)', '12'), v('emi', 'Indicative EMI', '₹17,500')],
    defaults: {
      subject: 'LOAN AGREEMENT',
      body: 'The employee authorises recovery of the above EMIs via monthly salary deduction until the loan is fully repaid, and agrees that any outstanding balance on separation will be recovered from the full & final settlement.',
    },
  }),
]

// ── In-app notifications (bell + Tasks & Approvals) ─────────────────────────

const JOIN_BITS = '{{#if meet_link}} Join: {{meet_link}}{{/if}}{{#if meet_passcode}} · Passcode: {{meet_passcode}}{{/if}}'
const WHO_ROLE = '{{candidate_name}}{{#if role}} ({{role}}){{/if}}'
const DECIDED_VARS = [CANDIDATE, ROLE, CTC_LAKH, MRF_NO, v('comment', "HR Head's comment (may be empty)", 'Approved within band.')]

export const WORKFLOW_NOTIFICATIONS: TemplateDef[] = [
  // ── Recruitment ──
  notification({
    key: 'notify.interview.main', module: RS,
    label: 'Interview to conduct — main interviewer',
    description: 'In-app task for the main interviewer when a round is scheduled.',
    usedIn: 'Recruitment → candidate → Interviews → Schedule round',
    recipient: 'Main interviewer',
    variables: [CANDIDATE, ROUND, WHEN, MEET, PASS],
    defaults: {
      subject: 'Interview to conduct — {{candidate_name}} ({{round}})',
      body: `You are the main interviewer for the {{round}} round on {{interview_time}}.${JOIN_BITS} Acknowledge it in Tasks & Approvals, then give your feedback after the interview.`,
    },
  }),
  notification({
    key: 'notify.interview.panel', module: RS,
    label: 'Interview to conduct — panelist',
    description: 'In-app task for each panelist when a round is scheduled.',
    usedIn: 'Recruitment → candidate → Interviews → Schedule round',
    recipient: 'Panelist',
    variables: [CANDIDATE, ROUND, WHEN, MEET, PASS, v('main_interviewer', 'Main interviewer', 'Rahul Nair')],
    defaults: {
      subject: 'Interview to conduct — {{candidate_name}} ({{round}})',
      body: `You've been added as a panelist for the {{round}} round on {{interview_time}}.${JOIN_BITS} Main interviewer: {{main_interviewer}}. Acknowledge it in Tasks & Approvals.`,
    },
  }),
  notification({
    key: 'notify.interview.feedback', module: RS,
    label: 'Interview feedback in',
    description: 'Tells whoever scheduled the round that the main interviewer has submitted feedback.',
    usedIn: 'ESS → Tasks & Approvals → interview feedback',
    recipient: 'Who scheduled the round',
    variables: [
      CANDIDATE, ROUND, v('decision', 'Decision', 'Proceed to next round'), v('interviewer_name', 'Interviewer', 'Rahul Nair'),
      v('score', 'Score (may be empty)', '64/80 (Strong)'), v('decision_remark', 'Remark (may be empty)', 'Strong on retail ops.'),
    ],
    defaults: {
      subject: 'Interview feedback in — {{candidate_name}} ({{round}}) · {{decision}}',
      body: '{{interviewer_name}} submitted feedback for the {{round}} round{{#if score}} · {{score}}{{/if}}. Decision: {{decision}}{{#if decision_remark}} — {{decision_remark}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.offer.approval_head', module: RS,
    label: 'Offer approval — HR Head',
    description: 'In-app task for the HR Head when an offer is submitted for approval.',
    usedIn: 'Recruitment → Offer Approval → Submit to HR Head',
    recipient: 'HR Head(s)',
    variables: [CANDIDATE, ROLE, CTC_LAKH, MRF_NO, v('proposed_doj', 'Proposed DOJ (may be empty)', '01 Nov 2026')],
    defaults: {
      subject: `Offer approval — ${WHO_ROLE}`,
      body: 'An offer of {{ctc_lakh}} for {{candidate_name}}{{#if role}}, {{role}}{{/if}}{{#if mrf_number}} · {{mrf_number}}{{/if}} is waiting for your review and approval{{#if proposed_doj}} (proposed DOJ {{proposed_doj}}){{/if}}. Open it from Tasks & Approvals to review and approve.',
    },
  }),
  notification({
    key: 'notify.offer.awaiting_head', module: RS,
    label: 'Offer yet to be approved — HR Manager',
    description: 'Tells the HR Manager(s) an offer is with the HR Head.',
    usedIn: 'Recruitment → Offer Approval → Submit to HR Head',
    recipient: 'HR Manager(s)',
    variables: [CANDIDATE, ROLE, CTC_LAKH, MRF_NO, v('head_names', 'HR Head name(s) (may be empty)', 'Nayan Ahuja')],
    defaults: {
      subject: `Offer yet to be approved — ${WHO_ROLE}`,
      body: "{{candidate_name}}'s offer of {{ctc_lakh}}{{#if mrf_number}} · {{mrf_number}}{{/if}} has been submitted to the HR Head{{#if head_names}} ({{head_names}}){{/if}} and is yet to be approved. The candidate is on your Send Offers screen; the Send Offer button unlocks once the HR Head approves.",
    },
  }),
  notification({
    key: 'notify.offer.approved', module: RS,
    label: 'Offer approved',
    description: 'Tells the recruiter(s) on the MRF and the HR Managers that the HR Head approved the offer.',
    usedIn: 'Recruitment → HR Head → Approve',
    recipient: 'Recruiter(s) on the MRF, HR Manager(s)',
    variables: DECIDED_VARS,
    defaults: {
      subject: `Offer approved — ${WHO_ROLE}`,
      body: 'The HR Head approved the {{ctc_lakh}} offer for {{candidate_name}}{{#if mrf_number}} · {{mrf_number}}{{/if}}.{{#if comment}} Comment: “{{comment}}”{{/if}} Send the offer letter from Recruitment → Send Offers.',
    },
  }),
  notification({
    key: 'notify.offer.rejected', module: RS,
    label: 'Offer rejected',
    description: 'Tells the recruiter(s) and whoever raised the MRF that the HR Head rejected the offer.',
    usedIn: 'Recruitment → HR Head → Reject',
    recipient: 'Recruiter(s) on the MRF, MRF raiser',
    variables: DECIDED_VARS,
    defaults: {
      subject: `Offer rejected — ${WHO_ROLE}`,
      body: 'The HR Head rejected the {{ctc_lakh}} offer for {{candidate_name}}{{#if mrf_number}} · {{mrf_number}}{{/if}}.{{#if comment}} Comment: “{{comment}}”{{/if}} Revise the negotiation and raise a fresh approval request.',
    },
  }),
  notification({
    key: 'notify.offer.revision', module: RS,
    label: 'Offer revision — HR Head',
    description: 'Tells the HR Head a sent offer has come back for revision.',
    usedIn: 'Recruitment → Offers → candidate reply → Revision',
    recipient: 'HR Head(s)',
    variables: [v('requested_by', 'Sent back by', 'Anita Verma'), CANDIDATE, NOTE],
    defaults: {
      subject: 'Offer revision — {{candidate_name}}',
      body: "{{requested_by}} has sent {{candidate_name}}'s offer back for revision: \"{{note}}\". Edit the offer and approve it from Recruitment → HR Head.",
    },
  }),
  notification({
    key: 'notify.offer.confidential_ready', module: RS,
    label: 'Confidential offer ready to send',
    description: 'Confidential hiring: the candidate accepted the salary break-up and the offer is self-approved.',
    usedIn: 'Candidate salary-offer page → Accept (confidential MRF)',
    recipient: 'HR Head, HR Manager(s)',
    variables: [CANDIDATE, ROLE, MRF_NO, PACKAGE],
    defaults: {
      subject: 'Confidential offer ready to send — {{candidate_name}}',
      body: `${WHO_ROLE}{{#if mrf_number}} · {{mrf_number}}{{/if}} accepted the salary break-up of {{package}}. The offer is self-approved (confidential hiring) and is on Send Offers — verify the offer file, generate the letter and send it.`,
    },
  }),
  notification({
    key: 'notify.mrf.sent_back_hm', module: RS,
    label: 'MRF sent back by the hiring manager',
    description: 'Tells the MRF raiser the assigned hiring manager sent it back.',
    usedIn: 'ESS → Tasks & Approvals → MRF → Send back',
    recipient: 'MRF raiser',
    variables: [MRF_LABEL, ACTOR, NOTE],
    defaults: {
      subject: 'MRF sent back by the hiring manager',
      body: '{{mrf_label}} was sent back by {{actor_name}}: “{{note}}”. Open Tasks & Approvals to edit and resubmit it.',
    },
  }),
  notification({
    key: 'notify.mrf.sent_back', module: RS,
    label: 'MRF sent back for changes',
    description: 'Tells the MRF raiser an approver sent it back.',
    usedIn: 'ESS → Tasks & Approvals → MRF → Send back',
    recipient: 'MRF raiser',
    variables: [MRF_LABEL, ACTOR, NOTE],
    defaults: {
      subject: 'MRF sent back for changes',
      body: '{{mrf_label}} was sent back by {{actor_name}}: “{{note}}”. Open Tasks & Approvals to edit and resubmit it.',
    },
  }),
  notification({
    key: 'notify.mrf.assigned', module: RS,
    label: 'MRF assigned',
    description: 'Tells each hiring manager the HR Head assigned an MRF to them.',
    usedIn: 'ESS → Tasks & Approvals → MRF → Approve (HR Head)',
    recipient: 'Assigned hiring manager(s)',
    variables: [MRF_LABEL],
    defaults: {
      subject: 'You have been assigned an MRF',
      body: 'You have been assigned to hire for {{mrf_label}}. Acknowledge it in Tasks & Approvals, then run the hiring in Recruitment.',
    },
  }),

  // ── Leave ──
  notification({
    key: 'notify.leave.awaiting', module: LV,
    label: 'Leave request awaiting you',
    description: 'Tells the approver an employee has applied for leave.',
    usedIn: 'ESS → Leave → Apply',
    recipient: 'Leave approver',
    variables: [EMPLOYEE, v('days', 'Days', '2'), v('leave_type', 'Leave type', 'Casual Leave'), FROM_DATE],
    defaults: {
      subject: 'Leave request awaiting you',
      body: '{{employee_name}} has applied for {{days}} day(s) of {{leave_type}} from {{from_date}}.',
    },
  }),
  notification({
    key: 'notify.leave.awaiting_hr', module: LV,
    label: 'Leave request awaiting HR',
    description: 'For leave types approved by both: tells HR the reporting manager has signed off.',
    usedIn: 'ESS → Tasks & Approvals → Leave → Approve (manager)',
    recipient: 'HR approver',
    variables: [v('leave_type', 'Leave type', 'Earned Leave')],
    defaults: {
      subject: 'Leave request awaiting you',
      body: 'A {{leave_type}} request needs HR approval after the reporting manager signed off.',
    },
  }),
  notification({
    key: 'notify.leave.passed_to_hr', module: LV,
    label: 'Leave passed to HR',
    description: 'Tells the employee the manager approved and the request is now with HR.',
    usedIn: 'ESS → Tasks & Approvals → Leave → Approve (manager)',
    recipient: 'Employee',
    variables: [DAYS_LABEL, FROM_DATE],
    defaults: {
      subject: 'Leave passed to HR',
      body: 'Your manager approved {{days_label}} from {{from_date}}; it now needs HR approval.',
    },
  }),
  notification({
    key: 'notify.leave.approved', module: LV,
    label: 'Leave approved',
    description: 'Tells the employee their leave was approved.',
    usedIn: 'ESS → Tasks & Approvals → Leave → Approve',
    recipient: 'Employee',
    variables: [DAYS_LABEL, FROM_DATE, v('approver_name', 'Approver', 'Anita Verma'), v('note', 'Remark (may be empty)', 'Enjoy!')],
    defaults: {
      subject: 'Leave approved',
      body: '{{days_label}} from {{from_date}} — approved by {{approver_name}}{{#if note}}: {{note}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.leave.declined', module: LV,
    label: 'Leave declined',
    description: 'Tells the employee their leave was declined.',
    usedIn: 'ESS → Tasks & Approvals → Leave → Decline',
    recipient: 'Employee',
    variables: [DAYS_LABEL, FROM_DATE, v('approver_name', 'Approver', 'Anita Verma'), v('note', 'Remark (may be empty)', 'Quarter-end freeze.')],
    defaults: {
      subject: 'Leave declined',
      body: '{{days_label}} from {{from_date}} — declined by {{approver_name}}{{#if note}}: {{note}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.leave.withdrawn', module: LV,
    label: 'Leave request withdrawn',
    description: 'Tells the approver the employee cancelled a pending request.',
    usedIn: 'ESS → Leave → Cancel',
    recipient: 'Leave approver',
    variables: [FROM_DATE],
    defaults: {
      subject: 'Leave request withdrawn',
      body: 'A leave request for {{from_date}} was cancelled by the employee.',
    },
  }),
  notification({
    key: 'notify.leave.submitted', module: LV,
    label: 'Leave request sent',
    description: 'Tells the employee their request went through and who it is waiting on.',
    usedIn: 'ESS → Leave → Apply',
    recipient: 'Employee',
    variables: [DAYS_LABEL, LEAVE_TYPE, FROM_DATE, APPROVER_NAME, APPROVER_ROLE],
    defaults: {
      subject: 'Leave request sent to {{approver_name}}',
      body: '{{days_label}} of {{leave_type}} from {{from_date}} is waiting on {{approver_name}}{{#if approver_role}} ({{approver_role}}){{/if}}.',
    },
  }),
  notification({
    key: 'notify.leave.cancel_requested', module: LV,
    label: 'Leave cancellation awaiting you',
    description: 'Tells the approver an employee wants to cancel leave that was already approved.',
    usedIn: 'ESS → Leave → Request cancellation',
    recipient: 'Leave approver',
    variables: [EMPLOYEE, DAYS_LABEL, LEAVE_TYPE, FROM_DATE, REASON],
    defaults: {
      subject: 'Leave cancellation awaiting you',
      body: '{{employee_name}} wants to cancel approved {{leave_type}} ({{days_label}} from {{from_date}}){{#if reason}}: {{reason}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.leave.cancel_approved', module: LV,
    label: 'Leave cancelled',
    description: 'Tells the employee their approved leave was cancelled and the days returned.',
    usedIn: 'Tasks & Approvals → Leave cancellation → Approve',
    recipient: 'Employee',
    variables: [DAYS_LABEL, LEAVE_TYPE, FROM_DATE, APPROVER_NAME, NOTE],
    defaults: {
      subject: 'Leave cancelled',
      body: '{{approver_name}} approved cancelling your {{leave_type}} ({{days_label}} from {{from_date}}); the days are back in your balance{{#if note}}. {{note}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.leave.cancel_declined', module: LV,
    label: 'Leave cancellation declined',
    description: 'Tells the employee their approved leave still stands.',
    usedIn: 'Tasks & Approvals → Leave cancellation → Decline',
    recipient: 'Employee',
    variables: [LEAVE_TYPE, FROM_DATE, APPROVER_NAME, NOTE],
    defaults: {
      subject: 'Leave cancellation declined',
      body: '{{approver_name}} declined cancelling your {{leave_type}} from {{from_date}}{{#if note}}: {{note}}{{/if}}. The leave stands.',
    },
  }),
  notification({
    key: 'notify.attendance.reg_awaiting', module: LV,
    label: 'Attendance correction awaiting you',
    description: 'Tells the approver an employee has asked to correct their attendance.',
    usedIn: 'ESS → Attendance → Raise regularisation',
    recipient: 'Reporting manager (or HR when there is none)',
    variables: [EMPLOYEE, DATES, DAY_COUNT, REASON],
    defaults: {
      subject: 'Attendance correction awaiting you',
      body: '{{employee_name}} has asked to correct attendance for {{dates}} ({{day_count}} day(s)){{#if reason}}: {{reason}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.attendance.reg_submitted', module: LV,
    label: 'Attendance correction sent',
    description: 'Tells the employee their correction went through and who it is waiting on.',
    usedIn: 'ESS → Attendance → Raise regularisation',
    recipient: 'Employee',
    variables: [DATES, APPROVER_NAME, APPROVER_ROLE],
    defaults: {
      subject: 'Attendance correction sent to {{approver_name}}',
      body: 'Your correction for {{dates}} is waiting on {{approver_name}}{{#if approver_role}} ({{approver_role}}){{/if}}.',
    },
  }),
  notification({
    key: 'notify.attendance.reg_approved', module: LV,
    label: 'Attendance corrected',
    description: 'Tells the employee their correction was approved and the attendance updated.',
    usedIn: 'Tasks & Approvals → Attendance correction → Approve',
    recipient: 'Employee',
    variables: [DATES, APPROVER_NAME, NOTE],
    defaults: {
      subject: 'Attendance corrected',
      body: '{{approver_name}} approved your attendance correction for {{dates}}{{#if note}}: {{note}}{{/if}}. Your attendance now shows the corrected times.',
    },
  }),
  notification({
    key: 'notify.attendance.reg_declined', module: LV,
    label: 'Attendance correction declined',
    description: 'Tells the employee their correction was declined.',
    usedIn: 'Tasks & Approvals → Attendance correction → Decline',
    recipient: 'Employee',
    variables: [DATES, APPROVER_NAME, NOTE],
    defaults: {
      subject: 'Attendance correction declined',
      body: '{{approver_name}} declined your attendance correction for {{dates}}{{#if note}}: {{note}}{{/if}}.',
    },
  }),
  notification({
    key: 'notify.attendance.reg_withdrawn', module: LV,
    label: 'Attendance correction withdrawn',
    description: 'Tells the approver the employee withdrew a pending correction.',
    usedIn: 'ESS → Attendance → Withdraw',
    recipient: 'Approver',
    variables: [EMPLOYEE, DATES],
    defaults: {
      subject: 'Attendance correction withdrawn',
      body: '{{employee_name}} withdrew the attendance correction for {{dates}}.',
    },
  }),
  notification({
    key: 'notify.approvals.reminder', module: LV,
    label: 'Requests waiting — daily reminder',
    description: 'The bell version of the morning reminder, for requests that have waited more than two days.',
    usedIn: 'Daily job (09:30 IST)',
    recipient: 'Approver',
    variables: [COUNT, OLDEST_DAYS],
    defaults: {
      subject: '{{count}} request(s) waiting on you',
      body: 'You have {{count}} leave or attendance request(s) waiting, the oldest for {{oldest_days}} day(s). Open Tasks & Approvals to act on them.',
    },
  }),

  // ── Resignation ──
  notification({
    key: 'notify.resignation.submitted', module: LC,
    label: 'Resignation — acknowledgement needed',
    description: 'Tells the first approver an employee has resigned.',
    usedIn: 'ESS → Resignation → Submit',
    recipient: 'First approver in the chain',
    variables: [EMPLOYEE, EMP_CODE, STAGE],
    defaults: {
      subject: 'Resignation — acknowledgement needed',
      body: '{{employee_name}}{{#if emp_code}} · {{emp_code}}{{/if}} has submitted a resignation. It is waiting on you ({{stage}}).',
    },
  }),
  notification({
    key: 'notify.resignation.retention', module: LC,
    label: 'Retention conversation requested',
    description: 'Tells the employee an approver wants to discuss the resignation first.',
    usedIn: 'ESS → Tasks & Approvals → Resignation → Retention hold',
    recipient: 'Employee',
    variables: [ACTOR],
    defaults: {
      subject: 'Retention conversation requested',
      body: '{{actor_name}} has asked to discuss your resignation before it moves ahead.',
    },
  }),
  notification({
    key: 'notify.resignation.moved', module: LC,
    label: 'Resignation moved ahead',
    description: 'Tells the employee an approver acknowledged the resignation.',
    usedIn: 'ESS → Tasks & Approvals → Resignation → Acknowledge',
    recipient: 'Employee',
    variables: [ACTOR, v('next_stage', 'Now with', 'HR')],
    defaults: {
      subject: 'Resignation moved ahead',
      body: '{{actor_name}} acknowledged your resignation. It is now with {{next_stage}}.',
    },
  }),
  notification({
    key: 'notify.resignation.awaiting', module: LC,
    label: 'Resignation awaiting you',
    description: 'Tells the next approver a resignation is waiting on them.',
    usedIn: 'ESS → Tasks & Approvals → Resignation → Acknowledge',
    recipient: 'Next approver in the chain',
    variables: [STAGE],
    defaults: {
      subject: 'Resignation awaiting you',
      body: 'A resignation in your chain needs your acknowledgement (stage {{stage}}).',
    },
  }),
  notification({
    key: 'notify.resignation.lwd', module: LC,
    label: 'Last working day confirmed',
    description: 'Tells the employee HR has set the last working day.',
    usedIn: 'ESS → Tasks & Approvals → Resignation → HR confirms',
    recipient: 'Employee',
    variables: [v('last_working_day', 'Last working day', '30 Nov 2026')],
    defaults: {
      subject: 'Last working day confirmed',
      body: 'HR has set your last working day as {{last_working_day}}.',
    },
  }),
]

export const WORKFLOW_TEMPLATES: TemplateDef[] = [...WORKFLOW_EMAILS, ...WORKFLOW_LETTERS, ...WORKFLOW_NOTIFICATIONS]

/** "1 day" / "2 days". */
export const daysLabel = (n: number) => `${n} day${n === 1 ? '' : 's'}`
