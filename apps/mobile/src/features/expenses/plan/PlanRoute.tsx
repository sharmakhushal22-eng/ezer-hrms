// src/features/expenses/plan/PlanRoute.tsx — step 2: the route, as a short list
// (components/te/plan/TePlanRoute.tsx).
//
// One line per place, a thin line for the travel between them, tap a line to
// change it. Only one line is open at a time. `arrive` is never stored on the
// draft except for the return point: arrival dates are read off the preview.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue, TripPreview } from '@web/te/types'
import { addStop, errorFor, movePoint, pointLabel, removePoint, setPattern, type DraftContext, type PlannerDraft } from '@web/te/trip-draft'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, Txt } from '@/ui/primitives'
import { day, plural } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { H4, LinkBtn, Seg } from '../ui/kit'
import { DateField, Ferr, LocBtn, Mk, SelectField } from './parts'
import type { PickTarget } from './PlacePicker'
import type { Edit } from './PlanTrip'
import { SegRow } from './SegRow'

const PATTERN_WORD: Record<string, string> = { oneway: 'Single', round: 'Round trip', multi: 'Multi-city' }

function pickTitle(i: number, ret: boolean | undefined, pattern: string): string {
  if (i === 0) return 'Where the trip starts'
  if (ret) return 'Where you come back to'
  return pattern === 'multi' ? `Destination ${i}` : 'Destination'
}

function locLabel(i: number, ret: boolean, isStop: boolean, intl: boolean): string {
  if (i === 0) return 'Where you start'
  if (ret) return 'Where you come back to'
  return (isStop ? 'Where you stop' : 'Where you go') + (intl ? ', in any country' : '')
}

/** TePlanRoute's ctxOf(): officePlace is simply the first corp place (only used for new drafts). */
export function ctxOf(snap: Snapshot): DraftContext {
  return {
    today: snap.today,
    officePlace: snap.masters.places.find(p => p.pt === 'corp')?.id ?? '',
    vehicles: snap.vehicles.filter(v => v.verified || v.whose === 'self'),
    modes: snap.cfg.modes,
    placeName: (id: string) => snap.masters.places.find(p => p.id === id)?.s ?? '',
  }
}

