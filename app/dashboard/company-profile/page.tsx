'use client'
// app/dashboard/company-profile/page.tsx — Company Profile (Group → Company → Branch → Statutory)
// Full master view: details, branches (GPS), statutory regs, bank, license + billing status.
// Inline edit on any field → auto-writes company_master_audit. Schema: lib/supabase-admin + migration 027.
import { useState, useEffect, useCallback } from 'react'
import {
  loadHierarchy, updateEntity, loadAudit, confirmPayment,
  type GroupTree, type Company, type Branch, type Registration, type AuditRow,
} from '@/lib/supabase-company-profile'
import { INDIAN_STATES, districtsOf } from '@/lib/geo/india-states-districts'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'
import { GroupHeader } from '@/components/company/GroupHeader'

// ── Style constant (employees/admin palette — C) ───────────────────
const C = {
  page:   { background: TK.sunken, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
  card:   { background:TK.surface, borderRadius:10, border: `1px solid ${TK.line}`, padding:'14px 16px', marginBottom:10 } as React.CSSProperties,
  lbl:    { fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase' as const, letterSpacing:'.04em' } as React.CSSProperties,
  val:    { fontSize:13, color:TK.ink, marginTop:2 } as React.CSSProperties,
  input:  { padding:'6px 9px', background:TK.sunken, border: `1px solid ${TK.line}`, borderRadius:10, color:TK.ink, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' as const } as React.CSSProperties,
  pri:    { padding:'8px 15px', borderRadius:10, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:TK.onAccent } as React.CSSProperties,
  out:    { padding:'6px 12px', borderRadius:10, border: `1px solid ${TK.line}`, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:TK.surface, color:TK.inkSoft } as React.CSSProperties,
  sec:    { fontSize:11, fontWeight:600, color:TK.inkSoft, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:8 } as React.CSSProperties,
}
const REG_COLOR: Record<string, string> = { GST:TK.info, EPF:TK.brand, ESIC:TK.positive, PT:TK.warning, LWF: TK.info, FACTORY:TK.critical }
const fmt = (s?: string | null) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'

// ── Helper components (OUTSIDE parent — no focus-loss) ──────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:TK.onAccent, borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>
      {type==='success'?'':''} {msg}
    </div>
  )
}
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
function EditField({ label, value, type, onSave, fmtFn }: {
  label: string; value: any; type?: 'text' | 'number'; onSave: (v: string) => Promise<void>; fmtFn?: (v: any) => string
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(String(value ?? ''))
  const [busy, setBusy] = useState(false)
  return (
    <div>
      <div style={C.lbl}>{label}</div>
      {!editing ? (
        <div style={C.val}>
          {fmtFn ? fmtFn(value) : (value === null || value === undefined || value === '' ? '—' : String(value))}
          <span onClick={() => { setV(String(value ?? '')); setEditing(true) }} title="edit" style={{ cursor:'pointer', color:TK.faint, marginLeft:6, fontSize:12 }}></span>
        </div>
      ) : (
        <div style={{ display:'flex', gap:5, marginTop:3, alignItems:'center' }}>
          <input type={type || 'text'} value={v} onChange={e => setV(e.target.value)} style={{ ...C.input, width:type==='number'?80:160 }} autoFocus />
          <button disabled={busy} onClick={async () => { setBusy(true); await onSave(v); setBusy(false); setEditing(false) }} style={{ ...C.pri, padding:'5px 10px' }}>{busy?'…':'Save'}</button>
          <button onClick={() => setEditing(false)} style={{ ...C.out, padding:'5px 9px' }}></button>
        </div>
      )}
    </div>
  )
}

// ── Searchable dropdown (type to filter) ────────────────────────────
function SearchSelect({ value, options, placeholder, onChange, disabled }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 100)
  return (
    <div ref={pop} style={{ position:'relative', width:190 }}>
      <div onClick={() => { if (!disabled) { setOpen(o => !o); setQ('') } }}
        style={{ ...C.input, width:'100%', cursor: disabled ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, background: disabled ? TK.sunken : TK.sunken, color: value ? TK.ink : TK.faint }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{value || placeholder}</span>
        <span style={{ color:TK.faint, fontSize:11 }}></span>
      </div>
      {open && !disabled && (
        <>
          <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, width:'100%', minWidth:210, background:TK.surface, border: `1px solid ${TK.brandEdge}`, borderRadius:10, boxShadow:'0 8px 24px rgba(30,27,75,0.16)', zIndex:41, overflow:'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width:'100%', padding:'8px 10px', border:'none', borderBottom: `1px solid ${TK.brandEdge}`, fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'inherit' }} />
            <div style={{ maxHeight:220, overflowY:'auto' }}>
              {filtered.length === 0 && <div style={{ padding:'8px 10px', fontSize:12, color:TK.faint }}>No matches</div>}
              {filtered.map(o => (
                <div key={o} onClick={() => { onChange(o); setOpen(false) }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = TK.canvas}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = o === value ? TK.brandTint : TK.surface}
                  style={{ padding:'7px 10px', fontSize:13, cursor:'pointer', background: o === value ? TK.brandTint : TK.surface, color:TK.ink }}>
                  {o}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── State → District editor (pick state first, then its districts) ──
function StateDistrictEditor({ state, district, onSaveState, onSaveDistrict }: {
  state: any; district: any
  onSaveState: (v: string) => Promise<void>
  onSaveDistrict: (v: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [st, setSt] = useState(String(state ?? ''))
  const [di, setDi] = useState(String(district ?? ''))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    if (st !== String(state ?? '')) await onSaveState(st)
    if (di !== String(district ?? '')) await onSaveDistrict(di)
    setBusy(false); setEditing(false)
  }

  if (!editing) {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 12px', marginBottom:8 }}>
        <div><div style={C.lbl}>State</div><div style={C.val}>{state || '—'}</div></div>
        <div><div style={C.lbl}>District</div><div style={C.val}>{district || '—'}
          <span onClick={() => { setSt(String(state ?? '')); setDi(String(district ?? '')); setEditing(true) }} title="edit" style={{ cursor:'pointer', color:TK.faint, marginLeft:6, fontSize:12 }}></span></div></div>
      </div>
    )
  }
  return (
    <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', marginBottom:8 }}>
      <div>
        <div style={C.lbl}>State</div>
        <SearchSelect value={st} options={INDIAN_STATES} placeholder="Select state"
          onChange={v => { setSt(v); setDi('') }} />
      </div>
      <div>
        <div style={C.lbl}>District</div>
        <SearchSelect value={di} options={districtsOf(st)} placeholder={st ? 'Select district' : 'Pick a state first'}
          onChange={setDi} disabled={!st} />
      </div>
      <button disabled={busy} onClick={save} style={{ ...C.pri, padding:'7px 12px' }}>{busy ? '…' : 'Save'}</button>
      <button onClick={() => setEditing(false)} style={{ ...C.out, padding:'7px 10px' }}></button>
    </div>
  )
}

// ── Company card (one company in the group) ─────────────────────────
function CompanyCard({ co, isMobile, save, openPay }: {
  co: Company; isMobile: boolean
  save: (entity: any, id: string, field: string, val: string, company_id: string) => Promise<void>
  openPay: (co: Company) => void
}) {
  const [open, setOpen] = useState(false)
  const regsByType: Record<string, Registration[]> = {}
  for (const r of co.registrations) { (regsByType[r.reg_type] = regsByType[r.reg_type] || []).push(r) }
  const lic = co.license
  const empUsed = '—' // headcount comes from employees module; shown as cap here

  return (
    <div style={{ ...C.card, padding:0, overflow:'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', cursor:'pointer', background:TK.sunken, borderBottom: open ? '1px solid #E2E8F0' : 'none' }}>
        <span style={{ fontSize:14, color:TK.faint }}>{open ? '' : ''}</span>
        <span style={{ fontSize:14, fontWeight:600 }}>{co.company_name}</span>
        {co.company_type && <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:TK.brandTint, color:TK.brand, fontWeight:600 }}>{co.company_type}</span>}
        <span style={{ fontSize:10, color:TK.faint }}>{co.company_code}</span>
        <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={e => { e.stopPropagation(); setOpen(true) }} style={{ fontSize:11, fontWeight:600, padding:'4px 11px', borderRadius:7, border: `1px solid ${TK.brandEdge}`, background:TK.surface, color:TK.brand, cursor:'pointer' }}>Edit</button>
          <StatusBadge status={co.account_status} days={co.days_to_due} />
        </span>
      </div>

      {open && (
        <div style={{ padding:'14px 16px' }}>
          <div style={C.sec}>Company details</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:'12px 16px', marginBottom:18 }}>
            <EditField label="Employer / Director" value={co.short_name} onSave={v => save('COMPANY', co.id, 'short_name', v, co.id)} />
            <EditField label="Industry" value={co.industry} onSave={v => save('COMPANY', co.id, 'industry', v, co.id)} />
            <EditField label="PAN" value={co.pan} onSave={v => save('COMPANY', co.id, 'pan', v.toUpperCase(), co.id)} />
            <EditField label="TAN" value={co.tan} onSave={v => save('COMPANY', co.id, 'tan', v.toUpperCase(), co.id)} />
            <EditField label="CIN" value={co.cin} onSave={v => save('COMPANY', co.id, 'cin', v.toUpperCase(), co.id)} />
            <div><div style={C.lbl}>Incorporated</div><div style={C.val}>{fmt(co.date_of_inc)}</div></div>
            <div style={{ gridColumn:'1 / -1' }}><EditField label="Registered office" value={co.reg_office} onSave={v => save('COMPANY', co.id, 'reg_office', v, co.id)} /></div>
          </div>

          <div style={C.sec}>Branches ({co.branches.length})</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:8, marginBottom:18 }}>
            {co.branches.map((b: Branch) => (
              <div key={b.id} style={{ border: `1px solid ${TK.line}`, borderRadius:10, padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{b.location_name}</span>
                  <span style={{ fontSize:10, padding:'1px 7px', borderRadius:99, background:TK.sunken, color:TK.inkSoft }}>{b.location_type}</span>
                </div>
                <div style={{ ...C.lbl, textTransform:'none', fontWeight:400, color:TK.muted, marginBottom:8 }}>
                  {[b.address_line1, b.city, b.pin_code].filter(Boolean).join(', ') || '—'}
                </div>
                <StateDistrictEditor state={b.state} district={b.district}
                  onSaveState={v => save('LOCATION', b.id, 'state', v, co.id)}
                  onSaveDistrict={v => save('LOCATION', b.id, 'district', v, co.id)} />
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
                  <div><div style={C.lbl}>GPS</div><div style={{ ...C.val, fontSize:12 }}>{b.latitude != null && b.longitude != null ? <>{b.latitude}, {b.longitude} <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer" style={{ color:TK.brand, fontSize:11 }}>map</a></> : '—'}</div></div>
                  <EditField label="Max employees" value={b.max_employees} type="number" onSave={v => save('LOCATION', b.id, 'max_employees', v, co.id)} />
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
                  <tr key={r.id} style={{ borderBottom: `1px solid ${TK.line}` }}>
                    <td style={{ padding:'7px 8px', width:60 }}><span style={{ fontSize:10, fontWeight:700, color:REG_COLOR[r.reg_type] || TK.inkSoft }}>{r.reg_type}</span></td>
                    <td style={{ padding:'7px 8px' }}><EditField label="" value={r.reg_number} onSave={v => save('REGISTRATION', r.id, 'reg_number', v, co.id)} /></td>
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
              <div><div style={C.lbl}>Plan</div><div style={C.val}>{lic.plan_name}</div></div>
              <div><div style={C.lbl}>Max employees</div><div style={C.val}>{lic.max_employees || '—'}</div></div>
              <div><div style={C.lbl}>Max locations</div><div style={C.val}>{lic.max_locations || '—'} <span style={{ color:TK.faint, fontSize:11 }}>({co.branches.length} used)</span></div></div>
              <div><div style={C.lbl}>Billing cycle</div><div style={C.val}>{lic.billing_cycle || 'QUARTERLY'}</div></div>
              <div><div style={C.lbl}>Paid till</div><div style={C.val}>{fmt(lic.paid_till)}</div></div>
              <div><div style={C.lbl}>Grace</div><div style={C.val}>{lic.grace_days ?? 30} days</div></div>
              <div><div style={C.lbl}>Status</div><div style={{ marginTop:2 }}><StatusBadge status={co.account_status} days={co.days_to_due} /></div></div>
              <div><button onClick={() => openPay(co)} style={C.pri}>Confirm payment</button></div>
            </div>
          ) : <div style={{ fontSize:12, color:TK.faint }}>No license plan set.</div>}
        </div>
      )}
    </div>
  )
}

// ── Confirm payment modal ───────────────────────────────────────────
function PayModal({ co, onClose, onConfirm }: {
  co: Company; onClose: () => void
  onConfirm: (period: string, amount: string, from: string, till: string) => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const q = new Date(); q.setMonth(q.getMonth() + 3)
  const [period, setPeriod] = useState('FY2026-27 Q1')
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState(today)
  const [till, setTill] = useState(q.toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...C.card, maxWidth:460, width:'100%', marginBottom:0 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Confirm payment — {co.company_name}</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Advance by a quarter. Paid-till rolls forward and the account stays ACTIVE.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><div style={C.lbl}>Period</div><input style={{ ...C.input, width:'100%', marginTop:3 }} value={period} onChange={e => setPeriod(e.target.value)} /></div>
          <div><div style={C.lbl}>Amount (₹)</div><input type="number" style={{ ...C.input, width:'100%', marginTop:3 }} value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><div style={C.lbl}>Valid from</div><input type="date" style={{ ...C.input, width:'100%', marginTop:3 }} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><div style={C.lbl}>Valid till</div><input type="date" style={{ ...C.input, width:'100%', marginTop:3 }} value={till} onChange={e => setTill(e.target.value)} /></div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
          <button onClick={onClose} style={C.out}>Cancel</button>
          <button disabled={busy || !co.license} onClick={async () => { setBusy(true); await onConfirm(period, amount, from, till); setBusy(false) }} style={{ ...C.pri, opacity: co.license ? 1 : 0.5 }}>{busy ? '…' : 'Confirm & activate'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function CompanyProfilePage() {
  const [groups, setGroups] = useState<GroupTree[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [pay, setPay] = useState<Company | null>(null)

  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [g, a] = await Promise.all([loadHierarchy(), loadAudit(undefined, 40)])
      setGroups(g); setAudit(a)
    } catch (e: any) {
      notify('Load failed: ' + (e?.message || 'check tables'), 'error')
    }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  async function save(entity: any, id: string, field: string, val: string, company_id: string) {
    const patch: Record<string, any> = { [field]: field === 'max_employees' ? (val === '' ? null : Number(val)) : val }
    const r = await updateEntity(entity, id, patch, { company_id, changedBy: 'Admin' })
    if ((r as any).error) { notify('Save failed: ' + (r as any).error.message, 'error'); return }
    notify('Saved & logged.'); reload()
  }

  async function doConfirm(period: string, amount: string, from: string, till: string) {
    if (!pay?.license) return
    const r = await confirmPayment({
      company_id: pay.id, license_id: pay.license.id, period, amount: Number(amount) || 0,
      valid_from: from, valid_till: till, confirmedBy: 'Super Admin',
    })
    if ((r as any).error) { notify('Failed: ' + (r as any).error.message, 'error'); setPay(null); return }
    notify('Payment confirmed — account active.'); setPay(null); reload()
  }

  const totalCompanies = groups.reduce((s, g) => s + g.companies.length, 0)

  return (
    <div style={{ ...C.page, padding: isMobile ? '14px 12px' : '20px 24px' }}>
      <div style={{ maxWidth:1200, margin:'0 auto' }}>
        <div className="ez-page-head">
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Company Profile</div>
        <div style={{ fontSize:12, color:TK.muted }}>Group, companies, branches, statutory registrations, bank &amp; license — view, edit, and audit. Every change is logged.</div>
        </div>

        {loading ? (
          <div style={{ ...C.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading…</div>
        ) : groups.length === 0 ? (
          <div style={{ ...C.card, textAlign:'center', color:TK.faint, padding:40 }}>No group or company found. Add data from Company Setup first.</div>
        ) : (
          <>
            {groups.map(g => (
              <div key={g.id} style={{ marginBottom:18 }}>
                <GroupHeader g={g} card={C.card} />
                {g.companies.map(co => (
                  <CompanyCard key={co.id} co={co} isMobile={isMobile} save={save} openPay={setPay} />
                ))}
              </div>
            ))}

            <div style={C.card}>
              <div style={C.sec}>Audit log — recent changes</div>
              {audit.length === 0 && <div style={{ fontSize:12, color:TK.faint }}>No changes yet.</div>}
              {audit.map(a => (
                <div key={a.id} style={{ display:'flex', gap:8, padding:'7px 0', borderBottom: `1px solid ${TK.line}`, fontSize:12 }}>
                  <span style={{ color:TK.brand }}>•</span>
                  <div>
                    <div><b>{a.entity_type}</b> · {a.field}: <span style={{ color:TK.faint }}>{a.old_value || '—'}</span> → <span style={{ color:TK.ink }}>{a.new_value || '—'}</span></div>
                    <div style={{ fontSize:10, color:TK.faint }}>{a.changed_by || 'Admin'} · {new Date(a.changed_at).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {pay && <PayModal co={pay} onClose={() => setPay(null)} onConfirm={doConfirm} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
