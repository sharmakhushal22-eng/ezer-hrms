// src/features/expenses/claims/OtherExpensesView.tsx — components/te/TeOtherExpenses.tsx.
//
// Two screens from one component, as on the website:
//   no trip   "Other expenses" (/expenses/other) — loose bills and their monthly claim
//   a trip    "Claim for <trip>" (/expenses/trip-claim/<id>) — every line of that trip
// Lines waiting, the live claim review (POST /api/te/claims/preview: totals,
// flags, approvers) and one Submit (POST /api/te/claims with the declaration).
// Nothing is added up on the phone.
//
// Phone layout: the website's aside (the claim review and Submit) comes right
// after the lines, then "Waiting inside trips" and the notes.
//
// One deliberate change (spec Part 5 caveat): the preview is asked again when
// the snapshot changes, not only when ids / amounts / reasons do, so attaching a
// bill or fixing a date in the form clears a stale blocker here. The snapshot
// query uses structural sharing, so an unchanged snapshot does not re-ask.
import * as React from 'react'
import { View } from 'react-native'
import type { ClaimPreview, Snapshot, TeExpense, TeFlag, TeTrip } from '@web/te/types'
import { linesWaitingInTrips, tripsForLine } from '@web/te/trips-list'
import { claimDateOf, periodFor, type PeriodChoice } from '@web/te/period'
import { isCoTraveller } from '@web/te/co-traveller'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Checkbox, Txt } from '@/ui/primitives'
import { errorText, plural, rs, te, TeApiError } from '../api'
import { Chip, H4, Ico, KvRow, Li, ListCard, Mono, Note, TeCard, TeEmpty } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { toneColors } from '../tones'
import { ErrorFlag, FlagBlock } from './parts'
import { MoveToTrip } from './MoveToTrip'
import { ContactFields, type ContactValue } from '../contact/ContactFields'

export interface OtherExpensesProps {
  snap: Snapshot
  /** Set to claim one trip; left out for the standing "Other expenses" claim. */
  trip?: TeTrip
  onAdd: () => void
  onEdit: (line: TeExpense) => void
  onSubmitted: (claimId: string, message: string) => void
  onBack?: () => void
  onOpenTrip?: (tripId: string) => void
  /** A line moved into a trip: the snapshot is stale (TeOtherExpenses onChanged). */
  onChanged?: (message: string) => void
}

/** A line's flag chip (chip t-crit / t-warn) that wraps instead of running under the amount. */
function FlagChip({ label, block }: { label: string; block: boolean }) {
  const { C } = useTheme()
  const t = toneColors(C, block ? 't-crit' : 't-warn')
  return (
    <Chip tone={block ? 't-crit' : 't-warn'} style={{ maxWidth: '100%' }}
      label={<Txt size={11.5} w={600} color={t.fg} style={{ flexShrink: 1 }}>{label}</Txt>} />
  )
}

/** One saved line (li.click). */
export function ExpenseLineRow({ x, catName, flags, onPress, last, moveLabel, onMove }: {
  x: TeExpense; catName: Map<string, string>; flags: TeFlag[]; onPress?: () => void; last?: boolean
  /** "Move to a trip" / "Cancel" — only on the loose bucket with somewhere to move to. */
  moveLabel?: string; onMove?: () => void
}) {
  const { C } = useTheme()
  const sub = [catName.get(x.cat), x.desc, x.billNo].filter(Boolean).join(' · ')
  return (
    <Li onPress={onPress} last={last} left={<Ico name="other" />}
      right={<Txt size={F.small} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(x.claimed)}</Txt>}>
      <Txt size={F.small} w={700}>{x.merchant || catName.get(x.cat) || x.cat}</Txt>
      {!!sub && <Txt size={F.tiny} tone="muted">{sub}</Txt>}
      {flags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {flags.map(fl => <FlagChip key={fl.code} label={`${fl.code} ${fl.title}`} block={fl.block} />)}
        </View>
      ) : null}
      {onMove && moveLabel ? (
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          <Button size="sm" variant="outline" title={moveLabel} onPress={onMove} icon={<TeIcon name="route" size="sm" color={C.brandDeep} />} />
        </View>
      ) : null}
    </Li>
  )
}

function WaitingInTrips({ rows, onOpenTrip }: { rows: { tripId: string; name: string; count: number; total: number }[]; onOpenTrip?: (id: string) => void }) {
  const { C } = useTheme()
  return (
    <ListCard head="Waiting inside trips" headRight={String(rows.length)}>
      {rows.map((w, i) => (
        <Li key={w.tripId} last={i === rows.length - 1} left={<Ico name="route" />}
          onPress={onOpenTrip ? () => onOpenTrip(w.tripId) : undefined}
          right={(
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Txt size={F.small} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(w.total)}</Txt>
              {onOpenTrip ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Txt size={F.tiny} w={600} tone="brand">Open</Txt><TeIcon name="go" size="sm" color={C.brand} />
                </View>
              ) : null}
            </View>
          )}>
          <Txt size={F.small} w={700}>{w.name}</Txt>
          <Txt size={F.tiny} tone="muted">{plural(w.count, 'bill')} · claimed with that trip, not here</Txt>
        </Li>
      ))}
    </ListCard>
  )
}

