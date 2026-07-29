// ================================================================
// EZER HRMS — Statutory tab: Perquisite Tax Impact
// Path: components/statutory/PerquisiteTaxSummary.tsx
//
// Drop into the existing Statutory tab for a selected employee. Shows
// exactly the flow asked for: Base Salary + Perquisite = Taxable
// Income, then TDS + Cess + Surcharge = Total. The TDS/Cess/Surcharge
// numbers come from computeTaxSTUB() — swap that one import for the
// real computeTax() engine; this component doesn't know or care how
// tax gets computed, only that it receives a taxable income number
// and gets back a breakdown.
// ================================================================
'use client'
import { useState, useEffect } from 'react'
import { getEmployeePerquisites, getTaxableIncomeWithPerquisites, computeTaxSTUB } from '@/lib/perquisites/employeeActions'
import type { TaxableIncomeResult, TaxBreakdown } from '@/lib/perquisites/employeeActions'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489',
  card: '#FFFFFF', border: '#E9E7F5', muted: '#6B7280',
  green: '#059669', greenBg: '#ECFDF5', purpleBg: '#EEEDFE', gray: '#F8F7FF',
}

function Row({ label, value, bold, indent }: { label: string; value: string; bold?: boolean; indent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', paddingLeft: indent ? 16 : 0, borderBottom: bold ? 'none' : `1px solid ${C.border}` }}>
      <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 500, color: bold ? C.navy : C.muted }}>{label}</span>
      <span style={{ fontSize: bold ? 14 : 12, fontWeight: bold ? 700 : 600, color: bold ? C.navy : C.navy }}>{value}</span>
    </div>
  )
}

export default function PerquisiteTaxSummary({ employeeId, fy, baseTaxableSalary }: { employeeId: string; fy: string; baseTaxableSalary: number }) {
  const [income, setIncome] = useState<TaxableIncomeResult | null>(null)
  const [tax, setTax] = useState<TaxBreakdown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getTaxableIncomeWithPerquisites(employeeId, fy, baseTaxableSalary).then(result => {
      if (cancelled) return
      setIncome(result)
      setTax(computeTaxSTUB(result.taxable_income_with_perquisite)) // TODO: replace with real computeTax()
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [employeeId, fy, baseTaxableSalary])

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  if (loading || !income || !tax) {
    return <div style={{ padding: 20, color: C.muted, fontSize: 12 }}>Loading perquisite tax impact…</div>
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', maxWidth: 420 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
        Perquisite tax impact — FY {fy}
      </div>

      <Row label="Base taxable salary" value={inr(income.base_taxable_salary)} />
      <Row label="+ Perquisite amount" value={inr(income.total_perquisite_amount)} />

      {Object.keys(income.breakdown_by_type).length > 0 && (
        <div style={{ background: C.gray, borderRadius: 8, padding: '8px 10px', margin: '6px 0 10px' }}>
          {Object.entries(income.breakdown_by_type).map(([name, amt]) => (
            <Row key={name} label={name} value={inr(amt)} indent />
          ))}
        </div>
      )}

      <div style={{ borderTop: `2px solid ${C.purpleBg}`, marginTop: 6, paddingTop: 6 }}>
        <Row label="= Total taxable income" value={inr(income.taxable_income_with_perquisite)} bold />
      </div>

      <div style={{ height: 12 }} />

      <Row label="TDS" value={inr(tax.tds)} />
      <Row label="+ Cess (4%)" value={inr(tax.cess)} />
      <Row label="+ Surcharge" value={inr(tax.surcharge)} />

      <div style={{ background: C.purpleBg, borderRadius: 8, padding: '10px 12px', marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.purpleD }}>TOTAL</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: C.purpleD }}>{inr(tax.total)}</span>
      </div>

      <div style={{ fontSize: 9.5, color: C.muted, marginTop: 8 }}>
        TDS/Cess/Surcharge shown here use a placeholder calculation — wired to EZER's existing tax engine at integration time.
      </div>
    </div>
  )
}
