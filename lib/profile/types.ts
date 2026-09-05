export type EditState = 'direct' | 'request' | 'locked' | 'event';
export type ViewerRole = 'self' | 'manager' | 'hr' | 'peer';

export interface ProfileField {
  key: string;
  label: string;
  value: string | null;
  state: EditState;
  column: string;
  mono?: boolean;
  masked?: boolean;
  wide?: boolean;
  hint?: string | null;
  routeTo?: string | null;
  restricted?: boolean;   // viewer may not read it at all
}

export interface ProfileGroup { title: string; fields: ProfileField[] }
export interface ProfileTab   { key: string; label: string; groups: ProfileGroup[] }

export interface EmployeeCore {
  id: string;
  company_id: string;
  employee_code: string;
  full_name: string;
  display_name: string | null;
  photo_path: string | null;
  designation: string | null;
  department_name: string | null;
  sub_department: string | null;
  grade: string | null;
  job_level: string | null;
  employment_type: string | null;
  employee_category: string | null;
  cost_centre: string | null;
  business_unit: string | null;
  workstation: string | null;
  status: string | null;
  company_name: string | null;
  location_name: string | null;
  branch_code: string | null;
  shift_name: string | null;
  weekly_off: string | null;
  attendance_mode: string | null;
  date_of_joining: string | null;
  confirmation_date: string | null;
  probation_months: number | null;
  notice_period_days: number | null;
  date_of_leaving: string | null;
  date_of_birth: string | null;
  age_years: number | null;
  gender: string | null;
  blood_group: string | null;
  marital_status: string | null;
  marriage_date: string | null;
  nationality: string | null;
  place_of_birth: string | null;
  domicile_state: string | null;
  father_name: string | null;
  mother_name: string | null;
  spouse_name: string | null;
  languages: string | null;
  is_disabled: boolean | null;
  is_international_worker: boolean | null;
  official_email: string | null;
  personal_email: string | null;
  mobile: string | null;
  alt_mobile: string | null;
  extension: string | null;
  whatsapp_optin: boolean | null;
  present_address: string | null;
  permanent_address: string | null;
  emergency_contact_1: string | null;
  emergency_contact_2: string | null;
  pan?: string | null;
  aadhaar_full?: string | null;
  aadhar_last4: string | null;
  uan: string | null;
  pf_number: string | null;
  pf_applicable: boolean | null;
  vpf_amount: number | null;
  eps_status: string | null;
  esic_ip_number: string | null;
  esic_dispensary: string | null;
  pt_state: string | null;
  lwf_state: string | null;
  passport_no?: string | null;
  driving_licence: string | null;
  voter_id: string | null;
  bank_name: string | null;
  bank_account_full?: string | null;
  bank_last4: string | null;
  ifsc: string | null;
  bank_holder_name: string | null;
  payment_mode: string | null;
  annual_ctc: number | null;
  gross_monthly: number | null;
  rm_l1_name: string | null; rm_l1_code: string | null;
  rm_l2_name: string | null; rm_l2_code: string | null;
  hod_name: string | null;   hod_code: string | null;
  md_name: string | null;    md_code: string | null;
  reportee_count: number | null;
  tenure_years: number | null;
  tenure_months: number | null;
}

export interface ProfilePayload {
  employee: EmployeeCore;
  viewer_role: ViewerRole;
  completeness: number;
  pending: string[];
  family: any[];
  nominations: any[];
  insurance: any[];
  documents: any[];
  assets: any[];
  app_access: any[];
  education: any[];
  experience: any[];
  certifications: any[];
  trainings: any[];
  requests: any[];
}

export interface IdTokenResponse {
  token: string;      // goes into the QR
  url: string;        // full verify URL encoded in the QR
  expiresAt: number;  // epoch ms
  ttl: number;        // seconds
  cardNo: string;
  validTill: string | null;
}
