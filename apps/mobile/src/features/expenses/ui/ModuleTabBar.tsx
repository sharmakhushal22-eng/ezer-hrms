// src/features/expenses/ui/ModuleTabBar.tsx — the module's own bottom bar (TeHome .tabbar)
// plus the "More" menu the phone needs to reach the desktop rail's other items.
//
// Website (≤860px): Home | Expenses (red dot if unclaimed) | (+) New claim |
// Claims (dot if any SENT_BACK; active on claims and claim) | ESS (onExit).
// On a phone the web has no way to Trips, Advances, My limits and rates or
// Approvals except through links (spec 2.1 "Gap"). So the fifth button here is
// "More": Trips, Approvals (n, only when the queue is non-empty), Advances,
// My limits and rates — the rail, in its order — and "Back to ESS" (onExit).
// Since 4a92155 the rail also has "Reports and dashboard" (everyone) and, under
// everything personal, "Travel desk" / "Finance desk" — offered only to members
// of that desk (useDeskAccess: the probe call succeeding IS the permission;
// hidden, never greyed out).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { TeIcon } from './TeIcon'
import { exitModule, open, swap, teHref, toHome } from '../nav'
import { homeFigures, useDeskAccess, useQueue, useSnap } from '../data'

/** Which top-level view a screen is. */
export type TopView = 'home' | 'expenses' | 'claims' | 'trips' | 'advances' | 'limits' | 'approvals' | 'dashboard' | 'traveldesk' | 'financedesk'

const HREF: Record<TopView, string> = {
  home: teHref.home, expenses: teHref.other, claims: teHref.claims, trips: teHref.trips,
  advances: teHref.advances, limits: teHref.limits, approvals: teHref.approvals,
  dashboard: teHref.dashboard, traveldesk: teHref.travelDesk, financedesk: teHref.financeDesk,
}
const MORE_VIEWS: TopView[] = ['trips', 'advances', 'limits', 'approvals', 'dashboard', 'traveldesk', 'financedesk']

/** The rail and the tab bar both land on a view. From Home it is pushed (Back returns
 *  Home); between the other top-level views it replaces, so Back never walks through
 *  every tab the person tapped. */
export function goTop(target: TopView, from: TopView) {
  if (target === from) return
  if (target === 'home') return toHome()
  if (from === 'home') open(HREF[target])
  else swap(HREF[target])
}

function TabBtn({ label, icon, active, dot, onPress }: { label: string; icon: string; active?: boolean; dot?: boolean; onPress: () => void }) {
  const { C } = useTheme()
  const fg = active ? C.brand : C.muted
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2, minHeight: 52, paddingVertical: 4 }}>
      <View>
        <TeIcon name={icon} color={fg} />
        {dot && <View style={{ position: 'absolute', top: -2, right: -6, width: 7, height: 7, borderRadius: 4, backgroundColor: C.critical }} />}
      </View>
      <Txt size={10.5} w={600} color={fg} numberOfLines={1}>{label}</Txt>
    </Pressable>
  )
}

function MoreRow({ label, icon, count, onPress, active }: { label: string; icon: string; count?: number; onPress: () => void; active?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 52, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
      <TeIcon name={icon} color={active ? C.brand : C.inkSoft} />
      <Txt size={F.body} w={600} color={active ? C.brand : C.ink} style={{ flex: 1 }}>{label}</Txt>
      {!!count && (
        <View style={{ minWidth: 22, paddingHorizontal: 7, height: 22, borderRadius: 11, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={11} w={700} tone="brand">{count}</Txt>
        </View>
      )}
    </Pressable>
  )
}

export function ModuleTabBar({ active }: { active: TopView | 'claim' | null }) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const snap = useSnap().data
  const queue = useQueue().data ?? []
  const desks = useDeskAccess()
  const [more, setMore] = React.useState(false)
  const f = snap ? homeFigures(snap) : null
  const from: TopView = active === 'claim' || active === null ? 'claims' : active
  const go = (t: TopView) => { setMore(false); goTop(t, active === null ? 'home' : from) }
  const onMore = !!active && MORE_VIEWS.includes(active as TopView)

  return (
    <>
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line,
        paddingHorizontal: 6, paddingTop: 4, paddingBottom: insets.bottom + 4,
      }}>
        <TabBtn label="Home" icon="home" active={active === 'home'} onPress={() => go('home')} />
        <TabBtn label="Expenses" icon="other" active={active === 'expenses'} dot={!!f?.unclaimed.length} onPress={() => go('expenses')} />
        <Pressable onPress={() => open(teHref.newClaim)} accessibilityRole="button" accessibilityLabel="New claim"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2, minHeight: 52, paddingVertical: 4 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: -24, borderWidth: 3, borderColor: C.surface, ...elevation(C, 3) }}>
            <TeIcon name="plus" color={C.onAccent} />
          </View>
          <Txt size={10.5} w={600} tone="brand">New claim</Txt>
        </Pressable>
        <TabBtn label="Claims" icon="claims" active={active === 'claims' || active === 'claim'} dot={!!f?.sentBack.length} onPress={() => go('claims')} />
        <TabBtn label="More" icon="more" active={onMore} onPress={() => setMore(true)} />
      </View>
      <Sheet visible={more} onClose={() => setMore(false)} title="Travel and Expenses">
        <MoreRow label="Trips" icon="local" active={active === 'trips'} onPress={() => go('trips')} />
        {queue.length > 0 && <MoreRow label="Approvals" icon="check" count={queue.length} active={active === 'approvals'} onPress={() => go('approvals')} />}
        <MoreRow label="Advances" icon="advances" active={active === 'advances'} onPress={() => go('advances')} />
        <MoreRow label="My limits and rates" icon="limits" active={active === 'limits'} onPress={() => go('limits')} />
        <MoreRow label="Reports and dashboard" icon="history" active={active === 'dashboard'} onPress={() => go('dashboard')} />
        {desks.travel && <MoreRow label="Travel desk" icon="plane" active={active === 'traveldesk'} onPress={() => go('traveldesk')} />}
        {desks.finance && <MoreRow label="Finance desk" icon="claims" active={active === 'financedesk'} onPress={() => go('financedesk')} />}
        <MoreRow label="Back to ESS" icon="back" onPress={() => { setMore(false); exitModule() }} />
        <View style={{ height: S.sm, borderRadius: R.sm }} />
      </Sheet>
    </>
  )
}
