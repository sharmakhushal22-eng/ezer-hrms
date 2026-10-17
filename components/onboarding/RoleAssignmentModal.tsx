'use client'
// components/onboarding/RoleAssignmentModal.tsx — the HR Manager's Role assignment, from the
// onboarding card once IT, Admin and Payroll have approved: the L1 and L2 managers (and HOD),
// and the ESS role — the permissions it grants are shown as it is picked. Submitting records
// the assignment; the employee code is generated after it (Generate code on the card), at which
// point the reporting line and the role are applied to the new employee.
// API: /api/onboarding/role-assignment.
import { useEffect, useMemo, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z } from '@/lib/ui'

type Emp = { id: string; emp_code: string; full_name: string; designation: string | null; department: string | null }
type Role = { id: string; role_code: string; role_name: string; scope: string | null; salary_visibility: string | null; permissions: { module: string; access_level: string }[] }

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: TK.surface, color: TK.ink }
const btn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: TK.brand, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 600 }
const LEVEL: Record<string, { label: string; color: string; bg: string }> = {
  VIEW: { label: 'View', color: TK.info, bg: TK.infoTint }, EDIT: { label: 'Edit', color: TK.warning, bg: TK.warningTint }, FULL: { label: 'Full', color: TK.positive, bg: TK.positiveTint },
}

// Outside the modal so typing in the search never remounts it.
function EmpPicker({ label, value, onChange, employees, required, exclude }: { label: string; value: string; onChange: (v: string) => void; employees: Emp[]; required?: boolean; exclude?: string[] }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pool = employees.filter(e => !exclude?.includes(e.id) || e.id === value)
    return (t ? pool.filter(e => `${e.full_name} ${e.emp_code} ${e.designation || ''}`.toLowerCase().includes(t)) : pool).slice(0, 60)
  }, [q, employees, exclude, value])
  const chosen = employees.find(e => e.id === value)
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={{ color: TK.critical }}> *</span>}</label>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or code…" style={{ ...input, marginBottom: 4 }} />
      <select value={value} onChange={e => onChange(e.target.value)} size={5} style={{ ...input, padding: 4 }}>
        <option value="">— none —</option>
        {chosen && !list.some(e => e.id === chosen.id) && <option value={chosen.id}>{chosen.full_name} · {chosen.emp_code}</option>}
        {list.map(e => <option key={e.id} value={e.id}>{e.full_name} · {e.emp_code}{e.designation ? ` · ${e.designation}` : ''}</option>)}
      </select>
      {chosen && <div style={{ fontSize: 12, color: TK.positive, marginTop: 4, fontWeight: 600 }}>✓ {chosen.full_name}{chosen.designation ? ` — ${chosen.designation}` : ''}</div>}
    </div>
  )
}

export default function RoleAssignmentModal({ onboardingId, name, onClose, onDone }: { onboardingId: string; name: string; onClose: () => void; onDone: (msg: string, type?: 'ok' | 'err') => void }) {
  const [data, setData] = useState<{ candidate: any; employees: Emp[]; roles: Role[] } | null>(null)
  const [err, setErr] = useState('')
  const [l1, setL1] = useState(''); const [l2, setL2] = useState(''); const [hod, setHod] = useState(''); const [roleId, setRoleId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onboarding/role-assignment?onboarding_id=${onboardingId}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load')
        if (!alive) return
        setData(d)
        const c = d.candidate || {}
        setL1(c.l1_manager_id || ''); setL2(c.l2_manager_id || ''); setHod(c.hod_id || ''); setRoleId(c.role_assignment?.role_id || '')
      } catch (e: any) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [onboardingId])

  const role = data?.roles.find(r => r.id === roleId)
  const canSave = !!l1 && !!roleId && l1 !== l2
  async function save() {
    if (!canSave) { onDone(l1 === l2 && l1 ? 'L1 and L2 cannot be the same person.' : 'Pick the L1 manager and the role.', 'err'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/role-assignment', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarding_id: onboardingId, l1_manager_id: l1, l2_manager_id: l2 || null, hod_id: hod || null, role_id: roleId }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      onDone(`Role assigned — ${d.assignment.role_name}, reporting to ${d.assignment.l1_name}. Generate code is now on the card.`, 'ok')
      onClose()
    } catch (e: any) { onDone(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <div style={{ background: TK.surface, color: TK.ink, borderRadius: 12, width: 'min(860px, 100%)', margin: '0 auto', padding: '20px 22px', boxShadow: '0 24px 70px rgba(15,23,42,.3)', fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: TK.muted }}>Role assignment</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{name}</div>
            <div style={{ fontSize: 12.5, color: TK.inkSoft, marginTop: 2 }}>Who they report to and what they can open in ESS. The employee code is generated after this.</div>
          </div>
          <button onClick={onClose} style={btnO}>✕ Close</button>
        </div>
        {err && <div style={{ color: TK.critical, marginTop: 14 }}>{err}</div>}
        {!err && !data && <div style={{ color: TK.muted, padding: '20px 0' }}>Loading…</div>}
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
              <EmpPicker label="L1 manager (reporting manager)" value={l1} onChange={setL1} employees={data.employees} required exclude={[l2].filter(Boolean)} />
              <EmpPicker label="L2 manager" value={l2} onChange={setL2} employees={data.employees} exclude={[l1].filter(Boolean)} />
              <EmpPicker label="HOD" value={hod} onChange={setHod} employees={data.employees} />
            </div>

            <div style={{ marginTop: 18 }}>
              <label style={lbl}>Role in ESS <span style={{ color: TK.critical }}>*</span></label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {data.roles.map(r => (
                  <button key={r.id} type="button" onClick={() => setRoleId(r.id)} style={{ ...btnO, padding: '7px 12px', fontSize: 12, ...(roleId === r.id ? { background: TK.brand, color: TK.onAccent, borderColor: TK.brand } : {}) }}>{r.role_name}</button>
                ))}
              </div>
            </div>

            {role && (
              <div style={{ marginTop: 14, border: `1px solid ${TK.line}`, borderRadius: 10, padding: '12px 14px', background: TK.sunken }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 700 }}>{role.role_name} <span style={{ color: TK.muted, fontWeight: 500, fontSize: 11 }}>· {role.role_code}{role.scope ? ` · scope ${role.scope}` : ''}{role.salary_visibility ? ` · salary ${role.salary_visibility.toLowerCase()}` : ''}</span></div>
                  <div style={{ fontSize: 11.5, color: TK.muted }}>{role.permissions.length} module{role.permissions.length === 1 ? '' : 's'} this role opens, plus everything every employee gets</div>
                </div>
                {role.permissions.length === 0
                  ? <div style={{ fontSize: 12, color: TK.muted, marginTop: 8 }}>No module of its own — the employee portal only.</div>
                  : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, marginTop: 10 }}>
                      {role.permissions.map(p => { const lv = LEVEL[p.access_level] || { label: p.access_level, color: TK.muted, bg: TK.surface }; return (
                        <div key={p.module} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: 7, padding: '6px 9px', fontSize: 12 }}>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.module}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, color: lv.color, background: lv.bg }}>{lv.label}</span>
                        </div>) })}
                    </div>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
              <button disabled={busy || !canSave} onClick={save} style={{ ...btn, opacity: canSave ? 1 : .55, cursor: canSave ? 'pointer' : 'not-allowed' }}>{busy ? 'Saving…' : data.candidate?.role_assignment ? 'Update assignment' : 'Submit assignment'}</button>
              <span style={{ fontSize: 12, color: TK.muted }}>Applied to the employee record and ESS access when the code is generated.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
