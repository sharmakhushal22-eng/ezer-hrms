'use client'
// app/dashboard/roles/page.tsx — Roles & Permissions
// Overview · Module Access (per-role matrix) · Approval Rights (per-role) ·
// Approval/Rejection (role-as-tester queue). Schema: migration 028 + ess_* (021).
// Employee→role ASSIGNMENT lives in ESS → 🧭 Assign Roles (not duplicated here).
// Inline styles only. All sub-components OUTSIDE parent.
import { useState, useEffect, useCallback } from 'react'
import {
  loadRoles, loadUsers, assignRoles, loadRolePermissions, upsertRolePermission, loadApprovalRights, setApprovalRight,
  loadPendingForRole, resolveRequest,
  PERM_MODULES, APPROVAL_TYPES,
  type EssRole, type EssUser, type RolePermission, type ApprovalRight, type PendingRequest, type AccessLevel,
} from '@/lib/supabase-ess'

const C = {
  page:  { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' } as React.CSSProperties,
  card:  { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  lbl:   { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:4 } as React.CSSProperties,
  sec:   { fontSize:12, fontWeight:600, color:'#7C3AED', textTransform:'uppercase' as const, letterSpacing:'.05em', marginBottom:10 } as React.CSSProperties,
  input: { width:'100%', padding:'8px 10px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  pri:   { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' } as React.CSSProperties,
  out:   { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9' } as React.CSSProperties,
  tab:   (on: boolean) => ({ padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background: on ? '#7C3AED' : '#fff', color: on ? '#fff' : '#6D28D9', boxShadow: on ? 'none' : '0 1px 3px rgba(124,58,237,0.08)' }) as React.CSSProperties,
}
const ACCESS_COLOR: Record<AccessLevel, [string, string]> = {
  NONE:['#F3F4F6','#9CA3AF'], VIEW:['#DBEAFE','#1E40AF'], EDIT:['#FEF3C7','#92400E'], FULL:['#D1FAE5','#065F46'],
}
const ACCESS_RANK: AccessLevel[] = ['NONE', 'VIEW', 'EDIT', 'FULL']
const highestAccess = (levels: AccessLevel[]): AccessLevel =>
  levels.reduce((best, l) => (ACCESS_RANK.indexOf(l) > ACCESS_RANK.indexOf(best) ? l : best), 'NONE' as AccessLevel)
// ESS portal baseline — always visible regardless of role.
const BASELINE_MODULES = ['Home', 'Profile', 'Notifications']
const fmtDT = (s?: string | null) => s ? new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'
const typeLabel = (k: string) => APPROVAL_TYPES.find(t => t.key === k)?.label || k

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:type==='success'?'#059669':'#DC2626', color:'#fff', borderRadius:10, padding:'12px 18px', fontSize:13, fontWeight:500, boxShadow:'0 8px 24px rgba(0,0,0,0.2)' }}>{type==='success'?'✓':'✗'} {msg}</div>
}
function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color }}>{text}</span>
}
function RoleList({ roles, selId, onSelect, rightCount }: { roles: EssRole[]; selId: string; onSelect: (id: string) => void; rightCount?: (r: EssRole) => string }) {
  return (
    <div style={{ ...C.card, maxHeight:'70vh', overflowY:'auto' }}>
      {roles.map(r => (
        <div key={r.id} onClick={() => onSelect(r.id)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:7, cursor:'pointer', marginBottom:3, background: selId === r.id ? '#F3F0FF' : 'transparent', border: selId === r.id ? '1px solid #DDD6FE' : '1px solid transparent' }}>
          <div><div style={{ fontSize:13, fontWeight:600 }}>{r.role_name}</div><div style={{ fontSize:10, color:'#9CA3AF' }}>{r.role_code}</div></div>
          {rightCount && <span style={{ fontSize:10, color:'#9CA3AF' }}>{rightCount(r)}</span>}
        </div>
      ))}
    </div>
  )
}

