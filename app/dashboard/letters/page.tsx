'use client'
// app/dashboard/letters/page.tsx — HR Letters section.
// Tab 1 (built): Letterhead & Signatory configuration (Group → Company → Branch cascade).
// Future tabs (templates, generate & issue) will compose letters onto the resolved letterhead.
import { useState } from 'react'
import LetterheadConfig from '@/components/letters/LetterheadConfig'
import LetterTemplates from '@/components/letters/LetterTemplates'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = { bg: TK.canvas, navy: TK.ink, purple: TK.brand, border: TK.line, muted: TK.muted }
const font = '"DM Sans","Segoe UI",sans-serif'

const TABS: { id: string; label: string; icon: string; soon?: boolean }[] = [
  { id: 'letterhead', label: 'Letterhead & Signatory', icon: '' },
  { id: 'letters', label: 'Design & Generate Letters', icon: '' },
]

export default function LettersPage() {
  const [tab, setTab] = useState('letterhead')
  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: font, color: C.navy }}>
      {/* Gradient header banner */}
      <div style={{ background: `linear-gradient(120deg,${TK.ink} 0%,${TK.brand} 55%,${TK.brand} 100%)`, padding: '22px 24px 20px', color: TK.onAccent }}>
        <div style={{ maxWidth: 940, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: `color-mix(in srgb, ${TK.onAccent} 16%, transparent)`, border: `1px solid ${TK.onAccentDim}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, flexShrink: 0 }}></div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>HR Letters</div>
              <div style={{ fontSize: 12.5, color: TK.onAccentSoft, marginTop: 2 }}>Configure letterheads &amp; signatories once, then draft and issue HR letters on branded stationery.</div>
            </div>
          </div>
          {/* Segmented tabs */}
          <div style={{ display: 'inline-flex', gap: 4, marginTop: 16, background: `color-mix(in srgb, ${TK.onAccent} 16%, transparent)`, border: `1px solid ${TK.onAccentDim}`, borderRadius: 11, padding: 4, flexWrap: 'wrap' }}>
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button key={t.id} onClick={() => !t.soon && setTab(t.id)} disabled={t.soon}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 15px', borderRadius: 8, border: 'none', background: active ? TK.surface : 'transparent', color: active ? C.purple : `${TK.onAccentSoft}`, fontSize: 12.5, fontWeight: 600, cursor: t.soon ? 'not-allowed' : 'pointer', fontFamily: font, whiteSpace: 'nowrap', opacity: t.soon ? 0.55 : 1, boxShadow: active ? '0 2px 8px rgba(0,0,0,0.18)' : 'none' }}>
                  <span>{t.icon}</span>{t.label}
                  {t.soon && <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: `color-mix(in srgb, ${TK.onAccent} 16%, transparent)`, letterSpacing: '.04em' }}>SOON</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        {tab === 'letterhead' && <LetterheadConfig />}
        {tab === 'letters' && <LetterTemplates />}
      </div>
    </div>
  )
}
