// src/features/expenses/ui/TeScreen.tsx — the frame every T&E view sits in.
//
//   · the stack header (title, Back = Android back), or a custom `top`;
//   · TeLiveBar on every view except a journey's own screen, while one of my
//     journeys is ACTIVE or PAUSED (TeHome);
//   · the module's bottom bar on the top-level views (`tab`);
//   · pull-to-refresh = the website's reload(): the snapshot, the queue and
//     every open detail are read again.
//
// SnapScreen adds the snapshot gate TeHome has before `snap` exists: a card with
// "Loading Travel and Expenses…" or the error, and "Try again".
import * as React from 'react'
import { View } from 'react-native'
import type { Snapshot } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { errorText } from '../api'
import { homeFigures, placeNameOf, refetchTe, useSnap } from '../data'
import { open, teHref } from '../nav'
import { LiveBar } from './LiveBar'
import { ModuleTabBar, type TopView } from './ModuleTabBar'
import { TeCard } from './kit'

export interface TeScreenProps {
  title?: string
  subtitle?: string
  /** The module bottom bar, with this view marked active. Omit on detail screens. */
  tab?: TopView | 'claim'
  /** Show TeLiveBar (default true). The leg screens pass false. */
  live?: boolean
  back?: boolean
  onBack?: () => void
  right?: React.ReactNode
  top?: React.ReactNode
  footer?: React.ReactNode
  /** Extra refetches on pull-to-refresh, besides the module's own queries. */
  onRefresh?: () => Promise<unknown> | void
  scroll?: boolean
  children: React.ReactNode
}

export function TeScreen({ title, subtitle, tab, live = true, back = true, onBack, right, top, footer, onRefresh, scroll, children }: TeScreenProps) {
  const snap = useSnap().data
  const liveLeg = live && snap ? homeFigures(snap).liveLeg : null
  const refresh = React.useCallback(async () => { await Promise.all([refetchTe(), onRefresh?.()]) }, [onRefresh])
  return (
    <View style={{ flex: 1 }}>
      <Screen title={title} subtitle={subtitle} back={back} onBack={onBack} right={right} top={top} footer={footer}
        onRefresh={refresh} tabBar={false} scroll={scroll}>
        {liveLeg && snap && (
          <LiveBar leg={liveLeg} tripName={snap.trips.find(t => t.id === liveLeg.tripId)?.name ?? ''}
            placeName={id => placeNameOf(snap)(id)}
            onOpen={leg => open(teHref.leg(leg.id, leg.tripId))} />
        )}
        {children}
      </Screen>
      {tab && <ModuleTabBar active={tab} />}
    </View>
  )
}

/** The loading / error card TeHome shows before the snapshot arrives. */
export function SnapState({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const { C } = useTheme()
  return (
    <TeCard>
      <Txt size={F.small} color={C.muted}>{error ? errorText(error) : 'Loading Travel and Expenses…'}</Txt>
      {!!error && <View style={{ marginTop: S.md }}><Button title="Try again" variant="outline" size="sm" onPress={onRetry} /></View>}
    </TeCard>
  )
}

/** A TeScreen that renders its body only once the snapshot is in. */
export function SnapScreen({ children, ...p }: Omit<TeScreenProps, 'children'> & { children: (snap: Snapshot) => React.ReactNode }) {
  const q = useSnap()
  return (
    <TeScreen {...p}>
      {q.data ? children(q.data) : <SnapState error={q.error} onRetry={() => void q.refetch()} />}
    </TeScreen>
  )
}
