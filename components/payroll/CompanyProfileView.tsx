'use client'
// components/payroll/CompanyProfileView.tsx — READ-ONLY company profile.
// Same layout as /dashboard/company-profile (Group → Company → Branch → Statutory →
// Bank → License) but view-only: no inline edit, no payment, no navigation. Rendered
// inline inside the Payroll → Configuration → "Group & Company" sub-tab (URL unchanged).
import { useState, useEffect, useCallback } from 'react'
import { loadHierarchy, type GroupTree, type Company, type Branch, type Registration } from '@/lib/supabase-company-profile'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  card:  { background:TK.surface, borderRadius:10, border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:10 } as React.CSSProperties,
  lbl:   { fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.04em' } as React.CSSProperties,
  val:   { fontSize:13, color:TK.ink, marginTop:2 } as React.CSSProperties,
  sec:   { fontSize:11, fontWeight:600, color:TK.inkSoft, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:8 } as React.CSSProperties,
}
const REG_COLOR: Record<string, string> = { GST:TK.info, EPF:TK.brand, ESIC:TK.positive, PT:TK.warning, LWF:'#0891B2', FACTORY:TK.critical }
const fmt = (s?: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

function StatusBadge({ status, days }: { status: string; days: number | null }) {
  const map: Record<string, [string, string, string]> = {
    ACTIVE:   [TK.positiveTint, TK.positive, 'Active'],
    GRACE:    [TK.warningTint, TK.warning, 'Grace period'],
    SUSPENDED:[TK.criticalTint, TK.critical, 'Suspended'],
  }
  const [bg, c, label] = map[status] || map.ACTIVE
  let hint = ''
  if (status === 'ACTIVE' && days !== null) hint = ` · ${days}d to due`
  if (status === 'GRACE') hint = ' · pay before suspension'
  return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:99, background:bg, color:c, fontWeight:600 }}>{label}{hint}</span>
}
function ROField({ label, value, fmtFn }: { label: string; value: any; fmtFn?: (v: any) => string }) {
  return <div><div style={C.lbl}>{label}</div><div style={C.val}>{fmtFn ? fmtFn(value) : (value === null || value === undefined || value === '' ? '—' : String(value))}</div></div>
}

