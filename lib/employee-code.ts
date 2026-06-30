// lib/employee-code.ts
// Type-wise employee code helpers — prefix = company_code + type suffix, then
// a 4-digit zero-padded sequence (NO hyphen). e.g. SSM0001, SSMINT0001, SSMNAP0003.

/** Type suffix for each employment type (Employee has none). */
export const TYPE_SUFFIX: Record<string, string> = {
  'Employee':   '',
  'Intern':     'INT',
  'NAPS':       'NAP',
  'NATS':       'NAT',
  'Consultant': 'CON',
  'Contract':   'CTR',
}

/** Build an employee code, e.g. buildEmpCode('SSM','Intern',1) → 'SSMINT0001'. */
export function buildEmpCode(companyCode: string, employmentType: string, sequence: number): string {
  const suffix = TYPE_SUFFIX[employmentType] ?? ''
  const prefix = `${companyCode.toUpperCase()}${suffix}`
  return `${prefix}${String(sequence).padStart(4, '0')}`
}

/** True if `code` is a valid EZER employee code (letters + 4-digit sequence, no hyphen). */
export function isValidEmpCode(code: string): boolean {
  return /^[A-Z]{2,11}\d{4}$/.test(code)
}

/** Parse a code back to its parts. Returns null if the format doesn't match. */
export function parseEmpCode(code: string): {
  companyCode: string; typeSuffix: string; employmentType: string; sequence: number
} | null {
  const m = code.match(/^([A-Z]+)(\d{4})$/)
  if (!m) return null
  const [, letters, num] = m
  // detect a known 3-letter type suffix at the end of the letters
  const suffixes = Object.values(TYPE_SUFFIX).filter(Boolean)
  const typeSuffix = suffixes.find(s => letters.endsWith(s)) || ''
  const companyCode = typeSuffix ? letters.slice(0, -typeSuffix.length) : letters
  const employmentType = Object.entries(TYPE_SUFFIX).find(([, v]) => v === typeSuffix)?.[0] || 'Employee'
  return { companyCode, typeSuffix, employmentType, sequence: parseInt(num, 10) }
}
