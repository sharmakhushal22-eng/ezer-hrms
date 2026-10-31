// lib/letters/facts.ts — SERVER ONLY. Everything People → Letters fills in from the records for
// one employee: the employee master, their company, department, location and reporting
// manager, the payroll CTC master, their resignation / company exit and the F&F settlement.
// The keys are the field keys of lib/letters/catalog.ts; a value the records do not hold is
// left out, and the form asks HR for it.
import type { Values } from './catalog'

const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); if (isNaN(d.getTime())) return ''; d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); if (isNaN(d.getTime())) return ''; d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
/** A value, trimmed; a placeholder of dots or dashes ("........", "--") is no value. */
const s = (v: any) => { const t = v == null ? '' : String(v).trim(); return /^[.\-_\s]*$/.test(t) ? '' : t }

export interface EmployeeFacts {
  values: Values
  employee: { id: string; full_name: string; emp_code: string | null; company_id: string | null; email: string | null; designation: string | null; status: string | null }
  company: any
  /** The onboarding record (when there is one): the appointment letter is drawn from it. */
  onboardingId: string | null
}

export async function employeeFacts(sb: any, employeeId: string): Promise<EmployeeFacts | null> {
  const { data: e } = await sb.from('employees').select('*').eq('id', employeeId).maybeSingle()
  if (!e) return null
  const [{ data: company }, { data: dept }, { data: loc }, { data: mgr }, { data: cm }, { data: res }, { data: hx }, { data: oc }] = await Promise.all([
    e.company_id ? sb.from('companies').select('*').eq('id', e.company_id).maybeSingle() : Promise.resolve({ data: null }),
    e.department_id ? sb.from('departments').select('dept_name').eq('id', e.department_id).maybeSingle() : Promise.resolve({ data: null }),
    e.location_id ? sb.from('locations').select('location_name, city, address_line1, address_line2, state, pin_code').eq('id', e.location_id).maybeSingle() : Promise.resolve({ data: null }),
    e.l1_manager_id ? sb.from('employees').select('full_name, emp_code, designation').eq('id', e.l1_manager_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('ctc_master').select('annual_ctc').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('employee_resignation').select('id, date_of_resignation, final_lwd, lwd_as_per_policy, notice_period_days, reason_code, status, exit_reason_master(label)').eq('employee_id', employeeId).neq('status', 'WITHDRAWN').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('hr_exit_requests').select('reason_label, sub_reason, last_working_day, status').eq('employee_id', employeeId).in('status', ['PENDING', 'APPROVED']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('onboarding_candidates').select('id, annual_ctc, offered_ctc, candidate_id, designation, department, department_id, location_id').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  // Joiners whose employee record was left without the role, department or location: the
  // requisition and the offer letter they were hired against carry them (as the appointment
  // letter reads them, lib/onboarding/appointment-letter-server.ts).
  const { data: cand } = oc?.candidate_id ? await sb.from('candidates').select('mrf_id, designation').eq('id', oc.candidate_id).maybeSingle() : { data: null as any }
  const [{ data: mrf }, { data: ol }] = await Promise.all([
    cand?.mrf_id ? sb.from('manpower_requisitions').select('department_id, location_id, job_title, position, designation').eq('id', cand.mrf_id).maybeSingle() : Promise.resolve({ data: null }),
    oc?.candidate_id ? sb.from('offer_letters').select('designation, department, location').eq('candidate_id', oc.candidate_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const deptId2 = !e.department_id ? (oc?.department_id || (mrf as any)?.department_id || null) : null
  const locId2 = !e.location_id ? (oc?.location_id || (mrf as any)?.location_id || null) : null
  const [{ data: dept2 }, { data: loc2 }] = await Promise.all([
    deptId2 ? sb.from('departments').select('dept_name').eq('id', deptId2).maybeSingle() : Promise.resolve({ data: null }),
    locId2 ? sb.from('locations').select('location_name, city, address_line1, address_line2, state, pin_code').eq('id', locId2).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const place: any = loc || loc2
  const { data: fnf } = res?.id ? await sb.from('fnf_settlements').select('earnings, deductions, net_payable, paid_at').eq('resignation_id', res.id).maybeSingle() : { data: null as any }

  const doj = s(e.company_doj || e.date_of_appointment || e.group_doj).slice(0, 10)
  const probation = Number(e.probation_months) || (Number(company?.probation_days) ? Math.round(Number(company.probation_days) / 30) : 6)
  const lwd = s(e.last_working_date || res?.final_lwd || hx?.last_working_day || res?.lwd_as_per_policy).slice(0, 10)
  const ctc = Number(cm?.annual_ctc) || Number(oc?.annual_ctc) || Number(oc?.offered_ctc) || 0
  const lines = (list: any) => (Array.isArray(list) ? list : []).filter((l: any) => Number(l.amount)).map((l: any) => `${l.label} = ${Math.round(Number(l.amount))}`).join('\n')
  const salutation = s(e.salutation).replace(/\.?$/, '.').replace(/^\.$/, '') || (/^f/i.test(s(e.gender)) ? 'Ms.' : 'Mr.')
  const today = new Date().toISOString().slice(0, 10)

  const v: Values = {
    salutation,
    name: s(e.full_name),
    emp_code: s(e.emp_code),
    designation: s(e.designation) || s(e.business_designation) || s(oc?.designation) || s((ol as any)?.designation) || s(cand?.designation) || s((mrf as any)?.job_title) || s((mrf as any)?.designation) || s((mrf as any)?.position),
    department: s(dept?.dept_name) || s((dept2 as any)?.dept_name) || s(oc?.department) || s((ol as any)?.department),
    grade: s(e.grade || e.band),
    company_name: s(company?.company_name),
    office_address: [place?.address_line1, place?.address_line2, place?.city, place?.state, place?.pin_code].map(s).filter(Boolean).join(', ') || s(company?.corp_office) || s(company?.reg_office),
    father_name: s(e.father_name) || s(e.spouse_name),
    doj,
    location: s(place?.city) || s(place?.location_name) || s((ol as any)?.location),
    reporting_manager: mgr ? `${mgr.full_name}${mgr.designation ? `, ${mgr.designation}` : ''}` : s(e.reporting_manager),
    employment_type: s(e.employment_type),
    ctc_annual: ctc ? String(Math.round(ctc)) : '',
    previous_ctc: ctc ? String(Math.round(ctc)) : '',
    probation_months: String(probation),
    notice_days: String(Number(company?.notice_period_days) || 60),
    confirmation_date: s(e.confirmation_date).slice(0, 10) || (doj ? addMonths(doj, probation) : ''),
    effective_date: today,
    lwd,
    relieving_date: lwd ? addDays(lwd, 1) : '',
    resignation_date: s(res?.date_of_resignation || e.date_of_resignation).slice(0, 10),
    uan: s(e.uan_number),
    pf_number: s(e.pf_number || e.pf_account_number),
    bank: [s(e.bank_name), e.bank_account_last4 ? `A/c XXXX${e.bank_account_last4}` : '', s(e.ifsc_code)].filter(Boolean).join(' · '),
    // The company's courts: the appointment letter's default (lib/onboarding/appointment-letter-server).
    jurisdiction: 'Gurugram',
    appeal_to: 'HR Head',
    exit_reason: s(hx?.reason_label ? `${hx.reason_label}${hx.sub_reason ? ` · ${hx.sub_reason}` : ''}` : (res as any)?.exit_reason_master?.label || (res ? 'Resignation' : '')),
    earnings: lines(fnf?.earnings),
    deductions: lines(fnf?.deductions),
    payment_date: s(fnf?.paid_at).slice(0, 10),
  }
  for (const k of Object.keys(v)) if (!v[k]) delete v[k]
  return {
    values: v,
    employee: { id: e.id, full_name: e.full_name, emp_code: e.emp_code, company_id: e.company_id, email: e.office_email || e.personal_email || null, designation: e.designation, status: e.employment_status },
    company,
    onboardingId: oc?.id || null,
  }
}
