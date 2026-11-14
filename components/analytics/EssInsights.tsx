'use client'
// components/analytics/EssInsights.tsx — the ESS "Insights" section.
//
// Everyone gets My insights. Anyone with direct reports or a department adds My team.
// Anyone HR has given the organisation view (People Analytics → Manage access, or a
// reporting role) adds Organisation — the same screen as the dashboard's People
// Analytics, limited to the slice they were given. A site manager with no dashboard
// access finds their site's analytics here.

import * as React from 'react'
import dynamic from 'next/dynamic'
import { C, F, W, S, R } from '@/lib/ui'
import { api } from '@/lib/ess/api'

const MyInsights = dynamic(() => import('./MyInsights'), { ssr: false })
const TeamInsights = dynamic(() => import('./TeamInsights'), { ssr: false })
const OrgAnalytics = dynamic(() => import('./OrgAnalytics'), { ssr: false })

type View = 'me' | 'team' | 'org'

const BLURB: Record<View, string> = {
  me: 'Your attendance, leave, pay, reviews and learning. Only you can see this page.',
  team: 'Your team this month, and what needs your attention.',
  org: 'People Analytics for the part of the organisation HR has given you.',
}

export default function EssInsights({ employeeId, isManager }: { employeeId: string; isManager: boolean }) {
  const [tab, setTab] = React.useState<View>('me')
  const [org, setOrg] = React.useState(false)
  React.useEffect(() => {
    let live = true
    api('/api/analytics/access', employeeId).then(b => { if (live) setOrg(!!(b as { org?: boolean }).org) }, () => { /* no org view */ })
    return () => { live = false }
  }, [employeeId])

  const views: [View, string][] = [['me', 'My insights'], ...(isManager ? [['team', 'My team'] as [View, string]] : []), ...(org ? [['org', 'Organisation'] as [View, string]] : [])]
  const view: View = views.some(v => v[0] === tab) ? tab : 'me'
  return (
    <div style={{ fontFamily: F.family }}>
      {/* The portal already titles the section, so this row carries only the scope. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap', marginBottom: S.lg }}>
        <div style={{ fontSize: F.small, color: C.muted }}>{BLURB[view]}</div>
        {views.length > 1 && (
          <div role="tablist" style={{ display: 'inline-flex', gap: 2, padding: 3, background: C.sunken, borderRadius: R.md }}>
            {views.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setTab(k)} className="ez-press" style={{
                border: 'none', borderRadius: R.sm, padding: '7px 14px', fontSize: F.small, fontFamily: 'inherit', cursor: 'pointer',
                background: view === k ? C.surface : 'transparent', color: view === k ? C.brandDeep : C.muted, fontWeight: view === k ? W.semi : W.medium,
              }}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {view === 'me' && <MyInsights employeeId={employeeId} />}
      {view === 'team' && <TeamInsights employeeId={employeeId} />}
      {view === 'org' && <OrgAnalytics />}
    </div>
  )
}
