// app/api/employees/bulk-upload/route.ts — schema-aware bulk uploader.
// POST: validate + transform + upsert rows for any of the 7 uploader types.
//   • personal / statutory / address / exit → employees (upsert on emp_code)
//   • employment → employees, resolving company/dept/location NAMES + manager CODES → IDs
//   • bank      → employees, encrypt account → last4 + base64
//   • salary    → ctc_master (annual) + salary_structures (monthly), keyed by employee_id
// GET: recent upload log.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const FY = '2026-27'
const PAYROLL_IMPACT = ['employment', 'statutory', 'bank', 'salary', 'exit']

// Columns that genuinely exist on `employees`, per uploader type (display-only fields dropped).
const EMP_COLS: Record<string, string[]> = {
  personal: ['full_name', 'first_name', 'last_name', 'salutation', 'date_of_birth', 'gender', 'blood_group', 'marital_status', 'father_name', 'mother_name', 'spouse_name', 'nationality', 'religion', 'birth_place', 'mobile', 'alternate_mobile', 'personal_email', 'office_email', 'emergency_name', 'emergency_relation', 'emergency_mobile'],
  employment: ['designation', 'grade', 'band', 'employment_type', 'employment_status', 'collar_type', 'group_doj', 'company_doj', 'confirmation_date', 'confirmation_status', 'notice_period_days', 'cost_centre', 'work_location_type'],
  statutory: ['pan_number', 'aadhar_last4', 'uan_number', 'pf_account_number', 'esic_number', 'pf_applicable', 'epf_method', 'epf_wage_limit', 'esic_applicable', 'pt_applicable', 'professional_tax_state', 'lwf_applicable', 'lwf_state', 'gratuity_eligible', 'tds_regime'],
  bank: ['bank_name', 'ifsc_code', 'account_type'],
  address: ['res_address1', 'res_address2', 'res_city', 'res_state', 'res_pin', 'perm_address1', 'perm_address2', 'perm_city', 'perm_state', 'perm_pin'],
  exit: ['employment_status', 'date_of_resignation', 'last_working_date', 'relieving_date', 'leaving_reason', 'rehire_eligible', 'blacklisted', 'blacklist_reason'],
}
const NUM_FIELDS = new Set(['notice_period_days', 'epf_wage_limit', 'res_pin', 'perm_pin'])
const BOOL_FIELDS = new Set(['pf_applicable', 'esic_applicable', 'pt_applicable', 'lwf_applicable', 'gratuity_eligible', 'rehire_eligible', 'blacklisted'])

const isoDate = (s: any) => { const v = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null }
const toNum = (v: any) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? null : n }
const toBool = (v: any) => ['yes', 'y', 'true', '1'].includes(String(v).toLowerCase())
const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }

function rowErrors(row: any, type: string): string[] {
  const e: string[] = []
  const code = String(row.emp_code || '').trim()
  if (!code) { e.push('emp_code is required'); return e }
  if (!/^[A-Z]{2,6}-?\d{3,6}$/.test(code)) e.push('emp_code format invalid (e.g. SRS0001)')
  if (type === 'personal') {
    if (row.mobile && !/^\d{10}$/.test(String(row.mobile).replace(/\s/g, ''))) e.push('mobile must be 10 digits')
    if (row.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.personal_email)) e.push('personal_email invalid')
    if (row.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(row.pan_number)) e.push('PAN format invalid')
  }
  if (type === 'statutory' && row.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(row.pan_number)) e.push('PAN format invalid')
  if (type === 'bank') {
    if (row.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(row.ifsc_code)) e.push('IFSC format invalid (XXXX0XXXXXX)')
    if (row.bank_account_number && String(row.bank_account_number).length < 9) e.push('bank_account_number too short')
  }
  if (type === 'salary') {
    const ctc = toNum(row.annual_ctc)
    if (ctc == null) e.push('annual_ctc must be a number')
    else if (ctc < 100000) e.push('annual_ctc too low (< ₹1L)')
    if (!row.effective_date) e.push('effective_date is required')
    if (!row.revision_reason) e.push('revision_reason is required')
  }
  if (type === 'exit') {
    if (!row.employment_status) e.push('employment_status is required')
    if (!row.last_working_date) e.push('last_working_date is required')
    if (!row.leaving_reason) e.push('leaving_reason is required')
    if (row.blacklisted && toBool(row.blacklisted) && !row.blacklist_reason) e.push('blacklist_reason required when blacklisted')
  }
  return e
}

