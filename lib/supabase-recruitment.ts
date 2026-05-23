import { supabase } from './supabase'

// ── Types ─────────────────────────────────────────────────────────
export interface MRFData {
  company_id: string
  position: string
  department_id?: string
  location_id?: string
  openings: number
  urgency: string
  reason: string
  remarks?: string
}

export interface JobOpeningData {
  company_id: string
  mrf_id?: string
  job_title: string
  department_id?: string
  location_id?: string
  experience_min: number
  experience_max: number
  salary_min: number
  salary_max: number
  employment_type: string
  skills_required: string[]
  jd_text: string
  openings_count: number
}

export interface CandidateData {
  job_id: string
  company_id: string
  full_name: string
  email: string
  phone: string
  source: string
  current_company: string
  current_ctc: number
  expected_ctc: number
  notice_period: number
  experience_years: number
}

// ── MRF Number Generator ──────────────────────────────────────────
async function genMRFNumber(company_code: string, type: 'MRF' | 'QH' = 'MRF') {
  const year = new Date().getFullYear()
  const prefix = `${type}/${company_code}/${year}/`
  const { count } = await supabase
    .from('manpower_requisitions')
    .select('*', { count: 'exact', head: true })
    .like('mrf_number', `${prefix}%`)
  const seq = String((count || 0) + 1).padStart(3, '0')
  return `${prefix}${seq}`
}

// ── COMPANY / LOCATION HELPERS ────────────────────────────────────
export async function getCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('id, company_code, company_name, short_name')
    .eq('status', 'Active')
    .order('company_name')
  if (error) throw error
  return data
}

// getLocations function mein yeh change karo:
export async function getLocations(company_id?: string) {
  let q = supabase
    .from('locations')
    .select('id, location_code, location_name, location_type, city, state, company_id') // ← company_id add karo
    .eq('status', 'Active')
  if (company_id) q = q.eq('company_id', company_id)
  const { data, error } = await q.order('location_name')
  if (error) throw error
  return data
}

export async function getDepartments(company_id?: string) {
  let q = supabase.from('departments').select('id, dept_code, dept_name').eq('status', 'Active')
  if (company_id) q = q.eq('company_id', company_id)
  const { data, error } = await q.order('dept_name')
  if (error) throw error
  return data
}

// ── MRF CRUD ──────────────────────────────────────────────────────
export async function createMRF(data: MRFData, isQuickHire = false) {
  // Get company code for MRF number
  const { data: co } = await supabase.from('companies').select('company_code').eq('id', data.company_id).single()
  const mrf_number = await genMRFNumber(co?.company_code || 'GRP', isQuickHire ? 'QH' : 'MRF')

  const { data: result, error } = await supabase
    .from('manpower_requisitions')
    .insert({
      company_id: data.company_id,
      mrf_number,
      position: data.position,
      department_id: data.department_id || null,
      location_id: data.location_id || null,
      openings: data.openings,
      urgency: data.urgency,
      reason: data.reason,
      status: isQuickHire ? 'Approved' : 'Submitted',
      remarks: data.remarks || null,
    })
    .select()
    .single()

  if (error) throw error
  return result
}

