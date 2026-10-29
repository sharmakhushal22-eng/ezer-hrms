// src/features/attendance/AttendanceScreen.tsx — the Attendance tab.
// components/ess/EmployeePortal.tsx AttendanceModule, top to bottom:
//   (A) MonthHero · (B) stat tiles · (C) calendar · (D) day panel / donut
//   (E) single-day regularisation form · (F) attendance log · (G) my requests
// On the phone C and D stack (the website's mobile layout wraps them too).
import * as React from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TabScreen } from '@/features/shell/TabScreen'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { Button, Card, Notice } from '@/ui/primitives'
import { afterChange, useMonth, useRegularisations, withdrawRegularisation } from './api'
import { monthStats, resolveDay, ymdLocal, type RegularisationRequest } from './model'
import { MonthHero, SummaryTiles } from './MonthHero'
import { AttendanceCalendar, CalendarShimmer } from './Calendar'
import { DayDetailPanel, DayPanelResting } from './DayPanel'
import { RegularisationForm } from './RegularisationForm'
import { RegularisationList } from './RegularisationList'
import { AttendanceLog, SelectionBar, useLogController } from './AttendanceLog'
import { ReviewSheet } from './ReviewSheet'

export default function AttendanceScreen() {
  const employeeId = useEmployeeId()
  const insets = useSafeAreaInsets()
  const [month, setMonth] = React.useState(() => new Date().getMonth() + 1)
  const [year, setYear] = React.useState(() => new Date().getFullYear())
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null)
  const [raiseDate, setRaiseDate] = React.useState<string | null>(null)
  const [withdrawing, setWithdrawing] = React.useState('')
  // Local date, not UTC: before 05:30 IST the UTC date is still yesterday.
  const todayStr = ymdLocal(new Date())

  const mq = useMonth(year, month)
  const rq = useRegularisations()
  const monthData = mq.data ?? null
  const regs: RegularisationRequest[] = React.useMemo(() => rq.data || [], [rq.data])   // web: on error, an empty list
  const log = useLogController()

  const regByDate = React.useMemo(() => {
    const m = new Map<string, RegularisationRequest>()
    for (const r of regs) if (!m.has(r.attendance_date) && r.status !== 'CANCELLED') m.set(r.attendance_date, r)
    return m
  }, [regs])

  const go = (y: number, m: number) => { setYear(y); setMonth(m); setSelectedDate(null); setRaiseDate(null) }
  const prevMonth = () => (month === 1 ? go(year - 1, 12) : go(year, month - 1))
  const nextMonth = () => (month === 12 ? go(year + 1, 1) : go(year, month + 1))
  const now = new Date()
  const isThisMonth = month === now.getMonth() + 1 && year === now.getFullYear()

  const withdraw = async (id: string) => {
    setWithdrawing(id)
    try { await withdrawRegularisation(employeeId, id) }
    catch { /* the row stays as it was; the list shows the truth */ }
    finally { await afterChange(); setWithdrawing('') }
  }

  const stats = monthStats(year, month, monthData, todayStr)
  const dayInfo = selectedDate && monthData ? resolveDay(selectedDate, monthData, todayStr) : null
  const raiseRec = raiseDate && monthData ? monthData.recMap.get(raiseDate) || null : null
  const raiseDay = raiseDate ? monthData?.dayMap.get(raiseDate) : undefined

  return (
    <View style={{ flex: 1 }}>
      <TabScreen heading="Attendance" desc="Your punches, working hours and monthly calendar" onRefresh={() => invalidate('attendance')}>
        <MonthHero month={month} year={year} summary={stats} onPrev={prevMonth} onNext={nextMonth}
          onToday={() => { const n = new Date(); go(n.getFullYear(), n.getMonth() + 1) }} isThisMonth={isThisMonth} />
        <SummaryTiles summary={stats} />

        <Card style={{ marginBottom: 10 }}>
          {mq.isError && !monthData ? (
            <View style={{ gap: 10 }}>
              <Notice tone="critical" title="Couldn't load this month">{(mq.error as Error)?.message || 'Something went wrong.'}</Notice>
              <Button title="Try again" variant="outline" onPress={() => void mq.refetch()} />
            </View>
          ) : !monthData ? <CalendarShimmer /> : (
            <AttendanceCalendar year={year} month={month} monthData={monthData} todayStr={todayStr} selectedDate={selectedDate}
              onDayClick={d => { setSelectedDate(d); setRaiseDate(null) }} />
          )}
        </Card>

        {selectedDate && dayInfo
          ? <DayDetailPanel key={`day:${selectedDate}`} date={selectedDate} dayInfo={dayInfo} todayStr={todayStr} onRaise={d => setRaiseDate(d)}
              correction={regByDate.get(selectedDate) || null} />
          : <DayPanelResting summary={stats} />}

        {raiseDate && (
          <RegularisationForm key={`raise:${raiseDate}`} date={raiseDate} rec={raiseRec}
            expected={{ in: raiseDay?.expected_in ?? null, out: raiseDay?.expected_out ?? null }}
            onDone={() => setRaiseDate(null)} onCancel={() => setRaiseDate(null)} />
        )}

        <AttendanceLog ctl={log} />

        <RegularisationList requests={regs} onWithdraw={id => void withdraw(id)} busyId={withdrawing} />
      </TabScreen>

      <SelectionBar ctl={log} bottom={insets.bottom + 80} />
      {log.review && log.pickedDays.length > 0 && (
        <ReviewSheet days={log.pickedDays} onCancel={() => log.setReview(false)}
          onDone={() => { log.setReview(false); log.setPicked(new Set()) }} />
      )}
    </View>
  )
}
