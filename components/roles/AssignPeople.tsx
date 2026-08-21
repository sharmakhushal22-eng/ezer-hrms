'use client'
// components/roles/AssignPeople.tsx — give people roles.
//
// The screen this replaces was a four-step wizard: pick a company, then a branch, then a
// department, then one person, then their roles. It worked, but it answered the wrong
// question. HR knows the name — they should not have to know which company that person
// sits in before they can type it. And assigning twenty-odd people meant running the
// wizard twenty-odd times.
//
// So: search first, filters optional, several people at once, and — the part that
// matters — the effect of a change is shown before it is saved. Handing somebody a role
// without being able to see what it opens is how permissions quietly go wrong.
import { useState, useMemo, useEffect } from 'react'
import {
  resolveGrant, visibleModules, MODULES,
  type AccessLevel, type RoleRef,
} from '@/lib/permissions'
import { rmsAdmin } from '@/lib/rms-client'
import type { EssUser, EssRole, OrgUnit, RolePermission, ApprovalRight } from '@/lib/supabase-ess'
import { APPROVAL_TYPES } from '@/lib/supabase-ess'

const S = {
  card:  { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', boxShadow:'0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  input: { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' } as React.CSSProperties,
  sel:   { padding:'6px 9px', background:'#fff', border:'1px solid #DDD6FE', borderRadius:99, color:'#6D28D9', fontSize:11.5, fontFamily:'inherit', outline:'none', cursor:'pointer' } as React.CSSProperties,
  pri:   { padding:'9px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12.5, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' } as React.CSSProperties,
  out:   { padding:'8px 14px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9' } as React.CSSProperties,
  lbl:   { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase' as const, letterSpacing:'.06em', display:'block', marginBottom:6 } as React.CSSProperties,
}

const LEVEL_TONE: Record<AccessLevel, [string, string]> = {
  NONE: ['#F3F4F6', '#9CA3AF'],
  VIEW: ['#DBEAFE', '#1E40AF'],
  EDIT: ['#FEF3C7', '#92400E'],
  FULL: ['#D1FAE5', '#065F46'],
}

// ── Sub-components, all outside the parent. Inside, they would re-mount on every
//    keystroke and the search box would lose focus after one character. ──

function Pill({ text, bg, fg, title }: { text: string; bg: string; fg: string; title?: string }) {
  return (
    <span title={title} style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color:fg, whiteSpace:'nowrap' }}>{text}</span>
  )
}

function Chip({ value, onChange, options, allLabel }: {
  value: string; onChange: (v: string) => void
  options: { id: string; name: string }[]; allLabel: string
}) {
  const on = !!value
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...S.sel, ...(on ? { background:'#7C3AED', color:'#fff', borderColor:'#7C3AED', fontWeight:600 } : {}) }}>
      <option value="">{allLabel}</option>
      {options.map(o => <option key={o.id} value={o.id} style={{ color:'#1E1B4B', background:'#fff' }}>{o.name}</option>)}
    </select>
  )
}

