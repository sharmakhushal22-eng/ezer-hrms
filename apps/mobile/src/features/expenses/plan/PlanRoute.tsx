// src/features/expenses/plan/PlanRoute.tsx — step 2: one way or round trip, where
// from, where to, when (components/te/plan/TePlanRoute.tsx, planner v2).
//
// HOW YOU TRAVEL IS NO LONGER HERE — that is step 3 (PlanCommute). The links
// between places show the chosen mode read-only, and every gap offers "+ Stop",
// both legs of a round trip (a stop is marked `stop: true` by addStop, so the
// destination stays the destination).
//
// PHONE LAYOUT: the website draws the route left to right with one editor panel
// under the strip. On a phone the same cards are stacked top to bottom and the
// editor opens inside the card that was tapped — one open at a time, tap again
// to close (draft.open, as on the web).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue, TripPreview } from '@web/te/types'
import { addStop, errorFor, movePoint, pointLabel, removePoint, setPattern, type DraftContext, type PlannerDraft } from '@web/te/trip-draft'
import { badUrl } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, Txt } from '@/ui/primitives'
import { day, plural } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { Chip, H4, LinkBtn, Seg } from '../ui/kit'
import { TripMap } from '../ui/TripMap'
import { modeIcon } from '../tones'
import { DateField, Ferr, LocBtn, Mk, SelectField } from './parts'
import type { PickTarget } from './PlacePicker'
import type { Edit } from './PlanTrip'
import { TimeField } from './TimeField'

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

type Point = PlannerDraft['points'][number]

