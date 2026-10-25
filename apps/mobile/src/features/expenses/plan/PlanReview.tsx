// src/features/expenses/plan/PlanReview.tsx — step 3: the journeys, the money,
// who approves (components/te/plan/TePlanReview.tsx).
//
// NOTHING IS CALCULATED HERE. Journeys, per-journey estimates, grade limits,
// money lines, the approval chain and whether approval is needed all come from
// te.tripPreview. The map is the keyless schematic (ui/TripMap — the website
// has no Maps key either) plus the "open in a map app" links.
import * as React from 'react'
import { View } from 'react-native'
import type { Snapshot, TripIssue, TripPreview } from '@web/te/types'
import { blockingOn, errorFor, type PlannerDraft } from '@web/te/trip-draft'
import type { MapPlace } from '@web/te/trip-map'
import { nightsBetween } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { day, rs } from '../api'
import { initialsOf } from '../data'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, H4, KvRow, Sunk, TeCard } from '../ui/kit'
import { MapLinks, TripMap } from '../ui/TripMap'
import { modeIcon } from '../tones'
import { Ferr, SelectField } from './parts'
import { PlanStay } from './PlanStay'

const LEG_KIND: Record<string, string> = {
  first: 'to the airport or station',
  last: 'from the airport or station',
  extra: 'added during the trip',
}
const NO_GPS = ['Forgot to start the travel', 'Phone battery was low', 'No network or GPS signal', 'The app did not work', 'Other']
const NO_APPROVAL = ['Urgent client call', 'Verbal approval by my manager', 'Same-day travel', 'Other']
const STEP_NAME = ['Trip', 'Route', 'Review']

type PreviewLeg = TripPreview['legs'][number]

function LegLine({ l, local, modeName }: { l: PreviewLeg; local: boolean; modeName: string }) {
  const { C } = useTheme()
  const line = `${local ? '' : `${day(l.date)} · `}${modeName}${l.bookedBy === 'desk' ? ', Travel Desk' : ''} · ${l.km} km${l.mode === 'flight' ? ' by air' : ''} · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}${LEG_KIND[l.kind] ? ` · ${LEG_KIND[l.kind]}` : ''}`
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Txt size={F.tiny} w={700} tone="muted" style={{ width: 16, textAlign: 'center' }}>{l.n}</Txt>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}>
        <TeIcon name={modeIcon(l.mode)} size="sm" color={C.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700}>{l.fromPlace?.s ?? '—'} → {l.toPlace?.s ?? '—'}</Txt>
        <Txt size={F.micro} tone="muted">{line}</Txt>
      </View>
      <Txt size={F.small} w={600}>{l.estimate ? rs(l.estimate) : '—'}</Txt>
    </View>
  )
}

function Money({ label, value }: { label: string; value: number }) {
  if (!value) return null
  return <KvRow label={label} value={rs(value)} />
}