export async function getMRFs(company_id?: string) {
  let q = supabase
    .from('manpower_requisitions')
    .select(`
      *,
      companies(company_code, company_name),
      locations(location_name, city),
      departments(dept_name)
    `)
    .order('created_at', { ascending: false })

  if (company_id) q = q.eq('company_id', company_id)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function updateMRFStatus(id: string, status: string, remarks?: string) {
  const { data, error } = await supabase
    .from('manpower_requisitions')
    .update({
      status,
      approved_at: status === 'Approved' ? new Date().toISOString() : null,
      remarks: remarks || null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── JOB OPENINGS CRUD ─────────────────────────────────────────────
export async function createJobOpening(data: JobOpeningData) {
  const { data: result, error } = await supabase
    .from('job_openings')
    .insert({
      company_id: data.company_id,
      mrf_id: data.mrf_id || null,
      job_title: data.job_title,
      department_id: data.department_id || null,
      location_id: data.location_id || null,
      experience_min: data.experience_min,
      experience_max: data.experience_max,
      salary_min: data.salary_min,
      salary_max: data.salary_max,
      employment_type: data.employment_type,
      skills_required: data.skills_required,
      jd_text: data.jd_text,
      openings_count: data.openings_count,
      status: 'Open',
      posted_date: new Date().toISOString().split('T')[0],
    })
    .select()
    .single()
  if (error) throw error
  return result
}

export async function getJobOpenings(company_id?: string, status?: string) {
  let q = supabase
    .from('job_openings')
    .select(`
      *,
      companies(company_code, company_name),
      locations(location_name, city),
      departments(dept_name),
      manpower_requisitions(mrf_number)
    `)
    .order('created_at', { ascending: false })

  if (company_id) q = q.eq('company_id', company_id)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function updateJobStatus(id: string, status: string) {
  const { data, error } = await supabase
    .from('job_openings')
    .update({ status })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── CANDIDATES CRUD ───────────────────────────────────────────────
export async function addCandidate(data: CandidateData) {
  const { data: result, error } = await supabase
    .from('candidates')
    .insert({
      job_id: data.job_id,
      company_id: data.company_id,
      full_name: data.full_name,
      email: data.email,
      phone: data.phone,
      source: data.source,
      current_company: data.current_company,
      current_ctc: data.current_ctc,
      expected_ctc: data.expected_ctc,
      notice_period: data.notice_period,
      experience_years: data.experience_years,
      stage: 'Applied',
      status: 'Active',
      applied_date: new Date().toISOString().split('T')[0],
    })
    .select()
    .single()
  if (error) throw error
  return result
}

export async function getCandidates(job_id?: string, company_id?: string, stage?: string) {
  let q = supabase
    .from('candidates')
    .select(`*, job_openings(job_title, companies(company_code))`)
    .order('created_at', { ascending: false })

  if (job_id) q = q.eq('job_id', job_id)
  if (company_id) q = q.eq('company_id', company_id)
  if (stage) q = q.eq('stage', stage)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function updateCandidateStage(
  id: string,
  stage: string,
  ai_score?: number,
  ai_tag?: string,
  ai_reasoning?: string
) {
  const update: any = { stage }
  if (ai_score !== undefined) update.ai_score = ai_score
  if (ai_tag) update.ai_tag = ai_tag
  if (ai_reasoning) update.ai_reasoning = ai_reasoning

  const { data, error } = await supabase
    .from('candidates')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function rejectCandidate(id: string, reason: string) {
  const { data, error } = await supabase
    .from('candidates')
    .update({ stage: 'Rejected', status: 'Rejected', remarks: reason } as any)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── DASHBOARD STATS ───────────────────────────────────────────────
export async function getRecruitmentStats(company_id?: string) {
  const [mrfs, jobs, candidates] = await Promise.all([
    supabase.from('manpower_requisitions')
      .select('status', { count: 'exact' })
      .eq(company_id ? 'company_id' : 'status', company_id || 'Approved'),
    supabase.from('job_openings')
      .select('status, openings_count')
      .eq('status', 'Open'),
    supabase.from('candidates')
      .select('stage, status')
      .eq('status', 'Active'),
  ])

  const openJobs = jobs.data?.length || 0
  const totalOpenings = jobs.data?.reduce((s, j) => s + (j.openings_count || 1), 0) || 0
  const totalCandidates = candidates.data?.length || 0
  const offers = candidates.data?.filter(c => c.stage === 'Offer Sent').length || 0
  const joined = candidates.data?.filter(c => c.stage === 'Joined').length || 0

  return { openJobs, totalOpenings, totalCandidates, offers, joined }
}

// ── DUPLICATE CHECK ───────────────────────────────────────────────
export async function checkDuplicate(phone: string, email: string) {
  const { data } = await supabase
    .from('candidates')
    .select('id, full_name, job_id, stage, applied_date')
    .or(`phone.eq.${phone},email.eq.${email}`)
  return data || []
}

// ── PIPELINE COUNTS ───────────────────────────────────────────────
export async function getPipelineCounts(company_id?: string) {
  const stages = ['Applied','AI Screened','Telephonic','L1 Interview','L2 Interview','Optional','MD Final','Offer Sent','Joined','Rejected']
  let q = supabase.from('candidates').select('stage').eq('status', 'Active')
  if (company_id) q = q.eq('company_id', company_id)
  const { data } = await q
  const counts: Record<string, number> = {}
  stages.forEach(s => counts[s] = 0)
  data?.forEach(c => { if (counts[c.stage] !== undefined) counts[c.stage]++ })
  return counts
}