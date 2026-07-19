// lib/onboarding/to-employee.ts
// Bridge: turn a completed onboarding candidate into a master `employees` row.
// Reads from onboarding_candidates (form_data jsonb + meta), maps to the REAL
// employees columns, with the field renames/splits/FK-lookup the two schemas need.
// Idempotent (skips if emp_code already exists). Maps parents, spouse, permanent +
// residential addresses, emergency contacts and Aadhaar last-4 (these columns exist
// on employees and were previously — incorrectly — skipped).
//
// Pass a Supabase client (the API route passes its service-role/anon client).

export interface SyncResult {
  ok?: boolean
  skipped?: boolean
  employee_id?: string
  dept_matched?: boolean
  error?: string
}

export async function onboardingToEmployee(supa: any, onboardingId: string, employeeCode: string): Promise<SyncResult> {
  const { data: oc } = await supa.from('onboarding_candidates')
    .select('company_id, location_id, department_id, designation, department, full_name, email, mobile, date_of_joining, employment_type, esic_applicable, form_data, grade, l1_manager_id, tds_regime, pf_wage_type, pf_applicable, pt_state, lwf_applicable, cost_centre, shift_id, induction_date, team_name, work_location_type')
    .eq('id', onboardingId).maybeSingle()
  if (!oc) return { error: 'onboarding record not found' }

  // Idempotent — if an employee with this code already exists, don't duplicate.
  const { data: existing } = await supa.from('employees').select('id').eq('emp_code', employeeCode).maybeSingle()
  if (existing) {
    await supa.from('onboarding_candidates').update({ employee_id: existing.id }).eq('id', onboardingId)
    return { ok: true, skipped: true, employee_id: existing.id }
  }

  const f = oc.form_data || {}
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
  const prevCompany = (() => {
    const emps = (em.prev_employers || []).filter((p: any) => p && p.company)
    if (!emps.length) return em.prev_company || null
    const sorted = [...emps].sort((a: any, b: any) => String(b.to || '').localeCompare(String(a.to || '')))
    return sorted[0].company || null
  })()
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
    esic_applicable: oc.esic_applicable ?? null,
    bank_name:       st.bank_name || null,
    bank_account_last4: bankAcc ? bankAcc.slice(-4) : null,
    ifsc_code:       st.bank_ifsc || null,
    account_type:    st.account_type || null,
    // ── HR activation wizard fields ──
    grade:                  oc.grade || null,
    reporting_manager_id:   oc.l1_manager_id || null,
    tds_regime:             oc.tds_regime || 'NEW',
    pf_wage_type:           oc.pf_wage_type || 'BASIC_DA',
    pf_applicable:          oc.pf_applicable ?? true,
    professional_tax_state: oc.pt_state || null,
    lwf_applicable:         oc.lwf_applicable ?? false,
    cost_centre:            oc.cost_centre || null,
    induction_date:         oc.induction_date || null,
    team_name:              oc.team_name || null,
    work_location_type:     oc.work_location_type || 'Office',
    previous_company:       prevCompany,
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
    if (exp.length) await supa.from('employee_experience').insert(exp.map((p: any) => ({
      employee_id: empId, company: p.company || null, designation: p.designation || null,
      from_date: p.from || null, to_date: p.to || null, reason_for_change: p.reason || null,
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
