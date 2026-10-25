// The ten MRF sections (MrfForm.tsx §1–§10), one per wizard step on a phone.
// Every label, hint, placeholder and option list is the website's.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { WAGE_CATS } from '@web/recruitment/min-wages'
import { jobCodePrefix } from '@web/recruitment/job-code'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Checkbox, FieldLabel, Txt } from '@/ui/primitives'
import {
  ChannelPicker, DateField, LaneMeter, Locked, masterOpts, optsOf, QuestionsList, SectionLine, SelectField, SkillsPicker, TextField,
} from './fields'
import {
  compOf, EDUCATION_OPTIONS, EMP_TYPES, perLabel, PREV_COMPANY, PRIORITIES, QUICK_HIRE_CAP, REASON_FOR_HIRE, REQ_TYPES,
  REQUEST_SOURCES, SOURCING_MODES, WORK_MODES, type Form, type Refs,
} from './model'

export interface StepProps {
  form: Form
  set: (k: string, v: any) => void
  refs: Refs
  addSkill: (n: string) => void
}

const notSpec = (yes: string, no: string) => [{ value: '', label: 'Not specified' }, { value: 'yes', label: yes }, { value: 'no', label: no }]

function Sub({ children }: { children: string }) {
  return <Txt size={11} w={700} tone="faint" upper style={{ marginTop: S.md, marginBottom: S.sm }}>{children}</Txt>
}
function InfoBox({ children }: { children: React.ReactNode }) {
  const { C } = useTheme()
  return <View style={{ backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, borderRadius: 11, padding: 12, marginBottom: 12 }}>{children}</View>
}

export function StepMeta({ form, set, refs }: StepProps) {
  const { C } = useTheme()
  return (
    <>
      <SectionLine n="1" title="Requisition Meta" />
      <SelectField label="Requisition Type" value={form.hiring_type} onChange={v => set('hiring_type', v)} options={optsOf(REQ_TYPES)} />
      <SelectField label="Priority" value={form.urgency} onChange={v => set('urgency', v)} options={PRIORITIES.map(([value, label]) => ({ value, label }))} />
      <SelectField label="Request Source" hint="How this requisition came about" value={form.request_source} onChange={v => set('request_source', v)}
        options={[{ value: '', label: 'Not specified' }, ...optsOf(REQUEST_SOURCES)]} />
      <View style={{ marginBottom: S.md }}>
        <FieldLabel label="Requisition ID" />
        <View style={{ minHeight: 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.sunken, paddingHorizontal: S.md, justifyContent: 'center' }}>
          <Txt size={F.body} w={form.mrf_number ? 700 : 400} color={form.mrf_number ? C.ink : C.faint}>{form.mrf_number || 'Generating…'}</Txt>
        </View>
        <Txt size={F.tiny} tone="faint" style={{ marginTop: 4 }}>{form.mrf_number ? 'Reserved for this requisition' : 'Reserving a number…'}</Txt>
      </View>
      <TextField label="Raised By — Name" value={form.raised_by_name} onChange={v => set('raised_by_name', v)} placeholder="Your name" />
      <TextField label="Raised By — Role" value={form.raised_by_role} onChange={v => set('raised_by_role', v)} placeholder="e.g. Department Head" />
      {(refs.canConfidential || form.is_confidential) && (
        <View style={{ borderWidth: 1, borderColor: form.is_confidential ? C.warningEdge : C.line, backgroundColor: form.is_confidential ? C.warningTint : C.surface, borderRadius: 12, padding: 12 }}>
          <Checkbox checked={!!form.is_confidential} disabled={!refs.canConfidential} onChange={v => set('is_confidential', v)}
            label={<Txt size={13.5} w={700} style={{ flex: 1 }}>🔒 Confidential hiring</Txt>} />
          <Txt size={F.tiny} tone="muted" style={{ lineHeight: 18 }}>
            Approved the moment you submit — no RM2 / HR Head chain, nobody notified. The requisition and its candidates are visible only to you and the HR Manager of your company.
            You add the candidate, record one Telephonic round yourself (a Shortlist takes them straight to Negotiation), and once they accept the salary link the offer is self-approved and goes to Send Offers.
          </Txt>
        </View>
      )}
    </>
  )
}

