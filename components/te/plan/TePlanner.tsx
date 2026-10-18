'use client'
// components/te/plan/TePlanner.tsx — plan a trip, in five steps.
//
// Screens 10-23, 25, 26, 28 and 35-39 are all this one component: the same
// five steps serve a local, domestic or international trip, a plan for later
// and a trip you already took. What changes between them is which fields the
// steps show, and that is decided by `scope` and `origin` on the draft.
//
// WHY FIVE AND NOT THREE. The old step 2 asked for the route AND how you
// travel every leg of it — places, dates, a mode each, the vehicle, which
// airport, who books the ticket — and the hotel question was a block buried in
// Review, where nobody expects to be asked something new. Four questions were
// wearing one step. Now each step is one decision:
//
//   1 Trip      what it is, why, who is going
//   2 Route     one way or round trip, where from, where to, when
//   3 Commute   how you travel each journey, offered per kind of trip
//   4 Stay      a hotel, and the food budget
//   5 Review    the whole plan, the map, the money, then send
//
// Nothing the server computes changed. The same preview answers the same way;
// only which step shows which of its refusals moved, and that lives in
// stepOfIssue in lib/te/trip-draft.ts.
//
// WHO DECIDES WHAT
//   This file owns the FORM: which step you are on, which route line is open,
//   and whether you have tried to move on yet. lib/te/trip-draft.ts owns the
//   SHAPE of the draft and is tested. The SERVER owns everything else — every
//   leg, every rupee, the approval chain and every refusal arrive from
//   te.tripPreview and are rendered, never recomputed.
//
// The preview is debounced at 350ms and a late answer to an older question is
// dropped, the same way TeExpenseForm does it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeTrip, TripIssue, TripOrigin, TripPreview, TripScope, Uuid } from '@/lib/te/types'
import {
  blockingOn, firstOpenLine, fromTrip, LAST_STEP, newPlannerDraft, setScope, stepOfIssue, syncDraft, toTripDraft,
  type DraftContext, type PlanStep, type PlannerDraft,
} from '@/lib/te/trip-draft'
import { errorText, plural, rs } from '@/lib/te/format'
import { nightsBetween } from '@/lib/te/trip-stay'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePlanTrip from './TePlanTrip'
import TePlanRoute from './TePlanRoute'
import TePlanCommute from './TePlanCommute'
import TePlanStay from './TePlanStay'
import TePlanReview from './TePlanReview'
import TePlacePicker, { type PickTarget } from './TePlacePicker'

const STEPS: { title: string; sub: string }[] = [
  { title: 'Trip', sub: 'What and why' },
  { title: 'Route', sub: 'Where and when' },
  { title: 'Commute', sub: 'How you travel' },
  { title: 'Stay', sub: 'Hotel and food' },
  { title: 'Review', sub: 'Check, then send' },
]

/** The day before today that was a working day. Used to date a local trip that
 *  has already happened, because "today" is rarely the answer for one of those. */
