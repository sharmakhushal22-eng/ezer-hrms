// src/features/expenses/plan/PlanStay.tsx — "do you need a stay?" and "will you
// spend on food?", asked while planning (components/te/plan/TePlanStay.tsx).
//
// Nothing here decides money: the hotel estimate stays the engine's, the prices
// typed against the three hotels are for the desk and the approver to read.
// Saying no to a stay removes the hotel line on the server.
//
// platformOf (lib/te/trip-stay.ts) uses new URL(...).hostname; safePlatformOf
// (parts.tsx) falls back to a regex when this runtime's URL cannot do that.
import * as React from 'react'
import { View } from 'react-native'
import type { PlannerDraft } from '@web/te/trip-draft'
import { platformOf, stayOptionsNote, STAY_OPTIONS_WANTED, type StayOption } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { rs } from '../api'
import { Chip, Note, Seg, TeCard } from '../ui/kit'
import { safePlatformOf } from './parts'

const siteOf = (url: string) => safePlatformOf(platformOf, url)
/** badUrl() (lib/te/trip-stay.ts) with the same fallback: non-blank and no host can be read. */
const isBadUrl = (url: string) => !!url.trim() && siteOf(url) === null

function CardHead({ title, chip }: { title: string; chip?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap', marginBottom: S.sm }}>
      <Txt size={F.body} w={700} style={{ flexShrink: 1 }}>{title}</Txt>
      {chip ? <Chip label={chip} plain /> : null}
    </View>
  )
}

function YesNo({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean) => void; label: string }) {
  return (
    <Seg label={label} value={value === true ? 'yes' : value === false ? 'no' : null}
      items={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]}
      onChange={k => onChange(k === 'yes')} style={{ marginBottom: S.sm }} />
  )
}

function HotelCard({ i, o, onSet }: { i: number; o: StayOption; onSet: (patch: Partial<StayOption>) => void }) {
  const { C } = useTheme()
  const site = siteOf(o.url)
  return (
    <View style={{ borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: S.md }}>
      <CardHead title={`Hotel ${i + 1}${i === 0 ? ' — your first choice' : ''}`} chip={site} />
      <Input label="Hotel" value={o.name} placeholder="The name of the hotel" onChangeText={v => onSet({ name: v })} />
      <Input label="Where it is" value={o.location} placeholder="Area, or near what" onChangeText={v => onSet({ location: v })} />
      <Input label="Link" value={o.url} placeholder="https://www.makemytrip.com/hotels/…" autoCapitalize="none" autoCorrect={false} keyboardType="url"
        onChangeText={v => onSet({ url: v })} style={{ marginBottom: 4 }} />
      {isBadUrl(o.url)
        ? <Txt size={F.tiny} tone="critical" style={{ marginBottom: S.md }}>That does not look like a web address. Paste the whole link, starting with https://</Txt>
        : <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>Any booking site. The desk and your approver can open it.</Txt>}
      <Input label="A night, roughly (₹)" value={o.price === '' || o.price == null ? '' : String(o.price)} keyboardType="numeric"
        onChangeText={v => { const t = v.replace(/[^0-9.]/g, ''); onSet({ price: t === '' ? '' : Number(t) }) }}
        help="Optional. For the desk to compare; it does not change the trip estimate." style={{ marginBottom: 0 }} />
    </View>
  )
}

export function PlanStay({ draft, foodBudget, nights, edit }: {
  draft: PlannerDraft
  foodBudget: number
  nights: number
  edit: (patch: Partial<PlannerDraft>) => void
}) {
  const note = draft.stayWanted ? stayOptionsNote(draft.stayOptions) : null
  const setOption = (i: number, patch: Partial<StayOption>) =>
    edit({ stayOptions: draft.stayOptions.map((o, j) => (j === i ? { ...o, ...patch } : o)) })

  return (
    <View>
      <TeCard tint>
        <CardHead title="Do you need a place to stay?" chip={nights > 0 ? (nights === 1 ? '1 night away' : `${nights} nights away`) : null} />
        <YesNo label="Do you need a stay" value={draft.stayWanted} onChange={v => edit({ stayWanted: v })} />
        {draft.stayWanted === false && <Txt size={F.tiny} tone="muted">No hotel on this trip, so none is estimated for it.</Txt>}
        {draft.stayWanted && (
          <View style={{ gap: S.sm }}>
            <Txt size={F.tiny} tone="muted">
              {`Name ${STAY_OPTIONS_WANTED} hotels you would be happy with and paste the page you found each on. The Travel Desk picks one and books it.`}
            </Txt>
            {draft.stayOptions.map((o, i) => <HotelCard key={i} i={i} o={o} onSet={patch => setOption(i, patch)} />)}
            {note && <Note icon={note.warn ? 'warn' : 'check'} warn={note.warn}>{note.text}</Note>}
          </View>
        )}
      </TeCard>

      <TeCard tint>
        <CardHead title="Will you spend on food?" />
        <YesNo label="Will you spend on food" value={draft.foodWanted} onChange={v => edit({ foodWanted: v })} />
        {draft.foodWanted && (
          <Note>
            {foodBudget > 0 ? (
              <Txt size={12.5} tone="soft">
                <Txt size={12.5} w={700}>{rs(foodBudget)}</Txt>
                {' is set aside for food on this trip — your company’s daily food limit for your grade, for each day you are away. There is nothing to fill in now. Add each food and drink bill while you are travelling, with a remark, and it comes off this budget as you go.'}
              </Txt>
            ) : 'No food budget applies to this trip yet. It is worked out from your company’s daily food limit once the dates and places are set.'}
          </Note>
        )}
        {draft.foodWanted === false && <Txt size={F.tiny} tone="muted">No food bills expected. You can still add one later if that changes.</Txt>}
      </TeCard>
    </View>
  )
}
