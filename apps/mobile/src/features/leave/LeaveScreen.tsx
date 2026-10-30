// src/features/leave/LeaveScreen.tsx — the Leave tab: the website's portal
// section `leave` (components/ess/LeaveSection.tsx), stacked for a phone:
// balance hero → Apply for leave → Your requests → Upcoming holidays.
//
// The tab owns its ScrollView (TabScreen scroll={false}) because the hero's
// "Apply for leave" button scrolls to the Apply panel, and Screen does not
// expose its scroll ref. The heading below mirrors TabScreen's own markup.
import * as React from 'react'
import { RefreshControl, ScrollView, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TabScreen } from '@/features/shell/TabScreen'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Notice, Txt } from '@/ui/primitives'
import { useLeave } from './data'
import { BalanceHero } from './BalanceHero'
import { ApplyPanel } from './ApplyPanel'
import { RequestsPanel } from './RequestsPanel'
import { HolidaysPanel } from './HolidaysPanel'
import { dayRules, earliestApplyDate, iso } from './logic'

const HEADING = 'Leave'
const DESC = 'Apply for leave, track your requests and plan around holidays'

function Heading() {
  return (
    <View style={{ marginBottom: S.lg }}>
      <Txt size={F.page} w={700}>{HEADING}</Txt>
      <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{DESC}</Txt>
    </View>
  )
}

function Skeleton() {
  const { C } = useTheme()
  const block = { backgroundColor: C.sunken, borderRadius: R.card, marginBottom: S.md }
  return (
    <View accessibilityLabel="Loading your leave…" accessibilityState={{ busy: true }}>
      <View style={[block, { height: 190 }]} />
      <View style={[block, { height: 320 }]} />
      <View style={[block, { height: 160 }]} />
      <Txt size={F.small} tone="muted" center>Loading your leave…</Txt>
    </View>
  )
}

export default function LeaveScreen() {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const q = useLeave()
  const data = q.data
  const [busy, setBusy] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const scrollRef = React.useRef<ScrollView>(null)
  const applyY = React.useRef(0)

  const today = iso(new Date())
  const floor = earliestApplyDate(data?.backdate_days)
  const rules = React.useMemo(() => dayRules(data, today), [data, today])
  const upcoming = React.useMemo(() => (data?.holidays || []).filter(h => h.holiday_date >= today), [data, today])

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try { await q.refetch() } finally { setRefreshing(false) }
  }, [q])

  let body: React.ReactNode
  if (q.error && !data) {
    body = (
      <View style={{ gap: S.md }}>
        <Notice tone="critical">{(q.error as Error)?.message || 'Could not load leave.'}</Notice>
        <Button title="Try again" variant="outline" onPress={() => q.refetch()} />
      </View>
    )
  } else if (!data) {
    body = <Skeleton />
  } else {
    body = (
      <>
        <BalanceHero data={data} onApply={() => scrollRef.current?.scrollTo({ y: Math.max(0, applyY.current - S.sm), animated: true })} />
        <View onLayout={(e: LayoutChangeEvent) => { applyY.current = e.nativeEvent.layout.y }}>
          <ApplyPanel data={data} rules={rules} today={today} floor={floor} busy={busy} setBusy={setBusy} />
        </View>
        <RequestsPanel applications={data.applications || []} today={today} busy={busy} setBusy={setBusy} />
        <HolidaysPanel upcoming={upcoming} today={today} noHolidays={!!data.diagnostics?.noHolidays} />
      </>
    )
  }

  return (
    <TabScreen scroll={false} padded={false}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: S.lg, paddingBottom: 96 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} />}>
        <Heading />
        {body}
      </ScrollView>
    </TabScreen>
  )
}
