'use client'
// app/offer-approve/[id]/client.tsx — opens one offer-approval request for the HR Head.
// Reached from the notification in ESS Tasks & Approvals or the approval mail. Uses the
// employee's ESS localStorage session; OfferApprovals in focus mode opens the review popup
// directly, with Approve / Reject.
import { useEffect, useState } from 'react'
import { OfferApprovals } from '@/components/ess/RoleTabs'
import { C } from '@/lib/ui'

const font = '"DM Sans","Segoe UI",sans-serif'

export default function OfferApproveClient({ id }: { id: string }) {
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [toast, setToast] = useState<{ m: string; t: 'success' | 'error' } | null>(null)

  useEffect(() => {
    let emp: string | null = null
    try { const raw = localStorage.getItem('ezer_ess_session'); if (raw) { const o = JSON.parse(raw); if (o?.employee_id) emp = o.employee_id } } catch { emp = null }
    if (!emp) { window.location.href = `/ess-login?next=${encodeURIComponent(`/offer-approve/${id}`)}`; return }
    setEmployeeId(emp); setReady(true)
  }, [id])

  const notify = (m: string, t: 'success' | 'error' = 'success') => { setToast({ m, t }); setTimeout(() => setToast(null), 3200) }
  const goBack = () => { window.location.href = '/ess-portal?tab=approvals' }

  if (!ready || !employeeId) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.canvas, fontFamily: font, color: C.muted, fontSize: 14 }}>Loading offer…</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: C.canvas, fontFamily: font }}>
      <div style={{ background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={goBack} style={{ padding: '6px 13px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: C.onAccent, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>← Tasks &amp; Approvals</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Offer Approval</div>
      </div>
      <div style={{ maxWidth: 760, margin: '18px auto', padding: '0 14px' }}>
        <OfferApprovals employeeId={employeeId} notify={notify} focusId={id} onDone={goBack} />
      </div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, background: toast.t === 'error' ? C.critical : C.positive, color: C.onAccent, padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: font, boxShadow: '0 8px 24px rgba(30,27,75,.3)' }}>{toast.m}</div>
      )}
    </div>
  )
}
