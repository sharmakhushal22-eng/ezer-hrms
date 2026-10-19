// lib/onboarding/to-employee.ts
// Bridge: turn a completed onboarding candidate into a master `employees` row.
// Reads from onboarding_candidates (form_data jsonb + meta), maps to the REAL
// employees columns, with the field renames/splits/FK-lookup the two schemas need.
// Idempotent (skips if emp_code already exists). Maps parents, spouse, permanent +
// residential addresses, emergency contacts and Aadhaar last-4 (these columns exist
// on employees and were previously — incorrectly — skipped).
//
// Pass a Supabase client (the API route passes its service-role/anon client).

import { trackOf, frroDueDate } from './hiring-track'

export interface SyncResult {
  ok?: boolean
  skipped?: boolean
  employee_id?: string
  dept_matched?: boolean
  error?: string
}

export async function onboardingToEmployee(supa: any, onboardingId: string, employeeCode: string): Promise<SyncResult> {
  const { data: oc } = await supa.from('onboarding_candidates')
    .select('company_id, location_id, department_id, designation, department, full_name, email, mobile, date_of_joining, employment_type, esic_applicable, form_data, grade, l1_manager_id, l2_manager_id, hod_id, it_email, tds_regime, pf_wage_type, pf_applicable, pt_state, lwf_applicable, cost_centre, shift_id, induction_date, team_name, work_location_type, hiring_track, work_country, payroll_currency, employing_entity, pf_international_worker, ssa_exempt, pan_pending, paid_outside_india, frro_done, visa_checked, contract_signed')
    .eq('id', onboardingId).maybeSingle()
  if (!oc) return { error: 'onboarding record not found' }

  // Idempotent — if an employee with this code already exists, don't duplicate.
  const { data: existing } = await supa.from('employees').select('id').eq('emp_code', employeeCode).maybeSingle()
  if (existing) {
    await supa.from('onboarding_candidates').update({ employee_id: existing.id }).eq('id', onboardingId)
    return { ok: true, skipped: true, employee_id: existing.id }
  }

  const f = oc.form_data || {}
  const track = trackOf(oc.hiring_track)
  // Inter-company transfer: carry the group DOJ forward from the 1st company (seniority/gratuity).
  const isTransfer = f.is_transfer === true
  const groupDoj = (isTransfer && f.group_doj_carry) ? f.group_doj_carry : (oc.date_of_joining || null)
  const p = f.step_3 || {}   // personal
  const ct = f.step_4 || {}  // contact
  const em = f.step_5 || {}  // emergency + prev employment
  const st = f.step_7 || {}  // statutory + bank
  const insr = st.insurance || {}

  const orNull = (v: any) => (v === '' || v === undefined || v === null) ? null : v
  const pin = (v: any) => { const d = String(v ?? '').replace(/\D/g, ''); return d || null }
  // Previous company = most recent prior employer (latest to_date, else first listed).
  const join = (...xs: any[]) => { const s = xs.filter(Boolean).join(', ').trim(); return s || null }
  // Residential = current address; if "same as permanent" was ticked, mirror the permanent block.
  const sameAddr = ct.same_address === true
  const resLine1 = sameAddr ? ct.perm_line1 : ct.curr_line1
  const resCity = sameAddr ? ct.perm_city : ct.curr_city
  const resState = sameAddr ? ct.perm_state : ct.curr_state
  const resPin = sameAddr ? ct.perm_pin : ct.curr_pin

  const fullName = p.full_name || oc.full_name || ''
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] || fullName
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : ''

  // Gap D — department FK. Prefer the explicit department_id (set from the masters
  // dropdown); else fall back to a name lookup. Null + flag if neither resolves.
  let departmentId: string | null = oc.department_id || null
  let deptMatched = !!departmentId
  if (!departmentId && oc.department) {
    const { data: d } = await supa.from('departments').select('id')
      .ilike('dept_name', oc.department).eq('company_id', oc.company_id).maybeSingle()
    if (d?.id) { departmentId = d.id; deptMatched = true }
  }

  const bankAcc = st.bank_account ? String(st.bank_account) : ''
  const edu: any[] = Array.isArray(em.education) ? em.education : []
  const highest = [...edu].reverse().find(e => e && (e.institute || e.year))

  const row: any = {
    // identity / org
    emp_code:        employeeCode,
    common_code:     employeeCode,                 // same as emp_code (per sync doc default)
    company_id:      oc.company_id,
    location_id:     oc.location_id || null,
    department_id:   departmentId,
    // personal (Gap A renames: dob→date_of_birth)
    full_name:       fullName,
    first_name:      firstName,
    last_name:       lastName,
    gender:          p.gender || null,
    date_of_birth:   p.dob || null,
    blood_group:     p.blood_group || null,
    marital_status:  p.marital_status || null,
    // parents / spouse / demographics (columns exist on employees — previously skipped)
    father_name:     orNull(p.father_name),
    mother_name:     orNull(p.mother_name),
    nationality:     orNull(p.nationality) || 'Indian',
    religion:        orNull(p.religion),
    spouse_name:     orNull(insr.spouse_name),
    spouse_dob:      orNull(insr.spouse_dob),
    aadhar_last4:    orNull(st.aadhaar_last4 || f.aadhaar_last4),
    birth_place:     orNull(p.birth_place),
    // other government IDs (optional on the form)
    passport_no:     orNull(st.passport_no || st.fe_passport_number),
    voter_id:        orNull(st.voter_id),
    driving_licence: orNull(st.driving_licence),
    // existing PF member: the UAN carried forward, and the ESIC IP number if they had one
    pf_existing_member: st.has_uan === true ? true : null,
    previous_uan:    st.has_uan ? orNull(st.uan_number) : null,
    esic_number:     orNull(st.esic_details?.prev_ip),
    esic_dispensary: orNull(st.esic_details?.dispensary),
    // highest qualification: the last education row the candidate filled in
    highest_qualification: highest?.qualification || null,
    institution_name: highest?.institute || null,
    // employment (doj→company_doj + group_doj)
    designation:     oc.designation || null,
    employment_type: oc.employment_type || 'Employee',
    employment_status:   'Active',
    confirmation_status: 'Probation',
    company_doj:     oc.date_of_joining || null,
    group_doj:       groupDoj,
    // contact
    mobile:          ct.mobile || oc.mobile || null,
    alternate_mobile: orNull(ct.alt_mobile),
    personal_email:  ct.personal_email || oc.email || null,
    // permanent address
    perm_address1:   orNull(ct.perm_line1),
    perm_address2:   join(ct.perm_village, ct.perm_po, ct.perm_thana, ct.perm_sub_division, ct.perm_district),
    perm_city:       orNull(ct.perm_city),
    perm_state:      orNull(ct.perm_state),
    perm_pin:        pin(ct.perm_pin),
    perm_country:    orNull(p.country) || 'India',
    // residential / current address (mirrors permanent if "same" ticked)
    res_address1:    orNull(resLine1),
    res_city:        orNull(resCity),
    res_state:       orNull(resState),
    res_pin:         pin(resPin),
    res_country:     'India',
    // emergency contacts (from step 5)
    emergency_name:      orNull(em.emrg1_name),
    emergency_relation:  orNull(em.emrg1_relation),
    emergency_mobile:    orNull(em.emrg1_mobile),
    emergency2_name:     orNull(em.emrg2_name),
    emergency2_relation: orNull(em.emrg2_relation),
    emergency2_mobile:   orNull(em.emrg2_mobile),
    // statutory / bank (bank_ifsc→ifsc_code; bank_account→last4 only, no plaintext)
    pan_number:      st.pan_number || null,
    uan_number:      st.uan_number || null,
    esic_applicable: track === 'OVERSEAS' ? false : (oc.esic_applicable ?? null),
    bank_name:       st.bank_name || null,
    bank_account_last4: bankAcc ? bankAcc.slice(-4) : null,
    ifsc_code:       st.bank_ifsc || null,
    account_type:    st.account_type || null,
    // ── HR activation wizard fields ──
    grade:                  oc.grade || null,
    l1_manager_id:          oc.l1_manager_id || null,   // employees.l1_manager_id (there is no reporting_manager_id column)
    l2_manager_id:          oc.l2_manager_id || null,
    hod_id:                 oc.hod_id || null,           // Assign managers on the review sheet
    office_email:           oc.it_email || null,         // the official email IT confirmed on their checklist
    // ── Hiring track (lib/onboarding/hiring-track.ts): the immigration facts the candidate typed and what the heads confirmed ──
    hiring_track:           track,
    work_country:           oc.work_country || (track === 'OVERSEAS' ? null : 'India'),
    payroll_currency:       oc.payroll_currency || (track === 'OVERSEAS' ? null : 'INR'),
    employing_entity:       oc.employing_entity || null,
    paid_outside_india:     track === 'OVERSEAS' ? oc.paid_outside_india !== false : false,
    passport_country:       orNull(st.fe_passport_country),
    passport_expiry:        orNull(st.fe_passport_expiry),
    visa_type:              orNull(st.fe_visa_type),
    visa_number:            orNull(st.fe_visa_number),
    visa_expiry:            orNull(st.fe_visa_expiry),
    work_permit_number:     orNull(st.fe_work_permit_number),
    work_permit_expiry:     orNull(st.fe_work_permit_expiry),
    india_entry_date:       orNull(st.fe_india_entry_date),
    frro_number:            orNull(st.fe_frro_number),
    frro_date:              orNull(st.fe_frro_date) || (oc.frro_done === true ? (oc.date_of_joining || null) : null),
    frro_due_date:          track === 'FOREIGN_IN_INDIA' ? frroDueDate(st.fe_india_entry_date || oc.date_of_joining) : null,
    tax_residency_status:   orNull(st.fe_tax_residency),
    tax_residency_country:  orNull(st.fe_tax_country),
    foreign_tin:            orNull(st.fe_foreign_tin),
    local_tax_id:           orNull(st.local_tax_id),
    pan_pending:            oc.pan_pending === true || st.pan_applied === true,
    international_employee: track === 'FOREIGN_IN_INDIA' ? (oc.pf_international_worker === true || oc.ssa_exempt !== true) : (track === 'OVERSEAS' ? null : false),
    certificate_of_coverage: orNull(st.fe_ssa_coc),
    ssa_country:            orNull(st.fe_ssa_country),
    ssa_coc_expiry:         orNull(st.fe_ssa_coc_expiry),
    bank_iban:              orNull(st.bank_iban),
    bank_swift:             orNull(st.bank_swift),
    bank_country:           orNull(st.bank_country),
    // An overseas employee is outside Indian statutory altogether; a foreign national in India is
    // in PF (as an International Worker) unless the SSA certificate exempts them.
    tds_regime:             track === 'OVERSEAS' ? null : (oc.tds_regime || 'NEW'),
    pf_wage_type:           oc.pf_wage_type || 'BASIC_DA',
    pf_applicable:          track === 'OVERSEAS' ? false : track === 'FOREIGN_IN_INDIA' ? oc.ssa_exempt !== true : (oc.pf_applicable ?? true),
    professional_tax_state: track === 'OVERSEAS' ? null : (oc.pt_state || null),
    lwf_applicable:         track === 'OVERSEAS' ? false : (oc.lwf_applicable ?? false),
    cost_centre:            oc.cost_centre || null,
    induction_date:         oc.induction_date || null,
    team_name:              oc.team_name || null,
    work_location_type:     oc.work_location_type || 'Office',
    // previous employer: employees has no previous_company column — it lives in employee_experience (below)
  }

  const { data: ins, error } = await supa.from('employees').insert(row).select('id').single()
  if (error) return { error: error.message, dept_matched: deptMatched }

  const empId = ins.id

  // ── Auto shift assignment from the activation wizard (non-fatal) ──
  if (oc.shift_id) {
    try {
      const sa: any = { employee_id: empId, shift_id: oc.shift_id, assigned_by: 'HR Activation', is_active: true }
      if (oc.date_of_joining) sa.effective_from = oc.date_of_joining
      await supa.from('employee_shift_assignment').insert(sa)
      const { data: sh } = await supa.from('shift_master').select('shift_code').eq('id', oc.shift_id).maybeSingle()
      if (sh?.shift_code) await supa.from('employees').update({ shift_type: sh.shift_code }).eq('id', empId)
    } catch { /* shift assignment is best-effort */ }
  }

  // ── Populate child tables (education / experience / family) from form_data ──
  // Non-fatal: a child-insert failure must not undo the created employee.
  try {
    const edu = (f.step_5?.education || []).filter((e: any) => e.qualification || e.institute)
    if (edu.length) await supa.from('employee_education').insert(edu.map((e: any) => ({
      employee_id: empId, qualification: e.qualification || null, institute: e.institute || null,
      year_of_passing: e.year || null, doc_name: e.docName || null,
    })))

    const exp = (f.step_5?.prev_employers || []).filter((p: any) => p.company)
    // from/to arrive as "YYYY-MM" from a month picker; the column is a date, and a bad
    // value used to fail the whole (non-fatal) insert and silently drop every employer.
    const asDate = (v: any) => { const t = String(v || '').trim(); return /^\d{4}-\d{2}$/.test(t) ? `${t}-01` : (t || null) }
    if (exp.length) await supa.from('employee_experience').insert(exp.map((p: any) => ({
      employee_id: empId, company: p.company || null, designation: p.designation || null,
      from_date: asDate(p.from), to_date: asDate(p.to), reason_for_change: p.reason || null,
    })))

    const ins0 = st.insurance || {}
    const fam: any[] = []
    if (ins0.spouse_name) fam.push({ relation: 'Spouse', name: ins0.spouse_name, date_of_birth: ins0.spouse_dob || null, residing_with_emp: ins0.spouse_residing === 'Yes' })
    if (ins0.father_name) fam.push({ relation: 'Father', name: ins0.father_name, date_of_birth: ins0.father_dob || null, residing_with_emp: ins0.father_residing === 'Yes' })
    if (ins0.mother_name) fam.push({ relation: 'Mother', name: ins0.mother_name, date_of_birth: ins0.mother_dob || null, residing_with_emp: ins0.mother_residing === 'Yes' })
    if (ins0.kid1_name) fam.push({ relation: 'Child', name: ins0.kid1_name, date_of_birth: ins0.kid1_dob || null, residing_with_emp: true })
    if (ins0.kid2_name) fam.push({ relation: 'Child', name: ins0.kid2_name, date_of_birth: ins0.kid2_dob || null, residing_with_emp: true })
    if (fam.length) await supa.from('employee_family').insert(fam.map(x => ({ ...x, employee_id: empId, is_dependent: true })))
  } catch (e) { /* child tables are best-effort */ }

  // Link onboarding ↔ employee so the employee drawer's Onboarding/Salary/Documents
  // tabs (which query by employee_id) populate.
  await supa.from('onboarding_candidates').update({ employee_id: empId }).eq('id', onboardingId)

  // Inter-company transfer: complete the transfer record + link the new employee row.
  if (isTransfer) {
    try {
      await supa.from('employee_transfer').update({
        new_employee_id: empId, to_emp_code: employeeCode,
        status: 'COMPLETED', completed_at: new Date().toISOString(),
      }).eq('onboarding_id', onboardingId)
    } catch { /* non-fatal */ }
  }

  return { ok: true, employee_id: empId, dept_matched: deptMatched }
}
