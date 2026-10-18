// lib/onboarding/statutory-data.ts — pure. Everything the statutory forms print, gathered from
// the onboarding record once, so EPF Form 11, EPF Form 2 (with EPS Part B) and ESIC Form 1
// are all filled from the same facts (statutory-forms.ts draws them onto the official PDFs).

export interface Person { name: string; address: string; dob: string; relation: string; share?: string }
export interface FamilyMember { name: string; dob: string; relation: string; residing: boolean; town: string; state: string }

export interface StatutoryData {
  name: string
  /** Father's name, or the husband's for a married woman — Form 11 ticks the box, Form 2 / ESIC print one line. */
  parent: { kind: 'Father' | 'Spouse'; name: string }
  father_name: string; spouse_name: string
  dob: string; gender: string
  /** Form 11 wording: Married / Unmarried / Widow / Divorce. */
  marital: string
  email: string; mobile: string
  has_uan: boolean; uan: string; prev_pf_id: string; prev_exit: string
  is_foreign: boolean; country: string; passport_no: string; passport_valid: string
  bank_account: string; ifsc: string; aadhaar: string; pan: string
  doj: string; emp_code: string
  company_name: string; company_address: string; epf_code: string; esic_code: string
  perm_address: string; curr_address: string; perm_pin: string; curr_pin: string
  pf_nominees: Person[]
  /** Gratuity nominees (Form F), each with the age Form F asks for. */
  grat_nominees: (Person & { age: string })[]
  religion: string; designation: string; department: string
  /** Form F wants the permanent address split: village, thana, sub-division, post office, district, state. */
  perm_parts: { line1: string; village: string; thana: string; sub_division: string; po: string; city: string; district: string; state: string; pin: string }
  eps_family: Person[]; eps_fallback: Person | null
  esic_prev_ip: string; dispensary: string; esic_applicable: boolean
  family: FamilyMember[]
  esic_nominee: { name: string; relation: string; address: string } | null
  /** DD/MM/YYYY of the signing (submission, else today) and the place. */
  date: string; place: string
}

const s = (v: any) => (v == null ? '' : String(v)).trim()
/** DD/MM/YYYY from an ISO date or a date-time; anything else is returned as typed. */
export function ddmmyyyy(v: any): string {
  const t = s(v)
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return t
}
const joinAddr = (parts: any[]) => parts.map(s).filter(Boolean).join(', ')
/** Whole years between an ISO date of birth and `at`; '' when unknown. */
export function ageOf(dob: any, at: Date): string {
  const m = s(dob).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  let a = at.getFullYear() - Number(m[1])
  if (at.getMonth() + 1 < Number(m[2]) || (at.getMonth() + 1 === Number(m[2]) && at.getDate() < Number(m[3]))) a--
  return a >= 0 ? String(a) : ''
}

function addressOf(c: Record<string, any>, p: 'perm_' | 'curr_'): string {
  return joinAddr([c[`${p}line1`], c[`${p}village`], c[`${p}po`] && `PO ${s(c[`${p}po`])}`, c[`${p}thana`] && `PS ${s(c[`${p}thana`])}`, c[`${p}sub_division`], c[`${p}city`], c[`${p}district`], c[`${p}state`], c[`${p}pin`]])
}

export function maritalWord(v: any): string {
  const t = s(v).toLowerCase()
  if (!t) return ''
  if (/married/.test(t) && !/un/.test(t)) return 'Married'
  if (/single|unmarried|bachelor/.test(t)) return 'Unmarried'
  if (/widow/.test(t)) return 'Widow'
  if (/divorc|separat/.test(t)) return 'Divorce'
  return s(v)
}

export interface StatutorySource {
  /** onboarding_candidates row (form_data, employee_code, date_of_joining, submitted_at, esic_applicable …) */
  oc: Record<string, any>
  company?: { company_name?: string | null; reg_office?: string | null; corp_office?: string | null; epf_code?: string | null; esic_code?: string | null } | null
  /** From the Aadhaar front's AI extraction, when the form itself has no number. */
  aadhaar?: string | null
  now?: Date
}

