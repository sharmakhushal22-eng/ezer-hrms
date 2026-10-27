'use client'
// components/payroll/CompanyProfileView.tsx — READ-ONLY company profile.
// Same layout as /dashboard/company-profile (Group → Company → Branch → Statutory →
// Bank → License) but view-only: no inline edit, no payment, no navigation. Rendered
// inline inside the Payroll → Configuration → "Group & Company" sub-tab (URL unchanged).
import { useState, useEffect, useCallback } from 'react'
import { loadHierarchy, type GroupTree, type Company, type Branch, type Registration } from '@/lib/supabase-company-profile'
import { C as TK, F, W, S, R, E, numeric, eyebrow, IconBuilding, IconCompliance, IconFinance, IconCard, IconLetters } from '@/lib/ui'
import { GroupHeader } from '@/components/company/GroupHeader'
import { StatusPill, EmptyState, DataTable, dt, InfoCallout, CountChip, SubHead, IconTile, IconInfo, type KitTone } from '@/components/payroll/kit'

const C = {
  card:  { background:TK.surface, borderRadius:R.lg, border: `1px solid ${TK.line}`, padding:'14px 16px', marginBottom:S.lg, boxShadow:E.raised } as React.CSSProperties,
  lbl:   { ...eyebrow, fontSize:F.micro } as React.CSSProperties,
  val:   { fontSize:F.small, color:TK.ink, marginTop:3, fontWeight:W.medium, overflowWrap:'anywhere', ...numeric } as React.CSSProperties,
  sec:   { marginBottom:S.sm + 2 } as React.CSSProperties,
}
const REG_TONE: Record<string, KitTone> = { GST:'info', EPF:'brand', ESIC:'positive', PT:'warning', LWF:'info', FACTORY:'critical' }
const fmt = (s?: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '-'

function StatusBadge({ status, days }: { status: string; days: number | null }) {
  const map: Record<string, [KitTone, string]> = {
    ACTIVE:   ['positive', 'Active'],
    GRACE:    ['warning', 'Grace period'],
    SUSPENDED:['critical', 'Suspended'],
  }
  const [t, label] = map[status] || map.ACTIVE
  let hint = ''
  if (status === 'ACTIVE' && days !== null) hint = ` · ${days}d to due`
  if (status === 'GRACE') hint = ' · pay before suspension'
  return <StatusPill t={t} dot size="sm">{label}{hint}</StatusPill>
}
function ROField({ label, value, fmtFn }: { label: string; value: any; fmtFn?: (v: any) => string }) {
  return <div style={{ minWidth:0 }}><div style={C.lbl}>{label}</div><div style={C.val}>{fmtFn ? fmtFn(value) : (value === null || value === undefined || value === '' ? '-' : String(value))}</div></div>
}
/** A titled block inside the company card. */
function Block({ title, icon, right, children }: { title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom:S.xl - 4 }}>
      <SubHead right={right}><span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><span style={{ display:'inline-flex', color:TK.brand }}>{icon}</span>{title}</span></SubHead>
      {children}
    </div>
  )
}

