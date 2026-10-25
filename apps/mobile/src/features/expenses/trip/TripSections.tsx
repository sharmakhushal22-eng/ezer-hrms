// src/features/expenses/trip/TripSections.tsx — the cards below the status card on a
// trip (components/te/trip/TeTripDetail.tsx): What you spent on this trip ·
// Hotels you asked for · Route · Estimate · Claim … · Stays and tickets ·
// Advance · History. Module-level components; they read the TripView.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { TeLeg } from '@web/te/types'
import { foodBalanceText } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { day, plural, rs, when } from '../api'
import { modeIcon } from '../tones'
import { FileLink } from '../ui/FilePick'
import { TeIcon } from '../ui/TeIcon'
import { TripMap, MapLinks } from '../ui/TripMap'
import { Chip, Flag, KvRow, Mono, TeCard } from '../ui/kit'
import { CardHead, IcoB, LegNo, Meter } from './parts'
import { StayRequest } from './StayRequest'
import { LEG_KIND, LEG_STATE } from './words'
import type { TripView } from './view'

// ── what you spent on this trip — the only door to a hotel or a food bill ──
export function BillsCard({ v, onAddBill, onClaim }: { v: TripView; onAddBill: () => void; onClaim: () => void }) {
  const { C } = useTheme()
  const { myLines, riding, detail, food } = v
  const text = myLines.length
    ? `${rs(myLines.reduce((a, x) => a + (Number(x.claimed) || 0), 0))} saved so far${riding ? `, in a claim of your own rather than ${detail.employee.name}’s` : ''}. Add the rest as you go.`
    : `The hotel, food, cabs and anything else you paid for${riding ? `. They go in a claim of your own, not ${detail.employee.name}’s` : '. Add them as you go rather than from memory afterwards'}.`
  return (
    <TeCard>
      <CardHead title="What you spent on this trip"
        right={myLines.length ? <Chip plain tone="t-brand" label={`${plural(myLines.length, 'bill')} saved`} /> : undefined} />
      <Txt size={F.tiny} tone="muted">{text}</Txt>
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
        <Button style={{ flex: 1 }} title="Add a bill" icon={<TeIcon name="plus" size="sm" color={C.onAccent} />} onPress={onAddBill} />
        {myLines.length ? (
          <Button variant="outline" title={`See all ${myLines.length}`} icon={<TeIcon name="go" size="sm" color={C.brandDeep} />} onPress={onClaim} />
        ) : null}
      </View>
      {food ? (
        <Meter label="Food budget" figure={`${rs(food.spent)} of ${rs(food.budget)}`} pct={food.pct} tone={food.tone}
          note={foodBalanceText(food, rs)} />
      ) : null}
    </TeCard>
  )
}

// ── the hotels asked for while planning ──
export function HotelsCard({ v }: { v: TripView }) {
  const { C } = useTheme()
  const { t, decided } = v
  return (
    <TeCard>
      <CardHead title="Hotels you asked for" right={<Chip plain label={plural(t.stayOptions.length, 'option')} />} />
      {decided ? (
        <Flag tone={decided.tone === 'ok' ? 'ok' : 'warn'} icon={decided.tone === 'ok' ? 'check' : 'alert'} style={{ marginBottom: S.sm }}>
          {decided.text}
        </Flag>
      ) : (
        <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>
          {t.stayBy === 'desk' ? 'The Travel Desk picks one of these and books it.' : 'You book one of these yourself and claim it back.'}
        </Txt>
      )}
      <View style={{ gap: S.sm }}>
        {t.stayOptions.map((o, i) => {
          const picked = t.stay?.status === 'CHOSEN' && t.stay.chosen === i
          return (
            <View key={i} style={[{ flexDirection: 'row', alignItems: 'center', gap: S.sm }, picked && { backgroundColor: C.positiveTint, borderRadius: R.sm, padding: 6, paddingHorizontal: 8 }]}>
              <IcoB name="home" sm />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Txt size={F.small} w={700}>{`${i + 1}. ${o.name}`}</Txt>
                  {picked ? <Chip tone="t-pos" label="Chosen" /> : null}
                </View>
                <Txt size={F.tiny} tone="muted">
                  {[o.location, o.price ? `about ${rs(o.price)} a night` : ''].filter(Boolean).join(' · ') || 'No other details given'}
                </Txt>
              </View>
              {o.url ? <FileLink path={o.url} name="Open" small /> : null}
            </View>
          )
        })}
      </View>
    </TeCard>
  )
}