export async function POST(req: NextRequest) {
  try {
    const { uploaderType, rows, performedBy, companyId, acknowledged } = await req.json()
    if (!uploaderType || !rows?.length) return NextResponse.json({ error: 'uploaderType and rows required' }, { status: 400 })
    if (PAYROLL_IMPACT.includes(uploaderType) && !acknowledged) return NextResponse.json({ error: 'payroll_alert', message: 'Payroll impact not acknowledged' }, { status: 409 })

    // Validate.
    const results: { emp_code: string; status: string; errors: string[] }[] = []
    const valid: any[] = []
    for (const row of rows) {
      const errs = rowErrors(row, uploaderType)
      if (errs.length) results.push({ emp_code: row.emp_code, status: 'ERROR', errors: errs })
      else { valid.push(row); results.push({ emp_code: row.emp_code, status: 'PENDING', errors: [] }) }
    }

    // Resolve emp_code → { id, company_id } for all valid rows (salary/employment need the id + name maps).
    const codes = Array.from(new Set(valid.map(r => String(r.emp_code).trim())))
    const idByCode: Record<string, { id: string; company_id: string }> = {}
    for (let i = 0; i < codes.length; i += 300) {
      const { data } = await supa.from('employees').select('id, emp_code, company_id').in('emp_code', codes.slice(i, i + 300))
      ;(data || []).forEach((e: any) => { idByCode[e.emp_code] = { id: e.id, company_id: e.company_id } })
    }

    // Name → id maps for the employment uploader.
    let deptMap: Record<string, string> = {}, locMap: Record<string, string> = {}, compMap: Record<string, string> = {}, mgrMap: Record<string, string> = {}
    if (uploaderType === 'employment') {
      const [{ data: d }, { data: l }, { data: c }, { data: m }] = await Promise.all([
        supa.from('departments').select('id, dept_name'),
        supa.from('locations').select('id, location_name'),
        supa.from('companies').select('id, company_name, company_code'),
        supa.from('employees').select('id, emp_code'),
      ])
      ;(d || []).forEach((x: any) => { deptMap[x.dept_name?.toLowerCase().trim()] = x.id })
      ;(l || []).forEach((x: any) => { locMap[x.location_name?.toLowerCase().trim()] = x.id })
      ;(c || []).forEach((x: any) => { compMap[x.company_name?.toLowerCase().trim()] = x.id; if (x.company_code) compMap[x.company_code?.toLowerCase().trim()] = x.id })
      ;(m || []).forEach((x: any) => { mgrMap[x.emp_code] = x.id })
    }

    const markStatus = (code: string, status: string, err?: string) => { const r = results.find(x => x.emp_code === code); if (r) { r.status = status; if (err) r.errors = [err] } }

    let success = 0, failed = 0

    // ── SALARY → ctc_master + salary_structures (keyed by employee_id) ──
    if (uploaderType === 'salary') {
      const ctcRows: any[] = [], salRows: any[] = []
      for (const r of valid) {
        const ref = idByCode[String(r.emp_code).trim()]
        if (!ref) { markStatus(r.emp_code, 'ERROR', 'emp_code not found in employee master'); failed++; continue }
        const annual_ctc = toNum(r.annual_ctc) || 0
        const varPct = toNum(r.variable_pct) || 0
        const eff = isoDate(r.effective_date) || '2026-04-01'
        ctcRows.push({ employee_id: ref.id, company_id: ref.company_id, fy: FY, effective_from: eff, annual_ctc, annual_variable: Math.round(annual_ctc * varPct / 100), status: 'ACTIVE' })
        salRows.push({
          employee_id: ref.id, company_id: ref.company_id, fy: FY, effective_date: eff, pay_type: 'REGULAR',
          basic_monthly: toNum(r.basic), hra_monthly: toNum(r.hra), conveyance: toNum(r.conveyance_allowance),
          special_allowance: toNum(r.special_allowance), statutory_bonus: toNum(r.statutory_bonus), gross_monthly: toNum(r.gross_monthly),
          employee_pf: toNum(r.employee_pf), employee_esic: toNum(r.employee_esic), pt_monthly: toNum(r.professional_tax),
          lwf_monthly: toNum(r.lwf_employee), net_take_home: toNum(r.net_take_home), employer_pf: toNum(r.employer_pf),
          employer_esic: toNum(r.employer_esic), gratuity_monthly: toNum(r.gratuity_monthly), epf_wage: toNum(r.epf_wage_limit),
        })
      }
      // ctc_master keyed by (employee_id, fy); salary_structures by (employee_id, fy).
      if (ctcRows.length) {
        const { error } = await supa.from('ctc_master').upsert(ctcRows, { onConflict: 'employee_id,fy' })
        if (error) { ctcRows.forEach(r => markStatus(Object.keys(idByCode).find(c => idByCode[c].id === r.employee_id) || '', 'ERROR', error.message)); failed += ctcRows.length }
      }
      if (salRows.length) {
        const { error } = await supa.from('salary_structures').upsert(salRows, { onConflict: 'employee_id,fy' })
        if (error) failed = salRows.length
        else { success = salRows.length; valid.forEach(r => { if (idByCode[String(r.emp_code).trim()]) markStatus(r.emp_code, 'SUCCESS') }) }
      }
      await logUpload(uploaderType, companyId, rows.length, success, failed, performedBy, acknowledged)
      return NextResponse.json({ success, errors: failed + (rows.length - valid.length), results })
    }

    // ── EMPLOYEES-family uploaders ──
    const allow = EMP_COLS[uploaderType] || []
    const batch: any[] = []
    for (const r of valid) {
      const out: any = { emp_code: String(r.emp_code).trim() }
      for (const col of allow) {
        let v: any = r[col]
        if (v === undefined) continue
        if (col.includes('doj') || col.includes('date')) v = isoDate(v)
        else if (NUM_FIELDS.has(col)) v = toNum(v)
        else if (BOOL_FIELDS.has(col)) v = toBool(v)
        else v = clean(v)
        out[col] = v
      }
      if (uploaderType === 'employment') {
        const dep = deptMap[String(r.department || '').toLowerCase().trim()]; if (dep) out.department_id = dep
        const loc = locMap[String(r.location || '').toLowerCase().trim()]; if (loc) out.location_id = loc
        const comp = compMap[String(r.company || '').toLowerCase().trim()]; if (comp) out.company_id = comp
        const l1 = mgrMap[String(r.l1_manager_code || '').trim()]; if (l1) out.l1_manager_id = l1
        const hr = mgrMap[String(r.hr_manager_code || '').trim()]; if (hr) out.hr_manager_id = hr
      }
      if (uploaderType === 'address' && toBool(r.same_as_res)) {
        out.perm_address1 = out.res_address1 ?? r.res_address1; out.perm_address2 = out.res_address2 ?? r.res_address2
        out.perm_city = out.res_city ?? r.res_city; out.perm_state = out.res_state ?? r.res_state; out.perm_pin = toNum(r.res_pin)
      }
      if (uploaderType === 'bank') {
        const acc = String(r.bank_account_number || '').trim()
        if (acc) { out.bank_account_last4 = acc.slice(-4); out.bank_account_encrypted = Buffer.from(acc).toString('base64') }
      }
      batch.push(out)
    }

    for (let i = 0; i < batch.length; i += 100) {
      const chunk = batch.slice(i, i + 100)
      const { error } = await supa.from('employees').upsert(chunk, { onConflict: 'emp_code' })
      if (error) { chunk.forEach(r => markStatus(r.emp_code, 'ERROR', error.message)); failed += chunk.length }
      else { chunk.forEach(r => markStatus(r.emp_code, 'SUCCESS')); success += chunk.length }
    }

    await logUpload(uploaderType, companyId, rows.length, success, failed, performedBy, acknowledged)
    return NextResponse.json({ success, errors: failed + (rows.length - valid.length), results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function logUpload(type: string, companyId: string | null, total: number, success: number, failed: number, by: string | null, ack: boolean) {
  try {
    await supa.from('bulk_upload_log').insert({
      uploader_type: type, company_id: companyId || null, total_rows: total,
      success_rows: success, error_rows: total - success, performed_by: by || null,
      has_payroll_impact: PAYROLL_IMPACT.includes(type), acknowledged: !!ack,
    })
  } catch { /* log best-effort */ }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('company_id')
  const limit = Number(searchParams.get('limit') || '50')
  let q = supa.from('bulk_upload_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q
  return NextResponse.json({ logs: data || [] })
}