export function StepPosition({ form, set, refs }: StepProps) {
  const a = refs.auto
  return (
    <>
      <SectionLine n="2" title="Position Details" />
      <Locked label="Company" value={a.company_name} hint="auto · your company" />
      <Locked label="Department / Function" value={a.department_name} hint="auto · your department" />
      <SelectField label="Business Unit" value={form.business_unit} onChange={v => set('business_unit', v)} options={masterOpts(refs.masters.business_unit || [], 'Select…')} />
      <TextField label="Job Title" value={form.job_title} onChange={v => set('job_title', v)} placeholder="e.g. Backend Engineer II" />
      <TextField label="Designation" required value={form.designation} onChange={v => set('designation', v)} placeholder="e.g. Senior Engineer" />
      <TextField label="No. of Openings" numeric value={form.no_of_openings} onChange={v => set('no_of_openings', v)} />
      <SelectField label="Grade / Band" value={form.grade} onChange={v => set('grade', v)} options={masterOpts(refs.masters.grade || [], 'Select…')} />
      <TextField label="Job Code" value={form.job_code} onChange={v => set('job_code', v)}
        hint={form.job_code ? 'Custom code' : 'Auto-generated on save — leave blank, or type your own'}
        placeholder={`${jobCodePrefix(a.department_code, a.department_name, form.designation)}## (auto)`} />
      <Locked label="RM1 — Reporting Manager" value={a.rm1} hint="auto · you" />
      <Locked label="RM2 — Skip-level Manager" value={a.rm2} hint="auto · your manager" />
      <Locked label="HOD — Department Head" value={a.hod} hint="auto · your HOD" />
    </>
  )
}

export function StepEmployment({ form, set, refs }: StepProps) {
  return (
    <>
      <SectionLine n="3" title="Employment Details" />
      <SelectField label="Employment Type" value={form.employment_type} onChange={v => set('employment_type', v)} options={optsOf(EMP_TYPES)} />
      <SelectField label="Work Mode" value={form.work_mode} onChange={v => set('work_mode', v)} options={optsOf(WORK_MODES)} />
      <SelectField label="Work Location" value={form.location_id} onChange={v => set('location_id', v)}
        options={[{ value: '', label: 'Select Location' }, ...refs.locations.map(l => ({ value: l.id, label: l.location_name }))]} />
      <SelectField label="Background Verification" value={form.bgv_required} onChange={v => set('bgv_required', v)} options={notSpec('Required', 'Not required')} />
      <TextField label="BGV Package" hint="Which checks — education, employment, criminal, address" value={form.bgv_package} onChange={v => set('bgv_package', v)} placeholder="e.g. Standard 3-check" />
      <SelectField label="Pre-employment Medical" value={form.medical_required} onChange={v => set('medical_required', v)} options={notSpec('Required', 'Not required')} />
    </>
  )
}

