'use client'
// components/te/TeHome.tsx — the employee's entry to Travel and Expenses.
//
// Every employee-facing screen in app-code/UI-BUILD-GUIDE.md is built and
// wired to the real API: the home screen and the option sheet of a trip kind,
// the three-step planner (plan, or a trip already travelled) with the place
// picker and editing, Start now, vehicles and My limits and rates, trips and
// one trip in any state, a leg recorded with GPS or reported or declared not
// recorded, Other expense end to end, My claims, Advances, and the approvals
// queue. The back office lives in TeStaffHome.tsx.
//
// This header used to list most of that as NOT BUILT. If a screen moves, say
// so here — a stale "not built" note is how a finished screen stays unwired,
// which is exactly what happened to the Start-a-leg button below.
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
import type { Snapshot, TeConfig, TeDraft, TeExpense, TeLeg, TeQueueRow, TeTrip, TeTripDetail as TeTripDetailT, TripScope } from '@/lib/te/types'
import TeIcon from './TeIcon'
import TeSheet from './TeSheet'
import TeSteps from './TeSteps'
import TeExpenseForm from './TeExpenseForm'
import TeOtherExpenses from './TeOtherExpenses'
import TePickTrip from './trip/TePickTrip'
import TePlanner from './plan/TePlanner'
import TeDrafts from './TeDrafts'
import TeLimitsAndRates from './vehicle/TeLimitsAndRates'
import TeTrips from './trip/TeTrips'
import TeTripDetail from './trip/TeTripDetail'
import TeLegLive from './leg/TeLegLive'
import TeLegReport from './leg/TeLegReport'
import TeLegMissed from './leg/TeLegMissed'
import TeLiveBar from './leg/TeLiveBar'
import TeStartNow from './start/TeStartNow'
import TeLegAdd from './leg/TeLegAdd'
import TeAdvances from './claim/TeAdvances'
import TeApprovals from './approve/TeApprovals'
import TeDashboard from './report/TeDashboard'
import TeFinanceDesk from './finance/TeFinanceDesk'
import TeTravelDesk from './desk/TeTravelDesk'
import { TeClaimDetail, TeClaimList } from './TeClaims'
import { errorText, rs } from '@/lib/te/format'
import { approvedTrips, continueItems, wayCount, wayOff, FLOW_WAYS, KIND_NAME, type WayId } from '@/lib/te/entry-flow'
import './te.css'

type View =
  | { name: 'home' } | { name: 'expenses' } | { name: 'claims' } | { name: 'limits' } | { name: 'trips' }
  | { name: 'claim'; id: string; resuming?: TeDraft } | { name: 'trip'; id: string } | { name: 'advances' } | { name: 'approvals' }
  /** Tab 1 of the three: everybody's reports and dashboard. */
  | { name: 'dashboard' }
  /** Tabs 2 and 3. Offered here, in ESS, only to the people on each desk —
   *  see deskProbe below. The same screens are also in the admin console at
   *  /dashboard/expenses for whoever administers the module. */
  | { name: 'traveldesk' } | { name: 'financedesk' }
  /** The claim for one trip: its lines, what they are worth, and submit. */
  | { name: 'tripClaim'; trip: TeTrip }
  /** A leg, opened from its trip. Which screen it gets is the leg's own
   *  state, decided in legScreen() below. */
  | { name: 'leg'; tripId: string; leg: TeLeg }
/** 'new' is step 1 of the entry flow (the four tiles in a drawer); 'kind' is its
 *  step 2, and `way: 'approved'` its step 3 (screen 07, choose the trip). */
type Sheet =
  | null
  | { name: 'new' }
  | { name: 'kind'; kind: TripScope; way: WayId | null }
  | { name: 'expense'; line?: TeExpense; tripId?: string; resuming?: TeDraft }
  /** The three-step planner. `past` is "I already travelled".
   *  `resuming` is an unfinished plan being picked up again. */
  | { name: 'plan'; kind: TripScope; past: boolean; editing?: TeTrip; resuming?: TeDraft }
  /** Leaving now: one form that creates the trip and starts leg 1. */
  | { name: 'startNow' }
  /** A leg the plan did not have, added to a trip under way. */
  | { name: 'addLeg'; detail: TeTripDetailT }

