'use client'
// components/te/approve/TeLegEvidence.tsx — the evidence behind one leg.
// Screen 94.
//
// An approver looking at a leg is usually asking one of two questions: is
// this distance real, and was the person where they say they were. So this
// shows the recorded trail against the planned route, and the numbers the
// server derived from it — side by side, because either alone can mislead.
//
// NOTHING HERE IS A VERDICT. Every number is te_leg_stats as the engine
// computed it; the gaps and jumps are counted by the server, not inferred
// from the shape of the line. The screen's job is to let a person see what
// the flags are talking about, and decide for themselves.
import type { TeLeg, TePlaceBrief } from '@/lib/te/types'
import { when } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeTripMap from '../plan/TeTripMap'
import type { MapPlace } from '@/lib/te/trip-map'

export default function TeLegEvidence({ leg, places, onBack }: {
  leg: TeLeg
  places: Record<string, TePlaceBrief>
  onBack: () => void
}) {
  const s = leg.stats
  const pname = (id: string) => places[id]?.s ?? ''
  const mapPlaces = new Map<string, MapPlace>(
    Object.entries(places).map(([id, p]) => [id, { id, s: p.s, lat: p.lat, lng: p.lng }]),
  )

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Claim</button>
        <span className="mono muted">Journey {leg.n}</span>
      </div>

      <div className="card">
        <div className="row sp top">
          <div>
            <div className="eyebrow">Journey {leg.n}</div>
            <h1 className="tname">{pname(leg.from)} → {pname(leg.to)}</h1>
            <p className="muted">
              {leg.mode}{leg.startedAt ? ` · started ${when(leg.startedAt)}` : ''}{leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}
            </p>
          </div>
          <div className="row tight">
            {leg.manual ? <span className="chip t-warn">Added without GPS</span> : null}
            {leg.gps === 'checkin' ? <span className="chip plain">Check-ins</span> : null}
            {leg.noGps ? <span className="chip t-warn">{leg.noGps}</span> : null}
          </div>
        </div>
      </div>

      {/* A leg with no recorded trail has nothing to show, and saying so is
          more use than an empty panel the approver has to interpret. */}
      {leg.manual || !s ? (
        <div className="flag warn">
          <TeIcon name="alert" />
          <div className="tx">
            <b>{leg.manual ? 'This journey was not recorded' : 'No GPS record for this journey'}</b>
            <p>
              {leg.noGps || leg.skipReason || 'It is paid on the planned distance rather than a measured one.'}
              {leg.plannedKm ? ` The plan was ${leg.plannedKm} km.` : ''}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <TeTripMap
              legs={[{ from: leg.from, to: leg.to, mode: leg.mode }]}
              points={[leg.from, leg.to]}
              places={mapPlaces}
              label={`Journey ${leg.n} on the map`}
            />
            <p className="small muted">
              The straight line between the two places. The recorded trail itself is held against the leg and is
              what the distance below was measured from.
            </p>
          </div>

          <div className="g6 five">
            <Tile label="GPS distance" value={`${r1(s.gpsKm)} km`} note="measured by the phone" />
            <Tile label="Planned" value={`${r1(leg.plannedKm)} km`} note="shortest route" />
            <Tile label="Paid on" value={`${r1(s.payBase)} km`} note="after the checks" />
            <Tile label="Time" value={`${s.dur} min`} note={`${s.moving} min moving`} />
            <Tile label="Average speed" value={`${r1(s.avg)} km/h`} note={`peak ${r1(s.maxSp)} km/h`} />
          </div>

          <div className="card">
            <div className="ch"><h3>What the checks found</h3></div>
            <dl className="kv">
              <dt>Points recorded</dt><dd>{s.pings}</dd>
              <dt>Gaps in the trail</dt>
              <dd>{s.gaps ? `${s.gaps}, longest ${s.gapMaxMin} min (${r1(s.gapKm)} km)` : 'none'}</dd>
              <dt>Impossible jumps</dt><dd>{s.jumps ? `${s.jumps} (${r1(s.jumpKm)} km)` : 'none'}</dd>
              <dt>Stops</dt><dd>{s.stops ? `${s.stops}, ${s.stopMin} min in all` : 'none'}</dd>
              <dt>Started from</dt><dd>{s.startOff != null ? `${Math.round(s.startOff)} m from the place` : '—'}</dd>
              <dt>Ended at</dt><dd>{s.endOff != null ? `${Math.round(s.endOff)} m from the place` : '—'}</dd>
            </dl>
            {s.gaps || s.jumps ? (
              <div className="note">
                <TeIcon name="info" size="sm" />
                <span>
                  A phone browser stops reading location when the screen locks or another app comes forward, so a
                  gap is as often a pocketed phone as anything else. The employee can be asked.
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}

      {leg.expenseId ? (
        <div className="card">
          <div className="ch"><h3>What was claimed for it</h3></div>
          <dl className="kv">
            <dt>Paid on</dt><dd>{r1(leg.payKm ?? 0)} km</dd>
            {leg.routeKm != null ? <><dt>Shortest route</dt><dd>{r1(leg.routeKm)} km</dd></> : null}
          </dl>
        </div>
      ) : null}
    </div>
  )
}

const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="tile"><div className="l">{label}</div><div className="v num">{value}</div><div className="s">{note}</div></div>
}
