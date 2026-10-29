// src/features/expenses/dashboard/DashboardScreen.tsx — /expenses/dashboard,
// "Reports and dashboard" (components/te/report/TeDashboard.tsx, new since 4a92155).
//
// Everybody sees it; what they see is decided by the data (GET /api/te/dashboard,
// scoped server-side to the person and their reports). One read answers: where my
// requests have reached, what came to me to decide and what I did, and what my
// team is asking for (read only). There is no action here; your own trips open.
//
// The month window: untouched, the server picks it; ‹ › step a month; "Pick dates"
// sets From / To. The previous window stays on screen while the next loads, with
// the website's "still the window before it" line (placeholderData).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { dashboardEmpty, monthAround, rangeLabel, scoreTiles } from '@web/te/dashboard'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, fmtDay } from '@/ui/overlays'
import { errorText, te } from '../api'
import { TE, useSignedIn } from '../data'
import { open, teHref } from '../nav'
import { Flag, PageHead, TeCard, TeEmpty } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { TeScreen } from '../ui/TeScreen'
import { Tile } from '../claims/parts'
import { Acted, MyClaims, MyTrips, Team } from './rows'

type Range = { from: string; to: string } | null

function StepBtn({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, opacity: disabled ? 0.4 : 1, backgroundColor: pressed ? C.sunken : 'transparent' })}>
      <TeIcon name={icon} size="sm" color={C.inkSoft} />
    </Pressable>
  )
}

export default function DashboardScreen() {
  const { C } = useTheme()
  const [range, setRange] = React.useState<Range>(null)
  const [custom, setCustom] = React.useState(false)
  const [picking, setPicking] = React.useState<'from' | 'to' | null>(null)
  const q = useQuery({
    queryKey: [TE, 'dashboard', range?.from ?? '', range?.to ?? ''],
    queryFn: () => te.dashboard(range ? { from: range.from, to: range.to } : undefined),
    enabled: useSignedIn(),
    placeholderData: keepPreviousData,
  })
  const data = q.data
  const from = range?.from ?? data?.from ?? ''
  const to = range?.to ?? data?.to ?? ''
  const label = rangeLabel(from, to)
  const stale = !!range && !!data && (data.from !== range.from || data.to !== range.to)
  const step = (delta: -1 | 1) => { const m = monthAround(from, delta); if (m) setRange(m) }

  return (
    <TeScreen title="Reports and dashboard" tab="dashboard" onRefresh={() => q.refetch()}>
      <PageHead title="Reports and dashboard"
        lead="Where your requests have reached, what came to you to decide, and what your team is asking for." />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: R.pill, backgroundColor: C.surface, flexGrow: 1 }}>
          <StepBtn icon="back" label="The month before" onPress={() => step(-1)} disabled={!from} />
          <Txt size={F.small} w={700} center style={{ flex: 1 }}>{label.text}</Txt>
          <StepBtn icon="go" label="The month after" onPress={() => step(1)} disabled={!from} />
        </View>
        <Button size="sm" variant={custom ? 'soft' : 'outline'} title="Pick dates" onPress={() => setCustom(c => !c)}
          icon={<TeIcon name="cal" size="sm" color={C.brandDeep} />} />
      </View>

      {custom ? (
        <TeCard>
          <PickerField label="From" value={from ? fmtDay(from) : ''} placeholder="Choose" onPress={() => setPicking('from')} />
          <PickerField label="To" value={to ? fmtDay(to) : ''} placeholder="Choose" onPress={() => setPicking('to')} />
          <Txt size={F.tiny} tone="muted">
            The dates apply to two things: when you decided something, and when your team asked for it.
            Your own trips and claims are always listed whatever the dates say, and so is what is still
            waiting on you — those are true now, not in a month you have scrolled to.
          </Txt>
        </TeCard>
      ) : null}
      <DateSheet visible={!!picking} onClose={() => setPicking(null)} title={picking === 'to' ? 'To' : 'From'}
        value={picking === 'to' ? to : from}
        onPick={v => { if (v) setRange(picking === 'to' ? { from, to: v } : { from: v, to }); setPicking(null) }} />

      {q.error && !data ? <Flag tone="crit" icon="warn" title={errorText(q.error)} style={{ marginBottom: S.md }} /> : null}
      {!data && !q.error ? (
        <TeCard><TeEmpty title="Loading">Reading your trips, your decisions and your team.</TeEmpty></TeCard>
      ) : null}
      {stale ? <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>{`Loading ${label.text} — the figures below are still the window before it.`}</Txt> : null}

      {data ? (
        <>
          {dashboardEmpty(data) ? (
            <TeCard>
              <TeEmpty title={`Nothing in ${label.text.toLowerCase()}`}>
                You have raised nothing and decided nothing in this window. Step back a month, or pick dates.
              </TeEmpty>
            </TeCard>
          ) : null}
          {data.score.cameToMe || data.score.waiting ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
              {scoreTiles(data.score).map(t => <Tile key={t.k} label={t.l} value={String(t.v)} note={t.sub} />)}
            </View>
          ) : null}
          {data.acted.length ? <Acted rows={data.acted} /> : null}
          {data.mine.trips.length ? <MyTrips trips={data.mine.trips} onOpenTrip={id => open(teHref.trip(id))} /> : null}
          {data.mine.claims.length ? <MyClaims claims={data.mine.claims} /> : null}
          {data.team.people ? <Team team={data.team} /> : null}
        </>
      ) : null}
    </TeScreen>
  )
}
