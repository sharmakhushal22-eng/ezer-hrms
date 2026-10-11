'use client'
// components/te/TeHome.tsx — the employee's entry to Travel and Expenses.
//
// THIS IS A STARTER, NOT THE FULL MODULE. What is built and wired to the real API:
//   · the home screen: the four buttons, the three numbers, "Needs you"
//   · the option sheet of a trip kind (Start now / Plan a trip / I already travelled)
//   · ONE complete flow: Other expense -> the form with live checks -> saved line
//     -> claim review -> submit -> the claim with its timeline
//   · My claims, and what is waiting for you to approve
// What is NOT built: planning a trip, recording legs with GPS, the leg report,
// vehicles, the approval and Finance screens, the Travel Desk and Admin. The
// prototype has about 130 screens; app-code/UI-BUILD-GUIDE.md lists every one
// with the snapshot to copy and the client call that feeds it, in build order.
//
// HOW IT IS BUILT, so the rest can follow the same way
//   · One root element with class "te"; everything, the drawer included, is
//     inside it, because te.css is scoped to that class.
//   · Markup and class names are the prototype's (design/html). No colour and
//     no z-index is written in a .tsx file: the stylesheet has them as tokens.
//   · All data is the snapshot from GET /api/te/me. After anything changes, it
//     is fetched again; no screen keeps its own copy of server state.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeExpense, TeQueueRow, TripScope } from '@/lib/te/types'
import TeIcon from './TeIcon'
import TeSheet from './TeSheet'
import TeExpenseForm from './TeExpenseForm'
import TeOtherExpenses from './TeOtherExpenses'
import { TeClaimDetail, TeClaimList } from './TeClaims'
import { errorText, rs } from '@/lib/te/format'
import './te.css'

type View = { name: 'home' } | { name: 'expenses' } | { name: 'claims' } | { name: 'claim'; id: string }
type Sheet = null | { name: 'kind'; kind: TripScope } | { name: 'expense'; line?: TeExpense }

const KINDS: { id: TripScope | 'other'; title: string; text: string; foot: string }[] = [
  { id: 'local', title: 'Local trip', text: 'Office, factory, client or warehouse in your city. Back the same day.', foot: 'Any travel except flight' },
  { id: 'domestic', title: 'Domestic trip', text: 'Another city in India. Flights, trains, cabs, hotel and food in one trip.', foot: 'Flight or any travel' },
  { id: 'international', title: 'International trip', text: 'Any country. Flights, cabs abroad, hotel and food in one trip.', foot: 'Any country' },
  { id: 'other', title: 'Other expense', text: 'Client meal, courier, parking, printing. A bill with no travel.', foot: 'Bill with no trip' },
]
const WAYS = [
  { id: 'start', title: 'Start now', text: 'Leaving now. Your phone records each leg, with stops, until you are back.' },
  { id: 'plan', title: 'Plan a trip', text: 'For later today or another day. Add stops and the people going with you.' },
  { id: 'past', title: 'I already travelled', text: 'The trip was not tracked and you want the reimbursement.' },
]

/** A notification link is "/ess?tab=claims&ref=<claim id>" (written by the database, migration 147).
 *  When the page was opened from one, start on that claim. */
function claimFromLink(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const ref = q.get('ref') || ''
  return q.get('tab') === 'claims' && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null
}

