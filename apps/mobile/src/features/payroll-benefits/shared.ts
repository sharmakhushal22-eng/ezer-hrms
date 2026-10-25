// src/features/payroll-benefits/shared.ts — helpers shared by the Voluntary PF,
// Corporate NPS, Loans and Travel Claims screens.
//
// Formatting is copied from the website so every figure reads the same:
//   · money  — `'₹' + Math.round(n || 0).toLocaleString('en-IN')` (EmployeePortal.tsx
//     `inr` / `loanInr`, TravelClaims.tsx `inr`). Indian grouping is done by hand so
//     the result never depends on the phone's Intl data.
//   · dates  — EmployeePortal.tsx `fmt` / TravelClaims.tsx `dmy`: "05 Oct 2026".
import { ApiError, api, type ApiOptions } from '@/core/api'
import { parseYmd } from '@/ui/overlays'

/** Query-key prefix for everything this module caches. */
export const QK = 'payroll-benefits'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')

/** 1,23,45,678 — en-IN digit grouping. */
export function groupIN(n: number): string {
  const neg = n < 0
  let s = String(Math.abs(Math.round(n)))
  if (s.length > 3) {
    const last3 = s.slice(-3)
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
    s = rest + ',' + last3
  }
  return (neg ? '-' : '') + s
}

/** '₹' + Math.round(n || 0).toLocaleString('en-IN') */
export const inr = (n: unknown) => '₹' + groupIN(Math.round(Number(n) || 0))

/** A date column (or ISO timestamp) as a local Date. 'YYYY-MM-DD' is read as a local day. */
function toDate(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseYmd(s)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) → "05 Oct 2026"; '-' when empty. */
export function dmy(s?: string | null): string {
  if (!s) return '-'
  const d = toDate(s)
  return d ? `${pad(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : '-'
}

/** toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) → "1 November 2026". */
export function longDate(s?: string | null): string {
  const d = s ? toDate(s) : null
  return d ? `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : 'Invalid Date'
}

/** toLocaleDateString('en-IN') → "22/10/2026". */
export function numDate(s?: string | null): string {
  const d = s ? toDate(s) : null
  return d ? `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` : '-'
}

/** TravelClaims.tsx `kb`. */
export const kb = (n: number | null | undefined) => n == null ? '' : n < 1024 ? `${n} B`
  : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

/**
 * fetch()-style call: resolves with { ok, status, body } for every HTTP answer,
 * so each screen can apply the website's own fallbacks (`d.error || 'Failed'`).
 * Only a network failure throws (ApiError with status 0).
 */
export async function call<T = any>(path: string, opts: ApiOptions = {}): Promise<{ ok: boolean; status: number; body: T & Record<string, any> }> {
  try {
    const body = await api<any>(path, opts)
    return { ok: true, status: 200, body: (body && typeof body === 'object' ? body : {}) as any }
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) {
      return { ok: false, status: e.status, body: (e.body && typeof e.body === 'object' ? e.body : {}) as any }
    }
    throw e
  }
}

/** True for "no connection" — the one failure the website has no copy for. */
export const isNetwork = (e: unknown) => e instanceof ApiError && e.status === 0
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
