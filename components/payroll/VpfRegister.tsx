'use client'
// components/payroll/VpfRegister.tsx — Statutory & Tax → VPF.
//
// Voluntary PF is declared per employee per FY (vpf_declarations, migration 040), not frozen
// into a payroll month the way the statutory registers are — so this reads the live ACTIVE
// declarations rather than payroll_employee_snapshot. One active row per employee per FY.
// The bulk uploader on this screen writes the same table (supersede-then-insert + audit).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { C } from '@/lib/ui'
import StatutoryBulkUpload from '@/components/payroll/StatutoryBulkUpload'

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const font = '"DM Sans","Segoe UI",sans-serif'

interface VpfRow {
  id: string; employee_id: string; company_id: string; vpf_percent: number
  epf_wage_base: number; monthly_vpf_amount: number; annual_vpf_amount: number
  effective_from_month: number; status: string
  employees?: { emp_code: string; full_name: string; departments?: { dept_name: string } | null } | null
}

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', background: C.sunken, position: 'sticky', top: 0, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, color: C.ink, borderTop: `1px solid ${C.line}`, whiteSpace: 'nowrap' }
const card: React.CSSProperties = { background: C.surface, borderRadius: 14, border: `1px solid ${C.line}`, padding: '16px 18px', marginBottom: 16 }
const sel: React.CSSProperties = { padding: '8px 10px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, fontSize: 13, outline: 'none', fontFamily: font, boxSizing: 'border-box' }

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div style={{ padding: '7px 12px', borderRadius: 10, background: C.sunken, border: `1px solid ${C.line}`, minWidth: 90 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: tone || C.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

export default function VpfRegister({ companyId, fy, month }: { companyId: string; fy: string; month?: number }) {
  void month
  const [rows, setRows] = useState<VpfRow[]>([])
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const isGroup = !companyId

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('vpf_declarations')
      .select('id, employee_id, company_id, vpf_percent, epf_wage_base, monthly_vpf_amount, annual_vpf_amount, effective_from_month, status, employees(emp_code, full_name, departments!employees_department_id_fkey(dept_name))')
      .eq('fy', fy).eq('status', 'ACTIVE').order('monthly_vpf_amount', { ascending: false })
    if (companyId) query = query.eq('company_id', companyId)
    const { data } = await query
    setRows((data as any as VpfRow[]) || [])
    if (isGroup) {
      const { data: cos } = await supabase.from('companies').select('id, company_name')
      setCompanyNames(Object.fromEntries((cos || []).map((c: any) => [c.id, c.company_name])))
    }
    setLoading(false)
  }, [companyId, fy, isGroup])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter(r => terms.some(t => String(r.employees?.emp_code || '').toLowerCase().includes(t) || String(r.employees?.full_name || '').toLowerCase().includes(t)))
  }, [rows, q])

  const totalMonthly = shown.reduce((s, r) => s + (Number(r.monthly_vpf_amount) || 0), 0)
  const totalAnnual = shown.reduce((s, r) => s + (Number(r.annual_vpf_amount) || 0), 0)

  return (
    <div style={{ fontFamily: font, color: C.ink }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15 }}>Voluntary Provident Fund (VPF)</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Every employee's live VPF declaration for FY {fy} — the voluntary contribution over the mandatory 12% PF. Declared in ESS or set in bulk below.</div>
      </div>

      {/* Bulk uploader — download the current declarations, edit the VPF %, upload to update. */}
      <StatutoryBulkUpload kind="vpf" companyId={companyId} fy={fy} onApplied={load} />

      <div style={card}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Stat label="On VPF" value={shown.length} tone={shown.length ? C.positive : C.muted} />
          <Stat label="Monthly VPF" value={inr(totalMonthly)} tone={C.brandDeep} />
          <Stat label="Annual VPF" value={inr(totalAnnual)} tone={C.brandDeep} />
          <div style={{ flex: 1 }} />
          <input style={{ ...sel, flex: 1, minWidth: 200, maxWidth: 320 }} placeholder="Employee code or name" value={q} onChange={e => setQ(e.target.value)} />
          <button onClick={load} style={{ ...sel, cursor: 'pointer', fontWeight: 600, background: C.surface }}>Refresh</button>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '64vh', borderRadius: 10, border: `1px solid ${C.line}` }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>{rows.length === 0 ? 'No active VPF declarations for FY ' + fy + ' yet. Employees can declare VPF in ESS, or set it in bulk above.' : 'Nothing matched this search.'}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={th}>Code</th>
                  <th style={th}>Name</th>
                  {isGroup && <th style={th}>Company</th>}
                  <th style={th}>Department</th>
                  <th style={{ ...th, textAlign: 'right' }}>VPF %</th>
                  <th style={{ ...th, textAlign: 'right' }}>EPF wage base</th>
                  <th style={{ ...th, textAlign: 'right' }}>Monthly VPF</th>
                  <th style={{ ...th, textAlign: 'right' }}>Annual VPF</th>
                  <th style={th}>Effective from</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.employees?.emp_code || '—'}</td>
                    <td style={td}>{r.employees?.full_name || '—'}</td>
                    {isGroup && <td style={{ ...td, color: C.muted }}>{companyNames[r.company_id] || '—'}</td>}
                    <td style={{ ...td, color: C.muted }}>{r.employees?.departments?.dept_name || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.vpf_percent) || 0}%</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(r.epf_wage_base)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{inr(r.monthly_vpf_amount)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(r.annual_vpf_amount)}</td>
                    <td style={{ ...td, color: C.muted }}>{MONTHS[(Number(r.effective_from_month) || 1) - 1]} {fy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: C.brandDeep, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: 10, padding: '10px 13px', lineHeight: 1.6, marginTop: 12 }}>
          • VPF is capped at 88% of PF wages (12% mandatory PF + 88% = 100%). • Shows only the current ACTIVE declaration for each employee; stopped or superseded ones are hidden. • Changing a VPF % here supersedes the old declaration and is picked up on the next payroll run.
        </div>
      </div>
    </div>
  )
}
