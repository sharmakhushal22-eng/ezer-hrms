// src/features/expenses/plan/PlannerSheet.tsx — plan a trip, in three steps
// (components/te/plan/TePlanner.tsx), as the sheet route
//   /expenses/plan?kind=<local|domestic|international>&past=1&edit=<tripId>
//
// WHO DECIDES WHAT (as on the website): this file owns the FORM — the step, the
// open route line, whether the person has tried to move on. lib/te/trip-draft
// owns the SHAPE of the draft. The SERVER owns everything else: every journey,
// every rupee, the approval chain and every refusal arrive from the live
// preview (usePreview.ts) and are rendered, never recomputed.
//
// TeHome's contracts: onSaved(id, msg) → notify(msg); reloadTe(); swap(trip id).
// onClose → close(). A vehicle added inside the plan → reloadTe() only: the
// draft lives in this sheet and must survive. The planner's own toasts stay in
// the sheet (div.toasts > .toast.err on the web), cleared after 4200 ms.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { Snapshot, TeTrip, TripOrigin, TripPreview, TripScope, Uuid } from '@web/te/types'
import {
  blockingOn, firstOpenLine, fromTrip, newPlannerDraft, setScope, stepOfIssue, syncDraft, toTripDraft,
  type DraftContext, type PlannerDraft,
} from '@web/te/trip-draft'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText, plural, rs, te } from '../api'
import { findTrip, reloadTe, useSnap, useTripDetail } from '../data'
import { close, param, swap, teHref } from '../nav'
import { TeIcon } from '../ui/TeIcon'
import { TeSheet } from '../ui/TeSheet'
import { SnapState } from '../ui/TeScreen'
import { Crumb, SheetToast, useSheetToast } from './parts'
import { PlacePicker, type PickTarget } from './PlacePicker'
import { PlanReview } from './PlanReview'
import { PlanRoute } from './PlanRoute'
import { PlanTrip } from './PlanTrip'
import { useTripPreview } from './usePreview'

const STEPS: { title: string; sub: string }[] = [
  { title: 'Trip', sub: 'Name, reason, people' },
  { title: 'Route', sub: 'Places, stops, travel' },
  { title: 'Review', sub: 'Journeys, money, approval' },
]
const KIND_LABEL: Record<TripScope, string> = { local: 'Local trip', domestic: 'Domestic trip', international: 'International trip' }
const SCOPES: TripScope[] = ['local', 'domestic', 'international']

