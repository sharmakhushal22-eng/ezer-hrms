// lib/config/registry.ts — every letter and email the Configuration tab can edit.
//
// Pure: no database, no React. For each template this file holds what code must own
// — where it is sent from, which values exist for it, and the built-in wording — and
// the database (config_templates, migration 134) holds only the edited text.
//
// THE BUILT-IN WORDING IS TODAY'S WORDING, moved here verbatim from the routes that
// used to hard-code it. Until somebody edits a template, every workflow sends exactly
// what it sent before. When adding a template: add it here, then make the workflow
// render it through lib/config/store.ts — never write the text into the route.
//
// HR letters are the one dynamic group: their names live in letter_templates, so
// their definitions are built at run time by hrLetterDef().

import { OFFER_EMAIL_TEMPLATES, OFFER_LETTER_TEMPLATES } from './offer-templates.ts'
import { WORKFLOW_TEMPLATES } from './workflow-templates.ts'

export type Channel = 'EMAIL' | 'LETTER' | 'NOTIFICATION'
export type TemplateModule = 'Recruitment' | 'Onboarding' | 'HR Letters' | 'Employee lifecycle' | 'Payroll & finance' | 'Leave & attendance'

export interface TemplateVar {
  name: string
  label: string
  /** Fictional value used by the preview. Never real employee or candidate data. */
  sample: string
  /** Expands to a whole block (the offer letter's compensation table). */
  block?: boolean
}

export interface TemplateDef {
  key: string
  channel: Channel
  module: TemplateModule
  label: string
  description: string
  /** Where in the portal this goes out from — shown so an editor knows what changes. */
  usedIn: string
  recipient: string
  /** 'Subject' for an email, 'Letter title' for a letter. */
  subjectLabel: string
  variables: TemplateVar[]
  defaults: { subject: string; body: string }
  /** 'offer' = the structured offer-letter layout ([Clause] paragraphs, "--- … ---"
   *  sections) — see lib/config/offer-letter.ts. */
  letterLayout?: 'offer'
}

export const HR_LETTER_PREFIX = 'hr_letter:'
export const isHrLetterKey = (key: string) => key.startsWith(HR_LETTER_PREFIX)
export const hrLetterKey = (letterTemplateId: string) => `${HR_LETTER_PREFIX}${letterTemplateId}`
export const hrLetterIdOf = (key: string) => key.slice(HR_LETTER_PREFIX.length)

// ── Shared variable definitions ──────────────────────────────────────────────

const v = (name: string, label: string, sample: string, block?: boolean): TemplateVar =>
  ({ name, label, sample, ...(block ? { block } : {}) })

const CANDIDATE_NAME = v('candidate_name', 'Candidate name', 'Priya Sharma')
const COMPANY_NAME = v('company_name', 'Company name', 'Sharma Retail Solutions Pvt Ltd')
const DESIGNATION = v('designation', 'Designation / role', 'Senior Sales Manager')
const JOB_TITLE = v('job_title', 'Job title (from the MRF)', 'Senior Sales Manager')
const ROUND = v('round', 'Interview round', 'L1 Interview')
const INTERVIEW_TIME = v('interview_time', 'Interview date & time', '14 Oct 2026, 11:00 am')
const MEET_LINK = v('meet_link', 'Meeting link (may be empty)', 'https://meet.google.com/abc-defg-hij')
const MEET_PASSCODE = v('meet_passcode', 'Meeting passcode (may be empty)', '482913')
const SCHEDULER = v('scheduler_name', 'Scheduled by', 'Anita Verma')
const UPLOAD_LINK = v('upload_link', 'Document upload link', 'https://app.example.com/collect-docs/3f9a…')
const LINK_HOURS = v('link_validity_hours', 'Link validity (hours)', '24')
const SENDER = v('sender_name', 'Sender name', 'The Hiring Team')
const ONBOARDING_LINK = v('onboarding_link', 'Onboarding link', 'https://app.example.com/onboarding/7c1e…')