/** The aside: "This month's claim" / "This claim". */
function ClaimReview({ trip, period, review, linesCount, declared, setDeclared, busy, error, onSubmit, contactSlot }: {
  trip?: TeTrip; period: PeriodChoice | null; review: ClaimPreview | null; linesCount: number
  /** "How we reach you about this claim" — only on a claim with no trip. */
  contactSlot?: React.ReactNode
  declared: boolean; setDeclared: (v: boolean) => void; busy: boolean
  error: { text: string; flags: TeFlag[] } | null; onSubmit: () => void
}) {
  const stops = review ? [...review.blockers, ...review.needs] : []
  return (
    <TeCard>
      <H4 style={{ marginTop: 0 }} right={period ? <Chip label={period.period.label} tone={period.isLate ? 't-warn' : 't-brand'} plain /> : null}>
        {trip ? 'This claim' : 'This month’s claim'}
      </H4>
      {review ? (
        <>
          <KvRow label="You paid" value={rs(review.claimed)} />
          {review.eligible !== review.claimed ? <KvRow label="Eligible under policy" value={rs(review.eligible)} /> : null}
          {review.outstanding > 0 ? <KvRow label="Advance with you" value={rs(-review.outstanding)} /> : null}
          <KvRow tot last label="Expected to be paid" value={rs(review.net)} />
          {period?.isLate ? (
            <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>{`Its own month is closed, so this goes into ${period.period.label}.`}</Txt>
          ) : null}
          {review.chain.length ? (
            <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>Goes to {review.chain.map(c => c.name || c.role).join(', then ')}.</Txt>
          ) : null}
          {stops.length || review.stop.length ? (
            <View style={{ gap: S.sm, marginTop: S.md }}>
              {stops.map(fl => (
                <FlagBlock key={`${fl.lineId}-${fl.code}`} code={fl.code} title={fl.title} block={fl.block}
                  text={fl.block ? fl.evidence : 'Open the line and add a reason.'} />
              ))}
              {review.stop.map(s => <ErrorFlag key={s} text={s} />)}
            </View>
          ) : null}
          {contactSlot}
          <View style={{ marginTop: S.sm }}>
            <Checkbox checked={declared} onChange={setDeclared}
              label="I confirm these expenses are genuine, were incurred for company work and have not been claimed elsewhere." />
          </View>
          <Button title={busy ? 'Sending…' : 'Submit claim'} size="lg" full onPress={onSubmit}
            disabled={busy || !declared || stops.length > 0 || review.stop.length > 0} />
        </>
      ) : (
        <Txt size={F.tiny} tone="muted">{linesCount ? 'Checking your lines…' : 'Saved expenses are added up here.'}</Txt>
      )}
      {error ? (
        <ErrorFlag text={error.text} lines={error.flags.map(fl => `${fl.code} ${fl.title}`)} style={{ marginTop: S.md }} />
      ) : null}
    </TeCard>
  )
}

