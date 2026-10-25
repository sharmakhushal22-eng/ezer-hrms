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
  return Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN') : val(v)
}

/** policy_no -> "Policy No." */
export const titleise = (k: string) =>
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNo\b/, 'No.')

export const ini = (n: unknown) =>
  String(n || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

/** Profile360 routeNote(): where a change request goes, and what it sets off. */
export function routeNote(key: string): string {
  if (/^bank|ifsc/.test(key))
    return 'Goes to Payroll, not HR. It applies from the next salary batch, and they may ask for a cancelled cheque in the same name.'
  if (/address/.test(key))
    return 'Goes to HR. An address change also moves your Professional Tax state and HRA exemption from the next payroll month.'
  if (/marital|spouse/.test(key))
    return 'Goes to HR. It opens the family, nominee and insurance steps behind it. A nomination must total exactly 100% before it can be filed.'
  if (/passport/.test(key))
    return 'Goes to HR. Passport details are readable only by HR and Payroll.'
  return 'Goes to HR. You will see the outcome in your change history.'
}

/** components/profile/ChangeRequests.tsx when() — the device locale, as on the web. */
export const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** EmployeePortal.tsx fmt() — used by Letter Requests and My Letters. */
export const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
