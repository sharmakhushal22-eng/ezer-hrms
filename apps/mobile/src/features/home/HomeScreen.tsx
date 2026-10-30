// src/features/home/HomeScreen.tsx — Home (the website's Today tab,
// components/ess/today/Today.tsx) at phone width.
//
// ONE payload: GET /api/ess/today. Refetched whenever the app comes back to the
// foreground (global, src/core/query.ts) and after every punch. On the first
// successful load its saved preferences are applied — theme 'auto' becomes the
// app's 'system' — and PUT back, exactly as the website does.
//
// Order as on the website, single column (≤900px): HeroPanel (with PunchDial) →
// StatTiles → This week, Pending on you, Quick actions, My journey → Team today,
// next holiday, Birthdays & anniversaries, New joiners, Recognition, Announcements.
// The phone Home opens with the feature search, as the website's does.
import * as React from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { invalidate } from '@/core/query'
import { useEmployeeId } from '@/core/session'
import { FeatureSearch } from '@/features/shell/FeatureSearch'
import { TabScreen } from '@/features/shell/TabScreen'
import { useTheme } from '@/ui/ThemeProvider'
import { Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { todayKey, usePrefs, useToday, type PunchStateLite, type TodayPayload } from './data'
import { HeroPanel, heroTheme } from './HeroPanel'
import { PunchDial } from './PunchDial'
import { StatTiles } from './StatTiles'
import { WeekStrip } from './WeekStrip'
import { HolidayCard, Journey, PendingList, QuickActions, TeamToday } from './Cards'
import { Announcements, Celebrations, NewJoiners, RecognitionCard } from './Community'
import { HomeCard } from './kit'

export default function HomeScreen() {
  const { isDark } = useTheme()
  const employeeId = useEmployeeId()
  const qc = useQueryClient()
  const { notify } = useOverlay()
  const q = useToday()
  const { prefs, update } = usePrefs()
  const data = q.data

  // First successful load: adopt the saved prefs (Today.tsx `if (first && j.prefs) update(j.prefs)`).
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (data && !applied.current) { applied.current = true; if (data.prefs) update(data.prefs) }
  }, [data, update])

  const toast = React.useCallback((m: string, kind: 'success' | 'error' = 'success') => notify(m, kind), [notify])
  const setToday = (fn: (d: TodayPayload) => TodayPayload['today']) =>
    qc.setQueryData<TodayPayload>(todayKey(employeeId), d => (d ? { ...d, today: fn(d) } : d))

  const onState = (st: PunchStateLite) => setToday(d => ({ punch_in: st.first_in, punch_out: st.open ? null : st.last_out, open: st.open, last_in: st.last_in, work_mode: d.today?.work_mode ?? null }))
  const onPunched = (kind: 'in' | 'out', at: Date) => {
    // The first IN of the day stays the day's start; a second IN after an OUT reopens the day without moving it.
    setToday(d => kind === 'in'
      ? { punch_in: d.today?.punch_in ?? at.toISOString(), punch_out: null, open: true, last_in: at.toISOString(), work_mode: 'office' }
      : { ...(d.today ?? { punch_in: null, work_mode: null }), punch_out: at.toISOString(), open: false })
    void invalidate('today', 'attendance')
  }

  const t0 = data?.today
  const isOpen = t0?.open ?? !!(t0?.punch_in && !t0?.punch_out)
  const liveIn = isOpen && t0?.punch_in ? new Date(t0.punch_in) : null
  const h = new Date().getHours()
  const hero = heroTheme(isDark, h >= 17 || h < 6 ? 'evening' : h >= 12 ? 'afternoon' : '')

  return (
    <TabScreen onRefresh={() => Promise.all([q.refetch(), invalidate('attendance')])}>
      <FeatureSearch />
      {!data ? (
        q.error ? (
          <HomeCard><Txt size={14}>Could not load Today: {q.error instanceof Error ? q.error.message : String(q.error)}</Txt></HomeCard>
        ) : (
          <HomeCard style={{ height: 320, opacity: 0.5 }}><View /></HomeCard>
        )
      ) : (
        <>
          <HeroPanel data={data} prefs={prefs} onPrefs={update}>
            <PunchDial data={data} prefs={prefs} hero={hero} onToast={toast} onState={onState} onPunched={onPunched} />
          </HeroPanel>
          <StatTiles data={data} />
          <WeekStrip data={data} prefs={prefs} liveIn={liveIn} />
          <PendingList data={data} prefs={prefs} />
          <QuickActions />
          <Journey data={data} prefs={prefs} />
          <TeamToday data={data} />
          <HolidayCard data={data} />
          <Celebrations data={data} onToast={toast} />
          <NewJoiners data={data} onToast={toast} />
          <RecognitionCard data={data} />
          <Announcements data={data} />
        </>
      )}
    </TabScreen>
  )
}
