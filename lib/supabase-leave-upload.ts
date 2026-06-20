// lib/supabase-leave-upload.ts — HR/Admin bulk Excel uploaders for Leave (migration 030)
// (1) employee leave balances  (2) branch-wise quota (leave_policy).
// Templates ship reference sheets (Leave Types / Companies / Branches) with valid codes.
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export interface UploadResult {
  inserted: number
  updated: number
  skipped: number
  errors: { row: number; msg: string }[]
}

const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const yn = (v: any): boolean => ['y', 'yes', 'true', '1'].includes(String(v).trim().toLowerCase())
const S = (v: any) => String(v ?? '').trim()

// ── shared lookups ──────────────────────────────────────────────────
async function leaveTypeMap(): Promise<Map<string, { id: string; name: string }>> {
  const { data } = await supabase.from('leave_types').select('id, short_name, name').eq('is_active', true)
  return new Map((data || []).map((t: any) => [String(t.short_name).toUpperCase(), { id: t.id, name: t.name }]))
}
async function companyMap() {
  const { data } = await supabase.from('companies').select('id, company_code, company_name')
  return new Map((data || []).map((c: any) => [String(c.company_code).toUpperCase(), { id: c.id, name: c.company_name }]))
}
async function branchRows() {
  const { data } = await supabase.from('locations').select('id, location_code, location_name, company_id')
  return (data || []) as { id: string; location_code: string; location_name: string; company_id: string }[]
}
async function employeeMap() {
  const { data } = await supabase.from('employees').select('id, emp_code, full_name')
  return new Map((data || []).map((e: any) => [String(e.emp_code).toUpperCase(), { id: e.id, name: e.full_name }]))
}

function firstSheetRows(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: '' }))
      } catch (e) { reject(e) }
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ════════════════════════════════════════════════════════════════════
// 1. EMPLOYEE LEAVE BALANCES
// ════════════════════════════════════════════════════════════════════
export async function downloadBalanceTemplate(): Promise<void> {
  const types = await leaveTypeMap()
  const emps = await employeeMap()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Employee Code', 'Leave Type Code', 'Year', 'Opening', 'Accrued', 'Used', 'Encashed'],
    ['', '', '2026', 0, 0, 0, 0],
  ]), 'Balances')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Name'], ...[...types].map(([c, v]) => [c, v.name])]), 'Leave Types')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Emp Code', 'Name'], ...[...emps].map(([c, v]) => [c, v.name])]), 'Employees')
  XLSX.writeFile(wb, 'EZER_Leave_Balance_Template.xlsx')
}

export async function uploadBalances(file: File): Promise<UploadResult> {
  const res: UploadResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }
  const [rows, types, emps] = await Promise.all([firstSheetRows(file), leaveTypeMap(), employeeMap()])
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const rowNo = i + 2 // +1 header, +1 to 1-index
    const empCode = S(r['Employee Code']).toUpperCase()
    const typeCode = S(r['Leave Type Code']).toUpperCase()
    if (!empCode && !typeCode) { res.skipped++; continue }
    const emp = emps.get(empCode); const lt = types.get(typeCode)
    if (!emp) { res.errors.push({ row: rowNo, msg: `Unknown employee code "${empCode}"` }); continue }
    if (!lt) { res.errors.push({ row: rowNo, msg: `Unknown leave type "${typeCode}"` }); continue }
    const year = S(r['Year']) || '2026'
    const payload = {
      employee_id: emp.id, leave_type_id: lt.id, year,
      opening: num(r['Opening']), accrued: num(r['Accrued']), used: num(r['Used']), encashed: num(r['Encashed']),
      updated_at: new Date().toISOString(),
    }
    const { data: existing } = await supabase.from('leave_balances').select('id')
      .eq('employee_id', emp.id).eq('leave_type_id', lt.id).eq('year', year).maybeSingle()
    const { error } = await supabase.from('leave_balances').upsert(payload, { onConflict: 'employee_id,leave_type_id,year' })
    if (error) { res.errors.push({ row: rowNo, msg: error.message }); continue }
    existing ? res.updated++ : res.inserted++
  }
  return res
}

