// lib/recruitment/joining-followup-run.ts — SERVER ONLY.
//
// The cron half of the hiring manager's "connect with your candidate" reminder; the rule
// itself (every 4 days, every 2 days once joining is within 6 days) is in
// ./joining-followup.ts. Runs from /api/cron/offer-followup once a day.
//
// Who is reminded: the MRF's hiring manager(s) — assigned_recruiter_ids, the same people who
// sent the salary link and were told of the acceptance (offer-accepted-mail.ts). A
// confidential search has none; its HR Head + HR Manager(s) are reminded instead. A candidate
// with no MRF (walk-in) falls back to the hr_email on the card. Each manager also gets an
// in-app notification so the reminder shows in the bell, not only in a mailbox.
//
// Needs migration 155 (candidates.hm_followup_at / hm_followup_count). Until it is applied
// the select fails and the run reports that instead of mailing daily.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transporter } from 'nodemailer'
import { notify } from '@/lib/ess/session'
import { confidentialAudience } from './confidential-flow'
import { followupDue, followupMail, joiningDate } from './joining-followup'

const empEmail = (e: any) => e?.office_email || e?.personal_email || null
const declined = (r: unknown) => /reject|declin|withdr/i.test(String(r || ''))

export interface JoiningFollowupSummary {
  considered: number; due: number; mailed: number; notified: number; skipped: Record<string, number>; error?: string
}

export async function runJoiningFollowups(sb: SupabaseClient, mail: Transporter, from: string, now = Date.now()): Promise<JoiningFollowupSummary> {
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1 }
  const out: JoiningFollowupSummary = { considered: 0, due: 0, mailed: 0, notified: 0, skipped }

  const { data: cands, error } = await sb.from('candidates')
    .select('id, full_name, email, mobile, phone, designation, hr_email, mrf_id, company_id, stage, offer_response, blacklisted, onboarding_date, doj, offer_sent_at, hm_followup_at, hm_followup_count')
    .eq('stage', 'Offer Sent')
  if (error) { out.error = error.message; return out }
  const live = (cands || []).filter(c => !c.blacklisted && !declined(c.offer_response))
  out.considered = live.length
  if (!live.length) return out

  // Other places a joining date may live, one query each for the whole batch.
  const ids = live.map(c => c.id)
  const [reqs, negs, letters, mrfs] = await Promise.all([
    sb.from('offer_approval_requests').select('candidate_id, proposed_doj, status, submitted_at').in('candidate_id', ids).neq('status', 'HR_HEAD_REJECTED').order('submitted_at', { ascending: false }),
    sb.from('ctc_negotiations').select('candidate_id, proposed_doj, created_at').in('candidate_id', ids).not('proposed_doj', 'is', null).order('created_at', { ascending: false }),
    sb.from('offer_letters').select('candidate_id, date_of_joining, created_at').in('candidate_id', ids).not('date_of_joining', 'is', null).order('created_at', { ascending: false }),
    sb.from('manpower_requisitions').select('id, mrf_number, designation, position, assigned_recruiter_ids, is_confidential, company_id').in('id', live.map(c => c.mrf_id).filter(Boolean) as string[]),
  ])
  const first = <T extends { candidate_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T>(); for (const r of rows || []) if (!m.has(r.candidate_id)) m.set(r.candidate_id, r); return m
  }
  const reqBy = first(reqs.data as any[]), negBy = first(negs.data as any[]), letterBy = first(letters.data as any[])
  const mrfBy = new Map<string, any>((mrfs.data || []).map((m: any) => [m.id, m]))

  // Everyone who might be mailed, fetched once.
  const hmIds = new Set<string>()
  for (const m of mrfBy.values()) for (const id of (Array.isArray(m.assigned_recruiter_ids) ? m.assigned_recruiter_ids : [])) hmIds.add(id)
  const confidentialBy = new Map<string, { id: string; name: string; email: string | null }[]>()
  for (const m of mrfBy.values()) if (m.is_confidential && !confidentialBy.has(m.company_id || '')) {
    const ppl = await confidentialAudience(sb, m.company_id || null)
    confidentialBy.set(m.company_id || '', ppl); ppl.forEach(p => hmIds.add(p.id))
  }
  const { data: emps } = hmIds.size ? await sb.from('employees').select('id, full_name, office_email, personal_email').in('id', [...hmIds]) : { data: [] as any[] }
  const empBy = new Map<string, any>((emps || []).map((e: any) => [e.id, e]))

  for (const c of live) {
    const doj = joiningDate({
      onboarding_date: c.onboarding_date, doj: c.doj,
      letter_doj: letterBy.get(c.id)?.date_of_joining, request_doj: reqBy.get(c.id)?.proposed_doj, negotiation_doj: negBy.get(c.id)?.proposed_doj,
    })
    const v = followupDue({ doj, lastAt: c.hm_followup_at, offerSentAt: c.offer_sent_at, now })
    if (!v.due) { skip(v.reason || 'not-due'); continue }
    out.due++

    const mrf = c.mrf_id ? mrfBy.get(c.mrf_id) : null
    const managers: { id: string | null; name: string | null; email: string | null }[] = mrf?.is_confidential
      ? (confidentialBy.get(mrf.company_id || '') || []).map(p => ({ id: p.id, name: p.name, email: p.email }))
      : (Array.isArray(mrf?.assigned_recruiter_ids) ? mrf.assigned_recruiter_ids : []).map((id: string) => ({ id, name: empBy.get(id)?.full_name || null, email: empEmail(empBy.get(id)) }))
    if (!managers.length && c.hr_email && /@/.test(c.hr_email)) managers.push({ id: null, name: null, email: c.hr_email })
    if (!managers.length) { skip('no-hiring-manager'); continue }

    const role = c.designation || mrf?.designation || mrf?.position || null
    let sentOne = false
    for (const m of managers) {
      const { subject, text } = followupMail({
        managerName: m.name, candidate: c.full_name, role, mrfNumber: mrf?.mrf_number || null,
        doj: doj!, daysToJoin: v.daysToJoin!, cadence: v.cadence!, candidatePhone: c.mobile || c.phone || null, candidateEmail: c.email || null,
      })
      if (m.email) {
        try { await mail.sendMail({ from, to: m.email, subject, text, html: text.replace(/\n/g, '<br>') }); out.mailed++; sentOne = true }
        catch (e) { console.error('joining-followup mail failed', c.id, m.email, e) }
      }
      if (m.id) {
        await notify(m.id, subject, `Kindly connect with ${c.full_name}${role ? ` (${role})` : ''} and ask for their status — joining ${v.daysToJoin === 0 ? 'today' : `in ${v.daysToJoin} day${v.daysToJoin === 1 ? '' : 's'}`}.`, '/ess/recruitment/pipeline', 'RECRUITMENT').then(() => { out.notified++; sentOne = true }, () => null)
      }
    }
    if (sentOne) {
      await sb.from('candidates').update({ hm_followup_at: new Date(now).toISOString(), hm_followup_count: (c.hm_followup_count || 0) + 1 }).eq('id', c.id)
    } else skip('no-address')
  }
  return out
}