function PersonRow({ u, checked, onToggle, onOpen, active }: {
  u: EssUser; checked: boolean; onToggle: () => void; onOpen: () => void; active: boolean
}) {
  const noAccount = !u.account
  return (
    <div onClick={onOpen}
      style={{ display:'grid', gridTemplateColumns:'28px 92px 1fr 1fr', gap:10, alignItems:'center',
               padding:'9px 10px', borderRadius:8, cursor:'pointer', marginBottom:2,
               background: active ? '#F3F0FF' : 'transparent',
               border: active ? '1px solid #DDD6FE' : '1px solid transparent' }}>
      <input type="checkbox" checked={checked} onClick={e => e.stopPropagation()} onChange={onToggle}
        style={{ width:15, height:15, accentColor:'#7C3AED', cursor:'pointer' }} />
      <div style={{ fontSize:11.5, fontFamily:'monospace', color:'#6B7280' }}>{u.emp_code}</div>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#1E1B4B', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.full_name}</div>
        <div style={{ fontSize:11, color:'#9CA3AF', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {[u.designation, u.dept_name].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
        {noAccount
          ? <Pill text="No ESS account" bg="#FEF3C7" fg="#92400E" title="Cannot sign in and cannot hold a role until an account exists" />
          : u.roles.length
            ? u.roles.map(r => <Pill key={r.id} text={r.role_name} bg="#EDE9FE" fg="#6D28D9" />)
            : <Pill text="No role" bg="#F3F4F6" fg="#9CA3AF" />}
      </div>
    </div>
  )
}

/** What the picked roles actually open. Computed with the same function the server uses,
 *  so the preview cannot promise something the dashboard then refuses. */
function EffectPreview({ roles, perms, rights }: {
  roles: EssRole[]; perms: RolePermission[]; rights: ApprovalRight[]
}) {
  const grant = useMemo(() => resolveGrant({
    employeeId: null,
    roles: roles as unknown as RoleRef[],
    permissions: perms.map(p => ({ role_id: p.role_id, module: p.module, access_level: p.access_level as AccessLevel })),
    approvals: rights as any[],
    enforced: true,
  }), [roles, perms, rights])

  const open = visibleModules(grant)
  const hidden = MODULES.length - open.length

  return (
    <div>
      <div style={S.lbl}>What they will see</div>
      {open.length === 0 ? (
        <div style={{ fontSize:12, color:'#6B7280', padding:'8px 0' }}>
          Nothing in the admin dashboard. Their ESS portal is unaffected — every employee keeps that.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:8 }}>
          {open.map(({ module, level }) => (
            <div key={module} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'#1E1B4B' }}>
              <span style={{ flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{module}</span>
              <Pill text={level} bg={LEVEL_TONE[level][0]} fg={LEVEL_TONE[level][1]} />
            </div>
          ))}
          {hidden > 0 && (
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{hidden} other module{hidden === 1 ? '' : 's'} stay hidden.</div>
          )}
        </div>
      )}

      {grant.approvals.filter(a => a.can_approve || a.can_reject).length > 0 && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:'1px dashed #EDE9FE' }}>
          <div style={S.lbl}>They can act on</div>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {grant.approvals.filter(a => a.can_approve || a.can_reject).map(a => (
              <Pill key={a.approval_type}
                text={APPROVAL_TYPES.find(t => t.key === a.approval_type)?.label || a.approval_type}
                bg="#ECFDF5" fg="#065F46" />
            ))}
          </div>
          <div style={{ fontSize:10.5, color:'#9CA3AF', marginTop:6, lineHeight:1.5 }}>
            Approval buttons come from approval rights, not module access — which is why a
            role can approve something it cannot otherwise administer.
          </div>
        </div>
      )}

      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px dashed #EDE9FE', fontSize:12, color:'#1E1B4B' }}>
        Salary visible up to:{' '}
        <b>{grant.salaryVisibility === 'NONE' ? 'nothing' : grant.salaryVisibility.toLowerCase()}</b>
      </div>
    </div>
  )
}