// ── System templates ─────────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES: TemplateDef[] = [
  // The six offer letters and six offer emails, one per engagement (Employment, Internship,
  // NATS, NAPS, Contract, Consultant) — lib/config/offer-templates.ts.
  ...OFFER_LETTER_TEMPLATES,
  ...OFFER_EMAIL_TEMPLATES,

  {
    key: 'interview.candidate',
    channel: 'EMAIL', module: 'Recruitment',
    label: 'Interview invite — candidate',
    description: 'Sent to the candidate when a round is scheduled.',
    usedIn: 'Recruitment → candidate → Interviews → Schedule round',
    recipient: 'Candidate',
    subjectLabel: 'Subject',
    variables: [CANDIDATE_NAME, ROUND, JOB_TITLE, INTERVIEW_TIME, MEET_LINK, MEET_PASSCODE, SCHEDULER, COMPANY_NAME],
    defaults: {
      subject: 'Interview scheduled — {{round}}',
      body: `Dear {{candidate_name}},

Your {{round}} interview{{#if job_title}} for the {{job_title}} role{{/if}} is scheduled for {{interview_time}}.{{#if meet_link}}
Join link: {{meet_link}}{{/if}}{{#if meet_passcode}}
Passcode: {{meet_passcode}}{{/if}}

Please join on time. All the best.

{{scheduler_name}}`,
    },
  },
  {
    key: 'interview.interviewer_main',
    channel: 'EMAIL', module: 'Recruitment',
    label: 'Interview invite — main interviewer',
    description: 'Sent to the main interviewer of a round (the one who gives feedback).',
    usedIn: 'Recruitment → candidate → Interviews → Schedule round',
    recipient: 'Main interviewer (employee)',
    subjectLabel: 'Subject',
    variables: [
      v('interviewer_name', 'Interviewer name', 'Rahul Nair'),
      CANDIDATE_NAME, ROUND, INTERVIEW_TIME, MEET_LINK, MEET_PASSCODE,
      v('panel_names', 'Panelists (may be empty)', 'Meera Iyer, Arjun Rao'),
      SCHEDULER, COMPANY_NAME,
    ],
    defaults: {
      subject: 'Interview to conduct — {{candidate_name}} ({{round}})',
      body: `Hi {{interviewer_name}},

{{candidate_name}} — {{round}} round, scheduled for {{interview_time}}.{{#if meet_link}}
Join link: {{meet_link}}{{/if}}{{#if meet_passcode}}
Passcode: {{meet_passcode}}{{/if}}

You are the MAIN interviewer{{#if panel_names}} (panel: {{panel_names}}){{/if}}. Please acknowledge it from your ESS notifications (the bell) and record your feedback there after the interview.

{{scheduler_name}}`,
    },
  },
  {
    key: 'interview.interviewer_panel',
    channel: 'EMAIL', module: 'Recruitment',
    label: 'Interview invite — panelist',
    description: 'Sent to each panelist added to a round.',
    usedIn: 'Recruitment → candidate → Interviews → Schedule round',
    recipient: 'Panelists (employees)',
    subjectLabel: 'Subject',
    variables: [
      v('interviewer_name', 'Panelist name', 'Meera Iyer'),
      CANDIDATE_NAME, ROUND, INTERVIEW_TIME, MEET_LINK, MEET_PASSCODE,
      v('main_interviewer_name', 'Main interviewer', 'Rahul Nair'),
      SCHEDULER, COMPANY_NAME,
    ],
    defaults: {
      subject: 'Interview to conduct — {{candidate_name}} ({{round}})',
      body: `Hi {{interviewer_name}},

{{candidate_name}} — {{round}} round, scheduled for {{interview_time}}.{{#if meet_link}}
Join link: {{meet_link}}{{/if}}{{#if meet_passcode}}
Passcode: {{meet_passcode}}{{/if}}

You've been added as a PANELIST. Main interviewer: {{main_interviewer_name}}. Please acknowledge it from your ESS notifications (the bell).

{{scheduler_name}}`,
    },
  },
  {
    key: 'doc_collection.invite',
    channel: 'EMAIL', module: 'Recruitment',
    label: 'Document collection — invite',
    description: 'Congratulations mail with the secure document-upload link.',
    usedIn: 'Recruitment → Negotiation → Pre-negotiation checks → Send document link',
    recipient: 'Candidate (+ CC)',
    subjectLabel: 'Subject',
    variables: [CANDIDATE_NAME, JOB_TITLE, COMPANY_NAME, UPLOAD_LINK, LINK_HOURS, SENDER],
    defaults: {
      subject: 'Congratulations on your selection! | Next Steps & Document Submission',
      body: `Dear {{candidate_name}},

Congratulations! We are thrilled to inform you that you have been selected for the position of {{job_title}} at {{company_name}}. We were highly impressed with your profile and are excited to move forward with your onboarding.

To proceed further and initiate the formal offer process, we require a few details from your end. Please use the secure link provided below to upload clear copies of the following documents:

• Identity & Tax: PAN Card and Aadhaar Card
• Financial: Bank Statement
• Educational Qualifications: 10th, 12th, Graduation, MBA (and any additional certifications)
• Employment History: Appointment Letter and Appraisal Letter (from your previous employer)
• Income Proof: Last 3 months' Salary Slips and Form 16
• Photograph: Recent Passport-size Photo

🔗 Document Upload Link: {{upload_link}}

Important: Please note that this upload link is valid for {{link_validity_hours}} hours only. Kindly ensure all documents are submitted within this timeframe so we can process your offer letter without any delays.

If you have any questions or face any technical issues with the link, please let me know immediately.

Once again, congratulations! We look forward to welcoming you to the team.

Best regards,
{{sender_name}}
{{company_name}}`,
    },
  },
  {
    key: 'doc_collection.reupload',
    channel: 'EMAIL', module: 'Recruitment',
    label: 'Document collection — re-upload request',
    description: 'Sent instead of the invite when some documents were rejected and the link is resent.',
    usedIn: 'Recruitment → Review Documents → reject a document → Resend link',
    recipient: 'Candidate (+ CC)',
    subjectLabel: 'Subject',
    variables: [
      CANDIDATE_NAME, JOB_TITLE, COMPANY_NAME, UPLOAD_LINK, LINK_HOURS, SENDER,
      v('missing_documents', 'Documents to re-upload (bulleted list)', '• PAN Card\n• Form 16'),
    ],
    defaults: {
      subject: 'Action needed: Please re-upload a few documents',
      body: `Dear {{candidate_name}},

Thank you for submitting your documents for the position of {{job_title}}{{#if company_name}} at {{company_name}}{{/if}}.

On review, we need you to re-upload the following document(s) — the rest are already received and do not need to be sent again:

{{missing_documents}}

Please use the same secure link below to upload only the document(s) listed above:

🔗 Document Upload Link: {{upload_link}}

Important: This link is valid for {{link_validity_hours}} hours. Kindly re-upload the required document(s) within this time so we can process your offer without delay.

If you have any questions, please let me know.

Best regards,
{{sender_name}}
{{company_name}}`,
    },
  },
  {
    key: 'onboarding.invite',
    channel: 'EMAIL', module: 'Onboarding',
    label: 'Onboarding invitation',
    description: 'The secure onboarding link a new joiner uses to fill in their details and upload documents.',
    usedIn: 'Onboarding → Send onboarding link (single or bulk)',
    recipient: 'New joiner',
    subjectLabel: 'Subject',
    variables: [CANDIDATE_NAME, ONBOARDING_LINK, LINK_HOURS, COMPANY_NAME, DESIGNATION, v('joining_date', 'Date of joining', '01 November 2026')],
    defaults: {
      subject: 'Welcome aboard! Complete your onboarding — {{candidate_name}}',
      body: `Dear {{candidate_name}},

Welcome! Please complete your joining formalities by opening the secure link below:

{{onboarding_link}}

This link is valid for {{link_validity_hours}} hours. You'll verify your mobile via OTP, then fill in your details and upload documents.

Warm regards,
HR Team`,
    },
  },
  {
    key: 'onboarding.reminder',
    channel: 'EMAIL', module: 'Onboarding',
    label: 'Onboarding reminder',
    description: 'Re-sends the existing onboarding link and refreshes its validity.',
    usedIn: 'Onboarding → candidate card → Resend link',
    recipient: 'New joiner',
    subjectLabel: 'Subject',
    variables: [CANDIDATE_NAME, ONBOARDING_LINK, LINK_HOURS, COMPANY_NAME],
    defaults: {
      subject: 'Reminder: complete your onboarding — {{candidate_name}}',
      body: `Dear {{candidate_name}},

A reminder to complete your joining formalities. Please open your secure onboarding link below:

{{onboarding_link}}

This link is valid for {{link_validity_hours}} hours.

Warm regards,
HR Team`,
    },
  },
  {
    key: 'hr_letter.email',
    channel: 'EMAIL', module: 'HR Letters',
    label: 'HR letter — covering email',
    description: 'The email a generated HR letter is attached to.',
    usedIn: 'HR Letters → Generate Letters → Email',
    recipient: 'Employee',
    subjectLabel: 'Subject',
    variables: [
      v('employee_name', 'Employee name', 'Rajesh Mehta'),
      v('letter_name', 'Letter name', 'Experience Letter'),
      v('letter_date', 'Letter date', '14 October 2026'),
      COMPANY_NAME,
    ],
    defaults: {
      subject: 'Your {{letter_name}} — {{letter_date}}',
      body: `Dear {{employee_name}},

Please find your **{{letter_name}}** attached, dated {{letter_date}}.

If you have any questions about this letter, please contact the HR team.`,
    },
  },
  // Every other workflow — recruitment follow-ups and approvals, onboarding, transfer,
  // resignation, payroll, leave; emails, letters and in-app notifications.
  ...WORKFLOW_TEMPLATES,
]

