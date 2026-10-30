// src/features/expenses/desk/ByTrip.tsx — the desk's work, one card per trip
// (components/te/desk/TeDeskByTrip.tsx). Maps the work; each line takes the desk
// to the room that does it, narrowed to the trip. Grouping is deskBuckets() in
// lib/te/desk-buckets.ts (shared).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { deskBuckets, type WorkKind } from './buckets'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { plural } from '../api'
import { Chip, TeCard } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import type { DeskBooked, DeskJourney, DeskStay, DeskToBook, DeskWatch } from './types'

const ICON: Record<WorkKind, string> = { stays: 'home', book: 'plane', booked: 'check', journeys: 'route', watch: 'people' }

export type Focus = { tripId: string; tripNo: string }

export function ByTrip({ stays, toBook, booked, journeys, watch, onGoRoom, onOpenTrip }: {
  stays: DeskStay[]; toBook: DeskToBook[]; booked: DeskBooked[]; journeys: DeskJourney[]; watch: DeskWatch[]
  onGoRoom: (room: WorkKind, focus: Focus) => void
  onOpenTrip: (tripId: string) => void
}) {
  const { C } = useTheme()
  // Structurally the website's row types (copied in ./types).
  const buckets = deskBuckets({ stays, toBook, booked, journeys, watch })
  const needing = buckets.filter(b => b.todo > 0).length

  if (!buckets.length) {
    return (
      <TeCard>
        <Txt size={F.body} w={700}>By trip</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>
          Nothing is with the desk. Hotels to choose, tickets to book and journeys to agree appear here under the trip
          they belong to, as they arrive.
        </Txt>
      </TeCard>
    )
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm, paddingHorizontal: 4 }}>
        <Txt size={F.tiny} w={700} tone="muted" upper>By trip</Txt>
        <Txt size={F.tiny} w={700} tone="muted">{needing ? `${needing} of ${buckets.length} need you` : plural(buckets.length, 'trip')}</Txt>
      </View>
      {buckets.map(b => (
        <TeCard key={b.tripId} style={b.todo ? { borderColor: C.warningEdge } : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Pressable onPress={() => onOpenTrip(b.tripId)} accessibilityRole="link" hitSlop={6} style={{ alignSelf: 'flex-start' }}
                accessibilityLabel={`Open ${b.tripNo} — every bill, the stay, the advance and what it has cost`}>
                <Txt size={F.tiny} w={700} color={C.brand} style={{ fontFamily: 'monospace' }}>{b.tripNo}</Txt>
              </Pressable>
              <Txt size={F.small} w={700}>{b.tripName || 'A trip'}</Txt>
              <Txt size={F.tiny} tone="muted">{`${b.who || 'A traveller'}${b.empCode ? ` · ${b.empCode}` : ''}`}</Txt>
            </View>
            {b.todo ? <Chip tone="t-warn" label={`${b.todo} to do`} /> : <Chip plain tone="t-pos" label="Nothing waiting" />}
          </View>
          {b.lines.map(l => (
            <Pressable key={l.kind} onPress={() => onGoRoom(l.kind, { tripId: b.tripId, tripNo: b.tripNo })} accessibilityRole="button"
              accessibilityLabel={`Open ${l.label}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, minHeight: 44, borderTopWidth: 1, borderTopColor: C.line, marginTop: S.sm, backgroundColor: pressed ? C.sunken : 'transparent' })}>
              <TeIcon name={ICON[l.kind]} size="sm" color={C.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Txt size={F.small} w={600}>{l.label}</Txt>
                  {l.todo ? <Chip tone="t-warn" label={String(l.n)} /> : <Chip plain label={String(l.n)} />}
                </View>
                <Txt size={F.tiny} tone="muted">{l.detail}</Txt>
              </View>
              <TeIcon name="go" size="sm" color={C.muted} />
            </Pressable>
          ))}
        </TeCard>
      ))}
    </View>
  )
}
