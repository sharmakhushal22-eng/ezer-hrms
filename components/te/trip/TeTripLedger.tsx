'use client'
// components/te/trip/TeTripLedger.tsx — everything this trip cost, in one place.
//
// WHAT WAS MISSING. te_trip_detail has always returned every expense line on
// the trip, every claim and every booking — including the hotel and food bills,
// which are trip-only categories and have no other home. The trip screen showed
// none of them as rows: only a count and a rupee total of the reader's own
// UNCLAIMED lines. So the one screen named after the trip could not answer
// "what did this trip cost", and a stay, a meal and a sub-trip's fare each had
// to be found somewhere else.
//
// WHO SEES WHOSE MONEY. Not everything to everybody, deliberately. The trip
// screen scopes to the reader on purpose — there is a comment in TeTripDetail
// recording that showing one traveller what a colleague had been paid was a bug
// somebody fixed. So:
//
//   a traveller   their own lines, plus what the COMPANY paid for directly
//                 (the desk's tickets and hotels, paid_by = 'company'), which
//                 is not anybody's private reimbursement and is half the cost
//                 of the trip.
//   a desk, Finance, an approver   all of it, with each line's owner named.
//                 That is the job: Finance cannot verify a trip's cost from a
//                 third of it.
//
// GROUPED BY WHAT IT IS, not by who entered it or when. A reader asking about a
// trip asks "how much was the stay", "how much got spent on cabs" — grouping by
// date or by claim answers a question nobody is asking. The groups come from
// te_categories.grp, which already says Travel / Stay / Food / Local travel /
// Other, so this invents no taxonomy of its own.
//
// SUB-TRIPS ARE NAMED AS SUCH. A line whose journey was added during the trip
// is the local hop somebody made across the destination city, and reads
// differently from the flight that got them there — so the row says so rather
// than leaving the reader to infer it from the category.
//
// THREE KINDS OF MONEY, NOT ONE. A trip is paid for in three ways and this card
// now shows all three, because a total that covers one of them is a total
// nobody can act on:
//
//   bills       somebody paid and wants back
//   bookings    the Travel Desk bought and the company paid for directly —
//               these were missing entirely until 185 exposed the booking id
//               needed to add them without double-counting the ones that
//               already have a mirror bill
//   the advance paid out before anybody travelled, which is not a cost at all
//               but decides who owes whom at the end
//
// A booking nobody has made yet is shown and NOT added up: it is a request, and
// counting it would say money had gone when it hasn't.
import { useCallback, useMemo } from 'react'
import type { TeCategory, TeTripDetail as TripDetail } from '@/lib/te/types'
import { ledgerRows, ledgerTotals } from '@/lib/te/trip-ledger'
import { plural, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'

/** What a journey is doing, in the words the trip screen already uses. */
const LEG_STATE: Record<string, string> = {
  PLANNED: 'Not started', ACTIVE: 'On the road', PAUSED: 'Stopped',
  ENDED: 'Ended, report to save', SUBMITTED: 'Recorded', SKIPPED: 'Skipped',
}
/** The distance to show: what GPS measured, else what was planned. */
const legKm = (l: { gpsKm?: number | null; routeKm?: number | null; plannedKm?: number | null }): string => {
  const km = Number(l.gpsKm ?? 0) || Number(l.routeKm ?? 0) || Number(l.plannedKm ?? 0)
  return km ? `${km} km` : ''
}

const STATUS_WORD: Record<string, string> = {
  UNCLAIMED: 'not claimed yet',
  IN_CLAIM: 'in a claim',
  APPROVED: 'approved',
  PAID: 'paid',
  REJECTED_FINAL: 'rejected',
  REJECTED_REFILE: 'sent back',
  EXPIRED: 'expired',
}

export default function TeTripLedger({ detail, me, everyone, cats }: {
  detail: TripDetail
  me: string
  everyone: boolean
  cats?: TeCategory[]
}) {
  const t = detail.trip
  // Co-travellers' names come from what was entered on the plan; the owner's
  // from the trip itself. No per-line name reaches the browser from SQL, so
  // this is the join that makes "whose bill is this" answerable.
  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    if (detail.employee?.id) m.set(detail.employee.id, detail.employee.name)
    for (const p of t.people ?? []) if (p.emp) m.set(p.emp, p.name || p.id || '')
    return (id: string) => m.get(id) || 'Another traveller'
  }, [detail.employee, t.people])

  const owner = detail.employee?.id
  /** A journey's two ends, named. The ids mean nothing to a reader. */
  const legEnds = useCallback(
    (r: { leg: { from: string; to: string } }) =>
      `${detail.places[r.leg.from]?.s ?? '…'} → ${detail.places[r.leg.to]?.s ?? '…'}`,
    [detail.places],
  )

  const rows = useMemo(
    () => ledgerRows({
      expenses: detail.expenses ?? [], legs: detail.legs ?? [], bookings: detail.bookings ?? [],
      me, everyone, nameOf, cats, tripOwner: owner,
      // The hotel the desk picked, so it is in the trip's own record from the
      // moment it is decided rather than from whenever the bill turns up.
      stay: t.stay ?? null,
    }),
    [detail.expenses, detail.legs, detail.bookings, me, everyone, nameOf, cats, owner, t.stay],
  )
  // The advance belongs to the trip's own traveller — the database allows one
  // live advance per trip — so only they can have it netted against what they
  // are owed. On a desk's screen it is shown, not netted.
  const totals = useMemo(
    () => ledgerTotals(rows, { advance: detail.advance, advanceMine: !!owner && owner === me }),
    [rows, detail.advance, owner, me],
  )

  if (!rows.length) {
    return (
      <div className="card">
        <div className="ch"><h3>Everything on this trip</h3></div>
        <p className="small muted">
          Nothing has been spent on {t.no} yet. Tickets the desk books, the hotel, food and every journey&rsquo;s fare
          appear here as they are recorded.
        </p>
      </div>
    )
  }

  return (
    <div className="card pad0">
      <div className="ch pad">
        <h3>Everything on this trip</h3>
        <span className="small muted">
          {everyone ? 'Every traveller on it' : 'Yours, and what the company paid for'}
        </span>
      </div>

      {totals.byGroup.map(g => (
        <div key={g.group}>
          <div className="day">
            <span>{g.group}</span>
            {/* A group heading reading "₹0" is noise: Journeys and Stay can
                hold rows that are a record rather than a cost. The count says
                what is in it; the money only appears when there is some. */}
            <span>{g.self + g.company ? rs(g.self + g.company) : <span className="muted">{plural(g.n, 'item')}</span>}</span>
          </div>
          {rows.filter(r => r.group === g.group).map(r => (
            <div
              key={
                r.kind === 'expense' ? r.line.id
                  : r.kind === 'booking' ? `bk-${r.booking.id}`
                    : r.kind === 'journey' ? `jn-${r.leg.id}`
                      : `stay-${r.name}`
              }
              className="li"
            >
              <span className="ico">
                <TeIcon
                  name={
                    r.kind === 'journey' ? (r.subTrip ? 'route' : 'car')
                      : r.subTrip ? 'route'
                        : r.group === 'Stay' ? 'home'
                          : r.group === 'Travel' ? 'plane' : 'receipt'
                  }
                  size="sm"
                />
              </span>
              <div className="grow">
                <div className="b">
                  {r.kind === 'expense' ? (r.line.merchant || r.catName)
                    : r.kind === 'booking' ? (r.booking.vendor || r.catName)
                      : r.kind === 'journey' ? `${r.catName}: ${legEnds(r)}`
                        : r.name}
                  {/* A sub-trip is the thing somebody added mid-trip; say so on
                      the row rather than leaving it to be inferred. */}
                  {r.subTrip ? <span className="chip plain t-brand">Sub-trip</span> : null}
                  {r.kind === 'journey' && r.lines.length === 0 && r.leg.status === 'SUBMITTED'
                    ? <span className="chip plain">No bill</span> : null}
                  {/* Said on the row, not only in the total: a reader scanning
                      the list must not read a request as a cost. */}
                  {r.pending && r.kind !== 'journey' ? <span className="chip t-warn">{r.kind === 'stay' ? 'No bill yet' : 'Not booked yet'}</span> : null}
                </div>
                <div className="small muted">
                  {r.kind === 'expense' ? (
                    <>
                      {r.line.no ? <span className="mono">{r.line.no}</span> : null}
                      {r.line.date ? <> · {r.line.date}</> : null}
                    </>
                  ) : r.kind === 'booking' ? (
                    <>
                      <span className="mono">{r.booking.no}</span>
                      {r.booking.pnr ? <> · {r.booking.pnr}</> : null}
                      <> · booked by the travel desk</>
                    </>
                  ) : r.kind === 'journey' ? (
                    <>
                      {LEG_STATE[r.leg.status] ?? r.leg.status}
                      {legKm(r.leg) ? <> · {legKm(r.leg)}</> : null}
                      {r.leg.mode ? <> · {r.leg.mode}</> : null}
                      {r.lines.length ? <> · {plural(r.lines.length, 'bill')}</> : null}
                    </>
                  ) : (
                    <>the travel desk chose it · the bill comes later</>
                  )}
                  {r.kind !== 'journey' && r.leg ? <> · journey {r.leg.n}</> : null}
                  {/* Named only where the reader is entitled to know. */}
                  {r.who && !r.mine ? <> · {r.who}</> : null}
                  {r.company > 0 && r.self === 0 ? <> · paid by the company</> : null}
                  {r.kind === 'expense' && STATUS_WORD[r.line.status] ? <> · {STATUS_WORD[r.line.status]}</> : null}
                </div>
              </div>
              {r.kind === 'expense'
                ? (r.line.file ? <TeFileLink path={r.line.file.path} name={r.line.file.name} small /> : null)
                : r.kind === 'booking'
                  ? (r.booking.ticket ? <TeFileLink path={r.booking.ticket} name={`${r.booking.no}-ticket`} small /> : null)
                  : null}
              {/* A journey with nothing against it shows a dash, not a zero: it
                  has not cost nothing, it has not been billed. */}
              <span className="amt">{r.amount || r.pendingAmt ? rs(r.amount || r.pendingAmt) : <span className="muted">—</span>}</span>
            </div>
          ))}
        </div>
      ))}

      {/* THE TWO HALVES KEPT APART. What somebody is owed and what the company
          has already paid are different kinds of money, and one total hiding
          both is the number nobody can act on. */}
      <div className="day">
        <span>Total on {t.no}</span>
        <span>{rs(totals.total)}</span>
      </div>
      <dl className="kv pad">
        {totals.self ? <><dt>{everyone ? 'Claimed by travellers' : 'Yours to claim'}</dt><dd>{rs(totals.self)}</dd></> : null}
        {totals.company ? <><dt>Paid by the company directly</dt><dd>{rs(totals.company)}</dd></> : null}
        {/* Outside the total on purpose, and labelled so it reads that way. */}
        {totals.pending ? <><dt>Asked for, not booked yet</dt><dd>{rs(totals.pending)}</dd></> : null}
        {totals.advance ? <><dt>Advance already paid</dt><dd>{rs(totals.advance)}</dd></> : null}
        {totals.advance && totals.outstanding !== totals.advance
          ? <><dt>Advance still outstanding</dt><dd>{rs(totals.outstanding)}</dd></>
          : null}
      </dl>

      {/* WHO OWES WHOM, which is the question somebody actually came here with.
          Only shown where it can be answered honestly: the advance is one
          traveller's, so a desk reading another person's trip is shown the
          parts and not a net that would mean nothing. */}
      {totals.net !== null && (totals.mine || totals.outstanding) ? (
        <div className={`flag ${totals.net < 0 ? 'warn' : 'ok'}`}>
          <TeIcon name={totals.net < 0 ? 'alert' : 'check'} size="sm" />
          <span>
            {totals.net > 0 ? (
              <>You are owed <span className="b">{rs(totals.net)}</span> on this trip, after the advance of {rs(totals.outstanding)} you are holding.</>
            ) : totals.net < 0 ? (
              <>You are holding <span className="b">{rs(-totals.net)}</span> more than you have claimed. That much of the advance comes back.</>
            ) : (
              <>Your claim and the advance you are holding cancel out. Nothing moves either way.</>
            )}
          </span>
        </div>
      ) : null}
    </div>
  )
}
