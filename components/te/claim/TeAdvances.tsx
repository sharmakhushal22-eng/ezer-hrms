'use client'
// components/te/claim/TeAdvances.tsx — money the company gave you up front.
// Screen 85.
//
// An advance is not income and not a claim: it is company money sitting with
// an employee until a claim absorbs it or they give it back. So the number
// that matters is what is still OUTSTANDING, and that is what this screen
// leads with — the amount requested is history once it has been paid.
//
// Everything here is read from the snapshot. An advance is asked for while
// planning a trip and settled by Finance; there is nothing to do from this
// screen except understand where you stand.
import type { Snapshot, Uuid } from '@/lib/te/types'
import { day, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

/** The tone each state is drawn in. */
const TONE: Record<string, string> = {
  REQUESTED: 't-warn',
  APPROVED: 't-brand',
  PAID: 't-pos',
  PART_SETTLED: 't-info',
  SETTLED: 't-pos',
  RECOVERY_DUE: 't-crit',
  REJECTED: 't-crit',
  CANCELLED: 'plain',
}

export default function TeAdvances({ snap, onOpenTrip }: {
  snap: Snapshot
  onOpenTrip: (tripId: Uuid) => void
}) {
  const mine = snap.advances.filter(a => a.emp === snap.me)
  const outstanding = mine.reduce((a, x) => a + (x.outstanding || 0), 0)
  const waiting = mine.filter(a => a.status === 'REQUESTED' || a.status === 'APPROVED')
  const tripName = (id: Uuid) => snap.trips.find(t => t.id === id)?.name ?? ''
  // An advance whose due date has passed and which is still unsettled is the
  // one thing on this screen that needs doing something about.
  const overdue = mine.filter(a => a.outstanding > 0 && a.due && a.due < snap.today)

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Advances</h1>
          <p>Money the company paid you before a trip. It is set against that trip&rsquo;s claim; anything left over is returned.</p>
        </div>
      </div>

      <div className="g3">
        <div className="tile">
          <div className="l">Still with you</div>
          <div className="v num">{rs(outstanding)}</div>
          <div className="s">across {mine.filter(a => a.outstanding > 0).length} advance{mine.filter(a => a.outstanding > 0).length === 1 ? '' : 's'}</div>
        </div>
        <div className="tile">
          <div className="l">Waiting on Finance</div>
          <div className="v num">{rs(waiting.reduce((a, x) => a + (x.approved ?? x.requested), 0))}</div>
          <div className="s">{waiting.length ? `${waiting.length} not paid out yet` : 'nothing pending'}</div>
        </div>
        <div className="tile">
          <div className="l">You can ask for</div>
          <div className="v num">up to {snap.cfg.advanceMaxPct}%</div>
          <div className="s">of what you will pay yourself</div>
        </div>
      </div>

      {overdue.length ? (
        <div className="flag crit">
          <TeIcon name="alert" />
          <div className="tx">
            <b>{overdue.length === 1 ? 'An advance is past its date' : `${overdue.length} advances are past their date`}</b>
            <p>Submit the trip&rsquo;s claim to set it off, or return the balance. Finance can also recover it from payroll.</p>
          </div>
        </div>
      ) : null}

      <div className="card pad0">
        <div className="day"><span>Every advance</span><span>{mine.length}</span></div>
        {mine.length ? mine.map(a => {
          const name = tripName(a.tripId)
          return (
            <div
              key={a.id}
              className={a.tripId ? 'li click' : 'li'}
              role={a.tripId ? 'button' : undefined}
              tabIndex={a.tripId ? 0 : undefined}
              onClick={a.tripId ? () => onOpenTrip(a.tripId) : undefined}
              onKeyDown={a.tripId ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTrip(a.tripId) } } : undefined}
            >
              <span className="ico"><TeIcon name="advances" /></span>
              <div className="grow">
                <div className="b">{name || a.no}</div>
                <div className="small muted">
                  <span className="mono">{a.no}</span>
                  {a.paidOn ? ` · paid ${day(a.paidOn)}` : ''}
                  {a.due ? ` · due ${day(a.due)}` : ''}
                  {a.ref ? ` · ${a.ref}` : ''}
                </div>
              </div>
              <div className="amt">
                {/* The outstanding figure leads, because that is the one the
                    employee is answerable for. */}
                <b>{rs(a.outstanding)}</b>
                <span className="small muted">still with you</span>
                <div>
                  <span className={`chip ${TONE[a.status] ?? 'plain'}`}>{a.display || a.status.replace(/_/g, ' ').toLowerCase()}</span>
                </div>
              </div>
            </div>
          )
        }) : (
          <div className="empty">
            <b>No advances</b>
            Ask for one while planning a trip, on the last step.
          </div>
        )}
      </div>

      <div className="note">
        <TeIcon name="info" size="sm" />
        <span>An advance is set against the claim for its own trip. If the claim is smaller than the advance, the difference is recovered.</span>
      </div>
    </div>
  )
}