export default function TeHome({ initialClaimId }: { initialClaimId?: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [queue, setQueue] = useState<TeQueueRow[]>([])
  const [error, setError] = useState('')
  const [view, setView] = useState<View>(() => {
    const id = initialClaimId ?? claimFromLink()
    return id ? { name: 'claim', id } : { name: 'home' }
  })
  const [sheet, setSheet] = useState<Sheet>(null)
  const [toast, setToast] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.me().then(s => { if (current) { setSnap(s); setError('') } }).catch(e => { if (current) setError(errorText(e)) })
    // The queue is empty for most people; a failure here must not hide the rest of the screen.
    te.queue().then(q => { if (current) setQueue(q) }).catch(() => { if (current) setQueue([]) })
    return () => { current = false }
  }, [tick])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const catName = useMemo(() => new Map((snap?.cfg.cats ?? []).map(c => [c.id, c.name])), [snap])
  const done = (message: string) => { setSheet(null); setToast(message); reload() }

  if (!snap) {
    return <div className="te"><main className="main"><div className="page"><div className="card"><p className="muted">{error || 'Loading Travel and Expenses…'}</p>{error ? <button type="button" className="btn sm" onClick={reload}>Try again</button> : null}</div></div></main></div>
  }

  const me = snap.emp[snap.me]
  const open = snap.claims.filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD'].includes(c.status))
  const coming = snap.claims.filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD', 'VERIFIED'].includes(c.status)).reduce((a, c) => a + (c.net ?? c.approved ?? c.claimed), 0)
  const advance = snap.advances.reduce((a, x) => a + (x.outstanding || 0), 0)
  const unclaimed = snap.expenses.filter(x => !x.other && !x.tripId && x.status === 'UNCLAIMED')
  const sentBack = snap.claims.filter(c => c.status === 'SENT_BACK')
  const todo: Record<string, string> = { other: unclaimed.length ? `${unclaimed.length} unclaimed` : '' }

  return (
    <div className="te">
      <main className="main">
        <div className="page">
          {view.name !== 'home' ? <div className="row"><button type="button" className="btn sm" onClick={() => setView({ name: 'home' })}>Travel and Expenses</button></div> : null}

          {view.name === 'home' ? (
            <>
              <section className="hero">
                <div>
                  <h1>Hello, {(me?.name || '').split(' ')[0]}</h1>
                  <p>Where are you travelling today?</p>
                </div>
                <div className="kpis">
                  <div className="kpi"><b className="num">{rs(coming)}</b><span>coming to you</span></div>
                  <div className="kpi"><b className="num">{open.length}</b><span>claims in approval</span></div>
                  <div className="kpi"><b className="num">{rs(advance)}</b><span>advance with you</span></div>
                </div>
              </section>

              <div className="kinds" role="list">
                {KINDS.map(k => (
                  <button key={k.id} type="button" role="listitem" className={`kind k-${k.id}`} onClick={() => setSheet(k.id === 'other' ? { name: 'expense' } : { name: 'kind', kind: k.id })}>
                    <span className="ki"><TeIcon name={k.id} size="lg" /></span>
                    {todo[k.id] ? <span className="kb">{todo[k.id]}</span> : null}
                    <span className="kt"><b>{k.title}</b><small>{k.text}</small></span>
                    <span className="kf"><span className="kg">{k.foot}</span><TeIcon name="go" size="sm" /></span>
                  </button>
                ))}
              </div>

              {unclaimed.length || sentBack.length || queue.length ? (
                <div className="card pad0 needs">
                  <div className="day"><span>Needs you</span><span>{(unclaimed.length ? 1 : 0) + sentBack.length + queue.length}</span></div>
                  {sentBack.map(c => (
                    <button key={c.id} type="button" className="li click needrow" onClick={() => setView({ name: 'claim', id: c.id })}>
                      <span className="ico"><TeIcon name="other" /></span>
                      <span className="grow"><span className="b">Claim {c.no} was sent back to you.</span><span className="small muted">Correct the lines and answer.</span></span>
                      <span className="nr-go">Open<TeIcon name="go" size="sm" /></span>
                    </button>
                  ))}
                  {unclaimed.length ? (
                    <button type="button" className="li click needrow" onClick={() => setView({ name: 'expenses' })}>
                      <span className="ico"><TeIcon name="other" /></span>
                      <span className="grow"><span className="b">{unclaimed.length} other {unclaimed.length === 1 ? 'expense is' : 'expenses are'} saved but not submitted.</span><span className="small muted">{rs(unclaimed.reduce((a, x) => a + x.claimed, 0))}</span></span>
                      <span className="nr-go">Review and submit<TeIcon name="go" size="sm" /></span>
                    </button>
                  ) : null}
                  {queue.map(q => (
                    <button key={q.step_id} type="button" className="li click needrow" disabled={q.entity_type !== 'claim'} onClick={() => setView({ name: 'claim', id: q.entity_id })}>
                      <span className="ico"><TeIcon name={q.entity_type === 'claim' ? 'other' : 'local'} /></span>
                      <span className="grow">
                        <span className="b">{q.entity_type === 'claim' ? 'Claim' : 'Trip plan'} {q.ref_no} from {q.employee_name} is waiting for you.</span>
                        <span className="small muted">{rs(q.amount)} · {q.role_label}{q.entity_type === 'trip' ? ' · the trip approval screen is not part of this starter' : ''}</span>
                      </span>
                      <span className="nr-go">{q.entity_type === 'claim' ? 'Open' : ''}<TeIcon name="go" size="sm" /></span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="row">
                <button type="button" className="btn" onClick={() => setView({ name: 'claims' })}>My claims</button>
                <button type="button" className="btn" onClick={() => setView({ name: 'expenses' })}>Other expenses</button>
              </div>
            </>
          ) : null}

          {view.name === 'expenses' ? (
            <TeOtherExpenses
              snap={snap}
              onAdd={() => setSheet({ name: 'expense' })}
              onEdit={line => setSheet({ name: 'expense', line })}
              onSubmitted={(id, message) => { setToast(message); reload(); setView({ name: 'claim', id }) }}
            />
          ) : null}
          {view.name === 'claims' ? <TeClaimList snap={snap} onOpen={id => setView({ name: 'claim', id })} /> : null}
          {view.name === 'claim' ? <TeClaimDetail claimId={view.id} catName={catName} onBack={() => setView({ name: 'claims' })} onChanged={message => { setToast(message); reload() }} /> : null}
        </div>
      </main>

      {sheet?.name === 'kind' ? (
        <TeSheet wide title={KINDS.find(k => k.id === sheet.kind)?.title ?? ''} lead={KINDS.find(k => k.id === sheet.kind)?.text} onClose={() => setSheet(null)}>
          <div className="sec">
            <h4>Start something new</h4>
            <div className="ways">
              {WAYS.map((w, i) => (
                <button key={w.id} type="button" className={i === 0 ? 'way pri' : 'way'} disabled>
                  <span className="wi"><TeIcon name={sheet.kind} /></span>
                  <span className="grow"><b>{w.title}</b><small>{w.text}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="note"><TeIcon name="info" size="sm" /><span>These three flows are the next build step (trip planner, live leg recording, past trip). The API behind them is finished and tested: see UI-BUILD-GUIDE.md, steps 3 to 6.</span></div>
        </TeSheet>
      ) : null}
      {sheet?.name === 'expense' ? (
        <TeExpenseForm key={sheet.line?.id ?? 'new'} snap={snap} line={sheet.line} onClose={() => setSheet(null)} onSaved={message => { done(message); setView({ name: 'expenses' }) }} />
      ) : null}

      <div className="toasts" aria-live="polite">{toast ? <div className="toast">{toast}</div> : null}</div>
    </div>
  )
}