function CompanyCard({ co, isMobile }: { co: Company; isMobile: boolean }) {
  const lic = co.license
  return (
    <div style={{ ...C.card, padding:0, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:S.md, flexWrap:'wrap', padding:'14px 18px', borderBottom: `1px solid ${TK.line}` }}>
        <IconTile icon={<IconBuilding size={17} />} t="brand" size={36} />
        <div style={{ minWidth:0, flex:'1 1 220px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:F.lead, fontWeight:W.bold, color:TK.ink, letterSpacing:'-.01em' }}>{co.company_name}</span>
            {co.company_type && <StatusPill t="brand" size="sm">{co.company_type}</StatusPill>}
          </div>
          <div style={{ fontSize:F.tiny, color:TK.muted, marginTop:2, ...numeric }}>{co.company_code}</div>
        </div>
        <span style={{ marginLeft:'auto' }}><StatusBadge status={co.account_status} days={co.days_to_due} /></span>
      </div>

      <div style={{ padding:'16px 18px 4px' }}>
          <Block title="Company details" icon={<IconLetters size={13} />}>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,minmax(0,1fr))', gap:'14px 18px', background:TK.sunken, border:`1px solid ${TK.line}`, borderRadius:R.md, padding:'14px 16px' }}>
              <ROField label="Employer / Director" value={co.short_name} />
              <ROField label="Industry" value={co.industry} />
              <ROField label="PAN" value={co.pan} />
              <ROField label="TAN" value={co.tan} />
              <ROField label="CIN" value={co.cin} />
              <ROField label="Incorporated" value={co.date_of_inc} fmtFn={fmt} />
              <div style={{ gridColumn:'1 / -1' }}><ROField label="Registered office" value={co.reg_office} /></div>
            </div>
          </Block>

          <Block title={`Branches (${co.branches.length})`} icon={<IconBuilding size={13} />}>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:S.sm + 2 }}>
              {co.branches.map((b: Branch) => (
                <div key={b.id} style={{ border: `1px solid ${TK.line}`, borderRadius:R.md, padding:'12px 14px', background:TK.surface, boxShadow:E.flat, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:F.small, fontWeight:W.semi, color:TK.ink }}>{b.location_name}</span>
                    <StatusPill size="sm">{b.location_type}</StatusPill>
                  </div>
                  <div style={{ fontSize:F.tiny, color:TK.muted, marginBottom:10, lineHeight:1.45 }}>
                    {[b.address_line1, b.city, b.pin_code].filter(Boolean).join(', ') || '-'}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 12px', marginBottom:10 }}>
                    <ROField label="District" value={b.district} />
                    <ROField label="State" value={b.state} />
                  </div>
                  <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
                    <div><div style={C.lbl}>GPS</div><div style={{ ...C.val, fontSize:F.tiny }}>{b.latitude != null && b.longitude != null ? <>{b.latitude}, {b.longitude} <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer" style={{ color:TK.brand, fontSize:F.tiny, fontWeight:W.semi }}>map</a></> : '-'}</div></div>
                    <ROField label="Max employees" value={b.max_employees} />
                  </div>
                </div>
              ))}
              {co.branches.length === 0 && <div style={{ fontSize:F.tiny, color:TK.faint }}>No branches.</div>}
            </div>
          </Block>

          <Block title="Statutory registrations" icon={<IconCompliance size={13} />} right={<CountChip>{co.registrations.length}</CountChip>}>
            <DataTable framed>
              <tbody>
                {co.registrations.map((r: Registration) => (
                  <tr key={r.id} className={dt.rowClass}>
                    <td style={{ ...dt.td, width:90 }}><StatusPill t={REG_TONE[r.reg_type] || 'neutral'} size="sm">{r.reg_type}</StatusPill></td>
                    <td style={dt.tdMono}>{r.reg_number || '-'}</td>
                    <td style={{ ...dt.td, color:TK.muted }}>{[r.state, r.district].filter(Boolean).join(' · ') || '-'}</td>
                  </tr>
                ))}
                {co.registrations.length === 0 && <tr><td style={{ ...dt.td, color:TK.faint }}>No registrations.</td></tr>}
              </tbody>
            </DataTable>
          </Block>

          {co.bank.length > 0 && (
            <Block title="Bank accounts" icon={<IconCard size={13} />}>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {co.bank.map(bk => (
                  <div key={bk.id} style={{ fontSize:F.small, color:TK.inkSoft, padding:'9px 12px', border:`1px solid ${TK.line}`, borderRadius:R.md, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', ...numeric }}>
                    <b style={{ color:TK.ink }}>{bk.bank_name}</b> · A/c ••••{(bk.account_number || '').slice(-4)} · {bk.ifsc_code} · {bk.account_type}{bk.is_primary ? <> · <StatusPill t="positive" size="sm">primary</StatusPill></> : ''}
                  </div>
                ))}
              </div>
            </Block>
          )}

          <Block title="License & billing" icon={<IconFinance size={13} />}>
            {lic ? (
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,minmax(0,1fr))', gap:'14px 18px', alignItems:'flex-end', background:TK.sunken, border:`1px solid ${TK.line}`, borderRadius:R.md, padding:'14px 16px' }}>
                <ROField label="Plan" value={lic.plan_name} />
                <ROField label="Max employees" value={lic.max_employees} />
                <div><div style={C.lbl}>Max locations</div><div style={C.val}>{lic.max_locations || '-'} <span style={{ color:TK.faint, fontSize:F.tiny }}>({co.branches.length} used)</span></div></div>
                <ROField label="Billing cycle" value={lic.billing_cycle || 'QUARTERLY'} />
                <ROField label="Paid till" value={lic.paid_till} fmtFn={fmt} />
                <ROField label="Grace" value={`${lic.grace_days ?? 30} days`} />
                <div><div style={C.lbl}>Status</div><div style={{ marginTop:3 }}><StatusBadge status={co.account_status} days={co.days_to_due} /></div></div>
              </div>
            ) : <div style={{ fontSize:F.tiny, color:TK.faint }}>No license plan set.</div>}
          </Block>
      </div>
    </div>
  )
}

export default function CompanyProfileView() {
  const [groups, setGroups] = useState<GroupTree[]>([])
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try { setGroups(await loadHierarchy()) } catch { /* leave empty on error */ }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  if (loading) return <div style={C.card}><EmptyState compact t="neutral" icon={<IconBuilding size={20} />} title="Loading company profile…" /></div>
  if (groups.length === 0) return <div style={C.card}><EmptyState compact t="neutral" icon={<IconBuilding size={20} />} title="No group / company found yet." hint="Add data from Company Setup first." /></div>

  return (
    <div style={{ fontFamily:F.family, color:TK.ink, minWidth:0 }}>
      <InfoCallout t="neutral" compact icon={<IconInfo size={14} />}>Group, companies, branches, statutory registrations, bank &amp; license (view only). To edit, open Company Profile from Admin.</InfoCallout>
      {groups.map(g => (
        <div key={g.id} style={{ marginBottom:S.xl }}>
          <GroupHeader g={g} card={C.card} />
          {g.companies.map(co => <CompanyCard key={co.id} co={co} isMobile={isMobile} />)}
        </div>
      ))}
    </div>
  )
}
