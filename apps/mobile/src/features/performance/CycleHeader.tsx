// src/features/performance/CycleHeader.tsx — period · stepper · what you owe ·
// the four numbers (website: components/pms/CycleHeader.tsx, CycleStepper.tsx,
// NextAction.tsx, StatCards.tsx). The stepper's hover tooltip becomes a tap:
// tapping a stage shows its blurb under the rail.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Path } from 'react-native-svg'
import { STAGES, humanDate, nextAction, stageStates, type Action, type StageKey, type StageState } from '@web/pms/cycle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { IconAlert, IconCalendar, IconCheck, IconChevron, IconClock, IconPerformance } from '@/ui/icons'
import { loadHeader, localToday } from './data'
import { mixOklab } from './logic'

/** `color-mix(in oklab, <hex> a%, transparent)` as rgba, for a token over a fill. */
const alpha = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const STATE_WORD: Record<StageState, string> = { done: 'completed', active: 'in progress now', blocked: 'waiting, cannot start', upcoming: 'not started' }

function Tick({ color, size = 13 }: { color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><Path d="M3.5 8.5l3 3 6-6.5" /></Svg>
}
function Bang({ color }: { color: string }) {
  return <Svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round"><Path d="M8 4.4v4.2M8 11.4v.2" /></Svg>
}

export function CycleStepper({ states, detail }: { states: Record<StageKey, StageState>; detail: Partial<Record<StageKey, string>> }) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState<StageKey | null>(null)
  // Edition 2: a not-started stage is an outlined disc on the surface; filled ones take the theme's on-accent ink.
  const tone = (st: StageState) => st === 'done' ? { dot: C.positive, ink: C.onAccent, ring: 'transparent', label: C.inkSoft }
    : st === 'active' ? { dot: C.brand, ink: C.onAccent, ring: C.brandTint, label: C.brand }
    : st === 'blocked' ? { dot: C.warning, ink: C.onAccent, ring: C.warningTint, label: C.warning }
    : { dot: C.surface, ink: C.muted, ring: C.lineStrong, label: C.faint }
  const openStage = STAGES.find(s => s.key === open)
  return (
    <View>
      {/* Three to a row rather than a sideways scroller: every stage and its dates stay on screen.
          Not four: at 360dp and the 1.15 font scale a quarter of the card is narrower than
          "Weightage" or "One-to-One", and Android then breaks the word itself ("Weig/htage"). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: S.md }}>
        {STAGES.map((s, i) => {
          const st = states[s.key] ?? 'upcoming'
          const t = tone(st)
          const prevDone = i > 0 && (states[STAGES[i - 1].key] ?? 'upcoming') === 'done'
          const rowStart = i % 3 === 0
          return (
            <Pressable key={s.key} onPress={() => setOpen(o => o === s.key ? null : s.key)}
              accessibilityLabel={`Step ${s.n} of ${STAGES.length}: ${s.label} (${STATE_WORD[st]})`}
              style={{ width: '33.333%', alignItems: 'center', paddingHorizontal: 2 }}>
              {!rowStart && <View style={{ position: 'absolute', top: 15, left: '-30%', width: '60%', height: 3, borderRadius: 3, backgroundColor: prevDone ? C.positive : C.line }} />}
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.dot, alignItems: 'center', justifyContent: 'center', borderWidth: st === 'upcoming' ? 2 : st === 'done' ? 0 : 4, borderColor: t.ring }}>
                {st === 'done' ? <Tick color={t.ink} /> : st === 'blocked' ? <Bang color={t.ink} /> : <Txt size={F.tiny} w={700} color={t.ink}>{s.n}</Txt>}
              </View>
              <Txt size={F.tiny} w={st === 'active' || st === 'blocked' ? 700 : 600} color={t.label} center style={{ marginTop: 6 }}>{s.label}</Txt>
              {!!detail[s.key] && <Txt size={F.micro} tone="muted" center>{detail[s.key]}</Txt>}
            </Pressable>
          )
        })}
      </View>
      {openStage && (
        <View style={{ marginTop: S.sm, padding: 10, borderRadius: R.sm, backgroundColor: C.dark }}>
          <Txt size={F.micro} color={C.onDark}>{openStage.label}: {openStage.blurb}</Txt>
        </View>
      )}
    </View>
  )
}

/** NextAction.tsx deadline() */
function deadline(d: number | null | undefined): string | null {
  if (d === null || d === undefined) return null
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
  if (d === 0) return 'due today'
  if (d === 1) return '1 day left'
  return `${d} days left`
}

export function NextActionCard({ action, onGo }: { action: Action | null; onGo: (tab: string) => void }) {
  const { C } = useTheme()
  if (!action) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: 16, backgroundColor: C.positiveTint, borderWidth: 1, borderColor: C.positiveEdge }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.positive, alignItems: 'center', justifyContent: 'center' }}><IconCheck size={18} color={C.onAccent} strokeWidth={2.2} /></View>
        <View style={{ flex: 1 }}>
          <Txt size={F.body} w={700}>Nothing needs you right now</Txt>
          <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>You are up to date on this cycle. You will see a task here the moment one is yours.</Txt>
        </View>
      </View>
    )
  }
  const blocked = !!action.blockedBy
  const overdue = action.urgency === 'overdue'
  const sub = blocked ? C.inkSoft : C.onAccentSoft
  const when = deadline(action.daysLeft)
  const Lead = blocked ? IconClock : overdue ? IconAlert : IconChevron
  const body = (
    <View style={{ gap: S.md }}>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          backgroundColor: blocked ? C.surface : alpha(C.onAccent, 0.18), borderWidth: 1, borderColor: blocked ? C.warningEdge : alpha(C.onAccent, 0.3) }}>
          <Lead size={19} color={blocked ? C.warning : C.onAccent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.micro} w={700} color={blocked ? C.warning : sub} style={{ marginBottom: 4 }}>
            {blocked ? 'Waiting' : overdue ? 'Overdue' : 'Your next step'}
          </Txt>
          <Txt size={F.title} w={700} color={blocked ? C.ink : C.onAccent}>{action.title}</Txt>
          <Txt size={F.small} color={sub} style={{ marginTop: 5 }}>
            {action.blockedBy ? <Txt size={F.small} w={700} tone="ink">{action.blockedBy} </Txt> : null}
            {action.why}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        {when && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: R.pill,
            backgroundColor: blocked ? C.surface : C.onAccent, borderWidth: blocked ? 1 : 0, borderColor: C.warningEdge }}>
            <IconClock size={12} color={blocked ? C.warning : overdue ? C.critical : C.brand} strokeWidth={2} />
            <Txt size={F.micro} w={700} color={blocked ? C.warning : overdue ? C.critical : C.brand}>{when}</Txt>
          </View>
        )}
        <Pressable onPress={() => onGo(action.tab)} accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1,
            backgroundColor: blocked ? C.surface : C.onAccent, borderWidth: blocked ? 1 : 0, borderColor: C.lineStrong, flexShrink: 1 })}>
          <Txt size={F.small} w={700} color={blocked ? C.ink : overdue ? C.critical : C.brand} style={{ flexShrink: 1 }}>{action.cta}</Txt>
          <IconChevron size={14} color={blocked ? C.ink : overdue ? C.critical : C.brand} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  )
  if (blocked) {
    return <View style={{ padding: S.lg, borderRadius: 16, backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge }}>{body}</View>
  }
  return (
    <LinearGradient colors={overdue ? [C.critical, mixOklab(C.critical, '#000000', 22)] : [C.brand, C.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ padding: S.lg, borderRadius: 16 }}>
      {body}
    </LinearGradient>
  )
}

