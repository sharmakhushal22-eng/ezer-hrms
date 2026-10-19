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
import { useMemo } from 'react'
import type { TeCategory, TeTripDetail as TripDetail } from '@/lib/te/types'
import { ledgerRows, ledgerTotals } from '@/lib/te/trip-ledger'
import { rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'

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

  const rows = useMemo(
    () => ledgerRows({ expenses: detail.expenses ?? [], legs: detail.legs ?? [], me, everyone, nameOf, cats }),
    [detail.expenses, detail.legs, me, everyone, nameOf, cats],
  )
  const totals = useMemo(() => ledgerTotals(rows), [rows])

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
            <span>{rs(g.self + g.company)}</span>
          </div>
          {rows.filter(r => r.group === g.group).map(r => (
            <div key={r.line.id} className="li">
              <span className="ico"><TeIcon name={r.subTrip ? 'route' : r.group === 'Stay' ? 'home' : r.group === 'Travel' ? 'plane' : 'receipt'} size="sm" /></span>
              <div className="grow">
                <div className="b">
                  {r.line.merchant || r.catName}
                  {r.subTrip ? <span className="chip plain">Local sub-trip</span> : null}
                </div>
                <div className="small muted">
                  {r.line.no ? <span className="mono">{r.line.no}</span> : null}
                  {r.line.date ? <> · {r.line.date}</> : null}
                  {r.leg ? <> · journey {r.leg.n}</> : null}
                  {/* Named only where the reader is entitled to know. */}
                  {r.who && !r.mine ? <> · {r.who}</> : null}
                  {r.line.pay === 'company' ? <> · paid by the company</> : null}
                  {STATUS_WORD[r.line.status] ? <> · {STATUS_WORD[r.line.status]}</> : null}
                </div>
              </div>
              {r.line.file ? <TeFileLink path={r.line.file.path} name={r.line.file.name} small /> : null}
              <span className="amt">{rs(Number(r.line.claimed || r.line.bill || 0))}</span>
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
      </dl>
    </div>
  )
}