/** The editor for one place (TePlanRoute PointPanel). Module level, so typing keeps focus. */
function PointPanel({ snap, draft, issues, preview, i, edit, onPick, onClose }: {
  snap: Snapshot; draft: PlannerDraft; issues: TripIssue[]; preview: TripPreview | null; i: number
  edit: Edit; onPick: (t: PickTarget) => void; onClose: () => void
}) {
  const { C } = useTheme()
  const p = draft.points[i]
  const local = draft.scope === 'local'
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const place = (id: string) => snap.masters.places.find(q => q.id === id) ?? null
  const L = pointLabel(draft, i)
  const key = `p${i}`
  const lockRet = !!p.ret && draft.retSame
  const pc = place(lockRet ? draft.points[0].place : p.place)
  const arrive = p.place ? (preview?.legs ?? []).find(l => l.to === p.place)?.date ?? '' : ''
  const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'
  const title = pickTitle(i, p.ret, draft.pattern)
  const intl = draft.scope === 'international' && i > 0 && !p.ret
  const derived = i > 0 ? (draft.points[i - 1]?.leave || draft.points[i - 1]?.arrive || '') : ''
  const setPoint = (patch: Partial<Point>) => edit(d => ({ ...d, points: d.points.map((q, k) => (k === i ? { ...q, ...patch } : q)) }))

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: S.sm }}>
      {p.ret ? <Checkbox checked={draft.retSame} onChange={v => edit({ retSame: v })} label="Same as the start" /> : null}

      {lockRet ? null : (
        <View style={{ gap: 4 }}>
          <LocBtn left={<View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}><TeIcon name="pin" size="sm" color={C.brand} /></View>}
            small={locLabel(i, !!p.ret, L.isStop, draft.scope === 'international')}
            title={pc ? pc.s : null} ad={pc ? (pc.addr || pc.name) : undefined} placeholder={placeholder}
            onPress={() => onPick({ kind: 'point', index: i, title, intl })} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: S.lg }}>
            <LinkBtn label="Use my current location" icon="target" onPress={() => onPick({ kind: 'point', index: i, title, useGps: true })} />
            <LinkBtn label="Enter the address" icon="pin" onPress={() => onPick({ kind: 'point', index: i, title, address: true, intl })} />
          </View>
        </View>
      )}
      <Ferr>{err(key)}</Ferr>

      {pc && !lockRet ? (
        <View>
          <SelectField label="Type of place" value={p.pt} placeholder="Choose"
            options={snap.cfg.ptypes.filter(t => t.on).map(t => ({ value: t.id, label: t.name }))}
            onPick={v => setPoint({ pt: v })} />
          {i > 0 && !p.ret ? (
            <Input label={L.isStop ? 'Why you stop here' : 'What you will do there'} value={p.what}
              placeholder={L.isStop ? 'Pick up samples, meet the dealer' : 'Meeting, audit, delivery'}
              onChangeText={v => setPoint({ what: v })} />
          ) : null}
          {i > 0 && !p.ret && !local ? (
            <DateField label={i === L.last && draft.pattern === 'oneway' ? 'Stay until, if you stay' : 'Leave on'}
              value={p.leave || ''} min={p.arrive || arrive || null} clearable
              onPick={v => setPoint({ leave: v })} />
          ) : null}
        </View>
      ) : null}

      {/* WHEN YOU ARE HERE — optional; typed answers win, blanks fall back to the old guess. */}
      {pc && !lockRet ? (
        <View style={{ borderRadius: R.md, backgroundColor: C.sunken, padding: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <TeIcon name="clock" size="sm" color={C.ink} />
            <Txt size={F.small} w={700} style={{ flex: 1 }} numberOfLines={1}>{`When you are ${pc.s || 'here'}`}</Txt>
            <Chip plain label="Optional" />
          </View>
          <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>
            {i === 0
              ? 'The time you set off. The date is above.'
              : p.ret
                ? 'When you are back. The date is on the Route panel above.'
                : derived
                  ? `Left blank, the plan assumes you arrive ${day(derived)} — the day you leave the place before.`
                  : 'Say when you reach here and when you move on.'}
          </Txt>
          {i > 0 ? (
            <DateField label="Reach on" value={p.arrive || ''} clearable
              help={derived && !p.arrive ? `Assumed ${day(derived)}` : undefined}
              onPick={v => setPoint({ arrive: v })} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            {i > 0 ? <TimeField label="Reach at" value={p.arriveAt || ''} onChange={v => setPoint({ arriveAt: v })} style={{ flex: 1 }} /> : null}
            {!p.ret ? <TimeField label={i === 0 ? 'Set off at' : 'Move on at'} value={p.leaveAt || ''} onChange={v => setPoint({ leaveAt: v })} style={{ flex: 1 }} /> : null}
          </View>
          <Input label="Note for the Travel Desk" value={p.prefNote ?? ''} placeholder="Late check-in; the client office shuts at 6"
            onChangeText={v => setPoint({ prefNote: v })} />
          <Input label="Link" value={p.prefUrl ?? ''} placeholder="https://…" autoCapitalize="none" keyboardType="url" autoCorrect={false}
            onChangeText={v => setPoint({ prefUrl: v })} style={{ marginBottom: 0 }}
            error={badUrl(p.prefUrl ?? '') ? 'That does not look like a web address. Paste the whole link, starting with https://' : undefined}
            help="The hotel, the venue, anything about this place." />
        </View>
      ) : null}
      {i > 0 ? <Ferr>{err(`d${i}`)}</Ferr> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        {i > 0 && !p.ret && L.destinations.length > 1 ? (
          <>
            <Button title="Earlier" size="sm" variant="outline" disabled={i <= 1} onPress={() => edit(d => movePoint(d, i, -1, ctxOf(snap)))}
              icon={<TeIcon name="up" size="sm" color={C.brandDeep} />} />
            <Button title="Later" size="sm" variant="outline" disabled={i >= L.last} onPress={() => edit(d => movePoint(d, i, 1, ctxOf(snap)))}
              icon={<TeIcon name="down" size="sm" color={C.brandDeep} />} />
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <Button title="Done" size="sm" onPress={onClose} icon={<TeIcon name="check" size="sm" color={C.onAccent} />} />
      </View>
    </View>
  )
}

/** One place on the route (button.jnode), with its editor when open. */
function PointCard({ snap, draft, issues, preview, i, edit, onPick, select }: {
  snap: Snapshot; draft: PlannerDraft; issues: TripIssue[]; preview: TripPreview | null; i: number
  edit: Edit; onPick: (t: PickTarget) => void; select: (key: string) => void
}) {
  const { C } = useTheme()
  const p = draft.points[i]
  const local = draft.scope === 'local'
  const L = pointLabel(draft, i)
  const key = `p${i}`
  const on = draft.open === key
  const lockRet = !!p.ret && draft.retSame
  const place = (id: string) => snap.masters.places.find(x => x.id === id) ?? null
  const ptName = (id: string) => snap.cfg.ptypes.find(x => x.id === id)?.name ?? ''
  const pc = place(lockRet ? draft.points[0].place : p.place)
  const arrive = p.place ? (preview?.legs ?? []).find(l => l.to === p.place)?.date ?? '' : ''
  const issue = issues.find(x => x.block && (x.k === key || (i > 0 && x.k === `d${i}`)))
  const bad = !!issue && !!draft.tried
  const when = p.ret ? (p.arrive ? `Back ${day(p.arrive)}` : arrive ? `Back ${day(arrive)}` : '')
    : local ? ''
      : i > 0 ? [arrive ? day(arrive) : '', p.leave && p.leave !== arrive ? day(p.leave) : ''].filter(Boolean).join(' – ')
        : (p.leave ? day(p.leave) : '')
  const meta = (lockRet ? ['Same as the start', when] : [pc && p.pt ? ptName(p.pt) : '', i > 0 && !p.ret ? p.what : '', when])
    .filter(Boolean).join(' · ')
  const placeholder = i === 0 ? 'Choose where you start' : p.ret ? 'Choose where you come back to' : L.isStop ? 'Choose the stop' : 'Choose where you go'

  return (
    <View style={{ borderRadius: R.md, borderWidth: on ? 1.5 : 1, borderStyle: pc || on ? 'solid' : 'dashed', borderColor: bad ? C.critical : on ? C.brand : C.lineStrong, backgroundColor: on ? C.surface : pc ? C.surface : C.sunken }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 }}>
        {i === 0 || lockRet ? <Mk kind="a" label="A" /> : L.isStop ? <Mk kind="s" label={String(L.no)} /> : <Mk kind="b" flag />}
        <Pressable onPress={() => select(key)} accessibilityRole="button" accessibilityState={{ expanded: on }}
          accessibilityLabel={`${L.label}: ${pc ? pc.s : 'not chosen yet'}${meta ? `. ${meta}` : ''}`}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 56, paddingVertical: 8, paddingRight: L.isStop ? 0 : 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={F.micro} tone="muted">{L.label}</Txt>
            {pc ? <Txt size={F.small} w={700} numberOfLines={1}>{pc.s}</Txt> : <Txt size={F.small} w={600} tone="faint">{placeholder}</Txt>}
            {meta ? <Txt size={F.micro} tone="muted" numberOfLines={2}>{meta}</Txt> : null}
            {bad && issue && !on ? <Txt size={F.micro} w={600} tone="critical">{issue.t}</Txt> : null}
          </View>
          <TeIcon name={on ? 'up' : 'down'} size="sm" color={C.muted} />
        </Pressable>
        {L.isStop ? (
          <Pressable onPress={() => edit(d => removePoint(d, i, ctxOf(snap)))} accessibilityRole="button" accessibilityLabel={`Remove ${L.label}`} hitSlop={6}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: pressed ? C.sunken : 'transparent' })}>
            <TeIcon name="close" size="sm" color={C.muted} />
          </Pressable>
        ) : null}
      </View>
      {on ? <PointPanel snap={snap} draft={draft} issues={issues} preview={preview} i={i} edit={edit} onPick={onPick} onClose={() => edit({ open: null })} /> : null}
    </View>
  )
}

/** The link between two places (span.jlink): the mode, read-only, and "+ Stop". */
function Link({ snap, draft, i, edit }: { snap: Snapshot; draft: PlannerDraft; i: number; edit: Edit }) {
  const { C } = useTheme()
  const seg = draft.segs[i]
  const segMode = seg ? snap.cfg.modes.find(m => m.id === seg.mode) : null
  const name = (k: number) => snap.masters.places.find(x => x.id === draft.points[k]?.place)?.s || pointLabel(draft, k).label
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginLeft: 22, paddingLeft: 16, borderLeftWidth: 2, borderLeftColor: C.lineStrong, borderStyle: 'dashed', minHeight: 44 }}>
      <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: segMode ? C.brandTint : C.sunken }}>
        <TeIcon name={segMode ? modeIcon(segMode.id) : 'route'} px={12} color={segMode ? C.brandDeep : C.muted} />
        <Txt size={F.micro} w={600} color={segMode ? C.brandDeep : C.muted}>{segMode ? segMode.name : 'Next step'}</Txt>
      </View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => edit(d => addStop(d, i, ctxOf(snap)))} accessibilityRole="button"
        accessibilityLabel={`Add a stop between ${name(i)} and ${name(i + 1)}`} hitSlop={6}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.brandTint : C.surface })}>
        <TeIcon name="plus" px={12} color={C.brand} />
        <Txt size={F.tiny} w={600} tone="brand">Stop</Txt>
      </Pressable>
    </View>
  )
}

