'use client'
// components/payroll/CompanyStructureView.tsx — company-wise org structure (read-only).
// Departments · Sub-departments · Locations/Branches for the selected company
// (or all companies in Group mode). Not employee-level.
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { C, F, W, S, IconOrgChart, IconSliders, IconBuilding } from '@/lib/ui'
import { SectionCard, CountChip, EmptyState, InfoCallout, IconInfo } from '@/components/payroll/kit'

function StructCard({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <SectionCard icon={icon} title={title} actions={<CountChip t="brand">{count}</CountChip>} style={{ marginBottom: 0 }} bodyStyle={{ padding: `4px ${S.lg}px ${S.sm}px` }}>
      {children}
    </SectionCard>
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
  const co = (id: string) => allCo ? <span style={{ fontSize: F.tiny, color: C.muted }}> · {comps[id] || '-'}</span> : null
  const item = (main: React.ReactNode, sub: React.ReactNode) => (
    <div className="ez-row" style={{ padding: '9px 6px', margin: '0 -6px', borderBottom: `1px solid ${C.line}`, borderRadius: 6 }}>
      <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{main}</div>
      {sub && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
  const empty = (t: string) => <div style={{ fontSize: F.tiny, color: C.faint, padding: '10px 0' }}>{t}</div>

  return (
    <div style={{ fontFamily: F.family, color: C.ink, minWidth: 0 }}>
      <InfoCallout t="neutral" compact icon={<IconInfo size={14} />}>Company-wise organisation structure {allCo ? '(all companies)' : ''}: departments, sub-departments and locations. Manage the values in <b>Admin Setup</b>.</InfoCallout>
      {loading ? <SectionCard><EmptyState compact t="neutral" icon={<IconOrgChart size={20} />} title="Loading…" /></SectionCard> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: S.lg, alignItems: 'start' }}>
          <StructCard icon={<IconOrgChart size={16} />} title="Departments" count={depts.length}>
            {depts.length === 0 ? empty('No departments.') : depts.map(d => (
              <div key={d.id}>{item(<>{d.dept_name}{d.dept_code ? <span style={{ color: C.muted, fontWeight: W.regular }}> · {d.dept_code}</span> : null}</>, co(d.company_id))}</div>
            ))}
          </StructCard>

          <StructCard icon={<IconSliders size={16} />} title="Sub-departments" count={subs.length}>
            {subs.length === 0 ? empty('No sub-departments yet. Add them in Admin Setup.') : subs.map(s => (
              <div key={s.id}>{item(<>{s.name}{s.code ? <span style={{ color: C.muted, fontWeight: W.regular }}> · {s.code}</span> : null}</>, <>{s.department_id && deptName[s.department_id] ? `under ${deptName[s.department_id]}` : ''}{co(s.company_id)}</>)}</div>
            ))}
          </StructCard>

          <StructCard icon={<IconBuilding size={16} />} title="Locations / Branches" count={locs.length}>
            {locs.length === 0 ? empty('No locations.') : locs.map(l => (
              <div key={l.id}>{item(<>{l.location_name}{l.location_code ? <span style={{ color: C.muted, fontWeight: W.regular }}> · {l.location_code}</span> : null}</>, <>{l.location_type || ''}{co(l.company_id)}</>)}</div>
            ))}
          </StructCard>
        </div>
      )}
    </div>
  )
}
