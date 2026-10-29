// src/features/expenses/desk/JourneyReview.tsx — recorded journeys and the two
// things a desk can do about one (components/te/desk/TeJourneyReview.tsx), shared
// by the Travel desk and the Finance desk's Journeys room.
//
// Every rule is lib/te/journey-review.ts (canConfirm / canSendBack / reviewState /
// evidenceNotes) and the grouping is journeyBuckets() in lib/te/desk-buckets.ts —
// both shared, so the buttons offered here are the website's, refusal for refusal.
//
// THE MAP. The website draws the recorded polyline on a Google map (TeRouteMap,
// loaded on request). The app has no map SDK, so "Show the route" opens the two
// recorded ends in Google Maps instead; the facts a reviewer triages on (km, how
// far each end was off the named place, points, bills) are on the card as on the web.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { journeyBuckets } from './buckets'
import type { DeskKind } from '@web/te/desks'
import { canConfirm, canSendBack, confirmPolicy, evidenceNotes, reviewState, reviewTone } from '@web/te/journey-review'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, plural, rs } from '../api'
import { ContactLine } from '../contact/ContactFields'
import { Chip, Flag, Note, TeCard, TeEmpty } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { deskApi, type DeskJourney } from './types'

export type ModeBasis = (mode: string) => string | undefined

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const whenOf = (d: string | null): string => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return ''
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`
}
const offBy = (m: number | null): string => {
  const n = Number(m ?? 0)
  if (!Number.isFinite(n) || n < 50) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km off` : `${Math.round(n)} m off`
}
const TONE = { ok: 't-pos', bad: 't-crit', warn: 't-warn', plain: 'plain' } as const

function routeUrl(j: DeskJourney): string | null {
  const a = j.start_lat != null && j.start_lng != null ? `${j.start_lat},${j.start_lng}` : null
  const b = j.end_lat != null && j.end_lng != null ? `${j.end_lat},${j.end_lng}` : null
  if (a && b) return `https://www.google.com/maps/dir/?api=1&origin=${a}&destination=${b}`
  const one = a ?? b
  return one ? `https://www.google.com/maps/search/?api=1&query=${one}` : null
}

function OneJourney({ j, desk, basisOf, onOpenTrip, onDone, onToast }: {
  j: DeskJourney; desk: DeskKind; basisOf: ModeBasis
  onOpenTrip: (tripId: string) => void; onDone: () => void; onToast: (s: string) => void
}) {
  const { C } = useTheme()
  const [asking, setAsking] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const points = Number(j.gps_points ?? 0)
  const url = routeUrl(j)

  const review = React.useMemo(() => ({
    deskAt: j.desk_confirmed_at, deskBy: j.desk_confirmed_by, deskName: null,
    finAt: j.fin_confirmed_at, finBy: j.fin_confirmed_by, finName: null,
    backAt: j.sent_back_at, backBy: j.sent_back_by, backName: null,
    backDesk: j.sent_back_desk, backWhy: j.sent_back_reason, answer: j.review_answer,
  }), [j])
  const policy = confirmPolicy(j.confirm_policy)
  const state = reviewState(review, policy)
  const tone = reviewTone(state)
  const mayConfirm = canConfirm({ desk, policy, status: 'SUBMITTED', review })
  const mayAsk = canSendBack({ status: 'SUBMITTED', review })
  const notes = evidenceNotes({
    routeLine: j.route_polyline, manual: j.is_manual, noGps: j.no_gps_reason,
    gpsPoints: j.gps_points, mode: j.mode, fileCount: j.file_count, basis: basisOf(j.mode),
  })

  async function act(what: 'confirm' | 'back') {
    setBusy(true); setError('')
    try {
      if (what === 'confirm') {
        await deskApi.legConfirm(j.leg_id, desk)
        onToast(`Journey ${j.leg_no} of ${j.trip_no} confirmed.`)
      } else {
        await deskApi.legSendBack(j.leg_id, desk, reason.trim())
        onToast(`Journey ${j.leg_no} of ${j.trip_no} was sent back.`)
      }
      setAsking(false); setReason('')
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const km = j.gps_km ?? j.planned_km
  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line, gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{`${j.from_name || 'Somewhere'} → ${j.to_name || 'somewhere'}`}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Txt size={F.tiny} tone="muted">{`${j.full_name || 'Unknown'}${j.emp_code ? ` ${j.emp_code}` : ''} · `}</Txt>
            <Pressable onPress={() => onOpenTrip(j.trip_id)} hitSlop={6} accessibilityRole="link">
              <Txt size={F.tiny} w={700} color={C.brand}>{j.trip_no}</Txt>
            </Pressable>
            <Txt size={F.tiny} tone="muted">{` · ${whenOf(j.leg_date)} · ${j.mode}`}</Txt>
          </View>
        </View>
        <Chip tone={TONE[tone.tone]} label={tone.text} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {j.is_subtrip ? <Chip plain label="Local sub-trip" /> : null}
        {km ? <Chip plain label={`${km} km`} /> : null}
        {j.payable_km != null && j.gps_km != null && j.payable_km < j.gps_km ? <Chip tone="t-warn" label={`${j.payable_km} km payable`} /> : null}
        {j.claimed != null && j.claimed > 0 ? <Chip plain label={rs(j.claimed)} /> : null}
        {j.file_count > 0 ? <Chip tone="t-pos" icon="file" label={plural(j.file_count, 'bill')} /> : null}
        {offBy(j.start_off_m) ? <Chip plain label={`Start ${offBy(j.start_off_m)}`} /> : null}
        {offBy(j.end_off_m) ? <Chip plain label={`End ${offBy(j.end_off_m)}`} /> : null}
      </View>

      {j.added_reason ? <Txt size={F.tiny}>{`Added during the trip: ${j.added_reason}`}</Txt> : null}
      {notes.map(n => <Note key={n}>{n}</Note>)}

      {url ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button size="sm" variant="outline" icon={<TeIcon name="pin" size="sm" color={C.brandDeep} />}
            title={`Show the route${points ? ` · ${plural(points, 'point')}` : ''}`}
            onPress={() => void WebBrowser.openBrowserAsync(url)} />
        </View>
      ) : null}

      <ContactLine contact={j.contact} />

      {j.sent_back_at ? <Flag tone="crit" icon="warn" title="Sent back to the traveller">{j.sent_back_reason}</Flag> : null}
      {j.review_answer ? <Note>{`The traveller answered: ${j.review_answer}`}</Note> : null}
      {error ? <Flag tone="crit" icon="warn">{error}</Flag> : null}

      {asking ? (
        <View>
          <Input label="What do you want the traveller to do?" multiline value={reason} onChangeText={setReason} autoFocus
            placeholder="The route stops short of the client office — did you walk the last part, or is the end point wrong?"
            help="They see this, and the trip’s claim waits until they answer." />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title={busy ? 'Sending…' : 'Send it back'} disabled={busy || !reason.trim()} onPress={() => void act('back')} style={{ flex: 1 }} />
            <Button variant="outline" title="Cancel" disabled={busy} onPress={() => { setAsking(false); setReason(''); setError('') }} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {mayConfirm.ok
            ? <Button title={busy ? 'Saving…' : 'Confirm it happened'} disabled={busy} onPress={() => void act('confirm')} />
            : <Txt size={F.tiny} tone="muted">{mayConfirm.why}</Txt>}
          {mayAsk.ok ? (
            <Button variant="outline" title="Ask the traveller" disabled={busy} onPress={() => setAsking(true)}
              icon={<TeIcon name="warn" size="sm" color={C.brandDeep} />} />
          ) : null}
        </View>
      )}
    </View>
  )
}