const BY_KEY = new Map(SYSTEM_TEMPLATES.map(t => [t.key, t]))

export function systemTemplate(key: string): TemplateDef | null {
  return BY_KEY.get(key) ?? null
}

/** A letter_templates row as an editable template. `fields` and `samples` come from
 *  lib/letters/mergeFields.ts (passed in so this file stays pure). The legacy content
 *  column is the built-in default, so a letter nobody has edited in Configuration
 *  generates exactly as before. */
export function hrLetterDef(
  row: { id: string; name: string; description?: string | null; content?: string | null },
  fields: { token: string; label: string }[],
  samples: Record<string, string>,
): TemplateDef {
  return {
    key: hrLetterKey(row.id),
    channel: 'LETTER', module: 'HR Letters',
    label: row.name,
    description: row.description || 'HR letter generated on the employee\'s branch letterhead.',
    usedIn: 'HR Letters → Generate Letters',
    recipient: 'Employee (download, email or ESS)',
    subjectLabel: 'Letter title',
    variables: fields.map(f => ({ name: f.token, label: f.label, sample: samples[f.token] ?? `[${f.label}]` })),
    defaults: { subject: row.name, body: row.content || '' },
  }
}

/** The preview's sample values for a template. */
export function sampleVars(def: TemplateDef): Record<string, string> {
  return Object.fromEntries(def.variables.filter(x => !x.block).map(x => [x.name, x.sample]))
}

export const blockVarsOf = (def: TemplateDef) => def.variables.filter(x => x.block).map(x => x.name)
