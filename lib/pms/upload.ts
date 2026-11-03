// lib/pms/upload.ts — bulk final-rating upload. Spec §6.4.
//
// For offline calibration and legacy migration. It is the one path in the
// module that lets a human overwrite a computed rating, so it is also the one
// that most needs a paper trail.
//
// THE COMMIT IS BLOCKED UNTIL THERE ARE ZERO ERRORS. Not "warns and lets you
// through" — blocked. A half-applied rating upload leaves some people on the
// system's number and some on the spreadsheet's, with nothing on screen to
// say which is which.
//
// An override reason is MANDATORY whenever the uploaded rating differs from
// the computed one (rule 13). Without it, `pms_rating_upload_log` records
// that a number changed and nothing about why, which is exactly the row
// somebody will be asked to explain a year later.

export const TEMPLATE_COLUMNS = [
  'employee_code', 'period_code', 'final_rating', 'appreciation_remark',
  'improvement_feedback', 'additional_benefit_type', 'additional_benefit_note',
  'finalised_by_code', 'override_reason',
] as const

export type UploadError =
  | 'ERROR_NOT_FOUND'      // employee_code or period_code does not exist
  | 'ERROR_NOT_ELIGIBLE'   // not in this period, or already read-only
  | 'ERROR_REASON_MISSING' // rating differs from computed, no override_reason
  | 'ERROR_INVALID_RATING' // outside the policy's rating scale

export const ERROR_TEXT: Record<UploadError, string> = {
  ERROR_NOT_FOUND: 'No employee or period matches this row.',
  ERROR_NOT_ELIGIBLE: 'This person is not eligible in this period, or their record is already locked.',
  ERROR_REASON_MISSING: 'The rating differs from the computed one, so a reason is required.',
  ERROR_INVALID_RATING: 'That rating is not on this policy’s scale.',
}

export interface UploadRow {
  employee_code?: string | null
  period_code?: string | null
  final_rating?: string | number | null
  override_reason?: string | null
  improvement_feedback?: string | null
  [k: string]: unknown
}

export interface Known {
  /** employee_code -> the computed rating and eligibility for that period. */
  lookup: (empCode: string, periodCode: string) =>
    | { computed: number | null; eligible: boolean; readOnly: boolean }
    | null
  /** Valid rating values on the policy's scale, e.g. [1,2,3,4,5]. */
  scale: number[]
  /** Bands at or below which improvement feedback is mandatory (rule 10). */
  improvementMandatoryAtOrBelow?: number | null
}

export interface Checked {
  row: UploadRow
  line: number
  errors: UploadError[]
  warnings: string[]
  computed: number | null
  uploaded: number | null
  /** uploaded − computed, when both are known. The number a reviewer scans. */
  delta: number | null
}

