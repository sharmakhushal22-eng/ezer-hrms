'use client'
// components/statutory/PerquisiteStatutoryPanel.tsx
// Statutory-tab wrapper: pick an employee + base taxable salary, then show
// PerquisiteTaxSummary (Base + Perquisite = Taxable Income → TDS/Cess/Surcharge).
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import PerquisiteTaxSummary from './PerquisiteTaxSummary'
import { getPerquisiteConfig } from '@/lib/perquisites/actions'
import { getEmployeePerquisites, saveEmployeePerquisite } from '@/lib/perquisites/employeeActions'
import { C, F, W, S, numeric, IconReceipt, IconEmployees, IconCompliance } from '@/lib/ui'
import { SectionCard, PButton, EmptyState, CountChip, IconInfo } from '@/components/payroll/kit'
import { CField, cfgInput } from '@/components/payroll/configKit'

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
    <div style={{ fontFamily: F.family, color: C.ink, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: S.lg, alignItems: 'start', maxWidth: 1120 }}>
        <SectionCard title="Perquisite tax impact" icon={<IconCompliance size={16} />} hint="Pick an employee and their pre-perquisite taxable salary." style={{ marginBottom: 0 }}
          bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: S.md }}>
            <CField label="Employee">
              <select style={{ ...cfgInput, cursor: 'pointer' }} value={empId} onChange={e => setEmpId(e.target.value)}>
                <option value="">Select employee</option>
                {emps.map(e => <option key={e.id} value={e.id}>{e.emp_code} · {e.full_name}</option>)}
              </select>
            </CField>
            <CField label="Base taxable salary (₹/yr)">
              <input type="number" style={cfgInput} value={base} onChange={e => setBase(e.target.value)} placeholder="pre-perquisite" />
            </CField>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: F.tiny, color: C.muted, lineHeight: 1.5 }}>
            <span style={{ display: 'inline-flex', color: C.faint, marginTop: 1 }}><IconInfo size={13} /></span>
            Base auto-fills from CTC (annual CTC − variable); adjust to the actual pre-perquisite taxable figure.
          </div>
        </SectionCard>

        {empId ? (
          <SectionCard title={<>This employee&apos;s perquisite amounts · FY <span style={{ ...numeric }}>{fy}</span></>} icon={<IconReceipt size={16} />}
            actions={types.length ? <CountChip>{types.length} types</CountChip> : undefined} style={{ marginBottom: 0 }}>
            {types.length === 0 ? <div style={{ fontSize: F.small, color: C.muted }}>No active perquisite types. Configure them in Configuration → Perquisite (run sql63/sql64 first).</div> : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {types.map((t, i) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: '7px 0', borderBottom: i < types.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: F.small, color: C.ink, fontWeight: W.medium }}>{t.name}</div>
                      <input type="number" placeholder="₹ / yr" style={{ ...cfgInput, width: 140, textAlign: 'right' }} value={amounts[t.id] ?? ''} onChange={e => setAmounts(p => ({ ...p, [t.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${C.line}` }}>
                  <PButton variant="primary" onClick={saveAmounts} disabled={saving}>{saving ? 'Saving…' : 'Save amounts'}</PButton>
                </div>
              </>
            )}
          </SectionCard>
        ) : (
          <SectionCard style={{ marginBottom: 0 }}>
            <EmptyState compact icon={<IconEmployees size={20} />} title="Choose an employee" hint="Their perquisite amounts and the tax summary appear here." />
          </SectionCard>
        )}
      </div>

      {empId && <div style={{ marginTop: S.lg }}><PerquisiteTaxSummary key={refresh} employeeId={empId} fy={fy} baseTaxableSalary={Number(base) || 0} /></div>}
    </div>
  )
}
