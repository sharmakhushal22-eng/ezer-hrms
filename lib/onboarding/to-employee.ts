// lib/onboarding/to-employee.ts
// Bridge: turn a completed onboarding candidate into a master `employees` row.
// Reads from onboarding_candidates (form_data jsonb + meta), maps to the REAL,
// verified employees columns only, with the field renames/splits/FK-lookup the
// two schemas need. Idempotent (skips if emp_code already exists). Non-destructive:
// fields that don't exist on `employees` (father_name, addresses, emergency,
// encryption) are intentionally skipped — see the sync doc.
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
    .select('company_id, location_id, designation, department, full_name, email, mobile, date_of_joining, employment_type, esic_applicable, form_data')
    .eq('id', onboardingId).maybeSingle()
  if (!oc) return { error: 'onboarding record not found' }

  // Idempotent — if an employee with this code already exists, don't duplicate.
  const { data: existing } = await supa.from('employees').select('id').eq('emp_code', employeeCode).maybeSingle()
  if (existing) {
    await supa.from('onboarding_candidates').update({ employee_id: existing.id }).eq('id', onboardingId)
    return { ok: true, skipped: true, employee_id: existing.id }
  }

  const f = oc.form_data || {}
  const p = f.step_3 || {}   // personal
  const ct = f.step_4 || {}  // contact
  const st = f.step_7 || {}  // statutory + bank

  const fullName = p.full_name || oc.full_name || ''
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] || fullName
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : ''

  // Gap D — department name (text) → departments.id (UUID FK). Leave null if no match.
  let departmentId: string | null = null
  let deptMatched = false
  if (oc.department) {
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
    // employment (doj→company_doj + group_doj)
    designation:     oc.designation || null,
    employment_type: oc.employment_type || 'Employee',
    employment_status:   'Active',
    confirmation_status: 'Probation',
    company_doj:     oc.date_of_joining || null,
    group_doj:       oc.date_of_joining || null,
    // contact
    mobile:          ct.mobile || oc.mobile || null,
    personal_email:  ct.personal_email || oc.email || null,
    // statutory / bank (bank_ifsc→ifsc_code; bank_account→last4 only, no plaintext)
    pan_number:      st.pan_number || null,
    uan_number:      st.uan_number || null,
    esic_applicable: oc.esic_applicable ?? null,
    bank_name:       st.bank_name || null,
    bank_account_last4: bankAcc ? bankAcc.slice(-4) : null,
    ifsc_code:       st.bank_ifsc || null,
    account_type:    st.account_type || null,
  }

  const { data: ins, error } = await supa.from('employees').insert(row).select('id').single()
  if (error) return { error: error.message, dept_matched: deptMatched }

  // Link onboarding ↔ employee so the employee drawer's Onboarding/Salary/Documents
  // tabs (which query by employee_id) populate.
  await supa.from('onboarding_candidates').update({ employee_id: ins.id }).eq('id', onboardingId)

  return { ok: true, employee_id: ins?.id, dept_matched: deptMatched }
}