function CompanyCard({ co, isMobile }: { co: Company; isMobile: boolean }) {
  const lic = co.license
  return (
    <div style={{ ...C.card, padding:0, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:TK.sunken, borderBottom:'1px solid #E2E8F0' }}>
        <span style={{ fontSize:14, fontWeight:600 }}>{co.company_name}</span>
        {co.company_type && <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:TK.brandTint, color:TK.brand, fontWeight:600 }}>{co.company_type}</span>}
        <span style={{ fontSize:10, color:TK.faint }}>{co.company_code}</span>
        <span style={{ marginLeft:'auto' }}><StatusBadge status={co.account_status} days={co.days_to_due} /></span>
      </div>

      <div style={{ padding:'14px 16px' }}>
          <div style={C.sec}>Company details</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:'12px 16px', marginBottom:18 }}>
            <ROField label="Employer / Director" value={co.short_name} />
            <ROField label="Industry" value={co.industry} />
            <ROField label="PAN" value={co.pan} />
            <ROField label="TAN" value={co.tan} />
            <ROField label="CIN" value={co.cin} />
            <ROField label="Incorporated" value={co.date_of_inc} fmtFn={fmt} />
            <div style={{ gridColumn:'1 / -1' }}><ROField label="Registered office" value={co.reg_office} /></div>
          </div>

          <div style={C.sec}>Branches ({co.branches.length})</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:8, marginBottom:18 }}>
            {co.branches.map((b: Branch) => (
              <div key={b.id} style={{ border:'1px solid #E2E8F0', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{b.location_name}</span>
                  <span style={{ fontSize:10, padding:'1px 7px', borderRadius:99, background:TK.sunken, color:TK.inkSoft }}>{b.location_type}</span>
                </div>
                <div style={{ ...C.lbl, textTransform:'none', fontWeight:400, color:TK.muted, marginBottom:8 }}>
                  {[b.address_line1, b.city, b.pin_code].filter(Boolean).join(', ') || '—'}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 12px', marginBottom:8 }}>
                  <ROField label="District" value={b.district} />
                  <ROField label="State" value={b.state} />
                </div>
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
                  <div><div style={C.lbl}>GPS</div><div style={{ ...C.val, fontSize:12 }}>{b.latitude != null && b.longitude != null ? <>{b.latitude}, {b.longitude} <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer" style={{ color:TK.brand, fontSize:11 }}>map</a></> : '—'}</div></div>
                  <ROField label="Max employees" value={b.max_employees} />
                </div>
              </div>
            ))}
            {co.branches.length === 0 && <div style={{ fontSize:12, color:TK.faint }}>No branches.</div>}
          </div>

          <div style={C.sec}>Statutory registrations</div>
          <div style={{ overflowX:'auto', marginBottom:18 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <tbody>
                {co.registrations.map((r: Registration) => (
                  <tr key={r.id} style={{ borderBottom:'1px solid #F1F5F9' }}>
                    <td style={{ padding:'7px 8px', width:60 }}><span style={{ fontSize:10, fontWeight:700, color:REG_COLOR[r.reg_type] || TK.inkSoft }}>{r.reg_type}</span></td>
                    <td style={{ padding:'7px 8px', color:TK.ink }}>{r.reg_number || '—'}</td>
                    <td style={{ padding:'7px 8px', color:TK.muted }}>{[r.state, r.district].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
                {co.registrations.length === 0 && <tr><td style={{ padding:10, color:TK.faint }}>No registrations.</td></tr>}
              </tbody>
            </table>
          </div>

          {co.bank.length > 0 && (
            <>
              <div style={C.sec}>Bank accounts</div>
              <div style={{ marginBottom:18 }}>
                {co.bank.map(bk => (
                  <div key={bk.id} style={{ fontSize:12, color:TK.inkSoft, padding:'4px 0' }}>
                    <b>{bk.bank_name}</b> · A/c ••••{(bk.account_number || '').slice(-4)} · {bk.ifsc_code} · {bk.account_type}{bk.is_primary ? ' · primary' : ''}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={C.sec}>License &amp; billing</div>
          {lic ? (
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:'12px 16px', alignItems:'flex-end' }}>
              <ROField label="Plan" value={lic.plan_name} />
              <ROField label="Max employees" value={lic.max_employees} />
              <div><div style={C.lbl}>Max locations</div><div style={C.val}>{lic.max_locations || '—'} <span style={{ color:TK.faint, fontSize:11 }}>({co.branches.length} used)</span></div></div>
              <ROField label="Billing cycle" value={lic.billing_cycle || 'QUARTERLY'} />
              <ROField label="Paid till" value={lic.paid_till} fmtFn={fmt} />
              <ROField label="Grace" value={`${lic.grace_days ?? 30} days`} />
              <div><div style={C.lbl}>Status</div><div style={{ marginTop:2 }}><StatusBadge status={co.account_status} days={co.days_to_due} /></div></div>
            </div>
          ) : <div style={{ fontSize:12, color:TK.faint }}>No license plan set.</div>}
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

  if (loading) return <div style={{ ...C.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading company profile…</div>
  if (groups.length === 0) return <div style={{ ...C.card, textAlign:'center', color:TK.faint, padding:40 }}>No group / company found yet. Add data from Company Setup first.</div>

  return (
    <div>
      <div style={{ fontSize:12, color:TK.muted, marginBottom:12 }}>Group, companies, branches, statutory registrations, bank &amp; license — view only. To edit, open Company Profile from Admin.</div>
      {groups.map(g => (
        <div key={g.id} style={{ marginBottom:18 }}>
          <div style={{ ...C.card, display:'flex', alignItems:'center', gap:12, background:TK.ink, color:'#fff', border:'none' }}>
            <span style={{ fontSize:18 }}></span>
            <div><div style={{ fontSize:15, fontWeight:600 }}>{g.group_name}</div><div style={{ fontSize:11, color:'#C7D2FE' }}>{g.group_code} · {g.country} · {g.companies.length} companies</div></div>
          </div>
          {g.companies.map(co => <CompanyCard key={co.id} co={co} isMobile={isMobile} />)}
        </div>
      ))}
    </div>
  )
}