function PointRow({ snap, draft, issues, preview, i, edit, onPick, toggle }: {
  snap: Snapshot; draft: PlannerDraft; issues: TripIssue[]; preview: TripPreview | null; i: number
  edit: Edit; onPick: (t: PickTarget) => void; toggle: (key: string) => void
}) {
  const { C } = useTheme()
  const p = draft.points[i]
  const local = draft.scope === 'local'
  const tried = !!draft.tried
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const place = (id: string) => snap.masters.places.find(x => x.id === id) ?? null
  const ptName = (id: string) => snap.cfg.ptypes.find(x => x.id === id)?.name ?? ''
  const L = pointLabel(draft, i)
  const key = `p${i}`
  const open = draft.open === key
  const lockRet = !!p.ret && draft.retSame
  const pc = place(lockRet ? draft.points[0].place : p.place)
  const legs = preview?.legs ?? []
  const arrive = p.place ? legs.find(l => l.to === p.place)?.date ?? '' : ''
  const issue = issues.find(x => x.block && (x.k === key || (i > 0 && x.k === `d${i}`)))
  const bad = !!issue && tried
  const intl = draft.scope === 'international' && i > 0 && !p.ret

  const when = p.ret ? (p.arrive ? `Back on ${day(p.arrive)}` : arrive ? `Back on ${day(arrive)}` : '')
    : local ? ''
      : i > 0 ? [arrive ? day(arrive) : '', p.leave && p.leave !== arrive ? day(p.leave) : ''].filter(Boolean).join(' to ')
        : ''
  const sub = (lockRet ? ['Same as the start', when] : [pc && p.pt ? ptName(p.pt) : '', i > 0 && !p.ret ? p.what : '', when])
    .filter(Boolean).join(' · ')
  const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'
  const title = pickTitle(i, p.ret, draft.pattern)
  const setPoint = (patch: Partial<typeof p>) => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))

  return (
    <View style={{ borderRadius: R.md, borderWidth: open ? 1.5 : 1, borderColor: bad ? C.critical : open ? C.brandEdge : C.line, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 }}>
        {i === 0 || lockRet ? <Mk kind="a" label="A" /> : L.isStop ? <Mk kind="s" label={String(L.no)} /> : <Mk kind="b" flag />}
        <Pressable onPress={() => toggle(key)} accessibilityRole="button" accessibilityState={{ expanded: open }}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 56, paddingVertical: 8, paddingRight: L.isStop ? 0 : 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={F.micro} tone="muted">{L.label}</Txt>
            {pc ? <Txt size={F.small} w={700} numberOfLines={1}>{pc.s}</Txt> : <Txt size={F.small} w={600} tone="faint">{placeholder}</Txt>}
            {!!sub && <Txt size={F.micro} tone="muted" numberOfLines={2}>{sub}</Txt>}
            {issue && !open && (pc || bad) ? (
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-start', marginTop: 2 }}>
                <TeIcon name="alert" px={13} color={bad ? C.critical : C.warning} />
                <Txt size={F.micro} w={600} color={bad ? C.critical : C.warning} style={{ flex: 1 }}>{issue.t}</Txt>
              </View>
            ) : null}
          </View>
          <TeIcon name={open ? 'up' : 'down'} size="sm" color={C.muted} />
        </Pressable>
        {L.isStop && (
          <Pressable onPress={() => edit(d => removePoint(d, i, ctxOf(snap)))} accessibilityRole="button" accessibilityLabel={`Remove ${L.label}`} hitSlop={6}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: pressed ? C.sunken : 'transparent' })}>
            <TeIcon name="close" size="sm" color={C.muted} />
          </Pressable>
        )}
      </View>

      {open && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: S.sm }}>
          {p.ret && <Checkbox checked={draft.retSame} onChange={v => edit({ retSame: v })} label="Same as the start" />}

          {!lockRet && (
            <View style={{ gap: 4 }}>
              <LocBtn left={<Mk kind="b" label={i === 0 ? 'A' : 'B'} />} small={locLabel(i, !!p.ret, L.isStop, draft.scope === 'international')}
                title={pc ? pc.s : null} ad={pc ? (pc.addr || pc.name) : undefined} placeholder={placeholder}
                onPress={() => onPick({ kind: 'point', index: i, title, intl })} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: S.lg }}>
                <LinkBtn label="Use my current location" icon="target" onPress={() => onPick({ kind: 'point', index: i, title, useGps: true })} />
                <LinkBtn label="Enter the address" icon="pin" onPress={() => onPick({ kind: 'point', index: i, title, address: true, intl })} />
              </View>
            </View>
          )}
          <Ferr>{err(key)}</Ferr>

          {pc && !lockRet && (
            <View>
              <SelectField label="Type of place" value={p.pt} placeholder="Choose"
                options={snap.cfg.ptypes.filter(t => t.on).map(t => ({ value: t.id, label: t.name }))}
                onPick={v => setPoint({ pt: v })} />
              {i > 0 && !p.ret && (
                <Input label={L.isStop ? 'Why you stop here' : 'What you will do there'} value={p.what}
                  placeholder={L.isStop ? 'Pick up samples, meet the dealer' : 'Meeting, audit, delivery'}
                  onChangeText={v => setPoint({ what: v })} />
              )}
              {i > 0 && !p.ret && !local && (
                <DateField label={i === L.last && draft.pattern === 'oneway' ? 'Stay until, if you stay' : 'Leave on'}
                  value={p.leave || ''} min={arrive || null} clearable
                  help={arrive ? `Arrive ${day(arrive)}` : undefined}
                  onPick={v => setPoint({ leave: v })} />
              )}
            </View>
          )}
          {i > 0 ? <Ferr>{err(`d${i}`)}</Ferr> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
            {i > 0 && !p.ret && L.destinations.length > 1 && (
              <>
                <Button title="Earlier" size="sm" variant="outline" disabled={i <= 1} onPress={() => edit(d => movePoint(d, i, -1, ctxOf(snap)))}
                  icon={<TeIcon name="up" size="sm" color={C.brandDeep} />} />
                <Button title="Later" size="sm" variant="outline" disabled={i >= L.last} onPress={() => edit(d => movePoint(d, i, 1, ctxOf(snap)))}
                  icon={<TeIcon name="down" size="sm" color={C.brandDeep} />} />
              </>
            )}
            <View style={{ flex: 1 }} />
            <Button title="Done" size="sm" onPress={() => toggle(key)} icon={<TeIcon name="check" size="sm" color={C.onAccent} />} />
          </View>
        </View>
      )}
    </View>
  )
}

