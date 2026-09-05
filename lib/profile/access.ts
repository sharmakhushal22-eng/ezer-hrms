import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { EditState, ProfileField, ProfileTab, ProfilePayload, ViewerRole } from './types';

/** Service-role client. Server only — never import this into a client component. */
export function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Who is looking. Reads the Supabase auth session and maps it to an employee row.
 * Dev fallback: x-employee-code header or ezer_emp cookie, so the page works
 * before auth is wired. Delete the fallback before go-live.
 */
export async function getViewerId(headerCode?: string | null): Promise<string | null> {
  const db = svc();

  const jar = await cookies();
  const authed = jar.get('sb-access-token')?.value;
  if (authed) {
    const { data } = await db.auth.getUser(authed);
    if (data?.user) {
      const { data: emp } = await db
        .from('employees').select('id').eq('auth_user_id', data.user.id).maybeSingle();
      if (emp) return emp.id as string;
    }
  }

  const code = headerCode ?? jar.get('ezer_emp')?.value;
  if (code) {
    const { data: emp } = await db
      .from('employees').select('id').eq('employee_code', code).maybeSingle();
    if (emp) return emp.id as string;
  }
  return null;
}

export async function resolveEmployeeId(code?: string): Promise<string | null> {
  if (!code) return null;
  const { data } = await svc()
    .from('employees').select('id').eq('employee_code', code).maybeSingle();
  return (data?.id as string) ?? null;
}

/** Calls the masking RPC. This is the only read path for profile data. */
export async function loadProfile(employeeId: string, viewerId: string): Promise<ProfilePayload> {
  const { data, error } = await svc()
    .rpc('get_employee_profile', { p_employee_id: employeeId, p_viewer_id: viewerId });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as ProfilePayload;
}

const RANK: Record<string, number> = { peer: 0, self: 1, manager: 2, hr: 3 };
export const can = (viewer: ViewerRole, min: string) => (RANK[viewer] ?? 0) >= (RANK[min] ?? 1);

const fmtDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const money = (v: unknown) =>
  v == null ? null : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const yn = (v: unknown) => (v == null ? null : v ? 'Yes' : 'No');

type Def = [
  key: string, label: string, value: unknown, state: EditState, column: string,
  opts?: Partial<Pick<ProfileField, 'mono' | 'masked' | 'wide' | 'hint' | 'routeTo'>> & { min?: string }
];

/**
 * Builds every tab from the payload. Field metadata mirrors profile_field_config
 * in migration 085; the DB copy is what approvals and routing read, this copy is
 * what renders. Keep the two in step when you add a field.
 */
