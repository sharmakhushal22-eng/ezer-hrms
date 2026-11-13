'use client'
// components/analytics/EssInsights.tsx — the ESS "Insights" section.
//
// Everyone gets My insights. Anyone with direct reports or a department adds My team.
// One section, two audiences, decided from the reporting line (the menu flags), not
// from a role code — the same rule Performance and Team follow.

import * as React from 'react'
import dynamic from 'next/dynamic'
import { C, F, W, S, R } from '@/lib/ui'

const MyInsights = dynamic(() => import('./MyInsights'), { ssr: false })
const TeamInsights = dynamic(() => import('./TeamInsights'), { ssr: false })

export default function EssInsights({ employeeId, isManager }: { employeeId: string; isManager: boolean }) {
  const [tab, setTab] = React.useState<'me' | 'team'>('me')
  return (
    <div style={{ fontFamily: F.family }}>
      {/* The portal already titles the section, so this row carries only the scope. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap', marginBottom: S.lg }}>
        <div style={{ fontSize: F.small, color: C.muted }}>
          {tab === 'me' ? 'Your attendance, leave, pay, reviews and learning. Only you can see this page.' : 'Your team this month, and what needs your attention.'}
        </div>
        {isManager && (
          <div role="tablist" style={{ display: 'inline-flex', gap: 2, padding: 3, background: C.sunken, borderRadius: R.md }}>
            {([['me', 'My insights'], ['team', 'My team']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="ez-press" style={{
                border: 'none', borderRadius: R.sm, padding: '7px 14px', fontSize: F.small, fontFamily: 'inherit', cursor: 'pointer',
                background: tab === k ? C.surface : 'transparent', color: tab === k ? C.brandDeep : C.muted, fontWeight: tab === k ? W.semi : W.medium,
              }}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {tab === 'me' || !isManager ? <MyInsights employeeId={employeeId} /> : <TeamInsights employeeId={employeeId} />}
    </div>
  )
}
