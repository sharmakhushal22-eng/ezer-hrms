// src/features/expenses/plan/PlanCommute.tsx — step 3: how you travel each journey
// (components/te/plan/TePlanCommute.tsx, new in planner v2).
//
// One card per journey (a pair of places from step 2). Tapping one opens its
// panel (SegRow) in place of the card — the phone version of the website's strip
// with one panel under it. "Use <mode> for every journey" applies the open
// journey's mode to the rest (applyModeToAll; who books is never touched).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue } from '@web/te/types'
import { applyModeToAll, blockingOn, journeysUnlike, type PlannerDraft } from '@web/te/trip-draft'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { plural } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { H4, TeEmpty } from '../ui/kit'
import { Ferr } from './parts'
import type { PickTarget } from './PlacePicker'
import type { Edit } from './PlanTrip'
import { offeredModes, SegRow } from './SegRow'

const KIND_WORD: Record<string, string> = {
  local: 'this city', domestic: 'travel inside India', international: 'international travel',
}

function JourneyCard({ snap, draft, i, onPress }: { snap: Snapshot; draft: PlannerDraft; i: number; onPress: () => void }) {
  const { C } = useTheme()
  const s = draft.segs[i]
  const place = (id: string) => snap.masters.places.find(p => p.id === id) ?? null
  const a = place(draft.points[i]?.place ?? '')
  const b = place(draft.points[i + 1]?.place ?? '')
  const md = snap.cfg.modes.find(m => m.id === s.mode) ?? null
  const bad = !!draft.tried && !s.mode
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`Journey ${i + 1}: ${a?.s ?? 'start'} to ${b?.s ?? 'destination'}. ${md ? md.name : 'no mode chosen yet'}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.md,
        borderWidth: 1, borderStyle: s.mode ? 'solid' : 'dashed', borderColor: bad ? C.critical : C.lineStrong,
        backgroundColor: pressed ? C.brandTint : s.mode ? C.surface : C.sunken,
      })}>
      <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: s.mode ? C.ink : C.surface, borderWidth: s.mode ? 0 : 1.5, borderColor: C.lineStrong }}>
        {s.mode ? <TeIcon name="check" px={13} color={C.surface} /> : <Txt size={11.5} w={700} tone="soft">{i + 1}</Txt>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.micro} tone="muted">{`Journey ${i + 1}`}</Txt>
        <Txt size={F.small} w={700} numberOfLines={2}>{`${a?.s ?? '—'} → ${b?.s ?? '—'}`}</Txt>
        <Txt size={F.micro} color={md ? C.muted : C.faint}>
          {md ? md.name : 'Choose how you travel'}{md && s.bookedBy === 'desk' ? ' · Travel Desk books' : ''}
        </Txt>
      </View>
      <TeIcon name="down" size="sm" color={C.muted} />
    </Pressable>
  )
}

export function PlanCommute({ snap, draft, issues, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  edit: Edit
  onPick: (t: PickTarget) => void
  onVehicleAdded: (message: string) => void
}) {
  const { C } = useTheme()
  const legs = draft.segs.length
  const offered = offeredModes(snap, draft)
  const isOpen = (i: number) => draft.open === `s${i}`
  const toggle = (i: number) => edit({ open: isOpen(i) ? null : `s${i}` })
  const left = blockingOn(issues, 3).length
  const openAt = draft.segs.findIndex((_, i) => isOpen(i))
  const openSeg = openAt >= 0 ? draft.segs[openAt] : null
  const openMode = openSeg ? snap.cfg.modes.find(m => m.id === openSeg.mode) ?? null : null
  const others = openSeg ? journeysUnlike(draft, openSeg.mode) : 0

  return (
    <View>
      <H4 style={{ marginTop: 0 }}>How you travel</H4>
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>
        {legs === 1 ? 'One journey to choose for.' : `${plural(legs, 'journey')} — choose how you travel each one.`}
        {` Only what is allowed for ${KIND_WORD[draft.scope] ?? 'this trip'} is offered.`}
        {draft.flightOrTrain === false ? ' You said this trip has no flight or train, so those are not offered either.' : ''}
      </Txt>

      {!legs ? (
        <TeEmpty title="No journeys yet">Go back to the route and choose where you are going. How you travel is asked for each journey between two places.</TeEmpty>
      ) : null}

      <View accessibilityLabel={`The journeys of this trip. ${draft.segs.filter(sg => sg.mode).length} of ${legs} chosen`} style={{ gap: S.sm }}>
        {draft.segs.map((_, i) => (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 22 }}>
                <TeIcon name="down" px={12} color={C.faint} />
                <Txt size={F.micro} tone="faint">then</Txt>
              </View>
            ) : null}
            {isOpen(i)
              ? <SegRow snap={snap} draft={draft} issues={issues} i={i} tried={!!draft.tried} onDone={() => toggle(i)}
                  edit={edit} onPick={onPick} onVehicleAdded={onVehicleAdded} />
              : <JourneyCard snap={snap} draft={draft} i={i} onPress={() => toggle(i)} />}
          </React.Fragment>
        ))}
      </View>

      {legs && openAt < 0 ? <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>Tap a journey above to choose how you travel it.</Txt> : null}

      {openSeg && openMode && others > 0 ? (
        <View style={{ marginTop: S.md }}>
          <Button full variant="outline" icon={<TeIcon name="swap" size="sm" color={C.brandDeep} />}
            title={`Use ${openMode.name.toLowerCase()} for ${others === legs - 1 ? 'every journey' : `the other ${plural(others, 'journey')}`}`}
            onPress={() => edit(d => applyModeToAll(d, openSeg.mode, openSeg.vehicleId))} />
        </View>
      ) : null}

      {draft.tried && left ? <Ferr>{left === 1 ? 'One journey still needs a mode.' : `${left} journeys still need a mode.`}</Ferr> : null}

      {offered.length ? (
        <Txt size={F.tiny} tone="muted" style={{ marginTop: S.md }}>
          {`Offered here: ${offered.map(m => m.name).join(', ')}. A mode missing from this list is switched off for this kind of trip in Admin → Modes and rates.`}
        </Txt>
      ) : null}
    </View>
  )
}
