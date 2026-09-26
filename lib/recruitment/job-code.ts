// lib/recruitment/job-code.ts — auto-generated MRF job codes: DEPT-DESIG-NN
// (department code · designation abbreviation · running number within the company).
// Shared by the ESS form (live preview), the legacy recruitment form and the API, so
// the preview a raiser sees is exactly what gets saved.

/** "Backend Engineer" → "BE", "Engineer" → "ENG", "Sr. Data Analyst" → "SDA". */
export function jobCodeAbbr(designation: string): string {
  const words = String(designation || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'GEN'
  const a = words.length >= 2 ? words.map(w => w[0]).join('') : words[0].slice(0, 3)
  return a.toUpperCase().slice(0, 4)
}

/** Department code cleaned to A-Z0-9 (falls back to the first 3 letters of the name, then GEN). */
export function jobCodeDept(deptCode?: string | null, deptName?: string | null): string {
  const raw = (deptCode || (deptName || '').slice(0, 3) || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw || 'GEN'
}

export function jobCodePrefix(deptCode: string | null | undefined, deptName: string | null | undefined, designation: string): string {
  return `${jobCodeDept(deptCode, deptName)}-${jobCodeAbbr(designation)}-`
}

/** Next code for a prefix given the codes already in use (max sequence + 1, min 2 digits). */
export function nextJobCode(prefix: string, existing: (string | null | undefined)[]): string {
  let max = 0
  for (const c of existing) {
    const s = String(c || '')
    if (!s.toUpperCase().startsWith(prefix.toUpperCase())) continue
    const n = parseInt(s.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

/** Requisition number in the same shape as the DB default (MRF-YYYY-NNNNN), so the form can
 *  show it while the raiser is still filling in the MRF and save exactly that number. */
export function newMrfNumber(year: number = new Date().getFullYear()): string {
  return `MRF-${year}-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`
}