/** One journey on the route card (.tw-leg.click). */
function RouteLeg({ l, v, last, onOpen }: { l: TeLeg; v: TripView; last: boolean; onOpen: (l: TeLeg) => void }) {
  const { C } = useTheme()
  const sub = `${v.t.scope === 'local' ? '' : `${day(l.date)} · `}${l.mode}${l.bookedBy === 'desk' ? ', Travel Desk' : ''} · ${l.plannedKm} km · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}${LEG_KIND[l.kind] ? ` · ${LEG_KIND[l.kind]}` : ''}`
  return (
    <Pressable onPress={() => onOpen(l)} accessibilityRole="button" accessibilityLabel={`Journey ${l.n}: ${v.pname(l.from)} → ${v.pname(l.to)}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, paddingHorizontal: 4, minHeight: 52, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
      <LegNo n={l.n} />
      <IcoB name={modeIcon(l.mode)} sm />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700}>{`${v.pname(l.from)} → ${v.pname(l.to)}`}</Txt>
        <Txt size={F.tiny} tone="muted">{sub}</Txt>
      </View>
      <Chip plain label={LEG_STATE[l.status] ?? l.status} />
    </Pressable>
  )
}

// ── the route and its journeys ──
export function RouteCard({ v, onAddLeg, onOpenLeg }: { v: TripView; onAddLeg: () => void; onOpenLeg: (l: TeLeg) => void }) {
  const { C } = useTheme()
  const { t, legs, mine, st, places, detail } = v
  return (
    <TeCard>
      <CardHead title="Route" right={
        <>
          <Txt size={F.tiny} tone="muted">{plural(legs.length, 'journey')}</Txt>
          {mine && (st === 'ONGOING' || st === 'COMPLETED') ? (
            <Button size="sm" variant="outline" title="Add a journey" icon={<TeIcon name="plus" size="sm" color={C.brandDeep} />} onPress={onAddLeg} />
          ) : null}
        </>
      } />
      <TripMap
        legs={legs.map(l => ({ from: l.from, to: l.to, mode: l.mode }))}
        points={(t.points || []).map(p => p.place).filter(Boolean)}
        places={places}
        label={`Map of ${t.name}`} />
      <MapLinks points={(t.points || []).map(p => detail.places[p.place]).filter(Boolean)} scope={t.scope} label={t.name} />
      <View>
        {legs.map((l, i) => <RouteLeg key={l.id} l={l} v={v} last={i === legs.length - 1} onOpen={onOpenLeg} />)}
      </View>
    </TeCard>
  )
}

const ESTIMATE_ROWS = (stayBy: string) => ([
  ['travel', 'Travel you pay'], ['desk', 'Tickets the Travel Desk books'],
  ['hotel', stayBy === 'desk' ? 'Hotel, Travel Desk books' : 'Hotel'], ['meals', 'Food'], ['conv', 'Local rides at the destination'],
] as const)

export function EstimateCard({ v }: { v: TripView }) {
  const { t } = v
  return (
    <TeCard>
      <CardHead title="Estimate" right={<Txt size={F.tiny} tone="muted">from the plan and your limits</Txt>} />
      {ESTIMATE_ROWS(t.stayBy).filter(([k]) => t.estimate[k]).map(([k, label]) => (
        <KvRow key={k} label={label} value={rs(t.estimate[k])} />
      ))}
      <KvRow tot last label="Total" value={rs(t.estimateTotal)} />
    </TeCard>
  )
}

export function ClaimsCards({ v, onOpenClaim }: { v: TripView; onOpenClaim: (id: string) => void }) {
  return (
    <>
      {v.claims.map(c => (
        <TeCard key={c.id}>
          <CardHead title={<Txt size={F.lead} w={700}>Claim <Mono size={13}>{c.no}</Mono></Txt>}
            right={<Chip plain label={c.status.replace(/_/g, ' ').toLowerCase()} />} />
          <KvRow label="Claimed" value={rs(c.claimed)} />
          <KvRow label="Approved" value={rs(c.approved)} last={c.net == null} />
          {c.net != null ? <KvRow tot last label={c.net >= 0 ? 'Paid to you' : 'Balance on advance'} value={rs(Math.abs(c.net))} /> : null}
          <Button full size="sm" variant="outline" title="Track this claim" style={{ marginTop: S.sm }} onPress={() => onOpenClaim(c.id)} />
        </TeCard>
      ))}
    </>
  )
}

// ── stays and tickets; a REQUESTED one is the employee asking the desk ──
export function StaysCard({ v, asking, onAsk, onCancelAsk, onAsked }: {
  v: TripView; asking: boolean; onAsk: () => void; onCancelAsk: () => void; onAsked: (msg: string) => void
}) {
  const { detail, canAskStay, pname } = v
  return (
    <TeCard>
      <CardHead title="Stays and tickets"
        right={canAskStay && !asking ? <Button size="sm" variant="outline" title="Ask for a stay" onPress={onAsk} /> : undefined} />
      <View style={{ gap: S.sm }}>
        {detail.bookings.map(b => {
          const asked = b.status === 'REQUESTED'
          const off = b.status === 'CANCELLED'
          const d = b.details ?? {}
          return (
            <Flag key={b.id} tone={asked || off ? 'info' : 'ok'} off={off} icon={off ? 'close' : asked ? 'clock' : 'check'} title={b.vendor}>
              <Txt size={12.5} tone="soft">
                {asked ? 'Asked the Travel Desk' : off ? 'Cancelled' : `${b.kind === 'hotel' ? 'Booking' : 'PNR'} ${b.pnr ?? ''}`}
                {' · '}{rs(b.amount)}{asked ? ' expected' : ''}
                {d.check_in ? ` · ${day(d.check_in)}${d.check_out ? ` to ${day(d.check_out)}` : ''}` : ''}
              </Txt>
              {d.address || d.room || d.note ? (
                <Txt size={F.tiny} tone="muted">{[d.address, d.room, d.note].filter(Boolean).join(' · ')}</Txt>
              ) : null}
              {b.ticket ? (
                <View style={{ marginTop: 6 }}>
                  <FileLink path={b.ticket} name={asked ? `Open on ${d.platform || 'the booking site'}` : 'Open the ticket'} small />
                </View>
              ) : null}
            </Flag>
          )
        })}
      </View>
      {asking ? <StayRequest detail={detail} placeName={pname} onCancel={onCancelAsk} onDone={onAsked} /> : null}
    </TeCard>
  )
}

export function AdvanceCard({ v }: { v: TripView }) {
  const a = v.detail.advance
  if (!a) return null
  return (
    <TeCard>
      <CardHead title="Advance" right={<Chip plain label={a.display} />} />
      <KvRow label="Asked" value={rs(a.requested)} />
      {a.approved != null ? <KvRow label="Approved" value={rs(a.approved)} /> : null}
      <KvRow label="Still with you" value={rs(a.outstanding)} last />
    </TeCard>
  )
}

export function HistoryCard({ v }: { v: TripView }) {
  const { C } = useTheme()
  const rows = v.detail.timeline.filter(e => !e.internal)
  return (
    <TeCard>
      <CardHead title="History" />
      <View style={{ gap: S.sm }}>
        {rows.map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', paddingBottom: S.sm, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.small} w={700}>{e.text}</Txt>
              <Txt size={F.tiny} tone="muted">{`${e.name ?? 'System'}${e.role ? ` · ${e.role}` : ''}`}</Txt>
            </View>
            <Txt size={F.tiny} tone="muted">{when(e.at)}</Txt>
          </View>
        ))}
      </View>
    </TeCard>
  )
}
