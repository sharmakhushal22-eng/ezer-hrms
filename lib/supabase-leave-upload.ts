// lib/supabase-leave-upload.ts — HR/Admin bulk Excel uploaders (parse -> preview -> commit)
// Two uploaders: (1) employee leave balances -> leave_balances
//                (2) branch-wise quota (all leave types) -> leave_policy (scope upsert)
// Parse step returns per-row validation so the UI can PREVIEW before committing.
// Column names match the REAL schema: leave_types.short_name (code), employees.emp_code,
// leave_policy.fy, leave_balances.year (TEXT).
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export interface ParsedRow {
  rowNo: number
  cells: Record<string, any>     // display values for the preview table
  status: 'ok' | 'error'
  msg?: string
  payload?: any                  // ready-to-commit object (ok rows only)
}
export interface ParseResult { kind: 'balance' | 'quota'; rows: ParsedRow[]; valid: number; errors: number; skipped: number }
export interface CommitResult { inserted: number; updated: number; failed: number; errors: { rowNo: number; msg: string }[] }

const FY = '2026-27'
const CUR_YEAR = (new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1)
const yn = (v: any) => ['Y', 'YES', 'TRUE', '1'].includes(String(v ?? '').trim().toUpperCase())
const numOrNull = (v: any) => (v === '' || v == null) ? null : Number(v)
const up = (v: any) => String(v ?? '').trim().toUpperCase()

async function refs() {
  const [lt, co, br, emp] = await Promise.all([
    supabase.from('leave_types').select('id, short_name, name').eq('is_active', true).order('sort_order'),
    supabase.from('companies').select('id, company_code, company_name').eq('status', 'Active'),
    supabase.from('locations').select('id, location_code, location_name, company_id').eq('status', 'Active'),
    supabase.from('employees').select('id, emp_code, full_name'),
  ])
  const ltMap = new Map<string, { id: string; name: string }>(); (lt.data || []).forEach((t: any) => ltMap.set(up(t.short_name), { id: t.id, name: t.name }))
  const coMap = new Map<string, string>(); (co.data || []).forEach((c: any) => coMap.set(up(c.company_code), c.id))
  const brMap = new Map<string, { id: string; company_id: string }>(); (br.data || []).forEach((l: any) => brMap.set(up(l.location_code), { id: l.id, company_id: l.company_id }))
  const empMap = new Map<string, any>(); (emp.data || []).forEach((e: any) => empMap.set(up(e.emp_code), e))
  return {
    ltMap, coMap, brMap, empMap,
    ltList: (lt.data || []).map((t: any) => ({ code: t.short_name, name: t.name })),
    coList: (co.data || []).map((c: any) => ({ company_code: c.company_code, company_name: c.company_name })),
    brList: (br.data || []).map((b: any) => ({ location_code: b.location_code, location_name: b.location_name })),
  }
}

function readRows(file: File): Promise<any[]> {
  return file.arrayBuffer().then(buf => {
    const wb = XLSX.read(buf, { type: 'array' })
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as any[]
  })
}

// ════════════ 1. EMPLOYEE LEAVE BALANCE ════════════
export async function downloadBalanceTemplate() {
  const { ltList } = await refs()
  const head = [['Employee Code', 'Leave Type Code', 'Year', 'Opening', 'Accrued', 'Used', 'Encashed']]
  const example = [['SSM0001', 'EL', CUR_YEAR, 6, 18, 6, 0], ['SSM0001', 'CL', CUR_YEAR, 0, 12, 3, 0]]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head, ...example]), 'Balances')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leave Type Code', 'Name'], ...ltList.map((t: any) => [t.code, t.name])]), 'Leave Types')
  XLSX.writeFile(wb, 'leave_balance_template.xlsx')
}

export async function parseBalanceFile(file: File): Promise<ParseResult> {
  const rows = await readRows(file)
  const { ltMap, empMap } = await refs()
  const out: ParsedRow[] = []
  let valid = 0, errors = 0, skipped = 0
  rows.forEach((r, i) => {
    const rowNo = i + 2
    const ec = up(r['Employee Code']); const ltc = up(r['Leave Type Code'])
    const cells = { Employee: ec, Leave: ltc, Year: r['Year'] || CUR_YEAR, Opening: r['Opening'] || 0, Accrued: r['Accrued'] || 0, Used: r['Used'] || 0, Encashed: r['Encashed'] || 0 }
    if (!ec && !ltc) { skipped++; return }
    const e = empMap.get(ec); const lt = ltMap.get(ltc)
    if (!e) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Unknown employee "${ec}"` }); return }
    if (!lt) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Unknown leave type "${ltc}"` }); return }
    valid++
    out.push({ rowNo, cells, status: 'ok', payload: { employee_id: e.id, leave_type_id: lt.id, year: String(Number(r['Year']) || CUR_YEAR), opening: Number(r['Opening']) || 0, accrued: Number(r['Accrued']) || 0, used: Number(r['Used']) || 0, encashed: Number(r['Encashed']) || 0 } })
  })
  return { kind: 'balance', rows: out, valid, errors, skipped }
}