type SCTone = 'neutral' | 'good' | 'warn' | 'bad' | 'brand'
interface Stat { label: string; value: number | string; unit?: string; meaning?: string; fill?: number; tone?: SCTone }

function StatCard({ s }: { s: Stat }) {
  const { C } = useTheme()
  const t = s.tone ?? 'neutral'
  const c = t === 'brand' ? { ink: C.brandDeep, bar: C.brand, wash: C.brandTint, edge: C.brandEdge }
    : t === 'good' ? { ink: C.positive, bar: C.positive, wash: C.positiveTint, edge: C.positiveEdge }
    : t === 'warn' ? { ink: C.warning, bar: C.warning, wash: C.warningTint, edge: C.warningEdge }
    : t === 'bad' ? { ink: C.critical, bar: C.critical, wash: C.criticalTint, edge: C.criticalEdge }
    : { ink: C.ink, bar: C.brand, wash: C.surface, edge: C.line }
  const isNum = typeof s.value === 'number'
  const len = String(s.value).length
  return (
    <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 140, padding: S.md, borderRadius: 16, backgroundColor: c.wash, borderWidth: 1, borderColor: c.edge, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: c.bar, opacity: 0.85 }} />
      <Txt size={F.small} w={600} tone="muted" style={{ marginBottom: 6 }}>{s.label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
        <Txt size={isNum ? 26 : len > 14 ? 16 : len > 8 ? 19 : 23} w={700} color={c.ink}>{s.value}</Txt>
        {!!s.unit && <Txt size={F.small} w={600} tone="muted">{s.unit}</Txt>}
      </View>
      {s.fill !== undefined && (
        <View style={{ height: 6, borderRadius: 6, backgroundColor: C.sunken, marginTop: 10, overflow: 'hidden' }}>
          <View style={{ height: '100%', borderRadius: 6, backgroundColor: c.bar, width: `${Math.max(0, Math.min(1, s.fill)) * 100}%` }} />
        </View>
      )}
      {!!s.meaning && <Txt size={F.micro} tone="muted" style={{ marginTop: 8 }}>{s.meaning}</Txt>}
    </View>
  )
}

