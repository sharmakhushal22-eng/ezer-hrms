// lib/exit/notice.ts — pure. The notice period an employee serves depends on probation:
//   on probation (the first 6 months, or confirmation_status = Probation)  → 30 days
//   confirmed                                                              → 60 days
// The same rule lives in SQL (migration 169, fn_resignation_submit) for the policy last
// working day; this is what the ESS Exit form, the employee record and the daily sync show.

export const PROBATION_MONTHS = 6
export const PROBATION_NOTICE_DAYS = 30
export const CONFIRMED_NOTICE_DAYS = 60

export interface NoticeFacts { confirmation_status?: string | null; company_doj?: string | null; group_doj?: string | null; probation_months?: number | null; confirmation_date?: string | null }

/** True while the employee is on probation: the status says so, or (status unknown) the probation months since joining have not passed. */
export function onProbation(e: NoticeFacts, now = new Date()): boolean {
  const st = String(e.confirmation_status || '').trim().toLowerCase()
  if (st === 'probation') return true
  if (st === 'confirmed' || st === 'permanent') return false
  if (e.confirmation_date && new Date(e.confirmation_date).getTime() <= now.getTime()) return false
  const doj = e.company_doj || e.group_doj
  if (!doj) return false
  const end = new Date(String(doj).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(end.getTime())) return false
  end.setUTCMonth(end.getUTCMonth() + (Number(e.probation_months) > 0 ? Number(e.probation_months) : PROBATION_MONTHS))
  return now.getTime() < end.getTime()
}

export function effectiveNoticeDays(e: NoticeFacts, now = new Date()): number {
  return onProbation(e, now) ? PROBATION_NOTICE_DAYS : CONFIRMED_NOTICE_DAYS
}

export const noticeLabel = (e: NoticeFacts, now = new Date()) => `${effectiveNoticeDays(e, now)} days (${onProbation(e, now) ? 'on probation' : 'confirmed'})`
