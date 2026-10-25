// src/features/expenses/home/HomeScreen.tsx — TeHome's view `home` and the module header.
//
// Website (components/te/TeHome.tsx):
//   header  "E" mark · EZER / Travel and Expenses · Back to ESS · avatar + name + title/code
//   TeLiveBar when one of my journeys is running
//   hero    "Hello, <first name>" · "Where are you travelling today?" · 3 KPIs
//   tiles   Local / Domestic / International → step 2 sheet; Other expense → the expense form
//   "Needs you" (only when something is waiting): sent-back claims, unclaimed bills, queue rows
// Deep link: /expenses?tab=claims&ref=<claim uuid> (the website's
// /ess/travel?tab=claims&ref=, written by migration 147) opens that claim.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import type { Snapshot, TeQueueRow } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { rs } from '../api'
import { homeFigures, initialsOf, meOf, useQueue, useSnap } from '../data'
import { claimFromLink, exitModule, open, param, teHref } from '../nav'
import { HERO } from '../tones'
import { TeIcon } from '../ui/TeIcon'
import { ListCard, Li, Ico } from '../ui/kit'
import { SnapState, TeScreen } from '../ui/TeScreen'
import { KindTiles } from './KindTiles'

/** The module's own header bar (TeHome header.top). */
function ModuleHeader({ snap }: { snap: Snapshot | undefined }) {
  const { C, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const me = snap ? meOf(snap) : null
  const hero = isDark ? HERO.dark : HERO.light
  return (
    <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: S.lg, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LinearGradient colors={[hero[0], hero[1], hero[2]]} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={17} color={C.onDark} style={{ fontFamily: SERIF }}>E</Txt>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.body} w={800}>EZER</Txt>
        <Txt size={F.micro} tone="muted" numberOfLines={1}>Travel and Expenses</Txt>
      </View>
      <Pressable onPress={exitModule} accessibilityRole="button" hitSlop={6}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.sunken : C.surface })}>
        <TeIcon name="back" size="sm" color={C.inkSoft} />
        <Txt size={F.tiny} w={600} tone="soft">Back to ESS</Txt>
      </Pressable>
      {me && (
        <View accessibilityLabel={`${me.name}, ${me.title || me.code}`} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={12} w={700} tone="brand">{initialsOf(me.name)}</Txt>
        </View>
      )}
    </View>
  )
}

function Kpi({ value, label }: { value: string; label: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: HERO.glass, borderWidth: 1, borderColor: HERO.glassEdge, borderRadius: R.lg, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Txt size={17} w={600} color={C.onDark} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
      <Txt size={F.tiny} color={C.onDarkMuted} numberOfLines={2}>{label}</Txt>
    </View>
  )
}

function Hero({ snap }: { snap: Snapshot }) {
  const { C, isDark } = useTheme()
  const hero = isDark ? HERO.dark : HERO.light
  const f = homeFigures(snap)
  const first = (meOf(snap)?.name || '').split(' ')[0]
  return (
    <View style={{ borderRadius: R.xl, overflow: 'hidden', marginBottom: S.lg, ...elevation(C, 1) }}>
      <LinearGradient colors={[hero[0], hero[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.6 }} style={{ padding: 20, gap: 14 }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -80, top: -120, width: 260, height: 220, borderRadius: 130, backgroundColor: hero[2], opacity: 0.35 }} />
        <View>
          <Txt size={24} color={C.onDark} style={{ fontFamily: SERIF }}>Hello, {first}</Txt>
          <Txt size={F.small} color={C.onDarkMuted} style={{ marginTop: 2 }}>Where are you travelling today?</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Kpi value={rs(f.coming)} label="coming to you" />
          <Kpi value={String(f.open.length)} label="claims in approval" />
          <Kpi value={rs(f.advance)} label="advance with you" />
        </View>
      </LinearGradient>
    </View>
  )
}

function NeedRow({ icon, title, sub, go, onPress, last }: { icon: string; title: string; sub: string; go: string; onPress: () => void; last?: boolean }) {
  const { C } = useTheme()
  return (
    <Li onPress={onPress} last={last} accessibilityLabel={`${title} ${go}`}
      left={<Ico name={icon} />}
      right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt size={F.tiny} w={600} tone="brand">{go}</Txt><TeIcon name="go" size="sm" color={C.brand} /></View>}>
      <Txt size={F.small} w={700}>{title}</Txt>
      <Txt size={F.tiny} tone="muted">{sub}</Txt>
    </Li>
  )
}

function NeedsYou({ snap, queue }: { snap: Snapshot; queue: TeQueueRow[] }) {
  const { unclaimed, sentBack } = homeFigures(snap)
  if (!unclaimed.length && !sentBack.length && !queue.length) return null
  const count = (unclaimed.length ? 1 : 0) + sentBack.length + queue.length
  const rows: React.ReactNode[] = []
  sentBack.forEach(c => rows.push(
    <NeedRow key={c.id} icon="other" title={`Claim ${c.no} was sent back to you.`} sub="Correct the lines and answer." go="Open" onPress={() => open(teHref.claim(c.id))} />,
  ))
  if (unclaimed.length) rows.push(
    <NeedRow key="unclaimed" icon="other"
      title={`${unclaimed.length} other ${unclaimed.length === 1 ? 'expense is' : 'expenses are'} saved but not submitted.`}
      sub={rs(unclaimed.reduce((a, x) => a + x.claimed, 0))} go="Review and submit" onPress={() => open(teHref.other)} />,
  )
  queue.forEach(q => rows.push(
    <NeedRow key={q.step_id} icon={q.entity_type === 'claim' ? 'other' : 'local'}
      title={`${q.entity_type === 'claim' ? 'Claim' : 'Trip plan'} ${q.ref_no} from ${q.employee_name} is waiting for you.`}
      sub={`${rs(q.amount)} · ${q.role_label}`} go="Decide" onPress={() => open(teHref.approvals)} />,
  ))
  return (
    <ListCard head="Needs you" headRight={String(count)} style={{ marginTop: S.lg }}>
      {rows.map((r, i) => (i === rows.length - 1 && React.isValidElement(r) ? React.cloneElement(r as React.ReactElement<{ last?: boolean }>, { last: true }) : r))}
    </ListCard>
  )
}

export default function HomeScreen() {
  const q = useSnap()
  const queue = useQueue().data ?? []
  const params = useLocalSearchParams<{ tab?: string; ref?: string }>()
  const linked = React.useRef(false)

  // TeHome.claimFromLink(): start on that claim. Pushed over Home, so Back lands here.
  React.useEffect(() => {
    if (linked.current) return
    const id = claimFromLink(param(params.tab), param(params.ref))
    if (!id) return
    linked.current = true
    router.setParams({ tab: undefined, ref: undefined })
    open(teHref.claim(id))
  }, [params.tab, params.ref])

  return (
    <TeScreen top={<ModuleHeader snap={q.data} />} tab="home">
      {q.data ? (
        <>
          <Hero snap={q.data} />
          <KindTiles snap={q.data} onPick={k => open(k === 'other' ? teHref.expense() : teHref.kind(k))} />
          <NeedsYou snap={q.data} queue={queue} />
        </>
      ) : <SnapState error={q.error} onRetry={() => void q.refetch()} />}
    </TeScreen>
  )
}