export function statutoryData(src: StatutorySource): StatutoryData {
  const fd = src.oc.form_data || {}
  const p = fd.step_3 || {}, c = fd.step_4 || {}, e = fd.step_5 || {}, st = fd.step_7 || {}
  const ins = st.insurance || {}
  const gender = s(p.gender)
  const marital = maritalWord(p.marital_status)
  const spouse = s(ins.spouse_name || p.spouse_name)
  const father = s(p.father_name)
  const parent: StatutoryData['parent'] = /^f/i.test(gender) && marital === 'Married' && spouse ? { kind: 'Spouse', name: spouse } : { kind: 'Father', name: father }

  const nominees: Person[] = (Array.isArray(st.pf_nominees) && st.pf_nominees.length ? st.pf_nominees : [{ name: st.nominee_name, relation: st.nominee_relation, dob: st.nominee_dob, share: st.nominee_share, address: st.nominee_address }])
    .filter((n: any) => n && s(n.name))
    .map((n: any) => ({ name: s(n.name), address: s(n.address), dob: ddmmyyyy(n.dob), relation: s(n.relation), share: s(n.share) ? `${s(n.share).replace(/%$/, '')}%` : '' }))
  const signedAt = src.oc.submitted_at ? new Date(src.oc.submitted_at) : (src.now || new Date())
  const gratNominees = (Array.isArray(st.grat_nominees) && st.grat_nominees.length ? st.grat_nominees : [{ name: st.grat_nominee_name, relation: st.grat_nominee_relation, dob: st.grat_nominee_dob, share: st.grat_nominee_share || '100', address: st.grat_nominee_address || st.nominee_address }])
    .filter((n: any) => n && s(n.name))
    // Form F wants the nominee's full address; a blank one takes the same person's PF-nominee
    // address, else the employee's permanent address (the family lives there).
    .map((n: any) => ({ name: s(n.name), address: s(n.address) || nominees.find(x => x.name.toLowerCase() === s(n.name).toLowerCase())?.address || addressOf(c, 'perm_'), dob: ddmmyyyy(n.dob), relation: s(n.relation), share: s(n.share) ? `${s(n.share).replace(/%$/, '')}%` : '', age: ageOf(n.dob, signedAt) }))
  const epsFamily: Person[] = (Array.isArray(st.eps_family) ? st.eps_family : []).filter((m: any) => m && s(m.name)).map((m: any) => ({ name: s(m.name), address: s(m.address), dob: ddmmyyyy(m.dob), relation: s(m.relation) }))
  const fb = st.eps_fallback
  const epsFallback: Person | null = fb && s(fb.name) ? { name: s(fb.name), address: s(fb.address), dob: ddmmyyyy(fb.dob), relation: s(fb.relation) } : null

  const town = s(c.curr_city || c.perm_city), state = s(c.curr_state || c.perm_state)
  const fam = (name: any, dob: any, relation: string, residing: any): FamilyMember | null => s(name) ? { name: s(name), dob: ddmmyyyy(dob), relation, residing: !/^n/i.test(s(residing) || 'Yes'), town, state } : null
  const family = [
    fam(ins.spouse_name, ins.spouse_dob, /^f/i.test(gender) ? 'Husband' : 'Wife', ins.spouse_residing),
    fam(ins.kid1_name, ins.kid1_dob, 'Child', 'Yes'), fam(ins.kid2_name, ins.kid2_dob, 'Child', 'Yes'),
    fam(ins.father_name, ins.father_dob, 'Father', ins.father_residing), fam(ins.mother_name, ins.mother_dob, 'Mother', ins.mother_residing),
  ].filter((m): m is FamilyMember => !!m)

  const isForeign = !!(st.fe_passport_number || st.fe_visa_number || st.fe_work_permit_number) || (s(p.nationality) && !/indian?/i.test(s(p.nationality)))
  const prevEmployers = Array.isArray(e.prev_employers) ? e.prev_employers : []
  const prevExit = ddmmyyyy(e.prev_to || prevEmployers[prevEmployers.length - 1]?.to)
  const co = src.company || {}
  const signed = signedAt
  const esicNominee = nominees[0] ? { name: nominees[0].name, relation: nominees[0].relation, address: nominees[0].address || addressOf(c, 'perm_') } : null

  return {
    name: s(p.full_name || src.oc.full_name), parent, father_name: father, spouse_name: spouse,
    dob: ddmmyyyy(p.dob), gender, marital,
    email: s(c.personal_email || src.oc.email), mobile: s(c.mobile || src.oc.mobile),
    has_uan: !!st.has_uan && !!s(st.uan_number), uan: s(st.uan_number), prev_pf_id: s(st.prev_pf_id), prev_exit: st.has_uan ? prevExit : '',
    is_foreign: !!isForeign, country: s(p.country || (isForeign ? st.fe_passport_country : 'India')) || 'India',
    passport_no: s(st.fe_passport_number || st.passport_no), passport_valid: s(st.fe_passport_expiry) ? `valid till ${ddmmyyyy(st.fe_passport_expiry)}` : '',
    bank_account: s(st.bank_account), ifsc: s(st.bank_ifsc), aadhaar: s(src.aadhaar || p.aadhaar_number || st.aadhaar_number).replace(/\s+/g, ' '), pan: s(st.pan_number).toUpperCase(),
    doj: ddmmyyyy(src.oc.date_of_joining), emp_code: s(src.oc.employee_code),
    company_name: s(co.company_name), company_address: s(co.reg_office || co.corp_office), epf_code: s(co.epf_code), esic_code: s(co.esic_code),
    perm_address: addressOf(c, 'perm_'), curr_address: c.same_address ? addressOf(c, 'perm_') : addressOf(c, 'curr_'), perm_pin: s(c.perm_pin), curr_pin: c.same_address ? s(c.perm_pin) : s(c.curr_pin),
    pf_nominees: nominees, grat_nominees: gratNominees, eps_family: epsFamily, eps_fallback: epsFallback,
    religion: s(p.religion), designation: s(src.oc.designation), department: s(src.oc.department),
    perm_parts: { line1: s(c.perm_line1), village: s(c.perm_village), thana: s(c.perm_thana), sub_division: s(c.perm_sub_division), po: s(c.perm_po), city: s(c.perm_city), district: s(c.perm_district), state: s(c.perm_state), pin: s(c.perm_pin) },
    esic_prev_ip: s(st.esic_details?.prev_ip), dispensary: s(st.esic_details?.dispensary), esic_applicable: !!(src.oc.esic_applicable || st.esic_applicable),
    family, esic_nominee: esicNominee,
    date: ddmmyyyy(signed.toISOString()), place: town,
  }
}
