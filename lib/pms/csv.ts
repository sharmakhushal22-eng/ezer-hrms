// lib/pms/csv.ts — reading and writing CSV, in one place.
//
// WHY THIS IS NOT INLINE IN THE SCREENS THAT USE IT
//
// Both directions are used by §6: the Fill Status Tracker writes a chase
// list, and the Final Rating Upload reads a filled-in template. Both were
// written naively and separately, and the reading half was wrong.
//
// A CSV mistake does not throw. The file opens, the columns line up visually
// because the header is fine, and every cell after a stray comma belongs to
// the wrong heading. For the upload that is not cosmetic: override_reason is
// the LAST template column, so a comma anywhere in appreciation_remark pushes
// a fragment of prose into it. ERROR_REASON_MISSING then passes — the cell is
// not empty, it just says "and the Kanpur lane" — and that fragment is what
// the audit log keeps as the justification for overriding somebody's
// appraisal. Four of the nine template columns are free prose.
//
// So the rules live here, next to each other, where a round-trip test can
// prove the writer and the reader agree. RFC 4180 throughout.

/**
 * One cell, quoted exactly when leaving it bare would break the row.
 *
 * Over-quoting is harmless to Excel but makes a diff of two exports
 * unreadable, so only the three characters that actually force it do.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A whole CSV, header included, newline-terminated. */
export function csvText(head: string[], rows: unknown[][]): string {
  return [head.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))]
    .join('\n') + '\n'
}

/**
 * Split one CSV line into cells, honouring quotes.
 *
 * Returns null when the line ends inside an open quote, which means the
 * record continues on the next physical line — a prose cell with a newline in
 * it. The caller joins and retries rather than treating it as a short row.
 */
function splitLine(line: string): string[] | null {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        // A doubled quote is one literal quote; a lone one closes the field.
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else if (c === '"') {
      inQ = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else cur += c
  }
  if (inQ) return null
  out.push(cur)
  return out
}

/**
 * Parse a CSV into records keyed by the header row.
 *
 * Handles quoted commas, doubled quotes, embedded newlines, CRLF, and a
 * UTF-8 BOM — which Excel writes on every file it saves, and which otherwise
 * becomes part of the first header name, so `employee_code` silently stops
 * matching and every row reports ERROR_NOT_FOUND.
 *
 * Blank lines are skipped, but ONLY outside a quoted cell: a blank line
 * inside a remark is part of the remark.
 */
export function parseCsv<T = Record<string, string>>(text: string): T[] {
  const body = text.replace(/^﻿/, '')
  const physical = body.split(/\r\n|\n|\r/)
  // Re-join lines that were split inside a quoted cell.
  const records: string[] = []
  let pending: string | null = null
  for (const line of physical) {
    // Annotated: without it TS infers `candidate` circularly through
    // `pending = candidate` below and falls back to any.
    const candidate: string = pending === null ? line : pending + '\n' + line
    if (splitLine(candidate) === null) { pending = candidate; continue }
    pending = null
    records.push(candidate)
  }
  // An unterminated quote at end of file: keep what there is rather than
  // dropping the row silently.
  if (pending !== null) records.push(pending + '"')

  const rows = records.filter(r => r.trim() !== '')
  if (rows.length < 2) return []
  const head = (splitLine(rows[0]) ?? []).map(h => h.trim())
  return rows.slice(1).map(line => {
    const cells = splitLine(line) ?? []
    const row: Record<string, string> = {}
    head.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row as unknown as T
  })
}
