// lib/recruitment/joiners.ts — SERVER ONLY.
//
// "Who is joining, and when?" — the one answer every pre-joining reminder starts from: the
// hiring manager's connect-with-your-candidate mail, the teams' prepare-the-givables mail, the
// candidate's welcome mail, the HR Manager's send-the-link reminder. Each used to resolve the
// joining date on its own; now they share this.
//
// A joiner is a candidate at stage "Offer Sent" who is not blacklisted and has not declined,
// with the most authoritative joining date on record (see joiningDate) — which may be null.

import type { SupabaseClient } from '@supabase/supabase-js'
import { daysToJoin, joiningDate } from './joining-followup'

export interface Joiner {
  cand: any
  mrf: any | null
  companyId: string | null
  role: string | null
  doj: string | null
  daysToJoin: number | null
}

const declined = (r: unknown) => /reject|declin|withdr/i.test(String(r || ''))

export const CAND_COLS = 'id, full_name, email, mobile, phone, designation, hr_email, mrf_id, company_id, stage, offer_response, blacklisted, onboarding_date, doj, offer_sent_at, hm_followup_at, hm_followup_count, prep_mail_sent_at, welcome_mail_sent_at, link_reminder_sent_at'

/** Every joiner, with joining date resolved and the MRF loaded. `error` when the select fails (a pending migration). */
export async function loadJoiners(sb: SupabaseClient, now = Date.now()): Promise<{ joiners: Joiner[]; error?: string }> {
  const { data: cands, error } = await sb.from('candidates').select(CAND_COLS).eq('stage', 'Offer Sent')
  if (error) return { joiners: [], error: error.message }
  const live = (cands || []).filter(c => !c.blacklisted && !declined(c.offer_response))
  if (!live.length) return { joiners: [] }

  const ids = live.map(c => c.id)
  const mrfIds = [...new Set(live.map(c => c.mrf_id).filter(Boolean))] as string[]
  const [reqs, negs, letters, mrfs] = await Promise.all([
    sb.from('offer_approval_requests').select('candidate_id, proposed_doj, status, submitted_at').in('candidate_id', ids).neq('status', 'HR_HEAD_REJECTED').order('submitted_at', { ascending: false }),
    sb.from('ctc_negotiations').select('candidate_id, proposed_doj, created_at').in('candidate_id', ids).not('proposed_doj', 'is', null).order('created_at', { ascending: false }),
    sb.from('offer_letters').select('candidate_id, date_of_joining, created_at').in('candidate_id', ids).not('date_of_joining', 'is', null).order('created_at', { ascending: false }),
    mrfIds.length ? sb.from('manpower_requisitions').select('id, mrf_number, designation, position, assigned_recruiter_ids, is_confidential, company_id, location_id, department_id, requested_by, reporting_manager_id').in('id', mrfIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const first = <T extends { candidate_id: string }>(rows: T[] | null | undefined) => {
    const m = new Map<string, T>(); for (const r of rows || []) if (!m.has(r.candidate_id)) m.set(r.candidate_id, r); return m
  }
  const reqBy = first(reqs.data as any[]), negBy = first(negs.data as any[]), letterBy = first(letters.data as any[])
  const mrfBy = new Map<string, any>(((mrfs as any).data || []).map((m: any) => [m.id, m]))

  const joiners: Joiner[] = live.map(c => {
    const mrf = c.mrf_id ? mrfBy.get(c.mrf_id) || null : null
    const doj = joiningDate({
      onboarding_date: c.onboarding_date, doj: c.doj,
      letter_doj: letterBy.get(c.id)?.date_of_joining, request_doj: reqBy.get(c.id)?.proposed_doj, negotiation_doj: negBy.get(c.id)?.proposed_doj,
    })
    return {
      cand: c, mrf, companyId: c.company_id || mrf?.company_id || null,
      role: c.designation || mrf?.designation || mrf?.position || null,
      doj, daysToJoin: doj ? daysToJoin(doj, now) : null,
    }
  })
  return { joiners }
}

/** office_email first, personal second — the rule everywhere an employee is mailed. */
export const empEmail = (e: any) => e?.office_email || e?.personal_email || null