export function StepBudget({ form, set, refs }: StepProps) {
  const { C } = useTheme()
  const comp = compOf(form.employment_type)
  const annualMax = (Number(form.budget_max) || 0) * (comp.period === 'MONTHLY' ? 12 : 1)
  const annualMin = (Number(form.budget_min) || 0) * (comp.period === 'MONTHLY' ? 12 : 1)
  const laneShouldBe = annualMax > QUICK_HIRE_CAP ? 'Full MRF' : 'Quick Hire'
  const bad = Number(form.budget_min) > 0 && Number(form.budget_max) > 0 && Number(form.budget_min) > Number(form.budget_max)
  return (
    <>
      <SectionLine n="4" title="Budget & Cost" />
      <InfoBox><Txt size={12.5} tone="soft">{form.employment_type} → paid as <Txt size={12.5} w={700}>{comp.label.toLowerCase()}</Txt>, quoted <Txt size={12.5} w={700}>{perLabel(comp.period)}</Txt></Txt></InfoBox>
      <SelectField label="Cost Center" value={form.cost_center} onChange={v => set('cost_center', v)} options={masterOpts(refs.masters.cost_center || [], 'Select…')} />
      <SelectField label="Budgeted Position" value={form.is_budgeted} onChange={v => set('is_budgeted', v)} options={notSpec('Yes — budgeted', 'No — unbudgeted')} />
      <TextField label="Approved Headcount Ref." value={form.headcount_ref} onChange={v => set('headcount_ref', v)} placeholder="e.g. HCP-2026-014" />
      <TextField label="Headcount — Sanctioned" hint="For this department / location" numeric value={form.headcount_sanctioned} onChange={v => set('headcount_sanctioned', v)} />
      <TextField label="Headcount — Actual" hint="On roll today" numeric value={form.headcount_actual} onChange={v => set('headcount_actual', v)} />
      <TextField label="Headcount — Open" hint="Already open, this one included" numeric value={form.headcount_open} onChange={v => set('headcount_open', v)} />
      <SelectField label="Currency" value={form.currency} onChange={v => set('currency', v)} options={masterOpts(refs.masters.currency || [], 'INR', true)} />
      <TextField label={`${comp.label} Range — Min`} hint={perLabel(comp.period)} numeric value={form.budget_min} onChange={v => set('budget_min', v)} placeholder={comp.ph[0]} />
      <TextField label={`${comp.label} Range — Max`} hint={perLabel(comp.period)} numeric value={form.budget_max} onChange={v => set('budget_max', v)} placeholder={comp.ph[1]} error={bad} />
      {bad && (
        <View style={{ backgroundColor: C.criticalTint, borderRadius: 7, padding: 10, marginBottom: S.md }}>
          <Txt size={F.tiny} tone="critical">Minimum cannot be more than maximum — please correct the {comp.label.toLowerCase()} range.</Txt>
        </View>
      )}
      <SelectField label="Worker / Skill Category" hint="Sets the state minimum wage applied in salary negotiation" value={form.wage_category} onChange={v => set('wage_category', v)}
        options={[{ value: '', label: 'Select category…' }, ...optsOf(WAGE_CATS as string[])]} />
      {(comp.fixedTerm || comp.period === 'MONTHLY') && (
        <TextField label="Duration (months)" numeric value={form.duration_months} onChange={v => set('duration_months', v)} />
      )}
      <TextField label="Variable Pay (%)" numeric value={form.variable_percentage} onChange={v => set('variable_percentage', v)}
        hint={form.variable_percentage ? `Fixed is the remaining ${Math.max(0, 100 - (Number(form.variable_percentage) || 0))}%` : 'Fixed is the remainder'} />
      <TextField label="Budget Code" hint="The budget line this draws on — not the cost centre" value={form.budget_code} onChange={v => set('budget_code', v)} />

      <Sub>Allowances sanctioned for this role</Sub>
      <SelectField label="Joining Bonus" value={form.joining_bonus_allowed} onChange={v => set('joining_bonus_allowed', v)} options={notSpec('Allowed', 'Not allowed')} />
      <TextField label="Joining Bonus — Cap" hint="Ceiling, if allowed" numeric value={form.joining_bonus_cap} onChange={v => set('joining_bonus_cap', v)} disabled={form.joining_bonus_allowed === 'no'} />
      <SelectField label="Relocation Allowance" value={form.relocation_allowance_allowed} onChange={v => set('relocation_allowance_allowed', v)} options={notSpec('Allowed', 'Not allowed')} />
      <TextField label="Relocation — Cap" hint="Ceiling, if allowed" numeric value={form.relocation_allowance_cap} onChange={v => set('relocation_allowance_cap', v)} disabled={form.relocation_allowance_allowed === 'no'} />
      <SelectField label="Notice Buyout" value={form.notice_buyout_allowed} onChange={v => set('notice_buyout_allowed', v)} options={notSpec('Allowed', 'Not allowed')} />
      <TextField label="Notice Buyout — Cap" hint="Ceiling, if allowed" numeric value={form.notice_buyout_cap} onChange={v => set('notice_buyout_cap', v)} disabled={form.notice_buyout_allowed === 'no'} />
      <SelectField label="ESOP / Retention" hint="Senior roles" value={form.esop_eligible} onChange={v => set('esop_eligible', v)} options={notSpec('Eligible', 'Not eligible')} />
      <TextField label="ESOP / Retention — Detail" value={form.esop_retention_notes} onChange={v => set('esop_retention_notes', v)} placeholder="Units, vesting, retention terms" disabled={form.esop_eligible === 'no'} />

      <Sub>Closure — filled when the role is closed</Sub>
      <TextField label="Offered CTC" hint="Compare against the budgeted range above" numeric value={form.closure_offered_ctc} onChange={v => set('closure_offered_ctc', v)} />
      <DateField label="Actual Joining Date" value={form.closure_doj} onChange={v => set('closure_doj', v)} />
      <TextField label="Source" hint="Where the hire finally came from" value={form.closure_source} onChange={v => set('closure_source', v)} placeholder="e.g. Referral, Naukri, Agency" />

      <View style={{ marginTop: 14 }}>
        <LaneMeter minRupees={annualMin || null} maxRupees={annualMax || null} cap={QUICK_HIRE_CAP} lane={form.budget_max ? laneShouldBe : null} />
      </View>
    </>
  )
}