export function lastWorkday(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

export default function TePlanner({ snap, scope, origin, editing, onClose, onSaved, onVehicleAdded }: {
  snap: Snapshot
  scope: TripScope
  /** POST_FACTO is "I already travelled": no approval before, a reason required. */
  origin: TripOrigin
  /** A saved trip being changed. Screens 68b and 68c; `scope` and `origin` are
   *  then taken from the trip itself rather than from these props. */
  editing?: TeTrip
  onClose: () => void
  onSaved: (tripId: Uuid, message: string) => void
  /** A vehicle was registered from inside the plan, so the snapshot is stale.
   *  Refetching must NOT close the planner: the half-built trip lives in this
   *  component's state and would go with it. */
  onVehicleAdded?: () => void
}) {
  const ctx = useMemo<DraftContext>(() => ({
    today: snap.today,
    // Where a trip starts and comes back to by default: the employee's own base.
    officePlace: snap.masters.places.find(p => p.pt === 'corp' && p.city === snap.emp[snap.me]?.base)?.id
      ?? snap.masters.places.find(p => p.pt === 'corp')?.id
      ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }), [snap])

  // Built once. An `edit` arriving later would throw away whatever has been
  // typed since, so the trip to edit is read on mount and not watched.
  const [draft, setDraft] = useState<PlannerDraft>(() => (
    editing
      ? fromTrip(editing, ctx)
      : { ...newPlannerDraft({ scope, origin, lastWorkday: lastWorkday(snap.today) }, ctx), lockScope: true }
  ))
  const [preview, setPreview] = useState<TripPreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [picking, setPicking] = useState<PickTarget | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /** Every edit goes through here, so the draft's shape is repaired every time. */
  const edit = useCallback((patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => {
    setDraft(d => syncDraft(typeof patch === 'function' ? patch(d) : { ...d, ...patch }, ctx))
  }, [ctx])

  const payload = useMemo(() => toTripDraft(draft), [draft])

  // The live preview, and the only validator. It runs on an empty draft too:
  // "Give the trip a name" and "Choose where you go" are the server's sentences,
  // and the gates below have nothing to refuse with until it has answered.
  //
  // State is set in the promise callback, never in the effect body, and an
  // answer that arrives after the draft moved on is dropped.
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      te.tripPreview(payload)
        .then(p => { if (current) { setPreview(p); setPreviewFailed(false) } })
        // A preview that will not load must not become "nothing is wrong": the
        // gates stay shut and say so, rather than waving a bad plan through.
        .catch(() => { if (current) { setPreview(null); setPreviewFailed(true) } })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [payload])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(t)
  }, [toast])

  // Memoised because goStep closes over it: a fresh [] every render would make
  // that callback a new function every render too.
  const issues = useMemo<TripIssue[]>(() => preview?.issues ?? [], [preview])
  const step = draft.step

  const goStep = useCallback((n: PlanStep) => {
    setDraft(d => {
      const next = syncDraft({ ...d, step: n }, ctx)
      // Arriving on the route or the commute, open the first line that still
      // needs something — unless the person has deliberately closed them all.
      return (n === 2 || n === 3) && next.open === undefined ? { ...next, open: firstOpenLine(issues) } : next
    })
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [ctx, issues])

  /** Next is gated; the step chips above are not. Someone who jumps ahead is
   *  caught at save, which is where the whole plan is checked anyway.
   *
   *  No preview means no answer yet, not a clean bill of health — moving on
   *  then would skip every check the server owns. */
  function next() {
    if (!preview) {
      setToast(previewFailed ? 'Could not check this plan just now. Try again in a moment.' : 'Checking the plan…')
      return
    }
    const blocking = blockingOn(issues, step)
    if (blocking.length) {
      setDraft(d => ({ ...d, tried: true, ...(step === 2 || step === 3 ? { open: firstOpenLine(issues) } : {}) }))
      setToast(blocking.length === 1 ? blocking[0].t : `${blocking.length} things to fill on this step. They are marked in red.`)
      return
    }
    goStep(Math.min(LAST_STEP, step + 1) as PlanStep)
  }

  async function save() {
    // Same reasoning as next(): an unchecked plan is not an approved one.
    if (!preview) {
      setToast(previewFailed ? 'Could not check this plan just now. Try again in a moment.' : 'Checking the plan…')
      return
    }
    const blocking = issues.filter(i => i.block)
    if (blocking.length) {
      const lowest = Math.min(...blocking.map(i => stepOfIssue(i.k))) as PlanStep
      setDraft(d => ({ ...d, tried: true, step: lowest }))
      setToast('A few things are missing. They are marked in red.')
      return
    }
    setSaving(true)
    try {
      const r = await te.tripSave(payload)
      onSaved(r.trip_id, `${r.trip_no} saved.`)
    } catch (e) {
      setToast(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  // The kind and the origin of a trip being edited come from the trip, not from
  // the props: the person may have changed the kind on step 1.
  const planning = draft.origin !== 'POST_FACTO'
  const editingThis = !!draft.editId

  const title = editingThis ? `Edit ${draft.name || 'trip'}`
    : planning ? 'Plan a trip'
      : 'Record a trip you already did'
  const lead = editingThis
    ? (draft.answerNeeded ? 'Change what your approver asked about, then send it again.' : 'Change the plan.')
    : planning ? 'Five short steps, one question each. Every journey, stop and bill stays inside this trip.'
      : 'For a trip that was not tracked. The journeys are added without GPS and your approver sees why.'

  // The send button says what will actually happen, which the server has already
  // decided: a short local trip needs no approval before you leave.
  const sendLabel = editingThis ? (draft.answerNeeded ? 'Send again' : 'Save changes')
    : !planning ? 'Save and add the fares'
      : preview && !preview.needsApproval ? 'Save the plan'
        : 'Send for approval'

  const stepHasError = (n: PlanStep) => !!draft.tried && blockingOn(issues, n).length > 0

  const bar = (
    <nav className="wsteps" aria-label="Steps">
      {STEPS.map((s, i) => {
        const n = (i + 1) as PlanStep
        const done = step > n && !stepHasError(n)
        return (
          <button
            key={s.title}
            type="button"
            className={`ws ${step === n ? 'on' : done ? 'done' : ''} ${stepHasError(n) ? 'bad' : ''}`}
            aria-current={step === n ? 'step' : 'false'}
            // The label is spelled out because te.css hides the title text on a
            // phone for every step but the current one — five titles do not fit
            // at 360px. Hiding it visually must not take the name away from a
            // screen reader, so it lives here too.
            aria-label={`Step ${n} of ${STEPS.length}: ${s.title}. ${s.sub}`}
            onClick={() => goStep(n)}
          >
            <span className="wn">{done ? <TeIcon name="check" size="sm" /> : n}</span>
            <span className="wt"><b>{s.title}</b><small>{s.sub}</small></span>
          </button>
        )
      })}
    </nav>
  )

  const footer = (
    <>
      <div className="tw-bar">{summary(preview, draft.pax, planning)}</div>
      <div className="row tight">
        {step > 1
          ? <button type="button" className="btn" onClick={() => goStep((step - 1) as PlanStep)}><TeIcon name="back" size="sm" />Back</button>
          : <button type="button" className="btn" onClick={onClose}>Cancel</button>}
        {step < LAST_STEP
          ? <button type="button" className="btn pri" onClick={next}>Next: {STEPS[step].title}<TeIcon name="go" size="sm" /></button>
          : <button type="button" className="btn pri" onClick={save} disabled={saving}>{saving ? 'Saving…' : sendLabel}</button>}
      </div>
    </>
  )

  // The picker takes the whole drawer over, as it does in the prototype: it is a
  // search with a map, not something that fits beside the form it serves.
  if (picking) {
    return (
      <TePlacePicker
        snap={snap}
        target={picking}
        onCancel={() => setPicking(null)}
        // A place created in the picker is not in the snapshot this planner was
        // handed, so the route line would name it "—". Same callback the new
        // vehicle uses: refetch, do not close.
        onPlaceAdded={onVehicleAdded}
        onChosen={(placeId, pt) => {
          const t = picking
          setPicking(null)
          edit(d => {
            if (t.kind === 'point') {
              const points = [...d.points]
              points[t.index] = { ...points[t.index], place: placeId, pt: pt || points[t.index].pt }
              return { ...d, points, open: `p${t.index}` }
            }
            const segs = [...d.segs]
            segs[t.index] = { ...segs[t.index], xfer: { ...segs[t.index].xfer, [t.side === 'A' ? 'hubA' : 'hubB']: placeId } }
            return { ...d, segs }
          })
        }}
      />
    )
  }

  return (
    <TeSheet
      // Wider than the other sheets: the route is drawn left to right now and
      // a 760px drawer showed two places and half a third.
      roomy
      title={title}
      lead={lead}
      // No entry-flow crumb on an edit: the person did not come through the
      // four tiles, so "Step 3 of 3" would be describing a journey they never made.
      // NO STEP COUNTER HERE. It read "Step 3 of 3" — the entry flow's own three
      // steps, which was true — directly above a bar saying step 1 of 5. Two
      // step counters disagreeing on one screen is read as a bug, and the only
      // one that matters now is the bar's. The path stays: which kind of trip
      // this is remains worth knowing.
      crumb={editingThis ? undefined : (
        <span className="fpath">
          {KIND_LABEL[draft.scope]}<span className="muted"> › </span>{planning ? 'Plan a trip' : 'I already travelled'}
        </span>
      )}
      bar={bar}
      onClose={onClose}
      footer={footer}
    >
      <div ref={bodyRef}>
        {step === 1 ? (
          <TePlanTrip
            snap={snap} draft={draft} issues={issues} edit={edit}
            setScope={s => setDraft(d => setScope(d, s, ctx, lastWorkday(snap.today)))}
          />
        ) : null}
        {step === 2 ? (
          <TePlanRoute snap={snap} draft={draft} issues={issues} preview={preview} edit={edit} onPick={setPicking} />
        ) : null}
        {step === 3 ? (
          <TePlanCommute
            snap={snap} draft={draft} issues={issues} edit={edit} onPick={setPicking}
            onVehicleAdded={message => { setToast(message); onVehicleAdded?.() }}
          />
        ) : null}
        {step === 4 ? (
          <TePlanStay
            draft={draft}
            foodBudget={preview?.estimate.meals ?? 0}
            nights={nightsBetween(preview?.start ?? null, preview?.end ?? null)}
            edit={edit}
          />
        ) : null}
        {step === 5 ? <TePlanReview snap={snap} draft={draft} issues={issues} preview={preview} edit={edit} onGoStep={goStep} /> : null}
      </div>
      {toast ? <div className="toasts"><div className="toast err"><TeIcon name="warn" size="sm" />{toast}</div></div> : null}
    </TeSheet>
  )
}

const KIND_LABEL: Record<TripScope, string> = {
  local: 'Local trip',
  domestic: 'Domestic trip',
  international: 'International trip',
}

/** The sticky line under the form: what the plan adds up to so far. Every number
 *  is the server's — this only words them. */
function summary(preview: TripPreview | null, pax: number, planning: boolean) {
  const legs = preview?.legs ?? []
  if (!legs.length) return <span className="muted">Add the places to see the journeys</span>
  const km = Math.round(legs.filter(l => l.mode !== 'flight').reduce((a, l) => a + l.km, 0) * 10) / 10
  const flights = legs.filter(l => l.mode === 'flight').length
  const total = preview?.estimateTotal ?? 0
  return (
    <>
      <b>{plural(legs.length, 'journey')}</b>
      {` · ${km} km`}
      {flights ? ` + ${plural(flights, 'flight')}` : ''}
      {planning && total ? <> · <b>{rs(total)}</b> est.</> : null}
      {pax > 1 ? ` · ${pax} people` : ''}
    </>
  )
}
