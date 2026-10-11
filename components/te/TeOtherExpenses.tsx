'use client'
// components/te/TeOtherExpenses.tsx — saved expense lines, and the claim they
// become. Two screens from one component:
//   no trip   "Other expenses" — client meals, courier, parking (screens 80-82)
//   a trip    the claim for that trip, once you are back (screens 65, 66)
// They are the same screen because they are the same act: lines waiting, what
// they add up to, what is wrong with them, and one submit. The only real
// difference is which lines belong and what the claim is called.
//
// Markup and class names: design/html/other-expenses.html.
// The aside is the claim review: POST /api/te/claims/preview gives the totals,
// every flag, what stops the claim and who will approve it; "Submit claim"
// is POST /api/te/claims with the declaration. Nothing is added up in the browser.
import { useEffect, useMemo, useState } from 'react'
import { te, TeApiError } from '@/lib/te/client'
import type { ClaimPreview, Snapshot, TeExpense, TeFlag, TeTrip } from '@/lib/te/types'
import TeIcon from './TeIcon'
import { errorText, flagClass, rs } from '@/lib/te/format'

export default function TeOtherExpenses({ snap, trip, onAdd, onEdit, onSubmitted, onBack }: {
  snap: Snapshot
  /** Set to claim one trip; left out for the standing "Other expenses" claim. */
  trip?: TeTrip
  onAdd: () => void
  onEdit: (line: TeExpense) => void
  onSubmitted: (claimId: string, message: string) => void
  onBack?: () => void
}) {
  // My own saved lines. Colleagues' lines are in the snapshot (other: true)
  // only so the server can check for duplicates; they are never mine to claim.
  const lines = useMemo(
    () => snap.expenses.filter(x => !x.other && x.status === 'UNCLAIMED' && (trip ? x.tripId === trip.id : !x.tripId)),
    [snap, trip],
  )
  const catName = useMemo(() => new Map(snap.cfg.cats.map(c => [c.id, c.name])), [snap])
  const [preview, setPreview] = useState<ClaimPreview | null>(null)
  const [declared, setDeclared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; flags: TeFlag[] } | null>(null)
  // The preview is asked again whenever the set of lines, or one of their amounts, changes.
  const signature = lines.map(x => `${x.id}:${x.claimed}:${x.reason}`).join('|')
  const tripId = trip?.id ?? null

  useEffect(() => {
    let current = true
    // Nothing to price. A stale preview cannot leak through: `review` below is
    // null whenever there are no lines.
    if (!signature) return
    te.claimPreview(tripId ? { tripId } : {})
      .then(p => { if (current) setPreview(p) })
      .catch(e => { if (current) { setPreview(null); setError({ text: errorText(e), flags: [] }) } })
    return () => { current = false }
  }, [signature, tripId])

  async function submit() {
    setBusy(true); setError(null)
    try {
      const c = await te.claimSubmit(tripId ? { tripId, declared } : { declared })
      onSubmitted(c.claim_id, `Claim ${c.claim_no} sent.`)
    } catch (e) {
      setError({ text: errorText(e), flags: e instanceof TeApiError ? e.flags : [] })
    } finally {
      setBusy(false)
    }
  }

  const review = lines.length ? preview : null
  const stops = review ? [...review.blockers, ...review.needs] : []
  const period = snap.periods.filter(p => p.status === 'OPEN').map(p => p.label)[0]

  return (
    <>
      {trip && onBack ? (
        <div className="row"><button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trip</button><span className="mono muted">{trip.no}</span></div>
      ) : null}

      <div className="ph">
        <div>
          <h1>{trip ? `Claim for ${trip.name}` : 'Other expenses'}</h1>
          <p>
            {trip
              ? 'Every bill and every leg of this trip, in one claim. Check what each line is worth, then send it.'
              : 'Client meals, courier, parking, printing and other work spends with no travel. Saved lines wait here until you submit them together as one claim.'}
          </p>
        </div>
        <button type="button" className="btn pri" onClick={onAdd}>Add an expense</button>
      </div>

      <div className="cols">
        <div className="stack">
          <div className="card pad0">
            <div className="day"><span>Not submitted yet</span><span>{lines.length}</span></div>
            {lines.length === 0 ? (
              <div className="empty">
                <b>Nothing waiting</b>
                {trip ? 'Close the trip’s legs and add any other bills, and they appear here.' : 'Add a bill and it appears here.'}
              </div>
            ) : null}
            {lines.map(x => {
              const flags = review?.lines.find(l => l.id === x.id)?.flags ?? []
              return (
                <div key={x.id} className="li click" role="button" tabIndex={0} onClick={() => onEdit(x)} onKeyDown={e => { if (e.key === 'Enter') onEdit(x) }}>
                  <span className="ico"><TeIcon name="other" /></span>
                  <div className="grow">
                    <div className="b">{x.merchant || catName.get(x.cat) || x.cat}</div>
                    <div className="small muted">{[catName.get(x.cat), x.desc, x.billNo].filter(Boolean).join(' · ')}</div>
                    <div className="row tight">
                      {flags.map(fl => <span key={fl.code} className={fl.block ? 'chip t-crit' : 'chip t-warn'}>{fl.code} {fl.title}</span>)}
                    </div>
                  </div>
                  <div className="amt"><b>{rs(x.claimed)}</b></div>
                </div>
              )
            })}
          </div>
          {trip ? null : (
            <div className="note"><TeIcon name="info" size="sm" /><span>Travelled within the city? Start a local trip instead. It records the route and works out the amount for you.</span></div>
          )}
        </div>

        <div className="aside">
          <div className="card">
            <div className="ch">
              <h3>{trip ? 'This claim' : 'This month’s claim'}</h3>
              {period ? <span className="chip plain t-brand">{period}</span> : null}
            </div>
            {review ? (
              <>
                <dl className="kv">
                  <dt>You paid</dt><dd>{rs(review.claimed)}</dd>
                  {review.eligible !== review.claimed ? <><dt>Eligible under policy</dt><dd>{rs(review.eligible)}</dd></> : null}
                  {review.outstanding > 0 ? <><dt>Advance with you</dt><dd>{rs(-review.outstanding)}</dd></> : null}
                  <dt className="tot">Expected to be paid</dt><dd className="tot">{rs(review.net)}</dd>
                </dl>
                {review.chain.length ? <p className="small muted">Goes to {review.chain.map(c => c.name || c.role).join(', then ')}.</p> : null}
                <div className="stack sm">
                  {stops.map(fl => (
                    <div key={`${fl.lineId}-${fl.code}`} className={flagClass(fl)}>
                      <TeIcon name="warn" />
                      <div className="tx"><b><span className="code">{fl.code}</span> {fl.title}</b><p>{fl.block ? fl.evidence : 'Open the line and add a reason.'}</p></div>
                    </div>
                  ))}
                  {review.stop.map(s => <div key={s} className="flag crit"><TeIcon name="warn" /><div className="tx"><b>{s}</b></div></div>)}
                </div>
                <label className="check small">
                  <input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)} />
                  <span>I confirm these expenses are genuine, were incurred for company work and have not been claimed elsewhere.</span>
                </label>
                <button type="button" className="btn pri lg wide" disabled={busy || !declared || stops.length > 0 || review.stop.length > 0} onClick={submit}>
                  {busy ? 'Sending…' : 'Submit claim'}
                </button>
              </>
            ) : (
              <p className="small muted">{lines.length ? 'Checking your lines…' : 'Saved expenses are added up here.'}</p>
            )}
            {error ? (
              <div className="flag crit" role="alert">
                <TeIcon name="warn" />
                <div className="tx"><b>{error.text}</b>{error.flags.map(fl => <p key={`${fl.lineId}-${fl.code}`}>{fl.code} {fl.title}</p>)}</div>
              </div>
            ) : null}
          </div>
          <div className="note"><TeIcon name="info" size="sm" /><span>Bills older than {snap.cfg.billAgeDays} days cannot be claimed.</span></div>
        </div>
      </div>
    </>
  )
}