export function PlanRoute({ snap, draft, issues, preview, edit, onPick, onVehicleAdded }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  preview: TripPreview | null
  edit: Edit
  onPick: (t: PickTarget) => void
  onVehicleAdded: (message: string) => void
}) {
  const local = draft.scope === 'local'
  const planning = draft.origin !== 'POST_FACTO'
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const hasReturn = draft.points.some(p => p.ret)
  const label0 = local ? (planning ? 'Date of the trip' : 'Date you travelled') : (planning ? 'Leave on' : 'Left on')
  const stops = pointLabel(draft, 0).destinations.length - 1
  const retPoint = draft.points.find(p => p.ret)
  const lastLeave = draft.points.filter(p => !p.ret && p.leave).map(p => p.leave).sort().pop() ?? ''
  const toggle = (key: string) => edit(d => ({ ...d, open: d.open === key ? null : key }))
  const placeS = (id: string | undefined) => (id ? snap.masters.places.find(p => p.id === id)?.s : '') || ''

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
        <H4 style={{ marginTop: 0, marginBottom: 0 }}>Route</H4>
        <Seg label="Way back" value={hasReturn ? 'round' : 'oneway'}
          items={[{ key: 'oneway', label: 'One way', icon: 'go' }, { key: 'round', label: 'Round trip', icon: 'swap' }]}
          onChange={k => edit(d => setPattern(d, k, ctxOf(snap)))} />
      </View>

      <DateField label={label0} value={draft.points[0]?.leave || ''}
        min={planning ? snap.today : null} max={planning ? null : snap.today}
        onPick={v => edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, leave: v } : p)) }))} />
      {hasReturn && (
        <DateField label="Back at the start on" value={retPoint?.arrive || ''} clearable
          min={lastLeave || draft.points[0]?.leave || null} max={planning ? null : snap.today}
          onPick={v => edit(d => ({ ...d, points: d.points.map(p => (p.ret ? { ...p, arrive: v } : p)) }))} />
      )}
      <Txt size={F.tiny} tone="muted">{PATTERN_WORD[draft.pattern]}{stops > 0 ? `, ${plural(stops, 'stop')}` : ''}. Tap a line to change it.</Txt>
      <Ferr>{err('d0')}</Ferr>

      <View style={{ marginTop: S.md, gap: 4 }}>
        {draft.points.map((p, i) => {
          const L = pointLabel(draft, i)
          return (
            <React.Fragment key={`p${i}`}>
              {i === L.last && L.last > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, marginLeft: 12, paddingLeft: 18, borderLeftWidth: 2, borderLeftColor: 'transparent' }}>
                  <LinkBtn label="Add a stop" icon="plus" onPress={() => edit(d => addStop(d, L.last - 1, ctxOf(snap)))} />
                  <Txt size={F.tiny} tone="muted">on the way to {placeS(draft.points[L.last]?.place) || 'the destination'}</Txt>
                </View>
              )}
              <PointRow snap={snap} draft={draft} issues={issues} preview={preview} i={i} edit={edit} onPick={onPick} toggle={toggle} />
              {i < draft.points.length - 1 && (
                <SegRow snap={snap} draft={draft} issues={issues} i={i} open={draft.open === `s${i}`} tried={!!draft.tried}
                  onToggle={() => toggle(`s${i}`)} edit={edit} onPick={onPick} onVehicleAdded={onVehicleAdded} />
              )}
            </React.Fragment>
          )
        })}
      </View>
      <Ferr>{err('pr')}</Ferr>
    </View>
  )
}
