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
      {/* Header — the shared band. Was a navy-to-blue gradient with white text
          and a white-on-translucent segmented control; both only worked
          against a saturated ground. */}
      <div style={{ padding: '16px 24px 0' }}>
        <div style={{ maxWidth: 940, margin: '0 auto' }}>
          <div className="ez-page-head" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, flexShrink: 0 }}></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: TK.ink }}>HR Letters</div>
              <div style={{ fontSize: 13, color: TK.muted, marginTop: 2 }}>Configure letterheads &amp; signatories once, then draft and issue HR letters on branded stationery.</div>
            </div>
          </div>
          {/* Tabs — the same outlined pills the other modules use */}
          <div style={{ display: 'flex', gap: 6, paddingBottom: 14, flexWrap: 'wrap' }}>
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button key={t.id} onClick={() => !t.soon && setTab(t.id)} disabled={t.soon}
                  className="ez-tab" data-on={active ? '1' : '0'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8,
                    border: `1px solid ${active ? TK.brand : TK.line}`,
                    background: active ? TK.brand : 'transparent',
                    color: active ? TK.onAccent : TK.muted,
                    fontSize: 13, fontWeight: 600, cursor: t.soon ? 'not-allowed' : 'pointer', fontFamily: font,
                    whiteSpace: 'nowrap', opacity: t.soon ? 0.55 : 1 }}>
                  <span>{t.icon}</span>{t.label}
                  {t.soon && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: TK.sunken, color: TK.muted, letterSpacing: '.04em' }}>SOON</span>}
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
