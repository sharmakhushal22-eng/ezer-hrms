// src/features/home/StatTiles.tsx — components/ess/today/StatTiles.tsx.
// Leave balance, Attendance this month, Pending actions. Two columns at phone
// width (today.css ≤900px), so the third tile sits alone on the second row.
// Net salary is not shown — the website removed it from Home.
import * as React from 'react'
import { useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import type { TodayPayload } from './data'
import { alpha, useCountUp, useMounted, useTween } from './kit'

const RING_R = 23, RING_C = 2 * Math.PI * RING_R

function Ring({ to, hue, label }: { to: number; hue: string; label: string }) {
  const { C } = useTheme()
  const ready = useMounted(250)
  const p = useTween(ready ? to : 0, 1300, 400)
  return (
    <View style={{ width: 54, height: 54, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={54} height={54} viewBox="0 0 54 54" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={27} cy={27} r={RING_R} fill="none" stroke={alpha(hue, 0.12)} strokeWidth={6} />
        {p > 0.001 && <Circle cx={27} cy={27} r={RING_R} fill="none" stroke={hue} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={`${RING_C} ${RING_C}`} strokeDashoffset={RING_C * (1 - p)} />}
      </Svg>
      <Txt size={11} w={700} color={C.ink}>{label}</Txt>
    </View>
  )
}

function Delta({ label, tone }: { label: string; tone: 'up' | 'warn' }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99, backgroundColor: tone === 'up' ? C.positiveTint : C.warningTint }}>
      <Txt size={11} w={700} color={tone === 'up' ? C.positive : C.warning}>{label}</Txt>
    </View>
  )
}

function Tile({ hue, width, k, value, unit, sub, left, right }: {
  hue: string; width: number; k: string; value: string; unit?: string; sub: React.ReactNode; left?: React.ReactNode; right?: React.ReactNode
}) {
  const { C, isDark } = useTheme()
  return (
    <View style={{ width, borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden', backgroundColor: C.surface,
      shadowColor: isDark ? '#000000' : '#101828', shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 }}>
      <LinearGradient colors={[alpha(hue, 0.06), C.surface]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 0.9 }}
        style={{ paddingVertical: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 96 }}>
        {left}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingLeft: 7, paddingRight: 9, borderRadius: 99, backgroundColor: alpha(hue, 0.1) }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hue }} />
            <Txt size={11} w={600} color={hue} numberOfLines={2} style={{ flexShrink: 1 }}>{k}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 8 }}>
            <Txt size={24} w={800} color={C.ink} style={{ lineHeight: 28, fontVariant: ['tabular-nums'] }}>{value}</Txt>
            {!!unit && <Txt size={13} w={600} tone="muted" style={{ marginLeft: 4 }}>{unit}</Txt>}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, rowGap: 3, marginTop: 5 }}>{sub}</View>
        </View>
        {right}
      </LinearGradient>
    </View>
  )
}

export function StatTiles({ data }: { data: TodayPayload }) {
  const { C } = useTheme()
  const { width } = useWindowDimensions()
  const tileW = Math.floor((Math.min(width, 640) - S.lg * 2 - 12) / 2)
  const leave = useCountUp(data.leave?.total ?? 0, 1)
  const present = useCountUp(data.attendance_month?.present ?? 0)
  const pend = useCountUp(data.pending.length)
  const am = data.attendance_month, pct = am?.pct ?? null
  const delta = pct !== null && am?.prev_pct != null ? Math.round(pct - am.prev_pct) : null
  const byType = data.leave?.by_type ? Object.entries(data.leave.by_type).map(([k, v]) => `${k} ${v}`).join(' · ') : ''
  const dueThisMonth = data.pending.filter(p => p.due_on && new Date(p.due_on).getMonth() === new Date().getMonth()).length
  const subTxt = (s: string, lines?: number) => <Txt size={11.5} tone="muted" numberOfLines={lines}>{s}</Txt>

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14, marginBottom: S.lg }}>
      <Tile hue={C.brand} width={tileW} k="Leave balance" value={leave} unit="days"
        left={<Ring to={Math.min(1, (data.leave?.total ?? 0) / 24)} hue={C.brand} label={String(data.leave?.total ?? 0)} />}
        sub={<>{!!byType && subTxt(byType, 2)}{data.leave?.accrued_this_month ? <Delta tone="up" label={`+${data.leave.accrued_this_month}`} /> : null}</>} />
      <Tile hue={C.positive} width={tileW} k={`Attendance, ${new Date().toLocaleDateString('en-IN', { month: 'long' })}`} value={present} unit={`of ${am?.working_days ?? 0} days`}
        left={<Ring to={(pct ?? 0) / 100} hue={C.positive} label={pct !== null ? `${pct}%` : '-'} />}
        sub={<>{subTxt(am?.late ? `${am.late} late mark${am.late > 1 ? 's' : ''}` : 'No late marks')}
          {delta !== null && delta !== 0 && <Delta tone={delta > 0 ? 'up' : 'warn'} label={`${delta > 0 ? '+' : ''}${delta}%`} />}</>} />
      <Tile hue={C.warning} width={tileW} k="Pending actions" value={pend}
        sub={dueThisMonth > 0 ? <Delta tone="warn" label={`${dueThisMonth} due this month`} /> : subTxt(data.pending.length === 0 ? 'All clear' : 'No deadlines')}
        right={<Svg width={64} height={30} viewBox="0 0 64 30">
          <Path d="M2 22 L14 18 L26 20 L38 10 L50 13 L62 6 L62 30 L2 30Z" fill={alpha(C.warning, 0.12)} />
          <Path d="M2 22 L14 18 L26 20 L38 10 L50 13 L62 6" fill="none" stroke={C.warning} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>} />
    </View>
  )
}
