'use client'
// components/statutory/PerquisiteStatutoryPanel.tsx
// Statutory-tab wrapper: pick an employee + base taxable salary, then show
// PerquisiteTaxSummary (Base + Perquisite = Taxable Income → TDS/Cess/Surcharge).
import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import PerquisiteTaxSummary from './PerquisiteTaxSummary'
import { getPerquisiteConfig } from '@/lib/perquisites/actions'
import { getEmployeePerquisites, saveEmployeePerquisite } from '@/lib/perquisites/employeeActions'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = { navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface, border: TK.line, muted: TK.muted }
const font = '"DM Sans","Segoe UI",sans-serif'
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: font, boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }

export default function PerquisiteStatutoryPanel({ fy }: { fy: string }) {
  const [emps, setEmps] = useState<{ id: string; emp_code: string; full_name: string }[]>([])
  const [empId, setEmpId] = useState('')
  const [base, setBase] = useState('')
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    supabase.from('employees').select('id, emp_code, full_name').eq('employment_status', 'Active').neq('is_test', true).order('emp_code')
      .then(({ data }) => setEmps(data || []))
    getPerquisiteConfig(fy).then(rows => {
      const seen = new Set<string>(); const list: { id: string; name: string }[] = []
      rows.forEach(r => { if (!seen.has(r.perquisite_type_id)) { seen.add(r.perquisite_type_id); list.push({ id: r.perquisite_type_id, name: r.name }) } })
      setTypes(list)
    }).catch(() => setTypes([]))
  }, [fy])

  const loadAmounts = useCallback(async () => {
    if (!empId) { setAmounts({}); return }
    const existing = await getEmployeePerquisites(empId, fy)
    const map: Record<string, string> = {}
    existing.forEach((e: any) => { map[e.perquisite_type_id] = String(e.amount ?? '') })
    setAmounts(map)
  }, [empId, fy])

  useEffect(() => {
    if (!empId) { setBase(''); return }
    supabase.from('ctc_master').select('annual_ctc, annual_variable').eq('employee_id', empId).order('effective_from', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data?.annual_ctc != null) setBase(String(Math.round(Number(data.annual_ctc) - Number(data.annual_variable || 0)))) })
    loadAmounts()
  }, [empId, loadAmounts])

  async function saveAmounts() {
    if (!empId) return
    setSaving(true)
    try {
      for (const t of types) {
        const raw = amounts[t.id]
        if (raw !== undefined && raw !== '') {
          await saveEmployeePerquisite({ employeeId: empId, perquisiteTypeId: t.id, fy, amount: Number(raw) || 0 })
        }
      }
      setRefresh(r => r + 1)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, maxWidth: 560 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Perquisite tax impact</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Employee</label>
            <select style={inp} value={empId} onChange={e => setEmpId(e.target.value)}>
              <option value="">Select employee</option>
              {emps.map(e => <option key={e.id} value={e.id}>{e.emp_code} — {e.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Base taxable salary (₹/yr)</label>
            <input type="number" style={inp} value={base} onChange={e => setBase(e.target.value)} placeholder="pre-perquisite" />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8 }}>Base auto-fills from CTC (annual CTC − variable); adjust to the actual pre-perquisite taxable figure.</div>
      </div>

      {empId && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, maxWidth: 560 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>This employee&apos;s perquisite amounts · FY {fy}</div>
          {types.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No active perquisite types — configure them in Configuration → Perquisite (run sql63/sql64 first).</div> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 8, alignItems: 'center' }}>
                {types.map(t => (
                  <Fragment key={t.id}>
                    <div style={{ fontSize: 12.5, color: C.navy }}>{t.name}</div>
                    <input type="number" placeholder="₹ / yr" style={{ ...inp, width: 130 }} value={amounts[t.id] ?? ''} onChange={e => setAmounts(p => ({ ...p, [t.id]: e.target.value }))} />
                  </Fragment>
                ))}
              </div>
              <button onClick={saveAmounts} disabled={saving} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save amounts'}</button>
            </>
          )}
        </div>
      )}

      {empId && <PerquisiteTaxSummary key={refresh} employeeId={empId} fy={fy} baseTaxableSalary={Number(base) || 0} />}
    </div>
  )
}
