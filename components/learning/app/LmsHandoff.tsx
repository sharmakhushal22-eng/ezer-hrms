'use client'
// components/learning/app/LmsHandoff.tsx — what /learning shows inside HRMS once Learning has its
// own domain: a moment's "Opening EZER Learn" while lib/lms/sso-client.ts fetches a hand-off code
// and leaves for the same screen there.
import { useEffect } from 'react'
import { handOffToLms } from '@/lib/lms/sso-client'
import { GBook } from '../glyphs'

export default function LmsHandoff() {
  useEffect(() => { void handOffToLms() }, [])
  return (
    <div className="ezl"><div className="lx-gate">
      <div className="lx-gate-box lx-in" role="status" aria-live="polite">
        <div className="lx-brand-mark" style={{ width: 56, height: 56, borderRadius: 18 }}><span style={{ width: 46, height: 46, borderRadius: 14 }}><GBook size={24} /></span></div>
        <h1 className="lx-display" style={{ fontSize: 24 }}>Opening EZER Learn…</h1>
        <p style={{ color: 'var(--ez-muted)', lineHeight: 1.6, fontSize: 14.5 }}>You stay signed in. Learning opens on its own site.</p>
      </div>
    </div></div>
  )
}
