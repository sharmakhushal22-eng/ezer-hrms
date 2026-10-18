// lib/onboarding/seed-form.ts — SERVER ONLY.
//
// The onboarding form starts filled with what recruitment already recorded about the
// candidate — the card (name, email, mobile, current company, designation) and the
// application details (contact, education), when there are any — so the candidate
// corrects rather than retypes. Keys follow the portal's own step_N shape
// (app/onboarding/[token]/client.tsx); the candidate can change everything.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function seedFormData(sb: SupabaseClient, candidateId: string | null, base: { full_name: string; email: string | null; mobile: string | null }): Promise<Record<string, any> | null> {
  if (!candidateId) return null
  const { data: c } = await sb.from('candidates').select('full_name, email, mobile, phone, current_company, designation, current_ctc, experience_years, application_details, notice_period_days').eq('id', candidateId).maybeSingle()
  if (!c) return null
  const ad = (c.application_details || {}) as any
  const personal = ad.personal || {}
  const contact = ad.contact || {}
  const prof = ad.professional || {}
  const step_3: Record<string, any> = { full_name: c.full_name || base.full_name }
  if (personal.dob) step_3.dob = personal.dob
  if (personal.gender) step_3.gender = personal.gender
  if (personal.father_name) step_3.father_name = personal.father_name
  if (personal.blood_group) step_3.blood_group = personal.blood_group
  if (personal.marital_status) step_3.marital_status = personal.marital_status
  const step_4: Record<string, any> = { mobile: c.mobile || c.phone || base.mobile || '', personal_email: c.email || base.email || '' }
  if (contact.permanent_address) step_4.perm_line1 = contact.permanent_address
  if (contact.permanent_city || contact.current_city) step_4.perm_city = contact.permanent_city || contact.current_city
  if (contact.permanent_state) step_4.perm_state = contact.permanent_state
  if (contact.permanent_pin) step_4.perm_pin = contact.permanent_pin
  if (contact.current_address) { step_4.curr_line1 = contact.current_address; step_4.same_address = false }
  if (contact.current_city) step_4.curr_city = contact.current_city
  const step_5: Record<string, any> = {}
  if (c.current_company) {
    step_5.prev_employers = [{ company: c.current_company, designation: prof.current_designation || c.designation || '', from: prof.from || '', to: '', ctc: c.current_ctc || '', reason: '' }]
    step_5.is_fresher = false
  } else if (Number(c.experience_years) === 0) step_5.is_fresher = true
  if (prof.qualification) step_5.education = [
    { qualification: '10th', institute: '', year: '' }, { qualification: '12th', institute: '', year: '' },
    { qualification: prof.qualification, institute: prof.institute || '', year: prof.year || '' },
  ]
  return { step_3, step_4, step_5, seeded_from: 'recruitment' }
}
