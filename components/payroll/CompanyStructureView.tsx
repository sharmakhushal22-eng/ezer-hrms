'use client'
// components/payroll/CompanyStructureView.tsx — company-wise org structure (read-only).
// Departments · Sub-departments · Locations/Branches for the selected company
// (or all companies in Group mode). Not employee-level.
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = { navy: TK.ink, purple: TK.violet, purpleD: TK.violetDeep, card: TK.surface, border: TK.line, muted: TK.muted, purpleBg: TK.violetTint, teal: '#0F6E56', amber: TK.warning }
const font = '"DM Sans","Segoe UI",sans-serif'

function SectionCard({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(124,58,237,0.06)', minWidth: 260, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{icon}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{title}</div>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '2px 9px' }}>{count}</span>
      </div>
      {children}
    </div>
  )
}

export default function CompanyStructureView({ companyId }: { companyId: string }) {
  const [depts, setDepts] = useState<any[]>([])
  const [subs, setSubs] = useState<any[]>([])
  const [locs, setLocs] = useState<any[]>([])
  const [comps, setComps] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const allCo = !companyId

  useEffect(() => {
    setLoading(true)
    let dq = supabase.from('departments').select('id, dept_code, dept_name, company_id').order('dept_name')
    let sq = supabase.from('sub_departments').select('id, code, name, company_id, department_id').order('name')
    let lq = supabase.from('locations').select('id, location_code, location_name, location_type, company_id').order('location_name')
    if (companyId) { dq = dq.eq('company_id', companyId); sq = sq.eq('company_id', companyId); lq = lq.eq('company_id', companyId) }
    Promise.all([
      dq.then(r => r, () => ({ data: [] })),
      sq.then(r => r, () => ({ data: [] })),
      lq.then(r => r, () => ({ data: [] })),
      supabase.from('companies').select('id, company_name'),
    ]).then(([d, s, l, c]: any) => {
      setDepts(d.data || []); setSubs(s.data || []); setLocs(l.data || [])
      const cm: Record<string, string> = {}; (c.data || []).forEach((x: any) => { cm[x.id] = x.company_name }); setComps(cm)
      setLoading(false)
    })
  }, [companyId])

  const deptName: Record<string, string> = {}; depts.forEach(d => { deptName[d.id] = d.dept_name })
  const co = (id: string) => allCo ? <span style={{ fontSize: 9.5, color: C.muted }}> · {comps[id] || '—'}</span> : null
  const item = (main: React.ReactNode, sub: React.ReactNode) => (
    <div style={{ padding: '7px 0', borderBottom: '1px solid #F3F0FF' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>{main}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{sub}</div>}
    </div>
  )
  const empty = (t: string) => <div style={{ fontSize: 11.5, color: TK.faint }}>{t}</div>

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Company-wise organisation structure {allCo ? '(all companies)' : ''} — departments, sub-departments and locations. Manage the values in <b>Admin Setup</b>.</div>
      {loading ? <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div> : (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <SectionCard icon="🗂️" title="Departments" count={depts.length}>
            {depts.length === 0 ? empty('No departments.') : depts.map(d => (
              <div key={d.id}>{item(<>{d.dept_name}{d.dept_code ? <span style={{ color: C.muted, fontWeight: 400 }}> · {d.dept_code}</span> : null}</>, co(d.company_id))}</div>
            ))}
          </SectionCard>

          <SectionCard icon="🧩" title="Sub-departments" count={subs.length}>
            {subs.length === 0 ? empty('No sub-departments yet — add them in Admin Setup.') : subs.map(s => (
              <div key={s.id}>{item(<>{s.name}{s.code ? <span style={{ color: C.muted, fontWeight: 400 }}> · {s.code}</span> : null}</>, <>{s.department_id && deptName[s.department_id] ? `under ${deptName[s.department_id]}` : ''}{co(s.company_id)}</>)}</div>
            ))}
          </SectionCard>

          <SectionCard icon="📍" title="Locations / Branches" count={locs.length}>
            {locs.length === 0 ? empty('No locations.') : locs.map(l => (
              <div key={l.id}>{item(<>{l.location_name}{l.location_code ? <span style={{ color: C.muted, fontWeight: 400 }}> · {l.location_code}</span> : null}</>, <>{l.location_type || ''}{co(l.company_id)}</>)}</div>
            ))}
          </SectionCard>
        </div>
      )}
    </div>
  )
}
