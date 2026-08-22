'use client'
// app/dashboard/ess/page.tsx — ESS Management (Admin side), Phase 1.
// Tabs: Dashboard · Access Control · Roles · Audit. Deactivation guard,
// role assignment, and admin impersonation entry. Responsive (web/mobile).
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadUsers, loadRoles, loadAudit, loadOrgUnits, setStatus, assignRoles,
  startImpersonation, endImpersonation,
  type EssUser, type EssRole, type AuditRow, type OrgUnit,
} from '@/lib/supabase-ess'
import EmployeePortal from '@/components/ess/EmployeePortal'
import { RolesPermissionsSection } from '@/app/dashboard/roles/page'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── Style constant (exact project palette) ─────────────────────────
const T = {
  page:       { background:TK.canvas, minHeight:'100vh', color:TK.ink, fontFamily:'"DM Sans","Segoe UI",sans-serif' } as React.CSSProperties,
  card:       { background:TK.surface, borderRadius:10, border:'1px solid rgba(37,99,235,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(37,99,235,0.06)' } as React.CSSProperties,
  label:      { fontSize:11, fontWeight:600, color:TK.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 },
  input:      { width:'100%', padding:'9px 11px', background:TK.sunken, border:'1px solid #DDD6FE', borderRadius:7, color:TK.ink, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  btnPrimary: { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.brand, color:'#fff' } as React.CSSProperties,
  btnOutline: { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:TK.brandDeep } as React.CSSProperties,
  section:    { fontSize:12, fontWeight:600, color:TK.brand, textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10, marginTop:4, display:'flex', alignItems:'center', gap:8 } as React.CSSProperties,
}
const todayStart = () => { const d = new Date(); d.setHours(0,0,0,0); return d }
const fmt = (s?: string|null) => s ? new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'
const fmtDT = (s?: string|null) => s ? new Date(s).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) : 'Never'

// ── Helper components (OUTSIDE parent — no focus-loss) ──────────────
function Toast({ msg, type, onClose }: { msg:string; type:'success'|'error'; onClose:()=>void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?TK.positive:TK.critical, color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)', display:'flex', alignItems:'center', gap:10 }}>
      {type==='success'?'':''} {msg}
      <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
    </div>
  )
}
function StatusPill({ status }: { status?: string }) {
  const map: Record<string,[string,string,string]> = {
    ACTIVE:   [TK.positiveTint,TK.positive,'Active'],
    INACTIVE: [TK.sunken,TK.muted,'⬜ Inactive'],
    LOCKED:   [TK.criticalTint,TK.critical,'Locked'],
    NONE:     [TK.sunken,TK.faint,'— No account'],
  }
  const [bg,c,l] = map[status || 'NONE'] || map.NONE
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600, whiteSpace:'nowrap' }}>{l}</span>
}
function RoleChip({ label }: { label:string }) {
  return <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:TK.brandTint, color:TK.brandDeep, fontWeight:600 }}>{label}</span>
}
function Metric({ label, value, color }: { label:string; value:number|string; color?:string }) {
  return (
    <div style={T.card}>
      <div style={{ fontSize:11, color:TK.faint, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</div>
      <div style={{ fontSize:21, fontWeight:600, marginTop:4, color: color || TK.ink }}>{value}</div>
    </div>
  )
}
function Bar({ label, value, max, color=TK.brand }: { label:string; value:number; max:number; color?:string }) {
  const pct = max ? Math.round((value/max)*100) : 0
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:TK.muted, marginBottom:3 }}><span>{label}</span><span style={{ fontWeight:600, color:TK.ink }}>{value}</span></div>
      <div style={{ height:6, background:TK.brandTint, borderRadius:99, overflow:'hidden' }}><div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99 }}/></div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ══════════════════════════════════════════════════════════════════