function DetailPanel({ user, roles, perms, rights, onSave, saving }: {
  user: EssUser; roles: EssRole[]; perms: RolePermission[]; rights: ApprovalRight[]
  onSave: (roleIds: string[], reason: string) => void
  saving: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')

  // Re-seed whenever a different person is opened, so the checkboxes always show what
  // that person holds right now rather than what the last one did.
  useEffect(() => {
    setPicked(new Set(user.roles.map(r => r.id)))
    setReason('')
  }, [user.employee_id])

  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const pickedRoles = roles.filter(r => picked.has(r.id))
  const before = user.roles.map(r => r.id).sort().join(',')
  const after = [...picked].sort().join(',')
  const changed = before !== after

  return (
    <div style={{ ...S.card, position:'sticky', top:10 }}>
      <div style={{ fontSize:14, fontWeight:600, color:'#1E1B4B' }}>{user.full_name}</div>
      <div style={{ fontSize:11, color:'#9CA3AF', fontFamily:'monospace', marginBottom:12 }}>
        {user.emp_code}{user.company_name ? ` · ${user.company_name}` : ''}
      </div>

      {!user.account && (
        <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:7, padding:'8px 10px', fontSize:11.5, color:'#92400E', marginBottom:12, lineHeight:1.5 }}>
          No ESS account yet. Saving a role creates one — inactive and without a password,
          so nobody can sign in with it until HR issues credentials.
        </div>
      )}

      <div style={S.lbl}>Roles</div>
      <div style={{ display:'flex', flexDirection:'column', gap:2, marginBottom:14, maxHeight:210, overflowY:'auto' }}>
        {roles.map(r => (
          <label key={r.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 6px', borderRadius:6, cursor:'pointer', background: picked.has(r.id) ? '#F5F3FF' : 'transparent' }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)}
              style={{ width:14, height:14, accentColor:'#7C3AED', cursor:'pointer' }} />
            <span style={{ fontSize:12.5, color:'#1E1B4B', flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.role_name}</span>
            <span style={{ fontSize:10, color:'#9CA3AF', fontFamily:'monospace' }}>{r.scope}</span>
          </label>
        ))}
      </div>

      <div style={{ borderTop:'1px solid #EDE9FE', paddingTop:12, marginBottom:12 }}>
        <EffectPreview roles={pickedRoles} perms={perms} rights={rights} />
      </div>

      <div style={S.lbl}>Reason</div>
      <input style={{ ...S.input, marginBottom:10 }} value={reason} onChange={e => setReason(e.target.value)}
        placeholder="e.g. joined the payroll team in Q3" />

      <button
        disabled={!changed || !reason.trim() || saving}
        onClick={() => onSave([...picked], reason.trim())}
        style={{ ...S.pri, width:'100%', opacity: (!changed || !reason.trim() || saving) ? 0.45 : 1, cursor: (!changed || !reason.trim() || saving) ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving…' : changed ? 'Save roles' : 'No change to save'}
      </button>
      {changed && !reason.trim() && (
        <div style={{ fontSize:10.5, color:'#9CA3AF', marginTop:6, textAlign:'center' }}>
          A reason is required — it goes in the audit trail.
        </div>
      )}
    </div>
  )
}

function BulkBar({ count, roles, onApply, onClear, busy }: {
  count: number; roles: EssRole[]
  onApply: (mode: 'add' | 'remove', roleId: string, reason: string) => void
  onClear: () => void; busy: boolean
}) {
  const [roleId, setRoleId] = useState('')
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [reason, setReason] = useState('')

  return (
    <div style={{ position:'sticky', bottom:0, zIndex:5, background:'#1E1B4B', borderRadius:10, padding:'11px 14px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', boxShadow:'0 -4px 18px rgba(30,27,75,0.18)' }}>
      <span style={{ fontSize:12.5, fontWeight:600, color:'#fff', whiteSpace:'nowrap' }}>{count} selected</span>
      <select value={mode} onChange={e => setMode(e.target.value as any)}
        style={{ ...S.sel, borderRadius:7, background:'rgba(255,255,255,0.1)', color:'#fff', borderColor:'rgba(255,255,255,0.2)' }}>
        <option value="add" style={{ color:'#1E1B4B' }}>Add role</option>
        <option value="remove" style={{ color:'#1E1B4B' }}>Remove role</option>
      </select>
      <select value={roleId} onChange={e => setRoleId(e.target.value)}
        style={{ ...S.sel, borderRadius:7, background:'rgba(255,255,255,0.1)', color:'#fff', borderColor:'rgba(255,255,255,0.2)', minWidth:170 }}>
        <option value="" style={{ color:'#1E1B4B' }}>— choose a role —</option>
        {roles.map(r => <option key={r.id} value={r.id} style={{ color:'#1E1B4B' }}>{r.role_name}</option>)}
      </select>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason"
        style={{ ...S.input, width:190, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'#fff', padding:'7px 10px', fontSize:12 }} />
      <button disabled={!roleId || !reason.trim() || busy}
        onClick={() => onApply(mode, roleId, reason.trim())}
        style={{ ...S.pri, opacity: (!roleId || !reason.trim() || busy) ? 0.4 : 1, cursor: (!roleId || !reason.trim() || busy) ? 'not-allowed' : 'pointer' }}>
        {busy ? 'Applying…' : `Apply to ${count}`}
      </button>
      <button onClick={onClear} style={{ ...S.out, background:'transparent', color:'rgba(255,255,255,0.75)', borderColor:'rgba(255,255,255,0.25)', marginLeft:'auto' }}>Clear</button>
    </div>
  )
}

// ── The screen ──────────────────────────────────────────────────────────────

export default function AssignPeople({ users, roles, perms, rights, org, isMobile, onChanged, notify }: {
  users: EssUser[]
  roles: EssRole[]
  perms: RolePermission[]
  rights: ApprovalRight[]
  org: { companies: OrgUnit[]; locations: OrgUnit[]; departments: OrgUnit[] }
  isMobile: boolean
  onChanged: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const [q, setQ] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState('')
  const [busy, setBusy] = useState(false)

  const locations = useMemo(
    () => org.locations.filter(l => !companyId || l.company_id === companyId),
    [org.locations, companyId])
  const departments = useMemo(
    () => org.departments.filter(d => !companyId || d.company_id === companyId),
    [org.departments, companyId])

  // Search first. Every filter below is optional, and none of them gates the search —
  // knowing a name should be enough.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users.filter(u => {
      if (companyId && u.company_id !== companyId) return false
      if (locationId && u.location_id !== locationId) return false
      if (deptId && u.department_id !== deptId) return false
      if (roleFilter && !u.roles.some(r => r.id === roleFilter)) return false
      if (onlyUnassigned && u.roles.length) return false
      if (!needle) return true
      return (
        u.full_name.toLowerCase().includes(needle) ||
        (u.emp_code || '').toLowerCase().includes(needle) ||
        (u.designation || '').toLowerCase().includes(needle)
      )
    })
  }, [users, q, companyId, locationId, deptId, roleFilter, onlyUnassigned])

  const openUser = users.find(u => u.employee_id === openId) || null
  const noAccountCount = users.filter(u => !u.account).length

  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const allShownPicked = shown.length > 0 && shown.every(u => picked.has(u.employee_id))
  const toggleAllShown = () => setPicked(s => {
    const n = new Set(s)
    if (allShownPicked) shown.forEach(u => n.delete(u.employee_id))
    else shown.forEach(u => n.add(u.employee_id))
    return n
  })

  async function saveOne(roleIds: string[], reason: string) {
    if (!openUser) return
    setBusy(true)
    const res = await rmsAdmin({
      action: 'assign_roles', employee_ids: [openUser.employee_id],
      role_ids: roleIds, mode: 'replace', reason,
    })
    setBusy(false)
    if (res.error) { notify(res.error, 'error'); return }
    const failed = (res.results || []).find((r: any) => !r.ok)
    if (failed) { notify(failed.message || 'Could not update roles', 'error'); return }
    notify(`Roles updated for ${openUser.full_name}.`)
    onChanged()
  }

  async function applyBulk(mode: 'add' | 'remove', roleId: string, reason: string) {
    const ids = [...picked]
    const role = roles.find(r => r.id === roleId)
    if (!window.confirm(`${mode === 'add' ? 'Add' : 'Remove'} “${role?.role_name}” ${mode === 'add' ? 'to' : 'from'} ${ids.length} ${ids.length === 1 ? 'person' : 'people'}?`)) return
    setBusy(true)
    const res = await rmsAdmin({ action: 'assign_roles', employee_ids: ids, role_ids: [roleId], mode, reason })
    setBusy(false)
    if (res.error) { notify(res.error, 'error'); return }
    const failed = (res.results || []).filter((r: any) => !r.ok)
    if (failed.length) notify(`${ids.length - failed.length} updated, ${failed.length} refused — ${failed[0].message}`, 'error')
    else notify(`${ids.length} ${ids.length === 1 ? 'person' : 'people'} updated.`)
    setPicked(new Set())
    onChanged()
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 330px', gap:12, alignItems:'start' }}>
      <div style={{ minWidth:0 }}>
        <div style={{ ...S.card, marginBottom:10 }}>
          <input style={{ ...S.input, marginBottom:9 }} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by name, employee code or designation…" />
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <Chip value={companyId} onChange={v => { setCompanyId(v); setLocationId(''); setDeptId('') }} options={org.companies} allLabel="All companies" />
            <Chip value={locationId} onChange={setLocationId} options={locations} allLabel="All branches" />
            <Chip value={deptId} onChange={setDeptId} options={departments} allLabel="All departments" />
            <Chip value={roleFilter} onChange={setRoleFilter} options={roles.map(r => ({ id: r.id, name: r.role_name }))} allLabel="Any role" />
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:11.5, color: onlyUnassigned ? '#6D28D9' : '#6B7280', cursor:'pointer', padding:'6px 9px', borderRadius:99, border:`1px solid ${onlyUnassigned ? '#7C3AED' : '#DDD6FE'}`, background: onlyUnassigned ? '#F5F3FF' : '#fff' }}>
              <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} style={{ width:13, height:13, accentColor:'#7C3AED' }} />
              No role assigned
            </label>
          </div>
          {noAccountCount > 0 && (
            <div style={{ marginTop:9, fontSize:11.5, color:'#92400E', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:7, padding:'7px 10px', lineHeight:1.5 }}>
              {noAccountCount} {noAccountCount === 1 ? 'employee has' : 'employees have'} no ESS account, so they cannot sign in or hold a role.
              They are listed below rather than hidden — issue credentials from <b>ESS &amp; Access → Generate Login Credentials</b>.
            </div>
          )}
        </div>

        <div style={{ ...S.card, padding:'10px 12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, paddingBottom:8, borderBottom:'1px solid #EDE9FE' }}>
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:11.5, color:'#6B7280', cursor:'pointer' }}>
              <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} style={{ width:15, height:15, accentColor:'#7C3AED', cursor:'pointer' }} />
              Select all shown
            </label>
            <span style={{ marginLeft:'auto', fontSize:11.5, color:'#9CA3AF' }}>
              {shown.length} of {users.length} {shown.length === 1 ? 'person' : 'people'}
            </span>
          </div>

          <div style={{ maxHeight:'56vh', overflowY:'auto' }}>
            {shown.length === 0 ? (
              <div style={{ padding:'26px 0', textAlign:'center', color:'#9CA3AF', fontSize:12.5 }}>Nobody matches that.</div>
            ) : shown.map(u => (
              <PersonRow key={u.employee_id} u={u}
                checked={picked.has(u.employee_id)}
                onToggle={() => toggle(u.employee_id)}
                onOpen={() => setOpenId(u.employee_id)}
                active={openId === u.employee_id} />
            ))}
          </div>
        </div>

        {picked.size > 0 && (
          <div style={{ marginTop:10 }}>
            <BulkBar count={picked.size} roles={roles} onApply={applyBulk} onClear={() => setPicked(new Set())} busy={busy} />
          </div>
        )}
      </div>

      {openUser ? (
        <DetailPanel user={openUser} roles={roles} perms={perms} rights={rights} onSave={saveOne} saving={busy} />
      ) : (
        <div style={{ ...S.card, color:'#9CA3AF', fontSize:12.5, lineHeight:1.6 }}>
          Pick somebody to see their roles and exactly what those roles open, before saving.
          <br /><br />
          Tick several to add or remove one role across all of them at once.
        </div>
      )}
    </div>
  )
}
