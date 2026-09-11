// lib/notifications/derive.ts — what SHOULD be in a person's bell right now.
//
// The dispatcher handles events: something happens, rows are written. That only
// covers things that happen from now on. It leaves two gaps:
//
//   1. Work that is already pending on somebody produced no notification,
//      because it was created before any of this existed. Three leave requests
//      are sitting unapproved right now and nobody was ever told.
//   2. An event-only system is silent about state. If an approval has been
//      waiting eleven days, no new event fires to say so.
//
// So this derives the notifications a person should have from CURRENT DATA,
// and the sync route inserts the ones missing. Idempotent by construction: the
// link carries the source row's id, so re-running never duplicates.
//
// ── EVERY SOURCE IS OPTIONAL ────────────────────────────────────────────────
// Tables come and go across migrations — travel_claims exists, PMS may not have
// data, service_requests does not exist at all. Each source is wrapped so a
// missing table or column degrades to "no notifications from this source"
// instead of emptying somebody's bell.

import { rmsServiceClient as sb } from '@/lib/rms/server'
import { def } from './catalogue'

export interface Derived {
  code: string
  title: string
  body?: string
  /** Carries the source row id — this is the dedupe key. */
  link: string
}

/** Run a source, swallowing schema drift. Never lets one source break the set. */
async function safely(label: string, fn: () => Promise<Derived[]>): Promise<Derived[]> {
  try { return await fn() } catch (e) {
    console.warn(`[derive] ${label} skipped:`, (e as Error)?.message ?? e)
    return []
  }
}

const ref = (base: string, id: string) => `${base}${base.includes('?') ? '&' : '?'}ref=${id}`

/**
 * Everything `me` should currently see, personal and role-based together.
 * Role membership is derived from org structure, exactly as the dispatcher
 * does it — people report to you, so you are an RM.
 */