export function CycleHeader({ employeeId, isRM, isHOD, onGo }: { employeeId: string; isRM: boolean; isHOD: boolean; onGo: (tab: string) => void }) {
  const { C } = useTheme()
  const today = localToday()
  const q = useQuery({ queryKey: ['pms', 'header', employeeId, isRM, isHOD], queryFn: () => loadHeader(employeeId, { isRM, isHOD }, today), enabled: !!employeeId })
  const d = q.data
  if (!d) return <View style={{ height: 132, borderRadius: R.sm, backgroundColor: C.sunken, opacity: 0.5, marginBottom: S.lg }} />

  const roles = { isEmployee: true, isRM, isHOD }
  const states = stageStates(d.period, d.progress, today)
  const action = nextAction(d.period, d.progress, roles, d.queues, today, d.rules)
  const detail: Partial<Record<StageKey, string>> = {
    kra: d.progress.kraCount ? `${d.progress.kraCount} KRAs · ${d.progress.weightageTotal ?? 0}%` : undefined,
    self: d.period.self ? `${humanDate(d.period.self.from)} – ${humanDate(d.period.self.to)}` : undefined,
    finalise: d.period.finalise ? `by ${humanDate(d.period.finalise.to)}` : undefined,
  }
  const r = d.rules
  const kn = d.progress.kraCount ?? 0
  const wt = d.progress.weightageTotal ?? 0
  const stats: Stat[] = [
    {
      label: 'Your KRAs', value: kn, unit: kn === 1 ? 'goal' : 'goals',
      tone: kn === 0 ? 'neutral' : (kn >= r.minKra && kn <= r.maxKra) ? 'good' : 'warn',
      fill: Math.min(1, kn / r.minKra),
      meaning: kn === 0 ? `You need between ${r.minKra} and ${r.maxKra}.`
        : kn < r.minKra ? `${r.minKra - kn} more to reach the minimum of ${r.minKra}.`
        : kn > r.maxKra ? `That is ${kn - r.maxKra} over the limit of ${r.maxKra}.`
        : `Within the ${r.minKra}–${r.maxKra} allowed.`,
    },
    {
      label: 'Weightage used', value: wt, unit: `of ${r.totalWeightage}%`,
      tone: wt === r.totalWeightage ? 'good' : wt > r.totalWeightage ? 'bad' : 'warn',
      fill: wt / r.totalWeightage,
      meaning: wt === r.totalWeightage ? 'Adds up exactly. Nothing to change.'
        : wt > r.totalWeightage ? `${wt - r.totalWeightage}% too much. Take some off a goal.`
        : `${r.totalWeightage - wt}% still to share out across your goals.`,
    },
    { label: 'How often', value: d.frequency || 'Not set', meaning: d.span ? `This one covers ${d.span}.` : 'Your HR team sets the dates.' },
    d.lastRating
      ? { label: 'Your last result', value: d.lastRating.score ?? '-', unit: d.lastRating.label ? `· ${d.lastRating.label}` : undefined, tone: 'brand', meaning: 'Published for the previous period.' }
      : { label: 'Your last result', value: 'Not yet', tone: 'neutral', meaning: 'Your first result appears here once a cycle finishes.' },
  ]

  const chip = (children: React.ReactNode, label?: string) => (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: R.pill,
      backgroundColor: alpha(C.onDark, 0.12), borderWidth: 1, borderColor: alpha(C.onDark, 0.18) }}>{children}</View>
  )
  return (
    <View style={{ marginBottom: S.lg }}>
      {/* The period, on the hero band (pms.css .pms-hero-cycle): navy into blue, on-dark text. */}
      <LinearGradient colors={[C.darkMid, C.darkAccent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: R.xl, padding: S.lg, marginBottom: S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(C.onDark, 0.12) }}>
            <IconPerformance size={15} color={C.onDark} />
          </View>
          <Txt size={F.small} w={600} color={C.onDarkMuted}>My performance</Txt>
        </View>
        <Txt size={24} w={600} color={C.onDark} style={{ fontFamily: SERIF }}>{d.naming.title}</Txt>
        <Txt size={F.body} color={C.onDarkMuted} style={{ marginTop: 6 }}>{d.naming.sub}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {!!d.naming.code && chip(<Txt size={F.tiny} w={600} color={C.onDark}>{d.naming.code}</Txt>, 'The code your HR team files this under')}
          {!!d.span && chip(<><IconCalendar size={13} color={C.onDark} /><Txt size={F.tiny} w={600} color={C.onDark}>{d.span}</Txt></>)}
          {!!d.frequency && chip(<><IconClock size={13} color={C.onDark} /><Txt size={F.tiny} w={600} color={C.onDark}>{d.frequency}</Txt></>)}
        </View>
      </LinearGradient>
      <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: S.lg, marginBottom: S.md }}>
        <Txt size={F.small} w={700}>Where the cycle is</Txt>
        <Txt size={F.micro} tone="muted" style={{ marginTop: 2, marginBottom: S.md }}>
          {d.pending
            ? 'These are the stages every appraisal goes through. The module is not switched on in this database yet, so nothing is filled in.'
            : 'Tap any stage to see what happens in it.'}
        </Txt>
        <CycleStepper states={states} detail={detail} />
      </View>
      <View style={{ marginBottom: S.md }}><NextActionCard action={action} onGo={onGo} /></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {stats.map(s => <StatCard key={s.label} s={s} />)}
      </View>
    </View>
  )
}
