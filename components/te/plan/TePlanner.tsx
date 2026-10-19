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
import type { Snapshot, TeDraft, TeTrip, TripIssue, TripOrigin, TripPreview, TripScope, Uuid } from '@/lib/te/types'
import {
  blockingOn, firstOpenLine, fromTrip, HUB_MODES, LAST_STEP, nearestStep, newPlannerDraft, setScope,
  step1Gaps, stepAfter, stepBefore, stepOfIssue, syncDraft, toTripDraft, visibleSteps,
  type DraftContext, type PlanStep, type PlannerDraft,
} from '@/lib/te/trip-draft'
import { errorText, plural, rs } from '@/lib/te/format'
import { draftTitle, savedAgo, worthSaving } from '@/lib/te/autosave'
import { useDraftAutosave } from '../useDraftAutosave'
import { nightsBetween } from '@/lib/te/trip-stay'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePlanTrip from './TePlanTrip'
import TePlanRoute from './TePlanRoute'
import TePlanCommute from './TePlanCommute'
import TePlanStay from './TePlanStay'
import TePlanReview from './TePlanReview'
import TePlacePicker, { type PickTarget } from './TePlacePicker'

/** Spelled out, because "4 short steps" reads like a form field and "Four
 *  short steps" reads like a sentence. Only the lengths this planner can
 *  actually have need an entry. */
const STEP_COUNT_WORD: Record<number, string> = { 3: 'Three', 4: 'Four', 5: 'Five' }

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