function DashboardTab({ users, audit, isMobile }: { users: EssUser[]; audit: AuditRow[]; isMobile: boolean }) {
  const total = users.length
  const active = users.filter(u => u.account?.status === 'ACTIVE').length
  const loggedIn = users.filter(u => (u.account?.login_count || 0) > 0 || u.account?.last_login_at).length
  const t0 = todayStart()
  const serving = users.filter(u => u.date_of_resignation && u.last_working_date && new Date(u.last_working_date) >= t0)
  const neverLogged = users.filter(u => !((u.account?.login_count || 0) > 0 || u.account?.last_login_at))
  const recentlyDeact = users.filter(u => u.account?.deactivated_at && (Date.now() - new Date(u.account.deactivated_at).getTime()) <= 30*86400000).length

  const roleCount: Record<string, number> = {}
  for (const u of users) for (const r of u.roles) roleCount[r.role_name] = (roleCount[r.role_name] || 0) + 1
  const roleRows = Object.entries(roleCount).sort((a,b) => b[1]-a[1])
  const roleMax = roleRows.reduce((m,[,v]) => Math.max(m,v), 0)

  const auditLabel = (a: AuditRow) => a.action === 'ACTIVATE' ? 'Activated' : a.action === 'DEACTIVATE' ? '⬜ Deactivated' : a.action === 'ROLE_ASSIGN' ? 'Role assigned' : a.action

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6,1fr)', gap:10, marginBottom:8 }}>
        <Metric label="Total Users" value={total} />
        <Metric label="Logged In" value={loggedIn} />
        <Metric label="Active" value={active} color={TK.positive} />
        <Metric label="Inactive" value={total - active} color={TK.muted} />
        <Metric label="Serving Notice" value={serving.length} color={TK.warning} />
        <Metric label="Never Logged In" value={neverLogged.length} color={TK.critical} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:10 }}>
        <div style={T.card}>
          <div style={T.section}>Serving Notice ({serving.length})</div>
          {serving.length === 0 && <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>No one is serving notice.</div>}
          {serving.map(u => {
            const days = u.last_working_date ? Math.max(0, Math.ceil((new Date(u.last_working_date).getTime() - Date.now())/86400000)) : 0
            return (
              <div key={u.employee_id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
                <div><div style={{ fontWeight:600 }}>{u.full_name}</div><div style={{ fontSize:10, color:TK.faint }}>{u.emp_code} · LWD {fmt(u.last_working_date)}</div></div>
                <span style={{ fontSize:11, fontWeight:700, color: days<=7?TK.critical:TK.warning }}>{days}d left</span>
              </div>
            )
          })}
        </div>

        <div style={T.card}>
          <div style={T.section}>Role Distribution</div>
          {roleRows.length === 0 && <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>No roles assigned yet.</div>}
          {roleRows.map(([name,count]) => <Bar key={name} label={name} value={count} max={roleMax} />)}
        </div>

        <div style={T.card}>
          <div style={T.section}>Never Logged In ({neverLogged.length}) — HR follow-up</div>
          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {neverLogged.slice(0,40).map(u => (
              <div key={u.employee_id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
                <span style={{ fontWeight:600 }}>{u.full_name}</span>
                <span style={{ fontSize:10, color:TK.faint }}>{u.emp_code} · {u.dept_name || '—'}</span>
              </div>
            ))}
            {neverLogged.length > 40 && <div style={{ fontSize:11, color:TK.faint, marginTop:6 }}>+{neverLogged.length-40} more…</div>}
          </div>
        </div>

        <div style={T.card}>
          <div style={T.section}>Recent Access Changes</div>
          {audit.length === 0 && <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>No changes yet. Recently deactivated (30d): {recentlyDeact}.</div>}
          {audit.slice(0,10).map(a => (
            <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
              <span>{auditLabel(a)} {a.details?.full_name ? `— ${a.details.full_name}` : a.details?.emp_code ? `— ${a.details.emp_code}` : ''}</span>
              <span style={{ fontSize:10, color:TK.faint }}>{fmtDT(a.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// ACCESS CONTROL TAB
// ══════════════════════════════════════════════════════════════════
const FILTERS = ['All','Active','Inactive','Serving Notice','No Login'] as const
type FilterKey = typeof FILTERS[number]

function AccessTab({ users, isMobile, onActivate, onDeactivate, onAssignOpen, onImpersonate, onBulk }: {
  users: EssUser[]; isMobile: boolean
  onActivate: (u: EssUser) => void
  onDeactivate: (u: EssUser) => void
  onAssignOpen: (u: EssUser) => void
  onImpersonate: (u: EssUser) => void
  onBulk: (us: EssUser[], status: 'ACTIVE'|'INACTIVE') => void
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('All')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const t0 = todayStart()

  const filtered = users.filter(u => {
    if (q) {
      const s = q.toLowerCase()
      if (!u.full_name.toLowerCase().includes(s) && !(u.emp_code || '').toLowerCase().includes(s)) return false
    }
    const st = u.account?.status
    const serving = u.date_of_resignation && u.last_working_date && new Date(u.last_working_date) >= t0
    const noLogin = !((u.account?.login_count || 0) > 0 || u.account?.last_login_at)
    if (filter === 'Active' && st !== 'ACTIVE') return false
    if (filter === 'Inactive' && st === 'ACTIVE') return false
    if (filter === 'Serving Notice' && !serving) return false
    if (filter === 'No Login' && !noLogin) return false
    return true
  })

  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allChecked = filtered.length > 0 && filtered.every(u => sel.has(u.employee_id))
  const selectedUsers = filtered.filter(u => sel.has(u.employee_id))

  const ActionBtns = ({ u }: { u: EssUser }) => (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      {u.account?.status === 'ACTIVE'
        ? <button onClick={() => onDeactivate(u)} style={{ ...T.btnOutline, borderColor:'#FCA5A5', color:TK.critical }}>Deactivate</button>
        : <button onClick={() => onActivate(u)} style={{ ...T.btnOutline, borderColor:'#A7F3D0', color:TK.positive }}>Activate</button>}
      <button onClick={() => onImpersonate(u)} style={T.btnOutline}>Login as</button>
      <button onClick={() => onAssignOpen(u)} style={T.btnOutline}>Role</button>
    </div>
  )

  return (
    <div>
      <div style={{ ...T.card, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
        <input style={{ ...T.input, maxWidth:260 }} placeholder="Search emp code / name" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ ...T.btnOutline, ...(filter===f ? { background:TK.brand, color:'#fff', border:'1px solid #2563EB' } : {}) }}>{f}</button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', fontSize:11, color:TK.muted }}>{filtered.length} shown</div>
      </div>

      {sel.size > 0 && (
        <div style={{ ...T.card, display:'flex', gap:10, alignItems:'center', background:TK.canvas, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, fontWeight:600 }}>{sel.size} selected</span>
          <button onClick={() => { onBulk(selectedUsers, 'ACTIVE'); setSel(new Set()) }} style={{ ...T.btnOutline, borderColor:'#A7F3D0', color:TK.positive }}>Activate</button>
          <button onClick={() => { onBulk(selectedUsers, 'INACTIVE'); setSel(new Set()) }} style={{ ...T.btnOutline, borderColor:'#FCA5A5', color:TK.critical }}>⊘ Deactivate</button>
          <button
            onClick={() => {
              const codes = selectedUsers.map(u => u.emp_code).filter(Boolean).join(',')
              if (!codes) return
              router.push(`/dashboard/ess-credentials?codes=${encodeURIComponent(codes)}`)
            }}
            style={{ ...T.btnPrimary, background:TK.brand }}
          >Generate login credentials</button>
          <button onClick={() => setSel(new Set())} style={T.btnOutline}>Clear</button>
        </div>
      )}

      {isMobile ? (
        <div>
          {filtered.map(u => (
            <div key={u.employee_id} style={T.card}>
              <label style={{ display:'flex', gap:8, alignItems:'flex-start', cursor:'pointer' }}>
                <input type="checkbox" checked={sel.has(u.employee_id)} onChange={() => toggle(u.employee_id)} style={{ marginTop:3 }} />
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{u.full_name}</div>
                  <div style={{ fontSize:11, color:TK.faint }}>{u.emp_code} · {u.designation || '—'} · {u.dept_name || '—'}</div>
                  <div style={{ marginTop:5, display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
                    <StatusPill status={u.account?.status} />
                    {u.roles.slice(0,2).map(r => <RoleChip key={r.id} label={r.role_name} />)}
                  </div>
                  <div style={{ fontSize:10, color:TK.faint, marginTop:4 }}>Last login: {fmtDT(u.account?.last_login_at)} · DOL: {fmt(u.last_working_date)}</div>
                </div>
              </label>
              <div style={{ marginTop:10 }}><ActionBtns u={u} /></div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ ...T.card, textAlign:'center', color:TK.faint, padding:24 }}>No users match.</div>}
        </div>
      ) : (
        <div style={{ ...T.card, overflowX:'auto', padding:0 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:TK.sunken }}>
                {['', 'Emp Code','Name','Department','Designation','Role(s)','ESS Status','Last Login','DOL','Actions'].map(h => (
                  <th key={h} style={{ padding:'9px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:TK.muted, textTransform:'uppercase', letterSpacing:'.04em', borderBottom:'1px solid #EDE9FE', whiteSpace:'nowrap' }}>
                    {h === '' ? <input type="checkbox" checked={allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(filtered.map(u => u.employee_id)))} /> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ padding:24, textAlign:'center', color:TK.faint }}>No users match.</td></tr>}
              {filtered.map((u,i) => (
                <tr key={u.employee_id} style={{ borderBottom:'1px solid #F3F0FF', background:i%2?TK.sunken:'#fff' }}>
                  <td style={{ padding:'8px 10px' }}><input type="checkbox" checked={sel.has(u.employee_id)} onChange={() => toggle(u.employee_id)} /></td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', fontWeight:600 }}>{u.emp_code}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{u.full_name}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', color:TK.muted }}>{u.dept_name || '—'}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', color:TK.muted }}>{u.designation || '—'}</td>
                  <td style={{ padding:'8px 10px' }}><div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{u.roles.length ? u.roles.map(r => <RoleChip key={r.id} label={r.role_name} />) : <span style={{ fontSize:10, color:TK.faint }}>—</span>}</div></td>
                  <td style={{ padding:'8px 10px' }}><StatusPill status={u.account?.status} /></td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', fontSize:11, color:TK.muted }}>{fmtDT(u.account?.last_login_at)}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', fontSize:11, color:TK.muted }}>{fmt(u.last_working_date)}</td>
                  <td style={{ padding:'8px 10px' }}><ActionBtns u={u} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// ROLES TAB
// ══════════════════════════════════════════════════════════════════
function RolesTab({ users, roles, isMobile, selected, onSelect, onAssign }: {
  users: EssUser[]; roles: EssRole[]; isMobile: boolean
  selected: EssUser | null
  onSelect: (u: EssUser) => void
  onAssign: (u: EssUser, roleIds: string[]) => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => { setPicked(new Set((selected?.roles || []).map(r => r.id))) }, [selected?.employee_id])

  const filtered = users.filter(u => !q || u.full_name.toLowerCase().includes(q.toLowerCase()) || (u.emp_code||'').toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pickedRoles = roles.filter(r => picked.has(r.id))
  const salaryVis = pickedRoles.reduce((acc, r) => (acc === 'ALL' || r.salary_visibility === 'ALL') ? 'ALL' : (r.salary_visibility !== 'NONE' ? r.salary_visibility : acc), 'NONE' as string)

  return (
    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap:10, alignItems:'start' }}>
      <div style={T.card}>
        <input style={{ ...T.input, marginBottom:10 }} placeholder="Search user" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ maxHeight:'60vh', overflowY:'auto' }}>
          {filtered.map(u => (
            <div key={u.employee_id} onClick={() => onSelect(u)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', borderRadius:7, cursor:'pointer', marginBottom:4, background: selected?.employee_id === u.employee_id ? TK.brandTint : 'transparent', border: selected?.employee_id === u.employee_id ? '1px solid #DDD6FE' : '1px solid transparent' }}>
              <div><div style={{ fontSize:13, fontWeight:600 }}>{u.full_name}</div><div style={{ fontSize:10, color:TK.faint }}>{u.emp_code} · {u.dept_name || '—'}</div></div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>{u.roles.map(r => <RoleChip key={r.id} label={r.role_name} />)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...T.card, position: isMobile ? 'static' : 'sticky', top:10 }}>
        <div style={T.section}>Assign Role</div>
        {!selected ? (
          <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>Select a user to assign roles.</div>
        ) : (
          <>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{selected.full_name}</div>
            <div style={{ fontSize:11, color:TK.faint, marginBottom:10 }}>{selected.emp_code} · {selected.designation || '—'}</div>
            <div style={{ maxHeight:'42vh', overflowY:'auto', marginBottom:10 }}>
              {roles.map(r => (
                <label key={r.id} style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 4px', cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span style={{ flex:1 }}>{r.role_name}</span>
                  <span style={{ fontSize:9, color:TK.faint }}>{r.salary_visibility}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize:11, color:TK.muted, marginBottom:10 }}>Salary visibility: <b>{salaryVis}</b></div>
            <button onClick={() => onAssign(selected, [...picked])} style={{ ...T.btnPrimary, width:'100%' }}>Assign {picked.size} role(s)</button>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// ASSIGN ROLES TAB — guided cascade: Company → Location/Branch → Dept → Employee → Role
// ══════════════════════════════════════════════════════════════════
function StepHead({ n, title, hint, done }: { n: number; title: string; hint?: string; done?: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
      <span style={{ width:22, height:22, borderRadius:99, background: done ? TK.positive : TK.brand, color:'#fff', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{done ? '' : n}</span>
      <span style={{ fontSize:13, fontWeight:600 }}>{title}</span>
      {hint && <span style={{ fontSize:11, color:TK.faint }}>{hint}</span>}
    </div>
  )
}

function RoleAssignTab({ users, roles, org, isMobile, onAssign }: {
  users: EssUser[]; roles: EssRole[]
  org: { companies: OrgUnit[]; locations: OrgUnit[]; departments: OrgUnit[] }
  isMobile: boolean
  onAssign: (u: EssUser, roleIds: string[]) => void
}) {
  const [companyId, setCompanyId] = useState('')
  const [locationId, setLocationId] = useState('') // '' = all branches
  const [deptId, setDeptId] = useState('')         // '' = all departments
  const [empId, setEmpId] = useState('')
  const [empQ, setEmpQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const locations = org.locations.filter(l => l.company_id === companyId)
  const departments = org.departments.filter(d => d.company_id === companyId)
  const selEmp = users.find(u => u.employee_id === empId) || null

  // reset downstream selections when an upstream choice changes
  const pickCompany = (v: string) => { setCompanyId(v); setLocationId(''); setDeptId(''); setEmpId('') }
  const pickLocation = (v: string) => { setLocationId(v); setEmpId('') }
  const pickDept = (v: string) => { setDeptId(v); setEmpId('') }

  // seed checkboxes with the employee's current roles whenever selection changes
  useEffect(() => { setPicked(new Set((selEmp?.roles || []).map(r => r.id))) }, [empId])

  const emps = users.filter(u =>
    u.company_id === companyId &&
    (!locationId || u.location_id === locationId) &&
    (!deptId || u.department_id === deptId) &&
    (!empQ || u.full_name.toLowerCase().includes(empQ.toLowerCase()) || (u.emp_code || '').toLowerCase().includes(empQ.toLowerCase()))
  )

  const toggle = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pickedRoles = roles.filter(r => picked.has(r.id))
  const salaryVis = pickedRoles.reduce((acc, r) => (acc === 'ALL' || r.salary_visibility === 'ALL') ? 'ALL' : (r.salary_visibility !== 'NONE' ? r.salary_visibility : acc), 'NONE' as string)

  const SEL = { ...T.input, maxWidth: isMobile ? '100%' : 360 } as React.CSSProperties

  return (
    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap:10, alignItems:'start' }}>
      <div>
        {/* Step 1 — Company */}
        <div style={T.card}>
          <StepHead n={1} title="Select Company" done={!!companyId} />
          <select style={SEL} value={companyId} onChange={e => pickCompany(e.target.value)}>
            <option value="">— Choose company —</option>
            {org.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Step 2 — Location / Branch */}
        <div style={{ ...T.card, opacity: companyId ? 1 : 0.5, pointerEvents: companyId ? 'auto' : 'none' }}>
          <StepHead n={2} title="Select Location / Branch" hint="blank = all branches" done={!!locationId} />
          <select style={SEL} value={locationId} onChange={e => pickLocation(e.target.value)}>
            <option value="">All branches</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {companyId && locations.length === 0 && <div style={{ fontSize:11, color:TK.faint, marginTop:6 }}>No branch found for this company.</div>}
        </div>

        {/* Step 3 — Department */}
        <div style={{ ...T.card, opacity: companyId ? 1 : 0.5, pointerEvents: companyId ? 'auto' : 'none' }}>
          <StepHead n={3} title="Select Department" hint="blank = all departments" done={!!deptId} />
          <select style={SEL} value={deptId} onChange={e => pickDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {companyId && departments.length === 0 && <div style={{ fontSize:11, color:TK.faint, marginTop:6 }}>No department found for this company.</div>}
        </div>

        {/* Step 4 — Employee */}
        <div style={{ ...T.card, opacity: companyId ? 1 : 0.5, pointerEvents: companyId ? 'auto' : 'none' }}>
          <StepHead n={4} title="Select Employee" hint={`${emps.length} match`} done={!!empId} />
          <input style={{ ...T.input, marginBottom:8 }} placeholder="Search name / emp code" value={empQ} onChange={e => setEmpQ(e.target.value)} />
          <div style={{ maxHeight:300, overflowY:'auto' }}>
            {emps.length === 0 && <div style={{ fontSize:12, color:TK.faint, padding:'8px 4px' }}>{companyId ? 'No employee matched.' : 'Pick a company first.'}</div>}
            {emps.map(u => (
              <div key={u.employee_id} onClick={() => setEmpId(u.employee_id)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:7, cursor:'pointer', marginBottom:4, background: empId === u.employee_id ? TK.brandTint : 'transparent', border: empId === u.employee_id ? '1px solid #DDD6FE' : '1px solid transparent' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600 }}>{u.full_name}</div>
                  <div style={{ fontSize:10, color:TK.faint }}>{u.emp_code} · {u.location_name || '—'} · {u.dept_name || '—'}</div>
                </div>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end', alignItems:'center' }}>
                  <StatusPill status={u.account?.status} />
                  {u.roles.slice(0, 2).map(r => <RoleChip key={r.id} label={r.role_name} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Step 5 — Role (sticky panel) */}
      <div style={{ ...T.card, position: isMobile ? 'static' : 'sticky', top:10 }}>
        <StepHead n={5} title="Assign Role" done={picked.size > 0 && !!empId} />
        {!selEmp ? (
          <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>Complete steps 1–4, then pick an employee.</div>
        ) : (
          <>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{selEmp.full_name}</div>
            <div style={{ fontSize:11, color:TK.faint, marginBottom:10 }}>{selEmp.emp_code} · {selEmp.designation || '—'}</div>
            <div style={{ maxHeight:'42vh', overflowY:'auto', marginBottom:10 }}>
              {roles.map(r => (
                <label key={r.id} style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 4px', cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span style={{ flex:1 }}>{r.role_name}</span>
                  <span style={{ fontSize:9, color:TK.faint }}>{r.salary_visibility}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize:11, color:TK.muted, marginBottom:10 }}>Salary visibility: <b>{salaryVis}</b></div>
            <button onClick={() => onAssign(selEmp, [...picked])} style={{ ...T.btnPrimary, width:'100%' }}>Assign {picked.size} role(s)</button>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// AUDIT TAB
// ══════════════════════════════════════════════════════════════════
function AuditTab({ audit }: { audit: AuditRow[] }) {
  const label = (a: AuditRow) => a.action === 'ACTIVATE' ? 'Activated' : a.action === 'DEACTIVATE' ? '⬜ Deactivated' : a.action === 'ROLE_ASSIGN' ? 'Role assigned' : a.action
  return (
    <div style={T.card}>
      <div style={T.section}>Access Audit Trail</div>
      {audit.length === 0 && <div style={{ fontSize:12, color:TK.faint, padding:'8px 0' }}>No audit entries yet.</div>}
      {audit.map(a => (
        <div key={a.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid #F3F0FF', fontSize:12 }}>
          <div>
            <div style={{ fontWeight:600 }}>{label(a)} {a.details?.full_name ? `— ${a.details.full_name}` : a.details?.emp_code ? `— ${a.details.emp_code}` : ''}</div>
            <div style={{ fontSize:10, color:TK.faint }}>{a.performed_by_name ? `by ${a.performed_by_name}` : 'by system'}{a.reason ? ` · ${a.reason}` : ''}</div>
          </div>
          <span style={{ fontSize:10, color:TK.faint, whiteSpace:'nowrap' }}>{fmtDT(a.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
export default function ESSPage() {
  const [section, setSection] = useState<'ess'|'roles'>('ess')
  const [tab, setTab] = useState<'dashboard'|'access'|'roles'|'assign'|'audit'>('dashboard')
  const [users, setUsers] = useState<EssUser[]>([])
  const [roles, setRoles] = useState<EssRole[]>([])
  const [org, setOrg] = useState<{ companies: OrgUnit[]; locations: OrgUnit[]; departments: OrgUnit[] }>({ companies: [], locations: [], departments: [] })
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg:string; type:'success'|'error' }|null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [selUser, setSelUser] = useState<EssUser|null>(null)
  const [deact, setDeact] = useState<EssUser|null>(null)
  const [deactReason, setDeactReason] = useState('')
  const [imp, setImp] = useState<{ u: EssUser; logId: string|null }|null>(null)

  const notify = (msg: string, type:'success'|'error'='success') => setToast({ msg, type })

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [u, r, a, o] = await Promise.all([loadUsers(), loadRoles(), loadAudit(), loadOrgUnits()])
      setUsers(u); setRoles(r); setAudit(a); setOrg(o)
    } catch (e: any) {
      notify('Load failed: ' + (e?.message || 'check that the ESS migration was run'), 'error')
    }
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])

  async function doActivate(u: EssUser) {
    const { error } = await setStatus(u, 'ACTIVE', { byName: 'Admin' })
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${u.full_name} activated.`); reload()
  }
  function askDeactivate(u: EssUser) { setDeactReason(''); setDeact(u) }
  async function confirmDeactivate(u: EssUser) {
    const { error } = await setStatus(u, 'INACTIVE', { reason: deactReason || undefined, byName: 'Admin' })
    setDeact(null)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${u.full_name} deactivated — login & password reset blocked.`); reload()
  }
  async function doAssign(u: EssUser, roleIds: string[]) {
    const { error } = await assignRoles(u, roleIds, 'Admin')
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`Roles updated for ${u.full_name}.`); reload()
  }
  async function doBulk(us: EssUser[], status: 'ACTIVE'|'INACTIVE') {
    if (!window.confirm(`${status === 'ACTIVE' ? 'Activate' : 'Deactivate'} ${us.length} user(s)?`)) return
    let ok = 0
    for (const u of us) { const { error } = await setStatus(u, status, { byName: 'Admin', reason: status==='INACTIVE' ? 'Bulk deactivate' : undefined }); if (!error) ok++ }
    notify(`${ok}/${us.length} updated.`); reload()
  }
  async function doImpersonate(u: EssUser) {
    const logId = await startImpersonation(u, 'Admin')
    setImp({ u, logId })
  }
  async function exitImpersonate() {
    if (imp?.logId) await endImpersonation(imp.logId)
    setImp(null)
  }

  const TABS = [
    { k:'dashboard', l:'Dashboard' },
    { k:'access',    l:'Access Control' },
    { k:'roles',     l:'Roles' },
    { k:'assign',    l:'Assign Roles' },
    { k:'audit',     l:'Audit' },
  ] as const

  return (
    <div style={{ ...T.page, padding: isMobile ? '14px 12px' : '20px 24px' }}>
      <div style={{ maxWidth:1200, margin:'0 auto' }}>
        {/* Top-level section switch — ESS & Access + Roles & Permissions in one place */}
        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <button onClick={() => setSection('ess')} style={{ ...T.btnOutline, padding:'9px 16px', fontSize:13, fontWeight:600, ...(section==='ess' ? { background:TK.brand, color:'#fff', border:'1px solid #2563EB' } : {}) }}>ESS &amp; Access</button>
          <button onClick={() => setSection('roles')} style={{ ...T.btnOutline, padding:'9px 16px', fontSize:13, fontWeight:600, ...(section==='roles' ? { background:TK.brand, color:'#fff', border:'1px solid #2563EB' } : {}) }}>Roles &amp; Permissions</button>
          <a href="/dashboard/ess-credentials" style={{ ...T.btnOutline, padding:'9px 16px', fontSize:13, fontWeight:600, textDecoration:'none', marginLeft:'auto' }}>Generate Login Credentials →</a>
        </div>

        {section === 'roles' ? <RolesPermissionsSection /> : (<>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>ESS &amp; Access Management</div>
        <div style={{ fontSize:12, color:TK.muted, marginBottom:14 }}>Employee self-service accounts, roles, and access control.</div>

        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ ...T.btnOutline, ...(tab===t.k ? { background:TK.brand, color:'#fff', border:'1px solid #2563EB' } : {}) }}>{t.l}</button>
          ))}
          <button onClick={reload} style={{ ...T.btnOutline, marginLeft:'auto' }}>Refresh</button>
        </div>

        {loading ? (
          <div style={{ ...T.card, textAlign:'center', color:TK.brand, padding:40 }}>Loading…</div>
        ) : (
          <>
            {tab === 'dashboard' && <DashboardTab users={users} audit={audit} isMobile={isMobile} />}
            {tab === 'access' && <AccessTab users={users} isMobile={isMobile} onActivate={doActivate} onDeactivate={askDeactivate} onAssignOpen={(u)=>{ setSelUser(u); setTab('roles') }} onImpersonate={doImpersonate} onBulk={doBulk} />}
            {tab === 'roles' && <RolesTab users={users} roles={roles} isMobile={isMobile} selected={selUser} onSelect={setSelUser} onAssign={doAssign} />}
            {tab === 'assign' && <RoleAssignTab users={users} roles={roles} org={org} isMobile={isMobile} onAssign={doAssign} />}
            {tab === 'audit' && <AuditTab audit={audit} />}
          </>
        )}
        </>)}
      </div>

      {/* Deactivation guard modal */}
      {deact && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ ...T.card, maxWidth:440, width:'100%', marginBottom:0 }}>
            {!deact.last_working_date ? (
              <div style={{ background:TK.warningTint, border:'1px solid #FDE68A', borderRadius:8, padding:'12px 14px', marginBottom:12, fontSize:12.5, color:TK.warning, lineHeight:1.6 }}>This employee has <b>no Date of Leaving set</b>. Deactivate anyway? They will not be able to log in, or reset their password.
              </div>
            ) : (
              <div style={{ fontSize:13, marginBottom:12 }}>Deactivate <b>{deact.full_name}</b>? They won&apos;t be able to log in or reset their password.</div>
            )}
            <label style={T.label}>Reason (optional)</label>
            <input style={{ ...T.input, marginBottom:14 }} value={deactReason} onChange={e => setDeactReason(e.target.value)} placeholder="e.g. resigned, absconding…" />
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
              <button onClick={() => setDeact(null)} style={T.btnOutline}>Cancel</button>
              {!deact.last_working_date && <button onClick={() => { setDeact(null); notify('Set the Date of Leaving in the Employees module first.', 'error') }} style={{ ...T.btnOutline, borderColor:'#FDE68A', color:TK.warning }}>Set DOL First</button>}
              <button onClick={() => confirmDeactivate(deact)} style={{ ...T.btnPrimary, background:TK.critical }}>{deact.last_working_date ? 'Deactivate' : 'Deactivate Anyway'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Impersonation overlay (Employee Portal = Phase 2) */}
      {imp && (
        <div style={{ position:'fixed', inset:0, background:TK.canvas, zIndex:1200, overflowY:'auto', fontFamily:'"DM Sans","Segoe UI",sans-serif' }}>
          <div style={{ background:TK.ink, color:'#fff', padding:'10px 18px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:600 }}>Viewing as {imp.u.full_name} — Admin Mode</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,.6)' }}>{imp.u.emp_code} · {imp.u.designation || '—'}</span>
            <button onClick={exitImpersonate} style={{ marginLeft:'auto', ...T.btnOutline, background:'transparent', color:'#fff', borderColor:'rgba(255,255,255,.3)' }}>Exit Admin Mode</button>
          </div>
          <EmployeePortal employeeId={imp.u.employee_id} />
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
