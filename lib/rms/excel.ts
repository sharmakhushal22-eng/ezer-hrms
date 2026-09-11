// lib/rms/excel.ts — reading the org-chart workbook.
//
// The sheet is not the flat template the other seven uploaders use. It has TWO header
// rows: a merged band naming ten blocks, and under it a repeating Code / Name / Email id
// triple for each block. Three of the blocks are reporting levels, seven name the person
// who holds a functional role.
//
//   row 0 |           |  Reportinmg manager L1  |        |  HR Manager  | ...
//   row 1 | Emp Code  |  Code | Name | Email id |        | Code | Name  | ...
//   row 2 | SRS0001   |  SRS0001 | aadhar | ...
//
// Two encodings in that data would corrupt the hierarchy if taken literally, and both
// are documented on the workbook's own "Logic & Assumptions" sheet:
//
//   1. The top of a chain carries ITS OWN record in L1, L2 and HOD rather than being
//      left blank. Read literally that is 26 people who manage themselves.
//   2. Where a level collapses — L1 is already the HOD, say — the same person is
//      repeated in the higher columns rather than the cell being left empty.
//
// So a cell pointing at the employee themselves means "nobody above me", and a level
// repeating the person already named on a lower level means "this level does not exist
// for me". Everything here is pure, so both rules can be tested directly.
import { roleCodeForExcelName, normaliseRoleName } from './modules.ts'
import { isRelationshipType, type RelationshipType } from './hierarchy.ts'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  row: number | null          // 1-based row number in the sheet, as the user sees it
  emp_code: string | null
  severity: Severity
  code: string
  message: string
}

export interface GroupDef {
  label: string               // exactly as written in the sheet
  startCol: number
  kind: 'hierarchy' | 'role' | 'unknown'
  level?: RelationshipType    // when kind === 'hierarchy'
  roleCode?: string           // when kind === 'role'
}

export interface OrgRow {
  row: number
  emp_code: string
  full_name: string
  designation: string
  grade: string
  department: string
  location: string
  company: string
  employment_type: string
  office_email: string
  personal_email: string
  /** Level -> manager employee code, already cleaned of the two encodings above. */
  hierarchy: Partial<Record<RelationshipType, string>>
  /** ess_roles code -> the employee code named as holding it on this row. */
  roleHolders: Record<string, string>
}

