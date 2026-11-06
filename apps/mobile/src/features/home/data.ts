// src/features/home/data.ts — what Home reads and writes.
//
// Same calls as the website's Today tab (components/ess/today/Today.tsx and its
// cards): GET /api/ess/today for the whole screen, GET /api/ess/attendance for
// this week's strip, POST /api/ess/punch, POST /api/ess/celebrations,
// POST /api/ess/announcements, PUT /api/ess/preferences, and — only when the
// payload lacks `new_joiners` — the anon RPC ess_new_joiners_feed.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/core/api'
import { supabase } from '@/core/supabase'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { fromTodayTheme, toTodayTheme } from '@web/ui/theme-resolve'
import type { Prefs, TodayPayload } from '@web/today/types'

export type { Prefs, TodayPayload }
export type Pending = TodayPayload['pending'][number]
export type Joiner = NonNullable<TodayPayload['new_joiners']>[number]

/** lib/supabase-attendance.ts DayKind / AttendanceDay — the fields WeekStrip reads. */
export type DayKind =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'MISS_IN' | 'MISS_OUT' | 'IN_PROGRESS' | 'ABSENT'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING'
export interface AttendanceDay {
  date: string; kind: DayKind; work_in: string | null; work_out: string | null
  total_minutes: number | null; late_minutes: number; note: string | null
  leave: { name?: string | null } | null
}

/** The subset of lib/attendance/punch.ts PunchState Home uses (PunchDial.tsx PunchStateLite). */
export interface PunchStateLite { open: boolean; first_in: string | null; last_in: string | null; last_out: string | null }

export const todayKey = (employeeId: string) => ['today', employeeId]

/** GET /api/ess/today. The RPC answers 200 { error: 'employee not found' } for a missing row — treated as an error here. */
export function useToday() {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: todayKey(employeeId),
    queryFn: async () => {
      const j = await api<TodayPayload & { error?: string }>('/api/ess/today')
      if (j && typeof j === 'object' && j.error) throw new ApiError(j.error, 200, j)
      return j as TodayPayload
    },
    enabled: !!employeeId,
  })
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** WeekStrip.tsx thisWeek(): Monday and Sunday of the device-local week. */
export function thisWeek(d = new Date()) {
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
  return { from: ymd(mon), to: ymd(sun) }
}
export { ymd }

/** GET /api/ess/attendance?from&to&employee_id — the week's verdict per day. Errors keep the payload's week. */
export function useWeekDays(employeeId: string) {
  const { from, to } = thisWeek()
  return useQuery({
    // Under the 'attendance' prefix so a punch or a regularisation refreshes it.
    queryKey: ['attendance', 'home-week', employeeId, from, to],
    queryFn: async () => {
      const r = await api<{ days?: AttendanceDay[] }>('/api/ess/attendance', { query: { from, to }, employeeId })
      return Array.isArray(r?.days) ? r.days : null
    },
    enabled: !!employeeId,
    retry: false,
  })
}

/** NewJoiners.tsx fallback: the feed RPC, only when the payload has no `new_joiners` key. Errors hide the card. */
export function useJoinersFallback(employeeId: string, needed: boolean) {
  return useQuery({
    queryKey: ['today', 'new-joiners', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ess_new_joiners_feed', { p_employee_id: employeeId })
      return !error && Array.isArray(data) ? (data as Joiner[]) : []
    },
    enabled: needed && !!employeeId,
    retry: false,
  })
}

/** Today.tsx wish / congratulate → POST /api/ess/celebrations. */
export function sendCelebration(toEmployeeId: string, kind: 'BIRTHDAY' | 'ANNIVERSARY' | 'JOINING') {
  return api('/api/ess/celebrations', { method: 'POST', body: { to_employee_id: toEmployeeId, kind } })
}

/** Announcements.tsx markRead → POST /api/ess/announcements { id } (errors ignored). */
export function markAnnouncementRead(id: string) {
  return api('/api/ess/announcements', { method: 'POST', body: { id } }).catch(() => {})
}

const DEFAULT_PREFS: Prefs = { theme: 'light', time_format: '24', date_format: 'long' }

/**
 * lib/today/prefs-client.ts usePrefs(), for the app.
 *
 * Starts at { light, 24, long }. update() merges a patch, applies a changed
 * theme (the app's ThemeProvider — 'auto' is 'system') and PUTs the FULL merged
 * prefs to /api/ess/preferences, best-effort. Home calls update(payload.prefs)
 * on its first successful load, exactly like the website — which also means a
 * saved theme equal to the starting 'light' changes nothing on screen.
 * When the top bar's theme button changes the theme, the prefs follow it (the
 * top bar saves that change itself, so no second PUT is sent from here).
 */
export function usePrefs() {
  const { mode, setMode } = useTheme()
  const [prefs, setPrefs] = React.useState<Prefs>(DEFAULT_PREFS)
  const latest = React.useRef(prefs)
  const lastMode = React.useRef(mode)

  React.useEffect(() => {
    if (lastMode.current === mode) return
    lastMode.current = mode
    const t = toTodayTheme(mode)
    if (latest.current.theme === t) return
    latest.current = { ...latest.current, theme: t }
    setPrefs(latest.current)
  }, [mode])

  const update = React.useCallback((patch: Partial<Prefs>) => {
    const prev = latest.current
    const next = { ...prev, ...patch }
    latest.current = next
    setPrefs(next)
    if (patch.theme !== undefined && patch.theme !== prev.theme) {
      const m = fromTodayTheme(patch.theme)
      lastMode.current = m
      setMode(m)
    }
    api('/api/ess/preferences', { method: 'PUT', body: next }).catch(() => {})
  }, [setMode])

  return { prefs, update }
}