// ══ TAB 1 · Overview ════════════════════════════════════════════════
function OverviewTab({ roles, perms, rights }: { roles: EssRole[]; perms: RolePermission[]; rights: ApprovalRight[] }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:10 }}>
      {roles.map(r => {
        const apprv = rights.filter(x => x.role_id === r.id && x.can_approve).map(x => x.approval_type)
        const mods = perms.filter(x => x.role_id === r.id && x.access_level !== 'NONE')
        return (
          <div key={r.id} style={C.card}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontSize:14, fontWeight:600 }}>{r.role_name}</span>
              <Pill text={r.role_code} bg="#EDE9FE" color="#7C3AED" />
            </div>
            <div style={{ fontSize:11, color:'#6B7280', marginBottom:8 }}>Salary: <b>{r.salary_visibility}</b> · Scope: <b>{r.scope}</b></div>
            <div style={{ fontSize:11, color:'#6B7280', marginBottom:4 }}>Can approve ({apprv.length}):</div>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
              {apprv.length === 0 ? <span style={{ fontSize:10, color:'#9CA3AF' }}>—</span> : apprv.map(t => <Pill key={t} text={typeLabel(t)} bg="#ECFDF5" color="#059669" />)}
            </div>
            <div style={{ fontSize:11, color:'#6B7280' }}>Module access set: <b>{mods.length}</b> / {PERM_MODULES.length}</div>
          </div>
        )
      })}
    </div>
  )
}