export function StepJustification({ form, set, refs }: StepProps) {
  const isReplacement = form.hiring_type === 'Replacement' || form.hiring_type === 'Backfill'
  return (
    <>
      <SectionLine n="5" title="Justification" />
      <SelectField label="Reason for Hire" value={form.reason} onChange={v => set('reason', v)} options={[{ value: '', label: 'Select Reason' }, ...optsOf(REASON_FOR_HIRE)]} />
      <SelectField label="Outgoing Employee" hint="Only for Replacement / Backfill" value={form.outgoing_employee_id} onChange={v => set('outgoing_employee_id', v)}
        options={[{ value: '', label: isReplacement ? 'Select Employee' : '— N/A —' }, ...(isReplacement ? refs.people.map(p => ({ value: p.id, label: `${p.full_name} (${p.emp_code})` })) : [])]} />
      <SelectField label="Reason for Exit" value={form.exit_reason} onChange={v => set('exit_reason', v)}
        options={masterOpts(isReplacement ? (refs.masters.separation_reason || []) : [], isReplacement ? 'Select Reason' : '— N/A —')} />
      <TextField label="Business Justification" multiline minHeight={80} value={form.business_justification} onChange={v => set('business_justification', v)}
        placeholder="Why this headcount is needed — business impact, workload, revenue linkage…" />
    </>
  )
}

export function StepTimeline({ form, set }: StepProps) {
  return (
    <>
      <SectionLine n="6" title="Timeline" />
      <DateField label="Target Joining Date" value={form.target_joining_date} onChange={v => set('target_joining_date', v)} />
      <DateField label="Requisition Validity / Expiry" hint="Auto-flagged as expired if unfilled past this date" value={form.validity_date} onChange={v => set('validity_date', v)} />
    </>
  )
}

export function StepCandidate({ form, set, refs, addSkill }: StepProps) {
  const edu = [{ value: '', label: 'Any' }, ...optsOf(EDUCATION_OPTIONS)]
  return (
    <>
      <SectionLine n="7" title="Candidate Requirements" />
      <TextField label="Total Experience — Min (years)" hint="All work experience" numeric value={form.experience_min} onChange={v => set('experience_min', v)} />
      <TextField label="Total Experience — Max (years)" hint="All work experience" numeric value={form.experience_max} onChange={v => set('experience_max', v)} />
      <SelectField label="Education — Minimum" value={form.education_min} onChange={v => set('education_min', v)} options={edu} />
      <SelectField label="Education — Maximum" value={form.education_max} onChange={v => set('education_max', v)} options={edu} />
      <SelectField label="Previous Company Preference" value={form.previous_company_preference} onChange={v => set('previous_company_preference', v)} options={PREV_COMPANY.map(([value, label]) => ({ value, label }))} />
      <TextField label="Relevant Experience — Min (years)" hint="In this kind of role, not total" numeric value={form.relevant_experience_min} onChange={v => set('relevant_experience_min', v)} />
      <TextField label="Relevant Experience — Max (years)" hint="In this kind of role, not total" numeric value={form.relevant_experience_max} onChange={v => set('relevant_experience_max', v)} />
      <TextField label="Specialisation" hint="Stream or branch within the qualification" value={form.specialisation} onChange={v => set('specialisation', v)} placeholder="e.g. Computer Science, Finance" />
      <TextField label="Certifications" value={form.certifications} onChange={v => set('certifications', v)} placeholder="e.g. PMP, CFA, AWS" />
      <TextField label="Industry Preference" value={form.industry_preference} onChange={v => set('industry_preference', v)} placeholder="e.g. BFSI, Manufacturing" />
      <TextField label="Target Companies" hint="Comma separated" value={form.target_companies} onChange={v => set('target_companies', v)} />
      <TextField label="Max Notice Period (days)" hint="Beyond this, the candidate is not workable" numeric value={form.max_notice_period_days} onChange={v => set('max_notice_period_days', v)} />
      <TextField label="Languages" hint="Comma separated" value={form.languages} onChange={v => set('languages', v)} placeholder="e.g. Hindi, English, Tamil" />
      <TextField label="Travel (%)" hint="Share of time on the road" numeric value={form.travel_percentage} onChange={v => set('travel_percentage', v)} />
      <SelectField label="Relocation Required" value={form.relocation_required} onChange={v => set('relocation_required', v)} options={notSpec('Yes', 'No')} />
      <SelectField label="Diversity Requisition" hint="Reserved for a diversity hire" value={form.diversity_flag} onChange={v => set('diversity_flag', v)} options={notSpec('Yes', 'No')} />
      <TextField label="Licence / Vehicle" hint="Field roles — driving licence, own vehicle" value={form.licence_requirement} onChange={v => set('licence_requirement', v)} placeholder="e.g. LMV licence + two-wheeler" />
      <TextField label="Role Summary" hint="What this role exists to do — two or three lines" multiline minHeight={70} value={form.role_summary} onChange={v => set('role_summary', v)} />
      <TextField label="KRAs" hint="What the role is measured on" multiline minHeight={70} value={form.kras} onChange={v => set('kras', v)} />
      <FieldLabel label="Mandatory Skills" />
      <SkillsPicker value={form.skills_required} onChange={v => set('skills_required', v)} allSkills={refs.skills} onAddSkill={addSkill} />
      <FieldLabel label="Good-to-have Skills" />
      <SkillsPicker value={form.good_to_have_skills} onChange={v => set('good_to_have_skills', v)} allSkills={refs.skills} onAddSkill={addSkill} placeholder="Search good-to-have skills, or add custom" />
      <TextField label="Job Description" multiline minHeight={120} value={form.job_description} onChange={v => set('job_description', v)} placeholder="Role summary, responsibilities, must-haves…" />
      <FieldLabel label="Questions to ask the candidate" />
      <Txt size={F.tiny} tone="faint" style={{ marginTop: -4, marginBottom: 6 }}>optional · every interviewer sees these on the feedback form</Txt>
      <QuestionsList value={form.ctq_questions || []} onChange={v => set('ctq_questions', v)} />
    </>
  )
}