export function PlanReview({ snap, draft, issues, preview, edit, onGoStep }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  preview: TripPreview | null
  edit: (patch: Partial<PlannerDraft>) => void
  onGoStep: (n: 1 | 2 | 3) => void
}) {
  const { C } = useTheme()
  const local = draft.scope === 'local'
  const planning = draft.origin !== 'POST_FACTO'
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const legs = preview?.legs ?? []
  const ent = preview?.entitlements ?? null
  const places = React.useMemo(() => new Map<string, MapPlace>(
    snap.masters.places.map(p => [p.id, { id: p.id, s: p.s, lat: p.lat, lng: p.lng }]),
  ), [snap])
  const blocking = issues.filter(i => i.block)
  const warnings = issues.filter(i => !i.block)
  const reasons = (local ? NO_GPS : NO_APPROVAL).map(r => ({ value: r, label: r }))

  return (
    <View>
      <H4 style={{ marginTop: 0 }}>Journeys</H4>
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>Each journey is tracked and paid on its own: GPS on the road, check-ins at airports and abroad.</Txt>
      {legs.length ? (
        <View>
          <TripMap legs={legs.map(l => ({ from: l.from, to: l.to, mode: l.mode }))}
            points={draft.points.map(p => p.place).filter(Boolean)} places={places}
            label={`Map of ${draft.name || 'the trip'}`} />
          <MapLinks points={draft.points.map(p => places.get(p.place))} scope={draft.scope} label={draft.name || 'the trip'} />
          <View style={{ borderTopWidth: 1, borderTopColor: C.line }}>
            {legs.map(l => <LegLine key={l.n} l={l} local={local} modeName={snap.cfg.modes.find(m => m.id === l.mode)?.name ?? l.mode} />)}
          </View>
        </View>
      ) : (
        <View style={{ paddingVertical: S.lg, alignItems: 'center', gap: 4 }}>
          <Txt size={F.body} w={700} center>Choose the places</Txt>
          <Txt size={F.small} tone="muted" center>The journeys appear here, with how each one is tracked.</Txt>
        </View>
      )}

      <H4>{planning ? 'Stay, money and approval' : 'Why it was not tracked'}</H4>

      {!planning && (
        <View>
          <SelectField label={local ? 'Why was GPS not used?' : 'Why was there no prior approval?'} value={draft.pfReason}
            placeholder="Choose a reason" options={reasons} onPick={v => edit({ pfReason: v })} />
          <Input label={local ? 'What happened' : 'Evidence, if any'} value={draft.pfNote}
            placeholder={local ? 'Needed for Other' : 'Meeting invite, e-mail from the client'} onChangeText={v => edit({ pfNote: v })} />
          <Ferr>{err('pf')}</Ferr>
        </View>
      )}

      {planning && (
        <View>
          <PlanStay draft={draft} foodBudget={preview?.estimate.meals ?? 0}
            nights={nightsBetween(preview?.start ?? null, preview?.end ?? null)} edit={edit} />
          {draft.stayWanted && (
            <SelectField label="Hotel booked by" value={draft.stayBy}
              options={[{ value: 'self', label: 'Me, I claim it later' }, { value: 'desk', label: 'Travel Desk, company pays' }]}
              onPick={v => edit({ stayBy: v === 'desk' ? 'desk' : 'self' })} />
          )}
          {!local && (
            <Input label="Advance needed (₹)" keyboardType="numeric" value={draft.advance === '' ? '' : String(draft.advance)}
              onChangeText={v => { const t = v.replace(/[^0-9.]/g, ''); edit({ advance: t === '' ? '' : Number(t) }) }}
              help="Leave empty if you do not need one." />
          )}
          <Ferr>{err('adv')}</Ferr>
        </View>
      )}

      <View style={{ gap: S.md, marginTop: S.sm }}>
        {ent && !local && (
          <TeCard tint style={{ marginBottom: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap', marginBottom: S.sm }}>
              <Txt size={F.body} w={700}>Your limits on this trip</Txt>
              <Chip label={`Grade ${ent.grade}`} tone="t-brand" plain />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <Txt size={F.micro} w={700} tone="muted" upper>City</Txt>
              <Txt size={F.small} w={700}>{preview?.to || '—'}</Txt>
              <Txt size={F.tiny} tone="muted">{ent.tier}</Txt>
            </View>
            <KvRow label="Hotel a night" value={rs(ent.hotel)} />
            <KvRow label="Food a day" value={rs(ent.meals)} />
            <KvRow label="Local a day" value={rs(ent.conv)} last />
          </TeCard>
        )}

        {preview && planning && (
          <View>
            <Money label="Travel you pay" value={preview.estimate.travel} />
            <Money label="Tickets the Travel Desk books" value={preview.estimate.desk} />
            <Money label="Hotel" value={preview.estimate.hotel} />
            <Money label="Food" value={preview.estimate.meals} />
            <Money label="Local rides at the destination" value={preview.estimate.conv} />
            <KvRow label="Total estimate, your share" value={rs(preview.estimateTotal)} tot last={local} />
            {!local && (
              <>
                <KvRow label="Paid by you, reimbursed later" value={rs(preview.selfEstimate)} />
                <KvRow label="Advance you can ask" value={`up to ${rs(preview.advanceCap)}`} last />
              </>
            )}
          </View>
        )}

        {draft.pax > 1 && <Txt size={F.tiny} tone="muted">{`${draft.pax} people travel. Each person claims their own expenses against their own limits.`}</Txt>}

        {blocking.length > 0 && (
          <Flag tone={draft.tried ? 'crit' : 'info'} icon="claims" title={draft.tried ? `${blocking.length} things to fix` : 'Still to fill'}>
            <View style={{ gap: 4, marginTop: 2 }}>
              {([1, 2, 3] as const).map(n => {
                const on = blockingOn(issues, n)
                if (!on.length) return null
                return (
                  <Txt key={n} size={12.5} tone="soft">
                    <Txt size={12.5} w={700} tone="brand" onPress={() => onGoStep(n)}>{STEP_NAME[n - 1]}</Txt>
                    {`: ${on.map(i => i.t).join(' ')}`}
                  </Txt>
                )
              })}
            </View>
          </Flag>
        )}

        {warnings.map((w, i) => <Flag key={i} tone="warn" icon="alert" title={w.t} />)}

        {preview && !blocking.length && (
          <Sunk>
            <Txt size={F.tiny} tone="muted">
              {!planning ? 'The trip and its claim go to' : preview.needsApproval ? 'This plan goes to' : 'No approval is needed before you leave'}
            </Txt>
            {preview.needsApproval || !planning ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
                {preview.chain.map((s, i) => (
                  <View key={`${s.role}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {i > 0 && <TeIcon name="go" size="sm" color={C.muted} />}
                    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
                      <Txt size={F.micro} w={700} tone="brand">{initialsOf(s.name || s.role)}</Txt>
                    </View>
                    <View>
                      <Txt size={F.small} w={700}>{s.name || s.team || s.role}</Txt>
                      <Txt size={F.micro} tone="muted">{s.role}</Txt>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Txt size={F.small} style={{ marginTop: 4 }}>
                {/* The web says "leg 1" / "the last leg"; the UI rule (spec intro, migration 162) is "journey". */}
                {`Local, ${Math.round(legs.reduce((a, l) => a + l.km, 0))} km in all. Start journey 1 on the day. The claim goes to your manager after the last journey.`}
              </Txt>
            )}
          </Sunk>
        )}
      </View>

      {draft.answerNeeded && (
        <View>
          <H4>For your approver</H4>
          <Input label="What did you change?" value={draft.answer ?? ''} multiline onChangeText={v => edit({ answer: v })} />
        </View>
      )}
      <View style={{ height: R.md }} />
    </View>
  )
}
