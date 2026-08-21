'use client'
// components/employees/BulkUploadModal.tsx — direct bulk employee add via Excel.
// Client-side (permissive RLS): download template → fill → upload → insert.
// emp_code blank = auto (type-wise, no hyphen) · filled = use existing (skip if dup).
// Optional: create a POLICY_ACK task per employee (needs migration 034 + company_policies).
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { buildEmpCode, TYPE_SUFFIX } from '@/lib/employee-code'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const EMP_TYPES = ['Employee', 'Intern', 'NAPS', 'NATS', 'Consultant', 'Contract']
// Template columns (order matters — result columns appended after).
const COLS = ['emp_code', 'full_name', 'employment_type', 'designation', 'department',
  'date_of_joining', 'mobile', 'personal_email', 'office_email', 'date_of_birth',
  'gender', 'blood_group', 'marital_status', 'grade', 'notice_period_days',
  'confirmation_status', 'location_name']

const s = {
  inp:  { width:'100%', padding:'9px 11px', border:'1px solid #E2E8F0', borderRadius:7, fontSize:13, fontFamily:'inherit', background:'#fff', color:TK.ink, outline:'none', boxSizing:'border-box' as const },
  lbl:  { fontSize:10, fontWeight:600 as const, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 },
  pri:  { padding:'9px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600 as const, fontFamily:'inherit', background:TK.violet, color:'#fff' } as React.CSSProperties,
  out:  { padding:'9px 16px', borderRadius:7, border:'1px solid #E2E8F0', cursor:'pointer', fontSize:12, fontWeight:500 as const, fontFamily:'inherit', background:'#fff', color:TK.inkSoft } as React.CSSProperties,
}
const S = (v: any) => String(v ?? '').trim()
const num = (v: any) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n }