export function StepApproval({ refs }: StepProps) {
  const a = refs.auto
  return (
    <>
      <SectionLine n="8" title="Approval Workflow" />
      <InfoBox>
        <Txt size={12.5} tone="muted">On submit this routes through your reporting chain, company-scoped:</Txt>
        <Txt size={12.5} w={500} style={{ marginTop: 4 }}>You ({a.code}) → RM2 {a.rm2 !== '—' ? `· ${a.rm2}` : '(if set)'} → HR Head</Txt>
      </InfoBox>
    </>
  )
}

export function StepSourcing({ form, set, refs }: StepProps) {
  return (
    <>
      <SectionLine n="9" title="Sourcing" />
      <SelectField label="Internal vs External" value={form.sourcing_mode} onChange={v => set('sourcing_mode', v)} options={optsOf(SOURCING_MODES)} />
      <TextField label="Agency / Vendor" value={form.agency_vendor} onChange={v => set('agency_vendor', v)} placeholder="Vendor name" />
      <TextField label="Agency Fee %" hint="Of annual CTC" numeric value={form.agency_fee_pct} onChange={v => set('agency_fee_pct', v)} />
      <TextField label="Exclusivity (days)" hint="How long the vendor holds the role alone" numeric value={form.agency_exclusivity_days} onChange={v => set('agency_exclusivity_days', v)} />
      <TextField label="Candidate Ownership (days)" hint="How long their claim on a submitted candidate lasts" numeric value={form.agency_ownership_days} onChange={v => set('agency_ownership_days', v)} />
      <FieldLabel label="Preferred Sourcing Channels" />
      <ChannelPicker value={form.sourcing_channels || []} onChange={v => set('sourcing_channels', v)} opts={refs.masters.candidate_source || []} />
    </>
  )
}

export function StepAttachments(_: StepProps) {
  return (
    <>
      <SectionLine n="10" title="Attachments" />
      <Txt size={F.tiny} tone="faint">Files can be attached from the Recruitment module once the MRF is created.</Txt>
    </>
  )
}

/** The lane toggle at the top (Quick Hire / Full MRF). */
export function LaneToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 4, borderWidth: 1, borderColor: C.line, backgroundColor: C.sunken, borderRadius: 13, padding: 4 }}>
      {(['Quick Hire', 'Full MRF'] as const).map(t => {
        const on = value === t
        return (
          <Pressable key={t} onPress={() => onChange(t)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: on ? C.brand : 'transparent' }}>
            <Txt size={F.tiny} w={600} color={on ? C.onAccent : C.muted} center>{t} ({t === 'Quick Hire' ? 'CTC ≤ ₹6L' : 'CTC > ₹6L'})</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
