// lib/recruitment/collect-docs.ts — the document set a candidate uploads for the
// CTC-negotiation document collection. Shared by the public
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

// The emails of this flow are Configuration templates now (lib/config/registry.ts and
// lib/config/workflow-templates.ts): the candidate's invite and re-upload mails
// ('doc_collection.invite' / 'doc_collection.reupload', app/api/recruitment/doc-collection),
// the verification code ('doc_collection.otp', app/api/collect-docs/otp) and the recruiter's
// heads-up on submission ('doc_collection.submitted', app/api/collect-docs). Their built-in
// wording is the text that used to live here.