export default function TePlanner({ snap, scope, origin, editing, resuming, onClose, onSaved, onVehicleAdded }: {
  snap: Snapshot
  scope: TripScope
  /** POST_FACTO is "I already travelled": no approval before, a reason required. */
  origin: TripOrigin
  /** A saved trip being changed. Screens 68b and 68c; `scope` and `origin` are
   *  then taken from the trip itself rather than from these props. */
  editing?: TeTrip
  /** An unfinished plan being picked up again. Its body is the whole form,
   *  `step` and all, so it decides where the planner opens. */
  resuming?: TeDraft
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
  //
  // A RESUMED DRAFT WINS over both: it IS the half-finished work, and it is
  // put back through syncDraft rather than trusted, because it was written by
  // an older build of this form and its shape may have moved on since.
  const [draft, setDraft] = useState<PlannerDraft>(() => (
    resuming
      ? syncDraft(resuming.body as unknown as PlannerDraft, ctx)
      : editing
        ? fromTrip(editing, ctx)
        : { ...newPlannerDraft({ scope, origin, lastWorkday: lastWorkday(snap.today) }, ctx), lockScope: true }
  ))
  // The form as it was opened. Autosave compares against this, so looking at a
  // plan and closing it leaves nothing in the Drafts list. useState keeps the
  // FIRST draft and ignores every later one — if this tracked `draft` it would
  // always equal it and nothing would ever save.
  const [pristine] = useState<PlannerDraft>(draft)
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

  // UNFINISHED WORK IS KEPT. A plan takes real thought — a route, dates, who
  // books each leg — and until now closing the drawer threw all of it away.
  // The whole form is the draft, `step` included, so resuming reopens on the
  // step they left. Suspended while submitting so the save and the delete
  // cannot race each other.
  const autosave = useDraftAutosave({
    kind: 'trip',
    body: draft as unknown as Record<string, unknown>,
    pristine: pristine as unknown as Record<string, unknown>,
    title: draftTitle('trip', draft),
    scope: draft.scope,
    step: draft.step,
    tripId: draft.editId ?? editing?.id ?? null,
    resumingId: resuming?.id ?? null,
    enabled: !saving,
  })
  // Whether there is anything to keep. The same test autosave uses, so the
  // button appears exactly when a draft would be written.
  const touched = useMemo(() => worthSaving(draft, pristine), [draft, pristine])

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
  /** Can this kind of trip use a flight or a train at all? The company's own
   *  configuration answers it (te_modes carries a flag per scope), so a local
   *  trip with both switched off is never asked the question — and if an
   *  administrator switches flight on for local, it is. */
  const offersHub = useMemo(
    () => snap.cfg.modes.some(m => m.on && m.scopes.includes(draft.scope) && HUB_MODES.includes(m.id)),
    [snap.cfg.modes, draft.scope],
  )
  const steps = useMemo(() => visibleSteps(draft), [draft])
  const lastStep = steps[steps.length - 1]

  // THE STEP UNDERNEATH CAN DISAPPEAR. Answering "no stay" on step 1 removes
  // step 4, and somebody who was standing on it has to be put somewhere real.
  // Done in an effect rather than during render: the draft is state, and
  // moving them is a change to it, not a thing to compute on the way past.
  useEffect(() => {
    if (steps.includes(step)) return
    const to = nearestStep(draft, step)
    setDraft(d => syncDraft({ ...d, step: to }, ctx))
  }, [steps, step, draft, ctx])

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
    // The two questions step 1 owns. They are not the server's to refuse —
    // both answers only decide what the rest of the form asks — so they are
    // gated here, and said in the same words as any other refusal.
    if (step === 1) {
      const gaps = step1Gaps(draft, offersHub)
      if (gaps.length) {
        setDraft(d => ({ ...d, tried: true }))
        setToast(gaps.length === 1 ? gaps[0] : `${gaps.length} things to answer on this step.`)
        return
      }
    }
    const to = stepAfter(draft, step)
    if (to) goStep(to)
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
      // The plan is real now, so the half-finished copy of it has no reason to
      // sit in the Drafts list. Awaited before onSaved, which unmounts this.
      await autosave.discard()
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
    : planning ? `${STEP_COUNT_WORD[steps.length] ?? steps.length} short steps, one question each. Every journey, stop and bill stays inside this trip.`
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
      {/* Only the steps this plan has. A chip for a step that is not there
          would be a promise the Next button does not keep. */}
      {steps.map((n, i) => {
        const s = STEPS[n - 1]
        const done = step > n && !stepHasError(n)
        // WHAT THE CHIP COUNTS IS ITS PLACE IN THE LINE, not which of the five
        // screens it is. With the Stay step hidden, Review stands fourth and
        // has to say 4 — a sequence that reads 1, 2, 3, 5 asks the reader to
        // wonder what they missed.
        const shown = i + 1
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
            aria-label={`Step ${shown} of ${steps.length}: ${s.title}. ${s.sub}`}
            onClick={() => goStep(n)}
          >
            <span className="wn">{done ? <TeIcon name="check" size="sm" /> : shown}</span>
            <span className="wt"><b>{s.title}</b><small>{s.sub}</small></span>
          </button>
        )
      })}
    </nav>
  )

  /** Save the draft and leave. Not the same button as Send: this one makes no
   *  claim that the plan is finished or even valid, which is the point. */
  async function keepForLater() {
    await autosave.saveNow()
    onClose()
  }

  const footer = (
    <>
      <div className="tw-bar">{summary(preview, draft.pax, planning)}</div>
      {/* Said where the buttons are, because that is where somebody looks
          before deciding whether it is safe to close the drawer. */}
      <div className="savedline">
        {autosave.state === 'saving' ? <span className="small muted">Saving…</span> : null}
        {autosave.state === 'saved' && autosave.savedAt
          ? <span className="small muted"><TeIcon name="check" size="sm" />{savedAgo(autosave.savedAt, Date.now())}</span>
          : null}
        {autosave.state === 'error'
          ? <span className="small warn"><TeIcon name="warn" size="sm" />Not saved yet — we will keep trying.</span>
          : null}
      </div>
      <div className="row tight">
        {stepBefore(draft, step)
          ? <button type="button" className="btn" onClick={() => goStep(stepBefore(draft, step) as PlanStep)}><TeIcon name="back" size="sm" />Back</button>
          : <button type="button" className="btn" onClick={onClose}>Cancel</button>}
        {/* Offered only once there is something to keep. On an untouched form
            it would promise to save work that does not exist. */}
        {touched && !saving
          ? <button type="button" className="btn" onClick={keepForLater}>Finish later</button>
          : null}
        {step < lastStep
          ? <button type="button" className="btn pri" onClick={next}>Next: {STEPS[(stepAfter(draft, step) ?? lastStep) - 1].title}<TeIcon name="go" size="sm" /></button>
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
            snap={snap} draft={draft} issues={issues} edit={edit} preview={preview} offersHub={offersHub}
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
