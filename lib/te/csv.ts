// lib/te/csv.ts — rows to CSV text, for the bank file and the claim register.
//
// PURE (unit-tested). Two things a naive join gets wrong:
//   · a cell with a comma, a quote or a line break must be quoted, and quotes doubled
//   · a cell that starts with = + - or @ is run as a FORMULA by Excel and Google
//     Sheets when the file is opened. A merchant name or a claim note is typed by
//     an employee, so such a cell is prefixed with an apostrophe, which
//     spreadsheets show as plain text. Numbers are left alone so they still add up.
export type CsvCell = string | number | boolean | null | undefined

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** columns = [key, heading]. Lines end with CRLF, which is what RFC 4180 and Excel expect. */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: [keyof T & string, string][]): string {
  const head = columns.map(c => csvCell(c[1])).join(',')
  const body = rows.map(r => columns.map(c => csvCell(r[c[0]] as CsvCell)).join(','))
  return [head, ...body].join('\r\n') + '\r\n'
}
