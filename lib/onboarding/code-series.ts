// lib/onboarding/code-series.ts — how an employee code is chosen (pure part + the loaders).
//
//   1. ONE series per company: the next code is the highest number already used in the
//      company's series plus one — STC9073 → STC9074 — gaps are never filled (STC0004 and
//      STC0006 in use does not make STC0005 the next), and nobody types a code by hand.
//   2. FIFO: codes are generated in the order candidates arrived in Onboarding. While an
//      earlier arrival of the same company has no code yet, the later one waits — the card's
//      Generate code is disabled and the API refuses. SWITCHED OFF for now (CODE_QUEUE_ENFORCED):
//      any joiner whose teams have approved can get their code, in any order.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The FIFO code queue. Off on request (30-Oct-2026): HR generates codes in any order. Set it
 *  back to true to restore the queue — the onboarding page, the Generate code modal, the API
 *  and create-employee all read it through queueAheadOf() or this flag. */
export const CODE_QUEUE_ENFORCED = false

/** The number inside a code of this company's series: "STC9074" / "STC-9074" → 9074; "STCINT0001" → null (another series). */
export function seriesNumber(code: string | null | undefined, prefix: string): number | null {
  const m = String(code || '').trim().toUpperCase().match(new RegExp(`^${prefix.toUpperCase()}-?(\\d+)$`))
  return m ? parseInt(m[1], 10) : null
}

/** The next code after the highest in use. Width keeps at least 4 digits (STC0001 … STC9999 → STC10000). */
export function nextInSeries(codes: Iterable<string | null | undefined>, prefix: string): { code: string; after: string | null; max: number } {
  let max = 0, after: string | null = null
  for (const c of codes) {
    const n = seriesNumber(c, prefix)
    if (n != null && n > max) { max = n; after = String(c).trim().toUpperCase() }
  }
  const next = max + 1
  return { code: `${prefix.toUpperCase()}${String(next).padStart(4, '0')}`, after, max }
}

export interface Blocker { id: string; full_name: string; status: string; created_at: string }

/** Among onboardings of one company without a code yet, the ones that arrived before `created_at` (the queue ahead). */
export function queueAhead<T extends { id: string; created_at: string; status: string; employee_code?: string | null; company_id?: string | null }>(all: T[], me: T): T[] {
  return all
    .filter(c => c.id !== me.id && (c.company_id ?? null) === (me.company_id ?? null) && c.status !== 'EMPLOYEE_CREATED' && !c.employee_code)
    .filter(c => c.created_at < me.created_at || (c.created_at === me.created_at && c.id < me.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

/** The next code for a company: every employee code of the company plus every code an onboarding already reserved. */
export async function nextCompanyCode(sb: SupabaseClient, companyId: string, companyCode: string): Promise<{ code: string; after: string | null; max: number }> {
  const prefix = (companyCode || 'EZ').toUpperCase()
  const [{ data: emps }, { data: ocs }] = await Promise.all([
    sb.from('employees').select('emp_code').eq('company_id', companyId).not('emp_code', 'is', null).limit(10000),
    sb.from('onboarding_candidates').select('employee_code').eq('company_id', companyId).not('employee_code', 'is', null).limit(10000),
  ])
  return nextInSeries([...((emps || []) as any[]).map(e => e.emp_code), ...((ocs || []) as any[]).map(o => o.employee_code)], prefix)
}

/** Who is ahead of this onboarding in the company's queue (empty = may generate now). */
export async function queueAheadOf(sb: SupabaseClient, onboardingId: string): Promise<{ me: Blocker & { company_id: string | null } | null; ahead: Blocker[] }> {
  const { data: me } = await sb.from('onboarding_candidates').select('id, full_name, status, created_at, company_id, employee_code').eq('id', onboardingId).maybeSingle()
  if (!me) return { me: null, ahead: [] }
  if (!CODE_QUEUE_ENFORCED) return { me: me as any, ahead: [] }
  const { data: all } = await sb.from('onboarding_candidates').select('id, full_name, status, created_at, company_id, employee_code').eq('company_id', me.company_id).neq('status', 'EMPLOYEE_CREATED').is('employee_code', null).lte('created_at', me.created_at).order('created_at').limit(500)
  const ahead = queueAhead((all || []) as any[], me as any).map(c => ({ id: c.id, full_name: c.full_name, status: c.status, created_at: c.created_at }))
  return { me: me as any, ahead }
}
