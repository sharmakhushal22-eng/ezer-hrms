'use client'
// app/ess-portal/page.tsx — ESS portal for the logged-in employee (localStorage session).
// A normal employee sees ONLY their own portal. An employee whose ESS role grants a
// wider scope (TEAM/DEPT/BRANCH/ORG) gets a "View team member" picker to open others'
// portals (read-scoped by their role) — the self-service equivalent of admin "Login as".
import { useState, useEffect } from 'react'
import EmployeePortal from '@/components/ess/EmployeePortal'
import { loadAccessScope, AccessScope, ScopeEmployee } from '@/lib/ess-scope'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

type Session = { employee_id: string; name?: string; email?: string }

export default function ESSPortalPage() {
  const [mounted, setMounted] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [scope, setScope] = useState<AccessScope | null>(null)
  const [viewing, setViewing] = useState<ScopeEmployee | null>(null)  // null = own portal
  const [pickerOpen, setPickerOpen] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    setMounted(true)
    let parsed: Session | null = null
    try { const raw = localStorage.getItem('ezer_ess_session'); if (raw) { const o = JSON.parse(raw); if (o?.employee_id) parsed = o } } catch { parsed = null }
    if (!parsed) { window.location.href = '/ess-login'; return }
    setSession(parsed)
    loadAccessScope(parsed.employee_id).then(setScope).catch(() => setScope(null))
  }, [])

  const onExit = () => { localStorage.removeItem('ezer_ess_session'); window.location.href = '/ess-login' }

  if (!mounted || !session) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TK.canvas, fontFamily: '"DM Sans","Segoe UI",sans-serif', color: TK.muted, fontSize: 14 }}>Loading your portal…</div>
  }

  const canViewOthers = !!scope?.canViewOthers
  const list = (scope?.employees || []).filter(e => !q || e.full_name.toLowerCase().includes(q.toLowerCase()) || e.emp_code.toLowerCase().includes(q.toLowerCase()))

  // When viewing another employee, render their portal in adminMode with a return-to-self exit.
  if (viewing) {
    return (
      <div>
        <div style={{ background: TK.dark, color: TK.onDark, padding: '9px 18px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 }}>
          <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: TK.warning, color: TK.ink, fontWeight: 700 }}>{scope?.scope} VIEW</span>
          <span>Viewing <b>{viewing.full_name}</b> · {viewing.emp_code}{viewing.designation ? ` · ${viewing.designation}` : ''}</span>
          <button onClick={() => setViewing(null)} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: TK.onDark, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>Back to my portal</button>
        </div>
        <EmployeePortal employeeId={viewing.id} adminMode onExit={() => setViewing(null)} />
      </div>
    )
  }

  return (
    <div>
      {canViewOthers && (
        <div style={{ background: TK.brandTint, borderBottom: `1px solid ${TK.line}`, padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 12.5, color: TK.brandDeep }}>
          <span>You have <b>{scope?.roleNames.join(', ')}</b> access ({scope?.scope.toLowerCase()}) — you can open {scope?.employees.length} team member{scope?.employees.length === 1 ? '' : 's'}&apos; portals.</span>
          <button onClick={() => { setPickerOpen(true); setQ('') }} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, border: 'none', background: TK.brand, color: TK.onAccent, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>View a team member →</button>
        </div>
      )}

      <EmployeePortal employeeId={session.employee_id} onExit={onExit} />

      {pickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: '"DM Sans","Segoe UI",sans-serif' }} onClick={() => setPickerOpen(false)}>
          <div style={{ background: TK.surface, borderRadius: 12, padding: 18, maxWidth: 480, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TK.ink, marginBottom: 8 }}>Open a team member&apos;s portal</div>
            <input autoFocus placeholder="Search name or code…" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '9px 12px', border: `1px solid ${TK.line}`, borderRadius: 8, fontSize: 13, background: TK.sunken, outline: 'none', marginBottom: 10, fontFamily: 'inherit' }} />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {list.map(e => (
                <div key={e.id} onClick={() => { setViewing(e); setPickerOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', borderBottom: `1px solid ${TK.line}` }} onMouseEnter={ev => (ev.currentTarget.style.background = TK.canvas)} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: TK.brandTint, color: TK.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{e.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: TK.ink }}>{e.full_name}</div><div style={{ fontSize: 11, color: TK.muted }}>{e.emp_code}{e.designation ? ` · ${e.designation}` : ''}{e.dept_name ? ` · ${e.dept_name}` : ''}</div></div>
                </div>
              ))}
              {!list.length && <div style={{ padding: 20, textAlign: 'center', color: TK.muted, fontSize: 13 }}>No matching employees.</div>}
            </div>
            <div style={{ textAlign: 'right', marginTop: 10 }}><button onClick={() => setPickerOpen(false)} style={{ padding: '8px 14px', background: TK.surface, color: TK.ink, border: `1px solid ${TK.line}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