export function OtherExpensesView({ snap, trip, onAdd, onEdit, onSubmitted, onBack, onOpenTrip, onChanged }: OtherExpensesProps) {
  const { C } = useTheme()
  const lines = React.useMemo(
    () => snap.expenses.filter(x => !x.other && x.status === 'UNCLAIMED' && (trip ? x.tripId === trip.id : !x.tripId)),
    [snap, trip],
  )
  const catName = React.useMemo(() => new Map(snap.cfg.cats.map(c => [c.id, c.name])), [snap])
  const waitingInTrips = React.useMemo(() => (trip ? [] : linesWaitingInTrips(snap.expenses, snap.trips)), [snap, trip])
  const [preview, setPreview] = React.useState<ClaimPreview | null>(null)
  const [declared, setDeclared] = React.useState(false)
  // How to reach them about this claim — asked only on a claim with no trip,
  // prefilled from ESS (snap.contact), stored on the claim, never written back.
  const [contact, setContact] = React.useState<ContactValue>(() => ({
    contactMobile: snap.contact?.mobile ?? '',
    contactAltMobile: snap.contact?.altMobile ?? '',
    contactEmail: snap.contact?.email ?? '',
  }))
  const [contactField, setContactField] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<{ text: string; flags: TeFlag[] } | null>(null)
  const [moving, setMoving] = React.useState<string | null>(null)
  const signature = lines.map(x => `${x.id}:${x.claimed}:${x.reason}`).join('|')
  const tripId = trip?.id ?? null
  /** Trips this bill could go into — only those the server would accept. */
  const movable = React.useMemo(() => tripsForLine(snap.trips, snap.me, { exclude: tripId }), [snap.trips, snap.me, tripId])

  React.useEffect(() => {
    let current = true
    if (!signature) return
    te.claimPreview(tripId ? { tripId } : {})
      .then(p => { if (current) setPreview(p) })
      .catch(e => { if (current) { setPreview(null); setError({ text: errorText(e), flags: [] }) } })
    return () => { current = false }
  }, [signature, tripId, snap])

  async function submit() {
    setBusy(true); setError(null); setContactField('')
    try {
      const c = await te.claimSubmit(tripId ? { tripId, declared } : { declared, ...contact })
      onSubmitted(c.claim_id, `Claim ${c.claim_no} sent.`)
    } catch (e) {
      setError({ text: errorText(e), flags: e instanceof TeApiError ? e.flags : [] })
      // The server names the field it refused, so the message sits under it.
      if (e instanceof TeApiError && typeof e.field === 'string') setContactField(e.field)
    } finally {
      setBusy(false)
    }
  }

  const review = lines.length ? preview : null
  // The month this claim will land in (lib/te/period mirrors te_period_for). No lines, no claim: no month.
  const period = React.useMemo(() => {
    if (!lines.length) return null
    return periodFor(snap.periods, claimDateOf(trip?.end, lines.map(x => x.date)), snap.today)
  }, [snap.periods, snap.today, trip?.end, lines])

  return (
    <View>
      {trip && onBack ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
          <Button title="Trip" variant="outline" size="sm" onPress={onBack} icon={<TeIcon name="back" size="sm" color={C.brandDeep} />} />
          <Mono>{trip.no}</Mono>
        </View>
      ) : null}
      <View style={{ marginBottom: S.lg, gap: S.md }}>
        {trip ? <Txt size={F.page} w={700}>{`Claim for ${trip.name}`}</Txt> : null}
        <Txt size={F.small} tone="muted">
          {trip
            ? 'Every bill and every journey of this trip, in one claim. Check what each line is worth, then send it.'
            : 'Client meals, courier, parking, printing and other work spends with no travel. Saved lines wait here until you submit them together as one claim.'}
        </Txt>
        <Button title="Add an expense" full onPress={onAdd} icon={<TeIcon name="plus" size="sm" color={C.onAccent} />} />
      </View>

      <ListCard head="Not submitted yet" headRight={String(lines.length)}>
        {lines.length === 0 ? (
          <TeEmpty title="Nothing waiting">
            {!trip ? 'Add a bill and it appears here.'
              : isCoTraveller(trip, snap.me) ? 'Add what you paid for on this trip and it appears here.'
              : 'Close the trip’s journeys and add any other bills, and they appear here.'}
          </TeEmpty>
        ) : null}
        {lines.map((x, i) => (
          <React.Fragment key={x.id}>
            <ExpenseLineRow x={x} catName={catName} onPress={() => onEdit(x)} last={i === lines.length - 1 && moving !== x.id}
              flags={review?.lines.find(l => l.id === x.id)?.flags ?? []}
              moveLabel={!trip && movable.length ? (moving === x.id ? 'Cancel' : 'Move to a trip') : undefined}
              onMove={() => setMoving(moving === x.id ? null : x.id)} />
            {moving === x.id ? (
              <MoveToTrip lineId={x.id} label={x.merchant || catName.get(x.cat) || 'this bill'} trips={movable}
                onMoved={message => { setMoving(null); onChanged?.(message) }} />
            ) : null}
          </React.Fragment>
        ))}
      </ListCard>

      <ClaimReview trip={trip} period={period} review={review} linesCount={lines.length} declared={declared}
        setDeclared={setDeclared} busy={busy} error={error} onSubmit={() => void submit()}
        contactSlot={!tripId ? (
          <ContactFields heading="How we reach you about this claim" value={contact}
            prefilled={snap.contact ? { mobile: snap.contact.mobile, altMobile: snap.contact.altMobile, email: snap.contact.email } : undefined}
            onChange={patch => { setContact(c => ({ ...c, ...patch })); setContactField('') }}
            error={k => (contactField === k ? error?.text ?? '' : '')} />
        ) : null} />
      <Note style={{ marginBottom: S.md }}>{`Bills older than ${snap.cfg.billAgeDays} days cannot be claimed.`}</Note>

      {!trip && waitingInTrips.length ? <WaitingInTrips rows={waitingInTrips} onOpenTrip={onOpenTrip} /> : null}
      {trip ? null : (
        <Note>Travelled within the city? Start a local trip instead. It records the route and works out the amount for you.</Note>
      )}
    </View>
  )
}
