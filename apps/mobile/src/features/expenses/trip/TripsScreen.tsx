// src/features/expenses/trip/TripsScreen.tsx — /expenses/trips, every trip grouped by
// what it needs from you (components/te/trip/TeTrips.tsx, screens 50 and 51).
//
// The order is not chronological on purpose (lib/te/trips-list.ts decides the
// grouping): a trip you are on today and one you are back from both need
// something now. Everything is read from the snapshot; no call of its own.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TeTrip, TripScope, Uuid } from '@web/te/types'
import { groupTrips, myTrips, scopeCounts, tripChip, tripMoney } from '@web/te/trips-list'
import { isCoTraveller } from '@web/te/co-traveller'
import { routeText, tripDates } from '@web/te/entry-flow'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { plural, rs } from '../api'
import { placeNameOf } from '../data'
import { open, teHref } from '../nav'
import { kindColors, modeIcon } from '../tones'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Ico, Li, ListCard, PageHead, Seg, TeCard, TeEmpty } from '../ui/kit'
import { SnapScreen } from '../ui/TeScreen'
import { PATTERN_WORD, SCOPE_WORD } from './words'

const SCOPES = ['local', 'domestic', 'international'] as const

export default function TripsScreen() {
  return (
    <SnapScreen title="Trips" tab="trips">
      {snap => <TeTrips snap={snap}
        onOpen={id => open(teHref.trip(id))}
        onNew={scope => open(teHref.plan({ kind: scope }))} />}
    </SnapScreen>
  )
}

function TeTrips({ snap, onOpen, onNew }: { snap: Snapshot; onOpen: (id: Uuid) => void; onNew: (scope: TripScope) => void }) {
  const [scope, setScope] = React.useState<TripScope | null>(null)
  const placeName = React.useMemo(() => placeNameOf(snap), [snap])
  const all = myTrips(snap.trips, snap.me, null)
  const shown = myTrips(snap.trips, snap.me, scope)
  const counts = scopeCounts(all)
  const groups = groupTrips(shown, snap.today)

  return (
    <View>
      <PageHead title="Trips" lead="Every trip, local or abroad, holds its route, its journeys with GPS and stops, and every bill you spent on it." />

      <View accessibilityRole="list" style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.md }}>
        {SCOPES.map(k => <KindTile key={k} kind={k} onPress={() => onNew(k)} />)}
      </View>

      <Seg<'all' | TripScope> label="Show trips" style={{ marginBottom: S.md }}
        value={scope ?? 'all'} onChange={k => setScope(k === 'all' ? null : k)}
        items={[
          { key: 'all', label: 'All', note: String(counts.all) },
          ...SCOPES.map(k => ({ key: k, label: SCOPE_WORD[k], note: String(counts[k]) })),
        ]} />

      {groups.length ? groups.map(g => (
        <ListCard key={g.id} head={g.title} headRight={g.trips.length}>
          {g.trips.map((t, i) => (
            <TripRow key={t.id} trip={t} snap={snap} placeName={placeName} onOpen={onOpen} last={i === g.trips.length - 1} />
          ))}
        </ListCard>
      )) : (
        <TeCard>
          <TeEmpty title={scope ? `No ${SCOPE_WORD[scope].toLowerCase()} trip yet` : 'No trips yet'}>
            Plan one above, and its legs, stops and bills all live inside it.
          </TeEmpty>
        </TeCard>
      )}
    </View>
  )
}

/** .kinds.compact .kind — one "New … trip" tile. */
function KindTile({ kind, onPress }: { kind: TripScope; onPress: () => void }) {
  const { C } = useTheme()
  const k = kindColors(C, kind)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${SCOPE_WORD[kind]} trip, New`}
      style={({ pressed }) => [{
        flex: 1, minWidth: 0, minHeight: 96, padding: 12, gap: 8, borderRadius: R.lg, borderWidth: 1,
        borderColor: pressed ? k.k : C.line, backgroundColor: C.surface,
      }, elevation(C, 1)]}>
      <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: k.k }}>
        <TeIcon name={kind} size="lg" color={C.surface} px={20} />
      </View>
      <Txt size={F.small} w={700} numberOfLines={2}>{`${SCOPE_WORD[kind]} trip`}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
        <Txt size={F.tiny} w={600} color={k.k}>New</Txt>
        <TeIcon name="go" size="sm" color={k.k} />
      </View>
    </Pressable>
  )
}

/** One trip in the list. Module level, or it remounts on every filter change. */
function TripRow({ trip, snap, placeName, onOpen, last }: {
  trip: TeTrip
  snap: Snapshot
  placeName: (id: string) => string
  onOpen: (id: Uuid) => void
  last: boolean
}) {
  const legs = snap.journeys.filter(j => j.tripId === trip.id)
  const chip = tripChip(trip)
  // snap.claims / snap.expenses are the viewer's own, so a co-traveller's row
  // shows what THEY have to claim, never the planner's total.
  const money = tripMoney(trip, snap.claims, snap.expenses)
  const taken = isCoTraveller(trip, snap.me)
  const planner = taken ? snap.emp[trip.emp]?.name ?? '' : ''
  // The rides to and from an airport are legs of the trip but not how you travelled on it.
  const modes = [...new Set(legs.filter(l => l.kind !== 'first' && l.kind !== 'last').map(l => l.mode))]
  const km = Math.round(legs.filter(l => l.mode !== 'flight').reduce((a, l) => a + (l.plannedKm || 0), 0) * 10) / 10

  return (
    <Li last={last} onPress={() => onOpen(trip.id)} style={{ alignItems: 'flex-start' }}
      accessibilityLabel={trip.name || trip.to}
      left={<Ico name={trip.scope} kind={trip.scope} />}
      right={
        <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: '38%' }}>
          <Txt size={F.small} w={700} style={{ textAlign: 'right' }}>
            {rs(money.value)} <Txt size={F.tiny} tone="muted">{money.label}</Txt>
          </Txt>
          <Chip label={chip.label} tone={chip.tone} style={{ alignSelf: 'flex-end' }} />
        </View>
      }>
      <Txt size={F.small} w={700}>{trip.name || trip.to}</Txt>
      <Txt size={F.tiny} tone="muted">{routeText(trip, placeName)}</Txt>
      <Txt size={F.tiny} tone="muted">
        {tripDates(trip)} · {plural(legs.length, 'journey')}{km ? ` · ${km} km by road` : ''}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        <ScopeChip scope={trip.scope} />
        <Chip label={PATTERN_WORD[trip.pattern] ?? trip.pattern} plain />
        {taken ? (
          <Chip tone="t-info" icon="people" label={planner ? `On ${planner}’s trip` : 'You were taken on this trip'} />
        ) : trip.pax > 1 ? (
          <Chip plain icon="people" label={`${trip.pax} people`} />
        ) : null}
        {modes.map(m => (
          <Chip key={m} plain icon={modeIcon(m)} label={snap.cfg.modes.find(x => x.id === m)?.name ?? m} />
        ))}
        {trip.origin === 'POST_FACTO' ? <Chip tone="t-warn" plain label="Recorded after travel" /> : null}
      </View>
    </Li>
  )
}

/** chip plain sc sc-<scope>: the scope's colour on its tint, with its icon. */
export function ScopeChip({ scope }: { scope: TripScope }) {
  const { C } = useTheme()
  const k = kindColors(C, scope)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill, backgroundColor: k.kt }}>
      <TeIcon name={scope} px={12} color={k.k} />
      <Txt size={11.5} w={600} color={k.k}>{SCOPE_WORD[scope]}</Txt>
    </View>
  )
}
