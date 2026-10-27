'use client'
// app/dashboard/tds-calculator/page.tsx — Help → TDS Calculator, for the hiring and HR roles
// (lib/rms/nav.ts TDS_CALCULATOR_ROLES). Rendered in the dashboard and inside ESS (AdminModules).
//
// It is the same Flexi & TDS calculator employees declare with (components/ess/FlexiTdsCalculator),
// in its sandbox mode: nothing is saved and nobody's declaration is read or changed. Figures are
// typed in, or prefilled from an employee's CTC and joining date. Prefilling someone else's salary
// is for the HR roles; a Hiring Manager / Recruiter types the figures (e.g. a candidate's offer).
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { companyFilter } from '@/lib/rms/resolve'
import { roleEntryOpen, TDS_CALCULATOR_ROLES } from '@/lib/rms/nav'
import { Page, PageHeader, Card, C as TK } from '@/lib/ui'

const FlexiTdsCalculator = dynamic(() => import('@/components/ess/FlexiTdsCalculator'), { ssr: false })

/** The roles that may prefill another employee's salary; the rest type figures in. */
const PREFILL_ROLES = TDS_CALCULATOR_ROLES.filter(r => r !== 'RECRUITER')

type Emp = { id: string; full_name: string; emp_code: string | null; designation: string | null }

function EmployeePick({ emps, value, onPick }: { emps: Emp[]; value: Emp | null; onPick: (e: Emp | null) => void }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return emps.filter(e => e.full_name.toLowerCase().includes(s) || (e.emp_code || '').toLowerCase().includes(s)).slice(0, 8)
  }, [q, emps])
  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: TK.ink }}>Prefilled from <b>{value.full_name}</b> <span style={{ color: TK.muted }}>{value.emp_code}{value.designation ? ` · ${value.designation}` : ''}</span></span>
        <button type="button" onClick={() => onPick(null)} style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${TK.line}`, background: TK.surface, color: TK.ink, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>Clear · blank calculator</button>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', maxWidth: 420 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Prefill from an employee: search name or emp code (optional)"
        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${TK.line}`, borderRadius: 7, background: TK.surface, color: TK.ink, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
      {hits.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 3, background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden' }}>
          {hits.map(e => (
            <button key={e.id} type="button" onClick={() => { onPick(e); setQ('') }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderBottom: `1px solid ${TK.line}`, background: TK.surface, color: TK.ink, cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
              {e.full_name} <span style={{ color: TK.muted }}>· {e.emp_code || '-'}{e.designation ? ` · ${e.designation}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TdsCalculatorPage() {
  const { grant, loading } = useGrant()
  const codes = grant.roles.map(r => r.role_code)
  const superAdmin = grant.isSuperAdmin || grant.legacy
  const allowed = roleEntryOpen({ roles: TDS_CALCULATOR_ROLES }, codes, superAdmin)
  const canPrefill = roleEntryOpen({ roles: PREFILL_ROLES }, codes, superAdmin)
  const [emps, setEmps] = useState<Emp[]>([])
  const [picked, setPicked] = useState<Emp | null>(null)

  useEffect(() => {
    if (loading || !allowed || !canPrefill) return
    const co = companyFilter(grant, null)
    let q = supabase.from('employees').select('id, full_name, emp_code, designation').eq('employment_status', 'Active').order('full_name').limit(2000)
    if (co) q = q.eq('company_id', co)
    q.then(({ data }) => setEmps((data as Emp[]) || []))
  }, [loading, allowed, canPrefill]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Page><div style={{ padding: 24, color: TK.muted, fontSize: 13 }}>Loading…</div></Page>
  if (!allowed) {
    return (
      <Page>
        <PageHeader title="TDS Calculator" context="Help" />
        <Card><div style={{ fontSize: 13, color: TK.muted }}>The TDS Calculator is for Hiring Managers and the HR team (HR Executive, Branch HR, HR Manager, HR Head, CHRO). Your own tax declaration is in Flexi &amp; TDS on your portal.</div></Card>
      </Page>
    )
  }
  return (
    <Page>
      <PageHeader title="TDS Calculator" context="Help · nothing here is saved" />
      {canPrefill && (
        <Card style={{ marginBottom: 12 }}>
          <EmployeePick emps={emps} value={picked} onPick={setPicked} />
        </Card>
      )}
      {/* keyed on the employee so a new pick starts from a clean calculator */}
      <FlexiTdsCalculator key={picked?.id || 'blank'} sandbox employeeId={picked?.id || ''} empName={picked?.full_name} empCode={picked?.emp_code || 'calculation'} />
    </Page>
  )
}