/** The day before today that was a working day (TePlanner.lastWorkday). */
export function lastWorkday(today: string): string {
  const d = new Date(`${today}T00:00:00Z`)
  do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

function StepBar({ step, bad, onGo }: { step: 1 | 2 | 3; bad: (n: 1 | 2 | 3) => boolean; onGo: (n: 1 | 2 | 3) => void }) {
  const { C } = useTheme()
  return (
    <View accessibilityLabel="Steps" style={{ flexDirection: 'row', gap: 4 }}>
      {STEPS.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const on = step === n
        const isBad = bad(n)
        const done = step > n && !isBad
        return (
          <Pressable key={s.title} onPress={() => onGo(n)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 10, minHeight: 44, backgroundColor: on ? C.brandTint : pressed ? C.sunken : 'transparent' })}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isBad ? C.critical : on ? C.brand : done ? C.positiveTint : C.sunken }}>
              {done ? <TeIcon name="check" px={13} color={C.positive} /> : <Txt size={11.5} w={700} color={isBad || on ? C.onAccent : C.muted}>{n}</Txt>}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={12.5} w={700} color={isBad ? C.critical : on ? C.ink : C.inkSoft} numberOfLines={1}>{s.title}</Txt>
              <Txt size={10} tone="muted" numberOfLines={1}>{s.sub}</Txt>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The line above the footer buttons: what the plan adds up to so far (all server numbers). */
function Summary({ preview, pax, planning }: { preview: TripPreview | null; pax: number; planning: boolean }) {
  const legs = preview?.legs ?? []
  if (!legs.length) return <Txt size={F.tiny} tone="muted">Add the places to see the journeys</Txt>
  const km = Math.round(legs.filter(l => l.mode !== 'flight').reduce((a, l) => a + l.km, 0) * 10) / 10
  const flights = legs.filter(l => l.mode === 'flight').length
  const total = preview?.estimateTotal ?? 0
  return (
    <Txt size={F.tiny} tone="soft">
      <Txt size={F.tiny} w={700}>{plural(legs.length, 'journey')}</Txt>
      {` · ${km} km`}
      {flights ? ` + ${plural(flights, 'flight')}` : ''}
      {planning && total ? <>{' · '}<Txt size={F.tiny} w={700}>{rs(total)}</Txt>{' est.'}</> : null}
      {pax > 1 ? ` · ${pax} people` : ''}
    </Txt>
  )
}

function Planner({ snap, scope, origin, editing, onSaved, onVehicleAdded }: {
  snap: Snapshot
  scope: TripScope
  origin: TripOrigin
  editing?: TeTrip
  onSaved: (tripId: Uuid, message: string) => void
  onVehicleAdded: () => void
}) {
  const { C } = useTheme()
  const ctx = React.useMemo<DraftContext>(() => ({
    today: snap.today,
    officePlace: snap.masters.places.find(p => p.pt === 'corp' && p.city === snap.emp[snap.me]?.base)?.id
      ?? snap.masters.places.find(p => p.pt === 'corp')?.id
      ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }), [snap])

  // Built once: the trip to edit is read on mount and not watched.
  const [draft, setDraft] = React.useState<PlannerDraft>(() => (
    editing
      ? fromTrip(editing, ctx)
      : { ...newPlannerDraft({ scope, origin, lastWorkday: lastWorkday(snap.today) }, ctx), lockScope: true }
  ))
  const [saving, setSaving] = React.useState(false)
  const [toast, setToast] = useSheetToast(4200)
  const [picking, setPicking] = React.useState<PickTarget | null>(null)

  const edit = React.useCallback((patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => {
    setDraft(d => syncDraft(typeof patch === 'function' ? patch(d) : { ...d, ...patch }, ctx))
  }, [ctx])

  const payload = React.useMemo(() => toTripDraft(draft), [draft])
  const { preview, failed: previewFailed } = useTripPreview(payload)
  const issues = React.useMemo(() => preview?.issues ?? [], [preview])
  const step = draft.step

  const goStep = React.useCallback((n: 1 | 2 | 3) => {
    setDraft(d => {
      const next = syncDraft({ ...d, step: n }, ctx)
      return n === 2 && next.open === undefined ? { ...next, open: firstOpenLine(issues) } : next
    })
  }, [ctx, issues])

  function next() {
    if (!preview) { setToast(previewFailed ? 'Could not check this plan just now. Try again in a moment.' : 'Checking the plan…'); return }
    const blocking = blockingOn(issues, step)
    if (blocking.length) {
      setDraft(d => ({ ...d, tried: true, ...(step === 2 ? { open: firstOpenLine(issues) } : {}) }))
      setToast(blocking.length === 1 ? blocking[0].t : `${blocking.length} things to fill on this step. They are marked in red.`)
      return
    }
    goStep(Math.min(3, step + 1) as 1 | 2 | 3)
  }

  async function save() {
    if (!preview) { setToast(previewFailed ? 'Could not check this plan just now. Try again in a moment.' : 'Checking the plan…'); return }
    const blocking = issues.filter(i => i.block)
    if (blocking.length) {
      const lowest = Math.min(...blocking.map(i => stepOfIssue(i.k))) as 1 | 2 | 3
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

  const cancelPick = React.useCallback(() => setPicking(null), [])

  if (picking) {
    return (
      <PlacePicker snap={snap} target={picking} onCancel={cancelPick}
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
        }} />
    )
  }

  const planning = draft.origin !== 'POST_FACTO'
  const editingThis = !!draft.editId
  const title = editingThis ? `Edit ${draft.name || 'trip'}` : planning ? 'Plan a trip' : 'Record a trip you already did'
  const lead = editingThis
    ? (draft.answerNeeded ? 'Change what your approver asked about, then send it again.' : 'Change the plan.')
    : planning ? 'Three short steps. Every journey, stop and bill stays inside this trip.'
      : 'For a trip that was not tracked. The journeys are added without GPS and your approver sees why.'
  const sendLabel = editingThis ? (draft.answerNeeded ? 'Send again' : 'Save changes')
    : !planning ? 'Save and add the fares'
      : preview && !preview.needsApproval ? 'Save the plan'
        : 'Send for approval'
  const stepHasError = (n: 1 | 2 | 3) => !!draft.tried && blockingOn(issues, n).length > 0

  const footer = (
    <>
      <SheetToast text={toast} />
      <Summary preview={preview} pax={draft.pax} planning={planning} />
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        {step > 1
          ? <Button title="Back" variant="outline" style={{ flex: 1 }} onPress={() => goStep((step - 1) as 1 | 2)} icon={<TeIcon name="back" size="sm" color={C.brandDeep} />} />
          : <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={close} />}
        {step < 3
          ? <Button title={`Next: ${STEPS[step].title}`} style={{ flex: 1.6 }} onPress={next} icon={<TeIcon name="go" size="sm" color={C.onAccent} />} />
          : <Button title={saving ? 'Saving…' : sendLabel} style={{ flex: 1.6 }} disabled={saving} onPress={() => void save()} />}
      </View>
    </>
  )

  return (
    <TeSheet title={title} lead={lead} scrollKey={step} onClose={close}
      crumb={editingThis ? undefined : <Crumb kind={KIND_LABEL[draft.scope]} way={planning ? 'Plan a trip' : 'I already travelled'} />}
      bar={<StepBar step={step} bad={stepHasError} onGo={goStep} />}
      footer={footer}>
      {step === 1 && (
        <PlanTrip snap={snap} draft={draft} issues={issues} edit={edit}
          setScope={s => setDraft(d => setScope(d, s, ctx, lastWorkday(snap.today)))} />
      )}
      {step === 2 && (
        <PlanRoute snap={snap} draft={draft} issues={issues} preview={preview} edit={edit} onPick={setPicking}
          onVehicleAdded={message => { setToast(message); onVehicleAdded() }} />
      )}
      {step === 3 && <PlanReview snap={snap} draft={draft} issues={issues} preview={preview} edit={edit} onGoStep={goStep} />}
    </TeSheet>
  )
}

export default function PlannerSheet() {
  const params = useLocalSearchParams<{ kind?: string; past?: string; edit?: string }>()
  const kindParam = param(params.kind) as TripScope
  const scope: TripScope = SCOPES.includes(kindParam) ? kindParam : 'local'
  const past = param(params.past) === '1'
  const editId = param(params.edit) || null
  const { notify } = useOverlay()
  const q = useSnap()
  const known = findTrip(q.data, editId)
  const detail = useTripDetail(editId && !known ? editId : null)
  // Latched: the planner reads the trip once (TePlanner), so a later snapshot
  // without it must not unmount the half-edited draft.
  const [latched, setLatched] = React.useState<TeTrip | null>(null)
  const found = known ?? detail.data?.trip ?? null
  if (!latched && found) setLatched(found)
  const editing = editId ? latched ?? found : null

  const onSaved = React.useCallback((id: Uuid, msg: string) => {
    notify(msg)
    void reloadTe()
    swap(teHref.trip(id))
  }, [notify])
  const onVehicleAdded = React.useCallback(() => { void reloadTe() }, [])

  const waiting = !q.data || (!!editId && !editing)
  if (waiting) {
    const error = q.error ?? (editId && detail.error) ?? null
    return (
      <TeSheet title={editId ? 'Edit trip' : past ? 'Record a trip you already did' : 'Plan a trip'}>
        <SnapState error={error} onRetry={() => { void q.refetch(); if (editId) void detail.refetch() }} />
      </TeSheet>
    )
  }
  return (
    <Planner key={editing?.id ?? `${scope}-${past}`} snap={q.data!} scope={scope} origin={past ? 'POST_FACTO' : 'PRE_APPROVED'}
      editing={editing ?? undefined} onSaved={onSaved} onVehicleAdded={onVehicleAdded} />
  )
}
