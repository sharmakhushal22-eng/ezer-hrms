import { supabase } from './supabase'

// ── Types ─────────────────────────────────────────────────────────
export interface GroupData {
  group_code: string
  group_name: string
  country: string
}

export interface CompanyData {
  group_id: string
  company_code: string
  company_name: string
  short_name: string
  company_type: string
  industry: string
  pan: string
  tan: string
  cin: string
  date_of_inc: string
  reg_office: string
  corp_office: string
  letterhead_header: string
  letterhead_footer: string
}

export interface LocationData {
  company_id: string
  location_code: string
  location_name: string
  location_type: string
  address_line1: string
  city: string
  district: string
  state: string
  pin_code: string
  latitude: number | null
  longitude: number | null
}

export interface RegistrationData {
  company_id: string
  location_id?: string
  reg_type: string   // EPF / ESIC / PT / GST / LWF / FACTORY
  reg_number: string
  state: string
  district?: string
  dept_address?: string
  valid_from?: string
  valid_till?: string
}

export interface BankData {
  company_id: string
  account_type: string  // Operating / Salary
  bank_name: string
  account_number: string
  ifsc_code: string
  branch_name: string
  is_primary: boolean
}

export interface LicenseData {
  company_id: string
  plan_name: string
  max_employees: number
  max_locations: number
  price_monthly: number
  valid_from: string
  valid_till: string
}

// ── STEP 1: Save Group ─────────────────────────────────────────────
export async function saveGroup(data: GroupData) {
  const { data: result, error } = await supabase
    .from('groups')
    .upsert({
      group_code: data.group_code,
      group_name: data.group_name,
      country: data.country || 'India',
      status: 'Active',
    }, { onConflict: 'group_code' })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── STEP 2: Save Company ───────────────────────────────────────────
export async function saveCompany(data: CompanyData) {
  const { data: result, error } = await supabase
    .from('companies')
    .upsert({
      group_id: data.group_id,
      company_code: data.company_code,
      company_name: data.company_name,
      short_name: data.short_name,
      company_type: data.company_type,
      industry: data.industry,
      pan: data.pan,
      tan: data.tan,
      cin: data.cin,
      date_of_inc: data.date_of_inc || null,
      reg_office: data.reg_office,
      corp_office: data.corp_office,
      letterhead_header: data.letterhead_header,
      letterhead_footer: data.letterhead_footer,
      status: 'Active',
    }, { onConflict: 'company_code' })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── STEP 3: Save Locations ─────────────────────────────────────────
export async function saveLocation(data: LocationData) {
  const { data: result, error } = await supabase
    .from('locations')
    .upsert({
      company_id: data.company_id,
      location_code: data.location_code,
      location_name: data.location_name,
      location_type: data.location_type,
      address_line1: data.address_line1,
      city: data.city,
      district: data.district,
      state: data.state,
      pin_code: data.pin_code,
      latitude: data.latitude,
      longitude: data.longitude,
      status: 'Active',
    }, { onConflict: 'location_code' })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── STEP 4 & 5: Save Registrations (EPF/ESIC/GST/PT/LWF) ──────────
export async function saveRegistration(data: RegistrationData) {
  const { data: result, error } = await supabase
    .from('registrations')
    .upsert({
      company_id: data.company_id,
      location_id: data.location_id || null,
      reg_type: data.reg_type,
      reg_number: data.reg_number,
      state: data.state,
      district: data.district || null,
      dept_address: data.dept_address || null,
      valid_from: data.valid_from || null,
      valid_till: data.valid_till || null,
      status: 'Active',
    })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── STEP 6: Save Bank Accounts ─────────────────────────────────────
export async function saveBankAccount(data: BankData) {
  const { data: result, error } = await supabase
    .from('company_bank_accounts')
    .upsert({
      company_id: data.company_id,
      account_type: data.account_type,
      bank_name: data.bank_name,
      account_number: data.account_number,
      ifsc_code: data.ifsc_code,
      branch_name: data.branch_name,
      is_primary: data.is_primary,
      status: 'Active',
    })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── STEP 7: Save License ───────────────────────────────────────────
export async function saveLicense(data: LicenseData) {
  const { data: result, error } = await supabase
    .from('license_plans')
    .upsert({
      company_id: data.company_id,
      plan_name: data.plan_name,
      max_employees: data.max_employees,
      max_locations: data.max_locations,
      price_monthly: data.price_monthly,
      valid_from: data.valid_from,
      valid_till: data.valid_till,
      is_active: true,
    })
    .select()
    .single()

  if (error) throw error
  return result
}

// ── FETCH: Get all companies for a group ──────────────────────────
export async function getGroupCompanies(group_id: string) {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('group_id', group_id)
    .eq('status', 'Active')

  if (error) throw error
  return data
}

// ── FETCH: Get all locations for a company ────────────────────────
export async function getCompanyLocations(company_id: string) {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('company_id', company_id)
    .eq('status', 'Active')

  if (error) throw error
  return data
}

// ── FETCH: Check if group exists ──────────────────────────────────
export async function getGroup(group_code: string) {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('group_code', group_code)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}