export function PlanRoute({ snap, draft, issues, preview, edit, onPick }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  preview: TripPreview | null
  edit: Edit
  onPick: (t: PickTarget) => void
}) {
  const local = draft.scope === 'local'
  const planning = draft.origin !== 'POST_FACTO'
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const hasReturn = draft.points.some(p => p.ret)
  const label0 = local ? (planning ? 'Date of the trip' : 'Date you travelled') : (planning ? 'Leave on' : 'Left on')
  const stops = pointLabel(draft, 0).destinations.length - 1
  const retPoint = draft.points.find(p => p.ret)
  const lastLeave = draft.points.filter(p => !p.ret && p.leave).map(p => p.leave).sort().pop() ?? ''
  const select = (key: string) => edit(d => ({ ...d, open: d.open === key ? null : key }))
  const mapPoints = draft.points.map(p => p.place).filter(Boolean)
  const distinctPlaces = new Set(mapPoints).size
  const places = React.useMemo(() => new Map(snap.masters.places.map(p => [p.id, { id: p.id, s: p.s, lat: p.lat, lng: p.lng }])), [snap.masters.places])
  const anyOpen = draft.points.some((_, i) => draft.open === `p${i}`)
  const setP0 = (patch: Partial<Point>) => edit(d => ({ ...d, points: d.points.map((p, i) => (i === 0 ? { ...p, ...patch } : p)) }))
  const setRet = (patch: Partial<Point>) => edit(d => ({ ...d, points: d.points.map(p => (p.ret ? { ...p, ...patch } : p)) }))

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
        <H4 style={{ marginTop: 0, marginBottom: 0 }}>Route</H4>
        <Seg label="Way back" value={hasReturn ? 'round' : 'oneway'}
          items={[{ key: 'oneway', label: 'One way', icon: 'go' }, { key: 'round', label: 'Round trip', icon: 'swap' }]}
          onChange={k => edit(d => setPattern(d, k, ctxOf(snap)))} />
      </View>

      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <DateField label={label0} value={draft.points[0]?.leave || ''} style={{ flex: 1.4 }}
          min={planning ? snap.today : null} max={planning ? null : snap.today}
          onPick={v => setP0({ leave: v })} />
        <TimeField label="Leaving at" value={draft.points[0]?.leaveAt || ''} help="Optional" style={{ flex: 1 }}
          onChange={v => setP0({ leaveAt: v })} />
      </View>
      {hasReturn ? (
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <DateField label="Back at the start on" value={retPoint?.arrive || ''} clearable style={{ flex: 1.4 }}
            min={lastLeave || draft.points[0]?.leave || null} max={planning ? null : snap.today}
            onPick={v => setRet({ arrive: v })} />
          <TimeField label="Back at" value={retPoint?.arriveAt || ''} help="Optional" style={{ flex: 1 }}
            onChange={v => setRet({ arriveAt: v })} />
        </View>
      ) : null}
      <Txt size={F.tiny} tone="muted">{PATTERN_WORD[draft.pattern]}{stops > 0 ? `, ${plural(stops, 'stop')}` : ''}. Tap a place to change it.</Txt>
      <Ferr>{err('d0')}</Ferr>

      <View accessibilityLabel="The route, in order" style={{ marginTop: S.md, gap: 4 }}>
        {draft.points.map((p, i) => (
          <React.Fragment key={`p${i}`}>
            <PointCard snap={snap} draft={draft} issues={issues} preview={preview} i={i} edit={edit} onPick={onPick} select={select} />
            {i < draft.points.length - 1 ? <Link snap={snap} draft={draft} i={i} edit={edit} /> : null}
          </React.Fragment>
        ))}
      </View>
      {!anyOpen ? <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>Tap a place above to set it, its type and its dates.</Txt> : null}
      <Ferr>{err('pr')}</Ferr>

      {distinctPlaces > 1 ? (
        <View style={{ marginTop: S.md }}>
          <TripMap points={mapPoints}
            legs={draft.segs.map((sg, i) => ({ from: draft.points[i]?.place ?? '', to: draft.points[i + 1]?.place ?? '', mode: sg.mode })).filter(l => l.from && l.to)}
            places={places} height={190} label={`Map of ${draft.name || 'the route so far'}`} />
        </View>
      ) : null}
    </View>
  )
}