export interface Preview {
  rows: Checked[]
  errorCount: number
  changedCount: number
  /** The only thing the commit button should look at. */
  canCommit: boolean
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function checkUpload(rows: UploadRow[], known: Known): Preview {
  const checked: Checked[] = rows.map((row, i) => {
    const errors: UploadError[] = []
    const warnings: string[] = []
    const emp = String(row.employee_code ?? '').trim()
    const per = String(row.period_code ?? '').trim()
    const uploaded = num(row.final_rating)

    const found = emp && per ? known.lookup(emp, per) : null
    if (!emp || !per || !found) errors.push('ERROR_NOT_FOUND')
    else if (!found.eligible || found.readOnly) errors.push('ERROR_NOT_ELIGIBLE')

    if (uploaded === null || !known.scale.includes(uploaded)) {
      errors.push('ERROR_INVALID_RATING')
    }

    const computed = found?.computed ?? null
    const delta = uploaded !== null && computed !== null ? uploaded - computed : null

    // A reason is owed when the number CHANGES. Uploading the same rating the
    // system already produced is a no-op, not an override, and demanding a
    // reason for it would train people to type "n/a" — which is worse than
    // no field at all.
    const changed = delta !== null && delta !== 0
    if (changed && !String(row.override_reason ?? '').trim()) {
      errors.push('ERROR_REASON_MISSING')
    }

    // Rule 10, as a warning rather than a block: the upload path is for
    // calibration, and stopping a whole file over a missing sentence would
    // push people back to editing the database by hand.
    const bar = known.improvementMandatoryAtOrBelow
    if (bar !== null && bar !== undefined && uploaded !== null && uploaded <= bar
        && !String(row.improvement_feedback ?? '').trim()) {
      warnings.push(`Rating ${uploaded} normally requires improvement feedback.`)
    }
    if (delta !== null && Math.abs(delta) >= 2) {
      warnings.push(`Moves the rating by ${Math.abs(delta)} bands.`)
    }

    return { row, line: i + 2, errors, warnings, computed, uploaded, delta }
  })

  const errorCount = checked.filter(c => c.errors.length).length
  return {
    rows: checked,
    errorCount,
    changedCount: checked.filter(c => c.delta !== null && c.delta !== 0).length,
    canCommit: errorCount === 0 && checked.length > 0,
  }
}

/** One line an admin can act on, rather than a count they have to interpret. */
export function summarise(p: Preview): string {
  if (!p.rows.length) return 'That file has no rows.'
  if (p.errorCount) {
    return `${p.errorCount} of ${p.rows.length} rows cannot be applied. `
         + 'Fix them in the file and upload it again. Nothing is committed until every row is clean.'
  }
  if (!p.changedCount) {
    return `${p.rows.length} rows, none of which change a rating. Committing this does nothing.`
  }
  return `${p.rows.length} rows ready. ${p.changedCount} would change a rating, `
       + 'each with a reason recorded against it.'
}

// ── one employee at a time ───────────────────────────────────────────────
//
// Requested: "final rating can be uploaded in bulk or hr can also give
// rating per employee basis using their employee code and name."
//
// THE SAME ENGINE, A BATCH OF ONE. Everything below produces an UploadRow
// and hands it to checkUpload and the same commit RPC. That is the whole
// design: a second write path would be a second set of rules, and the
// moment they disagreed the single-employee route would become the way to
// get a rating past a check the bulk route enforces — eligibility, the
// locked record, the scale, the reason for an override, the audit row.
//
// The screen is different because the work is different. A file is checked
// in bulk and applied; one person is looked up by code or name, against a
// rating the reviewer can see before they change it.

/** One enrolled person, as the picker needs them. */
export interface Candidate {
  code: string
  name: string
  /** The rating on record now, so a reviewer sees what they are replacing. */
  rating: number | null
  flag: string | null
  periodCode: string | null
}

/**
 * Find people by employee code OR name.
 *
 * AN EMPTY QUERY MATCHES NOBODY, deliberately. Returning the whole roster
 * to an empty box invites picking the first row of 133 by accident, and
 * this control overwrites a final rating.
 *
 * Code prefix first, then name prefix, then anything containing the text —
 * because somebody who types a full code knows exactly who they mean, and
 * making them scan partial name matches to find it is the difference
 * between a lookup and a search.
 *
 * THERE IS NO SEPARATE "EXACT MATCH" RANK, and there was: it could never
 * change an answer. Any other code sharing the typed prefix is longer, so
 * the alphabetical tie-break inside the prefix rank already puts the exact
 * one first — "SRS9003" before "SRS90031". A mutation test proved the
 * branch dead by removing it and changing no result, so it is gone rather
 * than kept as a rule nothing can observe.
 */
export function searchEnrolled(
  rows: { employee_code?: string | null; employee_name?: string | null
          final_rating?: number | null; employment_flag?: string | null
          period_code?: string | null }[] | null | undefined,
  query: string,
  limit = 8,
): Candidate[] {
  const q = (query ?? '').trim().toUpperCase()
  if (!q) return []
  const scored: { c: Candidate; rank: number }[] = []
  for (const r of rows ?? []) {
    const code = String(r.employee_code ?? '').trim()
    const name = String(r.employee_name ?? '').trim()
    if (!code && !name) continue
    const C = code.toUpperCase(), N = name.toUpperCase()
    const rank = C.startsWith(q) ? 0
               : N.startsWith(q) ? 1
               : C.includes(q) || N.includes(q) ? 2
               : -1
    if (rank < 0) continue
    scored.push({ rank, c: {
      code, name,
      rating: r.final_rating === null || r.final_rating === undefined
        ? null : Number(r.final_rating),
      flag: r.employment_flag ?? null,
      periodCode: r.period_code ?? null,
    } })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.c.code.localeCompare(b.c.code))
    .slice(0, limit)
    .map(x => x.c)
}

/**
 * One person's entry, in the shape the bulk file uses.
 *
 * Built with the template's own column names so checkUpload and the commit
 * RPC cannot tell it apart from a row that arrived in a CSV — which is the
 * point: they must not be able to.
 */
export function oneRow(entry: {
  employeeCode: string
  periodCode?: string | null
  finalRating: number | string | null
  overrideReason?: string | null
  improvementFeedback?: string | null
  appreciation?: string | null
}): UploadRow {
  const t = (v: string | null | undefined) => {
    const s = (v ?? '').trim()
    return s ? s : null
  }
  return {
    employee_code: entry.employeeCode.trim(),
    period_code: t(entry.periodCode),
    final_rating: entry.finalRating,
    override_reason: t(entry.overrideReason),
    improvement_feedback: t(entry.improvementFeedback),
    appreciation_remark: t(entry.appreciation),
  }
}