export function JourneyReview({ rows, desk, basisOf, onOpenTrip, onDone, onToast }: {
  rows: DeskJourney[]; desk: DeskKind; basisOf: ModeBasis
  onOpenTrip: (tripId: string) => void; onDone: () => void; onToast: (s: string) => void
}) {
  const { C } = useTheme()
  const buckets = React.useMemo(() => journeyBuckets(rows, desk), [rows, desk])
  const [open, setOpen] = React.useState<Record<string, boolean>>({})

  if (!rows.length) {
    return (
      <TeCard>
        <TeEmpty title="No journeys to look at">
          Recorded journeys appear here once a traveller has reported them, including the local sub-trips they add while they are away.
        </TeEmpty>
      </TeCard>
    )
  }

  return (
    <View>
      <Note style={{ marginBottom: S.md }}>
        Confirming records that you looked and agreed; it pays nothing. Asking the traveller a question holds that trip’s claim until they answer.
      </Note>
      {buckets.map(b => {
        const isOpen = open[b.tripId] ?? buckets.length === 1
        return (
          <TeCard key={b.tripId} style={b.sentBack ? { borderColor: C.criticalEdge } : b.waiting ? { borderColor: C.warningEdge } : undefined}>
            <Pressable onPress={() => setOpen(o => ({ ...o, [b.tripId]: !isOpen }))} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, minHeight: 44 }}>
              <View style={{ paddingTop: 2 }}><TeIcon name={isOpen ? 'down' : 'rightc'} size="sm" color={C.muted} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.tiny} w={700} tone="muted" style={{ fontFamily: 'monospace' }}>{b.tripNo}</Txt>
                <Txt size={F.small} w={700}>{b.tripName || 'A trip'}</Txt>
                <Txt size={F.tiny} tone="muted">
                  {`${b.who || 'A traveller'}${b.empCode ? ` · ${b.empCode}` : ''} · ${plural(b.journeys.length, 'journey')}`}
                  {b.subTrips ? (b.subTrips === 1 ? ' · one a sub-trip' : ` · ${b.subTrips} sub-trips`) : ''}
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {b.sentBack ? <Chip tone="t-crit" label={`${b.sentBack} sent back`} /> : null}
                  {b.waiting ? <Chip tone="t-warn" label={`${b.waiting} to confirm`} /> : <Chip plain tone="t-pos" label="All confirmed" />}
                </View>
              </View>
            </Pressable>
            {isOpen ? (
              <View style={{ marginTop: S.sm }}>
                <Pressable onPress={() => onOpenTrip(b.tripId)} accessibilityRole="link" hitSlop={6} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
                  <Txt size={F.small} w={700} color={C.brand}>{`Open ${b.tripNo}`}</Txt>
                </Pressable>
                {b.journeys.map(j => (
                  <OneJourney key={j.leg_id} j={j} desk={desk} basisOf={basisOf} onOpenTrip={onOpenTrip} onDone={onDone} onToast={onToast} />
                ))}
              </View>
            ) : null}
          </TeCard>
        )
      })}
    </View>
  )
}
