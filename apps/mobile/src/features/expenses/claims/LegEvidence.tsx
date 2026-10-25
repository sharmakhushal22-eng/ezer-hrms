// src/features/expenses/claims/LegEvidence.tsx — the evidence behind one journey
// (components/te/approve/TeLegEvidence.tsx, spec Part 6 "Leg evidence").
//
// Reached from Claim detail → "Travel on this claim" (and, later, from the
// approvals desk — props only, no queries, so the lead can reuse it). It shows
// the planned from → to line and the numbers the server derived; no verdict.
// The GPS trail is not drawn: the detail RPCs never return it (`track` is []).
import * as React from 'react'
import { View } from 'react-native'
import type { TeLeg, TePlaceBrief } from '@web/te/types'
import type { MapPlace } from '@web/te/trip-map'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { when } from '../api'
import { Chip, Flag, H4, KvRow, Mono, Note, TeCard } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { TripMap } from '../ui/TripMap'
import { Tile } from './parts'

const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10

export function LegEvidence({ leg, places, onBack, backLabel = 'Claim' }: {
  leg: TeLeg
  places: Record<string, TePlaceBrief>
  onBack: () => void
  backLabel?: string
}) {
  const { C } = useTheme()
  const s = leg.stats
  const pname = (id: string) => places[id]?.s ?? ''
  const mapPlaces = React.useMemo(
    () => new Map<string, MapPlace>(Object.entries(places).map(([id, p]) => [id, { id, s: p.s, lat: p.lat, lng: p.lng }])),
    [places],
  )

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
        <Button title={backLabel} variant="outline" size="sm" onPress={onBack} icon={<TeIcon name="back" size="sm" color={C.brandDeep} />} />
        <Mono>Journey {leg.n}</Mono>
      </View>

      <TeCard>
        <Txt size={F.micro} w={700} tone="muted" upper>Journey {leg.n}</Txt>
        <Txt size={F.title + 2} w={700} style={{ marginTop: 2 }}>{pname(leg.from)} → {pname(leg.to)}</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>
          {leg.mode}{leg.startedAt ? ` · started ${when(leg.startedAt)}` : ''}{leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}
        </Txt>
        {(leg.manual || leg.gps === 'checkin' || !!leg.noGps) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
            {leg.manual ? <Chip label="Added without GPS" tone="t-warn" /> : null}
            {leg.gps === 'checkin' ? <Chip label="Check-ins" tone="plain" /> : null}
            {leg.noGps ? <Chip label={leg.noGps} tone="t-warn" /> : null}
          </View>
        )}
      </TeCard>

      {leg.manual || !s ? (
        <Flag tone="warn" icon="alert" title={leg.manual ? 'This journey was not recorded' : 'No GPS record for this journey'} style={{ marginBottom: S.md }}>
          {`${leg.noGps || leg.skipReason || 'It is paid on the planned distance rather than a measured one.'}${leg.plannedKm ? ` The plan was ${leg.plannedKm} km.` : ''}`}
        </Flag>
      ) : (
        <>
          <TeCard>
            <TripMap legs={[{ from: leg.from, to: leg.to, mode: leg.mode }]} points={[leg.from, leg.to]} places={mapPlaces}
              label={`Journey ${leg.n} on the map`} />
            <Txt size={F.tiny} tone="muted">
              The straight line between the two places. The recorded trail itself is held against the leg and is what the distance below was measured from.
            </Txt>
          </TeCard>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
            <Tile label="GPS distance" value={`${r1(s.gpsKm)} km`} note="measured by the phone" />
            <Tile label="Planned" value={`${r1(leg.plannedKm)} km`} note="shortest route" />
            <Tile label="Paid on" value={`${r1(s.payBase)} km`} note="after the checks" />
            <Tile label="Time" value={`${s.dur} min`} note={`${s.moving} min moving`} />
            <Tile label="Average speed" value={`${r1(s.avg)} km/h`} note={`peak ${r1(s.maxSp)} km/h`} />
          </View>

          <TeCard>
            <H4 style={{ marginTop: 0 }}>What the checks found</H4>
            <KvRow label="Points recorded" value={String(s.pings)} />
            <KvRow label="Gaps in the trail" value={s.gaps ? `${s.gaps}, longest ${s.gapMaxMin} min (${r1(s.gapKm)} km)` : 'none'} />
            <KvRow label="Impossible jumps" value={s.jumps ? `${s.jumps} (${r1(s.jumpKm)} km)` : 'none'} />
            <KvRow label="Stops" value={s.stops ? `${s.stops}, ${s.stopMin} min in all` : 'none'} />
            <KvRow label="Started from" value={s.startOff != null ? `${Math.round(s.startOff)} m from the place` : '—'} />
            <KvRow label="Ended at" last value={s.endOff != null ? `${Math.round(s.endOff)} m from the place` : '—'} />
            {s.gaps || s.jumps ? (
              <Note style={{ marginTop: S.sm }}>
                A phone browser stops reading location when the screen locks or another app comes forward, so a gap is as often a pocketed phone as anything else. The employee can be asked.
              </Note>
            ) : null}
          </TeCard>
        </>
      )}

      {leg.expenseId ? (
        <TeCard>
          <H4 style={{ marginTop: 0 }}>What was claimed for it</H4>
          <KvRow label="Paid on" last={leg.routeKm == null} value={`${r1(leg.payKm ?? 0)} km`} />
          {leg.routeKm != null ? <KvRow label="Shortest route" last value={`${r1(leg.routeKm)} km`} /> : null}
        </TeCard>
      ) : null}
    </View>
  )
}