// ══ TAB 2 · Module Access ═══════════════════════════════════════════
function ModuleAccessTab({ roles, perms, selId, onSelect, onSet }: {
  roles: EssRole[]; perms: RolePermission[]; selId: string; onSelect: (id: string) => void
  onSet: (role_id: string, module: string, level: AccessLevel) => void
}) {
  const sel = roles.find(r => r.id === selId)
  const levelOf = (module: string): AccessLevel => (perms.find(p => p.role_id === selId && p.module === module)?.access_level) || 'NONE'
  return (
    <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:10, alignItems:'start' }}>
      <RoleList roles={roles} selId={selId} onSelect={onSelect} rightCount={r => `${perms.filter(p => p.role_id === r.id && p.access_level !== 'NONE').length}`} />
      <div style={C.card}>
        {!sel ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Ek role chuno.</div> : (
          <>
            <div style={C.sec}>{sel.role_name} — module access</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:10 }}>Yeh ESS portal mein kaunse modules dikhenge woh control karta hai. Change turant save hota hai.</div>
            {PERM_MODULES.map(m => {
              const lvl = levelOf(m)
              const [bg, col] = ACCESS_COLOR[lvl]
              return (
                <div key={m} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid #F3F0FF' }}>
                  <span style={{ flex:1, fontSize:13 }}>{m}</span>
                  <Pill text={lvl} bg={bg} color={col} />
                  <select style={{ ...C.input, width:120 }} value={lvl} onChange={e => onSet(sel.id, m, e.target.value as AccessLevel)}>
                    {(['NONE', 'VIEW', 'EDIT', 'FULL'] as AccessLevel[]).map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ══ TAB 3 · Approval Rights ═════════════════════════════════════════
function ApprovalRightsTab({ roles, rights, selId, onSelect, onSet }: {
  roles: EssRole[]; rights: ApprovalRight[]; selId: string; onSelect: (id: string) => void
  onSet: (role_id: string, approval_type: string, triple: { can_approve: boolean; can_reject: boolean; can_initiate: boolean }) => void
}) {
  const sel = roles.find(r => r.id === selId)
  const rightOf = (t: string) => rights.find(x => x.role_id === selId && x.approval_type === t)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:10, alignItems:'start' }}>
      <RoleList roles={roles} selId={selId} onSelect={onSelect} rightCount={r => `${rights.filter(x => x.role_id === r.id && x.can_approve).length}`} />
      <div style={C.card}>
        {!sel ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Ek role chuno.</div> : (
          <>
            <div style={C.sec}>{sel.role_name} — approval rights</div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr repeat(3,70px)', gap:6, alignItems:'center', fontSize:10, color:'#9CA3AF', fontWeight:600, textTransform:'uppercase', padding:'4px 0', borderBottom:'1px solid #EDE9FE' }}>
              <span>Workflow</span><span style={{ textAlign:'center' }}>Initiate</span><span style={{ textAlign:'center' }}>Approve</span><span style={{ textAlign:'center' }}>Reject</span>
            </div>
            {APPROVAL_TYPES.map(t => {
              const r = rightOf(t.key)
              const cur = { can_approve: !!r?.can_approve, can_reject: !!r?.can_reject, can_initiate: !!r?.can_initiate }
              const Cell = ({ k }: { k: 'can_initiate' | 'can_approve' | 'can_reject' }) => (
                <input type="checkbox" checked={cur[k]} onChange={() => onSet(sel.id, t.key, { ...cur, [k]: !cur[k] })} style={{ display:'block', margin:'0 auto', cursor:'pointer' }} />
              )
              return (
                <div key={t.key} style={{ display:'grid', gridTemplateColumns:'2fr repeat(3,70px)', gap:6, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #F3F0FF' }}>
                  <span style={{ fontSize:13 }}>{t.label} {!t.live && <span style={{ fontSize:9, color:'#B45309' }} title="No live request source yet — handled in its own module">·future</span>}</span>
                  <Cell k="can_initiate" /><Cell k="can_approve" /><Cell k="can_reject" />
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ══ TAB 4 · Approval / Rejection ════════════════════════════════════
function RequestCard({ req, onResolve }: { req: PendingRequest; onResolve: (action: 'APPROVED' | 'REJECTED', remark: string) => Promise<void> }) {
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: 'APPROVED' | 'REJECTED') => {
    if (action === 'REJECTED' && !remark.trim()) return
    setBusy(true); await onResolve(action, remark.trim()); setBusy(false)
  }
  return (
    <div style={{ ...C.card, marginBottom:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
        <Pill text={typeLabel(req.request_type)} bg="#EDE9FE" color="#7C3AED" />
        <span style={{ fontSize:13, fontWeight:600 }}>{req.employee_name || '—'}</span>
        <span style={{ fontSize:11, color:'#9CA3AF' }}>{req.emp_code || ''} · {req.dept_name || '—'}</span>
        {req.is_confidential && <Pill text="CONFIDENTIAL" bg="#FEE2E2" color="#991B1B" />}
        <span style={{ marginLeft:'auto', fontSize:10, color:'#9CA3AF' }}>{fmtDT(req.submitted_at)}</span>
      </div>
      <div style={{ fontSize:12, color:'#374151', marginBottom:8 }}>{req.request_data?.detail || (req.request_data ? JSON.stringify(req.request_data).slice(0, 120) : '—')}</div>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <input style={{ ...C.input, flex:1, minWidth:180 }} placeholder="Remark (reject ke liye zaroori)" value={remark} onChange={e => setRemark(e.target.value)} />
        <button disabled={busy} style={{ ...C.pri, background:'#059669' }} onClick={() => run('APPROVED')}>✓ Approve</button>
        <button disabled={busy || !remark.trim()} style={{ ...C.pri, background:'#DC2626', opacity: remark.trim() ? 1 : 0.5 }} onClick={() => run('REJECTED')}>✗ Reject</button>
      </div>
    </div>
  )
}

function ApprovalTab({ roles, selId, onSelect, pending, onResolve }: {
  roles: EssRole[]; selId: string; onSelect: (id: string) => void
  pending: { types: string[]; requests: PendingRequest[] }
  onResolve: (req: PendingRequest, action: 'APPROVED' | 'REJECTED', remark: string) => Promise<void>
}) {
  const sel = roles.find(r => r.id === selId)
  return (
    <>
      <div style={C.card}>
        <label style={C.lbl}>Logged in as (test role)</label>
        <select style={{ ...C.input, maxWidth:360 }} value={selId} onChange={e => onSelect(e.target.value)}>
          <option value="">— Select a role —</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
        </select>
        {sel && (
          <div style={{ marginTop:10 }}>
            {pending.types.length === 0
              ? <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:'10px 12px', fontSize:12, color:'#92400E' }}>⚠️ <b>{sel.role_name}</b> ke paas koi approval rights nahi hai.</div>
              : <div style={{ fontSize:11, color:'#6B7280' }}>Can approve: {pending.types.map(t => <Pill key={t} text={typeLabel(t)} bg="#ECFDF5" color="#059669" />)}<span style={{ display:'inline-block', width:6 }} /></div>}
          </div>
        )}
      </div>

      {sel && pending.types.length > 0 && (
        <div style={C.card}>
          <div style={C.sec}>Pending requests ({pending.requests.length})</div>
          {pending.requests.length === 0
            ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Is role ke liye koi pending request nahi. (Leave / MRF / Offer jaise workflows apne module mein handle hote hain — ESS service requests mein abhi sirf Loan / Resignation / Profile-update aate hain.)</div>
            : pending.requests.map(req => <RequestCard key={req.id} req={req} onResolve={(a, r) => onResolve(req, a, r)} />)}
        </div>
      )}
    </>
  )
}

// ══ TAB · Role Assignment (role-centric: pick role → assign/remove employees) ══
function AssignRoleTab({ roles, users, rights, selId, onSelect, onToggle, isMobile }: {
  roles: EssRole[]; users: EssUser[]; rights: ApprovalRight[]
  selId: string; onSelect: (id: string) => void
  onToggle: (u: EssUser, role: EssRole, add: boolean) => void
  isMobile: boolean
}) {
  const [q, setQ] = useState('')
  const assignable = roles.filter(r => r.role_code !== 'EMPLOYEE') // EMPLOYEE excluded (spec)
  const sel = roles.find(r => r.id === selId) || null
  const has = (u: EssUser) => u.roles.some(r => r.id === selId)
  const filtered = users.filter(u => !q || u.full_name.toLowerCase().includes(q.toLowerCase()) || (u.emp_code || '').toLowerCase().includes(q.toLowerCase()))
  const assigned = filtered.filter(has)
  const unassigned = filtered.filter(u => !has(u))
  const apprv = sel ? rights.filter(x => x.role_id === sel.id && x.can_approve).map(x => x.approval_type) : []

  const Row = ({ u, add }: { u: EssUser; add: boolean }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'7px 8px', borderBottom:'1px solid #F3F0FF' }}>
      <div><div style={{ fontSize:13, fontWeight:600 }}>{u.full_name}</div><div style={{ fontSize:10, color:'#9CA3AF' }}>{u.emp_code} · {u.dept_name || '—'}</div></div>
      {sel && (add
        ? <button style={{ ...C.out, borderColor:'#A7F3D0', color:'#059669' }} onClick={() => onToggle(u, sel, true)}>Assign →</button>
        : <button style={{ ...C.out, borderColor:'#FCA5A5', color:'#DC2626' }} onClick={() => onToggle(u, sel, false)}>✕ Remove</button>)}
    </div>
  )

  return (
    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '240px 1fr', gap:10, alignItems:'start' }}>
      <RoleList roles={assignable} selId={selId} onSelect={onSelect} rightCount={r => `${users.filter(u => u.roles.some(x => x.id === r.id)).length}`} />
      <div>
        {!sel ? <div style={C.card}><span style={{ fontSize:12, color:'#9CA3AF' }}>Ek role chuno — phir employees assign/remove karo.</span></div> : (
          <>
            <div style={C.card}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                <span style={{ fontSize:14, fontWeight:600 }}>{sel.role_name}</span>
                <Pill text={sel.role_code} bg="#EDE9FE" color="#7C3AED" />
                <span style={{ fontSize:11, color:'#6B7280' }}>Salary: {sel.salary_visibility} · Scope: {sel.scope}</span>
              </div>
              <div style={{ fontSize:11, color:'#6B7280', marginBottom:4 }}>Can approve:</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {apprv.length === 0 ? <span style={{ fontSize:10, color:'#9CA3AF' }}>—</span> : apprv.map(t => <Pill key={t} text={typeLabel(t)} bg="#ECFDF5" color="#059669" />)}
              </div>
              <input style={{ ...C.input, marginTop:10 }} placeholder="🔍 Search employee" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:10 }}>
              <div style={C.card}>
                <div style={C.sec}>Assigned ({assigned.length})</div>
                <div style={{ maxHeight:'46vh', overflowY:'auto' }}>
                  {assigned.length === 0 ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Abhi kisi ko assign nahi.</div> : assigned.map(u => <Row key={u.employee_id} u={u} add={false} />)}
                </div>
              </div>
              <div style={C.card}>
                <div style={C.sec}>Not assigned ({unassigned.length})</div>
                <div style={{ maxHeight:'46vh', overflowY:'auto' }}>
                  {unassigned.slice(0, 100).map(u => <Row key={u.employee_id} u={u} add={true} />)}
                  {unassigned.length > 100 && <div style={{ fontSize:11, color:'#9CA3AF', marginTop:6 }}>+{unassigned.length - 100} more — search to narrow.</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ══ TAB · ESS Portal View (employee preview: modules + approval rights from roles) ══
function ESSPortalTab({ users, perms, rights, selId, onSelect, isMobile }: {
  users: EssUser[]; perms: RolePermission[]; rights: ApprovalRight[]
  selId: string; onSelect: (id: string) => void; isMobile: boolean
}) {
  const [q, setQ] = useState('')
  const emp = users.find(u => u.employee_id === selId) || null
  const roleIds = emp ? emp.roles.map(r => r.id) : []
  const modules = PERM_MODULES
    .map(m => ({ module: m, level: highestAccess(perms.filter(p => roleIds.includes(p.role_id) && p.module === m).map(p => p.access_level)) }))
    .filter(x => x.level !== 'NONE')
  const approvals = [...new Set(rights.filter(x => roleIds.includes(x.role_id) && x.can_approve).map(x => x.approval_type))]
  const filtered = users.filter(u => !q || u.full_name.toLowerCase().includes(q.toLowerCase()) || (u.emp_code || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 1fr', gap:10, alignItems:'start' }}>
      <div style={{ ...C.card, maxHeight:'70vh', overflowY:'auto' }}>
        <input style={{ ...C.input, marginBottom:8 }} placeholder="🔍 Search employee" value={q} onChange={e => setQ(e.target.value)} />
        {filtered.slice(0, 150).map(u => (
          <div key={u.employee_id} onClick={() => onSelect(u.employee_id)} style={{ padding:'8px 10px', borderRadius:7, cursor:'pointer', marginBottom:3, background: selId === u.employee_id ? '#F3F0FF' : 'transparent', border: selId === u.employee_id ? '1px solid #DDD6FE' : '1px solid transparent' }}>
            <div style={{ fontSize:13, fontWeight:600 }}>{u.full_name}</div>
            <div style={{ fontSize:10, color:'#9CA3AF' }}>{u.emp_code} · {u.roles.length ? u.roles.map(r => r.role_name).join(', ') : 'no role'}</div>
          </div>
        ))}
      </div>
      <div>
        {!emp ? <div style={C.card}><span style={{ fontSize:12, color:'#9CA3AF' }}>Employee chuno — ESS portal ka preview dikhega.</span></div> : (
          <>
            <div style={C.card}>
              <div style={{ fontSize:15, fontWeight:600 }}>{emp.full_name}</div>
              <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:8 }}>{emp.emp_code} · {emp.designation || '—'} · {emp.dept_name || '—'}</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {emp.roles.length === 0 ? <Pill text="NO ROLE" bg="#F3F4F6" color="#9CA3AF" /> : emp.roles.map(r => <Pill key={r.id} text={r.role_name} bg="#EDE9FE" color="#7C3AED" />)}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:10 }}>
              <div style={C.card}>
                <div style={C.sec}>Visible modules</div>
                {BASELINE_MODULES.map(m => (
                  <div key={m} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #F3F0FF' }}>
                    <span style={{ fontSize:13 }}>{m}</span><Pill text="ALWAYS" bg="#F3F4F6" color="#6B7280" />
                  </div>
                ))}
                {modules.map(({ module, level }) => {
                  const [bg, col] = ACCESS_COLOR[level]
                  return (
                    <div key={module} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #F3F0FF' }}>
                      <span style={{ fontSize:13 }}>{module}</span><Pill text={level} bg={bg} color={col} />
                    </div>
                  )
                })}
                {modules.length === 0 && <div style={{ fontSize:11, color:'#9CA3AF', marginTop:6 }}>Role-based module access set nahi — Module Access tab se configure karo.</div>}
              </div>
              <div style={C.card}>
                <div style={C.sec}>Approval rights</div>
                {approvals.length === 0 ? <div style={{ fontSize:12, color:'#9CA3AF' }}>Koi approval right active nahi.</div> : (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {approvals.map(t => <Pill key={t} text={typeLabel(t)} bg="#ECFDF5" color="#059669" />)}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
export default function RolesPermissionsPage() {
  const [tab, setTab] = useState<'assign' | 'ess' | 'overview' | 'modules' | 'approvals' | 'queue'>('assign')
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const notify = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const [roles, setRoles] = useState<EssRole[]>([])
  const [users, setUsers] = useState<EssUser[]>([])
  const [perms, setPerms] = useState<RolePermission[]>([])
  const [rights, setRights] = useState<ApprovalRight[]>([])
  const [selRole, setSelRole] = useState('')
  const [assignRole, setAssignRole] = useState('')
  const [essEmp, setEssEmp] = useState('')

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  // approval queue
  const [queueRole, setQueueRole] = useState('')
  const [pending, setPending] = useState<{ types: string[]; requests: PendingRequest[] }>({ types: [], requests: [] })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [r, u, p, a] = await Promise.all([loadRoles(), loadUsers(), loadRolePermissions(), loadApprovalRights()])
      setRoles(r); setUsers(u); setPerms(p); setRights(a)
      if (r.length) {
        if (!selRole) setSelRole(r[0].id)
        if (!assignRole) setAssignRole(r.find(x => x.role_code !== 'EMPLOYEE')?.id || r[0].id)
      }
    } catch (e: any) { notify('Load failed: ' + (e?.message || 'check migration 028'), 'error') }
    setLoading(false)
  }, [selRole])
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadQueue = useCallback(async (roleId: string) => {
    if (!roleId) { setPending({ types: [], requests: [] }); return }
    try { setPending(await loadPendingForRole(roleId)) }
    catch (e: any) { notify('Queue load failed: ' + (e?.message || ''), 'error') }
  }, [])
  useEffect(() => { reloadQueue(queueRole) }, [queueRole, reloadQueue])

  async function setModule(role_id: string, module: string, level: AccessLevel) {
    setPerms(prev => { // optimistic
      const others = prev.filter(p => !(p.role_id === role_id && p.module === module))
      return [...others, { id: `${role_id}:${module}`, role_id, module, access_level: level }]
    })
    const { error } = await upsertRolePermission(role_id, module, level)
    if (error) { notify('Save failed: ' + error.message, 'error'); reload() } else notify('Module access saved.')
  }

  async function setRight(role_id: string, approval_type: string, triple: { can_approve: boolean; can_reject: boolean; can_initiate: boolean }) {
    setRights(prev => {
      const others = prev.filter(x => !(x.role_id === role_id && x.approval_type === approval_type))
      return [...others, { id: `${role_id}:${approval_type}`, role_id, approval_type, priority: 1, ...triple }]
    })
    const { error } = await setApprovalRight(role_id, approval_type, triple)
    if (error) { notify('Save failed: ' + error.message, 'error'); reload() } else notify('Approval right saved.')
  }

  async function doAssignToggle(u: EssUser, role: EssRole, add: boolean) {
    const currentIds = u.roles.map(r => r.id)
    const newIds = add ? [...new Set([...currentIds, role.id])] : currentIds.filter(id => id !== role.id)
    const { error } = await assignRoles(u, newIds, 'Admin')
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`${role.role_name} ${add ? 'assigned to' : 'removed from'} ${u.full_name}${add ? ' · ESS mein visible' : ''}`)
    setUsers(await loadUsers()) // refresh just the user→role view
  }

  async function doResolve(req: PendingRequest, action: 'APPROVED' | 'REJECTED', remark: string) {
    const byName = roles.find(r => r.id === queueRole)?.role_name || 'Admin'
    const { error } = await resolveRequest(req.id, action, remark, byName)
    if (error) { notify('Failed: ' + error.message, 'error'); return }
    notify(`Request ${action === 'APPROVED' ? 'approved' : 'rejected'}.`)
    reloadQueue(queueRole)
  }

  const tabs: [typeof tab, string][] = [['assign', '🔐 Role Assignment'], ['ess', '📱 ESS Portal View'], ['overview', 'Overview'], ['modules', 'Module Access'], ['approvals', 'Approval Rights'], ['queue', '✅ Approval / Rejection']]

  return (
    <div style={{ ...C.page, padding:'20px 24px' }}>
      <div style={{ maxWidth:1200, margin:'0 auto' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:2 }}>Roles &amp; Permissions</div>
        <div style={{ fontSize:12, color:'#6B7280', marginBottom:14 }}>Module access &amp; approval rights per role, plus a role-as-tester approval queue. (Employee→role assignment ESS ke 🧭 Assign Roles tab mein hai.)</div>

        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {tabs.map(([k, l]) => <button key={k} style={C.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {loading ? <div style={{ ...C.card, textAlign:'center', color:'#7C3AED', padding:40 }}>Loading…</div> : (
          <>
            {tab === 'assign' && <AssignRoleTab roles={roles} users={users} rights={rights} selId={assignRole} onSelect={setAssignRole} onToggle={doAssignToggle} isMobile={isMobile} />}
            {tab === 'ess' && <ESSPortalTab users={users} perms={perms} rights={rights} selId={essEmp} onSelect={setEssEmp} isMobile={isMobile} />}
            {tab === 'overview' && <OverviewTab roles={roles} perms={perms} rights={rights} />}
            {tab === 'modules' && <ModuleAccessTab roles={roles} perms={perms} selId={selRole} onSelect={setSelRole} onSet={setModule} />}
            {tab === 'approvals' && <ApprovalRightsTab roles={roles} rights={rights} selId={selRole} onSelect={setSelRole} onSet={setRight} />}
            {tab === 'queue' && <ApprovalTab roles={roles} selId={queueRole} onSelect={setQueueRole} pending={pending} onResolve={doResolve} />}
          </>
        )}
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
