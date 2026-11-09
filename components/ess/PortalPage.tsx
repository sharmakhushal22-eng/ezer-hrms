'use client'
// components/ess/PortalPage.tsx — the ESS portal for the logged-in employee (localStorage
// session). Rendered by app/ess/[[...path]]/page.tsx: every screen has its own address under
// /ess (lib/ess/routes.ts) and the portal keeps the address bar in step as you move.
// A normal employee sees ONLY their own portal. An employee whose ESS role grants a
// wider scope (TEAM/DEPT/BRANCH/ORG) gets a "View team member" picker to open others'
// portals (read-scoped by their role) — the self-service equivalent of admin "Login as".
import { useState, useEffect, useCallback } from 'react'
import EmployeePortal from '@/components/ess/EmployeePortal'
import { loadAccessScope, AccessScope, ScopeEmployee } from '@/lib/ess-scope'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, Z, IconEmployees } from '@/lib/ui'

type Session = { employee_id: string; name?: string; email?: string }

export default function PortalPage() {
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
    // replace, not href: the portal must not sit in history behind the login page
    if (!parsed) { window.location.replace('/ess-login'); return }
    setSession(parsed)
    loadAccessScope(parsed.employee_id).then(setScope).catch(() => setScope(null))
  }, [])

  const onExit = () => { localStorage.removeItem('ezer_ess_session'); window.location.replace('/ess-login') }

  // The picker and the team-member view are overlays, not addresses — but people still press
  // the browser's Back (or the trackpad swipe) to leave them. Each one therefore owns a history
  // entry marked { ezOverlay }, on the same URL: Back pops it and the popstate below closes the
  // overlay. Closing from a button goes through history.back() so the entry never lingers.
  const openPicker = () => {
    setPickerOpen(true); setQ('')
    window.history.pushState({ ezOverlay: 'picker' }, '', window.location.href)
  }
  const openMember = (e: ScopeEmployee) => {
    setViewing(e); setPickerOpen(false)
    // The picker's entry becomes the view's: one Back from a team member returns to your portal.
    if (window.history.state?.ezOverlay) window.history.replaceState({ ezOverlay: 'view' }, '', window.location.href)
    else window.history.pushState({ ezOverlay: 'view' }, '', window.location.href)
  }
  const closeOverlay = useCallback(() => {
    if (window.history.state?.ezOverlay) window.history.back()
    else { setPickerOpen(false); setViewing(null) }
  }, [])
  useEffect(() => {
    const onPop = () => {
      const o = window.history.state?.ezOverlay
      if (o !== 'view') setViewing(null)
      if (o !== 'picker') setPickerOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const overlayOpen = pickerOpen || !!viewing
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && pickerOpen) closeOverlay() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen, pickerOpen, closeOverlay])

  if (!mounted || !session) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TK.canvas, fontFamily: '"DM Sans","Segoe UI",sans-serif', color: TK.muted, fontSize: 14 }}>Loading your portal…</div>
  }

  const canViewOthers = !!scope?.canViewOthers
  const list = (scope?.employees || []).filter(e => !q || e.full_name.toLowerCase().includes(q.toLowerCase()) || e.emp_code.toLowerCase().includes(q.toLowerCase()))

  // When viewing another employee, render their portal in adminMode with a return-to-self exit.
  if (viewing) {
    return (
      <div>
        {/* Sticky so the way back is on screen however far down the member's portal you scroll. */}
        <div style={{ position: 'sticky', top: 0, zIndex: Z.sticky, background: TK.dark, color: TK.onDark, padding: '9px 12px 9px 18px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: TK.warning, color: TK.ink, fontWeight: 700 }}>{scope?.scope} VIEW</span>
          <span style={{ minWidth: 0 }}>Viewing <b>{viewing.full_name}</b> · {viewing.emp_code}{viewing.designation ? ` · ${viewing.designation}` : ''}</span>
          <button onClick={closeOverlay} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: TK.onDark, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>← Back to my portal</button>
          <button onClick={closeOverlay} aria-label="Close team member view" title="Close" style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: TK.onDark, cursor: 'pointer', fontSize: 17, lineHeight: 1, fontFamily: 'inherit', display: 'grid', placeItems: 'center' }}>×</button>
        </div>
        <EmployeePortal employeeId={viewing.id} adminMode onExit={closeOverlay} />
      </div>
    )
  }

  // "View a team member" lives in the portal's top bar now. It was a full-width banner above
  // the whole portal that spelled out every role ("HR Manager, HR Head, Admin (Company),
  // HOD, …") — five lines on a phone, on every screen. The roles are still one hover away
  // (the button's tooltip) and are shown in full at the top of the picker.
  const accessLine = scope ? `${scope.roleNames.join(', ')} access (${scope.scope.toLowerCase()}) · ${scope.employees.length} team member${scope.employees.length === 1 ? '' : 's'}` : ''
  const viewOthers = canViewOthers ? (
    <button type="button" onClick={openPicker} title={accessLine}
      style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 13px', borderRadius: 10, border: `1px solid ${TK.line}`, background: TK.surface, color: TK.ink, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ color: TK.brand, display: 'flex' }}><IconEmployees size={16} /></span>View team member
    </button>
  ) : null

  return (
    <div>
      {/* urlSync: this portal — and only this one — owns the address bar */}
      <EmployeePortal employeeId={session.employee_id} onExit={onExit} urlSync headerExtra={viewOthers} exitLabel="Sign out" />

      {pickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: '"DM Sans","Segoe UI",sans-serif' }} onClick={closeOverlay}>
          <div role="dialog" aria-modal="true" aria-label="Open a team member's portal" style={{ background: TK.surface, borderRadius: 14, padding: 18, maxWidth: 480, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: TK.ink }}>Open a team member&apos;s portal</div>
              <button type="button" onClick={closeOverlay} aria-label="Close" title="Close (Esc)" style={{ width: 28, height: 28, marginTop: -4, marginRight: -6, borderRadius: 7, border: 'none', background: 'transparent', color: TK.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, display: 'grid', placeItems: 'center', fontFamily: 'inherit' }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: TK.muted, marginBottom: 12, lineHeight: 1.5 }}>{accessLine}</div>
            <input autoFocus placeholder="Search name or code…" value={q} onChange={e => setQ(e.target.value)} style={{ padding: '9px 12px', border: `1px solid ${TK.line}`, borderRadius: 10, fontSize: 13, background: TK.sunken, outline: 'none', marginBottom: 10, fontFamily: 'inherit' }} />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {list.map(e => (
                <div key={e.id} onClick={() => openMember(e)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', borderBottom: `1px solid ${TK.line}` }} onMouseEnter={ev => (ev.currentTarget.style.background = TK.canvas)} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: TK.brandTint, color: TK.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{e.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: TK.ink }}>{e.full_name}</div><div style={{ fontSize: 11, color: TK.muted }}>{e.emp_code}{e.designation ? ` · ${e.designation}` : ''}{e.dept_name ? ` · ${e.dept_name}` : ''}</div></div>
                </div>
              ))}
              {!list.length && <div style={{ padding: 20, textAlign: 'center', color: TK.muted, fontSize: 13 }}>No matching employees.</div>}
            </div>
            <div style={{ textAlign: 'right', marginTop: 10 }}><button onClick={closeOverlay} style={{ padding: '8px 14px', background: TK.surface, color: TK.ink, border: `1px solid ${TK.line}`, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
