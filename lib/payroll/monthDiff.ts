// lib/payroll/monthDiff.ts — Month Master change comparison.
// Compares a payroll month's frozen snapshot against the previous month's, column by
// column, and reports how many employees changed in each Month Master category — plus
// the row-level detail behind those counts, so the Excel export can show ONLY what moved.
//
// Everything here reads payroll_employee_snapshot directly rather than going through
// loadMonthMaster(): the arrear / taxable side-tables that loadMonthMaster joins in are
// financial-year scoped, not frozen per month, so they carry the *same* live values into
// both sides of the comparison and would always compare equal. Comparing what is actually
// frozen per month is the only comparison that means anything.
import { supabase } from '@/lib/supabase'
import { MM_GROUPS, MM_ORDER, MM_ATTENDANCE_COLS } from './core'

export interface DiffCategory {
  key: string
  label: string
  changed: number          // employees with at least one changed column in this category
  fields: number           // distinct columns that changed anywhere in this category
  comparable: boolean      // false → nothing in this category is frozen per month
}
export interface DiffRow {
  emp_code: string
  full_name: string
  company: string
  status: 'New' | 'Changed'
  cats: string[]                        // category labels touched
  changes: Record<string, any>          // column → NEW value only
  before: Record<string, any>           // column → previous value (for the "what it was" sheet)
}
export interface MonthDiff {
  curLabel: string
  prevLabel: string
  curCount: number
  prevCount: number
  newRows: number
  exitedRows: number
  changedRows: number
  unchangedRows: number
  categories: DiffCategory[]
  rows: DiffRow[]           // new + changed, in employee-code order
  columns: string[]         // union of changed columns, in Month Master order
  exited: { emp_code: string; full_name: string; company: string }[]
}

// Columns that can never be compared meaningfully: row identity and the month's own stamps.
const ALWAYS_SKIP = new Set<string>(
  MM_GROUPS.flatMap(g => g.skipDiff || []).concat(['updated_at']),
)
// col → category, built once from the same groups the export is ordered by.
const CAT_OF = new Map<string, { key: string; label: string }>()
MM_GROUPS.forEach(g => g.cols.forEach(c => { if (!CAT_OF.has(c)) CAT_OF.set(c, { key: g.key, label: g.label }) }))

// Values arrive from PostgREST as numbers, numeric strings, ISO timestamps or nulls.
// Normalise so 5 / "5.00" / 5.0 compare equal and null / '' / undefined are all "blank" —
// otherwise a re-sync that merely re-typed a column would read as a change for everyone.
function norm(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const s = String(v).trim()
  if (s === '') return ''
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s))
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)   // timestamp → date part
  return s
}

export interface DiffRunRef { id: string; company_name?: string | null }

// ── Excel shape ────────────────────────────────────────────────────────────
// Kept next to the comparison rather than in the component so the sheet can be asserted
// on directly: the whole point of this export is that a cell is blank unless it moved.
const META_COLS = ['Employee Code', 'Employee Name', 'Company', 'Status', 'Categories Changed']
// Written as text so Excel keeps long identifiers intact — a 12-digit account number
// otherwise loses leading zeros or flips to scientific notation.
const TEXT_COLS = new Set(['bank_account_number', 'pf_account_number', 'uan_number', 'previous_uan', 'esic_number', 'pension_number'])
function cellValue(col: string, v: any) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  if (TEXT_COLS.has(col) && String(v).trim() !== '') return `'${v}`
  return v
}
export interface ChangeSheets {
  header: string[]
  changes: Record<string, any>[]
  previous: Record<string, any>[]
  summary: Record<string, any>[]
  summaryHeader: string[]
  exited: Record<string, any>[]
  exitedHeader: string[]
}
export function buildChangeSheets(d: MonthDiff): ChangeSheets {
  // The snapshot's own `Company` column would collide with the meta column of the same
  // name and blank it out for every row, so it is dropped from the data columns — the
  // meta column already shows which company the employee sits in this month, and a
  // transfer still registers on the Sync category count.
  const dataCols = d.columns.filter(c => !META_COLS.includes(c))
  const header = [...META_COLS, ...dataCols]
  const build = (pick: (r: DiffRow) => Record<string, any>) => d.rows.map(r => {
    const o: Record<string, any> = {
      'Employee Code': r.emp_code, 'Employee Name': r.full_name, 'Company': r.company,
      'Status': r.status, 'Categories Changed': r.cats.join(', '),
    }
    const src = pick(r)
    // Untouched columns stay blank — the row shows emp code, name and what actually moved.
    dataCols.forEach(c => { o[c] = c in r.changes ? cellValue(c, src[c]) : '' })
    return o
  })
  return {
    header,
    changes: build(r => r.changes),
    previous: build(r => r.before),
    summaryHeader: ['Category', 'Employees Changed', 'Columns Changed'],
    summary: d.categories.map(c => ({
      'Category': c.label,
      'Employees Changed': c.comparable ? c.changed : 'Not frozen per month',
      'Columns Changed': c.comparable ? c.fields : '',
    })).concat([
      { 'Category': '— New employees', 'Employees Changed': d.newRows, 'Columns Changed': '' },
      { 'Category': '— Exited employees', 'Employees Changed': d.exitedRows, 'Columns Changed': '' },
      { 'Category': '— Employees with no change', 'Employees Changed': d.unchangedRows, 'Columns Changed': '' },
    ]),
    exitedHeader: ['Employee Code', 'Employee Name', 'Company'],
    exited: d.exited.map(e => ({ 'Employee Code': e.emp_code, 'Employee Name': e.full_name, 'Company': e.company })),
  }
}