export function buildTabs(p: ProfilePayload): ProfileTab[] {
  const e = p.employee as any;
  const role = p.viewer_role;

  const mk = (defs: Def[]): ProfileField[] =>
    defs.map(([key, label, value, state, column, o = {}]) => {
      const restricted = o.min ? !can(role, o.min) : false;
      return {
        key, label, state, column,
        value: restricted ? null : (value == null || value === '' ? '—' : String(value)),
        mono: o.mono, masked: o.masked, wide: o.wide,
        hint: o.hint ?? null, routeTo: o.routeTo ?? null, restricted,
      };
    });

  return [
    {
      key: 'personal', label: 'Personal',
      groups: [
        { title: 'Identity', fields: mk([
          ['full_name', 'Full name', e.full_name, 'locked', 'employees.full_name'],
          ['display_name', 'Preferred name', e.display_name, 'direct', 'employees.display_name'],
          ['employee_code', 'Employee code', e.employee_code, 'locked', 'employees.employee_code', { mono: true }],
          ['date_of_birth', 'Date of birth', fmtDate(e.date_of_birth), 'locked', 'employees.date_of_birth',
            { hint: e.age_years ? `Age ${e.age_years}` : null }],
          ['gender', 'Gender', e.gender, 'locked', 'employees.gender'],
          ['blood_group', 'Blood group', e.blood_group, 'direct', 'employees.blood_group'],
          ['marital_status', 'Marital status', e.marital_status, 'event', 'employees.marital_status',
            { hint: 'Opens family, nominee and insurance steps', routeTo: 'hr' }],
          ['marriage_date', 'Anniversary', fmtDate(e.marriage_date), 'direct', 'employees.marriage_date'],
        ])},
        { title: 'Background', fields: mk([
          ['father_name', "Father's name", e.father_name, 'locked', 'employees.father_name'],
          ['mother_name', "Mother's name", e.mother_name, 'locked', 'employees.mother_name'],
          ['spouse_name', 'Spouse name', e.spouse_name, 'request', 'employees.spouse_name', { routeTo: 'hr' }],
          ['nationality', 'Nationality', e.nationality, 'locked', 'employees.nationality'],
          ['place_of_birth', 'Place of birth', e.place_of_birth, 'locked', 'employees.place_of_birth'],
          ['domicile_state', 'Domicile state', e.domicile_state, 'locked', 'employees.domicile_state'],
          ['languages', 'Languages', e.languages, 'direct', 'employees.languages'],
          ['is_disabled', 'Differently abled', yn(e.is_disabled), 'request', 'employees.is_disabled',
            { hint: 'Drives Section 80U relief', routeTo: 'hr' }],
          ['is_international_worker', 'International worker', yn(e.is_international_worker), 'locked',
            'employees.is_international_worker', { hint: 'Drives PF Form 11 treatment' }],
        ])},
        { title: 'Contact', fields: mk([
          ['official_email', 'Official email', e.official_email, 'locked', 'employees.official_email'],
          ['personal_email', 'Personal email', e.personal_email, 'direct', 'employees.personal_email'],
          ['mobile', 'Mobile', e.mobile, 'direct', 'employees.mobile'],
          ['alt_mobile', 'Alternate number', e.alt_mobile, 'direct', 'employees.alt_mobile'],
          ['extension', 'Extension', e.extension, 'locked', 'employees.extension', { mono: true }],
          ['whatsapp_optin', 'WhatsApp alerts', e.whatsapp_optin ? 'Opted in' : 'Opted out', 'direct',
            'employees.whatsapp_optin'],
        ])},
        { title: 'Address and emergency', fields: mk([
          ['present_address', 'Present address', e.present_address, 'request', 'employees.present_address',
            { wide: true, hint: 'Changes PT state and HRA exemption', routeTo: 'hr' }],
          ['permanent_address', 'Permanent address', e.permanent_address, 'request', 'employees.permanent_address',
            { wide: true, routeTo: 'hr' }],
          ['emergency_contact_1', 'Emergency contact 1', e.emergency_contact_1, 'direct', 'employees.emergency_contact_1', { wide: true }],
          ['emergency_contact_2', 'Emergency contact 2', e.emergency_contact_2, 'direct', 'employees.emergency_contact_2', { wide: true }],
        ])},
      ],
    },
    {
      key: 'job', label: 'Employment',
      groups: [
        { title: 'Position', fields: mk([
          ['designation', 'Designation', e.designation, 'locked', 'employees.designation'],
          ['department_name', 'Department', e.department_name, 'locked', 'departments.name'],
          ['sub_department', 'Sub department', e.sub_department, 'locked', 'employees.sub_department'],
          ['grade', 'Grade', e.grade, 'locked', 'employees.grade'],
          ['job_level', 'Job level', e.job_level, 'locked', 'employees.job_level'],
          ['employment_type', 'Employment type', e.employment_type, 'locked', 'employees.employment_type'],
          ['employee_category', 'Employee category', e.employee_category, 'locked', 'employees.employee_category'],
          ['cost_centre', 'Cost centre', e.cost_centre, 'locked', 'employees.cost_centre', { mono: true }],
          ['company_name', 'Company', e.company_name, 'locked', 'companies.name'],
          ['business_unit', 'Business unit', e.business_unit, 'locked', 'employees.business_unit'],
          ['location_name', 'Work location', e.location_name, 'request', 'locations.name',
            { hint: 'Goes through the Transfer module', routeTo: 'hr' }],
          ['branch_code', 'Branch code', e.branch_code, 'locked', 'branches.code', { mono: true }],
          ['workstation', 'Seat', e.workstation, 'direct', 'employees.workstation'],
        ])},
        { title: 'Dates and terms', fields: mk([
          ['date_of_joining', 'Date of joining', fmtDate(e.date_of_joining), 'locked', 'employees.date_of_joining'],
          ['confirmation_date', 'Confirmation date', fmtDate(e.confirmation_date), 'locked', 'employees.confirmation_date'],
          ['probation_months', 'Probation', e.probation_months ? `${e.probation_months} months` : null, 'locked', 'employees.probation_months'],
          ['notice_period_days', 'Notice period', e.notice_period_days ? `${e.notice_period_days} days` : null, 'locked', 'employees.notice_period_days'],
          ['status', 'Employment status', e.status, 'locked', 'employees.status'],
          ['date_of_leaving', 'Last working day', fmtDate(e.date_of_leaving), 'locked', 'employees.date_of_leaving'],
        ])},
        { title: 'Working pattern', fields: mk([
          ['shift_name', 'Shift', e.shift_name, 'locked', 'shifts.name'],
          ['weekly_off', 'Weekly off', e.weekly_off, 'locked', 'employees.weekly_off'],
          ['attendance_mode', 'Attendance mode', e.attendance_mode, 'locked', 'employees.attendance_mode'],
        ])},
        { title: 'Reporting', fields: mk([
          ['md', 'Managing Director', e.md_name && `${e.md_name} · ${e.md_code}`, 'locked', 'employees.md_id'],
          ['hod', 'HOD', e.hod_name && `${e.hod_name} · ${e.hod_code}`, 'locked', 'employees.hod_id'],
          ['rm_l2', 'Reporting Manager L2', e.rm_l2_name && `${e.rm_l2_name} · ${e.rm_l2_code}`, 'locked', 'employees.reports_to_l2'],
          ['rm_l1', 'Reporting Manager L1', e.rm_l1_name && `${e.rm_l1_name} · ${e.rm_l1_code}`, 'locked', 'employees.reports_to_l1'],
          ['reportees', 'Reportees', `${e.reportee_count ?? 0} team members`, 'locked', 'derived'],
        ])},
      ],
    },
    {
      key: 'statutory', label: 'Statutory',
      groups: [
        { title: 'Tax identity', fields: mk([
          ['pan', 'PAN', e.pan, 'locked', 'employees.pan', { mono: true, masked: true, min: 'hr' }],
          ['aadhaar_full', 'Aadhaar', e.aadhaar_full, 'locked', 'employees.aadhar_decrypted', { mono: true, masked: true, min: 'hr' }],
          ['aadhar_last4', 'Aadhaar last 4', e.aadhar_last4, 'locked', 'employees.aadhar_last4', { mono: true }],
        ])},
        { title: 'Provident fund', fields: mk([
          ['uan', 'UAN', e.uan, 'locked', 'employees.uan', { mono: true }],
          ['pf_number', 'PF number', e.pf_number, 'locked', 'employees.pf_number', { mono: true }],
          ['pf_applicable', 'PF applicability', yn(e.pf_applicable), 'locked', 'employees.pf_applicable'],
          ['vpf_amount', 'Voluntary PF', e.vpf_amount ? money(e.vpf_amount) + ' per month' : 'Not opted', 'direct', 'employees.vpf_amount'],
          ['eps_status', 'Pension (EPS)', e.eps_status, 'locked', 'employees.eps_status'],
        ])},
        { title: 'Other statutory', fields: mk([
          ['esic_ip_number', 'ESIC IP number', e.esic_ip_number, 'locked', 'employees.esic_ip_number', { mono: true }],
          ['esic_dispensary', 'ESIC dispensary', e.esic_dispensary, 'locked', 'employees.esic_dispensary'],
          ['pt_state', 'Professional tax state', e.pt_state, 'locked', 'employees.pt_state'],
          ['lwf_state', 'Labour welfare fund', e.lwf_state, 'locked', 'employees.lwf_state'],
        ])},
        { title: 'Other identity documents', fields: mk([
          ['passport_no', 'Passport', e.passport_no, 'request', 'employees.passport_no', { mono: true, masked: true, min: 'hr', routeTo: 'hr' }],
          ['driving_licence', 'Driving licence', e.driving_licence, 'direct', 'employees.driving_licence', { mono: true }],
          ['voter_id', 'Voter ID', e.voter_id, 'direct', 'employees.voter_id', { mono: true }],
        ])},
      ],
    },
    {
      key: 'payroll', label: 'Payroll',
      groups: [
        { title: 'Salary account', fields: mk([
          ['bank_name', 'Bank name', e.bank_name, 'request', 'employees.bank_name', { routeTo: 'payroll' }],
          ['bank_account_full', 'Account number', e.bank_account_full, 'request', 'employees.bank_account_decrypted',
            { mono: true, masked: true, min: 'hr', routeTo: 'payroll' }],
          ['bank_last4', 'Account last 4', e.bank_last4, 'locked', 'employees.bank_last4', { mono: true }],
          ['ifsc', 'IFSC', e.ifsc, 'request', 'employees.ifsc', { mono: true, routeTo: 'payroll' }],
          ['bank_holder_name', 'Account holder', e.bank_holder_name, 'request', 'employees.bank_holder_name', { routeTo: 'payroll' }],
          ['payment_mode', 'Payment mode', e.payment_mode, 'locked', 'employees.payment_mode'],
        ])},
        { title: 'Compensation', fields: mk([
          ['annual_ctc', 'Annual CTC', money(e.annual_ctc), 'locked', 'ctc_master.annual_ctc', { min: 'manager' }],
          ['gross_monthly', 'Monthly gross', money(e.gross_monthly), 'locked', 'salary_structures.gross_monthly', { min: 'manager' }],
        ])},
      ],
    },
  ];
}

// ── ESS session → viewer id ──────────────────────────────────────────────────
// This app authenticates ESS with an HMAC bearer token (lib/ess/session), not a
// Supabase-auth cookie and not the spoofable x-employee-code the vendor drop-in
// used. Every route resolves the viewer through here so masking cannot be bypassed
// by forging a header.
import type { NextRequest } from 'next/server'
import { requireDashboardUser } from '@/lib/api-auth'
export async function essViewerId(req: NextRequest): Promise<string | null> {
  const { user } = await requireDashboardUser(req)
  return user?.employeeId ?? null
}
