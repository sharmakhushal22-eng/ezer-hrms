'use client'
// app/profile-preview/page.tsx — a test harness, not a product screen.
//
// The real profile sits behind ESS auth and behind get_employee_profile, so
// neither a screenshot nor a layout probe can reach the tabs through it. This
// mounts the component with a fixed payload instead. It renders nothing
// outside development, so no unauthenticated route ships.
//
// THE FIXTURE IS DELIBERATELY AWKWARD, the same reasoning as pms-preview: a
// tidy record proves nothing. This one carries
//
//   • a MISSING key (pan) — the "Restricted" path, which is different from
//     a null value and is the distinction the whole component turns on
//   • a masked value with something to reveal (passport_no)
//   • a nomination set totalling 60%, not 100 — the case that must warn
//   • an unverified family member, and one with no date of birth
//   • empty lists (assets, trainings) so the empty lines get drawn
//   • a long address, to prove the wide field wraps rather than overflows

import Profile360 from '@/components/profile/Profile360'
import type { ProfilePayload } from '@/lib/profile/types'

const PAYLOAD: ProfilePayload = {
  viewer_role: 'self',
  completeness: {
    score: 58,
    pending: ['Add your Aadhaar', 'Add an emergency contact',
              'Add a provident fund nominee', 'Upload your onboarding documents'],
  },
  employee: {
    id: 'demo', full_name: 'Manoj Kumar Sharma', employee_code: 'SRS0512',
    photo_path: null, display_name: 'Manoj', designation: 'Assistant Manager',
    department_name: 'Logistics', company_name: 'Sharma Retail Solutions Pvt Ltd',
    location_name: 'Gurugram', status: 'Active', grade: 'M2', job_level: 'L3',
    employment_type: 'Permanent', employee_category: 'Staff', cost_centre: 'CC-114',
    business_unit: 'North', sub_department: 'Fleet', workstation: '3F-21',
    date_of_birth: '1989-03-19', gender: 'Male', blood_group: 'B+',
    marital_status: 'Married', marriage_date: '2016-11-27',
    father_name: 'Ram Kumar Sharma', mother_name: 'Sunita Sharma',
    spouse_name: 'Neha Sharma', nationality: 'Indian', place_of_birth: 'Meerut',
    domicile_state: 'Uttar Pradesh', languages: 'Hindi, English',
    is_disabled: false, is_international_worker: false,
    official_email: 'manoj.sharma@sharmaretail.in', personal_email: 'manoj.k@gmail.com',
    mobile: '9876543210', alt_mobile: '9812345670', extension: '2114',
    whatsapp_optin: true,
    present_address: 'Flat 402, Tower C, Palm Grove Residency, Sector 54, Golf Course Road, Gurugram, Haryana 122002',
    permanent_address: 'H.No. 118, Civil Lines, Meerut, Uttar Pradesh 250001',
    emergency_contact_1: 'Neha Sharma · Spouse · 9812345671',
    emergency_contact_2: 'Ram Kumar Sharma · Father · 9812345672',
    date_of_joining: '2019-06-03', confirmation_date: '2019-12-03',
    probation_months: 6, notice_period_days: 60,
    weekly_off: 'Sunday', attendance_mode: 'Face + Geo',
    tenure_years: 6, tenure_months: 3, reportee_count: 4,
    rm_l1_name: 'Kiran Reddy', rm_l2_name: 'Anita Desai',
    hod_name: 'Vikram Bose', md_name: 'S. Sharma',
    // pan is DELIBERATELY ABSENT — 'Restricted', not blank.
    aadhar_last4: '4417', passport_no: 'Z4471182',
    uan: '100234556677', pf_number: 'GN/GGN/0012345/000/0004417',
    pf_applicable: true, vpf_amount: 2500, eps_status: 'Enrolled',
    esic_ip_number: null, esic_dispensary: null,
    pt_state: 'Haryana', lwf_state: 'Haryana',
    driving_licence: 'HR26 20110012345', voter_id: null,
    bank_name: 'HDFC Bank', bank_last4: '8841', ifsc: 'HDFC0091597',
    payment_mode: 'NEFT', annual_ctc: 1300000, gross_monthly: 95000,
  },
  family: [
    { id: 'f1', member_name: 'Neha Sharma', relation: 'Spouse',
      date_of_birth: '1991-07-14', is_dependent: true, is_insured: true, is_verified: true },
    { id: 'f2', member_name: 'Aarav Sharma', relation: 'Son',
      date_of_birth: null, is_dependent: true, is_insured: false, is_verified: false },
  ],
  // 40 + 20 = 60. Must warn, not silently render.
  nominations: [
    { id: 'n1', scheme: 'Provident Fund', nominee_name: 'Neha Sharma', relation: 'Spouse', share_percent: 40 },
    { id: 'n2', scheme: 'Provident Fund', nominee_name: 'Aarav Sharma', relation: 'Son', share_percent: 20 },
    { id: 'n3', scheme: 'Gratuity', nominee_name: 'Neha Sharma', relation: 'Spouse', share_percent: 100 },
  ],
  insurance: [
    { id: 'i1', policy_type: 'Group Mediclaim', policy_name: 'Star Health GMC',
      policy_no: 'GMC/2026/44118', sum_insured: 500000, valid_to: '2027-03-31' },
  ],
  documents: [
    { id: 'd1', doc_type: 'PAN', doc_name: 'pan_card.pdf', status: 'verified', expiry_date: null },
    { id: 'd2', doc_type: 'Address proof', doc_name: 'rent_agreement.pdf', status: 'pending', expiry_date: '2027-01-31' },
  ],
  assets: [],
  education: [
    { id: 'e1', qualification: 'MBA / PG', institute: 'IMT Ghaziabad',
      specialisation: 'Operations', to_year: 2013, score: '7.4 CGPA' },
    { id: 'e2', qualification: 'Graduation', institute: 'CCS University',
      specialisation: 'B.Com', to_year: 2010, score: '62%' },
  ],
  experience: [
    { id: 'x1', company: 'Cj Darcl Logistic Limited', designation: 'Assistant Manager',
      from_date: '2018-05-05', to_date: '2019-05-31', location: 'Delhi' },
  ],
  certifications: [
    { id: 'c1', cert_name: 'Lean Six Sigma Green Belt', issuer: 'KPMG',
      issued_on: '2021-08-12', expires_on: null },
  ],
  trainings: [],
  app_access: [
    { id: 'a1', app_name: 'Fleet Console', access_role: 'Editor', granted_on: '2024-02-01' },
  ],
}

export default function ProfilePreview() {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div style={{ padding: 20, background: 'var(--ez-canvas)', minHeight: '100vh' }}>
      <section data-case="profile-360">
        <Profile360 initial={PAYLOAD} />
      </section>
    </div>
  )
}