async function loadSnapshot(runs: DiffRunRef[]): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (const r of runs) {
    // Paginated: PostgREST caps a response at 1000 rows and a group month spans companies.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('payroll_employee_snapshot')
        .select('*').eq('run_id', r.id).order('employee_code').range(from, from + 999)
      if (error) throw new Error(error.message)
      const batch = data || []
      batch.forEach((row: any) => out.push({ Company: r.company_name || '', ...row }))
      if (batch.length < 1000) break
    }
  }
  return out
}

export async function loadMonthDiff(
  cur: { label: string; runs: DiffRunRef[] },
  prev: { label: string; runs: DiffRunRef[] },
  opts: { includeAttendance?: boolean } = {},
): Promise<MonthDiff> {
  const [curRows, prevRows] = await Promise.all([loadSnapshot(cur.runs), loadSnapshot(prev.runs)])
  return diffSnapshots(curRows, prevRows, cur.label, prev.label, opts)
}

// The comparison itself, with no database in it — the same function the screen runs, so a
// test can feed it two hand-built months and check the counts it would have shown.
export function diffSnapshots(
  curRows: Record<string, any>[],
  prevRows: Record<string, any>[],
  curLabel: string,
  prevLabel: string,
  opts: { includeAttendance?: boolean } = {},
): MonthDiff {
  const skip = new Set(ALWAYS_SKIP)
  if (!opts.includeAttendance) MM_ATTENDANCE_COLS.forEach(c => skip.add(c))

  const prevBy = new Map<string, Record<string, any>>()
  prevRows.forEach(r => prevBy.set(String(r.employee_code || ''), r))

  const catChanged = new Map<string, Set<string>>()   // category key → emp codes
  const catFields = new Map<string, Set<string>>()    // category key → columns
  const bump = (col: string, emp: string) => {
    const cat = CAT_OF.get(col) || { key: 'other', label: 'Other columns' }
    if (!catChanged.has(cat.key)) { catChanged.set(cat.key, new Set()); catFields.set(cat.key, new Set()) }
    catChanged.get(cat.key)!.add(emp)
    catFields.get(cat.key)!.add(col)
  }

  const rows: DiffRow[] = []
  const columns = new Set<string>()
  let unchanged = 0
  const seen = new Set<string>()

  for (const c of curRows) {
    const emp = String(c.employee_code || '')
    seen.add(emp)
    const p = prevBy.get(emp)

    if (!p) {
      // A new joiner has no previous row, so everything they carry IS the change and lands
      // in the sheet in full. They are NOT tallied into the per-category counts, though:
      // every one of their columns is "new", so counting them would push every category up
      // by the headcount of joiners and bury the handful of real edits. Joiners get their
      // own line on the table instead.
      const changes: Record<string, any> = {}
      Object.keys(c).forEach(k => {
        if (skip.has(k)) return
        if (norm(c[k]) === '') return
        changes[k] = c[k]
        columns.add(k)
      })
      rows.push({
        emp_code: emp, full_name: c.full_name || '', company: c.Company || '',
        status: 'New', cats: ['New joiner'], changes, before: {},
      })
      continue
    }

    const changes: Record<string, any> = {}
    const before: Record<string, any> = {}
    const cats = new Set<string>()
    // Union of both sides' keys — a column added to the snapshot between the two months
    // must still register as a change rather than being invisible.
    const keys = new Set<string>([...Object.keys(c), ...Object.keys(p)])
    keys.forEach(k => {
      if (skip.has(k)) return
      if (norm(c[k]) === norm(p[k])) return
      changes[k] = c[k] ?? ''
      before[k] = p[k] ?? ''
      columns.add(k)
      cats.add((CAT_OF.get(k) || { label: 'Other columns' }).label)
      bump(k, emp)
    })
    if (!Object.keys(changes).length) { unchanged++; continue }
    rows.push({
      emp_code: emp, full_name: c.full_name || '', company: c.Company || '',
      status: 'Changed', cats: Array.from(cats), changes, before,
    })
  }

  const exited = prevRows
    .filter(r => !seen.has(String(r.employee_code || '')))
    .map(r => ({ emp_code: String(r.employee_code || ''), full_name: r.full_name || '', company: r.Company || '' }))

  // A category is only "comparable" if at least one of its columns is actually frozen in
  // the snapshot — Investment lives in the FY-scoped taxable table, so it never is, and
  // showing a hard 0 there would read as "nothing changed" instead of "not tracked here".
  const present = new Set<string>()
  curRows.concat(prevRows).slice(0, 50).forEach(r => Object.keys(r).forEach(k => present.add(k)))
  const categories: DiffCategory[] = MM_GROUPS.map(g => {
    const live = g.cols.filter(c => present.has(c) && !skip.has(c))
    return {
      key: g.key, label: g.label,
      changed: catChanged.get(g.key)?.size || 0,
      fields: catFields.get(g.key)?.size || 0,
      comparable: live.length > 0,
    }
  })
  if (catChanged.has('other')) {
    categories.push({
      key: 'other', label: 'Other columns',
      changed: catChanged.get('other')!.size, fields: catFields.get('other')!.size, comparable: true,
    })
  }

  const order = (a: string) => { const i = MM_ORDER.indexOf(a); return i < 0 ? 9999 : i }
  return {
    curLabel, prevLabel,
    curCount: curRows.length, prevCount: prevRows.length,
    newRows: rows.filter(r => r.status === 'New').length,
    exitedRows: exited.length,
    changedRows: rows.filter(r => r.status === 'Changed').length,
    unchangedRows: unchanged,
    categories, rows: rows.sort((a, b) => a.emp_code.localeCompare(b.emp_code)),
    columns: Array.from(columns).sort((a, b) => order(a) - order(b) || a.localeCompare(b)),
    exited,
  }
}
