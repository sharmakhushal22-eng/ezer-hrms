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
import { followupDue, followupMail } from './joining-followup'
import { loadJoiners, empEmail } from './joiners'


export interface JoiningFollowupSummary {
  considered: number; due: number; mailed: number; notified: number; skipped: Record<string, number>; error?: string
}

export async function runJoiningFollowups(sb: SupabaseClient, mail: Transporter, from: string, now = Date.now()): Promise<JoiningFollowupSummary> {
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1 }
  const out: JoiningFollowupSummary = { considered: 0, due: 0, mailed: 0, notified: 0, skipped }

  const { joiners, error } = await loadJoiners(sb, now)
  if (error) { out.error = error; return out }
  out.considered = joiners.length
  if (!joiners.length) return out
  const mrfBy = new Map<string, any>(joiners.filter(j => j.mrf).map(j => [j.mrf.id, j.mrf]))

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

  for (const j of joiners) {
    const c = j.cand, doj = j.doj
    const v = followupDue({ doj, lastAt: c.hm_followup_at, offerSentAt: c.offer_sent_at, now })
    if (!v.due) { skip(v.reason || 'not-due'); continue }
    out.due++

    const mrf = j.mrf
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
