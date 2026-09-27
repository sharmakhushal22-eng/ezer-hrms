// lib/recruitment/collect-docs.ts — the document set a candidate uploads for the
// CTC-negotiation document collection, and the invite email. Shared by the public
// upload page, the API routes, and the recruiter's status view so they never drift.

// `multiple: true` lets the candidate upload several files under one document
// (e.g. Aadhaar front & back, or multiple appraisal letters).
export interface DocDef { type: string; label: string; group: string; mandatory: boolean; multiple?: boolean }

export const COLLECT_DOCS: DocDef[] = [
  { type: 'PAN',                label: 'PAN Card',                 group: 'Identity & Tax',   mandatory: true },
  { type: 'AADHAAR',           label: 'Aadhaar Card (front & back)', group: 'Identity & Tax', mandatory: true, multiple: true },
  { type: 'BANK_PROOF',        label: 'Bank Statement',           group: 'Financial',        mandatory: true },
  { type: '10TH_MARKSHEET',    label: '10th Marksheet',           group: 'Education',        mandatory: true },
  { type: '12TH_MARKSHEET',    label: '12th Marksheet',           group: 'Education',        mandatory: true },
  { type: 'GRADUATION',        label: 'Graduation',               group: 'Education',        mandatory: true },
  { type: 'MASTERS',           label: 'MBA / Masters',            group: 'Education',        mandatory: false },
  { type: 'ADDITIONAL_1',      label: 'Additional Certification', group: 'Education',        mandatory: false },
  { type: 'APPOINTMENT_LETTER', label: 'Appointment Letter',      group: 'Employment',       mandatory: true },
  { type: 'APPRAISAL_LETTER',  label: 'Appraisal Letter',         group: 'Employment',       mandatory: false, multiple: true },
  { type: 'SALARY_SLIP_1',     label: 'Salary Slip — Month 1',    group: 'Income',           mandatory: true },
  { type: 'SALARY_SLIP_2',     label: 'Salary Slip — Month 2',    group: 'Income',           mandatory: true },
  { type: 'SALARY_SLIP_3',     label: 'Salary Slip — Month 3',    group: 'Income',           mandatory: true },
  { type: 'FORM_16',           label: 'Form 16',                  group: 'Income',           mandatory: true },
  { type: 'PHOTO',             label: 'Passport-size Photo',      group: 'Photograph',       mandatory: true },
]

export const DOC_GROUPS = ['Identity & Tax', 'Financial', 'Education', 'Employment', 'Income', 'Photograph']

export const LINK_TTL_HOURS = 24

/** The congratulations + document-submission email (candidate). Returns plain text;
 *  send-letter converts newlines to <br> for the HTML part. */
export function inviteEmail(opts: {
  candidateName: string; jobTitle: string; companyName: string; link: string
  senderName?: string; senderTitle?: string; senderContact?: string
}): { subject: string; body: string } {
  const { candidateName, jobTitle, companyName, link, senderName, senderTitle, senderContact } = opts
  const subject = 'Congratulations on your selection! | Next Steps & Document Submission'
  const body = `Dear ${candidateName || 'Candidate'},

Congratulations! We are thrilled to inform you that you have been selected for the position of ${jobTitle || 'the role'} at ${companyName || 'our company'}. We were highly impressed with your profile and are excited to move forward with your onboarding.

To proceed further and initiate the formal offer process, we require a few details from your end. Please use the secure link provided below to upload clear copies of the following documents:

• Identity & Tax: PAN Card and Aadhaar Card
• Financial: Bank Statement
• Educational Qualifications: 10th, 12th, Graduation, MBA (and any additional certifications)
• Employment History: Appointment Letter and Appraisal Letter (from your previous employer)
• Income Proof: Last 3 months' Salary Slips and Form 16
• Photograph: Recent Passport-size Photo

🔗 Document Upload Link: ${link}

Important: Please note that this upload link is valid for 24 hours only. Kindly ensure all documents are submitted within this timeframe so we can process your offer letter without any delays.

If you have any questions or face any technical issues with the link, please let me know immediately.

Once again, congratulations! We look forward to welcoming you to the team.

Best regards,
${senderName || 'The Hiring Team'}
${senderTitle || ''}
${companyName || ''}
${senderContact || ''}`.replace(/\n{3,}/g, '\n\n')
  return { subject, body }
}

/** Re-upload request — sent when HR rejects one or more documents and resends the link.
 *  Lists exactly which documents the candidate must upload again. */
export function reuploadEmail(opts: {
  candidateName: string; jobTitle: string; companyName: string; link: string
  missing: string[]; senderName?: string
}): { subject: string; body: string } {
  const { candidateName, jobTitle, companyName, link, missing, senderName } = opts
  const list = (missing.length ? missing : ['the pending documents']).map(m => `• ${m}`).join('\n')
  const subject = 'Action needed: Please re-upload a few documents'
  const body = `Dear ${candidateName || 'Candidate'},

Thank you for submitting your documents for the position of ${jobTitle || 'the role'}${companyName ? ` at ${companyName}` : ''}.

On review, we need you to re-upload the following document(s) — the rest are already received and do not need to be sent again:

${list}

Please use the same secure link below to upload only the document(s) listed above:

🔗 Document Upload Link: ${link}

Important: This link is valid for 24 hours. Kindly re-upload the required document(s) within this time so we can process your offer without delay.

If you have any questions, please let me know.

Best regards,
${senderName || 'The Hiring Team'}
${companyName || ''}`.replace(/\n{3,}/g, '\n\n')
  return { subject, body }
}

/** Internal heads-up to the recruiter (and CC'd colleagues) once a candidate submits. */
export function submittedEmail(opts: {
  candidateName: string; jobTitle: string; companyName: string; uploaded: number; resubmission?: boolean
}): { subject: string; body: string } {
  const { candidateName, jobTitle, companyName, uploaded, resubmission } = opts
  const subject = `${resubmission ? 'Re-submitted' : 'Documents submitted'}: ${candidateName || 'Candidate'}${jobTitle ? ` — ${jobTitle}` : ''}`
  const body = `Hi,

${candidateName || 'The candidate'}${jobTitle ? ` (${jobTitle})` : ''}${companyName ? ` at ${companyName}` : ''} has ${resubmission ? 're-submitted' : 'submitted'} their documents through the secure upload link.

${uploaded} document${uploaded === 1 ? '' : 's'} ${uploaded === 1 ? 'has' : 'have'} been received. You can review, download or reject them from Recruitment → Negotiation → Pre-negotiation Checks → Review Documents.

— EZER HRMS`.replace(/\n{3,}/g, '\n\n')
  return { subject, body }
}