// ════════════════════════════════════════════════════════════════════
// 2. BRANCH-WISE QUOTA (leave_policy)
// ════════════════════════════════════════════════════════════════════
export async function downloadQuotaTemplate(): Promise<void> {
  const [types, companies, branches] = await Promise.all([leaveTypeMap(), companyMap(), branchRows()])
  const coNameById = new Map([...companies].map(([, v]) => [v.id, v.name]))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Company Code', 'Branch Code (ALL = default)', 'Leave Type Code', 'Annual Quota', 'Max Carry Forward', 'Laps (Y/N)', 'Encashable (Y/N)', 'Accrual', 'FY'],
    ['', 'ALL', '', 0, 0, 'N', 'N', 'YEARLY', '2026-27'],
  ]), 'Quota')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Name'], ...[...types].map(([c, v]) => [c, v.name])]), 'Leave Types')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Name'], ...[...companies].map(([c, v]) => [c, v.name])]), 'Companies')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Branch Code', 'Branch Name', 'Company'], ...branches.map(b => [b.location_code, b.location_name, coNameById.get(b.company_id) || ''])]), 'Branches')
  XLSX.writeFile(wb, 'EZER_Leave_Quota_Template.xlsx')
}

export async function uploadQuota(file: File): Promise<UploadResult> {
  const res: UploadResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }
  const [rows, types, companies, branches] = await Promise.all([firstSheetRows(file), leaveTypeMap(), companyMap(), branchRows()])
  const branchByCode = new Map(branches.map(b => [String(b.location_code).toUpperCase(), b]))

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const rowNo = i + 2
    const coCode = S(r['Company Code']).toUpperCase()
    const brCode = S(r['Branch Code (ALL = default)']).toUpperCase()
    const typeCode = S(r['Leave Type Code']).toUpperCase()
    if (!coCode && !typeCode) { res.skipped++; continue }
    const co = companies.get(coCode); const lt = types.get(typeCode)
    if (!co) { res.errors.push({ row: rowNo, msg: `Unknown company code "${coCode}"` }); continue }
    if (!lt) { res.errors.push({ row: rowNo, msg: `Unknown leave type "${typeCode}"` }); continue }

    let branch_id: string | null = null
    if (brCode && brCode !== 'ALL') {
      const br = branchByCode.get(brCode)
      if (!br) { res.errors.push({ row: rowNo, msg: `Unknown branch code "${brCode}"` }); continue }
      if (br.company_id !== co.id) { res.errors.push({ row: rowNo, msg: `Branch "${brCode}" doesn't belong to company "${coCode}"` }); continue }
      branch_id = br.id
    }
    const fy = S(r['FY']) || '2026-27'
    const payload: any = {
      leave_type_id: lt.id, company_id: co.id, branch_id, fy,
      annual_quota: num(r['Annual Quota']), max_carry_forward: num(r['Max Carry Forward']),
      laps: yn(r['Laps (Y/N)']), is_encashable: yn(r['Encashable (Y/N)']),
      accrual: S(r['Accrual']) || 'YEARLY', is_active: true,
    }
    // null-aware existence check (partial unique indexes guard the DB)
    let q = supabase.from('leave_policy').select('id').eq('leave_type_id', lt.id).eq('company_id', co.id).eq('fy', fy)
    q = branch_id ? q.eq('branch_id', branch_id) : q.is('branch_id', null)
    const { data: existing } = await q.maybeSingle()
    const { error } = existing
      ? await supabase.from('leave_policy').update(payload).eq('id', existing.id)
      : await supabase.from('leave_policy').insert(payload)
    if (error) { res.errors.push({ row: rowNo, msg: error.message }); continue }
    existing ? res.updated++ : res.inserted++
  }
  return res
}