export async function deriveFor(me: string): Promise<Derived[]> {
  const out: Derived[] = []

  // ── Leave approvals pending ON me (RM audience) ─────────────────────────
  out.push(...await safely('leave-inbox', async () => {
    const { data } = await sb.from('leave_applications')
      .select('id, employee_id, from_date, to_date, status, current_approver_id')
      .eq('current_approver_id', me).eq('status', 'PENDING')
    if (!data?.length) return []
    const names = await namesFor(data.map(r => r.employee_id))
    return data.map(r => ({
      code: 'MGR_NEW_LEAVE',
      title: `Leave request from ${names.get(r.employee_id) ?? 'a team member'}`,
      body: `${r.from_date}${r.to_date && r.to_date !== r.from_date ? ` to ${r.to_date}` : ''} — waiting for your approval.`,
      link: ref('/ess?tab=approvals', r.id),
    }))
  }))

  // ── My own leave, once somebody has decided (SELF audience) ─────────────
  out.push(...await safely('leave-mine', async () => {
    const { data } = await sb.from('leave_applications')
      .select('id, status, from_date').eq('employee_id', me).in('status', ['APPROVED', 'REJECTED'])
    return (data ?? []).map(r => ({
      code: r.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      title: r.status === 'APPROVED' ? 'Your leave was approved' : 'Your leave was rejected',
      body: `For ${r.from_date}.`,
      link: ref('/ess?tab=leave', r.id),
    }))
  }))

  // ── Travel claims waiting on me, and my own once decided ────────────────
  out.push(...await safely('travel', async () => {
    const rows: Derived[] = []
    const { data: inbox } = await sb.from('travel_claims')
      .select('id, employee_id, status, current_approver_id')
      .eq('current_approver_id', me).not('status', 'in', '("PAID","REJECTED")')
    if (inbox?.length) {
      const names = await namesFor(inbox.map(r => r.employee_id))
      rows.push(...inbox.map(r => ({
        // Finance sees the same row under its own code once it reaches them.
        code: r.status === 'PENDING_FINANCE' ? 'FIN_TRAVEL_STAGE' : 'MGR_NEW_TRAVEL',
        title: `Travel claim from ${names.get(r.employee_id) ?? 'a team member'}`,
        body: `Status ${r.status} — waiting on you.`,
        link: ref('/ess?tab=approvals', r.id),
      })))
    }
    const { data: mine } = await sb.from('travel_claims')
      .select('id, status').eq('employee_id', me).in('status', ['APPROVED', 'REJECTED', 'SENT_BACK', 'PAID'])
    rows.push(...(mine ?? []).map(r => ({
      code: r.status === 'PAID' ? 'TRAVEL_PAID' : r.status === 'APPROVED' ? 'TRAVEL_APPROVED' : 'TRAVEL_REJECTED',
      title: r.status === 'PAID' ? 'Your travel claim was paid'
           : r.status === 'APPROVED' ? 'Your travel claim was approved'
           : 'Your travel claim needs attention',
      link: ref('/ess?tab=travel', r.id),
    })))
    return rows
  }))

  // ── My investment proofs, once HR has ruled on them ─────────────────────
  out.push(...await safely('proofs', async () => {
    const { data } = await sb.from('investment_declaration_lines')
      .select('id, proof_status').eq('employee_id', me).in('proof_status', ['VERIFIED', 'REJECTED'])
    return (data ?? []).map(r => ({
      code: r.proof_status === 'VERIFIED' ? 'PROOF_VERIFIED' : 'PROOF_REJECTED',
      title: r.proof_status === 'VERIFIED' ? 'An investment proof was verified' : 'An investment proof was rejected',
      link: ref('/ess?tab=proofs', r.id),
    }))
  }))

  // ── Proofs waiting on HR (functional audience) ───────────────────────────
  out.push(...await safely('proofs-hr', async () => {
    if (!await holdsRole(me, ['HR_MANAGER', 'HR_HEAD', 'CHRO'])) return []
    const { data } = await sb.from('investment_declaration_lines')
      .select('id').eq('proof_status', 'SUBMITTED').limit(200)
    if (!data?.length) return []
    // One summary rather than 200 rows — a bell with 200 identical entries is
    // not a bell, it is a denial of service on the person reading it.
    return [{
      code: 'HR_PROOF_SUBMITTED',
      title: `${data.length} investment proof${data.length > 1 ? 's' : ''} awaiting verification`,
      body: 'Open Investment Proofs to review them.',
      link: '/dashboard/investment-proofs',
    }]
  }))

  // ── PMS: appraisals waiting on me to finalise (HOD audience) ────────────
  out.push(...await safely('pms', async () => {
    const { data } = await sb.from('pms_overall_rating')
      .select('id, employee_id, workflow_status, hod_id')
      .eq('hod_id', me).eq('workflow_status', 'PENDING_HOD').limit(100)
    if (!data?.length) return []
    return [{
      code: 'HOD_PMS_FINALISE',
      title: `${data.length} appraisal${data.length > 1 ? 's' : ''} waiting for you to finalise`,
      link: '/ess?tab=performance',
    }]
  }))

  return out
}

/** Names for a set of employee ids, one query. */
async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[]
  const m = new Map<string, string>()
  if (!uniq.length) return m
  const { data } = await sb.from('employees').select('id, full_name').in('id', uniq)
  for (const e of data ?? []) m.set(e.id, e.full_name)
  return m
}

/** Does `me` hold any of these functional roles? */
async function holdsRole(me: string, codes: string[]): Promise<boolean> {
  const { data: acct } = await sb.from('ess_accounts').select('id').eq('employee_id', me).maybeSingle()
  if (!acct) return false
  const { data: roles } = await sb.from('ess_roles').select('id').in('role_code', codes)
  if (!roles?.length) return false
  const { data: link } = await sb.from('ess_user_roles')
    .select('id').eq('ess_account_id', acct.id).in('role_id', roles.map(r => r.id)).limit(1)
  return !!link?.length
}

/** Personal or role-based, taken from the catalogue's audience. Drives the
 *  two groups in the bell so somebody can tell "about me" from "for me to do". */
export function isRoleScoped(code: string): boolean {
  const a = def(code)?.audience
  return !!a && a !== 'SELF' && a !== 'PEER'
}