export interface ParsedSheet {
  groups: GroupDef[]
  rows: OrgRow[]
  /** role code -> the set of employee codes named as holding it anywhere in the sheet. */
  roleHolders: Record<string, string[]>
  issues: Issue[]
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

/** Is this band a reporting level, a functional role, or something we do not know? */
export function classifyGroup(label: string): Pick<GroupDef, 'kind' | 'level' | 'roleCode'> {
  const n = normaliseRoleName(label)
  if (!n) return { kind: 'unknown' }
  // "HOD", "Head of Department"
  if (n === 'hod' || n.endsWith(' hod') || n.startsWith('hod ')) {
    return { kind: 'hierarchy', level: 'HOD' }
  }
  // "Reportinmg manager L1" (the sheet's own spelling), "Reporting Manager 2", "L3"
  const m = n.match(/l\s*([1-4])$/) || n.match(/manager\s*([1-4])$/)
  if (m) {
    const lvl = `L${m[1]}`
    if (isRelationshipType(lvl)) return { kind: 'hierarchy', level: lvl }
  }
  const code = roleCodeForExcelName(label)
  return code ? { kind: 'role', roleCode: code } : { kind: 'unknown' }
}

/** Find the ten blocks from the merged band in row 0, confirming each against row 1
 *  rather than assuming a Code / Name / Email id layout. */
export function detectGroups(bandRow: unknown[], headerRow: unknown[]): { groups: GroupDef[]; issues: Issue[] } {
  const groups: GroupDef[] = []
  const issues: Issue[] = []
  for (let i = 0; i < bandRow.length; i++) {
    const label = s(bandRow[i])
    if (!label) continue
    const under = normaliseRoleName(s(headerRow[i]))
    if (under !== 'code') {
      issues.push({
        row: 2, emp_code: null, severity: 'warning', code: 'GROUP_LAYOUT',
        message: `Block "${label}" starts at column ${i + 1} but the cell under it reads "${s(headerRow[i]) || '(blank)'}" rather than "Code" — the block was skipped.`,
      })
      continue
    }
    const cls = classifyGroup(label)
    if (cls.kind === 'unknown') {
      issues.push({
        row: 1, emp_code: null, severity: 'warning', code: 'UNKNOWN_GROUP',
        message: `Block "${label}" is neither a reporting level nor a role this application knows. It was ignored.`,
      })
    }
    groups.push({ label, startCol: i, ...cls })
  }
  return { groups, issues }
}

/**
 * Parse the whole sheet.
 *
 * `grid` is the sheet as a 2-D array, row 0 first — exactly what
 * `XLSX.utils.sheet_to_json(ws, { header: 1 })` produces.
 */
export function parseOrgSheet(grid: unknown[][]): ParsedSheet {
  const issues: Issue[] = []
  if (!grid || grid.length < 3) {
    return { groups: [], rows: [], roleHolders: {}, issues: [{ row: null, emp_code: null, severity: 'error', code: 'EMPTY', message: 'The sheet has no data rows.' }] }
  }

  const band = grid[0] || []
  const header = grid[1] || []
  const { groups, issues: gIssues } = detectGroups(band, header)
  issues.push(...gIssues)

  if (!groups.some(g => g.kind === 'hierarchy')) {
    issues.push({ row: 1, emp_code: null, severity: 'error', code: 'NO_HIERARCHY', message: 'No reporting-level block (L1 / L2 / HOD) was found in the top header row.' })
  }

  // Base columns are found by name so a reordered sheet still imports.
  const idx: Record<string, number> = {}
  header.forEach((h, i) => {
    const n = normaliseRoleName(s(h))
    if (n && !(n in idx)) idx[n] = i
  })
  const col = (...names: string[]) => {
    for (const n of names) if (n in idx) return idx[n]
    return -1
  }
  const cEmp = col('emp code', 'employee code', 'employee id', 'code')
  if (cEmp < 0) {
    issues.push({ row: 2, emp_code: null, severity: 'error', code: 'NO_EMP_CODE', message: 'No "Emp Code" column was found in the header row.' })
    return { groups, rows: [], roleHolders: {}, issues }
  }
  const cName = col('full name', 'name', 'employee name')
  const cDesig = col('designation')
  const cGrade = col('grade')
  const cDept = col('department')
  const cLoc = col('location')
  const cComp = col('company')
  const cType = col('employment type')
  const cOff = col('office email')
  const cPers = col('personal email')

  const at = (r: unknown[], i: number) => (i >= 0 ? s(r[i]) : '')

  const rows: OrgRow[] = []
  const seenCodes = new Map<string, number>()
  const seenEmails = new Map<string, string[]>()
  const seenNames = new Map<string, string[]>()
  const roleHolders: Record<string, Set<string>> = {}

  for (let r = 2; r < grid.length; r++) {
    const raw = grid[r] || []
    const rowNo = r + 1                              // 1-based, as the spreadsheet shows it
    const code = at(raw, cEmp)
    if (!code) {
      if (raw.some(v => s(v))) {
        issues.push({ row: rowNo, emp_code: null, severity: 'error', code: 'MISSING_EMP_CODE', message: 'Row has data but no employee code, so it cannot be matched to anybody. Skipped.' })
      }
      continue
    }
    if (seenCodes.has(code)) {
      issues.push({ row: rowNo, emp_code: code, severity: 'error', code: 'DUPLICATE_EMP_CODE', message: `Employee code ${code} already appeared on row ${seenCodes.get(code)}. This row was skipped.` })
      continue
    }
    seenCodes.set(code, rowNo)

    const name = at(raw, cName)
    if (name) {
      const key = name.toLowerCase()
      seenNames.set(key, [...(seenNames.get(key) || []), code])
    }
    const pers = at(raw, cPers)
    if (pers) {
      const key = pers.toLowerCase()
      seenEmails.set(key, [...(seenEmails.get(key) || []), code])
    }

    // ── the ten blocks ───────────────────────────────────────────────────────
    const hierarchy: Partial<Record<RelationshipType, string>> = {}
    const rowRoles: Record<string, string> = {}

    for (const g of groups) {
      const holder = at(raw, g.startCol)
      if (!holder) continue

      if (g.kind === 'role' && g.roleCode) {
        rowRoles[g.roleCode] = holder
        ;(roleHolders[g.roleCode] ||= new Set()).add(holder)
        continue
      }
      if (g.kind !== 'hierarchy' || !g.level) continue

      // Encoding 1 — pointing at yourself means there is nobody above you.
      if (holder === code) continue
      hierarchy[g.level] = holder
    }

    // Encoding 2 — a level that merely repeats somebody already named lower down does
    // not exist for this employee. Walk the levels in order so L2 is compared against L1,
    // and so on.
    //
    // HOD is deliberately NOT part of this collapse. "Who heads my department" is a fact
    // on its own, independent of the reporting chain — it stays true even when the head
    // happens to also be this employee's L1 or L2. Dropping it whenever it matched a
    // lower level was hiding a real answer behind an encoding meant for the chain, not
    // for department headship.
    const ordered: RelationshipType[] = ['L1', 'L2', 'L3', 'L4']
    const kept: string[] = []
    for (const lvl of ordered) {
      const v = hierarchy[lvl]
      if (!v) continue
      if (kept.includes(v)) delete hierarchy[lvl]
      else kept.push(v)
    }

    rows.push({
      row: rowNo,
      emp_code: code,
      full_name: name,
      designation: at(raw, cDesig),
      grade: at(raw, cGrade),
      department: at(raw, cDept),
      location: at(raw, cLoc),
      company: at(raw, cComp),
      employment_type: at(raw, cType),
      office_email: at(raw, cOff),
      personal_email: pers,
      hierarchy,
      roleHolders: rowRoles,
    })
  }

  // ── whole-sheet checks ─────────────────────────────────────────────────────
  const codes = new Set(rows.map(r => r.emp_code))

  for (const r of rows) {
    for (const [lvl, mgr] of Object.entries(r.hierarchy)) {
      if (!codes.has(mgr)) {
        issues.push({ row: r.row, emp_code: r.emp_code, severity: 'error', code: 'MANAGER_NOT_IN_SHEET', message: `${lvl} is ${mgr}, who does not appear as an employee anywhere in this sheet.` })
      }
    }
  }
  for (const [code, holders] of Object.entries(roleHolders)) {
    for (const h of holders) {
      if (!codes.has(h)) {
        issues.push({ row: null, emp_code: h, severity: 'error', code: 'ROLE_HOLDER_NOT_IN_SHEET', message: `${h} is named as holding ${code} but does not appear as an employee in this sheet.` })
      }
    }
    if (holders.size > 1) {
      issues.push({ row: null, emp_code: null, severity: 'info', code: 'MULTIPLE_ROLE_HOLDERS', message: `${code} is held by ${holders.size} people: ${[...holders].join(', ')}.` })
    }
  }
  for (const [email, owners] of seenEmails) {
    if (owners.length > 1) {
      issues.push({ row: null, emp_code: null, severity: 'warning', code: 'DUPLICATE_EMAIL', message: `Personal email ${email} is shared by ${owners.length} employees (${owners.join(', ')}). Matching is done on employee code, so the import is unaffected.` })
    }
  }
  const repeatedNames = [...seenNames.entries()].filter(([, v]) => v.length > 1)
  if (repeatedNames.length) {
    issues.push({ row: null, emp_code: null, severity: 'info', code: 'DUPLICATE_NAMES', message: `${repeatedNames.length} names are used by more than one employee. Employee code is used throughout, so names are never matched on.` })
  }

  // ── cycle detection, per level ─────────────────────────────────────────────
  for (const lvl of ['L1', 'L2', 'L3', 'L4', 'HOD'] as RelationshipType[]) {
    const edges = new Map<string, string>()
    for (const r of rows) if (r.hierarchy[lvl]) edges.set(r.emp_code, r.hierarchy[lvl]!)
    for (const start of edges.keys()) {
      const seen = new Set<string>([start])
      let cur = start
      for (let i = 0; i < 64; i++) {
        const next = edges.get(cur)
        if (!next) break
        if (seen.has(next)) {
          issues.push({ row: null, emp_code: start, severity: 'error', code: 'CIRCULAR_HIERARCHY', message: `${lvl} chain starting at ${start} loops back to ${next}.` })
          break
        }
        seen.add(next)
        cur = next
      }
    }
  }

  return {
    groups,
    rows,
    roleHolders: Object.fromEntries(Object.entries(roleHolders).map(([k, v]) => [k, [...v]])),
    issues,
  }
}

/** The relationship rows an import would write, flattened out of the parsed sheet. */
export function relationshipRows(parsed: ParsedSheet): { emp_code: string; manager_code: string; relationship_type: RelationshipType }[] {
  const out: { emp_code: string; manager_code: string; relationship_type: RelationshipType }[] = []
  for (const r of parsed.rows) {
    for (const [lvl, mgr] of Object.entries(r.hierarchy)) {
      out.push({ emp_code: r.emp_code, manager_code: mgr, relationship_type: lvl as RelationshipType })
    }
  }
  return out
}

/** A short human summary for the import screen. */
export function summarise(parsed: ParsedSheet) {
  const rels = relationshipRows(parsed)
  const byLevel: Record<string, number> = {}
  for (const r of rels) byLevel[r.relationship_type] = (byLevel[r.relationship_type] || 0) + 1
  return {
    employees: parsed.rows.length,
    relationships: rels.length,
    byLevel,
    roles: Object.fromEntries(Object.entries(parsed.roleHolders).map(([k, v]) => [k, v.length])),
    errors: parsed.issues.filter(i => i.severity === 'error').length,
    warnings: parsed.issues.filter(i => i.severity === 'warning').length,
  }
}
