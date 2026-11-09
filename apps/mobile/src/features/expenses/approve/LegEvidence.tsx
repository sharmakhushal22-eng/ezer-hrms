// src/features/expenses/approve/LegEvidence.tsx — the evidence behind one journey of a
// claim's trip (components/te/approve/TeLegEvidence.tsx). No verdict, no API call.
//
// The map is the from → to line only (the web's TeTripMap: the detail reads carry
// no recorded track), drawn by the keyless schematic. Then the server's numbers.
import * as React from 'react'
import { View } from 'react-native'
import type { MapPlace } from '@web/te/trip-map'
import type { TeLeg, TePlaceBrief } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { when } from '../api'
import { Chip, Flag, KvRow, Note, TeCard } from '../ui/kit'
import { TripMap } from '../ui/TripMap'

const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  const { C } = useTheme()
  return (
    <View style={{ width: '48.5%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 14 }}>
      <Txt size={F.micro} w={600} tone="muted">{label}</Txt>
      <Txt size={F.title} w={700} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
      <Txt size={F.micro} tone="muted">{note}</Txt>
    </View>
  )
}

export function LegEvidence({ leg, places }: { leg: TeLeg; places: Record<string, TePlaceBrief> }) {
  const s = leg.stats
  const pname = (id: string) => places[id]?.s ?? ''
  const mapPlaces = new Map<string, MapPlace>(Object.entries(places).map(([id, p]) => [id, { id, s: p.s, lat: p.lat, lng: p.lng }]))
  return (
    <View>
      <TeCard>
        <Txt size={F.micro} w={700} tone="muted" upper>Journey {leg.n}</Txt>
        <Txt size={22} style={{ fontFamily: SERIF, marginTop: 2 }}>{pname(leg.from)} → {pname(leg.to)}</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>
          {leg.mode}{leg.startedAt ? ` · started ${when(leg.startedAt)}` : ''}{leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}
        </Txt>
        {(leg.manual || leg.gps === 'checkin' || !!leg.noGps) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
            {leg.manual && <Chip label="Added without GPS" tone="t-warn" />}
            {leg.gps === 'checkin' && <Chip label="Check-ins" plain />}
            {!!leg.noGps && <Chip label={leg.noGps} tone="t-warn" />}
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
            <TripMap legs={[{ from: leg.from, to: leg.to, mode: leg.mode }]} points={[leg.from, leg.to]} places={mapPlaces} label={`Journey ${leg.n} on the map`} />
            <Txt size={F.tiny} tone="muted">The straight line between the two places. The recorded trail itself is held against the leg and is what the distance below was measured from.</Txt>
          </TeCard>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: S.sm, marginBottom: S.md }}>
            <Tile label="GPS distance" value={`${r1(s.gpsKm)} km`} note="measured by the phone" />
            <Tile label="Planned" value={`${r1(leg.plannedKm)} km`} note="shortest route" />
            <Tile label="Paid on" value={`${r1(s.payBase)} km`} note="after the checks" />
            <Tile label="Time" value={`${s.dur} min`} note={`${s.moving} min moving`} />
            <Tile label="Average speed" value={`${r1(s.avg)} km/h`} note={`peak ${r1(s.maxSp)} km/h`} />
          </View>
          <TeCard>
            <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>What the checks found</Txt>
            <KvRow label="Points recorded" value={String(s.pings)} />
            <KvRow label="Gaps in the trail" value={s.gaps ? `${s.gaps}, longest ${s.gapMaxMin} min (${r1(s.gapKm)} km)` : 'none'} />
            <KvRow label="Impossible jumps" value={s.jumps ? `${s.jumps} (${r1(s.jumpKm)} km)` : 'none'} />
            <KvRow label="Stops" value={s.stops ? `${s.stops}, ${s.stopMin} min in all` : 'none'} />
            <KvRow label="Started from" value={s.startOff != null ? `${Math.round(s.startOff)} m from the place` : '—'} />
            <KvRow label="Ended at" value={s.endOff != null ? `${Math.round(s.endOff)} m from the place` : '—'} last />
            {(!!s.gaps || !!s.jumps) && (
              <Note style={{ marginTop: S.sm }}>A phone browser stops reading location when the screen locks or another app comes forward, so a gap is as often a pocketed phone as anything else. The employee can be asked.</Note>
            )}
          </TeCard>
        </>
      )}

      {!!leg.expenseId && (
        <TeCard>
          <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>What was claimed for it</Txt>
          <KvRow label="Paid on" value={`${r1(leg.payKm ?? 0)} km`} last={leg.routeKm == null} />
          {leg.routeKm != null && <KvRow label="Shortest route" value={`${r1(leg.routeKm)} km`} last />}
        </TeCard>
      )}
    </View>
  )
}
