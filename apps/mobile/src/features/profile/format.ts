// src/features/profile/format.ts — the value helpers at the top of the
// website's components/profile/Profile360.tsx, copied verbatim (that file is a
// React component, so it cannot be imported through @web).
//
//   key MISSING from the payload  ->  "Restricted"  (not yours to see)
//   key present but null/empty    ->  "-"           (nobody filled it in)

export const val = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** Profile360 pretty(): a value starting YYYY-MM-DD becomes "05 Sep 2026" (en-IN). */
export const pretty = (v: unknown): string => {
  const s = val(v)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const money = (v: unknown): string => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN') : val(v)
}

/** policy_no -> "Policy No." */
export const titleise = (k: string) =>
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNo\b/, 'No.')

export const ini = (n: unknown) =>
  String(n || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

/** components/profile/ChangeRequests.tsx when(). */
export const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** EmployeePortal.tsx fmt() — used by Letter Requests and My Letters. */
export const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

/** Profile360 tidy(): a completeness sentence from the database may carry an
 *  em dash ("Add a gratuity nominee — the shares must total 100%"); the app's
 *  copy has none, so it reads as two sentences. fixActionFor() gets the original. */
export const tidy = (s: string) => s.replace(/\s+[—–]\s+(\w)/g, (_, c: string) => `. ${c.toUpperCase()}`)

/** Profile360 nextOf(): the next time a date's day and month come round. */
export function nextOf(iso: unknown): { date: Date; days: number; years: number } | null {
  const s = String(iso ?? '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s); if (isNaN(d.getTime())) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const n = new Date(t.getFullYear(), d.getMonth(), d.getDate())
  if (n < t) n.setFullYear(n.getFullYear() + 1)
  return { date: n, days: Math.round((n.getTime() - t.getTime()) / 86400000), years: n.getFullYear() - d.getFullYear() }
}
export const inDays = (n: number) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
export const dm = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