/** The views the rail can land on. A claim is opened from a list, never from the rail. */
type RailView = 'home' | 'trips' | 'expenses' | 'claims' | 'advances' | 'limits' | 'approvals' | 'dashboard' | 'traveldesk' | 'financedesk'
const RAIL: { k: RailView; label: string; icon: string }[] = [
  { k: 'home', label: 'Home', icon: 'home' },
  { k: 'trips', label: 'Trips', icon: 'local' },
  { k: 'expenses', label: 'Other expenses', icon: 'other' },
  { k: 'claims', label: 'My claims', icon: 'claims' },
  { k: 'advances', label: 'Advances', icon: 'advances' },
  { k: 'limits', label: 'My limits and rates', icon: 'limits' },
  // Last in the rail and offered to everyone: it is the place you go to look
  // at what has already happened, not the place you go to do something.
  { k: 'dashboard', label: 'Reports and dashboard', icon: 'history' },
]
/** Nothing is left: every rail entry has a screen. Kept because the next
 *  thing added to the module will want it again. */
const RAIL_SOON: { label: string; icon: string; step: number }[] = []

const KINDS: { id: TripScope | 'other'; title: string; text: string; foot: string }[] = [
  { id: 'local', title: 'Local trip', text: 'Office, factory, client or warehouse in your city. Back the same day.', foot: 'Any travel except flight' },
  { id: 'domestic', title: 'Domestic trip', text: 'Another city in India. Flights, trains, cabs, hotel and food in one trip.', foot: 'Flight or any travel' },
  { id: 'international', title: 'International trip', text: 'Any country. Flights, cabs abroad, hotel and food in one trip.', foot: 'Any country' },
  { id: 'other', title: 'Other expense', text: 'Client meal, courier, parking, printing. A bill with no travel.', foot: 'Bill with no trip' },
]

/** A notification link is "/ess?tab=claims&ref=<claim id>" (written by the database, migration 147).
 *  When the page was opened from one, start on that claim. */
function claimFromLink(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const ref = q.get('ref') || ''
  return q.get('tab') === 'claims' && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null
}