export default function BulkUploadModal({ companies, departments, locations, onClose, onDone }: {
  companies: any[]; departments: any[]; locations: any[]
  onClose: () => void; onDone: (r: { added: number; skipped: number; errors: number }) => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [companyId, setCompanyId] = useState('')
  const [createTasks, setCreateTasks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; errors: number; rows: any[][] } | null>(null)
  const company = companies.find((c: any) => c.id === companyId)

  function downloadTemplate() {
    const example1 = ['', 'Rahul Kumar Sharma', 'Employee', 'Senior Executive', 'Technology', '2026-07-01', '9810012345', 'rahul@gmail.com', 'rahul@company.com', '1996-08-14', 'Male', 'B+', 'Single', 'B', '90', 'Probation', '']
    const example2 = [(company?.company_code || 'SSM') + 'NAP0001', 'Sneha Verma', 'NAPS', 'NAPS Apprentice', 'Production', '2026-07-01', '9812345678', 'sneha@gmail.com', '', '2003-05-20', 'Female', 'O+', 'Single', '', '0', 'Contract', '']
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLS, example1, example2]), 'Employees')
    // reference sheets (valid values to copy)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Employment Types'], ...EMP_TYPES.map(t => [t])]), 'Types')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Department'], ...departments.filter((d: any) => d.company_id === companyId).map((d: any) => [d.dept_name])]), 'Departments')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Location'], ...locations.filter((l: any) => l.company_id === companyId).map((l: any) => [l.location_name])]), 'Locations')
    XLSX.writeFile(wb, `EZER_Bulk_Employees_${company?.company_code || 'template'}.xlsx`)
  }

  async function processFile(file: File) {
    setBusy(true)
    try {
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as any[][]
      const companyCode = (company?.company_code || 'EZ').toUpperCase()

      // lookups for this company
      const deptByName = new Map(departments.filter((d: any) => d.company_id === companyId).map((d: any) => [S(d.dept_name).toLowerCase(), d.id]))
      const locByName = new Map(locations.filter((l: any) => l.company_id === companyId).map((l: any) => [S(l.location_name).toLowerCase(), l.id]))

      // existing codes + per-type sequence seed (so auto codes continue, no dup)
      const { data: existing } = await supabase.from('employees').select('emp_code, employment_type').eq('company_id', companyId)
      const usedCodes = new Set((existing || []).map((e: any) => S(e.emp_code).toUpperCase()))
      const counters: Record<string, number> = {}
      for (const e of (existing || []) as any[]) {
        const suffix = TYPE_SUFFIX[e.employment_type] ?? ''
        const m = S(e.emp_code).toUpperCase().match(new RegExp(`^${companyCode}${suffix}(\\d{4})$`))
        if (m) counters[e.employment_type] = Math.max(counters[e.employment_type] || 0, parseInt(m[1], 10))
      }
      const { data: seqs } = await supabase.from('employee_code_sequences').select('employment_type, last_sequence').eq('company_id', companyId)
      for (const sq of (seqs || []) as any[]) counters[sq.employment_type] = Math.max(counters[sq.employment_type] || 0, sq.last_sequence || 0)

      // policies for optional task
      let policyIds: string[] = []
      if (createTasks) {
        const { data: pol } = await supabase.from('company_policies').select('id').eq('company_id', companyId).eq('is_active', true)
        policyIds = (pol || []).map((p: any) => p.id)
      }
      const due = new Date(); due.setDate(due.getDate() + 14)
      const dueStr = due.toISOString().slice(0, 10)

      let added = 0, skipped = 0, errors = 0
      const out: any[][] = [[...COLS, 'generated_code', 'status', 'error_message']]

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        if (!r || !S(r[1])) continue // skip blank
        const rec = (k: number) => S(r[k])
        const full_name = rec(1)
        let employment_type = rec(2) || 'Employee'
        if (!EMP_TYPES.includes(employment_type)) employment_type = 'Employee'
        const designation = rec(3)
        const mobile = rec(6)
        const writeRow = (code: string, status: string, err: string) => out.push([...COLS.map((_, k) => S(r[k])), code, status, err])

        if (!full_name || !designation || !mobile) { writeRow('', 'Error', 'Missing required: full_name / designation / mobile'); errors++; continue }

        // resolve code
        let code = rec(0).toUpperCase()
        if (!code) {
          counters[employment_type] = (counters[employment_type] || 0) + 1
          code = buildEmpCode(companyCode, employment_type, counters[employment_type])
        } else {
          if (usedCodes.has(code)) { writeRow(code, 'Skipped', `Code ${code} already exists`); skipped++; continue }
          const m = code.match(/(\d{4})$/)
          if (m) counters[employment_type] = Math.max(counters[employment_type] || 0, parseInt(m[1], 10))
        }
        usedCodes.add(code)

        const parts = full_name.split(/\s+/)
        const row: any = {
          emp_code: code, common_code: code, company_id: companyId,
          location_id: locByName.get(rec(16).toLowerCase()) || null,
          department_id: deptByName.get(rec(4).toLowerCase()) || null,
          full_name, first_name: parts[0], last_name: parts.slice(1).join(' ') || null,
          designation, employment_type, employment_status: 'Active',
          confirmation_status: rec(15) || 'Probation',
          company_doj: rec(5) || null, group_doj: rec(5) || null,
          mobile, personal_email: rec(7) || null, office_email: rec(8) || null,
          date_of_birth: rec(9) || null, gender: rec(10) || null, blood_group: rec(11) || null,
          marital_status: rec(12) || null, grade: rec(13) || null, notice_period_days: num(r[14]),
          is_test: false,
        }
        const { data: emp, error } = await supabase.from('employees').insert(row).select('id').single()
        if (error) { writeRow(code, 'Error', error.message); errors++; usedCodes.delete(code); continue }

        if (createTasks && emp?.id) {
          try {
            await supabase.from('employee_tasks').insert({
              employee_id: emp.id, company_id: companyId, task_type: 'POLICY_ACK',
              task_title: 'Read & Acknowledge Company Policies',
              task_description: `Please read and acknowledge ${policyIds.length} company policies.`,
              status: 'PENDING', due_date: dueStr,
              meta: { policies_total: policyIds.length, policies_acked: 0, policy_ids: policyIds },
            })
          } catch { /* non-fatal — needs migration 034 */ }
        }
        writeRow(code, 'Added', ''); added++
      }

      // keep the sequence table in sync so onboarding / single-add continue correctly
      for (const [type, val] of Object.entries(counters)) {
        await supabase.from('employee_code_sequences').upsert({ company_id: companyId, employment_type: type, last_sequence: val }, { onConflict: 'company_id,employment_type' })
      }

      setResult({ added, skipped, errors, rows: out })
      setStep(3)
      if (added > 0) onDone({ added, skipped, errors })
    } catch (e: any) {
      setResult({ added: 0, skipped: 0, errors: 0, rows: [[`Parse failed: ${e?.message || 'bad file'}`]] })
      setStep(3)
    }
    setBusy(false)
  }

  function downloadResult() {
    if (!result) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(result.rows), 'Results')
    XLSX.writeFile(wb, 'EZER_Bulk_Upload_Result.xlsx')
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1500, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:12, width:'100%', maxWidth:640, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.18)' }} onClick={e => e.stopPropagation()}>
        <div style={{ background:'#1E293B', padding:'14px 20px', borderRadius:'12px 12px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:'#fff' }}>Bulk Employee Upload</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.55)', marginTop:2 }}>Step {step} of 3 · hundreds of employees from one Excel file</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', fontSize:22 }}>×</button>
        </div>

        <div style={{ padding:'18px 20px' }}>
          {/* STEP 1 — company + template */}
          {step === 1 && (
            <div>
              <label style={s.lbl}>Company *</label>
              <select style={{ ...s.inp, marginBottom:14 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">— Select company —</option>
                {companies.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>

              <div style={{ background:TK.infoTint, border:'1px solid #BFDBFE', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#1E40AF', lineHeight:1.6 }}>Leave <b>emp_code</b> blank → auto-generated per type (e.g. {(company?.company_code || 'SSM')}0001, {(company?.company_code || 'SSM')}INT0001). Or fill in your existing codes for a first-time setup — duplicate rows are skipped.
              </div>

              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, marginBottom:16 }}>
                <input type="checkbox" checked={createTasks} onChange={e => setCreateTasks(e.target.checked)} />
                <span>Create a policy-acknowledgement task for each added employee</span>
              </label>

              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                <button onClick={downloadTemplate} disabled={!companyId} style={{ ...s.out, borderColor:TK.violet, color:TK.violet, background:TK.violetTint, opacity: companyId ? 1 : 0.5 }}>⬇ Download Template</button>
                <label style={{ ...s.pri, cursor: companyId ? 'pointer' : 'not-allowed', opacity: companyId ? 1 : 0.5, display:'inline-flex', alignItems:'center', gap:6 }}>
                  {busy ? 'Processing…' : '⬆ Upload Filled Excel'}
                  <input type="file" accept=".xlsx,.xls" style={{ display:'none' }} disabled={!companyId || busy} onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />
                </label>
              </div>
              <div style={{ fontSize:11, color:TK.faint, marginTop:10 }}>The template carries Types / Departments / Locations reference sheets — copy the valid values from there.</div>
            </div>
          )}

          {/* STEP 3 — results */}
          {step === 3 && result && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
                {[['Added', result.added, TK.positive, TK.positiveTint], ['Skipped', result.skipped, TK.warning, TK.warningTint], ['Errors', result.errors, TK.critical, TK.criticalTint]].map(([l, v, c, bg]) => (
                  <div key={l as string} style={{ background: bg as string, border:`1px solid ${c}30`, borderRadius:10, padding:'14px 10px', textAlign:'center' }}>
                    <div style={{ fontSize:28, fontWeight:700, color: c as string }}>{v as number}</div>
                    <div style={{ fontSize:12, color: c as string, marginTop:4, fontWeight:500 }}>{l as string}</div>
                  </div>
                ))}
              </div>
              {result.errors + result.skipped > 0 && (
                <div style={{ maxHeight:180, overflowY:'auto', background:TK.warningTint, borderRadius:8, padding:'8px 12px', marginBottom:14, fontSize:11 }}>
                  {result.rows.slice(1).filter(r => r[18] !== 'Added').map((r, i) => (
                    <div key={i} style={{ padding:'2px 0', color:TK.warning }}>{r[18] || '—'} · {r[1]}: {r[20] || r[19]}</div>
                  ))}
                </div>
              )}
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={onClose} style={s.out}>Close</button>
                <button onClick={downloadResult} style={{ ...s.pri, flex:1 }}>⬇ Download Result Excel (codes + status)</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
