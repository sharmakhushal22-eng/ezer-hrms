'use client'
// components/payroll/SalaryCalculatorPanel.tsx — Payroll → Dashboard → Salary calculator.
//
// The Automated CTC Calculator from Recruitment → Negotiation, the same one Help → TDS
// Calculator shows (components/recruitment/CtcBreakupCalculator): annual CTC and variable in,
// the whole salary breakdown out, on the same model (computeCtc), statement rows and
// minimum-wage master. Only a calculator: nothing is looked up, saved or sent.
//
// A full-screen panel drawn through a portal onto document.body: the payroll page sits under
// transform-animated wrappers, and position:fixed inside a transformed ancestor anchors to
// that ancestor instead of the screen (see MonthSync's EmployeePicker).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { C, F, W, R, E, S, Z } from '@/lib/ui'

const CtcBreakupCalculator = dynamic(() => import('@/components/recruitment/CtcBreakupCalculator'), {
  ssr: false,
  loading: () => <div style={{ padding: S.huge, textAlign: 'center', color: C.muted, fontSize: F.small }}>Loading the calculator…</div>,
})

/** The dashboard's button: opens the calculator panel. */
export function SalaryCalculatorButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="ez-press" onClick={() => setOpen(true)} style={{
        display: 'inline-flex', alignItems: 'center', gap: S.sm, height: 36, padding: `0 ${S.lg}px`,
        borderRadius: R.md, border: `1px solid ${C.brandDeep}`, cursor: 'pointer', fontFamily: 'inherit',
        background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent,
        fontSize: F.small, fontWeight: W.semi, boxShadow: E.brand, whiteSpace: 'nowrap',
      }}>
        <CalcIcon /> Salary calculator
      </button>
      {open && <SalaryCalculatorPanel onClose={() => setOpen(false)} />}
    </>
  )
}

function CalcIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <rect x="7.5" y="6" width="9" height="3.5" rx="1" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" strokeWidth={2.4} />
    </svg>
  )
}

export default function SalaryCalculatorPanel({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // The page behind must not scroll with the panel, and Esc closes it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  if (!mounted) return null
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Salary calculator" style={{
      position: 'fixed', inset: 0, zIndex: Z.modal, background: C.canvas,
      display: 'flex', flexDirection: 'column', fontFamily: F.family, color: C.ink,
    }}>
      <div style={{ flexShrink: 0, background: C.surface, borderBottom: `1px solid ${C.line}`, boxShadow: E.flat }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: `${S.md}px ${S.xl}px`, display: 'flex', alignItems: 'center', gap: S.md }}>
          <div style={{ width: 40, height: 40, borderRadius: R.md, background: C.brandTint, border: `1px solid ${C.brandEdge}`, color: C.brand, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <CalcIcon size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: F.lead, fontWeight: W.bold, letterSpacing: '-.01em' }}>Salary calculator</div>
            <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>
              The calculator from Recruitment → Negotiation: CTC and variable in, the full salary breakup out. Nothing here is saved.
            </div>
          </div>
          <button onClick={onClose} className="ez-press" aria-label="Close the salary calculator" style={{
            height: 34, padding: `0 ${S.md}px`, borderRadius: R.md, border: `1px solid ${C.lineStrong}`,
            background: C.surface, color: C.ink, fontSize: F.small, fontWeight: W.medium, fontFamily: 'inherit',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: E.flat,
          }}>
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>×</span> Close
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: `${S.lg}px ${S.xl}px ${S.huge}px` }}>
          <CtcBreakupCalculator bare />
        </div>
      </div>
    </div>,
    document.body,
  )
}