export async function commitBalances(rows: ParsedRow[]): Promise<CommitResult> {
  const payload = rows.filter(r => r.status === 'ok').map(r => r.payload)
  const res: CommitResult = { inserted: 0, updated: 0, failed: 0, errors: [] }
  if (!payload.length) return res
  const { error } = await supabase.from('leave_balances').upsert(payload, { onConflict: 'employee_id,leave_type_id,year' })
  if (error) { res.failed = payload.length; res.errors.push({ rowNo: 0, msg: 'DB: ' + error.message }); return res }
  res.inserted = payload.length
  return res
}

// ════════════ 2. BRANCH-WISE QUOTA ════════════
export async function downloadQuotaTemplate() {
  const { ltList, coList, brList } = await refs()
  const head = [['Company Code', 'Branch Code', 'Leave Type Code', 'Annual Quota', 'Max Carry Forward', 'Laps (Y/N)', 'Encashable (Y/N)', 'Accrual', 'FY']]
  const example = [['SSM', 'ALL', 'EL', 18, 12, 'N', 'Y', 'YEARLY', FY], ['SSM', 'LOC001', 'EL', 24, 12, 'N', 'Y', 'YEARLY', FY], ['SSM', 'ALL', 'CL', 12, 0, 'Y', 'N', 'YEARLY', FY]]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head, ...example]), 'Quota')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Leave Type Code', 'Name'], ...ltList.map((t: any) => [t.code, t.name])]), 'Leave Types')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Company Code', 'Name'], ...coList.map((c: any) => [c.company_code, c.company_name])]), 'Companies')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Branch Code', 'Name', '(ALL = company default)'], ...brList.map((b: any) => [b.location_code, b.location_name])]), 'Branches')
  XLSX.writeFile(wb, 'branch_quota_template.xlsx')
}

export async function parseQuotaFile(file: File): Promise<ParseResult> {
  const rows = await readRows(file)
  const { ltMap, coMap, brMap } = await refs()
  const out: ParsedRow[] = []
  let valid = 0, errors = 0, skipped = 0
  rows.forEach((r, i) => {
    const rowNo = i + 2
    const coc = up(r['Company Code']); const brc = up(r['Branch Code']); const ltc = up(r['Leave Type Code'])
    const cells = { Company: coc, Branch: brc || 'ALL', Leave: ltc, Quota: r['Annual Quota'] || 0, CF: r['Max Carry Forward'] ?? '', Laps: r['Laps (Y/N)'] || '', Encash: r['Encashable (Y/N)'] || '', FY: r['FY'] || FY }
    if (!coc && !ltc) { skipped++; return }
    const coId = coMap.get(coc); const lt = ltMap.get(ltc)
    if (!coId) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Unknown company "${coc}"` }); return }
    if (!lt) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Unknown leave type "${ltc}"` }); return }
    let branchId: string | null = null
    if (brc && brc !== 'ALL') {
      const b = brMap.get(brc)
      if (!b) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Unknown branch "${brc}"` }); return }
      if (b.company_id !== coId) { errors++; out.push({ rowNo, cells, status: 'error', msg: `Branch "${brc}" not in company "${coc}"` }); return }
      branchId = b.id
    }
    const fy = String(r['FY'] || FY).trim() || FY
    valid++
    out.push({ rowNo, cells, status: 'ok', payload: { leave_type_id: lt.id, company_id: coId, branch_id: branchId, annual_quota: Number(r['Annual Quota']) || 0, max_carry_forward: numOrNull(r['Max Carry Forward']), laps: yn(r['Laps (Y/N)']), is_encashable: yn(r['Encashable (Y/N)']), accrual: String(r['Accrual'] || 'YEARLY').trim() || 'YEARLY', fy, is_active: true } })
  })
  return { kind: 'quota', rows: out, valid, errors, skipped }
}

export async function commitQuota(rows: ParsedRow[]): Promise<CommitResult> {
  const res: CommitResult = { inserted: 0, updated: 0, failed: 0, errors: [] }
  for (const r of rows.filter(x => x.status === 'ok')) {
    const p = r.payload
    let q = supabase.from('leave_policy').select('id').eq('leave_type_id', p.leave_type_id).eq('company_id', p.company_id).eq('fy', p.fy)
    q = p.branch_id === null ? q.is('branch_id', null) : q.eq('branch_id', p.branch_id)
    const { data: ex } = await q.maybeSingle()
    if (ex) { const { error } = await supabase.from('leave_policy').update(p).eq('id', (ex as any).id); if (error) { res.failed++; res.errors.push({ rowNo: r.rowNo, msg: error.message }) } else res.updated++ }
    else { const { error } = await supabase.from('leave_policy').insert(p); if (error) { res.failed++; res.errors.push({ rowNo: r.rowNo, msg: error.message }) } else res.inserted++ }
  }
  return res
}