export default function TeHome({ initialClaimId, onExit }: {
  initialClaimId?: string
  /** Leaves the module. The standalone page passes "back to the ESS portal". */
  onExit?: () => void
}) {
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
  /** Whether this person is on the Travel desk and the Finance desk.
   *
   *  THE CALL SUCCEEDING *IS* THE PERMISSION, which is the same test the admin
   *  console uses and the only honest one: both routes resolve membership in
   *  SQL (te_on_desk, migration 161), so asking them is asking the database.
   *  No role is named here and no department is named here — a Finance person
   *  is somebody on the Finance desk, which is what the admin Desks screen
   *  edits.
   *
   *  A desk whose call fails is simply not offered. Hidden rather than greyed
   *  out: a disabled rail entry invites somebody to ask why, and the answer
   *  would be "you are not on that desk", which is not a problem to solve. */
  // Declared up here with the other hooks, NOT beside openAddLeg below: there
  // is an early return between the two, so a useState down there is skipped on
  // the loading render and React refuses the changed hook order.
  const [openingTrip, setOpeningTrip] = useState(false)
  const [onTravelDesk, setOnTravelDesk] = useState(false)
  const [onFinanceDesk, setOnFinanceDesk] = useState(false)
  /** Vehicle types for the Travel desk's rate note. Admin-only, so absent for
   *  an ordinary desk user — the screen degrades and says so. */
  const [cfg, setCfg] = useState<TeConfig | null>(null)
  // A SHEET CLOSING DOES NOT UNMOUNT THIS SCREEN. The planner and the expense
  // form open over Home, so when one closes, Home is still the component it
  // always was — and the Drafts list under it would go on showing whatever it
  // fetched when the screen first loaded. That is usually nothing, which is
  // how a plan could be saved, confirmed as "Saved just now", and then not
  // appear in the list behind it. Views do not need this: moving to Trips and
  // back unmounts the list and it refetches on its own.
  const [draftTick, setDraftTick] = useState(0)
  const draftsChanged = useCallback(() => setDraftTick(n => n + 1), [])
  const reload = useCallback(() => { setTick(n => n + 1); setDraftTick(n => n + 1) }, [])

  useEffect(() => {
    let current = true
    te.me().then(s => { if (current) { setSnap(s); setError('') } }).catch(e => { if (current) setError(errorText(e)) })
    // The queue is empty for most people; a failure here must not hide the rest of the screen.
    te.queue().then(q => { if (current) setQueue(q) }).catch(() => { if (current) setQueue([]) })
    // Neither probe may surface an error: for almost everybody these 403, and
    // that is the normal answer, not a fault.
    te.desk.list()
      .then(() => {
        if (!current) return
        setOnTravelDesk(true)
        // Only now, and only for the handful of people who have the desk. Asked
        // unconditionally this is a 403 round trip on every module load for all
        // 397 employees who will never see the Travel desk.
        te.admin.config().then(r => { if (current) setCfg(r.config) }).catch(() => { if (current) setCfg(null) })
      })
      .catch(() => { if (current) setOnTravelDesk(false) })
    te.finance.summary().then(() => { if (current) setOnFinanceDesk(true) }).catch(() => { if (current) setOnFinanceDesk(false) })
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
    return (
      <div className="te">
        <header className="top">
          <div className="brand"><i>E</i><div>EZER<small>Travel and Expenses</small></div></div>
          {onExit ? <div className="tools"><button type="button" className="btn sm" onClick={onExit}><TeIcon name="back" size="sm" />Back to ESS</button></div> : null}
        </header>
        <main className="main"><div className="page"><div className="card">
          <p className="muted">{error || 'Loading Travel and Expenses…'}</p>
          {error ? <button type="button" className="btn sm" onClick={reload}>Try again</button> : null}
        </div></div></main>
      </div>
    )
  }

  const me = snap.emp[snap.me]
  const open = snap.claims.filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD'].includes(c.status))
  const coming = snap.claims.filter(c => ['IN_APPROVAL', 'IN_VERIFICATION', 'ON_HOLD', 'VERIFIED'].includes(c.status)).reduce((a, c) => a + (c.net ?? c.approved ?? c.claimed), 0)
  const advance = snap.advances.reduce((a, x) => a + (x.outstanding || 0), 0)
  const unclaimed = snap.expenses.filter(x => !x.other && !x.tripId && x.status === 'UNCLAIMED')
  const sentBack = snap.claims.filter(c => c.status === 'SENT_BACK')
  // A leg of mine that is running right now, if there is one.
  const liveLeg = snap.journeys.find(j => j.emp === snap.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null
  // A TRIP OF MINE THAT IS UNDER WAY. te_leg_add accepts a journey only while
  // te_trip_status is APPROVED/ONGOING/COMPLETED and today is inside the trip's
  // dates, so offering it outside that window would be offering a refusal.
  // ONGOING is the honest subset of that: travel has actually started.
  //
  // The newest first, for the vanishingly rare case of two at once — the
  // database allows two approved trips to overlap, and somebody mid-trip is
  // almost certainly thinking about the one they are on.
  const onTrip = snap.trips
    .filter(t => t.emp === snap.me && t.display === 'ONGOING')
    .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))[0] ?? null

  // Everything the entry flow shows comes from the one snapshot. placeName and
  // modeName turn the ids the server sends into the words the prototype used.
  const placeName = (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? ''
  const modeName = (id: string) => snap.cfg.modes.find(m => m.id === id)?.name ?? ''
  const facts = { me: snap.me, today: snap.today, trips: snap.trips, journeys: snap.journeys, placeName, modeName }

  // The badge on a trip tile: how many of its trips need the employee, or "On
  // the way" when a leg of that kind is running. The prototype's kindBadge.
  const nowBy = {
    local: continueItems('local', facts),
    domestic: continueItems('domestic', facts),
    international: continueItems('international', facts),
  }
  const todo: Record<string, string> = {
    other: unclaimed.length ? `${unclaimed.length} unclaimed` : '',
    local: nowBy.local.length ? `${nowBy.local.length} to do` : '',
    domestic: nowBy.domestic.length ? `${nowBy.domestic.length} to do` : '',
    international: nowBy.international.length ? `${nowBy.international.length} to do` : '',
  }
  const live: Record<string, boolean> = {
    local: nowBy.local.some(x => x.tone === 'live'),
    domestic: nowBy.domestic.some(x => x.tone === 'live'),
    international: nowBy.international.some(x => x.tone === 'live'),
  }

  /** Opening a trip closes whatever sheet asked for it. */
  const openTrip = (id: string) => { setSheet(null); setView({ name: 'trip', id }) }

  /**
   * Open the add-a-journey sheet for a trip the Home screen only knows by id.
   *
   * The sheet needs the trip's full detail — its places, its legs, where the
   * last one ended — and the snapshot does not carry that. One fetch, then the
   * sheet, so somebody standing on a pavement gets there in one tap instead of
   * navigating to the trip and scrolling to find the button.
   */
  const openAddLeg = async (tripId: string) => {
    // THE BUTTON HAS TO SAY SOMETHING. The detail is fetched before the sheet
    // can open, and with no busy state the first press looked like nothing had
    // happened — in testing it took two presses before anything appeared, and
    // the first press was doing the work all along.
    if (openingTrip) return
    setOpeningTrip(true)
    try {
      const detail = await te.trip(tripId)
      setSheet({ name: 'addLeg', detail })
    } catch (e) {
      // Falling back to the trip rather than failing outright: the button is
      // still there, one screen in.
      setToast(errorText(e))
      setView({ name: 'trip', id: tripId })
    } finally {
      setOpeningTrip(false)
    }
  }

  /** The Continue list knows a leg by its id; the screen needs the leg itself,
   *  which is in the snapshot it was listed from. */
  const openLeg = (tripId: string, legId: string) => {
    const leg = snap.journeys.find(j => j.id === legId)
    if (!leg) { setToast('That journey is no longer there. Open the trip to see what changed.'); return }
    setSheet(null)
    setView({ name: 'leg', tripId, leg })
  }

  /** The guard for a way this screen does not know how to open. Every way in
   *  FLOW_WAYS is built and handled below, so this is unreachable today; it
   *  exists so that adding a WayId fails visibly rather than silently doing
   *  nothing. It used to carry messages naming unfinished build steps. */
  const noSuchWay = (id: WayId) => { setSheet(null); setToast(`There is no screen for “${id}”.`) }

  const initials = (me?.name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  /** The rail and the tab bar both land on a view; the sheets close with it.
   *  Spelled out rather than `setView({ name })`: a literal whose property is a
   *  union does not narrow to a discriminated union, so that would need a cast. */
  const goto = (name: RailView) => {
    setSheet(null)
    setView(
      name === 'claims' ? { name: 'claims' }
        : name === 'expenses' ? { name: 'expenses' }
          : name === 'limits' ? { name: 'limits' }
            : name === 'trips' ? { name: 'trips' }
              : name === 'advances' ? { name: 'advances' }
                : name === 'approvals' ? { name: 'approvals' }
                  : name === 'dashboard' ? { name: 'dashboard' }
                    : name === 'traveldesk' ? { name: 'traveldesk' }
                      : name === 'financedesk' ? { name: 'financedesk' }
              : { name: 'home' },
    )
  }

  return (
    <div className="te">
      {/* The module's own header. te.css makes it sticky at 57px, which is what
          .side's sticky offset is measured from — the two go together. */}
      <header className="top">
        <div className="brand">
          <i>E</i>
          <div>EZER<small>Travel and Expenses</small></div>
        </div>
        <div className="tools">
          {onExit ? <button type="button" className="btn sm" onClick={onExit}><TeIcon name="back" size="sm" />Back to ESS</button> : null}
          <div className="who">
            <span className="av">{initials}</span>
            <div className="n"><b>{me?.name}</b><small>{me?.title || me?.code}</small></div>
          </div>
        </div>
      </header>

      {/* w-ess: on a phone te.css hides this rail and shows .tabbar instead, so
          the two together are the module's only navigation. */}
      <div className="shell w-ess">
        <nav className="side" aria-label="Sections">
          <div className="newc">
            <button type="button" className="btn pri wide" onClick={() => setSheet({ name: 'new' })}><TeIcon name="plus" size="sm" />New claim</button>
          </div>
          {queue.length ? (
            <button type="button" aria-current={view.name === 'approvals' ? 'page' : 'false'} onClick={() => goto('approvals')}>
              <TeIcon name="check" /><span>Approvals</span><span className="ct">{queue.length}</span>
            </button>
          ) : null}
          {RAIL.map(r => (
            <button key={r.k} type="button" aria-current={view.name === r.k ? 'page' : 'false'} onClick={() => goto(r.k)}>
              <TeIcon name={r.icon} /><span>{r.label}</span>
              {r.k === 'expenses' && unclaimed.length ? <span className="ct">{unclaimed.length}</span> : null}
              {r.k === 'claims' && open.length ? <span className="ct">{open.length}</span> : null}
            </button>
          ))}
          {/* The two desks, under everything personal: this is work somebody
              does on behalf of other people, not their own travel. */}
          {onTravelDesk ? (
            <button type="button" aria-current={view.name === 'traveldesk' ? 'page' : 'false'} onClick={() => goto('traveldesk')}>
              <TeIcon name="plane" /><span>Travel desk</span>
            </button>
          ) : null}
          {onFinanceDesk ? (
            <button type="button" aria-current={view.name === 'financedesk' ? 'page' : 'false'} onClick={() => goto('financedesk')}>
              <TeIcon name="claims" /><span>Finance desk</span>
            </button>
          ) : null}
          {RAIL_SOON.map(r => (
            <button key={r.label} type="button" aria-current="false" onClick={() => setToast(`${r.label} is build step ${r.step}.`)}>
              <TeIcon name={r.icon} /><span>{r.label}</span><span className="ct">soon</span>
            </button>
          ))}
        </nav>

      <main className="main">
        <div className="page">
          {/* A leg collects fixes only while its own screen is open, so
              wandering off mid-journey quietly stops the recording. The bar is
              the way back, and it says plainly that nothing is being collected
              here. Hidden on the leg screen itself, which is already it. */}
          {liveLeg && view.name !== 'leg' ? (
            <TeLiveBar
              leg={liveLeg}
              tripName={snap.trips.find(t => t.id === liveLeg.tripId)?.name ?? ''}
              placeName={id => snap.masters.places.find(p => p.id === id)?.s ?? ''}
              onOpen={leg => setView({ name: 'leg', tripId: leg.tripId, leg })}
            />
          ) : null}

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

              {/* ON A TRIP RIGHT NOW. The only way to log a local hop used to be
                  Home -> Trips -> find the trip -> scroll to the Route card ->
                  "Add a journey", which is four steps too many for somebody
                  standing on a pavement in Mumbai. Shown only while a trip of
                  theirs is actually under way, so it is never clutter for
                  anybody who is not travelling. */}
              {onTrip ? (
                <div className="card ontrip">
                  <div className="row sp top">
                    <div className="grow">
                      <div className="eyebrow">You are on a trip</div>
                      <b>{onTrip.name || onTrip.no}</b>
                      <div className="small muted">
                        <span className="mono">{onTrip.no}</span>
                        {onTrip.to ? <> · {onTrip.to}</> : null}
                      </div>
                    </div>
                    <span className="chip t-pos">On the way</span>
                  </div>
                  <p className="small muted">
                    Hopping about at the destination? Add it as a journey and it is recorded on GPS and paid with the
                    rest of the trip, instead of becoming a loose bill.
                  </p>
                  <div className="row tight">
                    <button type="button" className="btn pri" disabled={openingTrip} onClick={() => void openAddLeg(onTrip.id)}>
                      <TeIcon name="plus" size="sm" />{openingTrip ? 'Opening…' : 'Add a journey'}
                    </button>
                    <button type="button" className="btn" onClick={() => setView({ name: 'trip', id: onTrip.id })}>
                      Open the trip
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="kinds" role="list">
                {KINDS.map(k => (
                  <button key={k.id} type="button" role="listitem" className={`kind k-${k.id}`} onClick={() => setSheet(k.id === 'other' ? { name: 'expense' } : { name: 'kind', kind: k.id, way: null })}>
                    <span className="ki"><TeIcon name={k.id} size="lg" /></span>
                    {live[k.id] ? <span className="kb live"><i />On the way</span> : todo[k.id] ? <span className="kb">{todo[k.id]}</span> : null}
                    <span className="kt"><b>{k.title}</b><small>{k.text}</small></span>
                    <span className="kf"><span className="kg">{k.foot}</span><TeIcon name="go" size="sm" /></span>
                  </button>
                ))}
              </div>

              {/* UNDER THE TILES, not above them. A draft is a trip somebody
                  has already started, so it belongs with "start a trip" rather
                  than in front of it — the tiles are the first thing somebody
                  arriving to plan something new is looking for. Renders
                  nothing at all when there are no drafts. */}
              <TeDrafts
                kind="trip"
                title="Trip drafts"
                reloadKey={draftTick}
                onResume={d => {
                  // The scope and "already travelled" live in the draft body,
                  // which is the planner's own form state.
                  const body = d.body as { scope?: TripScope; origin?: string }
                  setSheet({
                    name: 'plan',
                    kind: body.scope ?? 'domestic',
                    past: body.origin === 'POST_FACTO',
                    resuming: d,
                  })
                }}
              />

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
                    <button key={q.step_id} type="button" className="li click needrow" onClick={() => setView({ name: 'approvals' })}>
                      <span className="ico"><TeIcon name={q.entity_type === 'claim' ? 'other' : 'local'} /></span>
                      <span className="grow">
                        <span className="b">{q.entity_type === 'claim' ? 'Claim' : 'Trip plan'} {q.ref_no} from {q.employee_name} is waiting for you.</span>
                        <span className="small muted">{rs(q.amount)} · {q.role_label}</span>
                      </span>
                      <span className="nr-go">Decide<TeIcon name="go" size="sm" /></span>
                    </button>
                  ))}
                </div>
              ) : null}

            </>
          ) : null}

          {view.name === 'expenses' ? (
            <>
            <TeDrafts
              kind="expense"
              title="Expense drafts"
              reloadKey={draftTick}
              onResume={d => setSheet({ name: 'expense', resuming: d })}
            />
            <TeOtherExpenses
              snap={snap}
              onAdd={() => setSheet({ name: 'expense' })}
              onEdit={line => setSheet({ name: 'expense', line })}
              onSubmitted={(id, message) => { setToast(message); reload(); setView({ name: 'claim', id }) }}
              // Screen 44: bills saved against a trip are claimed with that
              // trip, so the card that lists them goes to it.
              onOpenTrip={openTrip}
              // A bill moved into a trip has left this bucket, so the snapshot
              // this screen renders from is out of date the moment it happens.
              onChanged={message => { setToast(message); reload() }}
            />
            </>
          ) : null}
          {view.name === 'claims' ? <TeClaimList snap={snap} onOpen={id => setView({ name: 'claim', id })} /> : null}
          {view.name === 'limits' ? <TeLimitsAndRates snap={snap} onChanged={message => { setToast(message); reload() }} /> : null}
          {view.name === 'advances' ? <TeAdvances snap={snap} onOpenTrip={id => setView({ name: 'trip', id })} /> : null}
          {view.name === 'approvals' ? <TeApprovals onToast={message => { setToast(message); reload() }} /> : null}
          {view.name === 'dashboard' ? <TeDashboard onOpenTrip={id => setView({ name: 'trip', id })} /> : null}
          {view.name === 'traveldesk' && onTravelDesk ? (
            <TeTravelDesk
              vehicleTypes={cfg?.vehicles ?? []}
              fuelPrice={cfg?.fuelPrice ?? {}}
              modes={cfg?.modes ?? []}
              // A row on the desk is a line of a trip somebody planned. The
              // whole plan — the route, the times they asked for, the hotels
              // they suggested — is on the trip screen, so the desk opens it
              // rather than restating a fraction of it on the row.
              onOpenTrip={id => setView({ name: 'trip', id })}
              onToast={message => { setToast(message); reload() }}
            />
          ) : null}
          {/* Finance could not open a trip at all before this: every row in
              every finance screen already carried trip_id and none of them
              offered a way in, so the team settling a trip's money could not
              read the trip. */}
          {view.name === 'financedesk' && onFinanceDesk ? (
            <TeFinanceDesk
              onToast={message => { setToast(message); reload() }}
              onOpenTrip={id => setView({ name: 'trip', id })}
            />
          ) : null}
          {view.name === 'tripClaim' ? (
            <TeOtherExpenses
              snap={snap}
              trip={view.trip}
              onBack={() => setView({ name: 'trip', id: view.trip.id })}
              onAdd={() => setSheet({ name: 'expense', tripId: view.trip.id })}
              onEdit={line => setSheet({ name: 'expense', line, tripId: view.trip.id })}
              onSubmitted={(id, message) => { setToast(message); reload(); setView({ name: 'claim', id }) }}
            />
          ) : null}
          {view.name === 'trips' ? <TeTrips snap={snap} onOpen={id => setView({ name: 'trip', id })} onNew={kind => setSheet({ name: 'plan', kind, past: false })} /> : null}
          {view.name === 'leg' ? (() => {
            const leg = view.leg
            const backToTrip = () => setView({ name: 'trip', id: view.tripId })
            const placeName = (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? ''
            // Which screen a leg gets is the leg's own state, not a choice the
            // trip screen makes: on the road, ended and owing a report, or
            // never recorded at all.
            if (leg.status === 'ACTIVE' || leg.status === 'PAUSED' || leg.status === 'PLANNED') {
              return (
                <TeLegLive
                  snap={snap} leg={leg} placeName={placeName}
                  onBack={backToTrip}
                  onEnded={() => { setToast('Journey ended. Add what it cost.'); reload(); backToTrip() }}
                  onChanged={message => { setToast(message); reload() }}
                />
              )
            }
            if (leg.status === 'ENDED') {
              return (
                <TeLegReport
                  snap={snap} leg={leg} placeName={placeName}
                  onBack={backToTrip}
                  onFiled={message => { setToast(message); reload(); backToTrip() }}
                />
              )
            }
            return (
              <TeLegMissed
                snap={snap} leg={leg} placeName={placeName}
                onBack={backToTrip}
                onDone={message => { setToast(message); reload(); backToTrip() }}
              />
            )
          })() : null}

          {view.name === 'trip' ? (
            <TeTripDetail
              tripId={view.id}
              masters={snap.masters}
              me={snap.me}
              today={snap.today}
              // WHOSE MONEY THIS READER MAY SEE. A desk member, Finance or an
              // administrator is looking at the trip to account for it and
              // needs every traveller's lines; anybody else is looking at
              // their own trip, and what a colleague was reimbursed is not
              // theirs to read.
              everyone={onTravelDesk || onFinanceDesk}
              // FROM THE SNAPSHOT, which every employee has, not from the admin
              // config. `cfg` is loaded by te.admin.config() and only for a desk
              // administrator, so an ordinary traveller was handed [] and the
              // bucket fell back to the built-in category copy: raw codes like
              // "misc" where the company's own name belongs, and any category a
              // company has added of its own forced into "Other". The ledger's
              // own comment says these come from the snapshot precisely so that
              // cannot happen; the call site was not honouring it.
              cats={snap.cfg.cats}
              onBack={() => setView({ name: 'trips' })}
              onChanged={message => { setToast(message); reload() }}
              onEdit={d => setSheet({ name: 'plan', kind: d.trip.scope, past: d.trip.origin === 'POST_FACTO', editing: d.trip })}
              onOpenClaim={id => setView({ name: 'claim', id })}
              onOpenLeg={leg => setView({ name: 'leg', tripId: view.id, leg })}
              onAddLeg={detail => setSheet({ name: 'addLeg', detail })}
              onAddBill={tripId => setSheet({ name: 'expense', tripId })}
              onClaim={detail => setView({ name: 'tripClaim', trip: detail.trip })}
            />
          ) : null}
          {view.name === 'claim' ? (
            <TeClaimDetail
              claimId={view.id}
              catName={catName}
              resuming={view.resuming}
              onBack={() => setView({ name: 'claims' })}
              onChanged={message => { setToast(message); reload() }}
              // Screen 83d: a line the approver marked opens in the expense
              // form that already exists here, on that line and its trip.
              onFixLine={(line, tripId) => setSheet({ name: 'expense', line, tripId })}
            />
          ) : null}
        </div>
      </main>
      </div>

      {/* Phone only — te.css hides the rail at this width and shows this. */}
      <nav className="tabbar" aria-label="Quick navigation">
        <button type="button" aria-current={view.name === 'home' ? 'page' : 'false'} onClick={() => goto('home')}><TeIcon name="home" /><span>Home</span></button>
        <button type="button" aria-current={view.name === 'expenses' ? 'page' : 'false'} onClick={() => goto('expenses')}><TeIcon name="other" /><span>Expenses</span>{unclaimed.length ? <i className="dot" /> : null}</button>
        <button type="button" className="plus" onClick={() => setSheet({ name: 'new' })} aria-label="New claim"><i><TeIcon name="plus" /></i><span>New claim</span></button>
        <button type="button" aria-current={view.name === 'claims' || view.name === 'claim' ? 'page' : 'false'} onClick={() => goto('claims')}><TeIcon name="claims" /><span>Claims</span>{sentBack.length ? <i className="dot" /> : null}</button>
        <button type="button" onClick={() => (onExit ? onExit() : goto('home'))}><TeIcon name="more" /><span>{onExit ? 'ESS' : 'More'}</span></button>
      </nav>

      {/* Step 1 of the entry flow: what the claim is about. The prototype's dlgNew. */}
      {sheet?.name === 'new' ? (
        <TeSheet
          wide
          title="New claim"
          lead="Three steps: what, how, then the form."
          bar={<TeSteps on={1} kind={null} way={null} onTo={() => setSheet({ name: 'new' })} />}
          onClose={() => setSheet(null)}
        >
          <div className="kinds" role="list">
            {KINDS.map(k => (
              <button key={k.id} type="button" role="listitem" className={`kind k-${k.id}`} onClick={() => setSheet(k.id === 'other' ? { name: 'expense' } : { name: 'kind', kind: k.id, way: null })}>
                <span className="ki"><TeIcon name={k.id} size="lg" /></span>
                {live[k.id] ? <span className="kb live"><i />On the way</span> : todo[k.id] ? <span className="kb">{todo[k.id]}</span> : null}
                <span className="kt"><b>{k.title}</b><small>{k.text}</small></span>
                <span className="kf"><span className="kg">{k.foot}</span><TeIcon name="go" size="sm" /></span>
              </button>
            ))}
          </div>
        </TeSheet>
      ) : null}

      {sheet?.name === 'kind' ? (() => {
        const kind = sheet.kind
        const items = continueItems(kind, facts)
        const wayFacts = {
          manualAllowed: Boolean(snap.cfg.track.manualAllowed),
          postFacto: snap.cfg.postFacto,
          savedBills: unclaimed.length,
          approved: approvedTrips(kind, facts).length,
        }
        const onApproved = sheet.way === 'approved'
        return (
          <TeSheet
            wide
            title={KIND_NAME[kind]}
            titleIcon={<span className={`hk k-${kind}`}><TeIcon name={kind} size="sm" /></span>}
            lead={KINDS.find(k => k.id === kind)?.text}
            back={() => (onApproved ? setSheet({ name: 'kind', kind, way: null }) : setSheet({ name: 'new' }))}
            bar={<TeSteps on={onApproved ? 3 : 2} kind={kind} way={sheet.way} onTo={step => setSheet(step === 1 ? { name: 'new' } : { name: 'kind', kind, way: null })} />}
            onClose={() => setSheet(null)}
          >
            {onApproved ? (
              <TePickTrip
                scope={kind}
                me={snap.me}
                trips={snap.trips}
                journeys={snap.journeys}
                today={snap.today}
                placeName={placeName}
                // Straight to the leg's own screen, the same way the live bar
                // and the trip detail open one. This said "not built yet"
                // while TeLegLive was already wired to every other route in.
                onStartLeg={(_legId, leg) => { setSheet(null); setView({ name: 'leg', tripId: leg.tripId, leg }) }}
                onOpenTrip={openTrip}
              />
            ) : (
              <>
                {items.length ? (
                  <div className="sec">
                    <h4>Continue</h4>
                    <div className="stack sm">
                      {items.map(x => (
                        <div key={x.id} className={x.tone ? `cont ${x.tone}` : 'cont'}>
                          <div className="grow">
                            <div className="eyebrow">{x.trip}</div>
                            <b>{x.title}</b>
                            <div className="small muted">{x.sub}</div>
                          </div>
                          <button
                            type="button"
                            className={x.tone === 'go' || x.tone === 'live' ? 'btn pri sm' : 'btn sm'}
                            onClick={() => (x.action === 'openTrip' ? openTrip(x.id) : openLeg(x.tripId, x.id))}
                          >
                            {x.btn}<TeIcon name="go" size="sm" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="sec">
                  <h4>{items.length ? 'Or start something new' : 'How do you want to start?'}</h4>
                  <div className="ways">
                    {FLOW_WAYS[kind].map((w, i) => {
                      const off = wayOff(kind, w.id, wayFacts)
                      const count = wayCount(w.id, wayFacts)
                      return (
                        <button
                          key={w.id}
                          type="button"
                          className={i === 0 && !off ? 'way pri' : 'way'}
                          disabled={!!off}
                          onClick={() => {
                            if (w.id === 'approved') return setSheet({ name: 'kind', kind, way: 'approved' })
                            if (w.id === 'plan' || w.id === 'past') return setSheet({ name: 'plan', kind, past: w.id === 'past' })
                            if (w.id === 'start') return setSheet({ name: 'startNow' })
                            return noSuchWay(w.id)
                          }}
                        >
                          <span className="wi"><TeIcon name={w.icon} size="lg" /></span>
                          <span className="grow">
                            <b>{w.title}{count ? <span className="chip plain t-brand">{count}</span> : null}</b>
                            <small>{off || w.text}</small>
                            {off ? null : <span className="wc">{w.chips.map(c => <span key={c}>{c}</span>)}</span>}
                          </span>
                          {off ? null : <TeIcon name="go" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </TeSheet>
        )
      })() : null}
      {sheet?.name === 'addLeg' ? (
        <TeLegAdd
          snap={snap}
          detail={sheet.detail}
          onClose={() => setSheet(null)}
          onPlaceAdded={reload}
          onAdded={(legId, message, opts) => {
            const tripId = sheet.detail.trip.id
            done(message)
            // RECORDING HAS BEGUN, so land on the journey rather than the trip:
            // the screen that shows the distance climbing is the one somebody
            // who just pressed "Add and start now" is expecting. The journey
            // was created a moment ago and is not in the snapshot this screen
            // holds, so the trip is the honest fallback — it loads its own.
            if (!opts?.started) return
            const leg = snap.journeys.find(j => j.id === legId)
            setView(leg ? { name: 'leg', tripId, leg } : { name: 'trip', id: tripId })
          }}
        />
      ) : null}
      {sheet?.name === 'startNow' ? (
        <TeStartNow
          snap={snap}
          onClose={() => setSheet(null)}
          onPlaceAdded={reload}
          onStarted={(tripId, legId, message) => {
            setSheet(null); setToast(message); reload()
            const leg = snap.journeys.find(j => j.id === legId)
            // The leg was created a moment ago, so it is not in the snapshot
            // this screen is holding. Land on the trip and let it load.
            setView(leg ? { name: 'leg', tripId, leg } : { name: 'trip', id: tripId })
          }}
        />
      ) : null}
      {sheet?.name === 'plan' ? (
        <TePlanner
          snap={snap}
          scope={sheet.kind}
          origin={sheet.past ? 'POST_FACTO' : 'PRE_APPROVED'}
          editing={sheet.editing}
          resuming={sheet.resuming}
          onClose={() => { setSheet(null); draftsChanged() }}
          // Screen 18: a plan you just sent lands on the trip itself, where the
          // approval chain and the next leg are. Going Home would hide the
          // thing that was just created behind a tile.
          onSaved={(id, message) => { done(message); setView({ name: 'trip', id }) }}
          // reload() only, never done(): done() closes the sheet, and the plan
          // being written lives inside it.
          onVehicleAdded={reload}
        />
      ) : null}
      {sheet?.name === 'expense' ? (
        <TeExpenseForm key={sheet.resuming?.id ?? sheet.line?.id ?? 'new'} snap={snap} line={sheet.line} tripId={sheet.tripId} resuming={sheet.resuming} onClose={() => { setSheet(null); draftsChanged() }} onSaved={message => { done(message); setView({ name: 'expenses' }) }} />
      ) : null}

      <div className="toasts" aria-live="polite">{toast ? <div className="toast">{toast}</div> : null}</div>
    </div>
  )
}
